#!/usr/bin/env -S npx tsx
/**
 * RStack SDLC — generic framework bridge.
 *
 * Any host harness without a native TypeScript runtime (Operator, Tau, custom
 * Python agents, …) shells out to this script once per tool call. We reuse the
 * existing Pi adapter verbatim: load its default export with a mock `pi` that
 * only captures the registered tools, then invoke the requested tool. No SDLC
 * logic is duplicated here or in any adapter — the Python side is a thin shell.
 *
 * Usage:  npx tsx bin/rstack-bridge.ts <tool_name> '<json-params>'
 * Output: the tool's raw result object as JSON on stdout (errors → stderr + exit 1).
 *
 * The invocation id passed to the tool is purely cosmetic (it shows up in some
 * tool traces). Callers set RSTACK_BRIDGE_CALLER to their framework name
 * ("operator", "tau", …) so traces attribute the call; it defaults to "bridge".
 *
 * The project root is taken from RSTACK_PROJECT_ROOT (set by the caller) so this
 * script can run from the package directory while operating on the user's repo.
 *
 * owner: RStack developed by Richardson Gunde
 */
import activate from "../src/integrations/pi/rstack-sdlc.ts";

type RegisteredTool = {
  name: string;
  execute: (id: string, params: any, signal?: AbortSignal, onUpdate?: unknown) => Promise<any>;
};

export async function main(): Promise<void> {
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
  const caller = process.env.RSTACK_BRIDGE_CALLER || "bridge";

  if (!toolName) {
    process.stderr.write("usage: rstack-bridge <tool_name> '<json-params>'\n");
    process.exit(2);
  }

  let params: unknown;
  try {
    params = JSON.parse(rawParams);
  } catch (err) {
    process.stderr.write(`invalid JSON params: ${(err as Error).message}\n`);
    process.exit(2);
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

  // Special-case: `--list-tools` prints the captured tool names as a JSON array
  // and exits. Adapters and the conformance test use this to assert the bridge
  // exposes exactly the Pi adapter's sdlc_* tool surface (no silent divergence).
  if (toolName === "--list-tools") {
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

  const result = await tool.execute(caller, params);
  process.stdout.write(JSON.stringify(result ?? null));
}

/** Run the bridge and translate any uncaught failure into exit 1 with the stack on stderr. */
export function run(): void {
  main().catch((err) => {
    process.stderr.write(`${(err as Error).stack || String(err)}\n`);
    process.exit(1);
  });
}

// Auto-run only when invoked directly (e.g. `npx tsx bin/rstack-bridge.ts …`).
// The operator-bridge shim imports { run } instead, so importing this module
// never triggers a second execution.
if (import.meta.url === `file://${process.argv[1]}`) {
  run();
}
