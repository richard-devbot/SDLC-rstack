// owner: RStack developed by Richardson Gunde
//
// Test helper (#405): simulate a *granted* claim on a specific canonical-stage
// task without marching the whole pipeline. sdlc_validate now refuses to
// validate any task that is not the actively claimed IN_PROGRESS attempt
// (status IN_PROGRESS + a _claim nonce written by sdlc_build_next after the
// DoR/approval/guardrail gates pass). Unit tests that exercise validation logic
// for a mid-pipeline stage (architecture, feedback, ...) can't cheaply claim it
// through sdlc_build_next (which claims the first pending stage), so they stamp
// the granted-claim state directly here. This mirrors exactly what the real
// claim path writes — it does not bypass the guard, it satisfies it.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export function claimTaskForTest(projectRoot, runId, taskId, { attempt = 1 } = {}) {
  const tasksPath = join(projectRoot, '.rstack', 'runs', runId, 'tasks.json');
  const state = JSON.parse(readFileSync(tasksPath, 'utf8'));
  const task = state.tasks.find((entry) => entry.id === taskId);
  if (!task) throw new Error(`claimTaskForTest: no task "${taskId}" in run ${runId}. Known: ${state.tasks.map((t) => t.id).join(', ')}`);
  task.status = 'IN_PROGRESS';
  task._started_at = Date.now();
  task._claim = { nonce: `test-claim-${taskId}-${attempt}`, attempt, run_id: runId, claimed_at: new Date().toISOString() };
  if (!task.agent && Array.isArray(task.pipeline_agents) && task.pipeline_agents.length) task.agent = task.pipeline_agents[0];
  writeFileSync(tasksPath, JSON.stringify(state, null, 2));
  // Ensure the task output dir exists so the caller can write builder.json.
  mkdirSync(join(projectRoot, task.output_dir), { recursive: true });
  return task;
}
