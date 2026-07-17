#!/usr/bin/env -S npx tsx
/**
 * RStack SDLC — generic framework bridge.
 *
 * Any host framework without a native TypeScript runtime (Operator, Tau, or a
 * custom Python/Go/Rust agent loop) shells out to this script once per tool
 * call. We reuse the existing Pi adapter verbatim: load its default export
 * with a mock `pi` that only captures the registered tools, then invoke the
 * requested tool. No SDLC logic is duplicated per framework.
 *
 * Usage:  npx tsx bin/rstack-bridge.ts <tool_name> '<json-params>'
 *         npx tsx bin/rstack-bridge.ts --list        # sorted tool names as JSON
 * Output: the tool's raw result object as JSON on stdout (errors → stderr + exit 1).
 *
 * The project root is taken from RSTACK_PROJECT_ROOT (set by the caller) so
 * this script can run from the package directory while operating on the user's
 * repo. Callers may identify themselves via RSTACK_BRIDGE_CALLER (e.g.
 * "operator", "tau") — it is used as the cosmetic tool-invocation id and
 * defaults to "bridge". bin/rstack-operator-bridge.ts remains as a back-compat
 * alias that re-execs this script with RSTACK_BRIDGE_CALLER=operator.
 *
 * Adapter authors: the full conformance contract lives in
 * docs/integrations/adapter-contract.md.
 */
import activate from "../src/integrations/pi/rstack-sdlc.ts";

type RegisteredTool = {
  name: string;
  execute: (id: string, params: any, signal?: AbortSignal, onUpdate?: unknown) => Promise<any>;
};

async function main(): Promise<void> {
  // The harness uses console.log for diagnostics (e.g. unconfigured-webhook notices).
  // Keep stdout pristine for the result JSON by routing all console output to stderr.
  const toStderr = (...args: unknown[]) =>
    process.stderr.write(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ") + "\n");
  console.log = toStderr;
  console.info = toStderr;
  console.debug = toStderr;
  console.warn = toStderr;

  const toolName = process.argv[2];
  const rawParams = process.argv[3] ?? "{}";

  if (!toolName) {
    process.stderr.write("usage: rstack-bridge <tool_name> '<json-params>'  |  rstack-bridge --list\n");
    process.exit(2);
  }

  let params: unknown = {};
  if (toolName !== "--list") {
    try {
      params = JSON.parse(rawParams);
    } catch (err) {
      process.stderr.write(`invalid JSON params: ${(err as Error).message}\n`);
      process.exit(2);
    }
  }

  // Mock Pi ExtensionAPI: capture tools, ignore commands/hooks. The `tools` proxy
  // lets any cross-tool reference resolve to a captured tool (commands aren't used
  // here, but the proxy keeps the surface safe).
  const registry: Record<string, RegisteredTool> = {};
  const mockPi: any = {
    registerTool: (tool: RegisteredTool) => {
      registry[tool.name] = tool;
    },
    registerCommand: () => {},
    on: () => {},
    config: {},
    tools: new Proxy(
      {},
      {
        get: (_t, name: string) => ({
          execute: (id: string, args: unknown) => registry[name]?.execute(id, args),
        }),
      },
    ),
  };

  await activate(mockPi);

  if (toolName === "--list") {
    // Conformance surface: the exact tool names the Pi adapter registers.
    // docs/integrations/adapter-contract.md pins adapters to this listing.
    process.stdout.write(JSON.stringify(Object.keys(registry).sort()));
    return;
  }

  const tool = registry[toolName];
  if (!tool) {
    process.stderr.write(
      `unknown tool: ${toolName}\navailable: ${Object.keys(registry).sort().join(", ")}\n`,
    );
    process.exit(2);
  }

  const invocationId = process.env.RSTACK_BRIDGE_CALLER || "bridge";
  const result = await tool.execute(invocationId, params);
  process.stdout.write(JSON.stringify(result ?? null));
}

main().catch((err) => {
  process.stderr.write(`${(err as Error).stack || String(err)}\n`);
  process.exit(1);
});
