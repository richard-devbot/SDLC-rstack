// owner: RStack developed by Richardson Gunde
//
// #213: the episode_memory_skipped_untrusted event (a policy-skipped memory
// write under validator-approved-only) is persisted to events.jsonl but was
// invisible in the reporter — absent from KNOWN_EVENT_TYPES and the memory_events
// router, so it never reached the run report or its HTML. These pins prove it is
// now aggregated into the task's memory_events and rendered.

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { buildRunReport, renderDashboardHtml, renderTraceHtml } from '../src/observability/collectors/reporter.js';

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
}

test('#213 episode_memory_skipped_untrusted is aggregated and rendered by the reporter', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'rstack-skip-213-'));
  const runId = '2026-07-05T00-00-00-skip';
  const runDir = path.join(projectRoot, '.rstack', 'runs', runId);

  await writeJson(path.join(runDir, 'manifest.json'), {
    run_id: runId, goal: 'Skip-event visibility', created_at: '2026-07-05T00:00:00.000Z', framework: 'pi',
  });
  await writeJson(path.join(runDir, 'tasks.json'), {
    tasks: [{ id: '004-implementation', title: 'Implementation', status: 'FAIL' }],
  });
  await writeFile(path.join(runDir, 'events.jsonl'), [
    { ts: '2026-07-05T00:00:01.000Z', type: 'task_started', task_id: '004-implementation' },
    { ts: '2026-07-05T00:00:02.000Z', type: 'episode_memory_skipped_untrusted', task_id: '004-implementation', episode_id: 'ep_x', reason: 'not-validator-approved', write_policy: 'validator-approved-only' },
    { ts: '2026-07-05T00:00:03.000Z', type: 'task_validated', task_id: '004-implementation', status: 'FAIL' },
  ].map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');

  const report = await buildRunReport(runDir);
  const trace = report.tasks['004-implementation'];
  assert.ok(trace, 'task trace exists');

  const skip = trace.memory_events.find((e) => e.type === 'episode_memory_skipped_untrusted');
  assert.ok(skip, 'skip event is routed into the task memory_events (KNOWN_EVENT_TYPES + router)');
  assert.equal(skip.reason, 'not-validator-approved');
  assert.equal(skip.write_policy, 'validator-approved-only');

  // Dashboard HTML surfaces the per-task skipped COUNT in the memory column.
  const dashHtml = renderDashboardHtml(report);
  assert.match(dashHtml, /skipped/, 'dashboard task row shows the skipped count (memStatus)');

  // The per-task trace HTML surfaces the detailed skip line with reason + policy.
  const traceHtml = renderTraceHtml(trace, runId);
  assert.match(traceHtml, /skipped as untrusted/i, 'trace HTML renders the skip with its reason');
  assert.match(traceHtml, /validator-approved-only/, 'trace HTML surfaces the write policy that skipped it');
});
