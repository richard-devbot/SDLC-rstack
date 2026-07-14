# RStack Adapter Conformance Contract

<!-- owner: RStack developed by Richardson Gunde -->

Any new harness adapter (a file that teaches an agent framework to speak
RStack) must satisfy this checklist. The Pi adapter
(`src/integrations/pi/rstack-sdlc.ts`) is the reference implementation; the
Operator (`src/integrations/operator/rstack_sdlc.py`), Tau
(`src/integrations/tau/rstack_sdlc.py`), and Hermes
(`src/integrations/hermes/rstack_sdlc.py`) adapters are conforming examples.
`tests/bridge-conformance.test.js` enforces the tool-surface half of this
contract in CI so adapters cannot silently diverge.

## 1. Same `sdlc_*` tool names and schemas

The adapter registers exactly the tools the Pi adapter registers — no
renames, no subset, no extras. The authoritative listing at any commit:

```bash
npx tsx bin/rstack-bridge.ts --list
# ["sdlc_agents","sdlc_approve","sdlc_build_next", ...]
```

Parameter schemas mirror the typebox schemas in
`src/integrations/pi/rstack-sdlc.ts` (Pydantic models for Python hosts).
Optional fields stay optional; enum values match exactly.

## 2. Bridge protocol

Never reimplement SDLC logic in the host language. Shell out to the generic
bridge once per tool call:

```bash
RSTACK_PROJECT_ROOT=/path/to/project \
RSTACK_BRIDGE_CALLER=<your-framework> \
  npx tsx node_modules/rstack-agents/bin/rstack-bridge.ts <tool> '<json-params>'
```

- **stdout**: the tool's raw result object as JSON
  (`{ content: [{type:"text", text}], details }`) — parse `content[].text`
  for display, fall back to raw stdout on unexpected shapes.
- **stderr + exit 1**: tool/harness errors. **exit 2**: usage errors
  (missing tool name, invalid JSON, unknown tool — stderr lists the
  available tools).
- `RSTACK_PROJECT_ROOT` carries the user's repo (the bridge may run from the
  package directory). `RSTACK_BRIDGE_CALLER` is the cosmetic invocation id
  (defaults to `bridge`).
- `bin/rstack-operator-bridge.ts` is a back-compat alias for the generic
  bridge — new adapters call `rstack-bridge.ts` directly.

## 3. Enforcement guard on the pre-execution hook

Route the host's shell-execution and file-write/edit tools through
`rstack-agents guard` **before** they execute, using whatever pre-tool-use
hook the framework has (see
[wire-your-own-harness.md](wire-your-own-harness.md) for the full guard
contract and a paste-in wiring prompt):

- exit `0` = allow; exit `2` = **block** the tool call and surface the guard's
  stderr reason to the model verbatim (do not auto-retry).
- **Fail closed on guard-UNAVAILABLE (#371).** Only exit `0` is allow and exit
  `2` is block. ANY other outcome — a non-0/2 exit (crash, module-load error, a
  cold `npx --yes` that cannot reach the registry), a timeout, or a spawn
  failure — means the guard could not decide. Do **not** read that as allow:
  treat it as unavailable and **block** (or warn loudly and record), so an
  install hiccup can never silently disable enforcement. `RSTACK_GUARD_FAIL_OPEN=1`
  opts back into the legacy allow-on-unavailable behavior; bound each invocation
  with a timeout (`RSTACK_GUARD_TIMEOUT_MS`, default 15s).
- **Prefer a resolved binary over `npx --yes`.** Resolve
  `node_modules/.bin/rstack-agents` (or `rstack-agents` on PATH) first and only
  fall back to `npx --yes rstack-agents`; the resolved binary needs no network
  and cuts per-call latency. `rstack-agents doctor` reports which path resolves
  and warns when only `npx` (network-dependent) is available.
- Read-only tools (read/grep/glob/ls) skip the guard.
- Pass through `RSTACK_TASK_ID` (or `--task`) when the active task is known,
  and `--context validator` / `RSTACK_AGENT_CONTEXT=validator` on
  review-only subprocesses.

## 4. Business Hub launch is best-effort

If the adapter auto-launches the Hub on session start (recommended): health-
check `:3008` first, spawn detached, swallow every failure — the dashboard is
a companion, **never** a blocker. Honor `RSTACK_NO_BUSINESS_HUB=1`,
`RSTACK_NO_BROWSER=1`, `RSTACK_BUSINESS_PORT`, and skip entirely under `CI`.

## 5. `RSTACK_*` environment passthrough

Host-level settings map to the environment variables the TS adapter/harness
consumes, forwarded on every bridge and guard call:

| Setting | Env var |
|---|---|
| `worker_command` | `RSTACK_WORKER_COMMAND` |
| `default_model` | `RSTACK_DEFAULT_MODEL` |
| `escalated_model` | `RSTACK_ESCALATED_MODEL` |
| `slack_webhook` | `RSTACK_SLACK_WEBHOOK` |
| `state_dir` | `RSTACK_STATE_DIR` |
| `allow_destructive` | `RSTACK_ALLOW_DESTRUCTIVE` |

Already-set process environment always passes through unmodified.

## 6. Conformance test

`tests/bridge-conformance.test.js` compares the bridge's `--list` output
(which is the Pi adapter's live registry) against every shipped adapter's
declared tool table. Adding a tool to the Pi adapter without syncing the
other adapters — or shipping an adapter with a diverged tool surface — fails
CI. When you add a new adapter, add its tool table to that test.
