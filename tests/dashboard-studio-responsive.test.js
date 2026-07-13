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
const APP_PATH = join(process.cwd(), 'src', 'observability', 'dashboard', 'ui', 'studio3d', 'app.js');

test('responsive stylesheet keeps the semantic Studio primary at 390px', () => {
  const css = readFileSync(CSS_PATH, 'utf8');

  assert.match(css, /@media\s*\(max-width:\s*600px\)/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(css, /overflow-x:\s*clip/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(css, /\.studio-scope select[^}]+width:\s*100%/s);
  assert.match(css, /\.studio-fallback\s*{[^}]*position:\s*static/s);
  assert.match(css, /:focus-visible/);
  assert.match(css, /\[data-renderer="semantic-only"\]/);
  // The cutaway office revision removed every world-space text surface.
  assert.doesNotMatch(css, /studio-overlays|studio-world-label/);
  assert.doesNotMatch(css, /width:\s*380px/);
});

test('semantic-only view keeps a clearly labelled path back to 3D', () => {
  const source = readFileSync(APP_PATH, 'utf8');

  assert.match(source, /semanticButton\.textContent\s*=\s*semanticOnly\s*\?\s*'Show 3D view'\s*:\s*'Semantic view'/);
});

test('DOM renderer uses semantic buttons, focus restoration, and safe text insertion', () => {
  const source = readFileSync(DOM_PATH, 'utf8');

  assert.match(source, /dataset\.entityKind/);
  assert.match(source, /aria-current/);
  assert.match(source, /identity_confidence/);
  for (const field of ['stage_ids', 'activity_class', 'skill_ids', 'plugin_ids', 'specialist_ids', 'source', 'last_activity_at']) {
    assert.match(source, new RegExp(`${field}\\b`));
  }
  assert.match(source, /trigger\.focus/);
  assert.match(source, /textContent/);
  assert.doesNotMatch(source, /innerHTML\s*=/);
  assert.doesNotMatch(source, /insertAdjacentHTML/);
});

test('live announcements are limited to high-value operational changes', () => {
  const source = readFileSync(DOM_PATH, 'utf8');

  for (const type of ['agent_session_failed', 'agent_waiting', 'handoff_created', 'approval_gate_blocked', 'artifact_emitted', 'agent_session_completed']) {
    assert.match(source, new RegExp(`'${type}'`));
  }
  assert.doesNotMatch(source, /ANNOUNCED_TYPES[^;]+agent_activity/s);
});

test('canvas selection returns through the existing semantic inspector path', () => {
  const source = readFileSync(APP_PATH, 'utf8');
  assert.doesNotMatch(source, /studio-overlays|overlayRoot/);
  assert.match(source, /dom\.select\(ref/);
  assert.match(source, /studioDrawCalls/);
  assert.doesNotMatch(source, /innerHTML\s*=/);
});
