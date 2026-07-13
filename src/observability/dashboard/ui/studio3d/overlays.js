/**
 * Safe projected labels for the Agent Force living company.
 *
 * Labels mirror high-value projection facts with textContent. They remain
 * aria-hidden because the semantic Studio is the canonical reading and
 * keyboard interaction tree.
 *
 * owner: RStack developed by Richardson Gunde
 */
import * as THREE from 'three';

const HIGH_VALUE = new Set(['starting', 'active', 'waiting', 'blocked', 'failed']);

function keyFor(ref) {
  return ref ? `${ref.kind}:${ref.id}` : null;
}

function labelText(key, data) {
  const title = data.agent_id ?? data.title ?? data.goal ?? data.id ?? 'Observed entity';
  const detail = key.startsWith('session:')
    ? data.waiting_reason ?? data.activity_class ?? data.status ?? 'Observed'
    : data.status ?? data.source ?? 'Observed';
  return { title: String(title), detail: String(detail) };
}

function shouldShow(key, data, selectedKey) {
  if (!data) return false;
  if (key === selectedKey || key.startsWith('orchestrator:')) return true;
  if (key.startsWith('session:')) return HIGH_VALUE.has(data.status);
  if (key.startsWith('governance:')) return true;
  return ['blocked', 'failed', 'waiting'].includes(data.status);
}

export function createStudioOverlays(root, { onSelect = () => {} } = {}) {
  const labels = new Map();
  let selectedKey = null;

  function createLabel(key, handle) {
    const label = root.ownerDocument.createElement('div');
    label.className = 'studio-world-label';
    label.dataset.selected = 'false';
    label.addEventListener('click', () => onSelect(handle.object.userData.entityRef));
    root.append(label);
    const entry = { label, handle };
    labels.set(key, entry);
    return entry;
  }

  function reconcile(_projection, entries) {
    const desired = new Set();
    for (const [key, handle] of entries) {
      const data = handle.object.userData.data;
      if (!shouldShow(key, data, selectedKey)) continue;
      desired.add(key);
      const entry = labels.get(key) ?? createLabel(key, handle);
      entry.handle = handle;
      const content = labelText(key, data);
      entry.label.replaceChildren();
      const title = root.ownerDocument.createElement('strong');
      title.textContent = content.title;
      const detail = root.ownerDocument.createElement('span');
      detail.textContent = content.detail;
      entry.label.append(title, detail);
      entry.label.dataset.state = data.status ?? 'unknown';
      entry.label.dataset.selected = String(key === selectedKey);
    }
    for (const [key, entry] of labels) {
      if (desired.has(key)) continue;
      entry.label.remove();
      labels.delete(key);
    }
  }

  function update(camera, _entries, viewport) {
    const width = Math.max(1, viewport?.width ?? 1);
    const height = Math.max(1, viewport?.height ?? 1);
    for (const { label, handle } of labels.values()) {
      const point = handle.object.getWorldPosition(new THREE.Vector3());
      point.y += handle.object.userData.entityRef?.kind === 'session' ? 3.25 : 2.1;
      point.project(camera);
      const x = (point.x * 0.5 + 0.5) * width;
      const y = (-point.y * 0.5 + 0.5) * height;
      label.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -100%)`;
      label.hidden = point.z < -1 || point.z > 1 || x < -160 || x > width + 160 || y < -80 || y > height + 80;
    }
  }

  function select(ref) {
    selectedKey = keyFor(ref);
    for (const [key, entry] of labels) entry.label.dataset.selected = String(key === selectedKey);
  }

  function clear() {
    for (const { label } of labels.values()) label.remove();
    labels.clear();
    selectedKey = null;
  }

  return { reconcile, update, select, clear };
}
