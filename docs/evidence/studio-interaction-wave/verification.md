<!-- owner: RStack developed by Richardson Gunde -->
# Studio interaction wave — browser verification

Verified 2026-07-15 against the scratch run `interaction-wave-proof` with
Playwright Core and local Chromium. The dashboard was started on port 3377
with `RSTACK_NO_BROWSER=1` and an isolated `RSTACK_REGISTRY_DIR`; Chromium used
`--use-angle=swiftshader --enable-unsafe-swiftshader`.

Lifecycle proof events were appended to `events.jsonl` only after the page had
loaded. The capture polled `#studio-app` diagnostics rather than relying on a
single idle render sample.

## Evidence

| State | Source-backed proof |
| --- | --- |
| Manager resting state | [Manager seated at the red HQ battlestation](manager-seated.png) |
| Pipeline architecture | [Default overview: overhead 15-stage corridor gantry and reached-stage packets](corridor-gantry.png) |
| Teammate check-in | [Manager walking to the involved builder desk after `handoff_created`](manager-check-in.png) |
| Live action caption | [`handoff → validator` while the worker handoff and manager check-in transitions are active](action-caption.png) |
| Human approval | [North-side free-camera view: manager and approver at the strategy table with both speech bubbles](approval-conversation.png) |
| Reduced motion | [Static approval final state with zero active transitions and no action-caption fade](reduced-motion.png) |

The approval camera was orbited to the north side so the strategy table and
both characters are in front of the corridor gantry. The gantry evidence uses
the authored default overview camera.

## Diagnostics

Across 94 polled samples from full- and reduced-motion contexts:

- Renderer: `three`
- Quality tiers observed: `high`, `balanced`
- Peak draw calls: **185 / 200**
- Peak triangles: **171,688 / 200,000**
- Peak detailed rigs: **10 / 16**
- Peak concurrent captions: **4 / 8**
- Peak transition update cost: **0.100 ms**
- Browser console errors: **0**

The handoff action proof was captured while diagnostics reported two active
transitions: the worker's real handoff and the manager's event-driven check-in.
The reduced-motion context reported zero active transitions and zero action
captions after applying the projection-owned final state.
