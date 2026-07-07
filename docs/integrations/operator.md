# RStack on Operator

<!-- owner: RStack developed by Richardson Gunde -->

Operator (Python agent harness) loads `rstack_sdlc.py`, which exposes the same
`sdlc_*` tools as the Pi adapter. No SDLC logic is reimplemented in Python —
each tool shells out to the generic Node bridge (`bin/rstack-bridge.ts`),
which reuses the TypeScript adapter verbatim
(`bin/rstack-operator-bridge.ts` remains as a back-compat alias).
Conformance: [adapter-contract.md](adapter-contract.md).

## Host requirements

- `node` + `npx` on PATH
- `npm install` run once in the rstack-agents package directory
- Python with `pydantic` (Operator's own dependency)

## Setup

```bash
cd your-project
npm install rstack-agents
npx rstack-agents init --framework operator
```

`init` writes `rstack-operator.example.json` — merge its `extensions.list`
entry into your Operator `settings.json`:

```json
{
  "extensions": {
    "list": [{
      "path": "node_modules/rstack-agents/extensions/rstack_sdlc.py",
      "settings": {
        "worker_command": "",
        "default_model": "",
        "escalated_model": "",
        "slack_webhook": ""
      }
    }]
  }
}
```

Each `settings` key maps to the matching `RSTACK_*` environment variable and
is forwarded to the bridge per tool call.

## Verify

```bash
RSTACK_PROJECT_ROOT=$(pwd) npx tsx node_modules/rstack-agents/bin/rstack-operator-bridge.ts sdlc_status '{}'
```

A JSON run summary on stdout means the bridge, adapter, and harness all work.
