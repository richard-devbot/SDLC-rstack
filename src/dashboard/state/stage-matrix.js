import { CANONICAL_SDLC_STAGES } from '../../harness/stages.js';

// owner: RStack developed by Richardson Gunde

export function buildStageMatrix(runs) {
  return CANONICAL_SDLC_STAGES.map((stage) => {
    const runStates = (runs ?? []).map((run) => {
      const task = (run.tasks ?? []).find((item) =>
        item.id === stage.id ||
        item.stage_id === stage.id ||
        item.stageId === stage.id ||
        (item.stage_artifacts ?? []).some((artifact) => artifact.stage_id === stage.id)
      );
      const status = task?.status ?? 'READY';
      const validationStatus = task?.validation?.status ?? null;
      return {
        runId: run.runId,
        projectRoot: run.projectRoot,
        status,
        taskId: task?.id ?? null,
        agent: task?.agent_name ?? stage.agent,
        validationStatus,
        riskCount: task?.risk_count ?? 0,
        evidenceCount: task?.evidence_count ?? 0,
      };
    });
    return {
      ...stage,
      runs: runStates,
      pass: runStates.filter((run) => run.status === 'PASS').length,
      fail: runStates.filter((run) => run.status === 'FAIL').length,
      active: runStates.filter((run) => run.status === 'IN_PROGRESS').length,
      ready: runStates.filter((run) => run.status === 'READY' || !run.status).length,
    };
  });
}
