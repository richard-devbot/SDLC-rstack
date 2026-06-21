# RStack on Claude Code

<!-- owner: RStack developed by Richardson Gunde -->

Claude Code runs RStack through portable project assets: agents, skills,
plugins, prompts, and bootstrap instructions. It writes governed state under
`.rstack/`, but it does not run the Pi extension hook layer.

## Setup

```bash
cd your-project
npx rstack-agents init --framework claude-code
```

This creates `.claude/rstack-sdlc.md` (project-local usage guide) and
registers the project with the Business Hub. It also scaffolds `CLAUDE.md`,
`SOUL.md`, and `HEARTBEAT.md` from the package templates when they do not
already exist.

Optional local asset copies can place package agents under
`.claude/agents/rstack/` and prompt files under `.claude/commands/rstack/`.
Claude Code then exposes them through its normal subagent and slash-command
file conventions.

## Runtime surfaces

| Surface | Purpose |
|---|---|
| `CLAUDE.md` | Project bootstrap and RStack routing guidance |
| `.claude/rstack-sdlc.md` | Local usage guide for SDLC runs |
| `.claude/agents/rstack/*.md` | Optional Claude Code subagent copies for RStack agents |
| `.claude/commands/rstack/*.md` | Optional slash-command prompt copies |
| `skills/**/SKILL.md` | Portable skills used when their trigger matches the task |
| `plugins/*/plugin.json` | Portable plugin metadata and bundled plugin assets |
| `rstack-agents` | CLI setup, validation, decisions, readiness, hub, and notifications |

## Limitations

Claude Code can follow RStack's orchestrator, builder, validator, evidence, and
approval contracts, but it cannot enforce Pi-native `tool_call` blocking. Treat
destructive-action blocking as a Pi guarantee unless an adapter adds equivalent
Claude Code tool gating.

## Observability

```bash
npx rstack-business
```

Run timelines, stage durations, approvals, alerts, and traceability on :3008 —
aggregated across every project on this machine.
