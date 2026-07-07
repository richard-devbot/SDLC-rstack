# RStack adapter conformance contract

<!-- owner: RStack developed by Richardson Gunde -->

An **adapter** wires a host agent framework (Operator, Tau, or your own) into
RStack. Adapters never reimplement SDLC logic — they shell every tool call to
the shared Node bridge and route the host's own tool calls through the guard.
This is the checklist every adapter must satisfy so the pipeline behaves
identically no matter which framework drives it. The Pi native extension
(`src/integrations/pi/rstack-sdlc.ts`) is the reference; the bridge exposes its
exact tool surface, so that surface is the contract.

## 1. Same `sdlc_*` tools, same schemas

- Register the **same tool names** the Pi adapter registers. The authoritative
  list is whatever `npx tsx bin/rstack-bridge.ts --list-tools` prints (it loads
  the Pi adapter and returns its registered tool names as a JSON array).
- Each tool's parameter schema must mirror the corresponding typebox schema in
  `rstack-sdlc.ts` (field names, required vs. optional, enum/literal values).
- Adapters that let their tools silently diverge from this surface are caught by
  `tests/adapter-conformance.test.js`, which diffs the bridge's advertised
  surface against the live Pi registry.

## 2. Bridge protocol

- Invoke: `npx tsx bin/rstack-bridge.ts <tool> '<json-params>'`
  (the `bin/rstack-operator-bridge.ts` alias is equivalent and kept for
  back-compat).
- The tool's raw result object is written as **JSON to stdout**. Nothing else
  goes to stdout — the bridge redirects all `console.*` diagnostics to stderr so
  stdout stays a clean JSON channel.
- On error the bridge writes the message to **stderr and exits non-zero**
  (unknown tool / bad usage → exit 2; any thrown failure → exit 1). Adapters
  surface stderr (or stdout, or `exit <code>`) as the tool error text.
- Set `RSTACK_PROJECT_ROOT` to the user's repo so the bridge (running from the
  package directory) operates on the right project.
- Set `RSTACK_BRIDGE_CALLER` to your framework name (`operator`, `tau`, …) for
  trace attribution. It defaults to `bridge`.
- Parse the Pi tool result shape `{ content: [{type:'text', text}], details }`
  and return the joined `text`; fall back to the raw stdout if the shape is
  unexpected.

## 3. Guard on the pre-execution hook (enforcement)

- On the host's **before-tool-execution** hook, route the framework's
  shell/write/edit tools through `npx --yes rstack-agents guard --context
  builder --project <cwd>`, passing
  `{"tool_name": "<Bash|Write|Edit>", "tool_input": {...}}` on **stdin**.
- **exit 2 = block** the pending call and surface the guard's stderr/stdout as
  the block reason. Any other exit code = allow (guard contract: exit 0 allow /
  exit 2 block).
- **Fail open only when `npx` itself is unreachable.** If npx is missing the
  guard binary can never run, and refusing to load the extension is worse than
  skipping enforcement for that one session. Every reachable-but-non-blocking
  path must allow, never crash the host.
- Read-only tools (`read`, `glob`, `grep`, `ls`, …) are not routed through the
  gate.

## 4. Business Hub launch is best-effort

- On session load, health-check `:3008` and spawn the hub detached if it is
  down, then open the browser. This must **never block or fail** the session.
- Honor `RSTACK_NO_BUSINESS_HUB=1` (skip entirely), `RSTACK_NO_BROWSER=1`
  (start but do not open a tab), `RSTACK_BUSINESS_PORT`, and `CI` (skip).

## 5. `RSTACK_*` config passthrough

Map the host's settings to the environment variables the TS adapter/harness
reads, and pass the parent environment through unchanged otherwise:

| Setting | Env var |
|---|---|
| `worker_command` | `RSTACK_WORKER_COMMAND` |
| `default_model` | `RSTACK_DEFAULT_MODEL` |
| `escalated_model` | `RSTACK_ESCALATED_MODEL` |
| `slack_webhook` | `RSTACK_SLACK_WEBHOOK` |
| `state_dir` | `RSTACK_STATE_DIR` |
| `allow_destructive` | `RSTACK_ALLOW_DESTRUCTIVE` |

## Reference adapters

- `src/integrations/operator/rstack_sdlc.py` — Operator (Python).
- `src/integrations/tau/rstack_sdlc.py` — Tau (Python; also demonstrates the
  guard `tool_call` hook, so loading the extension *is* the enforcement wiring).

For a framework with no matching adapter, see
[wire-your-own-harness.md](wire-your-own-harness.md) — a paste-in prompt that
makes your coding agent write an adapter against this contract.
