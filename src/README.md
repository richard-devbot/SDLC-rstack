# src/ — SDLC Layer Map

<!-- owner: RStack developed by Richardson Gunde -->

Every component lives in the layer it serves. One layer = one responsibility.

```
src/
├── core/                 SDLC runtime — the engine everything else observes
│   ├── harness/          stages, contracts, evidence, guardrails, run-state
│   └── tracker/          project registry, human-in-loop approval queue
│
├── observability/        see what every run is doing, live and historical
│   ├── collectors/       run reporter, legacy dashboard helpers
│   ├── dashboard/        Business Hub server + state + UI (port :3008)
│   └── alerts/           threshold evaluation, plain-language summaries
│
├── integrations/         framework adapters — RStack plugs into the host, not vice versa
│   ├── pi/               Pi native adapter (TypeScript extension)
│   ├── operator/         Operator adapter (Python, bridges via bin/rstack-bridge.ts)
│   └── tau/              Tau adapter (Python, contributed by Jeomon — bridge + self-wiring guard hook)
│
├── notifications/        webhook delivery — Slack, Teams, Discord
├── memory/               episodic memory, retrieval fusion, diagnostics
├── hooks/                auto-launch helpers (session_start → Business Hub)
├── commands/             CLI commands (list, validate)
└── utils/                shared utilities (logger)
```

## Compatibility shims

The published package contract predates this layout. These old paths still work
as thin re-exports and will be removed in v2.0:

| Shim (old path) | Real module |
|---|---|
| `extensions/rstack-sdlc.ts` | `src/integrations/pi/rstack-sdlc.ts` |
| `extensions/rstack_sdlc.py` | `src/integrations/operator/rstack_sdlc.py` |

## Layer rules

1. `core/` imports nothing from other layers.
2. `observability/` reads core state; it never mutates a run.
3. `integrations/` adapt the host framework to core — SDLC logic is never
   reimplemented inside an adapter.
4. `notifications/` is fire-and-forget; a webhook failure must never fail a run.
