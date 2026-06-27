# 001 – Process Simplification
**Disadvantage**: Complexity of setup – many folders, contracts, agents.
**Proposed remediation**
- Run `investigate` to map current run‑directory usage.
- Run `bounty‑hunter` to locate dead contracts & duplicate files.
- Apply `freeze` on core folders while cleaning, then `unfreeze`.
**Web‑research needed**
- "Best practices for CI pipeline cleanup"
- "How to safely prune Git‑based artifact stores"
**Acceptance criteria**
- No orphaned `*.json` files remain.
- All remaining stages are reachable from the manifest.
- `freeze`/`unfreeze` logs show no accidental edits.
