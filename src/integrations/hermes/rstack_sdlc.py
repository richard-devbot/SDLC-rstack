"""RStack SDLC — Hermes adapter (#375, corrected in #390).

Hermes (Nous Research, https://github.com/NousResearch/hermes-agent) loads this
as a **plugin**: a directory containing both ``plugin.yaml`` (a manifest —
required; the loader silently skips any directory without one, see
hermes_cli/plugins.py) and an ``__init__.py`` that exposes ``register(ctx)``,
installed into ``~/.hermes/plugins/<name>/`` and enabled via that project's
``plugins.enabled`` allow-list (or ``hermes plugins enable rstack-sdlc``).
This adapter exposes the same ``sdlc_*`` tool surface as the Pi adapter and
wires the enforcement guard, exactly like the Tau and Operator adapters — no
SDLC logic is reimplemented in Python. Every tool shells out to the generic
Node bridge (bin/rstack-bridge.ts). Conformance contract:
docs/integrations/adapter-contract.md.

Why the bridge pattern fits Hermes cleanly — and the #390 correction:
  - ``ctx.register_tool(name, toolset, schema, handler)`` registers each tool
    (verified against tools/registry.py — sync handler contract confirmed
    correct, Hermes turns already run off the main event loop so a blocking
    subprocess call inside a handler is fine).
  - ``ctx.register_hook("pre_tool_call", fn)`` IS a real blocking gate, but
    NOT via the shape the adapter originally assumed. A #390 audit found the
    Claude-Code-style ``{"decision": "block", "reason": ...}`` shape (the
    previous return value here) is real, but for a DIFFERENT subsystem —
    Hermes' external shell-hooks bridge (agent/shell_hooks.py) — not the
    Python-plugin ``pre_tool_call`` path this adapter actually uses. The
    real dispatcher (hermes_cli/plugins.py
    ``_get_pre_tool_call_directive_details``) reads ``result.get("action")``
    and requires ``"block"``/``"approve"`` plus a non-empty ``"message"``;
    a dict shaped ``{"decision", "reason"}`` has ``action == None`` and is
    silently ignored. **This means the guard fired on every call but never
    actually blocked anything until this fix** — worse than a loud failure,
    since a manual smoke test would show the hook running without any
    obvious sign the block was discarded. Verified live: constructing a
    real ``PluginManager``, loading this plugin for real, and calling
    ``get_pre_tool_call_directive`` directly reproduced the bug (returned
    allow for a destructive command) before the fix, and blocks correctly
    after it.

Requirements on the host:
  - node + npx on PATH
  - ``npm install`` has been run once in the rstack-agents package directory

Optional settings (Hermes plugin config, or env):
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

import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any, Optional

PKG_ROOT = Path(__file__).resolve().parents[3]  # src/integrations/hermes/ -> package root
BRIDGE = PKG_ROOT / "bin" / "rstack-bridge.ts"

# Hermes plugin setting -> environment variable consumed by the TS harness.
_CONFIG_ENV = {
    "worker_command": "RSTACK_WORKER_COMMAND",
    "default_model": "RSTACK_DEFAULT_MODEL",
    "escalated_model": "RSTACK_ESCALATED_MODEL",
    "slack_webhook": "RSTACK_SLACK_WEBHOOK",
    "state_dir": "RSTACK_STATE_DIR",
    "allow_destructive": "RSTACK_ALLOW_DESTRUCTIVE",
}

# Host tool call timeout (seconds) for the bridge + guard subprocesses.
_BRIDGE_TIMEOUT_S = float(os.environ.get("RSTACK_BRIDGE_TIMEOUT_MS", "60000")) / 1000.0
_GUARD_TIMEOUT_S = float(os.environ.get("RSTACK_GUARD_TIMEOUT_MS", "15000")) / 1000.0

# JSON-schema fragments reused across tools.
_STR = {"type": "string"}
_OPT_RUN = {"run_id": {"type": "string", "description": "Target run id (defaults to the session/pinned/newest run)."}}


def _obj(properties: dict, required: Optional[list] = None) -> dict:
    schema: dict = {"type": "object", "properties": properties}
    if required:
        schema["required"] = required
    return schema


# name -> (description, JSON-schema `parameters`). The dict maps each tool name
# to a tuple; tests/bridge-conformance.test.js parses those name->tuple entries
# to prove this adapter's tool surface matches the Pi registry exactly
# (adapter-contract §1/§6). Parameters mirror the Pi typebox / Tau Pydantic schemas.
_TOOLS: dict[str, tuple[str, dict]] = {
    "sdlc_orchestrate": (
        "Load the RStack orchestrator, builder, and validator agent instructions into the active task. Use before coding with RStack.",
        _obj({"goal": {"type": "string", "description": "Goal to orchestrate."}}),
    ),
    "sdlc_start": (
        "Start a clean .rstack/runs lifecycle for building, testing, validating, and shipping software with agent teams.",
        _obj({
            "goal": {"type": "string", "description": "Software goal, feature, app, bug fix, or release objective."},
            "mode": {"type": "string", "enum": ["interactive", "express"], "description": "Run mode."},
        }, ["goal"]),
    ),
    "sdlc_clarify": (
        "Capture product-owner answers before planning so RStack does not guess important requirements.",
        _obj({**_OPT_RUN, "answers": {"type": "array", "items": _STR, "description": "Product-owner answers to append to context.md."}}),
    ),
    "sdlc_plan": (
        "Create a full software lifecycle plan and task graph for the active RStack run.",
        _obj({**_OPT_RUN, "constraints": {"type": "array", "items": _STR}, "domains": {"type": "array", "items": _STR}}),
    ),
    "sdlc_spec": (
        "Read or update a specific SDLC artifact (vision, requirements, architecture, etc.) in the run specs directory.",
        _obj({
            **_OPT_RUN,
            "artifact": {"type": "string", "description": "Artifact or stage id to read/update."},
            "action": {"type": "string", "enum": ["read", "update"], "description": "Read or update (default read)."},
            "content": {"type": "string", "description": "New content when action=update."},
            "trace_mapping": {"type": "object", "description": "Traceability mapping, e.g. {requirement_id:'R1', design_id:'D1'}."},
        }),
    ),
    "sdlc_approve": (
        "Capture human approval or rejection for a specific artifact or SDLC stage.",
        _obj({
            **_OPT_RUN,
            "artifact": {"type": "string", "description": "Artifact or stage id being approved (e.g. 'architecture.md' or '002-requirements')."},
            "status": {"type": "string", "enum": ["APPROVED", "REJECTED"]},
            "comments": {"type": "string"},
            "approver": {"type": "string", "description": "Who approved (defaults to the resolved user identity)."},
        }, ["artifact", "status"]),
    ),
    "sdlc_build_next": (
        "Prepare the next pending builder task with specialist context and an output contract.",
        _obj({**_OPT_RUN}),
    ),
    "sdlc_validate": (
        "Validate an RStack task contract and produce a read-only validation report.",
        _obj({**_OPT_RUN, "task_id": {"type": "string"}}),
    ),
    "sdlc_agents": (
        "List RStack package-local and project-local agents/skills by domain for routing and team assembly.",
        _obj({
            "kind": {"type": "string", "enum": ["agent", "skill", "plugin"]},
            "domain": {"type": "string"},
            "limit": {"type": "integer"},
        }),
    ),
    "sdlc_delegate": (
        "Spawn one or more RStack agents as isolated worker subprocesses. Supports single or bounded parallel delegation. Validators default to read-only.",
        _obj({
            "agent": {"type": "string", "description": "Agent name or id for single mode."},
            "task": {"type": "string", "description": "Task for single mode."},
            "tasks": {"type": "array", "items": {"type": "object"}, "description": "Parallel tasks: {agent, task, cwd?, tools?}."},
            "concurrency": {"type": "integer"},
        }),
    ),
    "sdlc_status": (
        "Show active RStack run status, task progress, registry counts, and next recommended action.",
        _obj({**_OPT_RUN}),
    ),
    "sdlc_memory": (
        "Search or append RStack project learnings used by future SDLC runs.",
        _obj({
            "action": {"type": "string", "enum": ["search", "append"]},
            "query": {"type": "string"},
            "learning": {"type": "string", "description": "Learning text to append when action=append."},
        }),
    ),
    "sdlc_dashboard": (
        "Generate a static HTML dashboard for an RStack run and open it in the browser.",
        _obj({**_OPT_RUN}),
    ),
    "sdlc_trace": (
        "Deep-dive trace view of tool calls and results for a single task.",
        _obj({**_OPT_RUN, "task_id": {"type": "string", "description": "Task id (e.g. 001-product-clarification) to trace."}}),
    ),
    "sdlc_rollback": (
        "Rollback the specified SDLC stage to its last recorded checkpoint, restoring directory state.",
        _obj({**_OPT_RUN, "stage_id": {"type": "string", "description": "Stage id (e.g. 00-environment) to rollback."}}, ["stage_id"]),
    ),
    "sdlc_decisions": (
        "List or add run-level decisions that must be resolved before later SDLC stages.",
        _obj({
            **_OPT_RUN,
            "question": {"type": "string", "description": "When provided, add this as a pending decision."},
            "impact": {"type": "string", "enum": ["architecture", "security", "budget", "scope", "delivery"]},
            "required_before_stage": {"type": "string", "description": "Canonical stage that requires this decision first."},
            "recommendation": {"type": "string"},
            "owner": {"type": "string"},
        }),
    ),
    "sdlc_decide": (
        "Resolve or waive a pending Decision Queue item.",
        _obj({
            **_OPT_RUN,
            "decision_id": {"type": "string"},
            "status": {"type": "string", "enum": ["resolved", "waived"]},
            "resolution": {"type": "string"},
            "resolved_by": {"type": "string"},
        }, ["decision_id", "resolution"]),
    ),
    "sdlc_dor_check": (
        "Evaluate unresolved decisions and write dor-report.json/readiness.json for the selected run.",
        _obj({**_OPT_RUN, "target_stage": {"type": "string", "description": "Canonical stage to check readiness for."}}),
    ),
}

# Hermes built-in tool name -> (guard tool_name, the input field carrying the
# shell command or write-target path). Read-only tools are absent (they skip
# the guard).
#
# #390 CORRECTION: this used to map straight to the input field only, so the
# RAW Hermes tool name (e.g. "terminal") was sent to `rstack-agents guard` as
# `tool_name`. The classifier's tool-name dispatch
# (src/core/harness/destructive-actions.js classifyDestructiveAction) only
# recognizes `bash`/`shell`/`powershell`/`pwsh`/`cmd` for shell commands and a
# fixed WRITE_TOOLS set (`write`, `edit`, `applypatch`, `strreplace`, ...) for
# writes — "terminal" (Hermes' real tool name, confirmed via a live plugin
# load) matches NEITHER, so every call silently classified as
# "non-destructive" regardless of the fixed block-payload shape. Live-verified
# via a real npx guard invocation: `{"tool_name":"terminal","tool_input":
# {"command":"rm -rf ..."}}` returned `{"decision":"allow","reason":
# "non-destructive action"}`. Translating to the guard's own canonical names
# below (mirrors the Tau adapter's `_GUARDED_BUILTINS`) fixes it.
_GUARDED_TOOLS = {
    "terminal": ("Bash", "command"),
    "bash": ("Bash", "command"),
    "shell": ("Bash", "command"),
    "write": ("Write", "path"),
    "write_file": ("Write", "path"),
    "edit": ("Edit", "path"),
    "edit_file": ("Edit", "path"),
    "str_replace": ("Edit", "path"),
    "apply_patch": ("Edit", "path"),
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


def _run_bridge(tool: str, params: dict, cwd: str, config_env: dict) -> str:
    npx = shutil.which("npx")
    if npx is None:
        return "RStack: `npx` not found on PATH. Install Node.js and run `npm install` in the rstack-agents package."
    if not BRIDGE.is_file():
        return f"RStack: bridge not found at {BRIDGE}."
    env = {**os.environ, **config_env, "RSTACK_PROJECT_ROOT": cwd, "RSTACK_BRIDGE_CALLER": "hermes"}
    try:
        proc = subprocess.run(
            [npx, "tsx", str(BRIDGE), tool, json.dumps(params)],
            cwd=str(PKG_ROOT), env=env, capture_output=True, text=True, timeout=_BRIDGE_TIMEOUT_S,
        )
    except subprocess.TimeoutExpired:
        return f"RStack {tool} timed out after {_BRIDGE_TIMEOUT_S:.0f}s."
    if proc.returncode != 0:
        return f"RStack {tool} failed: {(proc.stderr or proc.stdout or f'exit {proc.returncode}').strip()}"
    return _extract_text(proc.stdout)


def _make_handler(tool: str, config_env: dict):
    def handler(args: dict, **_kw) -> str:
        cwd = os.getcwd()
        params = {k: v for k, v in (args or {}).items() if v is not None}
        return _run_bridge(tool, params, cwd, config_env)
    return handler


# ── enforcement guard (mirrors the Tau adapter + #371 fail-closed policy) ─────

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


def _guard_block(reason: str) -> dict:
    # #390 CORRECTION: the shape a Hermes Python plugin's pre_tool_call hook
    # must return to actually block a call is {"action": "block", "message":
    # ...} — verified against hermes_cli/plugins.py
    # _get_pre_tool_call_directive_details, which reads result.get("action")
    # and requires it to be "block"/"approve" with a non-empty "message".
    # The previous {"decision": "block", "reason": ...} shape (a Claude-Code
    # convention that applies to Hermes' SEPARATE shell-hooks-bridge
    # subsystem in agent/shell_hooks.py, not this Python-plugin path) has
    # `action == None` and is silently ignored — this adapter's guard has
    # never actually blocked anything on real Hermes until this fix.
    return {"action": "block", "message": reason}


def _guard_unavailable(detail: str) -> Optional[dict]:
    if _guard_fail_open():
        # Legacy opt-in: allow, but say so loudly (never silently skip).
        print(f"[rstack] guard unavailable ({detail}); RSTACK_GUARD_FAIL_OPEN=1 — allowing WITHOUT enforcement", flush=True)
        return None
    return _guard_block(
        f"RStack guard is UNAVAILABLE ({detail}) — failing closed so enforcement is not silently skipped. "
        "Run `rstack-agents doctor`, or set RSTACK_GUARD_FAIL_OPEN=1 to allow tool calls without enforcement."
    )


def _run_guard(tool_name: str, tool_input: dict, cwd: str) -> Optional[dict]:
    """Classify one pending tool call via `rstack-agents guard`. Returns a block
    dict (Hermes normalises it) or None to allow. Fails CLOSED on a guard that
    cannot run, unless RSTACK_GUARD_FAIL_OPEN=1 (#371)."""
    argv, _needs_net = _resolve_guard_argv(cwd)
    if argv is None:
        return _guard_unavailable("no rstack-agents binary and no npx on PATH")
    payload = json.dumps({"tool_name": tool_name, "tool_input": tool_input})
    try:
        proc = subprocess.run(
            [*argv, "guard", "--context", "builder", "--project", cwd],
            input=payload, cwd=cwd, env=os.environ, capture_output=True, text=True, timeout=_GUARD_TIMEOUT_S,
        )
    except subprocess.TimeoutExpired:
        return _guard_unavailable("guard timed out")
    except OSError as exc:
        return _guard_unavailable(f"could not spawn guard: {exc}")
    if proc.returncode == 0:
        return None  # allow
    if proc.returncode == 2:
        reason = (proc.stderr or proc.stdout or "RStack guard blocked this tool call.").strip()
        return _guard_block(reason)
    # Any OTHER exit = guard could not decide (crash/module-load/cold-npx miss).
    return _guard_unavailable((proc.stderr or proc.stdout or f"exit {proc.returncode}").strip())


def _guard_hook(**kwargs: Any) -> Optional[dict]:
    """pre_tool_call hook: route the host's mutating tool calls through the guard.
    Read-only tools and RStack's own sdlc_* tools are not gated.

    #390: the real kwargs Hermes passes are tool_name/args/task_id/session_id/
    tool_call_id/turn_id/api_request_id/middleware_trace (verified against
    hermes_cli/plugins.py _get_pre_tool_call_directive_details) — there is no
    tool_input or cwd. Read args directly; cwd always falls back to the
    plugin process's own cwd (Hermes does not pass a per-call working
    directory to this hook).
    """
    tool_name = kwargs.get("tool_name") or ""
    mapping = _GUARDED_TOOLS.get(str(tool_name).lower())
    if mapping is None:
        return None  # not a guarded mutating tool
    guard_tool_name, field = mapping
    raw = kwargs.get("args") if isinstance(kwargs.get("args"), dict) else {}
    tool_input = {field: raw.get(field)} if field in raw else dict(raw)
    cwd = os.getcwd()
    return _run_guard(guard_tool_name, tool_input, cwd)


# ── best-effort observability + hub launch ────────────────────────────────────

def _observe_hook(**kwargs: Any) -> None:
    """post_tool_call -> feed the Business Hub, best-effort. Never raises.

    #390: `rstack-agents observe` parses a Claude-Code-style payload keyed on
    `hook_event_name`/`tool_name` (see src/commands/observe.js) — the
    previous `{"tool", "input", "is_error"}` shape used real Hermes kwarg
    names in the wrong SLOTS (Hermes' post_tool_call actually passes
    tool_name/args/result/status/error_type/error_message, verified against
    model_tools.py _emit_post_tool_call_hook) and matched neither what
    Hermes sends nor what observe.js expects, so nothing reached the
    Business Hub.
    """
    npx = shutil.which("npx")
    if npx is None:
        return
    try:
        status = kwargs.get("status")
        is_error = bool(kwargs.get("error_type")) or status == "error"
        payload = json.dumps({
            "tool_name": kwargs.get("tool_name"),
            "hook_event_name": "PostToolUse",
            "content": kwargs.get("result"),
            "is_error": is_error,
        })
        subprocess.run(
            [npx, "--yes", "rstack-agents", "observe", "--source", "hermes", "--project", os.getcwd()],
            input=payload, env=os.environ, capture_output=True, text=True, timeout=5.0,
        )
    except Exception:
        pass  # observability is additive — never disrupt a Hermes session


def _launch_hub(**_kwargs: Any) -> None:
    """on_session_start -> bring the Business Hub live, best-effort. Honors
    RSTACK_NO_BUSINESS_HUB=1 and CI."""
    if os.environ.get("RSTACK_NO_BUSINESS_HUB") == "1" or os.environ.get("CI"):
        return
    npx = shutil.which("npx")
    if npx is None:
        return
    try:
        subprocess.Popen(
            [npx, "--yes", "rstack-agents", "hub"],
            env=os.environ, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
    except Exception:
        pass


# ── plugin entrypoint ─────────────────────────────────────────────────────────

def register(ctx: Any) -> None:
    """Called once by the Hermes plugin loader. Registers the sdlc_* tools (each
    shelling to the Node bridge) and wires the enforcement guard on pre_tool_call,
    plus best-effort observability and hub launch."""
    cfg = getattr(ctx, "config", None) or {}
    config_env = {env: str(cfg[key]) for key, env in _CONFIG_ENV.items() if cfg.get(key) is not None}

    for name, (description, parameters) in _TOOLS.items():
        ctx.register_tool(
            name=name,
            toolset="rstack",
            schema={"name": name, "description": description, "parameters": parameters},
            handler=_make_handler(name, config_env),
            emoji="🛠️",
        )

    # Enforcement: the destructive gate + validator sandbox, same as Pi/Tau/Claude
    # Code. A {"action": "block", "message": ...} return from _guard_hook is what
    # actually blocks the call (see _guard_block's #390 correction above).
    ctx.register_hook("pre_tool_call", _guard_hook)
    # Observability + companion dashboard (both best-effort, never blocking).
    ctx.register_hook("post_tool_call", _observe_hook)
    ctx.register_hook("on_session_start", _launch_hub)
