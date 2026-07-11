<!-- owner: RStack developed by Richardson Gunde -->

# Business Flex Policy Trust Design

**Issue:** #277 — Show configured Business Flex profile and enforced budget before the first run

**Status:** Approved for implementation. The GitHub issue defines the accepted outcomes, data contract, UX states, and verification evidence; the user asked Codex to implement the UI issues sequentially.

## Problem

Business Flex currently derives profile and planned-budget facts only from run snapshots. Cost & Budget derives the enforced cap from run rows. An initialized project with a valid `.rstack/rstack.config.json` and `.rstack/budget.json`, but no runs, therefore appears unconfigured. This contradicts the policy the harness will enforce and collapses four different states—configured, missing, invalid, and inaccessible—into the same empty screen.

The product must keep three kinds of fact separate:

1. **Current configured policy** — what the selected project files say now.
2. **Historical run snapshot** — what profile and budget were copied into a run when it executed.
3. **Observed consumption** — persisted or event-derived telemetry, which may not exist yet.

## Approaches considered

### A. Extend `loopBudgets` and keep run-derived profiles

This is the smallest patch, but it preserves two competing policy models and still cannot represent malformed files, profile configuration before the first run, or historical drift. Rejected.

### B. Build policy in the browser from state roots

This could render quickly, but it would expose filesystem concepts to client code and create a second validation authority. It also breaks the server-owned scope boundary introduced by #276. Rejected.

### C. Server-owned policy ledger with separate telemetry and snapshots

The dashboard state layer reads each selected root once, applies the harness validators, and emits an explicit policy ledger. Business Flex and Cost & Budget consume that shared contract. Runs retain their copied policy as historical evidence. Recommended and selected.

## Data contract

`businessFlex` remains the top-level client field for compatibility and gains four explicit sections:

```js
{
  configuredPolicy: {
    projects: [{
      projectId,
      projectRoot,
      projectName,
      worktreeName,
      availability, // configured | missing | invalid | inaccessible
      profile: {
        availability,
        id,
        name,
        workflow,
        enabledDomains,
        enabledAgents,
        enabledPlugins,
        dashboardPages,
        sourcePath,
        issues,
      },
      budget: {
        availability,
        currency,
        runBudgetUsd,
        dailyBudgetUsd,
        monthlyBudgetUsd,
        sourcePath,
        issues,
      },
      loadedAt,
    }],
  },
  observedConsumption: {
    availability, // available | unavailable
    runCount,
    runsWithTelemetry,
    totalCostUsd,
    metricsSources,
    lastMeasuredAt,
  },
  plannedEnvelopes: {
    runBudgetTotal,
    estimatedTaskBudget,
    tasksWithBudget,
  },
  runSnapshots: [{
    runId,
    runKey,
    projectId,
    projectRoot,
    profile,
    budget,
    comparison, // current | differs | unavailable
    differences,
  }],
  profiles,
  budget,
  routingSignals,
}
```

The legacy `profiles` and `budget` fields stay present during this wave so existing consumers and historical tests do not break. They represent run snapshots only; new UI must use the explicit sections.

## Policy loading and validation

Create `state/configured-policy.js` as the single reader for the two policy files. It will:

- receive the already-scoped project roots and project descriptors from `buildFullState`;
- read `.rstack/rstack.config.json` and `.rstack/budget.json` without applying defaults when a file is absent or invalid;
- call the exported harness validators `validateRstackConfig` and `validateBudgetConfig` for field semantics;
- merge a valid configured profile over the matching built-in profile so enabled teams and workflow are complete;
- treat only finite non-negative configured caps as enforced values;
- preserve `0` as a real enforced cap;
- classify filesystem permission failures as `inaccessible`, syntax/shape/field problems as `invalid`, absent files as `missing`, and valid files as `configured`;
- name the source file and project on every policy record.

No configured cap is inferred from profile defaults. This matches `evaluateLoopBudget`, which arms the cost brake only from a valid `.rstack/budget.json` `run_budget_usd` value.

## State assembly and scope

`buildFullState` loads configured policy after #276 has selected trusted roots and descriptors, then passes it into `buildBusinessFlexState`. Global scope may contain several project policies; project scope contains only that project; run scope contains the current project policy plus the selected run snapshot.

Observed consumption is derived only from scoped run telemetry. A configured cap never becomes consumption, and a missing telemetry stream never becomes `$0.00`.

Each run snapshot is compared with the current project policy. Differences cover profile ID, workflow, and run/day/month caps. A mismatch is evidence, not an error: the UI says the run used an earlier snapshot and shows both values.

## UX design

The visual concept is a **policy ledger**: a restrained, source-linked band that reads left to right as current configuration, enforced limits, then observed use. This is deliberately different from generic KPI cards because order encodes the trust chain.

### Business Flex

- Lead with “Configured operating policy,” not run count.
- Show profile name and workflow before any run exists.
- Show run/day/month limits together with `.rstack` provenance and project identity.
- Use precise status copy: “Configured,” “Invalid configuration,” “Configuration unavailable,” or “Policy file missing.”
- Keep “No telemetry yet” in a visually separate consumption lane.
- List historical run snapshots below; mark “Policy changed since this run” when values differ.
- Invalid, missing, and inaccessible states include an “Open Diagnostics” action.

### Cost & Budget

- Place current enforced policy above run consumption.
- Render project-level run/day/month limits even with zero runs.
- Reserve “No cap configured” for a valid budget file that truly omits the named cap.
- Render consumption bars only for runs and label whether the bar uses the current cap or the run’s historical snapshot.
- Preserve existing actual-spend and metrics-provenance panels.

### Responsive and accessibility

- Policy ledger collapses to one column at the existing mobile breakpoint.
- Buttons and interactive rows remain at least 44px high.
- Availability is communicated by text and iconography, never color alone.
- Source paths use readable text and do not expose opaque scope keys.
- Motion is limited to existing state transitions; policy truth must not depend on animation.

## Error and empty states

| State | UI headline | Meaning |
|---|---|---|
| Configured, no runs | Configured · No telemetry yet | Policy is active; nothing has been measured. |
| Configured with telemetry | Configured · Actual consumption available | Policy and observed use are both known. |
| Run snapshot differs | Policy changed since this run | Historical and current values are both shown. |
| Missing file | Policy file missing | The harness has no file-backed policy for that concern. |
| Invalid file | Invalid configuration | Harness validator issues are shown; invalid values are not claimed enforced. |
| Inaccessible file | Configuration unavailable | The dashboard could not read the file; no fallback is presented as configured. |
| Valid file omits cap | No cap configured | This phrase is allowed only in this state. |

## Verification

Automated tests must cover:

- valid profile plus 10/50/500 budget with zero runs;
- valid policy and telemetry without conflating cap and spend;
- missing profile and/or budget files;
- malformed JSON, invalid field values, and injected inaccessible reads;
- zero-valued caps;
- a run snapshot that differs from current root policy;
- multi-project scoping and project provenance;
- rendered Business Flex and Cost & Budget copy for every state;
- Diagnostics navigation from invalid/unavailable states;
- no runtime demo/sample budget.

Browser verification must capture configured/no-telemetry and invalid-policy states at desktop and 390px, check keyboard focus/44px targets, and report console errors.

