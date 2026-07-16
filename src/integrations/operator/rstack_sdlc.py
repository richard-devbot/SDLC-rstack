"""RStack SDLC — Operator adapter (#391 corrected).

Operator (operator-use, https://pypi.org/project/operator-use/) is a Python
agent harness. This adapter was previously entirely non-functional: it
imported `operator_use.extension.types.ToolDefinition` and
`operator_use.tool.types.{ToolKind,ToolResult}` — NEITHER module exists in
the real package (verified against operator-use 0.2.9 installed from PyPI;
both imports raise ModuleNotFoundError immediately), and the exported
`ToolResult.ok`/`ToolResult.error` factory methods it called don't exist
either (the real ones are `success_result`/`error_result`). The adapter had
never actually been imported by a real Operator process.

The real contract, verified by reading the installed package source:
  - `operator_use.plugins.Plugin` is the base class third-party code extends:
    override `get_tools()` (-> list[Tool]) and `register_hooks(hooks)`.
  - `operator_use.tools.Tool` is a decorator/wrapper class:
    `Tool(name=..., description=..., model=SomeBaseModel)(async_or_sync_fn)`.
    The wrapped function is called as `fn(**coerced_params)` — the model's
    field names become keyword arguments (agent/tools/registry.py
    `ToolRegistry.aexecute`).
  - `operator_use.agent.hooks.HookEvent.BEFORE_TOOL_CALL` IS a real, blocking
    hook — verified in `agent/service.py::_execute_tool`: setting
    `ctx.skip = True` and `ctx.result = <ToolResult>` on the
    `BeforeToolCallContext` short-circuits real tool execution entirely and
    uses `ctx.result` instead. This is a stronger guarantee than Tau/Hermes
    needed to work around (no built-in shadowing required).
  - The real built-in tool name for shell execution is `terminal` with a
    `cmd` field (agent/tools/builtin/terminal.py) — NOT `command` (that was
    the wrong assumption fixed on the Tau adapter; Operator's real field
    genuinely is `cmd`). File tools are `write_file`/`edit_file`, both keyed
    on a `path` field (agent/tools/builtin/filesystem.py).

The one gap that IS a genuine host-design limitation (not a bug in this
adapter): operator-use 0.2.9 has **no third-party plugin discovery**. No
entry_points group, no config field, no directory scan — `cli/start.py
_build_agents()` hardcodes `plugins = [ComputerPlugin(...),
BrowserPlugin(...)]` directly in Python source, passed straight to the
`Agent(...)` constructor. There is no supported way to add a plugin to a
real `operator start` session without either forking the package or
patching that call site before it runs. `bootstrap.py` alongside this file
does the latter — see its docstring for exactly what it patches and why.

No SDLC logic is reimplemented in Python; every tool shells out to the
generic Node bridge (bin/rstack-bridge.ts). Conformance contract:
docs/integrations/adapter-contract.md.

Requirements on the host:
  - node + npx on PATH
  - `npm install` has been run once in the rstack-agents package directory

Optional configuration (RStackPlugin(config=...), or env):
  worker_command   -> RSTACK_WORKER_COMMAND   (Pi-compatible CLI for sdlc_delegate)
  default_model    -> RSTACK_DEFAULT_MODEL
  escalated_model  -> RSTACK_ESCALATED_MODEL
  slack_webhook    -> RSTACK_SLACK_WEBHOOK
  state_dir        -> RSTACK_STATE_DIR
  allow_destructive-> RSTACK_ALLOW_DESTRUCTIVE
  RSTACK_GUARD_FAIL_OPEN=1 opts back into legacy fail-open on guard-unavailable.

owner: RStack developed by Richardson Gunde
"""
from __future__ import annotations

import asyncio
import json
import os
import shutil
from pathlib import Path
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

from operator_use.plugins import Plugin
from operator_use.tools import Tool, ToolResult
from operator_use.agent.hooks import HookEvent, BeforeToolCallContext, AfterToolCallContext

PKG_ROOT = Path(__file__).resolve().parents[3]  # src/integrations/operator/ -> package root
BRIDGE = PKG_ROOT / "bin" / "rstack-bridge.ts"

# RStackPlugin(config=...) key -> environment variable consumed by the TS harness.
_CONFIG_ENV = {
    "worker_command": "RSTACK_WORKER_COMMAND",
    "default_model": "RSTACK_DEFAULT_MODEL",
    "escalated_model": "RSTACK_ESCALATED_MODEL",
    "slack_webhook": "RSTACK_SLACK_WEBHOOK",
    "state_dir": "RSTACK_STATE_DIR",
    "allow_destructive": "RSTACK_ALLOW_DESTRUCTIVE",
}

_BRIDGE_TIMEOUT_S = float(os.environ.get("RSTACK_BRIDGE_TIMEOUT_MS", "60000")) / 1000.0
_GUARD_TIMEOUT_S = float(os.environ.get("RSTACK_GUARD_TIMEOUT_MS", "15000")) / 1000.0

# Operator built-in tool name -> (guard tool_name, Operator's own field name,
# the field the guard classifier itself reads). Verified against operator-use
# 0.2.9 agent/tools/builtin/{terminal,filesystem}.py for the source field, and
# src/core/harness/destructive-actions.js for the guard's expected field.
#
# A live smoke test caught a real bug here: Operator's terminal tool's field
# is genuinely "cmd" (unlike Tau, where "cmd" was the WRONG guess and the
# field really is "command" — the two adapters needed opposite fixes). The
# guard's Bash classifier reads tool_input.command specifically, so a naive
# {"cmd": ...} payload silently classified as non-destructive regardless of
# content: `{"tool_name":"Bash","tool_input":{"cmd":"rm -rf ..."}}` returned
# {"decision":"allow","reason":"non-destructive action"}. Write/Edit's field
# genuinely is "path" on both sides — destructive-actions.js accepts
# input.path as one of several aliases, so no translation needed there.
# Read-only tools (read_file, list_dir) are absent — they skip the guard.
_GUARDED_TOOLS: dict[str, tuple[str, str, str]] = {
    "terminal": ("Bash", "cmd", "command"),
    "write_file": ("Write", "path", "path"),
    "edit_file": ("Edit", "path", "path"),
}


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
    artifact: str = Field(description="Artifact or stage id to read/update.")
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
    action: Literal["search", "append"]
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


class DecisionsParams(BaseModel):
    run_id: Optional[str] = None
    question: Optional[str] = Field(None, description="When provided, add this as a pending decision.")
    impact: Optional[Literal["architecture", "security", "budget", "scope", "delivery"]] = "scope"
    required_before_stage: Optional[str] = Field(None, description="Canonical stage that requires this decision first.")
    recommendation: Optional[str] = None
    owner: Optional[str] = None


class DecideParams(BaseModel):
    run_id: Optional[str] = None
    decision_id: str
    status: Optional[Literal["resolved", "waived"]] = "resolved"
    resolution: str
    resolved_by: Optional[str] = None


class DorCheckParams(BaseModel):
    run_id: Optional[str] = None
    target_stage: Optional[str] = Field(None, description="Canonical stage to check readiness for.")


# name -> (description, params model). tests/bridge-conformance.test.js parses
# this dict's entries to prove this adapter's tool surface matches the Pi
# registry exactly (adapter-contract.md §1/§6).
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
    "sdlc_delegate": ("Spawn one or more RStack agents as isolated worker subprocesses. Supports single or bounded parallel delegation. Validators default to read-only tools.", DelegateParams),
    "sdlc_status": ("Show active RStack run status, task progress, registry counts, and next recommended action.", StatusParams),
    "sdlc_memory": ("Search or append RStack project learnings used by future SDLC runs.", MemoryParams),
    "sdlc_dashboard": ("Generate static HTML dashboard for RStack run and open it in the browser.", DashboardParams),
    "sdlc_trace": ("Deep-dive trace view of tool calls and results for a single task.", TraceParams),
    "sdlc_rollback": ("Rollback the specified SDLC stage to its last recorded checkpoint, restoring directory state.", RollbackParams),
    "sdlc_decisions": ("List or add run-level decisions that must be resolved before later SDLC stages.", DecisionsParams),
    "sdlc_decide": ("Resolve or waive a pending Decision Queue item.", DecideParams),
    "sdlc_dor_check": ("Evaluate unresolved decisions and write dor-report.json/readiness.json for the selected run.", DorCheckParams),
}


# ── bridge shelling ──────────────────────────────────────────────────────────

def _extract_text(stdout: str) -> str:
    """The bridge prints the tool's raw result {content:[{type:'text',text}],details}.
    Pull the text out; fall back to raw stdout on an unexpected shape."""
    stdout = (stdout or "").strip()
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


async def _run_bridge(tool: str, params: dict, cwd: str, config_env: dict) -> str:
    npx = shutil.which("npx")
    if npx is None:
        return "RStack: `npx` not found on PATH. Install Node.js and run `npm install` in the rstack-agents package."
    if not BRIDGE.is_file():
        return f"RStack: bridge not found at {BRIDGE}."
    env = {**os.environ, **config_env, "RSTACK_PROJECT_ROOT": cwd, "RSTACK_BRIDGE_CALLER": "operator"}
    try:
        proc = await asyncio.create_subprocess_exec(
            npx, "tsx", str(BRIDGE), tool, json.dumps(params),
            cwd=str(PKG_ROOT), env=env,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        out, err = await asyncio.wait_for(proc.communicate(), timeout=_BRIDGE_TIMEOUT_S)
    except asyncio.TimeoutError:
        return f"RStack {tool} timed out after {_BRIDGE_TIMEOUT_S:.0f}s."
    stdout = out.decode("utf-8", "replace").strip()
    stderr = err.decode("utf-8", "replace").strip()
    if proc.returncode != 0:
        return f"RStack {tool} failed: {(stderr or stdout or f'exit {proc.returncode}')}"
    return _extract_text(stdout)


def _make_handler(tool: str, config_env: dict):
    async def handler(**kwargs: Any) -> ToolResult:
        cwd = os.getcwd()
        params = {k: v for k, v in kwargs.items() if v is not None}
        text = await _run_bridge(tool, params, cwd, config_env)
        return ToolResult.success_result(text)
    return handler


# ── enforcement guard (mirrors the Tau/Hermes adapters + #371 fail-closed policy) ─

def _guard_fail_open() -> bool:
    return os.environ.get("RSTACK_GUARD_FAIL_OPEN") == "1"


def _resolve_guard_argv(cwd: str) -> tuple[Optional[list], bool]:
    """(argv_prefix, needs_network). Prefer a resolved local rstack-agents binary
    (no network) over `npx --yes` (may hit the registry on a cold cache).
    (None, _) means the guard cannot run at all."""
    binname = "rstack-agents.cmd" if os.name == "nt" else "rstack-agents"
    for base in (cwd, str(PKG_ROOT)):
        candidate = Path(base) / "node_modules" / ".bin" / binname
        if candidate.is_file():
            return ([str(candidate)], False)
    resolved = shutil.which("rstack-agents")
    if resolved:
        return ([resolved], False)
    npx = shutil.which("npx")
    if npx:
        return ([npx, "--yes", "rstack-agents"], True)
    return (None, False)


def _guard_unavailable_reason(detail: str) -> Optional[str]:
    if _guard_fail_open():
        print(f"[rstack] guard unavailable ({detail}); RSTACK_GUARD_FAIL_OPEN=1 — allowing WITHOUT enforcement", flush=True)
        return None
    return (
        f"RStack guard is UNAVAILABLE ({detail}) — failing closed so enforcement is not silently skipped. "
        "Run `rstack-agents doctor`, or set RSTACK_GUARD_FAIL_OPEN=1 to allow tool calls without enforcement."
    )


async def _run_guard(tool_name: str, tool_input: dict, cwd: str) -> Optional[str]:
    """Classify one pending tool call via `rstack-agents guard`. Returns a block
    reason string, or None to allow. Fails CLOSED on a guard that cannot run,
    unless RSTACK_GUARD_FAIL_OPEN=1 (#371)."""
    argv, _needs_net = _resolve_guard_argv(cwd)
    if argv is None:
        return _guard_unavailable_reason("no rstack-agents binary and no npx on PATH")
    payload = json.dumps({"tool_name": tool_name, "tool_input": tool_input})
    try:
        proc = await asyncio.create_subprocess_exec(
            *argv, "guard", "--context", "builder", "--project", cwd,
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            env=os.environ, cwd=cwd,
        )
        out, err = await asyncio.wait_for(proc.communicate(payload.encode("utf-8")), timeout=_GUARD_TIMEOUT_S)
    except asyncio.TimeoutError:
        return _guard_unavailable_reason("guard timed out")
    except OSError as exc:
        return _guard_unavailable_reason(f"could not spawn guard: {exc}")
    if proc.returncode == 0:
        return None  # allow
    if proc.returncode == 2:
        return (err.decode("utf-8", "replace").strip() or out.decode("utf-8", "replace").strip()
                or "RStack guard blocked this tool call.")
    # Any OTHER exit = guard could not decide (crash/module-load/cold-npx miss).
    return _guard_unavailable_reason(err.decode("utf-8", "replace").strip() or out.decode("utf-8", "replace").strip()
                                      or f"exit {proc.returncode}")


def _launch_business_hub() -> None:
    """Bring the Business Hub live when the plugin is constructed.

    Same contract as the other adapters: health-check :3008, spawn detached if
    down, open the browser. Best-effort — never blocks or fails construction.
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


# ── plugin ────────────────────────────────────────────────────────────────────

class RStackPlugin(Plugin):
    """The real operator_use.plugins.Plugin subclass. See bootstrap.py for why
    this can't just be dropped into a config file like the Tau/Hermes adapters."""

    name = "rstack-sdlc"

    def __init__(self, config: Optional[dict] = None):
        cfg = config or {}
        self._config_env = {env: str(cfg[key]) for key, env in _CONFIG_ENV.items() if cfg.get(key) is not None}
        _launch_business_hub()

    def get_tools(self) -> list:
        return [
            Tool(name=name, description=description, model=model)(_make_handler(name, self._config_env))
            for name, (description, model) in _TOOLS.items()
        ]

    def register_hooks(self, hooks: Any) -> None:
        hooks.register(HookEvent.BEFORE_TOOL_CALL, self._before_tool_call)
        hooks.register(HookEvent.AFTER_TOOL_CALL, self._after_tool_call)

    def unregister_hooks(self, hooks: Any) -> None:
        hooks.unregister(HookEvent.BEFORE_TOOL_CALL, self._before_tool_call)
        hooks.unregister(HookEvent.AFTER_TOOL_CALL, self._after_tool_call)

    async def _before_tool_call(self, ctx: "BeforeToolCallContext") -> None:
        """Destructive-action gate. ctx.tool_call.name/.params are the real
        fields (providers/events.py ToolCall) — verified against
        agent/service.py _execute_tool, which reads exactly these."""
        mapping = _GUARDED_TOOLS.get(ctx.tool_call.name)
        if mapping is None:
            return
        guard_tool_name, src_field, dst_field = mapping
        params = ctx.tool_call.params or {}
        tool_input = {dst_field: params.get(src_field)} if src_field in params else dict(params)
        reason = await _run_guard(guard_tool_name, tool_input, os.getcwd())
        if reason is not None:
            ctx.skip = True
            ctx.result = ToolResult.error_result(reason)

    async def _after_tool_call(self, ctx: "AfterToolCallContext") -> None:
        """Best-effort observability -> Business Hub. Never raises."""
        npx = shutil.which("npx")
        if npx is None:
            return
        try:
            payload = json.dumps({
                "tool_name": ctx.tool_call.name,
                "hook_event_name": "PostToolUse",
                "content": ctx.content,
                "is_error": not ctx.tool_result.success,
            })
            proc = await asyncio.create_subprocess_exec(
                npx, "--yes", "rstack-agents", "observe", "--source", "operator", "--project", os.getcwd(),
                stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
            )
            await asyncio.wait_for(proc.communicate(payload.encode("utf-8")), timeout=5.0)
        except Exception:
            pass  # observability is additive — never disrupt an Operator session
