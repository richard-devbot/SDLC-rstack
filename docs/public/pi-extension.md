<!-- owner: RStack developed by Richardson Gunde -->

# RStack SDLC Pi Extension

RStack SDLC is a Pi extension that turns a coding agent into a structured software delivery team. It gives the host agent a clean lifecycle instead of a pile of disconnected prompts.

## What it does

RStack coordinates:

1. Product clarification
2. Requirements and acceptance criteria
3. Architecture and implementation plan
4. Builder-team execution
5. Validator-team review
6. Testing and security checks
7. Documentation and release readiness
8. Memory capture for future runs

The extension stores state in `.rstack/runs/` so every run is inspectable, resumable, and auditable.

## Why not MCP for the first version?

The first RStack package is a native Pi extension, not an MCP server. MCP is useful for broad interoperability, but it can add startup and tool-description context overhead. RStack starts with a small, high-level Pi tool surface so the model sees only lifecycle actions, not hundreds of specialist tools.

## Tool flow

```text
sdlc_orchestrate
  -> sdlc_start
  -> sdlc_clarify
  -> sdlc_decisions / sdlc_decide
  -> sdlc_dor_check
  -> sdlc_plan
  -> sdlc_spec
  -> sdlc_approve
  -> sdlc_agents
  -> sdlc_delegate
  -> sdlc_build_next
  -> sdlc_validate
  -> sdlc_status
  -> sdlc_trace / sdlc_rollback
  -> sdlc_memory
```

## Runtime surfaces

RStack has three backend runtime surfaces. They share the same package assets, but they do not enforce the same runtime guarantees.

| Runtime | How it runs | What it can enforce | Main entry points |
| --- | --- | --- | --- |
| Pi extension | Native extension with registered tools, commands, and hooks. | Tool-call logging, destructive-action gates, session hooks, delegated workers, run state writes. | `sdlc_orchestrate`, `sdlc_start`, `sdlc_build_next`, `sdlc_validate`, `sdlc_delegate`, `sdlc_status` |
| Claude Code | Portable agent, skill, plugin, and command assets installed into a project. | Asset routing and conventions through `CLAUDE.md`; no native Pi `tool_call` gate. | `npx rstack-agents init --framework claude-code`, Claude Code subagents, copied slash-command files |
| CLI | Node commands shipped by the package. | Framework-neutral setup, validation, readiness checks, decision queue inspection, hub startup. | `rstack-agents init`, `list`, `decisions`, `dor`, `validate`, `hub`, `notify` |

## Agent invocation model

Pi invokes RStack agents through native lifecycle tools:

1. `sdlc_orchestrate` loads the orchestrator, builder, and validator operating instructions.
2. `sdlc_plan` maps canonical stages to package agents and routed specialists.
3. `sdlc_build_next` prepares the next machine-checkable task packet under `.rstack/runs/<run_id>/tasks/<task_id>/`.
4. `sdlc_delegate(role="builder" | "validator" | "researcher" | "reviewer", task="...")` spawns an isolated worker with bounded context.
5. `sdlc_validate` reads the builder contract and writes validation state before the run advances.

Claude Code invokes the same package assets through portable project files, not through Pi tools. `rstack-agents init --framework claude-code` writes the bootstrap files that point Claude Code at RStack assets — it does NOT create `.claude/agents/rstack/` or `.claude/commands/rstack/`, and no CLI verb does; if you want Claude Code's native subagent/slash-command conventions you must copy those markdown files manually, and the copies are unmanaged on upgrade. Because Claude Code does not run the Pi extension hook layer, destructive-action blocking and tool-call logging are not enforced there by `tool_call`.

The CLI does not impersonate a runtime agent. It prepares assets, validates package definitions, manages readiness/decision state, and starts backend services such as the Business Hub. Agent execution still happens in the host runtime.

## State layout

```text
.rstack/
  session.json        # session pin (#289): the run this project most recently started; written by sdlc_start/adopt, consulted before any newest-run fallback
  registry/
    registry.json
    agents.json
    skills.json
    plugins.json
    routing.json
  memory/
    learnings.jsonl
  runs/
    <run_id>/
      manifest.json
      context.md
      plan.md
      tasks.json
      approvals.json
      traceability.json
      events.jsonl
      specs/
        product-brief.md
        requirements.json
        architecture.md
        qa-report.json
        security-review.md
        release-readiness.json
      tasks/
        <task_id>/
          prompt.md
          builder.json
          validation.json
```

## Hook lifecycle wiring

RStack uses Pi extension hooks as the runtime harness:

| Pi hook | RStack behavior |
| --- | --- |
| `resources_discover` | Exposes package/project skills and prompts to Pi. |
| `session_start` | Creates `.rstack/` state roots and sets the RStack status line. |
| `before_agent_start` | Injects orchestrator/builder/validator instructions when the prompt mentions RStack/SDLC. |
| `tool_call` | Logs tool calls to the active run and blocks destructive shell/write actions unless a human approval exists. |
| `tool_result` | Logs bounded tool result summaries to the active run event stream. |
| `session_shutdown` | Appends a shutdown event to the active run. |

Destructive commands such as `rm -rf`, `git push`, `npm publish`, `terraform apply/destroy`, and writes to secret-like paths are blocked during an active RStack run unless `sdlc_approve` records `destructive-action` or `release-readiness.json`, or `RSTACK_ALLOW_DESTRUCTIVE=1` is set.

## Specialist reuse

The package ships reusable RStack assets directly:

- `agents/**/*.md`
- `skills/**/SKILL.md`
- `prompts/*.md`
- `plugins/*/plugin.json`

Projects can override or add local assets under `.rstack/agents`, `.pi/rstack/agents`, `.rstack/skills`, `.pi/rstack/skills`, `.rstack/plugins`, or `.pi/rstack/plugins`.

The extension uses the registry to select specialist context for lifecycle tasks and can also spawn isolated workers through `sdlc_delegate`.

## Install in Pi

From a published package:

```bash
pi install npm:rstack-agents
```

From a local checkout:

```bash
pi install /path/to/SDLC-rstack
```

Or try once:

```bash
pi -e /path/to/SDLC-rstack
```

## Recommended use

Ask Pi something like:

> Use RStack to build a full production-ready todo app with authentication, tests, docs, and release notes.

Then follow the lifecycle:

1. Call `sdlc_orchestrate` with the goal to load RStack core agent instructions.
2. Call `sdlc_start` with the goal.
3. Call `sdlc_clarify` to capture product-owner decisions if the goal is ambiguous.
4. Use `sdlc_decisions`, `sdlc_decide`, and `sdlc_dor_check` when readiness depends on unresolved human decisions.
5. Call `sdlc_plan` to create the delivery plan.
6. Review generated specs with `sdlc_spec`.
7. Record human gates with `sdlc_approve` for `plan.md`, `requirements.json`, `architecture.md`, and release readiness.
8. Call `sdlc_agents` when you need to inspect available specialists.
9. Call `sdlc_delegate` for isolated builder, validator, research, or review workers.
10. Call `sdlc_build_next` to get the next builder task packet with embedded specialist instructions.
11. Execute the task using normal coding tools or delegated workers.
12. Write the required `builder.json` contract.
13. Call `sdlc_validate`.
14. Use `sdlc_trace` to inspect event history or `sdlc_rollback` to restore a checkpoint.
15. Repeat until complete.
16. Call `sdlc_memory` to record important learnings.

## Publishing note

The npm package is configured to ship the public Pi runtime artifacts: `extensions/`, `agents/`, `skills/`, `prompts/`, `plugins/`, `bin/`, `src/`, `docs/public/`, and `README.md`.
