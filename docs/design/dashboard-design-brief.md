# RStack Business Hub — Dashboard Design Brief

<!-- owner: RStack developed by Richardson Gunde -->
<!-- date: 2026-06-10 | feeds: issues #87-#95, #97 -->

**Scope:** SDLC pipeline observability — runs, stages, gates, approvals, security/compliance/cost governance. Vanilla JS + hand-written CSS, no build step, dark-first with full light mode.
**Audience:** implementation agents. Follow values verbatim; deviate only with a stated reason.

---

## 1. Design Principles (5)

1. **Status before everything.** The answer to "is anything broken or waiting on me?" must be visible within 1 second of page load, above the fold, without interaction. Every page leads with state, not navigation. *(Pattern: Vercel deployments list, Datadog monitor list)*
2. **Freshness is a first-class signal.** Every panel that shows live data carries a visible "Updated Xs ago" timestamp. Data older than 2× its poll interval flips to a stale treatment (§8). Never let a user mistake dead data for live data. *(Pattern: Grafana refresh picker)*
3. **Density with hierarchy.** Operators want many rows per screen (Linear-grade density: 13px UI text, 40px rows), but density only works with strict hierarchy: one font family, two text colors doing 90% of the work, whitespace — not boxes-in-boxes — creating grouping. *(linear.app)*
4. **Color never encodes alone.** Every status is a triple: color + icon shape + text label. Colorblind operators and grayscale printouts must read identically. *(WCAG 1.4.1)*
5. **Monochrome canvas, semantic accents only.** The chrome is grayscale. Saturated color is reserved exclusively for state (pass/fail/working/blocked/queued) and the single brand accent. If everything is colorful, nothing is urgent. *(Vercel Geist)*

---

## 2. Layout System

### App shell
- **Sidebar:** 240px expanded, **56px icon rail** collapsed. Toggle with `Cmd/Ctrl+B`; persist state in `localStorage`. Collapsed rail shows 20px icons with tooltips on 300ms hover delay. *(Linear)*
- **Sidebar grouping:** sections with 11px/600 uppercase headers, `letter-spacing: 0.05em`, muted color. Groups per issue #88: **Deliver · Quality · Govern · Operate**. Active item: 6px-radius pill background (`--bg-2`) + 2px accent bar on left edge. Item height 32px.
- **Topbar:** 48px fixed. Left→right: breadcrumb (Project / Run #id), global freshness indicator ("Live · updated 8s ago" with pulsing dot), refresh-interval picker (Off/10s/30s/1m — Grafana pattern), alert bell with count badge, theme toggle.
- **Keyboard-first:** `Cmd/Ctrl+K` command palette (jump to run, approve gate, filter), `j/k` row navigation in lists, `Enter` to drill in, `Esc` to close panels. *(Linear)*

### Spacing scale (4px base — use only these values)
`4, 8, 12, 16, 24, 32, 48, 64` px.
- Card padding: **16px** (dense panels) / **24px** (KPI cards).
- Grid gutter: **16px**. Page margin: **24px**. Section gap: **32px**.

### Grid rules
- Fluid 12-column CSS grid, design target 1440px, min supported 1280px (degrade gracefully to 640px).
- KPI row: `grid-template-columns: repeat(auto-fit, minmax(220px, 1fr))` — never more than 6 KPI cards in one row.
- Main content: 8-col primary + 4-col rail (alerts/approvals feed) at ≥1280px; stack below.
- Drill-down opens as a **480px right-side panel** (not navigation away) for run/stage detail; full page only for run report. *(Datadog side-panel pattern)*

---

## 3. Color System

Implement as CSS custom properties on `:root` (light) and `[data-theme="dark"]`. Semantic hexes follow GitHub Primer's scales (battle-tested for both modes).

### Neutral ramp
| Token | Dark | Light | Use |
|---|---|---|---|
| `--bg-0` | `#0e0f12` | `#fafafa` | app canvas |
| `--bg-1` | `#16181d` | `#ffffff` | card/surface |
| `--bg-2` | `#1d2127` | `#f1f2f4` | hover, active pill, inputs |
| `--border-subtle` | `#23262e` | `#e9eaec` | card borders, dividers |
| `--border-strong` | `#343943` | `#d4d6da` | inputs, focused cards |
| `--text-1` | `#e6e8ec` | `#18181b` | primary text, values |
| `--text-2` | `#9ba1ac` | `#52525b` | labels, secondary |
| `--text-3` | `#646b76` | `#8e9196` | placeholders, disabled |

Cards = `--bg-1` + 1px `--border-subtle` + `border-radius: 8px`. **No box-shadows in dark mode** — borders and background steps do elevation. *(Geist/Linear convention)*

### Semantic states — the canonical six
| State | Dark | Light | Icon (mandatory pair) | Motion |
|---|---|---|---|---|
| **queued** | `#8b949e` | `#59636e` | hollow circle ◯ | none |
| **live/working** | `#4493f8` | `#0969da` | filled dot ● | 2s opacity pulse (0.4↔1) |
| **pass** | `#3fb950` | `#1a7f37` | check ✓ | none |
| **blocked / awaiting gate** | `#d29922` | `#9a6700` | shield/pause ⏸ | none |
| **fail** | `#f85149` | `#d1242f` | X ✕ | none |
| **skipped/canceled** | `#646b76` | `#8e9196` | slash ⊘, strikethrough label | none |

- Brand accent (links, focus, primary button): `#6e7bf2` dark / `#4f5ae8` light — used for *interaction*, never for *state*.
- Tinted chip backgrounds: state color at **12% opacity** dark, **10%** light (e.g., `rgba(63,185,80,.12)`).
- **Rule:** color never appears without its icon and/or text label (Principle 4). Animated pulse is reserved for "working" exclusively — nothing else on screen may pulse.

---

## 4. Typography

```css
--font-ui:   Inter, -apple-system, "Segoe UI", system-ui, sans-serif;
--font-mono: "JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace;
```
System-font fallbacks are acceptable if self-hosting woff2 is out of scope for a PR. Enable `font-variant-numeric: tabular-nums` on **all numeric cells, KPIs, and timers** so digits don't jitter on refresh. *(Stripe convention)*

| Role | Size/weight | Notes |
|---|---|---|
| KPI value | **28px/650** | tabular-nums, `--text-1`, line-height 1.1 |
| KPI delta | 13px/500 | paired arrow ▲▼ + state color |
| Page title | 18px/600 | one per page |
| Section/card title | 14px/600 | |
| Body / table cells | **13px/450** | line-height 1.5 |
| Labels / column headers | 11px/600 | uppercase, `letter-spacing: 0.05em`, `--text-2` |
| Chips, timestamps | 12px/500 | |
| **Mono usage** | 12px/450 | run ids, commit SHAs, stage ids, durations in tables, JSON keys — anything an operator might copy |

---

## 5. Component Anatomy

### KPI metric card *(Stripe/Tremor pattern)*
Stack top→bottom in a 24px-padded card: **label** (11px uppercase `--text-2`) → **value** (28px/650 tabular) with optional unit suffix at 14px → **delta row** (▲ 12% · "vs prev 7 runs", state-colored arrow+number, muted comparator text) → **sparkline** (full card width, 36px tall, 1.5px line in `--text-2`, last point as 3px dot in state color, no axes, no gridlines). Whole card hover: `--border-strong`; click drills to its detail view.

### Status chip
Height 22px, padding 2px 8px, radius 999px, 12px/500 label, 12px icon left, tinted background (12% state color), text in state color, **no border**. Working chip animates icon only, not text. Exact label vocabulary: `Queued · Running · Passed · Blocked · Failed · Skipped`.

### Data table *(Linear density + Vercel restraint)*
- Row height **40px** (32px in "dense" toggle). Header row 36px, sticky, `--bg-0` background.
- Borders: horizontal `--border-subtle` only — no vertical rules, no zebra striping.
- Hover: full-row `--bg-2`; row is one click target; chevron affordance appears on hover at row end.
- Numerics + durations right-aligned, tabular-nums; ids in mono with click-to-copy.
- Sort: sortable headers show ↕ at 40% opacity on hover; active sort column header in `--text-1` + solid ▲/▼; one sort at a time.
- First column is always the status chip; second is the name/id.

### Timeline / Gantt row (stage durations within a run)
Row = 28px: stage name (160px fixed, truncate with title tooltip) + horizontal bar lane. Bar: 12px tall, 3px radius, fill = state color at 70% opacity with 2px solid leading edge; queued time renders as hatched segment before the solid segment. Time axis on top only, 11px labels, gridlines at "nice" intervals (1m/5m/15m). Hover bar → tooltip: stage id (mono), start, duration, status. *(Buildkite waterfall)*

### Empty state
Centered in panel, max 320px wide: 24px muted icon → 14px/600 one-line headline ("No runs yet") → 13px `--text-2` one-line hint ("Start a pipeline to see runs here.") → one primary action button. No illustrations >48px.

### Error / stale state — **never blank a panel that had data**
- **Stale:** keep last data rendered at 60% opacity, overlay a top-of-panel strip: amber clock icon + "Stale — last updated 4m 12s ago" + Retry link.
- **Error:** same structure, red, "Failed to load — Retry". Auto-retry with backoff; show countdown.
- Global staleness: if the poll loop dies, topbar freshness pill turns amber and announces via `aria-live` (§9).

---

## 6. Data-Viz Rules

| Need | Chart | Never |
|---|---|---|
| Trend at a glance, in a card | **Sparkline** (no axes) | sparkline with >1 series |
| Compare stage durations / costs across categories | **Horizontal bar**, sorted desc | vertical bars with rotated labels |
| Part-to-whole (cost by category, gate outcomes) | **Donut** only if ≤5 segments, 70% inner radius, KPI in center; otherwise **single stacked horizontal bar** | pie, 3D anything |
| Activity by time (run frequency, failures) | **Heatmap**, 5-step single-hue ramp from `--bg-2` to state color | rainbow ramps |
| Metrics over time | **Line/area**, area fill ≤8% opacity | dual y-axes |

- **Max 6 series** per time-series panel; beyond that show top 5 + "other" and a "view all" drill-down.
- Axes: 4–5 horizontal gridlines in `--border-subtle`, **no vertical gridlines**, 11px labels, SI-abbreviated values (`1.2k`, `$3.4k`), y-axis starts at 0 for bars (always) and for lines unless variance <10% of value.
- **Count-up animation:** KPI values count up over **400ms, ease-out, max 600ms**, on first paint only — never on poll refresh (refresh swaps numbers instantly; tabular-nums prevents jitter). Disable entirely under `prefers-reduced-motion`. No other chart entrance animations.

---

## 7. Pipeline Visualization — the 15-stage + gates pattern

**Best-in-class reference: Buildkite's horizontal step bar** (pipeline steps as a compact chip row with explicit "block step" gates), which beats GitHub Actions' DAG graph (superb for fan-out, wasteful and scroll-heavy for a mostly-linear 15-stage chain). Adopt Buildkite's model with GitHub's status iconography:

1. **Run-list view (compact):** each run row contains a **segment bar** — 15 contiguous 6px-tall segments, 1px gaps, each segment filled with its stage's state color. Reads like a progress bar that also shows *where* it failed. Hover a segment → tooltip with stage name + status.
2. **Run-detail view (full):** a single horizontal row of **stage chips** (status icon + stage name, 28px tall), connected by 16px connector lines in `--border-subtle`. **Gates render as distinct diamond nodes** (18px, rotated square) on the connector *between* stages — amber pulsing-border when awaiting approval, with an inline "Approve" button surfacing on hover/focus; green check when passed; red when rejected. Current stage chip carries the pulsing working dot. At <1280px the row wraps to two lines; never horizontal-scroll.
3. **Drill-down:** clicking a stage chip opens the 480px side panel (§2) with the stage's Gantt row, artifacts, and contract JSON — the "list → side panel → full page" three-depth pattern. Optional stages (11–14) render at 50% opacity with the skipped icon when not in the run's plan.

---

## 8. Freshness pill spec

`● Live · 8s ago` (working-blue dot) → after 2× interval: `◐ Stale · 2m ago` (amber) → after error: `✕ Disconnected — data as of 14:32:05` (red) + retry countdown. One component, three states, used in topbar and per-panel. (Implements issue #87.)

---

## 9. Accessibility Specifics

- **Contrast:** body/label text ≥ **4.5:1** against its background; KPI values and large text (≥24px) ≥ 3:1; **non-text UI (chips, icons, chart strokes, focus ring) ≥ 3:1** (WCAG 2.2). Verify any new tint before merging.
- **Focus ring:** `:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }` on every interactive element — never `outline: none` without replacement.
- **Live regions:** one global `<div role="status" aria-live="polite">` announcing run-state transitions ("Run 8f3a21: stage Testing passed"); gate-blocked and run-failed events go to a separate `role="alert"` (assertive) region. Debounce announcements to ≥1 per 2s; never put the ticking "updated Xs ago" timer in a live region.
- Keyboard: full operation of tables (j/k/Enter), gate approval, and side panel without a pointer; panel traps focus and `Esc` closes, returning focus to the originating row.
- `prefers-reduced-motion: reduce` kills the working pulse (static dot + "Running" text), count-ups, and panel transitions.
- Charts: every chart gets `role="img"` + `aria-label` summarizing the headline, plus a "view as table" toggle for the data.

---

*Authored 2026-06-10. Semantic state hexes verified against GitHub Primer scales; neutral ramp and component patterns derived from Geist (Vercel), Linear, Stripe, Tremor, Buildkite, Grafana.*
