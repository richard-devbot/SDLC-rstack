"""RStack SDLC — Operator adapter.

Operator (a Python AI-agent harness, https://github.com/…/operator) loads this as
an extension and exposes the same `sdlc_*` tools the Pi adapter provides. Each tool
shells out to the Node bridge (bin/rstack-operator-bridge.ts), which reuses the
existing TypeScript adapter and harness verbatim — no SDLC logic is reimplemented
in Python.

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
"""
from __future__ import annotations

import asyncio
import json
import os
import shutil
from pathlib import Path
from typing import Literal, Optional

from pydantic import BaseModel, Field

from operator_use.extension.types import ToolDefinition
from operator_use.tool.types import ToolKind, ToolResult

PKG_ROOT = Path(__file__).resolve().parents[3]  # src/integrations/operator/ -> package root
BRIDGE = PKG_ROOT / "bin" / "rstack-operator-bridge.ts"

# settings.json key → environment variable consumed by the TS adapter/harness.
_CONFIG_ENV = {
    "worker_command": "RSTACK_WORKER_COMMAND",
    "default_model": "RSTACK_DEFAULT_MODEL",
    "escalated_model": "RSTACK_ESCALATED_MODEL",
    "slack_webhook": "RSTACK_SLACK_WEBHOOK",
    "state_dir": "RSTACK_STATE_DIR",
    "allow_destructive": "RSTACK_ALLOW_DESTRUCTIVE",
}


def _launch_business_hub() -> None:
    """Bring the Business Hub live when an Operator session loads this extension.

    Same contract as the Pi adapter: health-check :3008, spawn detached if
    down, open the browser. Best-effort — never blocks or fails the session.
    Opt out with RSTACK_NO_BUSINESS_HUB=1.
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
}


def extension(api) -> None:
    cfg = api.config or {}
    config_env = {
        env: str(cfg[key]) for key, env in _CONFIG_ENV.items() if cfg.get(key) is not None
    }

    async def _run_bridge(tool: str, params: dict, ctx, invocation_id: str) -> ToolResult:
        npx = shutil.which("npx")
        if npx is None:
            return ToolResult.error(invocation_id, "RStack: `npx` not found on PATH. Install Node.js and run `npm install` in the rstack-sdlc package.")
        if not BRIDGE.is_file():
            return ToolResult.error(invocation_id, f"RStack: bridge not found at {BRIDGE}.")

        project_root = str(getattr(ctx, "cwd", None) or os.getcwd())
        env = {**os.environ, **config_env, "RSTACK_PROJECT_ROOT": project_root}

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

    def _make_execute(tool: str):
        async def _execute(params: BaseModel, invocation, ctx, context=None) -> ToolResult:
            payload = params.model_dump(exclude_none=True)
            return await _run_bridge(tool, payload, ctx, invocation.id)
        return _execute

    for name, (description, model) in _TOOLS.items():
        api.register_tool(ToolDefinition(
            name=name,
            description=description,
            parameters=model,
            execute=_make_execute(name),
            kind=ToolKind.Automation,
        ))


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
