# Third-party notices

<!-- owner: RStack developed by Richardson Gunde -->

RStack's `plugins/` catalog curates and packages Claude Code plugins from
several open-source authors alongside RStack's own `sdlc-rstack` plugin.
Every `plugin.json` in this repo carries two distinct fields:

- **`author`** — the original creator of that plugin's content, unchanged
  from upstream. This is a factual attribution, not a claim of RStack
  authorship.
- **`owner`** — `"RStack developed by Richardson Gunde"`, marking that
  RStack selected, packaged, and integrates this plugin into the governed
  SDLC pipeline (routing, domain grouping, `/sdlc-*` command integration).

Modifying, reorganizing, and extending these plugins for RStack's use is
permitted by their licenses (both MIT and Apache-2.0 grant the right to
create derivative works); what those licenses require in exchange is that
the original copyright and license notice travel with the code, which is
why `author` and `license` in each `plugin.json` are never altered or
removed.

**Domain-manifest consolidation:** `plugins/<domain>/plugin.json` (e.g.
`plugins/backend/plugin.json`) is the single installable Claude Code
plugin for that domain — it points at each sub-plugin's own
`agents/`/`commands/`/`skills` subdirectory rather than duplicating their
content. Domains with a single original author keep that author's real
name in `author`; domains mixing authors (`languages`, `specialized`) set
`author` to a pointer back to this file and add a `contributors` array
naming every real author and exactly which sub-plugins are theirs. Domains
mixing licenses (`product-team`, MIT + `conductor`'s Apache-2.0) use an
SPDX `"X AND Y"` expression. Nothing here changes who wrote what — it only
changes how many manifests you install to get it.

## Seth Hobson — 68 plugins

Source: [wshobson/agents](https://github.com/wshobson/agents)
(Ryan's `claude-code-workflows` catalog). License: MIT or Apache-2.0 per
plugin (see each `plugins/**/plugin.json`).

accessibility-compliance, agent-orchestration, agent-teams, api-scaffolding,
api-testing-observability, application-performance, backend-api-security,
backend-development, blockchain-web3, business-analytics, c4-architecture,
cicd-automation, cloud-infrastructure, code-documentation, code-refactoring,
codebase-cleanup, comprehensive-review, conductor (Apache-2.0),
content-marketing, context-management, customer-sales-automation,
data-engineering, data-validation-suite, database-cloud-optimization,
database-design, database-migrations, debugging-toolkit,
dependency-management, deployment-strategies, deployment-validation,
developer-essentials, distributed-debugging, documentation-generation,
dotnet-contribution, error-debugging, error-diagnostics, framework-migration,
frontend-mobile-development, frontend-mobile-security,
full-stack-orchestration, functional-programming, game-development,
git-pr-workflows, hr-legal-compliance, incident-response,
javascript-typescript, jvm-languages, kubernetes-operations,
llm-application-dev, machine-learning-ops, multi-platform-apps,
observability-monitoring, payment-processing, performance-testing-review,
python-development, quantitative-trading, security-compliance,
security-scanning, seo-analysis-monitoring, seo-content-creation,
seo-technical-optimization, startup-business-analyst, systems-programming,
tdd-workflows, team-collaboration, ui-design, unit-testing, web-scripting

## Ryan Snodgrass — 2 plugins

Source: [github.com/rsnodgrass](https://github.com/rsnodgrass). License: MIT.

arm-cortex-microcontrollers, shell-scripting

## Dávid Balatoni — 1 plugin

Source: [github.com/balcsida](https://github.com/balcsida). License: MIT.

reverse-engineering

## Community Contribution — 1 plugin

Source: [github.com/exAClior](https://github.com/exAClior). License: MIT.

julia-development

## RStack (Richardson Gunde) — 1 plugin

`sdlc-rstack` — the governed SDLC command surface, original to this
project (see the repo's own `LICENSE`).
