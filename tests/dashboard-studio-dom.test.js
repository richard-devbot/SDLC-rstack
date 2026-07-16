import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const domSource = readFileSync(join(
  process.cwd(),
  'src', 'observability', 'dashboard', 'ui', 'studio3d', 'dom.js',
), 'utf8');

test('semantic company view mirrors waiting and approval dialogue as text', () => {
  assert.match(domSource, /waitingSemanticText\(session\)/);
  assert.match(domSource, /approvalSemanticText\(studio\.approval_summary \?\? null\)/);
  assert.match(
    domSource,
    /element\(doc, 'span', 'studio-session__waiting', waitingLine\)/,
  );
  assert.match(
    domSource,
    /element\(doc, 'span', 'studio-orchestrator__approval', approvalLine\)/,
  );
  assert.doesNotMatch(domSource, /innerHTML|insertAdjacentHTML/);
});
