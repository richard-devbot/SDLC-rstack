// owner: RStack developed by Richardson Gunde

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { artifactRenderScript } from '../src/observability/dashboard/ui/artifact-render.js';

// The module ships as a string of browser JS. Evaluate it in a sandbox and
// pull out the pure (DOM-free) render functions to assert on their HTML output.
// renderArtifactInto touches document/navigator but is only defined here, not
// called, so no DOM stub is needed.
const api = new Function(
  artifactRenderScript + '\nreturn { arEsc, arRenderMarkdown, arRenderJson, arRenderJsonl };',
)();

test('arEsc neutralizes HTML metacharacters', () => {
  assert.equal(api.arEsc('<b>&"\'</b>'), '&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;');
});

test('markdown renders headings and lists without leaking raw HTML (XSS)', () => {
  const html = api.arRenderMarkdown('# Title\n\n- one\n- two');
  assert.match(html, /<h1[^>]*>Title<\/h1>/);
  assert.match(html, /<ul[^>]*><li>one<\/li><li>two<\/li><\/ul>/);

  const evil = api.arRenderMarkdown('# <img src=x onerror=alert(1)>');
  assert.match(evil, /&lt;img src=x onerror=alert\(1\)&gt;/, 'raw HTML is escaped');
  assert.doesNotMatch(evil, /<img/, 'no live img tag is emitted');
});

test('markdown links are escaped and open safely; javascript: is not linkified', () => {
  const ok = api.arRenderMarkdown('[docs](https://example.com)');
  assert.match(ok, /<a href="https:\/\/example\.com" target="_blank" rel="noopener noreferrer">docs<\/a>/);
  const bad = api.arRenderMarkdown('[x](javascript:alert(1))');
  assert.doesNotMatch(bad, /<a /, 'non-http scheme is not turned into a link');
});

test('markdown tables render as a table', () => {
  const md = '| Name | Age |\n| --- | --- |\n| Maya | 30 |';
  const html = api.arRenderMarkdown(md);
  assert.match(html, /<table class="ar-table">/);
  assert.match(html, /<th>Name<\/th><th>Age<\/th>/);
  assert.match(html, /<td>Maya<\/td><td>30<\/td>/);
});

test('JSON array of objects renders as a table, object as a keyed tree', () => {
  const html = api.arRenderJson(JSON.stringify([
    { id: 'FR-001', priority: 'high' },
    { id: 'FR-002', priority: 'low' },
  ]));
  assert.match(html, /<table class="ar-table">/);
  assert.match(html, /<th>id<\/th><th>priority<\/th>/);

  const tree = api.arRenderJson(JSON.stringify({ goal: 'ship', count: 3 }));
  assert.match(tree, /<span class="ar-key">goal<\/span>/);
  assert.match(tree, /ship/);
  assert.match(tree, /<span class="ar-number">3<\/span>/);
});

test('JSON string content is escaped, not interpreted', () => {
  const html = api.arRenderJson(JSON.stringify({ note: '<script>alert(1)</script>' }));
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
});

test('invalid JSON degrades to a warning plus raw content', () => {
  const html = api.arRenderJson('{ not json');
  assert.match(html, /ar-warn/);
  assert.match(html, /artifact-content/);
});

test('JSONL renders uniform records as a table', () => {
  const jsonl = [
    JSON.stringify({ type: 'task_started', task: 'a' }),
    JSON.stringify({ type: 'task_validated', task: 'a' }),
  ].join('\n');
  const html = api.arRenderJsonl(jsonl);
  assert.match(html, /2 records/);
  assert.match(html, /<table class="ar-table">/);
  assert.match(html, /task_validated/);
});
