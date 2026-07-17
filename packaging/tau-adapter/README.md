# rstack-tau-adapter

<!-- owner: RStack developed by Richardson Gunde -->

The RStack governed SDLC loop as a [Tau](https://github.com/Jeomon/Tau)
extension, packaged so `tau install` can fetch it directly instead of
requiring a manual `.tau/extensions/` file copy.

**This package's `src/rstack_tau_adapter/__init__.py` is generated, not
hand-written** — the single source of truth lives at
`src/integrations/tau/rstack_sdlc.py` in the
[SDLC-rstack](https://github.com/richard-devbot/SDLC-rstack) repo. Regenerate
with `node scripts/generate-tau-package.mjs` from the repo root after
changing the adapter.

## Install

```bash
tau install ./packaging/tau-adapter    # local, while iterating
tau install git+https://github.com/richard-devbot/SDLC-rstack.git#subdirectory=packaging/tau-adapter
```

## Requirements

- `node` + `npx` on PATH in the project you run Tau in
- `npm install rstack-agents` in that project (or nothing — `npx` fetches
  the published package on first use)

Full docs: [docs/integrations/tau.md](https://github.com/richard-devbot/SDLC-rstack/blob/main/docs/integrations/tau.md)
in the main repo.
