<!-- owner: RStack developed by Richardson Gunde -->
# Studio interaction wave — browser verification

Verified 2026-07-16 against the scratch run `interaction-wave-proof` with
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
| Pipeline architecture | [Default overview: compact central 15-stage delivery spine with reached-stage packets](pipeline-live.png) |
| Teammate check-in | [Manager walking to the involved builder desk after `handoff_created`](manager-check-in.png) |
| Live action caption | [`collecting risk-review` during the newly appended capability transition](action-caption.png) |
| Human approval | [Default overview: manager and approver at the strategy table with both speech bubbles](approval-conversation.png) |
| Reduced motion | [Static approval final state with zero active transitions and no action-caption fade](reduced-motion.png) |

The central pipeline, manager, handoff, approval, and reduced-motion evidence
all use the authored default overview camera. The former overhead gantry and
black stage work-cell docks are absent. Fifteen numbered canonical stage cards
run west-to-east on the low floor spine, and the compact pipeline room label no
longer covers the manager or the progress cards.

## Diagnostics

Across 60 polled samples from full- and reduced-motion contexts:

- Renderer: `three`
- Quality tiers observed: `balanced`, `low`
- Peak draw calls: **186 / 200**
- Peak triangles: **171,844 / 200,000**
- Peak detailed rigs: **10 / 16**
- Peak concurrent captions: **4 / 8**
- Peak concurrent action captions: **2**
- Peak transition update cost: **0.100 ms**
- Browser console errors: **0**

The handoff proof was captured while the manager's real event-driven check-in
was active. The capability proof was captured from an event appended after page
load. The reduced-motion context reported zero active transitions and zero
action captions after applying the projection-owned final state.
