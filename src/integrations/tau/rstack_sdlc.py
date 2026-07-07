"""RStack SDLC — Tau adapter.

Based on the Tau adapter contributed by Jeomon George (https://github.com/Jeomon).

Tau (https://github.com/Jeomon/Tau) is a Python agent framework and terminal
coding assistant with the same extension shape as Operator: a plain Python
file exporting `register(tau)`, Pydantic-schema tools, and a `tool_call`
event hook that can block execution before it happens. This adapter reuses
that shape twice:

  1. Every `sdlc_*` tool shells out to the shared Node bridge
     (bin/rstack-bridge.ts, with RSTACK_BRIDGE_CALLER=tau), which reuses the
     existing TypeScript adapter and harness verbatim — no SDLC logic is
     reimplemented in Python.
  2. Tau's built-in `terminal` / `write` / `edit` tools are routed through
     `rstack-agents guard` on the `tool_call` hook, the same framework-neutral
     enforcement gate Claude Code wires via PreToolUse (destructive-action
     gate + validator sandbox — see docs/integrations/wire-your-own-harness.md).
     Tau's `ToolCallEventResult(block=True, ...)` return value is exactly the
     "cancel before execution" mechanism that guard wiring needs, so — unlike
     Operator or Claude Code — no host-side hook config is required; loading
     this extension is the wiring.

Requirements on the host:
  - node + npx on PATH
  - `npm install` has been run once in this package directory (pulls tsx + harness deps)

Optional configuration (settings.json → extensions.list[].settings, or env):
  worker_command   → RSTACK_WORKER_COMMAND   (Pi-compatible CLI for sdlc_delegate workers)
  default_model    → RSTACK_DEFAULT_MODEL
  escalated_model  → RSTACK_ESCALATED_MODEL
  slack_webhook    → RSTACK_SLACK_WEBHOOK
  state_dir        → RSTACK_STATE_DIR
  allow_destructive→ RSTACK_ALLOW_DESTRUCTIVE

owner: RStack developed by Richardson Gunde
"""
from __future__ import annotations

import asyncio
import json
import os
import shutil
from pathlib import Path
from typing import Literal, Optional

from pydantic import BaseModel, Field

from tau.hooks import ToolCallEventResult
from tau.tool.types import Tool, ToolContext, ToolExecutionMode, ToolInvocation, ToolKind, ToolResult

PKG_ROOT = Path(__file__).resolve().parents[3]  # src/integrations/tau/ -> package root
BRIDGE = PKG_ROOT / "bin" / "rstack-bridge.ts"

# settings.json key → environment variable consumed by the TS adapter/harness.
_CONFIG_ENV = {
    "worker_command": "RSTACK_WORKER_COMMAND",
    "default_model": "RSTACK_DEFAULT_MODEL",
    "escalated_model": "RSTACK_ESCALATED_MODEL",
    "slack_webhook": "RSTACK_SLACK_WEBHOOK",
    "state_dir": "RSTACK_STATE_DIR",
    "allow_destructive": "RSTACK_ALLOW_DESTRUCTIVE",
}

# Tau built-in tool name → (guard tool_name, param field carrying the target).
# `read`, `glob`, `grep`, `ls` are read-only and are not routed through the gate.
_GUARD_TOOL_MAP = {
    "terminal": ("Bash", "cmd"),
    "write": ("Write", "path"),
    "edit": ("Edit", "path"),
}


def _launch_business_hub() -> None:
    """Bring the Business Hub live when a Tau session loads this extension.

    Same contract as the Pi and Operator adapters: health-check :3008, spawn
    detached if down, open the browser. Best-effort — never blocks or fails
    the session. Opt out with RSTACK_NO_BUSINESS_HUB=1.
    """
    if os.environ.get("RSTACK_NO_BUSINESS_HUB") == "1" or os.environ.get("CI"):
        return
    import subprocess
    import urllib.request
    import webbrowser

    port = int(os.environ.get("RSTACK_BUSINESS_PORT", "3008"))
    url = f"http://localhost:{port}"
    alive = False
    try:
        with urllib.request.urlopen(f"{url}/health", timeout=0.7) as response:
            alive = json.loads(response.read().decode("utf8")).get("ok") is True
    except Exception:
        alive = False

    try:
        if not alive:
            node = shutil.which("node")
            hub_bin = PKG_ROOT / "bin" / "rstack-business.js"
            if not node or not hub_bin.exists():
                return
            subprocess.Popen(
                [node, str(hub_bin), "--no-browser", "--project", os.getcwd()],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                start_new_session=True,
                env={**os.environ, "RSTACK_NO_BROWSER": "1", "RSTACK_BUSINESS_PORT": str(port)},
            )
        webbrowser.open(url)
    except Exception:
        pass  # the dashboard is a companion, never a blocker


_launch_business_hub()


# ── Parameter models (mirror the typebox schemas in rstack-sdlc.ts) ────────────

class OrchestrateParams(BaseModel):
    goal: Optional[str] = Field(None, description="Goal to orchestrate.")


class StartParams(BaseModel):
    goal: str = Field(description="Software goal, feature, app, bug fix, or release objective.")
    mode: Optional[Literal["interactive", "express"]] = "interactive"


class ClarifyParams(BaseModel):
    run_id: Optional[str] = None
    answers: Optional[list[str]] = Field(None, description="Product-owner answers to append to context.md.")


class PlanParams(BaseModel):
    run_id: Optional[str] = None
    constraints: Optional[list[str]] = None
    domains: Optional[list[str]] = None


class SpecParams(BaseModel):
    run_id: Optional[str] = None
    artifact: Literal[
        "product-brief.md", "requirements.json", "architecture.md",
        "implementation-report.json", "qa-report.json", "security-review.md",
        "handoff.md", "release-readiness.json",
    ]
    action: Optional[Literal["read", "update"]] = "read"
    content: Optional[str] = Field(None, description="New content for the artifact when action=update.")
    trace_mapping: Optional[dict] = Field(None, description="Traceability mapping, e.g. {requirement_id: 'R1', design_id: 'D1'}.")


class ApproveParams(BaseModel):
    run_id: Optional[str] = None
    artifact: str = Field(description="Artifact or stage ID being approved (e.g. 'architecture.md' or '002-requirements').")
    status: Literal["APPROVED", "REJECTED"]
    comments: Optional[str] = None
    approver: Optional[str] = "human-user"


class BuildNextParams(BaseModel):
    run_id: Optional[str] = None


class ValidateParams(BaseModel):
    run_id: Optional[str] = None
    task_id: Optional[str] = None


class AgentsParams(BaseModel):
    kind: Optional[Literal["agent", "skill", "plugin"]] = None
    domain: Optional[str] = None
    limit: Optional[int] = 80


class DelegateTask(BaseModel):
    agent: str
    task: str
    cwd: Optional[str] = None
    tools: Optional[list[str]] = None


class DelegateParams(BaseModel):
    agent: Optional[str] = Field(None, description="Agent name or id for single mode.")
    task: Optional[str] = Field(None, description="Task for single mode.")
    tasks: Optional[list[DelegateTask]] = None
    concurrency: Optional[int] = 3


class StatusParams(BaseModel):
    run_id: Optional[str] = None


class MemoryParams(BaseModel):
    action: Literal["search", "append", "summarize"]
    query: Optional[str] = None
    learning: Optional[str] = Field(None, description="Learning text to append when action=append.")


class DashboardParams(BaseModel):
    run_id: Optional[str] = Field(None, description="Run ID to view.")


class TraceParams(BaseModel):
    task_id: Optional[str] = Field(None, description="Task ID (e.g., 001-product-clarification) to trace.")
    run_id: Optional[str] = Field(None, description="Run ID to trace.")


class RollbackParams(BaseModel):
    stage_id: str = Field(description="Stage ID (e.g., 00-environment) to rollback.")
    run_id: Optional[str] = Field(None, description="Run ID to target.")


class DecideParams(BaseModel):
    run_id: Optional[str] = None
    question: str = Field(description="Decision or open question to record on the run's Decision Queue.")
    options: Optional[list[str]] = None
    chosen: Optional[str] = Field(None, description="Chosen option, when the decision is being resolved.")
    rationale: Optional[str] = None


class DecisionsParams(BaseModel):
    run_id: Optional[str] = None
    status: Optional[Literal["open", "resolved", "all"]] = "all"


class DorCheckParams(BaseModel):
    run_id: Optional[str] = None
    stage_id: Optional[str] = Field(None, description="Stage ID to run the Definition-of-Ready check against.")


# name → (description, params model)
_TOOLS: dict[str, tuple[str, type[BaseModel]]] = {
    "sdlc_orchestrate": ("Load the RStack orchestrator, builder, and validator agent instructions into the active task. Use this before coding with RStack.", OrchestrateParams),
    "sdlc_start": ("Start a clean .rstack/runs lifecycle for building, testing, validating, and shipping software with agent teams.", StartParams),
    "sdlc_clarify": ("Capture product-owner answers before planning so RStack does not guess important requirements.", ClarifyParams),
    "sdlc_plan": ("Create a full software lifecycle plan and task graph for the active RStack run.", PlanParams),
    "sdlc_spec": ("Read or update a specific SDLC artifact (vision, requirements, architecture, etc.) in the run specs directory.", SpecParams),
    "sdlc_approve": ("Capture human approval or rejection for a specific artifact or SDLC stage.", ApproveParams),
    "sdlc_build_next": ("Prepare the next pending builder task with specialist context and an output contract.", BuildNextParams),
    "sdlc_validate": ("Validate an RStack task contract and produce a read-only validation report.", ValidateParams),
    "sdlc_agents": ("List RStack package-local and project-local agents/skills by domain for routing and team assembly.", AgentsParams),
    "sdlc_delegate": ("Spawn one or more RStack agents as isolated Pi subprocesses. Supports single or bounded parallel delegation. Validators default to read-only tools.", DelegateParams),
    "sdlc_status": ("Show active RStack run status, task progress, registry counts, and next recommended action.", StatusParams),
    "sdlc_memory": ("Search or append RStack project learnings used by future SDLC runs.", MemoryParams),
    "sdlc_dashboard": ("Generate static HTML dashboard for RStack run and open it in the browser.", DashboardParams),
    "sdlc_trace": ("Deep-dive CLI LangSmith-like trace view of tool calls and results for a single task.", TraceParams),
    "sdlc_rollback": ("Rollback the specified SDLC stage to its last recorded checkpoint, restoring directory state.", RollbackParams),
    "sdlc_decide": ("Record or resolve a decision on the run's Decision Queue.", DecideParams),
    "sdlc_decisions": ("List decisions on the run's Decision Queue.", DecisionsParams),
    "sdlc_dor_check": ("Run the Definition-of-Ready gate check for a stage.", DorCheckParams),
}


async def _run_bridge(tool: str, params: dict, cwd: str, invocation_id: str, config_env: dict[str, str]) -> ToolResult:
    npx = shutil.which("npx")
    if npx is None:
        return ToolResult.error(invocation_id, "RStack: `npx` not found on PATH. Install Node.js and run `npm install` in the rstack-sdlc package.")
    if not BRIDGE.is_file():
        return ToolResult.error(invocation_id, f"RStack: bridge not found at {BRIDGE}.")

    env = {**os.environ, **config_env, "RSTACK_PROJECT_ROOT": cwd, "RSTACK_BRIDGE_CALLER": "tau"}

    proc = await asyncio.create_subprocess_exec(
        npx, "tsx", str(BRIDGE), tool, json.dumps(params),
        cwd=str(PKG_ROOT), env=env,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    out, err = await proc.communicate()
    stdout = out.decode("utf-8", "replace").strip()
    stderr = err.decode("utf-8", "replace").strip()

    if proc.returncode != 0:
        detail = stderr or stdout or f"exit {proc.returncode}"
        return ToolResult.error(invocation_id, f"RStack {tool} failed: {detail}")

    text = _extract_text(stdout)
    return ToolResult.ok(invocation_id, text)


def _extract_text(stdout: str) -> str:
    """The bridge prints the tool's raw result. Pi tools return
    { content: [{type:'text', text}], details }. Pull the text out; fall back to
    raw stdout if the shape is unexpected."""
    if not stdout:
        return ""
    try:
        data = json.loads(stdout)
    except json.JSONDecodeError:
        return stdout
    if isinstance(data, dict):
        content = data.get("content")
        if isinstance(content, list):
            parts = [str(c.get("text", "")) for c in content if isinstance(c, dict)]
            joined = "\n".join(p for p in parts if p)
            if joined:
                return joined
        return json.dumps(data, indent=2)
    return stdout


class _BridgeTool(Tool):
    """One `sdlc_*` tool; `execute` shells out to the shared Node bridge."""

    def __init__(self, name: str, description: str, schema: type[BaseModel], config_env: dict[str, str]):
        super().__init__(
            name=name,
            description=description,
            schema=schema,
            kind=ToolKind.Execute,
            execution_mode=ToolExecutionMode.Sequential,
        )
        self._config_env = config_env

    async def execute(
        self,
        invocation: ToolInvocation,
        tool_execution_update_callback=None,
        signal=None,
        context: Optional[ToolContext] = None,
    ) -> ToolResult:
        cwd = str(getattr(context, "cwd", None) or os.getcwd())
        params = {k: v for k, v in (invocation.params or {}).items() if v is not None}
        return await _run_bridge(self.name, params, cwd, invocation.id, self._config_env)


async def _run_guard(guard_tool_name: str, tool_input: dict, cwd: str) -> tuple[bool, str]:
    """Classify one pending tool call via `rstack-agents guard`.

    Fails OPEN (allows the call) only when `npx` itself is unreachable — the
    guard binary is then never reachable, so refusing to load the extension
    would be worse than skipping enforcement for that one session. Any exit
    code other than 2 is treated as allow, matching the documented guard
    contract (exit 0 allow / exit 2 block).
    """
    npx = shutil.which("npx")
    if npx is None:
        return True, ""

    payload = json.dumps({"tool_name": guard_tool_name, "tool_input": tool_input}).encode("utf-8")
    proc = await asyncio.create_subprocess_exec(
        npx, "--yes", "rstack-agents", "guard", "--context", "builder", "--project", cwd,
        stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        env=os.environ, cwd=cwd,
    )
    out, err = await proc.communicate(payload)
    if proc.returncode == 2:
        reason = (
            err.decode("utf-8", "replace").strip()
            or out.decode("utf-8", "replace").strip()
            or "RStack guard blocked this tool call."
        )
        return False, reason
    return True, ""


def register(tau) -> None:
    cfg = tau.config or {}
    config_env = {
        env: str(cfg[key]) for key, env in _CONFIG_ENV.items() if cfg.get(key) is not None
    }

    for name, (description, model) in _TOOLS.items():
        tau.register_tool(_BridgeTool(name, description, model, config_env))

    @tau.on("tool_call")
    async def _rstack_guard(event, ctx):
        mapping = _GUARD_TOOL_MAP.get(event.tool_name)
        if mapping is None:
            return None
        guard_tool_name, field = mapping
        tool_input = {field: (event.input or {}).get(field, "")}
        allowed, reason = await _run_guard(guard_tool_name, tool_input, str(ctx.cwd))
        if not allowed:
            return ToolCallEventResult(block=True, reason=reason)
        return None
