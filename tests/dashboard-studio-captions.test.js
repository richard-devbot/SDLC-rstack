import assert from 'node:assert/strict';
import test from 'node:test';

import {
  approvalCaptionFacts,
  approvalSemanticText,
  MAX_CAPTIONS,
  selectCaptionFacts,
  transitionCaptionFact,
  truncateCaption,
  waitingCaptionFacts,
  waitingSemanticText,
} from '../src/observability/dashboard/ui/studio3d/captions.js';

function transition(action, event = {}, options = {}) {
  return {
    id: options.id ?? `${action}-1`,
    intent: { action, sessionId: options.sessionId ?? 'builder-1' },
    event,
    started_at_ms: options.startedAt ?? 100,
  };
}

test('approval and waiting captions use projected facts with correct pluralization', () => {
  assert.deepEqual(
    approvalCaptionFacts({ pending_count: 1, artifact: 'Release candidate' }).map((fact) => fact.text),
    [
      'Requesting approval · Release candidate',
      'Reviewing 1 pending approval',
      'Awaiting human sign-off',
    ],
  );
  assert.equal(
    approvalCaptionFacts({ pending_count: 2, artifact: '2 pending' })[1].text,
    'Reviewing 2 pending approvals',
  );
  const waiting = { id: 's-1', status: 'waiting', waiting_reason: 'approval' };
  assert.equal(waitingCaptionFacts([waiting])[0].text, 'Waiting · approval');
  assert.equal(waitingSemanticText(waiting), 'Waiting · approval');
  assert.equal(
    approvalSemanticText({ pending_count: 1, artifact: 'Release candidate' }),
    'Human approval · 1 pending approval · Release candidate',
  );
  assert.equal(approvalCaptionFacts({ pending_count: 0, artifact: 'ignored' }).length, 0);
  assert.equal(approvalSemanticText(null), '');
});

test('caption text is normalized, literal, and bounded', () => {
  assert.equal(truncateCaption('x'.repeat(80), 32), `${'x'.repeat(31)}…`);
  assert.equal(
    truncateCaption('  <img onerror=alert(1)>\u0000\n  literal  ', 80),
    '<img onerror=alert(1)> literal',
  );
  assert.ok(approvalCaptionFacts({
    pending_count: 1,
    artifact: 'artifact '.repeat(20),
  })[0].text.length <= 48);
});

test('transition captions name only lifecycle-backed actions', () => {
  assert.equal(
    transitionCaptionFact(transition('collect_capabilities', { skill_ids: ['risk-review'] })).text,
    'collecting risk-review',
  );
  assert.equal(
    transitionCaptionFact(transition('delegate', { role: 'builder' })).text,
    'delegating → builder',
  );
  assert.equal(
    transitionCaptionFact(transition('handoff', { to: 'validator' })).text,
    'handoff → validator',
  );
  assert.equal(
    transitionCaptionFact(transition('return_evidence', { evidence_refs: ['result.json'] })).text,
    'delivering evidence',
  );
  assert.equal(
    transitionCaptionFact(transition('retry', { attempt: 3 })).text,
    'retrying (attempt 3)',
  );
  assert.equal(
    transitionCaptionFact(transition('manager_check_in')).text,
    'walking to desk',
  );
  assert.equal(transitionCaptionFact(transition('idle')), null);
  assert.equal(
    transitionCaptionFact(transition('retry')).text,
    'retrying',
  );
});

test('caption selection is capped and stable by priority, recency, then distance', () => {
  const facts = Array.from({ length: MAX_CAPTIONS + 3 }, (_, index) => ({
    id: `fact-${index}`,
    text: `Fact ${index}`,
    priority: index === 10 ? 100 : 60,
    timestamp: index === 9 ? 500 : 100,
    distance: index === 8 ? 1 : 20,
  }));
  const selected = selectCaptionFacts(facts);

  assert.equal(selected.length, MAX_CAPTIONS);
  assert.deepEqual(selected.slice(0, 3).map((fact) => fact.id), [
    'fact-10',
    'fact-9',
    'fact-8',
  ]);
});
