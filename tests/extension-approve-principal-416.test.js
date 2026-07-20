/**
 * Authenticated approver principal (#416): with
 * approvals.require_authenticated_principal enabled in .rstack/policy.json,
 * the agent-callable sdlc_approve tool can no longer mint APPROVED records —
 * a tool call cannot prove a human is behind it. It refuses with a structured
 * error, queues a PENDING entry for the Business Hub, and the token-verified
 * dashboard path (resolveApproval with tokenVerified actor evidence — exactly
 * what /api/approve stamps after its timing-safe token check) remains the way
 * to unblock the gate. REJECTED stays tool-allowed (fail-closed direction).
 * With the knob off (default), behavior is unchanged but records now carry
 * identity provenance (actor.via='tool', tokenVerified=false).
 *
 * owner: RStack developed by Richardson Gunde
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveApproval } from '../src/core/tracker/approvals.js';
import extension from '../extensions/rstack-sdlc.ts';

function createMockPi() {
  return {
    tools: {},
    commands: {},
    on: () => {},
    registerTool(tool) { this.tools[tool.name] = tool; },
    registerCommand(name, command) { this.commands[name] = command; },
  };
}

function readJsonl(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

test('#416: knob ON — tool APPROVED refused, Hub path unblocks, tool REJECTED still works', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-principal-416-'));
  const previousProjectRoot = process.env.RSTACK_PROJECT_ROOT;
  const previousWebhook = process.env.RSTACK_SLACK_WEBHOOK;
  process.env.RSTACK_PROJECT_ROOT = projectRoot;
  delete process.env.RSTACK_SLACK_WEBHOOK;

  try {
    const pi = createMockPi();
    extension(pi);
    const start = await pi.tools.sdlc_start.execute('1', { goal: 'Principal gate regression' });
    const runId = start.details.run_id;
    const runDir = join(projectRoot, '.rstack', 'runs', runId);
    await pi.tools.sdlc_plan.execute('2', { run_id: runId });

    mkdirSync(join(projectRoot, '.rstack'), { recursive: true });
    writeFileSync(join(projectRoot, '.rstack', 'policy.json'), JSON.stringify({
      approvals: { require_authenticated_principal: true },
    }));

    // The default plan.md gate blocks the first claim.
    const blocked = await pi.tools.sdlc_build_next.execute('3', { run_id: runId });
    assert.match(blocked.content[0].text, /Approval gate blocked/);

    // Tool-path APPROVED is refused: no run-level APPROVED record is minted.
    const refused = await pi.tools.sdlc_approve.execute('4', { run_id: runId, artifact: 'plan.md', status: 'APPROVED' });
    assert.equal(refused.details.error, 'authenticated_principal_required');
    assert.ok(refused.details.approval_id, 'the refusal returns the queued approval id');
    const runApprovals = existsSync(join(runDir, 'approvals.json'))
      ? JSON.parse(readFileSync(join(runDir, 'approvals.json'), 'utf8')) : [];
    assert.ok(!runApprovals.some((r) => r.artifact === 'plan.md' && r.status === 'APPROVED'), 'no APPROVED record from the tool path');

    // The refusal queued a PENDING entry and pinned an event.
    const queue = readJsonl(join(projectRoot, '.rstack', 'approvals.jsonl'));
    assert.ok(queue.some((q) => q.id === refused.details.approval_id && q.status === 'pending'), 'a pending Hub entry is queued');
    const events = readJsonl(join(runDir, 'events.jsonl'));
    assert.ok(events.some((e) => e.type === 'approval_refused_unauthenticated' && e.artifact === 'plan.md'));

    // The gate stays shut.
    const stillBlocked = await pi.tools.sdlc_build_next.execute('5', { run_id: runId });
    assert.match(stillBlocked.content[0].text, /Approval gate blocked/);

    // The authenticated dashboard path (what /api/approve does after its
    // timing-safe token check) resolves the queued entry and unblocks.
    const ok = await resolveApproval(projectRoot, refused.details.approval_id, 'approved', 'Manager Maya', {
      actor: { name: 'Manager Maya', via: 'dashboard', tokenVerified: true, ts: new Date().toISOString() },
    });
    assert.equal(ok, true, 'the token-verified path resolves the approval');
    const afterApprovals = JSON.parse(readFileSync(join(runDir, 'approvals.json'), 'utf8'));
    const hubRecord = afterApprovals.find((r) => r.artifact === 'plan.md' && r.status === 'APPROVED');
    assert.ok(hubRecord, 'the Hub path minted the APPROVED run record');
    assert.equal(hubRecord.source, 'business-hub');
    assert.equal(hubRecord.actor?.tokenVerified, true, 'the record carries token-verified actor evidence');

    const claim = await pi.tools.sdlc_build_next.execute('6', { run_id: runId });
    assert.equal(claim.details.task?.id, '00-environment', 'the gate opens after the authenticated sign-off');

    // REJECTED stays tool-allowed — blocking is the fail-closed direction.
    const reject = await pi.tools.sdlc_approve.execute('7', { run_id: runId, artifact: 'requirements.json', status: 'REJECTED' });
    assert.ok(!reject.details.error, 'REJECTED is not refused');
    const finalApprovals = JSON.parse(readFileSync(join(runDir, 'approvals.json'), 'utf8'));
    assert.ok(finalApprovals.some((r) => r.artifact === 'requirements.json' && r.status === 'REJECTED'));
  } finally {
    if (previousProjectRoot === undefined) delete process.env.RSTACK_PROJECT_ROOT;
    else process.env.RSTACK_PROJECT_ROOT = previousProjectRoot;
    if (previousWebhook !== undefined) process.env.RSTACK_SLACK_WEBHOOK = previousWebhook;
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('#416: knob OFF (default) — tool approvals work and carry identity provenance', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-principal-416-off-'));
  const previousProjectRoot = process.env.RSTACK_PROJECT_ROOT;
  const previousWebhook = process.env.RSTACK_SLACK_WEBHOOK;
  process.env.RSTACK_PROJECT_ROOT = projectRoot;
  delete process.env.RSTACK_SLACK_WEBHOOK;

  try {
    const pi = createMockPi();
    extension(pi);
    const start = await pi.tools.sdlc_start.execute('1', { goal: 'Principal provenance regression' });
    const runId = start.details.run_id;
    await pi.tools.sdlc_plan.execute('2', { run_id: runId });

    const approve = await pi.tools.sdlc_approve.execute('3', { run_id: runId, artifact: 'plan.md', status: 'APPROVED' });
    assert.ok(!approve.details.error, 'default behavior is unchanged');
    const approvals = JSON.parse(readFileSync(join(projectRoot, '.rstack', 'runs', runId, 'approvals.json'), 'utf8'));
    const record = approvals.find((r) => r.artifact === 'plan.md' && r.status === 'APPROVED');
    assert.ok(record, 'APPROVED record lands');
    assert.equal(record.actor?.via, 'tool', 'provenance says the identity came from a tool call');
    assert.equal(record.actor?.tokenVerified, false, 'and was never token-verified');
  } finally {
    if (previousProjectRoot === undefined) delete process.env.RSTACK_PROJECT_ROOT;
    else process.env.RSTACK_PROJECT_ROOT = previousProjectRoot;
    if (previousWebhook !== undefined) process.env.RSTACK_SLACK_WEBHOOK = previousWebhook;
    rmSync(projectRoot, { recursive: true, force: true });
  }
});
