#!/usr/bin/env -S npx tsx
/**
 * Back-compat alias — the Operator adapter, existing installs, and older docs
 * invoke this path. The implementation is the framework-neutral
 * bin/rstack-bridge.ts; this shim only stamps the invocation id.
 */
process.env.RSTACK_BRIDGE_CALLER ??= "operator";
await import("./rstack-bridge.ts");
