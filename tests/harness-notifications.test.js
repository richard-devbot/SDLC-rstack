import test from 'node:test';
import assert from 'node:assert/strict';
import { formatSlackStageMessage, sendSlackNotification } from '../src/harness/notifications.js';

// owner: RStack developed by Richardson Gunde

test('formatSlackStageMessage structures correct Slack payload schema', () => {
  const payload = formatSlackStageMessage('run-001', '07-code', 'PASS', {
    cost: '0.14',
    attempt: '1/2',
    message: 'All unit tests passed within Builder Sandbox.',
  });

  assert.ok(payload.attachments, 'Payload must have attachments');
  const attachment = payload.attachments[0];
  assert.equal(attachment.color, '#22c55e', 'PASS status should use green color');

  const blocks = attachment.blocks;
  assert.equal(blocks[0].type, 'section');
  assert.ok(blocks[0].text.text.includes('✅'));
  assert.ok(blocks[0].text.text.includes('PASS'));

  const fields = blocks[1].fields;
  assert.equal(fields[0].text, '*Run ID:*\nrun-001');
  assert.equal(fields[1].text, '*Stage:*\n07-code');
  assert.equal(fields[2].text, '*Status:*\nPASS');
  assert.equal(fields[3].text, '*Cost Cap:*\n$0.14');
  assert.equal(fields[4].text, '*Sandbox Attempt:*\n1/2');

  assert.equal(blocks[2].type, 'section');
  assert.ok(blocks[2].text.text.includes('Builder Sandbox'));
});

test('sendSlackNotification defaults gracefully to log output when webhook is undefined', async () => {
  const status = await sendSlackNotification(undefined, { text: 'test' });
  assert.equal(status, 'unconfigured');
});
