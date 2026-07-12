// owner: RStack developed by Richardson Gunde
//
// Blanket per-stage human gates (#228). Before this module, every approval
// gate was task-keyed: policy.json required_approvals needs exact task ids
// known in advance, so "require human sign-off before every stage" or
// "before any task entering stage X" was impossible to express. Two policy
// surfaces close that gap:
//
//   required_stage_approvals: { "07-code": ["architecture.md"], ... }
//     Stage-id-keyed artifact lists. Any task whose canonical stages include
//     the key must see those artifacts APPROVED before it claims — no task
//     ids required.
//
//   approvals: { every_stage: true }
//     Blanket convenience flag: every task must see a human sign-off
//     artifact `stage-approval:<stage-id>` APPROVED for EVERY canonical
//     stage it enters. Approving a stage once unblocks all tasks entering
//     that stage for the rest of the run (latest-record-wins, run-bound).
//
// Both are explicit team policy, so — like required_approvals — they are
// enforced in EVERY mode, express included. The artifacts returned here are
// merged into the claim gate's required list and flow through the SAME
// audited approval path (#133, run binding #298): malformed or replayed
// records never unblock, queue cards and manager paging come for free.

import { getCanonicalStage } from './stages.js';

export const STAGE_APPROVAL_PREFIX = 'stage-approval:';

export function stageApprovalArtifact(stageId) {
  return `${STAGE_APPROVAL_PREFIX}${stageId}`;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// Pure: the extra artifacts the claim gate must see APPROVED for a task,
// given the run policy and the task's canonical stage ids (taskStageIds —
// the same recipe the rollup, goal gate, and loop reset share, so the gates
// can't disagree about which stages a task enters).
//
// Fail-closed corner: with every_stage on, a task that maps to NO canonical
// stage still gates — on `stage-approval:<taskId>` — because a blanket
// "human sign-off before everything" promise that silently skips unmapped
// tasks would be enforcement by prompt text, not code.
export function requiredStageApprovalArtifacts(policy, stageIds = [], { taskId } = {}) {
  const artifacts = new Set();
  const canonical = [...new Set(
    (Array.isArray(stageIds) ? stageIds : [])
      .filter((id) => typeof id === 'string' && getCanonicalStage(id)),
  )];

  if (policy?.approvals?.every_stage === true) {
    if (canonical.length) {
      for (const stageId of canonical) artifacts.add(stageApprovalArtifact(stageId));
    } else if (typeof taskId === 'string' && taskId.trim()) {
      artifacts.add(stageApprovalArtifact(taskId));
    }
  }

  const byStage = policy?.required_stage_approvals;
  if (isPlainObject(byStage)) {
    for (const stageId of canonical) {
      const entry = byStage[stageId];
      if (!Array.isArray(entry)) continue;
      for (const artifact of entry) {
        if (typeof artifact === 'string' && artifact.trim()) artifacts.add(artifact.trim());
      }
    }
  }

  return [...artifacts];
}
