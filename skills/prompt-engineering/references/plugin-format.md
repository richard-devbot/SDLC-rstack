<!-- owner: RStack developed by Richardson Gunde -->

# Plugin Format Specification

## What Is a Plugin

A plugin is a self-contained domain pack — agents + skills bundled together for a specific domain (e.g. backend-development, ui-design, payment-processing). Plugins stay in `plugins/` and are NOT merged into the main `agents/` hierarchy.

## Plugin Structure

```
plugins/plugin-name/
├── agents/           ← plugin-specific agents (same format as standalone agents)
│   └── agent-name.md
├── skills/
│   └── skill-name/
│       ├── SKILL.md
│       └── references/  ← optional
├── commands/         ← optional
└── README.md         ← optional index of what the plugin contains
```

## Plugin Agent Format

Same frontmatter as standalone agents, plus a plugin context note in the description:

```yaml
---
name: payment-integration
description: |
  Implements Stripe/PayPal payment flows, webhook handlers, and PCI-compliant
  checkout sessions. Use inside payment-processing plugin when integrating
  payments, handling refunds, or managing subscriptions.
  Part of the payment-processing domain pack. (backend) (payment-processing plugin)
model: sonnet
tools:
  - Bash
  - Read
  - Write
  - Edit
color: blue
---
```

Body follows the same standard: Voice → When To Use → Workflow → Output → Completion Protocol.

## Plugin Skill Format

Same as standalone skills. Add plugin context to description:

```yaml
---
name: stripe-integration
description: |
  Complete Stripe integration: payment intents, webhooks, refunds, subscription
  management, and PCI compliance checks. Part of payment-processing plugin.
  Use when implementing Stripe payments, managing billing, or handling webhooks.
---
```

## Referencing Plugins from AGENTS.md

The master AGENTS.md includes a Plugins section:

```markdown
## Plugins (Domain Packs)
| Plugin | Path | Agents | Skills |
|--------|------|--------|--------|
| backend-development | plugins/backend/backend-development/ | 8 | 10 |
| ui-design | plugins/frontend-mobile/ui-design/ | 3 | 7 |
| payment-processing | plugins/specialized/payment-processing/ | 1 | 4 |
```

## How Orchestrator Reaches Plugins

The orchestrator reads AGENTS.md to discover plugin paths. To use a plugin agent,
spawn it by its full path: `plugins/backend/backend-development/agents/backend-architect.md`

## Plugin vs Standalone Agent — When to Use Which

**Use a plugin agent when:**
- The domain is well-bounded (payments, ML ops, UI design)
- The agents only make sense together as a pack
- You want to share/distribute the pack independently

**Use a standalone specialist agent when:**
- The agent is broadly useful across many projects
- It belongs in the main discovery hierarchy (AGENTS.md specialists section)
