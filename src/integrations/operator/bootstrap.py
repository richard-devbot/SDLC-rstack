"""RStack SDLC — Operator bootstrap (#391).

operator-use 0.2.9 has no third-party plugin discovery mechanism: no
entry_points group, no config field, no directory scan. Its CLI
(`cli/start.py::_build_agents`) hardcodes the plugin list —
`[ComputerPlugin(...), BrowserPlugin(...)]` — directly in Python source and
passes it straight to each `Agent(...)` constructor. There is no supported
way to add a plugin to a real `operator start` session without either
forking the installed package or patching that call site before it runs.

This module does the latter, as a drop-in replacement for the `operator`
console script: it monkeypatches `operator_use.cli.start._build_agents` to
append an `RStackPlugin()` to every constructed agent's `plugins`, `hooks`,
and `tool_register` (mirroring exactly what `_build_agents` already does
for its own hardcoded plugins — `plugin.register_tools(...)`,
`plugin.register_hooks(...)`), then hands off to the real Typer app object
(`operator_use.cli.commands.app`, the same object the `operator` /
`operator-use` console scripts invoke — see operator-use's own
pyproject.toml entry_points) so every other command (onboard, gateway,
cron, REPL, ...) behaves identically to a stock install.

This is a monkeypatch of an underscore-prefixed (non-public) function, not a
supported extension point — it is the honest maximum available today, and it
will break if a future operator-use release renames or restructures
`_build_agents`. `rstack-agents doctor --framework operator` checks that
this file and the real `_build_agents` symbol are both present, and states
this limitation plainly rather than implying parity with Tau/Hermes/Pi's
config-driven loading.

Usage (replaces `operator start` / `operator repl` / etc. one-for-one):
    python node_modules/rstack-agents/src/integrations/operator/bootstrap.py start
    python node_modules/rstack-agents/src/integrations/operator/bootstrap.py repl

owner: RStack developed by Richardson Gunde
"""
from __future__ import annotations

import sys
from pathlib import Path


def _patch_build_agents() -> None:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import operator_use.cli.start as _start  # noqa: PLC0415
    from rstack_sdlc import RStackPlugin  # noqa: PLC0415

    original_build_agents = _start._build_agents

    def _patched_build_agents(config, cron, gateway, bus):
        agents = original_build_agents(config, cron, gateway, bus)
        for agent in agents.values():
            plugin = RStackPlugin()
            agent.plugins.append(plugin)
            plugin.register_tools(agent.tool_register)
            plugin.register_hooks(agent.hooks)
        return agents

    _start._build_agents = _patched_build_agents


def main() -> None:
    _patch_build_agents()
    from operator_use.cli.commands import app  # noqa: PLC0415
    app()


if __name__ == "__main__":
    main()
