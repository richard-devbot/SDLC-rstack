#!/usr/bin/env -S npx tsx
/**
 * RStack SDLC — Operator bridge (back-compat shim).
 *
 * The bridge is now framework-neutral and lives in bin/rstack-bridge.ts. This
 * script is kept as a stable entry point because existing installs, the Operator
 * Python adapter, docs, and tests reference `bin/rstack-operator-bridge.ts` by
 * name (it is also a published package bin). It delegates to the generic bridge
 * verbatim; the only difference is the cosmetic invocation id, which we stamp as
 * "operator" for trace attribution.
 *
 * Usage:  npx tsx bin/rstack-operator-bridge.ts <tool_name> '<json-params>'
 *
 * owner: RStack developed by Richardson Gunde
 */
import { run } from "./rstack-bridge.ts";

// Preserve the historical trace attribution unless the caller overrode it.
if (!process.env.RSTACK_BRIDGE_CALLER) {
  process.env.RSTACK_BRIDGE_CALLER = "operator";
}

run();
