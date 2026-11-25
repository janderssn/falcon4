// Model list (models.json), model loading, parts index and statistics.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

export const CATEGORIES = {
  '01': 'Sail & cloth', '02': 'Main frame', '03': 'Battens & washout', '04': 'Lower wires',
  '05': 'Upper wires & bridles', '06': 'Hardware', '07': 'Webbing',
};
const INFO_KEYS = ['part_no', 'description', 'source', 'note'];
const TEXTURE_SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap', 'bumpMap'];

/**
 * Reads models.json and returns { sources, models }; a source is one loadable GLB.
 */
export async function loadCatalog() {
  const response = await fetch('./models.json', { cache: 'no-cache' });
  if (!response.ok) throw new Error('Model list is unavailable.');
  const data = await response.json();
  const list = Array.isArray(data) ? data : data.models;
  const sources = new Map();
  for (const m of list) {
    const base = {
      modelId: m.id, title: m.title, description: m.description, download: m.download,
      rotateY: m.rotateY || 0, offset: m.offset || [0, 0, 0],
      glider: m.glider || 'Falcon 4', subtitle: m.subtitle || `Wills Wing · 170 · ${m.label} build`,
      poseShapes: m.poseShapes || null,
      ropes: m.ropes || null,             // soft rope ends drawn by lib/rope.js (see main.js, ropesOf)   // shape-key weights per resting pose (see main.js, poseOf)
    };
    const v = m.version ? `?v=${encodeURIComponent(m.version)}` : '';
    sources.set(m.id, {
      ...base, id: m.id, label: m.label, short: m.label, versionLabel: m.version ? `current · ${m.version}` : 'current',
      glb: `./${m.glb}${v}`, parts: `./${m.parts}${v}`, current: true,
    });
  }
  return { sources, models: list };
}

const cache = new Map();

/** Loads a source once; returns a record shared by every caller. */
export function loadModel(source, onProgress) {
  if (!cache.has(source.id)) {
    const entry = { listeners: new Set(), promise: null };
    if (onProgress) entry.listeners.add(onProgress);
    entry.promise = load(source, (...a) => entry.listeners.forEach((f) => f(...a))).catch((error) => {
      cache.delete(source.id);
      throw error;
    });
    cache.set(source.id, entry);
  } else if (onProgress) cache.get(source.id).listeners.add(onProgress);
  return cache.get(source.id).promise;
}

/** Frees models that are not in `keep` (source ids), keeping a couple for quick switching. */
export function trimCache(keep, spare = 2) {
  const extra = [...cache.keys()].filter((id) => !keep.includes(id));
  for (const id of extra.slice(0, Math.max(0, extra.length - spare))) {
    cache.get(id).promise.then(dispose, () => {});
    cache.delete(id);
  }
}

async function load(source, progress) {
  const response = await fetch(source.parts);
  if (!response.ok) throw new Error(`Parts index is unavailable (${response.status}).`);
  const partsIndex = await response.json();
  const byNode = new Map(Object.entries(partsIndex).map(([name, group]) => [THREE.PropertyBinding.sanitizeNodeName(name), { name, group }]));
  let bytes = 0;
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(source.glb, (e) => {
    bytes = e.total || e.loaded;
    progress(e.total ? e.loaded / e.total : null, e.loaded);
  });
  const model = gltf.scene;
  const root = new THREE.Group();
  root.name = source.id;
  root.add(model);
  model.rotation.y = THREE.MathUtils.degToRad(source.rotateY);
  model.position.set(...source.offset);
  root.updateMatrixWorld(true);

  const parts = new Map();
  const meshes = [];
  const materials = new Set();
  const textures = new Set();
  let triangles = 0, vertices = 0;
  model.traverse((o) => {
    if (!o.isMesh) return;
    let node = o;
    while (node && !byNode.has(node.name)) node = node.parent;
    const hit = node && byNode.get(node.name);
    const name = hit ? hit.name : o.name;
    if (!hit) console.warn(`No visibility group for ${o.name}; using Hardware.`);
    let part = parts.get(name);
    if (!part) {
      const info = {};
      for (const key of INFO_KEYS) if (node && node.userData[key] !== undefined) info[key] = String(node.userData[key]);
      // Soft parts that hang free (a rope's surplus) are tagged ground_contact = 0 in the model:
      // they do not hold the glider up, so the resting pose leaves them out.
      const ground = !(node && Number(node.userData.ground_contact) === 0);
      part = { name, group: hit ? hit.group : '06', meshes: [], info, ground, triangles: 0, vertices: 0, key: name.toLowerCase() };
      parts.set(name, part);
    }
    const g = o.geometry;
    const tris = (g.index ? g.index.count : g.attributes.position.count) / 3;
    part.triangles += tris; part.vertices += g.attributes.position.count;
    triangles += tris; vertices += g.attributes.position.count;
    materials.add(o.material);
    for (const slot of TEXTURE_SLOTS) if (o.material[slot]) textures.add(o.material[slot]);
    prepareMaterials(o);
    o.userData.part = part;
    o.castShadow = true;   // receiving is off: thin double-sided cloth self-shadows badly
    part.meshes.push(o);
    meshes.push(o);
  });
  const texturePixels = [...textures].reduce((n, t) => n + (t.image ? (t.image.width || 0) * (t.image.height || 0) : 0), 0);
  const box = new THREE.Box3().setFromObject(root);
  const groups = {};
  for (const p of parts.values()) groups[p.group] = (groups[p.group] || 0) + 1;
  return {
    source, root, meshes, parts, box, groups,
    stats: {
      parts: parts.size, meshes: meshes.length, triangles, vertices, materials: materials.size,
      textures: textures.size, texturePixels, bytes,
      numbered: [...parts.values()].filter((p) => p.info.part_no).length,
    },
  };
}

// Each mesh gets its own materials, so selection, hover and fading never leak
// into other meshes that shared a material in the GLB.
function prepareMaterials(mesh) {
  const base = mesh.material.clone();
  const make = (emissive, intensity) => {
    const m = base.clone();
    if (m.emissive) { m.emissive.set(emissive); m.emissiveIntensity = intensity; }
    return m;
  };
  const ghost = base.clone();
  ghost.transparent = true;
  ghost.depthWrite = false;
  ghost.alphaTest = 0;
  mesh.userData.materials = {
    base, selected: make('#d0832a', 0.45), hover: make('#3f8fe0', 0.45), related: make('#2fb39a', 0.35), ghost,
  };
  mesh.material = base;
}

export function dispose(record) {
  record.root.removeFromParent();
  for (const mesh of record.meshes) {
    mesh.geometry.dispose();
    for (const m of Object.values(mesh.userData.materials)) {
      for (const slot of TEXTURE_SLOTS) if (m[slot]) m[slot].dispose();
      m.dispose();
    }
  }
}

/** World-space bounds of a set of meshes. */
export function boundsOf(meshes) {
  const box = new THREE.Box3();
  for (const m of meshes) box.expandByObject(m);
  return box;
}

export function formatBytes(n) {
  if (!n) return '—';
  return n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
}
export function formatCount(n) {
  return n >= 1e6 ? `${(n / 1e6).toFixed(2)} M` : n >= 1e4 ? `${(n / 1e3).toFixed(1)} k` : Math.round(n).toLocaleString('en');
}
