/**
 * Richardson-supplied GLB cast for Agent Force Studio.
 *
 * Loads the license-clean models (see models/ATTRIBUTIONS.md) into
 * ready-to-clone templates: the orchestrator, the builder/validator
 * workstation pod, the Skills Library attendant, and the HQ executive set.
 * Every consumer falls back to the original procedural geometry when a model
 * is missing or fails to parse, so the Studio never depends on these files
 * to stay truthful.
 *
 * owner: RStack developed by Richardson Gunde
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clone as cloneWithSkeleton } from 'three/addons/utils/SkeletonUtils.js';

const MANIFEST = Object.freeze({
  manager: { url: '/studio3d/assets/models/manager.glb', height: 1.78 },
  worker: { url: '/studio3d/assets/models/worker.glb', height: 1.42, maxWidth: 1.72 },
  librarian: { url: '/studio3d/assets/models/librarian.glb', height: 1.52, stripFloorPlanes: true },
  station: { url: '/studio3d/assets/models/manager-desk.glb', height: 1.25 },
  chair: { url: '/studio3d/assets/models/manager-chair.glb', height: 1.02 },
});

const activeMixers = new Set();
let castMotion = 'full';
let lastMixerTick = 0;
let templates = null;

/**
 * Normalize a loaded model into a floor-standing, meter-scaled template:
 * uniform scale to the authored height (clamped by footprint), origin at the
 * floor under the model's center, shadows on, baked shadow planes stripped.
 */
/**
 * Merge a template's static (non-skinned) meshes by material so each clone
 * costs one draw call per material instead of one per mesh. Skinned meshes
 * keep their skeletons. Bails out untouched on any attribute mismatch.
 */
function mergeStaticMeshes(root) {
  root.updateMatrixWorld(true);
  const byMaterial = new Map();
  const doomed = [];
  root.traverse((child) => {
    if (!child.isMesh || child.isSkinnedMesh) return;
    const geometry = child.geometry.clone().applyMatrix4(child.matrixWorld);
    const list = byMaterial.get(child.material) ?? [];
    list.push(geometry);
    byMaterial.set(child.material, list);
    doomed.push(child);
  });
  if (doomed.length <= byMaterial.size) return;
  const merged = [];
  for (const [material, geometries] of byMaterial) {
    const geometry = geometries.length === 1 ? geometries[0] : mergeGeometries(geometries, false);
    if (!geometry) return;
    merged.push(new THREE.Mesh(geometry, material));
  }
  doomed.forEach((child) => child.removeFromParent());
  merged.forEach((child) => root.add(child));
}

function prepTemplate(gltf, spec) {
  const root = gltf.scene;
  mergeStaticMeshes(root);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  let scale = spec.height / (size.y || 1);
  if (spec.maxWidth) scale = Math.min(scale, spec.maxWidth / (Math.max(size.x, size.z) || 1));
  root.scale.setScalar(scale);
  root.updateMatrixWorld(true);
  const scaled = new THREE.Box3().setFromObject(root);
  const center = scaled.getCenter(new THREE.Vector3());
  root.position.x -= center.x;
  root.position.z -= center.z;
  root.position.y -= scaled.min.y;

  const height = scaled.max.y - scaled.min.y;
  const doomed = [];
  root.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = true;
    if (!spec.stripFloorPlanes) return;
    // A near-flat mesh hugging the floor is a baked shadow plane, not a part.
    const meshBox = new THREE.Box3().setFromObject(child);
    const meshHeight = meshBox.max.y - meshBox.min.y;
    if (meshHeight < height * 0.03 && meshBox.min.y - scaled.min.y < height * 0.05) doomed.push(child);
  });
  doomed.forEach((child) => child.removeFromParent());

  const template = new THREE.Group();
  template.name = `Cast template · ${spec.url}`;
  template.add(root);
  return { template, clips: gltf.animations ?? [], height: spec.height };
}

/**
 * Load the whole cast. Per-model failures degrade to null (procedural
 * fallback); returns null only when nothing loaded.
 */
export async function loadStudioCast() {
  const loader = new GLTFLoader();
  const entries = await Promise.all(Object.entries(MANIFEST).map(async ([key, spec]) => {
    try {
      const gltf = await loader.loadAsync(spec.url);
      return [key, prepTemplate(gltf, spec)];
    } catch {
      return [key, null];
    }
  }));
  const cast = Object.fromEntries(entries);
  templates = cast;
  return entries.some(([, value]) => value) ? cast : null;
}

/**
 * Clone a template as an animated agent body. The first animation clip
 * (idle / typing) loops; `setWorking(false)` pauses it so an idle desk never
 * pretends to type.
 */
export function createCastAgent(entry) {
  const object = cloneWithSkeleton(entry.template);
  let mixer = null;
  let action = null;
  if (entry.clips.length) {
    mixer = new THREE.AnimationMixer(object);
    action = mixer.clipAction(entry.clips[0]);
    action.play();
    activeMixers.add(mixer);
  }
  return {
    object,
    height: entry.height,
    setWorking(working) {
      if (action) action.paused = !working;
    },
    dispose() {
      if (mixer) {
        mixer.stopAllAction();
        activeMixers.delete(mixer);
      }
      object.removeFromParent();
    },
  };
}

/** Clone a template as a static office prop (no animation registered). */
export function createCastProp(entry) {
  return cloneWithSkeleton(entry.template);
}

export function setCastMotion(mode) {
  castMotion = mode === 'reduced' ? 'reduced' : 'full';
}

/**
 * Advance all cast animation clips. Returns whether the render loop must
 * keep running for them; reduced motion holds the current frame.
 */
export function updateCastMixers(now) {
  const delta = lastMixerTick ? Math.min(0.1, Math.max(0, (now - lastMixerTick) / 1000)) : 0;
  lastMixerTick = now;
  if (!activeMixers.size || castMotion === 'reduced') return false;
  activeMixers.forEach((mixer) => mixer.update(delta));
  return true;
}

/** Release template GPU resources. Safe to call once on scene destroy. */
export function disposeStudioCast() {
  activeMixers.clear();
  if (!templates) return;
  for (const entry of Object.values(templates)) {
    entry?.template.traverse((child) => {
      if (!child.isMesh) return;
      child.geometry?.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => {
        for (const value of Object.values(material)) {
          if (value?.isTexture) value.dispose();
        }
        material?.dispose();
      });
    });
  }
  templates = null;
}
