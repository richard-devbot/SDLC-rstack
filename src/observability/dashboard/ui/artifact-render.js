// owner: RStack developed by Richardson Gunde

// Human-readable artifact rendering for the Business Hub drawer (issue #89).
// Shipped as a standalone <script> so its globals are available to client.js's
// viewArtifact(). Zero dependencies. All rendering escapes untrusted content
// before producing HTML — stage artifacts are author-controlled but may embed
// arbitrary text, so nothing reaches innerHTML without escaping first.
export const artifactRenderScript = `
var AR_FENCE = String.fromCharCode(96, 96, 96);

function arEsc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function arExt(path) {
  var clean = String(path || '').split('?')[0];
  var dot = clean.lastIndexOf('.');
  return dot === -1 ? '' : clean.slice(dot + 1).toLowerCase();
}

// --- Safe Markdown -> HTML --------------------------------------------------
function arInline(text) {
  // text is already HTML-escaped. Apply inline markdown on the escaped string.
  var out = text;
  // inline code first so its contents are not re-processed
  out = out.replace(/\`([^\`]+)\`/g, function(_m, code) { return '<code>' + code + '</code>'; });
  // links [label](http...) — only http(s), opened safely
  out = out.replace(/\\[([^\\]]+)\\]\\((https?:[^)\\s]+)\\)/g, function(_m, label, url) {
    return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + label + '</a>';
  });
  out = out.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\\*([^*]+)\\*/g, '$1<em>$2</em>');
  return out;
}

function arRenderMarkdown(src) {
  var lines = String(src || '').replace(/\\r\\n/g, '\\n').split('\\n');
  var html = [];
  var i = 0;
  var listType = null;
  function closeList() { if (listType) { html.push('</' + listType + '>'); listType = null; } }
  while (i < lines.length) {
    var line = lines[i];
    // fenced code block
    if (line.indexOf(AR_FENCE) === 0) {
      closeList();
      var code = [];
      i++;
      while (i < lines.length && lines[i].indexOf(AR_FENCE) !== 0) { code.push(lines[i]); i++; }
      i++;
      html.push('<pre class="ar-code"><code>' + arEsc(code.join('\\n')) + '</code></pre>');
      continue;
    }
    // table: a header row followed by a |---|---| separator
    if (/^\\s*\\|.*\\|\\s*$/.test(line) && i + 1 < lines.length && /^\\s*\\|?[\\s:|-]+\\|?\\s*$/.test(lines[i + 1]) && lines[i + 1].indexOf('-') !== -1) {
      closeList();
      var cells = function(row) {
        return row.replace(/^\\s*\\|/, '').replace(/\\|\\s*$/, '').split('|').map(function(c) { return c.trim(); });
      };
      var header = cells(line);
      i += 2;
      var rows = [];
      while (i < lines.length && /^\\s*\\|.*\\|\\s*$/.test(lines[i])) { rows.push(cells(lines[i])); i++; }
      var th = header.map(function(h) { return '<th>' + arInline(arEsc(h)) + '</th>'; }).join('');
      var tb = rows.map(function(r) {
        return '<tr>' + header.map(function(_h, ci) { return '<td>' + arInline(arEsc(r[ci] || '')) + '</td>'; }).join('') + '</tr>';
      }).join('');
      html.push('<div class="ar-tablewrap"><table class="ar-table"><thead><tr>' + th + '</tr></thead><tbody>' + tb + '</tbody></table></div>');
      continue;
    }
    var heading = line.match(/^(#{1,6})\\s+(.*)$/);
    if (heading) {
      closeList();
      var level = heading[1].length;
      html.push('<h' + level + ' class="ar-h ar-h' + level + '">' + arInline(arEsc(heading[2])) + '</h' + level + '>');
      i++;
      continue;
    }
    if (/^\\s*>/.test(line)) {
      closeList();
      html.push('<blockquote class="ar-quote">' + arInline(arEsc(line.replace(/^\\s*>\\s?/, ''))) + '</blockquote>');
      i++;
      continue;
    }
    if (/^\\s*([-*+])\\s+/.test(line)) {
      if (listType !== 'ul') { closeList(); html.push('<ul class="ar-list">'); listType = 'ul'; }
      html.push('<li>' + arInline(arEsc(line.replace(/^\\s*([-*+])\\s+/, ''))) + '</li>');
      i++;
      continue;
    }
    if (/^\\s*\\d+\\.\\s+/.test(line)) {
      if (listType !== 'ol') { closeList(); html.push('<ol class="ar-list">'); listType = 'ol'; }
      html.push('<li>' + arInline(arEsc(line.replace(/^\\s*\\d+\\.\\s+/, ''))) + '</li>');
      i++;
      continue;
    }
    if (/^\\s*([-*_])\\1\\1+\\s*$/.test(line)) { closeList(); html.push('<hr class="ar-hr">'); i++; continue; }
    if (/^\\s*$/.test(line)) { closeList(); i++; continue; }
    closeList();
    html.push('<p class="ar-p">' + arInline(arEsc(line)) + '</p>');
    i++;
  }
  closeList();
  return '<div class="ar-md">' + html.join('') + '</div>';
}

// --- Structured JSON tree ---------------------------------------------------
function arIsTabular(value) {
  if (!Array.isArray(value) || value.length < 2) return false;
  return value.every(function(row) {
    return row && typeof row === 'object' && !Array.isArray(row);
  });
}

function arJsonScalar(value) {
  if (value === null) return '<span class="ar-null">null</span>';
  var t = typeof value;
  if (t === 'number' || t === 'boolean') return '<span class="ar-' + t + '">' + arEsc(value) + '</span>';
  var s = String(value);
  if (s.length > 240) {
    return '<span class="ar-str ar-clamp" onclick="this.classList.toggle(\\'ar-open\\')">' + arEsc(s) + '</span>';
  }
  return '<span class="ar-str">' + arEsc(s) + '</span>';
}

function arJsonTable(rows) {
  var cols = [];
  rows.forEach(function(row) { Object.keys(row).forEach(function(k) { if (cols.indexOf(k) === -1) cols.push(k); }); });
  var th = cols.map(function(c) { return '<th>' + arEsc(c) + '</th>'; }).join('');
  var body = rows.map(function(row) {
    return '<tr>' + cols.map(function(c) {
      var cell = row[c];
      if (cell && typeof cell === 'object') return '<td>' + arJsonNode(cell, '') + '</td>';
      return '<td>' + (cell === undefined ? '<span class="ar-faint">—</span>' : arJsonScalar(cell)) + '</td>';
    }).join('') + '</tr>';
  }).join('');
  return '<div class="ar-tablewrap"><table class="ar-table"><thead><tr>' + th + '</tr></thead><tbody>' + body + '</tbody></table></div>';
}

function arJsonNode(value, key) {
  if (value === null || typeof value !== 'object') {
    return '<div class="ar-row">' + (key ? '<span class="ar-key">' + arEsc(key) + '</span>' : '') + arJsonScalar(value) + '</div>';
  }
  if (arIsTabular(value)) {
    return '<details class="ar-node" open><summary>' + (key ? '<span class="ar-key">' + arEsc(key) + '</span>' : '') +
      '<span class="ar-meta">' + value.length + ' rows</span></summary>' + arJsonTable(value) + '</details>';
  }
  var entries = Array.isArray(value)
    ? value.map(function(v, idx) { return [String(idx), v]; })
    : Object.keys(value).map(function(k) { return [k, value[k]]; });
  var label = Array.isArray(value) ? ('[ ] ' + entries.length) : ('{ } ' + entries.length);
  var children = entries.map(function(pair) { return arJsonNode(pair[1], pair[0]); }).join('');
  return '<details class="ar-node" open><summary>' + (key ? '<span class="ar-key">' + arEsc(key) + '</span>' : '') +
    '<span class="ar-meta">' + label + '</span></summary><div class="ar-children">' + children + '</div></details>';
}

function arRenderJson(content) {
  var parsed;
  try { parsed = JSON.parse(content); }
  catch (err) { return '<div class="ar-warn">Could not parse JSON: ' + arEsc(err.message) + '</div><pre class="artifact-content">' + arEsc(content) + '</pre>'; }
  return '<div class="ar-json">' + arJsonNode(parsed, '') + '</div>';
}

function arRenderJsonl(content) {
  var rows = String(content || '').split('\\n').filter(function(l) { return l.trim(); }).map(function(line, idx) {
    try { return JSON.parse(line); }
    catch (err) { return { _line: idx + 1, _error: 'unparseable', raw: line }; }
  });
  if (!rows.length) return '<div class="ar-warn">No records.</div>';
  if (arIsTabular(rows)) return '<div class="ar-json"><div class="ar-meta ar-jsonl-count">' + rows.length + ' records</div>' + arJsonTable(rows) + '</div>';
  return '<div class="ar-json">' + rows.map(function(r, idx) { return arJsonNode(r, '#' + (idx + 1)); }).join('') + '</div>';
}

// --- entry point ------------------------------------------------------------
function arRenderBody(data) {
  var ext = arExt(data.path);
  if (ext === 'md' || ext === 'markdown') return arRenderMarkdown(data.content);
  if (ext === 'json') return arRenderJson(data.content);
  if (ext === 'jsonl') return arRenderJsonl(data.content);
  return '<pre class="artifact-content">' + arEsc(data.content) + '</pre>';
}

// Renders the artifact into the drawer body with a toolbar (Back / Copy /
// Download / Raw toggle). onBack is invoked when the user returns to the run.
function renderArtifactInto(bodyEl, data, runId, onBack) {
  var ext = arExt(data.path);
  var name = String(data.path || 'artifact').split('/').pop();
  var rich = arRenderBody(data);
  var isRichType = (ext === 'md' || ext === 'markdown' || ext === 'json' || ext === 'jsonl');
  bodyEl.innerHTML =
    '<div class="ar-toolbar">' +
      '<button class="tb-chip ar-back">&larr; Back to run</button>' +
      '<span class="ar-path mono" title="' + arEsc(data.path) + '">' + arEsc(name) + '</span>' +
      '<span class="ar-size">' + Math.ceil((data.size || 0) / 1024) + ' KB</span>' +
      '<span class="ar-spacer"></span>' +
      (isRichType ? '<button class="tb-chip ar-toggle">Raw</button>' : '') +
      '<button class="tb-chip ar-copy">Copy</button>' +
      '<a class="tb-chip ar-dl" href="/api/artifact?run=' + encodeURIComponent(runId) + '&path=' + encodeURIComponent(data.path) + '" download>Download</a>' +
    '</div>' +
    '<div class="panel ar-panel"><div class="panel-body">' +
      '<div class="ar-rich">' + rich + '</div>' +
      '<pre class="artifact-content ar-raw" style="display:none">' + arEsc(data.content) + '</pre>' +
    '</div></div>';
  var back = bodyEl.querySelector('.ar-back');
  if (back) back.addEventListener('click', function() { onBack(); });
  var copy = bodyEl.querySelector('.ar-copy');
  if (copy) copy.addEventListener('click', function() {
    try { navigator.clipboard.writeText(data.content); copy.textContent = 'Copied'; setTimeout(function() { copy.textContent = 'Copy'; }, 1200); }
    catch (err) { copy.textContent = 'Copy failed'; }
  });
  var toggle = bodyEl.querySelector('.ar-toggle');
  if (toggle) toggle.addEventListener('click', function() {
    var richEl = bodyEl.querySelector('.ar-rich');
    var rawEl = bodyEl.querySelector('.ar-raw');
    var showRaw = rawEl.style.display === 'none';
    rawEl.style.display = showRaw ? 'block' : 'none';
    richEl.style.display = showRaw ? 'none' : 'block';
    toggle.textContent = showRaw ? 'Rich' : 'Raw';
  });
}
`;
