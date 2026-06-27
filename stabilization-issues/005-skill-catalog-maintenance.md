# 005 – Skill Catalog Upkeep
**Disadvantage**: Dependency on agent catalog; missing specialist blocks work.
**Proposed remediation**
- Scan the repo for any import/usage of a language/framework that lacks an agent.
- Use `skill‑creator` to scaffold a stub agent (README, skeleton files).
- Register the new agent in `.rstack/registry/plugins.json`.
**Web‑research needed**
- "How to bootstrap a new RStack agent"
- "Best naming conventions for agent files"
**Acceptance criteria**
- No "unknown‑agent" warnings appear in any builder run.
- New agents pass the `validator` sanity check.
