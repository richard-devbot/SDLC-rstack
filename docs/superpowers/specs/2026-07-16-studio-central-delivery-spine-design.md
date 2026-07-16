# Studio Central Delivery Spine Design

RStack developed by Richardson Gunde

Status: Approved by the user on 2026-07-16.

Tracks GitHub issue #385, epic #361, and umbrella Studio PR #377. This is a focused
visual correction to the approved interaction-wave design in
`2026-07-15-studio-interaction-wave-design.md`.

## Decision

Replace the overhead corridor gantry and the builder/validator black work-cell docks
with one compact, floor-level fifteen-stage delivery spine centered in the cleared
department strip near `z = -1.5`.

The delivery spine will echo the supplied reference: a slim roller belt runs west to
east, while fifteen small stage consoles alternate along its north and south edges.
It remains visually subordinate to the people and desks, but makes canonical SDLC
progress legible from the default overview camera.

This placement is selected over two alternatives:

- a deeper floor belt near `z = 2`, rejected because it crosses the authored
  builder-to-validator handoff route; and
- a shortened overhead board, rejected because it still interrupts the sightline
  between the default camera and the manager/HQ.

## User outcome

From the default overview, a user can see all fifteen SDLC stages as one connected
company workflow without losing sight of the manager, worker desks, delegation, or
handoff activity. The current and completed portions read immediately, and a quiet
backend produces a quiet pipeline.

## Layout and route safety

- The spine occupies the existing department-dock strip around `z = -1.5`, spanning
  approximately `x = -15.4` to `x = 15.4`.
- Its belt is narrow and floor-level. Stage consoles remain low enough that their
  tops do not obscure the manager or Governance table from the overview camera.
- Fifteen consoles follow canonical stage order west to east and alternate just
  north and south of the belt, reproducing the readable cadence of the supplied
  reference without creating a second wall.
- The corridor spine at `z = -5.5` remains completely clear.
- The builder-to-validator handoff route near `z = 2` remains completely clear.
- The former overhead rails, hanging panels, and gantry room label are removed.
- The existing black `Stage work-cell docks` instances are removed rather than
  relocated; their footprint becomes the delivery spine.

`STUDIO_TOPOLOGY` owns the delivery-spine bounds and stage placement. Office
construction and conveyor rendering consume the same authored values so physical
fixtures, progress packets, labels, and tests cannot drift apart.

## Stage fixtures and progress language

The existing `stageSignals` map remains the single visual contract and contains
exactly fifteen adopted department fixtures. Each compact console exposes:

- a two-digit stage number;
- a short canonical stage label derived from the existing department definition;
- the existing stage status color/state; and
- one small status beacon that is readable without becoming a floating HUD.

The connected belt is the design signature: completed distance reads as a calm
continuous delivery path, the current stage receives the restrained active accent,
and packet motion shows real progress through the company.

The palette stays within the Studio system:

- `Graphite` `#20252B` for the belt and console frames;
- `Warm paper` `#F2EFE7` for stage faces;
- `Pipeline blue` `#2F6FE4` for observed/reached work;
- `Current amber` `#F2A93B` for the active frontier;
- `Evidence mint` `#67D6A3` for completed proof; and
- `Failure red` `#D95B5B` only for backend-reported failure or human attention.

Canvas stage copy continues to use the Studio's existing compact display/body/data
type roles. No new font dependency or generic dashboard chrome is introduced.

## Backend-honest data flow

The server projection remains the only source of work state. Existing projected
department adoption updates the same fifteen `stageSignals` fixtures. Conveyor
packets travel only as far as the furthest reached projected stage; no client timer
advances a stage or invents work.

Reduced motion applies the static final progress state. Stale or disconnected data
freezes packet motion with the rest of the scene. A missing fixture or render asset
falls back to the existing procedural materials and never removes stage facts from
the semantic DOM.

## Components

### Topology

Replace the gantry-specific authored values with a delivery-spine contract containing
the west/east bounds, floor `z`, belt height and width, console offset, console
height, and the shared west-to-east stage interpolation helper.

### Office construction

Rebuild `createPipelineWall` as the compact delivery-spine factory while preserving
its returned `group` and `stageSignals` interface. Remove the independent black dock
mesh from `createStageCells`; department fixtures are now the spine consoles.

### Scene conveyor and label

Move packets from the overhead rail to the belt surface and keep the existing
furthest-reached honesty rule. Place a smaller `15-STAGE DELIVERY PIPELINE` label
beside the center of the spine, angled for the overview camera without covering a
person or route.

## Verification

Tests will pin:

- `stageSignals.size === 15` and canonical west-to-east adoption;
- the delivery spine near `z = -1.5` with no overhead gantry geometry;
- removal of the black work-cell docks;
- clearance from the corridor and builder-to-validator handoff routes;
- conveyor use of the shared spine topology and honest furthest-reached progress;
- reduced-motion/static behavior; and
- the existing draw-call and triangle ceilings of 200/200,000.

Browser proof will use the default overview camera and include the manager seated
with an unobstructed sightline, the full fifteen-stage spine with active packets, a
live handoff/check-in view proving route clearance, and a reduced-motion static
view. Diagnostics will be polled across multiple samples and reported in the PR.

All repository gates from issue #385 remain mandatory before the PR: `npm test` with
`# fail 0`, lint with zero errors, typecheck, validate, the security audit, and
`git diff --check`.
