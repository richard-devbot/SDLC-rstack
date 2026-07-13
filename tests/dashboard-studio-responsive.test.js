/**
 * Responsive and accessibility contracts for Agent Force Studio.
 *
 * owner: RStack developed by Richardson Gunde
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CSS_PATH = join(process.cwd(), 'src', 'observability', 'dashboard', 'ui', 'studio3d', 'styles.css');
const DOM_PATH = join(process.cwd(), 'src', 'observability', 'dashboard', 'ui', 'studio3d', 'dom.js');

test('responsive stylesheet keeps the semantic Studio primary at 390px', () => {
  const css = readFileSync(CSS_PATH, 'utf8');

  assert.match(css, /@media\s*\(max-width:\s*600px\)/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(css, /overflow-x:\s*clip/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /\[data-renderer="semantic-only"\]/);
  assert.doesNotMatch(css, /width:\s*380px/);
});

test('DOM renderer uses semantic buttons, focus restoration, and safe text insertion', () => {
  const source = readFileSync(DOM_PATH, 'utf8');

  assert.match(source, /dataset\.entityKind/);
  assert.match(source, /aria-current/);
  assert.match(source, /identity_confidence/);
  assert.match(source, /trigger\.focus/);
  assert.match(source, /textContent/);
  assert.doesNotMatch(source, /innerHTML\s*=/);
  assert.doesNotMatch(source, /insertAdjacentHTML/);
});

test('live announcements are limited to high-value operational changes', () => {
  const source = readFileSync(DOM_PATH, 'utf8');

  for (const type of ['agent_session_failed', 'agent_waiting', 'handoff_created', 'approval_gate_blocked']) {
    assert.match(source, new RegExp(`'${type}'`));
  }
  assert.doesNotMatch(source, /ANNOUNCED_TYPES[^;]+agent_activity/s);
});
