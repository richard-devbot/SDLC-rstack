"""RStack SDLC — Tau adapter.

Contributed by Jeomon (https://github.com/Jeomon) — thank you! This file is
his community Tau adapter, adopted with the bridge path updated to the
generic bin/rstack-bridge.ts and the tool surface synced to the Pi adapter
registry (the conformance contract in docs/integrations/adapter-contract.md).

Tau (https://github.com/Jeomon/Tau) is a Python agent framework and terminal
coding assistant with the same extension shape as Operator: a plain Python
file exporting `register(tau)`, Pydantic-schema tools, and a `tool_call`
event hook that can block execution before it happens. This adapter reuses
that shape twice:

  1. Every `sdlc_*` tool shells out to the Node bridge
     (bin/rstack-bridge.ts), which reuses the existing TypeScript adapter
     and harness verbatim — no SDLC logic is reimplemented in Python.
  2. Tau's built-in `terminal` / `write` / `edit` tools are routed through
     `rstack-agents guard` on the `tool_call` hook, the same framework-neutral
     enforcement gate Claude Code wires via PreToolUse (destructive-action
     gate + validator sandbox — see docs/integrations/wire-your-own-harness.md).
     Tau's `ToolCallEventResult(block=True, ...)` return value is exactly the
     "cancel before execution" mechanism that guard wiring needs, so — unlike
     Operator or Claude Code — no host-side hook config is required; loading
     this extension is the wiring.
  3. Observability (#251): Tau's post-execution `tool_result` hook feeds
     `rstack-agents observe`, which appends a normalized `tool_result` event to
     the active run's events.jsonl (the same shape Pi writes, source="tau") so
     the Business Hub mirrors Tau terminal activity. The pre-execution
     `tool_call` hook also emits a `tool_call` INTENT event even when a call is
     allowed, so activity shows in the dashboard even if the call is later
     blocked. Both are best-effort and can never disrupt a Tau session.
  4. Full hook-event coverage (#255): Tau's `before_compaction` hook feeds a
     `context_preserved` event, and its `tool_execution_failure` hook feeds an
     error `tool_result` — both fire-and-forget via `_observe_bg`. Context
     injection uses Tau's `before_agent_start` hook: it fetches the RStack
     context packet (`rstack-agents context`) and prepends it to the turn's
     system prompt so a Tau agent is RStack-aware, the analog of Claude Code's
     UserPromptSubmit/SessionStart context hooks. It is best-effort with a hard
     timeout and returns no override on any failure — it can never block a turn.
  5. Opt-in quality gates (#256): when the `quality_gates` extension setting (or
     RSTACK_TAU_GATES env) names presets (plan-gate/tdd-gate/scope-guard), the
     `tool_call` hook runs each via `rstack-agents gate <name>` on write/edit
     tools AFTER guard. OFF by default. Only tdd-gate ever blocks (exit 2), and
     it is always overridable (RSTACK_ALLOW_NO_TESTS=1 or an audited approval),
     so a gate can never dead-end a session.

Tau events RStack does NOT wire (they do not exist in Tau's hook model):
  - There is no delegated-SUBAGENT lifecycle event. Tau's `agent_start` /
    `agent_end` are the per-prompt engine loop, not spawned specialists, so no
    `subagent_started` / `subagent_stopped` events are emitted on Tau. (On Pi
    delegation is observed directly; on Claude Code the SubagentStart/Stop hooks
    cover it.)
  - There is no NOTIFICATION event. Tau surfaces messages through its own TUI,
    so the `rstack-agents notify-hook` relay is not wired here; a Tau user who
    wants channel notifications drives them from RStack stage events instead.

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

owner: RStack developed by Richardson Gunde; Tau adapter contributed by Jeomon
"""
from __future__ import annotations

import asyncio
import json
import os
import shutil
import sys
from pathlib import Path
from typing import Literal, Optional

from pydantic import BaseModel, Field

from tau.hooks import BeforeAgentStartEventResult, ToolCallEventResult
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

# Opt-in quality gates (#256). OFF by default; enabled via the extension setting
# `quality_gates` (comma string or list of plan-gate|tdd-gate|scope-guard) or the
# RSTACK_TAU_GATES env. Only file-write/edit tools are gated (not `terminal`).
_GATE_TOOL_MAP = {
    "write": ("Write", "path"),
    "edit": ("Edit", "path"),
}
_KNOWN_GATES = ("plan-gate", "tdd-gate", "scope-guard")


def _resolve_gates() -> list[str]:
    """Ordered, de-duped list of enabled quality-gate presets. Env/settings both
    accepted; unknown names dropped. Returns [] when gates are off (the default)."""
    raw = os.environ.get("RSTACK_TAU_GATES", "")
    wanted = {g.strip().lower() for g in raw.split(",") if g.strip()}
    # Normalize short aliases (tdd → tdd-gate, scope → scope-guard).
    normalized: set[str] = set()
    for g in wanted:
        if g in _KNOWN_GATES:
            normalized.add(g)
        elif g == "scope":
            normalized.add("scope-guard")
        elif g in ("plan", "tdd"):
            normalized.add(f"{g}-gate")
    return [g for g in _KNOWN_GATES if g in normalized]


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
    "sdlc_decisions": ("List or add run-level decisions that must be resolved before later SDLC stages.", DecisionsParams),
    "sdlc_decide": ("Resolve or waive a pending Decision Queue item.", DecideParams),
    "sdlc_dor_check": ("Evaluate unresolved decisions and write dor-report.json/readiness.json for the selected run.", DorCheckParams),
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


def _guard_fail_open() -> bool:
    """#371: fail CLOSED by default when the guard cannot RUN; opt back into the
    legacy fail-OPEN with RSTACK_GUARD_FAIL_OPEN=1. Mirrors the JS guard policy
    (src/commands/guard.js guardFailOpen) so enforcement behaves the same way on
    every harness."""
    return os.environ.get("RSTACK_GUARD_FAIL_OPEN") == "1"


def _guard_timeout_s() -> float:
    """Hard bound on a single guard invocation (RSTACK_GUARD_TIMEOUT_MS, default
    15s) so a hung `npx`/guard process can never stall a Tau tool call."""
    try:
        return max(1.0, float(os.environ.get("RSTACK_GUARD_TIMEOUT_MS", "15000")) / 1000.0)
    except (TypeError, ValueError):
        return 15.0


def _resolve_guard_argv(cwd: str) -> tuple[Optional[list[str]], bool]:
    """Resolve how to invoke `rstack-agents`, PREFERRING a locally-installed
    binary (no network) over `npx --yes` (which may hit the registry on a cold
    cache). Returns (argv_prefix, needs_network); (None, False) means the guard
    cannot be invoked at all. (#371)"""
    binary = "rstack-agents.cmd" if os.name == "nt" else "rstack-agents"
    for base in (cwd, str(PKG_ROOT)):
        candidate = Path(base) / "node_modules" / ".bin" / binary
        if candidate.is_file():
            return ([str(candidate)], False)
    on_path = shutil.which("rstack-agents")
    if on_path:
        return ([on_path], False)
    npx = shutil.which("npx")
    if npx:
        return ([npx, "--yes", "rstack-agents"], True)
    return (None, False)


def _guard_unavailable(detail: str) -> tuple[bool, str]:
    """Verdict when the guard COULD NOT RUN (spawn failure, timeout, crash, or a
    cold-npx registry miss). Fails closed by default so enforcement is never
    silently skipped; RSTACK_GUARD_FAIL_OPEN=1 restores the legacy allow, with a
    loud warning so the skipped enforcement is never invisible. (#371)"""
    if _guard_fail_open():
        print(
            f"[rstack] WARNING: guard unavailable ({detail}); RSTACK_GUARD_FAIL_OPEN=1 — "
            "allowing this tool call WITHOUT enforcement.",
            file=sys.stderr,
        )
        return True, ""
    return False, (
        f"RStack guard is UNAVAILABLE ({detail}) — failing closed so enforcement is not "
        "silently skipped. Run `rstack-agents doctor` to fix the guard, or set "
        "RSTACK_GUARD_FAIL_OPEN=1 to allow tool calls without enforcement."
    )


async def _run_guard(guard_tool_name: str, tool_input: dict, cwd: str) -> tuple[bool, str]:
    """Classify one pending tool call via `rstack-agents guard`.

    Exit-code contract (#371): 0 = ALLOW, 2 = BLOCK. ANY other outcome — a
    non-0/2 exit (crash, module-load error, cold-`npx` registry miss), a
    timeout, or a spawn failure — means the guard could not decide, so it is
    UNAVAILABLE and fails closed by default (see _guard_unavailable). This fixes
    the old "any exit != 2 = allow" behavior, under which a partial install or an
    offline cold cache would silently disable enforcement with no signal.
    """
    argv_prefix, _needs_network = _resolve_guard_argv(cwd)
    if argv_prefix is None:
        return _guard_unavailable("no rstack-agents binary and no npx on PATH")

    payload = json.dumps({"tool_name": guard_tool_name, "tool_input": tool_input}).encode("utf-8")
    argv = [*argv_prefix, "guard", "--context", "builder", "--project", cwd]
    try:
        proc = await asyncio.create_subprocess_exec(
            *argv,
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            env=os.environ, cwd=cwd,
        )
    except OSError as exc:
        return _guard_unavailable(f"could not spawn guard: {exc}")

    try:
        out, err = await asyncio.wait_for(proc.communicate(payload), timeout=_guard_timeout_s())
    except asyncio.TimeoutError:
        try:
            proc.kill()
        except ProcessLookupError:
            pass
        return _guard_unavailable("guard timed out")

    if proc.returncode == 0:
        return True, ""
    if proc.returncode == 2:
        reason = (
            err.decode("utf-8", "replace").strip()
            or out.decode("utf-8", "replace").strip()
            or "RStack guard blocked this tool call."
        )
        return False, reason
    # Any OTHER exit code = the guard ran abnormally (crash / module-load error /
    # cold npx registry miss). Do NOT read it as allow.
    detail = (
        err.decode("utf-8", "replace").strip()
        or out.decode("utf-8", "replace").strip()
        or f"exit {proc.returncode}"
    )
    return _guard_unavailable(detail)


async def _run_gate(gate_name: str, guard_tool_name: str, tool_input: dict, cwd: str) -> tuple[bool, str]:
    """Run one OPT-IN quality gate via `rstack-agents gate <name>` (#256).

    Same contract as _run_guard: exit 2 blocks (returns False + reason), any
    other exit allows. Only tdd-gate ever blocks; it is always overridable
    (RSTACK_ALLOW_NO_TESTS=1 or an audited approval), so this can never
    dead-end a session. Fails OPEN when npx is unreachable.
    """
    npx = shutil.which("npx")
    if npx is None:
        return True, ""
    payload = json.dumps({"tool_name": guard_tool_name, "tool_input": tool_input}).encode("utf-8")
    proc = await asyncio.create_subprocess_exec(
        npx, "--yes", "rstack-agents", "gate", gate_name, "--project", cwd,
        stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        env=os.environ, cwd=cwd,
    )
    out, err = await proc.communicate(payload)
    if proc.returncode == 2:
        reason = (
            err.decode("utf-8", "replace").strip()
            or out.decode("utf-8", "replace").strip()
            or f"RStack {gate_name} blocked this tool call."
        )
        return False, reason
    return True, ""


# Background observe tasks — kept referenced so the event loop can't GC them
# mid-flight; discarded on completion. (#253)
_OBSERVE_TASKS: set = set()


async def _emit_observation(payload: dict, cwd: str) -> None:
    """Feed one observability event to `rstack-agents observe` (#251).

    Best-effort and completely non-disruptive: `observe` always exits 0, no-ops
    when there is no active run, and redacts secrets. We swallow every error and
    bound the subprocess with a hard timeout so a slow/hung write can never
    stall — this coroutine is only ever scheduled fire-and-forget (see
    `_observe_bg`), so it is off the tool-call critical path entirely.
    """
    npx = shutil.which("npx")
    if npx is None:
        return
    try:
        proc = await asyncio.create_subprocess_exec(
            npx, "--yes", "rstack-agents", "observe", "--source", "tau", "--project", cwd,
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
            env=os.environ, cwd=cwd,
        )
        await asyncio.wait_for(proc.communicate(json.dumps(payload).encode("utf-8")), timeout=5.0)
    except Exception:
        pass  # observability is additive — never let it break a session


def _observe_bg(payload: dict, cwd: str) -> None:
    """Schedule an observation WITHOUT awaiting it — keeps observe off the
    tool-call critical path so a slow write never adds latency to a Tau call.
    Falls back to a no-op if there is no running event loop. (#253)"""
    try:
        task = asyncio.ensure_future(_emit_observation(payload, cwd))
        _OBSERVE_TASKS.add(task)
        task.add_done_callback(_OBSERVE_TASKS.discard)
    except Exception:
        pass  # never let scheduling failure surface in a session


async def _fetch_context(cwd: str) -> str:
    """Fetch the RStack context packet via `rstack-agents context` (#255).

    Returns the `additionalContext` string, or "" when there is no active run,
    no context, or anything goes wrong. Best-effort and hard-timeout-bounded:
    this runs on the before_agent_start critical path, so it must never block a
    turn — every failure path returns "" and the turn proceeds unchanged.
    """
    npx = shutil.which("npx")
    if npx is None:
        return ""
    try:
        proc = await asyncio.create_subprocess_exec(
            npx, "--yes", "rstack-agents", "context", "--source", "tau", "--project", cwd,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
            env=os.environ, cwd=cwd,
        )
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=5.0)
    except Exception:
        return ""  # context is additive — never let it break or delay a turn
    text = out.decode("utf-8", "replace").strip()
    if not text:
        return ""
    try:
        data = json.loads(text)
        ctx = data.get("hookSpecificOutput", {}).get("additionalContext", "")
        return str(ctx) if ctx else ""
    except Exception:
        return ""


def _emit(ctx, text: str, level: str = "info") -> None:
    if getattr(ctx, "ui", None) is not None:
        ctx.ui.notify(text, level)
    else:
        print(text)


# Slash-command subcommand name -> full `sdlc_*` tool name (e.g. "start" -> "sdlc_start").
_SUBCOMMANDS: dict[str, str] = {name[len("sdlc_"):]: name for name in _TOOLS}

# For tools whose params model has one obvious free-text field, `/sdlc <sub> <text>`
# (no JSON) maps `<text>` onto that field. Tools not listed here require `{...}` JSON.
_PRIMARY_FIELD: dict[str, str] = {
    "sdlc_start": "goal",
    "sdlc_spec": "artifact",
    "sdlc_approve": "artifact",
    "sdlc_validate": "task_id",
    "sdlc_agents": "domain",
    "sdlc_memory": "action",
    "sdlc_dashboard": "run_id",
    "sdlc_trace": "task_id",
    "sdlc_rollback": "stage_id",
    "sdlc_decisions": "question",
    "sdlc_decide": "decision_id",
    "sdlc_dor_check": "target_stage",
    "sdlc_orchestrate": "goal",
    "sdlc_status": "run_id",
}


def _sdlc_argument_completions(text: str) -> list:
    """Subcommand-name completions for `/sdlc <tab>`; mirrors the peer extension's pattern."""
    from tau.tui.autocomplete import AutocompleteItem

    parts = text.split()
    if not parts or (len(parts) == 1 and not text.endswith(" ")):
        prefix = parts[0] if parts else ""
        return [
            AutocompleteItem(label=short, description=_TOOLS[full][0])
            for short, full in sorted(_SUBCOMMANDS.items())
            if short.startswith(prefix)
        ]
    return []


def register(tau) -> None:
    cfg = tau.config or {}
    config_env = {
        env: str(cfg[key]) for key, env in _CONFIG_ENV.items() if cfg.get(key) is not None
    }

    for name, (description, model) in _TOOLS.items():
        tau.register_tool(_BridgeTool(name, description, model, config_env))

    # Opt-in quality gates (#256): a `quality_gates` extension setting is merged
    # into RSTACK_TAU_GATES so `_resolve_gates()` (env-driven) sees it. OFF
    # unless configured — the default returns [] and the tool_call hook below
    # runs guard only, exactly as before.
    _gates_setting = cfg.get("quality_gates")
    if _gates_setting is not None:
        if isinstance(_gates_setting, (list, tuple)):
            os.environ["RSTACK_TAU_GATES"] = ",".join(str(g) for g in _gates_setting)
        else:
            os.environ["RSTACK_TAU_GATES"] = str(_gates_setting)
    enabled_gates = _resolve_gates()

    async def _sdlc_command(ctx, args: list[str]) -> None:
        if not args:
            _emit(
                ctx,
                "Usage: /sdlc <subcommand> [text | {json}]\n"
                f"Subcommands: {', '.join(sorted(_SUBCOMMANDS))}",
            )
            return

        short = args[0]
        tool_name = _SUBCOMMANDS.get(short)
        if tool_name is None:
            _emit(ctx, f"Unknown sdlc subcommand '{short}'. Try: {', '.join(sorted(_SUBCOMMANDS))}", "error")
            return

        rest = " ".join(args[1:]).strip()
        params: dict = {}
        if rest.startswith("{"):
            try:
                params = json.loads(rest)
            except json.JSONDecodeError as exc:
                _emit(ctx, f"Invalid JSON params for /sdlc {short}: {exc}", "error")
                return
        elif rest:
            field = _PRIMARY_FIELD.get(tool_name)
            if field is None:
                _emit(ctx, f"'/sdlc {short}' needs JSON params, e.g. /sdlc {short} {{\"run_id\": \"...\"}}", "error")
                return
            params = {field: rest}

        cwd = str(getattr(ctx, "cwd", None) or os.getcwd())
        result = await _run_bridge(tool_name, params, cwd, f"sdlc-cmd-{short}", config_env)
        _emit(ctx, result.content, "error" if result.is_error else "info")

    tau.register_command(
        "sdlc",
        "Run an RStack SDLC subcommand (start, plan, status, approve, ...).",
        _sdlc_command,
        get_argument_completions=_sdlc_argument_completions,
        argument_hint="<subcommand> [text | {json}]",
    )

    @tau.on("tool_call")
    async def _rstack_guard(event, ctx):
        # Observability (#251): emit a tool_call INTENT event for every tool so
        # activity reaches the Business Hub even when the call is subsequently
        # blocked. Fire-and-forget (#253) — scheduled off the critical path so a
        # slow observe write can never delay the guard verdict or the tool call.
        _observe_bg(
            {"tool_name": event.tool_name, "tool_input": event.input or {}, "hook_event_name": "PreToolUse"},
            str(ctx.cwd),
        )

        mapping = _GUARD_TOOL_MAP.get(event.tool_name)
        if mapping is None:
            return None
        guard_tool_name, field = mapping
        tool_input = {field: (event.input or {}).get(field, "")}
        allowed, reason = await _run_guard(guard_tool_name, tool_input, str(ctx.cwd))
        if not allowed:
            return ToolCallEventResult(block=True, reason=reason)

        # Opt-in quality gates (#256): run AFTER guard, only on file-write/edit
        # tools, only when enabled. Only tdd-gate ever blocks (exit 2), and it is
        # always overridable — never a dead-end. plan/scope warn on stderr (which
        # the model does not see here) and exit 0, so they pass through silently.
        if enabled_gates:
            gate_mapping = _GATE_TOOL_MAP.get(event.tool_name)
            if gate_mapping is not None:
                gate_tool_name, gate_field = gate_mapping
                gate_input = {gate_field: (event.input or {}).get(gate_field, "")}
                for gate_name in enabled_gates:
                    ok, gate_reason = await _run_gate(gate_name, gate_tool_name, gate_input, str(ctx.cwd))
                    if not ok:
                        return ToolCallEventResult(block=True, reason=gate_reason)
        return None

    @tau.on("tool_result")
    async def _rstack_observe_result(event, ctx):
        # Post-execution observability (#251): Tau exposes a real tool_result
        # hook, so we record the outcome (source="tau") exactly like Pi's
        # tool_result event. Fire-and-forget (#253) — off the critical path, so
        # the result is returned immediately and a slow write adds no latency.
        _observe_bg(
            {
                "tool_name": event.tool_name,
                "hook_event_name": "PostToolUse",
                "content": event.content,
                "is_error": bool(getattr(event, "is_error", False)),
            },
            str(ctx.cwd),
        )
        return None

    @tau.on("tool_execution_failure")
    async def _rstack_observe_failure(event, ctx):
        # Tool crashed (uncaught exception, distinct from a returned error): record
        # an error tool_result so failures show in the Business Hub feed. (#255)
        # Fire-and-forget — off the critical path, never disrupts the session.
        _observe_bg(
            {
                "tool_name": getattr(event, "tool_name", "") or "",
                "hook_event_name": "PostToolUseFailure",
                "content": getattr(event, "error", "") or "",
                "is_error": True,
            },
            str(ctx.cwd),
        )
        return None

    @tau.on("before_compaction")
    async def _rstack_observe_compaction(event, ctx):
        # Context is about to be trimmed — record a context_preserved event
        # (ties to the context-pressure work). trigger mirrors Claude Code's
        # PreCompact "manual"/"auto". (#255) Fire-and-forget.
        trigger = "manual" if bool(getattr(event, "manual", False)) else "auto"
        _observe_bg(
            {"hook_event_name": "PreCompact", "trigger": trigger},
            str(ctx.cwd),
        )
        return None

    @tau.on("before_agent_start")
    async def _rstack_inject_context(event, ctx):
        # Context injection (#255): the analog of Claude Code's
        # UserPromptSubmit/SessionStart context hooks. Fetch the RStack packet
        # and prepend it to this turn's system prompt so the Tau agent is
        # RStack-aware. Best-effort + hard-timeout-bounded (see _fetch_context):
        # any failure returns no override and the turn proceeds unchanged. This
        # hook can NEVER block a turn — it only augments the system prompt.
        try:
            packet = await _fetch_context(str(ctx.cwd))
        except Exception:
            return None
        if not packet:
            return None
        base = getattr(event, "system_prompt", "") or ""
        combined = f"{packet}\n\n{base}" if base else packet
        return BeforeAgentStartEventResult(system_prompt=combined)
