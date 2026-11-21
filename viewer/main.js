import './style.css';
import * as THREE from 'three';
import { CATEGORIES, loadCatalog, loadModel, trimCache, boundsOf } from './lib/catalog.js';
import { CameraRig } from './lib/camera.js';
import { Scenes, SCENES } from './lib/scenes.js';
import { FALCON_FABRICS } from './lib/fabrics.js';

const $ = (s, root = document) => root.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const params = new URLSearchParams(location.search);
const THUMB = params.get('thumb');                   // set by tools/thumbs.mjs to render the thumbnails
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const small = matchMedia('(max-width: 760px)').matches;

// ------------------------------------------------------------------ what can be tweaked
// Sail and frame zones. The sail panels follow the Wills Wing Falcon colour picker:
// P1 leading edge, P2, P3, P4 trailing edge on top, P5 undersurface (Opus uses the
// same panel names; Astra's panels 1-4 match P1-P4 and it has no P5). A part belongs
// to the first zone whose part-name pattern matches it, otherwise to the zone of its
// material. Rows only show for a build that has parts in them.
const ZONES = {
  pockets: { name: 'Batten pockets', parts: /^(Batten pocket [LR] [2-6]|[LR] batten [2-6] fabric pocket)$/ },
  p4: { name: 'P4 · Trailing edge', panel: 'P4', parts: /^(Trailing edge hem|[LR] sail panel 4)$/, mats: ['Sail P4 TE panel (white)'] },
  p3: { name: 'P3', panel: 'P3', parts: /^[LR] sail panel 3$/, mats: ['Sail P3 (white)', 'Sail P5 tip piece (white)', 'Keel pocket front (white)', 'Keel pocket rear (white)', 'Batten pocket cloth (white)', 'Off-white Dacron'] },
  p1: { name: 'P1 · Leading edge', panel: 'P1', mats: ['Royal blue Dacron', 'Sail P1 LE panel (blue)', 'Sail P1 under the LE (blue)', 'Nosecone (blue)'] },
  p2: { name: 'P2', panel: 'P2', mats: ['Signal red Dacron', 'Red inner cloth - underside only', 'Sail P2 (white)'] },
  p5: { name: 'P5 · Undersurface', panel: 'P5', mats: ['Sail P5 undersurface (colour)'] },
  frame: { name: 'Frame', mats: ['Satin 7075 aluminium', 'Aluminium (anodised clear)', 'Control bar aluminium', 'Aluminium 7075-T6 tube', 'Aluminium sleeve'] },
};
const SAIL_ZONES = ['p1', 'p2', 'p3', 'p4', 'p5', 'pockets'];
const zoneOf = (mesh) => {
  const part = mesh.userData.part.name, mat = mesh.userData.materials.base.name;
  return Object.keys(ZONES).find((z) => ZONES[z].parts?.test(part)) || Object.keys(ZONES).find((z) => ZONES[z].mats?.includes(mat));
};
const FRAME_FINISHES = [['black', 'Black anodised', '#1d1e21', 1], ['graphite', 'Graphite', '#5b5e63', 1], ['gold', 'Gold anodised', '#b8954a', 1]];
// Each panel offers the Wills Wing fabrics for that panel; the pockets offer the solid colours of P3.
const fabricsFor = (zone) => (zone === 'frame' ? FRAME_FINISHES
  : zone === 'pockets' ? FALCON_FABRICS.P3.filter((f) => f[3] === 1)
  : FALCON_FABRICS[ZONES[zone].panel]);
// Baked colours of the textured opus sail panels (linear RGB), from falcon4-opus f4/sailmat.py.
const BAKED = { white: [0.93, 0.93, 0.9], blue: [0.02, 0.1, 0.62], red: [0.78, 0.05, 0.03] };

// Names on the main parts.
const CONCEPTS = [
  { id: 'nose', name: 'Nose', at: { dir: [0, 0, 1], f: 1 }, re: /^(Removable nose cone|Nosecone)$/, text: 'The nose plates bolt the keel and both leading edges together; the nose cone covers them.' },
  { id: 'keel', name: 'Keel', at: { dir: [0, 0, 1], f: 0.02 }, re: /^(Keel 42mm.*|Keel)$/, text: 'The centre tube from nose to tail. The kingpost, the control frame and the hang loop are fixed to it.' },
  { id: 'kingpost', name: 'Kingpost', at: { dir: [0, 1, 0], f: 1 }, re: /^(Streamlined kingpost|Kingpost)$/, text: 'The mast above the keel. The top wires run from its tip and hold the wing up on the ground.' },
  { id: 'le', name: 'Leading edge', at: { dir: [1, 0, -0.6], f: 0.6 }, re: /^(L leading edge front 50mm|LE front L)$/, text: 'The tubes that form the front of the wing; the sail is pulled over them.' },
  { id: 'crossbar', name: 'Crossbar', at: { dir: [1, 0, 0], f: 0.8 }, re: /^(L crossbar 52mm|Crossbar L)$/, text: 'Two tubes joined at the keel that push the leading edges apart and keep the sail tight.' },
  { id: 'upright', name: 'Control frame', at: { dir: [0, 1, 0], f: 0.55 }, re: /^(L control frame upright|Downtube L)$/, text: 'The triangle the pilot holds and steers with, by shifting weight.' },
  { id: 'basebar', name: 'Basebar', at: { dir: [1, 0, 0], f: 0.5 }, re: /^(Control frame base tube|Basetube \(speedbar\))$/, text: 'The bar the pilot holds. Push out to slow down, pull in to speed up.' },
  { id: 'batten', name: 'Batten', at: { dir: [0, 0, 1], f: 0.1 }, re: /^(L cambered batten 4|Batten L 4)$/, text: 'Curved ribs in pockets in the sail; their shape gives the wing its airfoil.' },
];
const GROUP_TEXT = {
  '01': 'Part of the sail.', '02': 'Part of the main frame.', '03': 'Part of the battens and washout.', '04': 'A lower wire: carries the flight loads.',
  '05': 'An upper wire or bridle: holds the wing up on the ground.', '06': 'Hardware that joins the parts.', '07': 'Webbing: the hang loop and its backup.',
};

// ------------------------------------------------------------------ state
const pick = (key, list, fallback = null) => (list.some((x) => x[0] === params.get(key)) ? params.get(key) : fallback);
const state = {
  model: params.get('model'),
  scene: SCENES[params.get('scene')] ? params.get('scene') : 'studio',
  colours: Object.fromEntries(Object.keys(ZONES).map((z) => [z, pick(z, fabricsFor(z))])),
  seeThrough: Math.min(1, Math.max(0, Number(params.get('xray')) || 0)),
  wires: params.get('wires') !== '0',
  pose: ['nose', 'tail'].includes(params.get('pose')) ? params.get('pose') : 'bar',
  names: params.get('names') === '1',
  hours: Number(params.get('t')) || 9.5,
  wind: 1, shadows: true, sel: null, tour: false,
  panel: !small && !THUMB,
};
let catalog, record, renderer, rig, scenes;
const scene = new THREE.Scene();
const canvas = $('#scene');

async function boot() {
  renderer.setPixelRatio(Math.min(devicePixelRatio, THUMB ? 2 : 1.6));
  // Neutral tone mapping keeps the chosen colours true (ACES turns bright reds orange).
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  rig = new CameraRig(canvas);
  rig.controls.maxDistance = 40;
  rig.controls.addEventListener('start', userActive);
  rig.addEventListener('change', saveUrlSoon);
  loaderText('Falcon 4', 'Setting up…', 0.05);
  scenes = new Scenes(renderer, scene, { grass: Number(params.get('grass')) || (small ? 70000 : 170000) });
  scenes.hours = state.hours;
  wireUi();
  resize();
  addEventListener('resize', resize);
  try { catalog = await loadCatalog(); }
  catch (e) { loaderText('The glider list didn’t load', e.message, 0, true); return; }
  const ids = catalog.models.map((m) => m.id);
  if (!ids.includes(state.model)) state.model = ids.includes('opus') ? 'opus' : ids[0];
  buildPanel();
  await setModel(state.model, true);
  requestAnimationFrame(loop);
}

const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

function loaderText(title, note, p, retry = false) {
  $('.ld-title').textContent = title;
  $('#ld-note').textContent = note;
  $('#ld-pct').textContent = retry ? '' : `${Math.round(p * 100)} %`;
  $('#ld-fill').style.transform = `scaleX(${p})`;
  $('#ld-retry').hidden = !retry;
}

// ------------------------------------------------------------------ gliders
async function setModel(id, first = false) {
  const source = catalog.sources.get(id);
  state.model = id;
  syncPanel();
  if (!first) toast(`Loading the ${source.label} build…`, true);
  let rec;
  try {
    rec = await loadModel(source, (f, loaded) => {
      const pct = f == null ? null : Math.round(f * 100);
      if (first) loaderText('Falcon 4', pct != null && pct >= 100 ? 'Putting it together…' : `Loading the ${source.label} build · ${((loaded || 0) / 1048576).toFixed(1)} MB`, 0.1 + 0.85 * (f || 0));
      else if (pct != null && pct < 100) toast(`Loading the ${source.label} build · ${pct} %`, true);
    });
  } catch (e) {
    console.error(e);
    if (first) { loaderText('The glider didn’t load', `Check the connection and try again. ${e.message}`, 0, true); $('#ld-retry').onclick = () => location.reload(); }
    else toast(`The ${source.label} build didn’t load`);
    return;
  }
  if (state.model !== id) return;
  if (record && record !== rec) record.root.removeFromParent();
  record = rec;
  prepareTints(record);
  scene.add(record.root);
  applyPose();
  const center = record.box.getCenter(new THREE.Vector3());
  scenes.place(record.box.min.y, new THREE.Vector3(center.x, record.box.min.y, center.z));
  state.sel = null;
  applyLook();
  buildLabels();
  renderChip();
  if (first) {
    scenes.set(state.scene);
    const cam = readCamera();
    if (cam) { rig.setProjection(cam.projection); rig.animateTo(cam.pose, false); }
    else frontView(false);
    $('#loader').classList.add('done');
    if (THUMB) runThumb();
  } else toast(`${source.title} · ${source.description}`);
  syncPanel();
  trimCache([id]);
  saveUrlSoon();
}

// ------------------------------------------------------------------ colours
/**
 * Every mesh in a tintable zone gets shared uniforms. Plain materials are recoloured
 * directly; the opus sail panels have their colour baked into a texture with seams
 * and stitching, so their shader keeps the texture's light and dark and swaps the hue.
 */
function prepareTints(rec) {
  if (rec.tints) return;
  rec.tints = {};
  for (const zone of Object.keys(ZONES)) rec.tints[zone] = { uTint: { value: new THREE.Color() }, uTintOn: { value: 0 }, meshes: [] };
  for (const mesh of rec.meshes) {
    const name = mesh.userData.materials.base.name;
    const zone = zoneOf(mesh);
    if (!zone) continue;
    const t = rec.tints[zone];
    t.meshes.push(mesh);
    for (const m of Object.values(mesh.userData.materials)) {
      m.userData.original = m.color.clone();
      m.userData.originalRough = m.roughness;
      if (!m.map) continue;
      const baked = /\(blue\)/.test(name) ? BAKED.blue : /\(colour\)/.test(name) ? BAKED.red : BAKED.white;
      m.onBeforeCompile = (s) => {
        s.uniforms.uTint = t.uTint; s.uniforms.uTintOn = t.uTintOn; s.uniforms.uBaked = { value: new THREE.Color(...baked) };
        s.fragmentShader = s.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform vec3 uTint; uniform float uTintOn; uniform vec3 uBaked;')
          .replace('#include <map_fragment>', `#include <map_fragment>
            if (uTintOn > 0.5) {
              const vec3 W = vec3(0.2126, 0.7152, 0.0722);
              diffuseColor.rgb = uTint * clamp(dot(diffuseColor.rgb, W) / max(dot(uBaked, W), 0.02), 0.0, 1.5);
            }`);
      };
      m.customProgramCacheKey = () => 'tint';
      m.needsUpdate = true;
    }
  }
}

function fabricOf(zone, id) {
  const hit = fabricsFor(zone).find((c) => c[0] === id);
  return hit ? { colour: new THREE.Color().setStyle(hit[2]), opacity: hit[3], name: hit[1] } : null;
}

function applyLook() {
  if (!record) return;
  const clear = {};
  for (const [zone, t] of Object.entries(record.tints)) {
    const fabric = fabricOf(zone, state.colours[zone]);
    const colour = fabric?.colour;
    if (fabric && fabric.opacity < 1) clear[zone] = fabric.opacity;
    t.uTintOn.value = colour ? 1 : 0;
    if (colour) t.uTint.value.copy(colour);
    for (const mesh of t.meshes) {
      mesh.userData.zone = zone;
      for (const m of Object.values(mesh.userData.materials)) {
        if (m.map) continue;
        m.color.copy(colour || m.userData.original);
        if (zone === 'frame') m.roughness = colour ? 0.38 : m.userData.originalRough;
      }
    }
  }
  // Sail see-through and wires.
  for (const mesh of record.meshes) {
    const part = mesh.userData.part, M = mesh.userData.materials;
    const selected = part.name === state.sel;
    let mat = selected ? M.selected : M.base;
    let visible = true;
    if (part.group === '04' || part.group === '05') visible = state.wires;
    // See-through sail, or a clear laminate panel.
    const laminate = clear[mesh.userData.zone];
    const ghost = (part.group === '01' && state.seeThrough > 0) || laminate !== undefined;
    if (ghost) {
      const seeThrough = part.group === '01' ? 1 - state.seeThrough * 0.92 : 1;
      if (part.group === '01' && state.seeThrough >= 0.98) visible = false;
      mat = M.ghost;
      mat.opacity = Math.min(seeThrough, laminate ?? 1);
      mat.transparent = true;
      mat.depthWrite = false;
      if (mat.emissive) mat.emissive.set(selected ? '#d0832a' : 0x000000);
    }
    depthTwin(mesh, ghost && visible);
    if (part.group === '01') mesh.castShadow = state.seeThrough < 0.35 && laminate === undefined;
    mesh.material = mat;
    mesh.visible = visible;
  }
}

/**
 * A see-through part gets a twin that only writes depth, drawn after everything
 * solid (so the frame behind still shows) and before the see-through pass. Then only
 * the nearest layer of cloth is drawn, whatever order the transparent parts are
 * sorted in; without it, overlapping panels and pockets pop in and out as the view turns.
 */
const DEPTH_ONLY = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });
function depthTwin(mesh, on) {
  let twin = mesh.userData.depthTwin;
  if (!twin && !on) return;
  if (!twin) {
    twin = new THREE.Mesh(mesh.geometry, DEPTH_ONLY);
    twin.renderOrder = 1;
    twin.raycast = () => {};
    mesh.add(twin);
    mesh.userData.depthTwin = twin;
  }
  twin.visible = on;
}

// ------------------------------------------------------------------ pose
/**
 * Standing on the control bar (as modelled), or resting on the keel: rocked forward
 * over the basebar until the nose is on the ground, or back until the tail is.
 * The tilt is found from the model itself: the smallest rotation about the front
 * (or back) of the basebar at which another point of the glider reaches the ground.
 */
function restingPose(rec) {
  const root = rec.root;
  root.position.set(0, 0, 0);
  root.quaternion.identity();
  root.updateMatrixWorld(true);
  // Flat arrays and plain loops: the models have up to a million vertices.
  const ys = [], zs = [];
  const v = new THREE.Vector3();
  for (const m of rec.meshes) {
    const pos = m.geometry.attributes.position;
    for (let i = 0; i < pos.count; i += 2) { v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld); ys.push(v.y); zs.push(v.z); }
  }
  let minY = Infinity;
  for (const y of ys) if (y < minY) minY = y;
  let front = -Infinity, back = Infinity;
  for (let i = 0; i < ys.length; i++) if (ys[i] < minY + 0.03) { front = Math.max(front, zs[i]); back = Math.min(back, zs[i]); }
  let nose = Math.PI * 0.45, tail = Math.PI * 0.45;    // upper bound only; the first contact sets the angle
  for (let i = 0; i < ys.length; i++) {
    if (zs[i] > front + 0.5) nose = Math.min(nose, Math.atan2(ys[i] - minY, zs[i] - front));
    if (zs[i] < back - 0.5) tail = Math.min(tail, Math.atan2(ys[i] - minY, back - zs[i]));
  }
  return {
    nose: { pivot: new THREE.Vector3(0, minY, front), angle: nose },      // nose down: +rotation about X
    tail: { pivot: new THREE.Vector3(0, minY, back), angle: -tail },      // tail down: the other way
  };
}
function applyPose() {
  if (!record) return;
  if (!record.rest) record.rest = restingPose(record);
  const { pivot, angle } = record.rest[state.pose] || { pivot: new THREE.Vector3(), angle: 0 };
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), angle);
  record.root.quaternion.copy(q);
  record.root.position.copy(pivot).sub(pivot.clone().applyQuaternion(q));
  record.root.updateMatrixWorld(true);
  record.box.setFromObject(record.root);
  anchors.clear();
}
function setPose(pose) {
  state.pose = pose;
  applyPose();
  syncPanel();
  saveUrlSoon();
}

// ------------------------------------------------------------------ camera
function frontView(animate = !reduced) {
  if (!record) return;
  rig.setProjection('perspective');
  rig.animateTo(rig.frame(record.box, [0.42, 0.32, 1], 1.0), animate);
  syncPanel();
}
function zoom(f) { const p = rig.pose(); p.size *= f; rig.animateTo(p, !reduced); userActive(); }
function toggle2d() {
  const ortho = rig.projection !== 'orthographic';
  rig.setProjection(ortho ? 'orthographic' : 'perspective');
  if (ortho && record) rig.animateTo(rig.frame(record.box, [0, 1, -1e-4], 1.08), !reduced);
  else if (record) frontView();
  syncPanel();
  userActive();
}
function focusPart(part) {
  const pose = rig.frame(boundsOf(part.meshes), undefined, 1.8);
  pose.size = Math.max(pose.size, 0.4);
  rig.animateTo(pose, !reduced);
}

// Keep the camera out of the ground and inside the hangar. The orbit's lowest angle is
// set so the camera stays above the floor; anything that still gets out (zooming out,
// moving the target) is pulled back along the line to the target.
function limitCamera() {
  const lim = record && scenes.cameraLimits();
  const c = rig.controls;
  if (!lim) { c.maxPolarAngle = Math.PI; return; }
  const g = record.box.min.y, t = c.target;
  if (lim.halfX) {
    t.x = THREE.MathUtils.clamp(t.x, -lim.halfX + 1, lim.halfX - 1);
    t.z = THREE.MathUtils.clamp(t.z, -lim.halfZ + 1, lim.halfZ - 1);
    t.y = Math.min(t.y, g + lim.maxY - 1);
  }
  t.y = Math.max(t.y, g + lim.minY + 0.1);
  const d = Math.max(rig.camera.position.distanceTo(t), 1e-3);
  c.maxPolarAngle = Math.acos(THREE.MathUtils.clamp((g + lim.minY - t.y) / d, -1, 1));
}
function clampCamera() {
  const lim = record && scenes.cameraLimits();
  if (!lim) return;
  const g = record.box.min.y, cam = rig.camera.position, t = rig.controls.target;
  const off = cam.clone().sub(t);
  let s = 1;
  if (cam.y < g + lim.minY && off.y < 0) s = Math.min(s, (g + lim.minY - t.y) / off.y);
  if (lim.maxY && cam.y > g + lim.maxY && off.y > 0) s = Math.min(s, (g + lim.maxY - t.y) / off.y);
  if (lim.halfX) {
    if (Math.abs(cam.x) > lim.halfX && off.x) s = Math.min(s, (Math.sign(off.x) * lim.halfX - t.x) / off.x);
    if (Math.abs(cam.z) > lim.halfZ && off.z) s = Math.min(s, (Math.sign(off.z) * lim.halfZ - t.z) / off.z);
  }
  if (s < 1) cam.copy(t).addScaledVector(off, Math.max(s, 0.02));
}

// Fly-around on request; a slow turn on its own after a while without input.
let lastInput = performance.now();
function userActive() { lastInput = performance.now(); if (!state.tour) rig.controls.autoRotate = false; }
function startTour() { state.tour = true; rig.setProjection('perspective'); rig.controls.autoRotate = true; rig.controls.autoRotateSpeed = 1.6; syncPanel(); }
function stopTour() { state.tour = false; rig.controls.autoRotate = false; rig.controls.autoRotateSpeed = 0.35; syncPanel(); }

// ------------------------------------------------------------------ render loop
let last = performance.now();
const clock0 = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  if (document.hidden) return;
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  if (!THUMB && !state.tour && !rig.transition && now - lastInput > 30000 && rig.projection === 'perspective') { rig.controls.autoRotate = true; rig.controls.autoRotateSpeed = 0.35; }
  limitCamera();
  rig.update(now, dt);
  clampCamera();
  scenes.update(rig.camera, (now - clock0) / 1000);
  renderer.render(scene, rig.camera);
  updateLabels();
}
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  rig.setAspect(innerWidth / innerHeight);
  shiftView();
}
/** Centre the glider in the part of the screen the panel leaves free. */
function shiftView() {
  const w = innerWidth, h = innerHeight;
  const dx = state.panel && !small ? ($('#custom').offsetWidth + 16) / 2 : 0;
  const dy = state.panel && small ? $('#custom').offsetHeight / 2 : 0;
  for (const cam of [rig.perspective, rig.orthographic]) {
    if (dx || dy) cam.setViewOffset(w, h, dx, dy, w, h); else cam.clearViewOffset();
    cam.updateProjectionMatrix();
  }
}

// ------------------------------------------------------------------ clicking a part
const raycaster = new THREE.Raycaster();
function pickPart(e) {
  const r = canvas.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), rig.camera);
  const meshes = record.meshes.filter((m) => m.visible && !(m.material.transparent && m.material.opacity < 0.5));
  return raycaster.intersectObjects(meshes, false)[0]?.object.userData.part || null;
}
function select(part) {
  state.sel = part ? part.name : null;
  applyLook();
  renderChip();
}
/** The build notes are long; the chip shows their first sentence. */
function firstSentence(text) {
  if (!text) return '';
  const cut = text.search(/[.;](\s|$)/);
  const s = cut > 0 ? text.slice(0, cut) : text;
  return s.length > 150 ? `${s.slice(0, 147)}…` : s;
}
function renderChip() {
  const chip = $('#chip');
  const part = state.sel && record?.parts.get(state.sel);
  if (!part) { chip.hidden = true; return; }
  const concept = CONCEPTS.find((c) => c.re.test(part.name));
  chip.hidden = false;
  chip.innerHTML = `<div class="chip-text"><b>${esc(concept ? concept.name : part.name)}</b>
    <span class="chip-meta">${concept ? `${esc(part.name)} · ` : ''}${esc(CATEGORIES[part.group])}${part.info.part_no ? ` · <span class="pn">${esc(part.info.part_no)}</span>` : ''}</span>
    <span class="chip-lead">${esc(concept ? concept.text : firstSentence(part.info.description) || GROUP_TEXT[part.group])}</span></div>
    <button type="button" class="chip-btn" data-act="focus" title="Go to it">Go to it</button>
    <button type="button" class="chip-close" data-act="close" aria-label="Close (Esc)"><svg viewBox="0 0 24 24" class="ic"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`;
}

// ------------------------------------------------------------------ names on the parts
const anchors = new Map();
const labelEls = new Map();
const conceptPart = (c) => [...record.parts.values()].find((p) => c.re.test(p.name)) || null;
function extreme(part, dir) {
  const v = new THREE.Vector3(), best = new THREE.Vector3();
  let top = -Infinity;
  for (const m of part.meshes) {
    const pos = m.geometry.attributes.position;
    m.updateWorldMatrix(true, false);
    for (let i = 0; i < pos.count; i += 3) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      const s = v.dot(dir);
      if (s > top) { top = s; best.copy(v); }
    }
  }
  return best;
}
function anchorOf(c) {
  if (!anchors.has(c.id)) {
    const part = conceptPart(c), d = new THREE.Vector3(...c.at.dir).normalize();
    anchors.set(c.id, part ? extreme(part, d.clone().negate()).lerp(extreme(part, d), c.at.f) : null);
  }
  return anchors.get(c.id);
}
function buildLabels() {
  const host = $('#labels');
  host.innerHTML = '';
  labelEls.clear();
  for (const c of CONCEPTS) {
    const part = conceptPart(c);
    if (!part) continue;
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'label';
    el.tabIndex = -1;
    el.innerHTML = `<b>${esc(c.name)}</b>`;
    el.onclick = () => select(part);
    host.append(el);
    labelEls.set(c.id, el);
  }
}
const tmp = new THREE.Vector3();
function updateLabels() {
  if (!record || !state.names) return;
  const placed = [];
  const items = CONCEPTS.filter((c) => labelEls.has(c.id) && anchorOf(c)).map((c) => ({ c, p: anchorOf(c) }))
    .sort((a, b) => a.p.distanceTo(rig.camera.position) - b.p.distanceTo(rig.camera.position));
  for (const { c, p } of items) {
    const el = labelEls.get(c.id), part = conceptPart(c);
    tmp.copy(p).project(rig.camera);
    const x = (tmp.x + 1) / 2 * innerWidth, y = (1 - tmp.y) / 2 * innerHeight;
    let ok = part.meshes.some((m) => m.visible) && tmp.z < 1 && Math.abs(tmp.x) < 1 && Math.abs(tmp.y) < 1;
    if (ok) {
      const w = c.name.length * 8 + 12, r = { x0: x - w / 2, x1: x + w / 2, y0: y - 44, y1: y };
      if (placed.some((q) => r.x0 < q.x1 && r.x1 > q.x0 && r.y0 < q.y1 && r.y1 > q.y0)) ok = false; else placed.push(r);
    }
    el.style.opacity = ok ? 1 : 0;
    el.style.pointerEvents = ok ? 'auto' : 'none';
    el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
  }
}

// ------------------------------------------------------------------ customize panel
const thumb = (name) => `url('./thumbs/${name}.jpg')`;
function swatches(zone) {
  return `<div class="swatches" role="radiogroup" aria-label="${esc(ZONES[zone].name)}">
    <button type="button" class="sw original" data-zone="${zone}" data-colour="" title="As built" aria-label="As built"><i></i></button>
    ${fabricsFor(zone).map(([id, name, hex, opacity]) => `<button type="button" class="sw${opacity < 1 ? ' clear' : ''}" data-zone="${zone}" data-colour="${id}" title="${esc(name)}" aria-label="${esc(name)}" style="--c:${hex};--o:${opacity}"><i></i></button>`).join('')}
  </div>`;
}
function buildPanel() {
  $('#builds').innerHTML = catalog.models.map((m) => `
    <button type="button" class="build" data-model="${m.id}">
      <span class="art" style="background-image:${thumb(`model-${m.id}`)}"></span>
      <span class="build-text"><b>${esc(m.label)}</b><small>${esc(m.description.replace(/^\d+ parts · /, ''))}</small></span>
    </button>`).join('');
  $('#sail-rows').innerHTML = SAIL_ZONES.map((z) => `<div class="row" data-row="${z}"><span class="row-name">${ZONES[z].name}<small data-name="${z}"></small></span>${swatches(z)}</div>`).join('');
  $('#frame-row').innerHTML = `<div class="row"><span class="row-name">Tubes<small data-name="frame"></small></span>${swatches('frame')}</div>`;
  $('#scene-fly').innerHTML = Object.entries(SCENES).map(([id, s]) =>
    `<button type="button" class="tile" data-scene="${id}" title="${s.label}"><span class="art" style="background-image:${thumb(`scene-${id}`)}"></span><span class="cap">${s.label}</span></button>`).join('');
}
function syncPanel() {
  document.body.classList.toggle('panel-open', state.panel);
  $('#custom').hidden = !state.panel;
  if (rig) shiftView();
  $('#btn-custom').classList.toggle('on', state.panel);
  $('#btn-custom').setAttribute('aria-expanded', String(state.panel));
  for (const b of document.querySelectorAll('.build')) b.classList.toggle('on', b.dataset.model === state.model);
  for (const b of document.querySelectorAll('.sw')) {
    const on = (state.colours[b.dataset.zone] || '') === b.dataset.colour;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  }
  for (const el of document.querySelectorAll('[data-name]')) {
    const z = el.dataset.name, id = state.colours[z];
    el.textContent = id ? fabricOf(z, id)?.name || 'As built' : 'As built';
  }
  if (record) for (const b of document.querySelectorAll('.sw.original')) {
    const t = record.tints[b.dataset.zone];
    const m = t?.meshes[0]?.userData.materials.base;
    const c = !m ? null : m.map ? new THREE.Color(.../\(blue\)/.test(m.name) ? BAKED.blue : /\(colour\)/.test(m.name) ? BAKED.red : BAKED.white) : m.userData.original;
    b.style.setProperty('--c', c ? `#${c.getHexString(THREE.SRGBColorSpace)}` : '#888');
  }
  if (record) for (const row of document.querySelectorAll('[data-row]')) row.hidden = !record.tints[row.dataset.row]?.meshes.length;
  for (const b of document.querySelectorAll('[data-pose]')) b.setAttribute('aria-pressed', String(b.dataset.pose === state.pose));
  $('#xray').value = state.seeThrough;
  $('#opt-wires').checked = state.wires;
  $('#opt-names').checked = state.names;
  document.body.classList.toggle('nolabels', !state.names);
  $('#light').hidden = state.scene !== 'hill';
  $('#scene-art').style.backgroundImage = thumb(`scene-${state.scene}`);
  $('#scene-cap').textContent = SCENES[state.scene].label;
  for (const t of document.querySelectorAll('#scene-fly .tile')) t.classList.toggle('on', t.dataset.scene === state.scene);
  const src = catalog?.sources.get(state.model);
  if (src) {
    $('#subtitle').textContent = `Wills Wing · 170 · ${src.label} build`;
    $('#download').href = src.glb;
    $('#download').download = src.download;
  }
  $('#btn-2d').classList.toggle('on', rig?.projection === 'orthographic');
  $('#btn-2d').textContent = rig?.projection === 'orthographic' ? '3D' : '2D';
  $('#btn-tour').classList.toggle('on', state.tour);
}

function setTime(h) {
  state.hours = h;
  scenes.setTime(h);
  $('#time').value = h;
  $('#time-label').textContent = `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60) % 60).padStart(2, '0')}`;
  saveUrlSoon();
}
function setScene(id) {
  state.scene = id;
  if (id === 'hill' && !scenes.meadow) toast('Growing the meadow…', true);
  requestAnimationFrame(() => setTimeout(() => {
    scenes.set(id);
    syncPanel();
    saveUrlSoon();
  }, 30));
}

let toastTimer;
function toast(text, keep = false) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), keep ? 4000 : 2400);
}

function wireUi() {
  setTime(state.hours);
  $('#time').addEventListener('input', (e) => setTime(Number(e.target.value)));
  $('#wind').addEventListener('input', (e) => { state.wind = Number(e.target.value); scenes.setWind(state.wind); });
  $('#btn-custom').onclick = () => { state.panel = !state.panel; syncPanel(); };
  $('#btn-close').onclick = () => { state.panel = false; syncPanel(); };
  $('#btn-tour').onclick = () => (state.tour ? stopTour() : startTour());
  $('#btn-front').onclick = () => { stopTour(); frontView(); };
  $('#btn-2d').onclick = toggle2d;
  $('#btn-zin').onclick = () => zoom(0.7);
  $('#btn-zout').onclick = () => zoom(1.4);
  $('#btn-showhud').onclick = () => document.body.classList.remove('nohud');
  $('#scene-btn').onclick = () => {
    const fly = $('#scene-fly');
    fly.hidden = !fly.hidden;
    $('#scene-btn').setAttribute('aria-expanded', String(!fly.hidden));
  };
  $('#scene-fly').addEventListener('click', (e) => {
    const t = e.target.closest('[data-scene]');
    if (!t) return;
    $('#scene-fly').hidden = true;
    $('#scene-btn').setAttribute('aria-expanded', 'false');
    setScene(t.dataset.scene);
  });
  $('#custom').addEventListener('click', (e) => {
    const sw = e.target.closest('.sw');
    if (sw) { state.colours[sw.dataset.zone] = sw.dataset.colour || null; applyLook(); syncPanel(); saveUrlSoon(); return; }
    const build = e.target.closest('.build');
    if (build && build.dataset.model !== state.model) setModel(build.dataset.model);
  });
  $('#xray').addEventListener('input', (e) => { state.seeThrough = Number(e.target.value); applyLook(); saveUrlSoon(); });
  $('#opt-wires').addEventListener('change', (e) => { state.wires = e.target.checked; applyLook(); saveUrlSoon(); });
  $('#opt-names').addEventListener('change', (e) => { state.names = e.target.checked; syncPanel(); saveUrlSoon(); });
  $('#btn-reset').onclick = () => {
    state.colours = Object.fromEntries(Object.keys(ZONES).map((z) => [z, null]));
    state.seeThrough = 0; state.wires = true;
    applyLook(); syncPanel(); saveUrlSoon();
  };
  $('#btn-share').onclick = async () => {
    saveUrl();
    try { await navigator.clipboard.writeText(location.href); toast('Link copied: it opens this glider just like this'); }
    catch { toast('Copy the address bar to share this glider'); }
  };
  $('#posebar').addEventListener('click', (e) => { const b = e.target.closest('[data-pose]'); if (b) setPose(b.dataset.pose); });
  $('#chip').addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') select(null);
    if (act === 'focus' && state.sel) focusPart(record.parts.get(state.sel));
  });
  let down = null;
  canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; userActive(); $('#scene-fly').hidden = true; });
  canvas.addEventListener('pointerup', (e) => {
    if (!down || e.button !== 0 || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5 || !record) return;
    select(pickPart(e));
  });
  canvas.addEventListener('dblclick', (e) => { const part = record && pickPart(e); if (part) { select(part); focusPart(part); } });
  canvas.addEventListener('wheel', userActive, { passive: true });
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    $('#loader').classList.remove('done');
    loaderText('The graphics stopped', 'Reload the page to bring the glider back.', 0, true);
    $('#ld-retry').onclick = () => location.reload();
  });
  document.addEventListener('keydown', (e) => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && e.target.type !== 'checkbox' && e.target.type !== 'range') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    userActive();
    const k = e.key.toLowerCase();
    if (e.key === 'Escape') { if (!$('#scene-fly').hidden) $('#scene-fly').hidden = true; else if (state.sel) select(null); else document.body.classList.remove('nohud'); return; }
    if (k === 'c') { state.panel = !state.panel; syncPanel(); }
    else if (k === 't') toggle2d();
    else if (k === 'n') frontView();
    else if (k === 'f') (state.tour ? stopTour() : startTour());
    else if (k === '+' || k === '=') zoom(0.7);
    else if (k === '-') zoom(1.4);
    else if (k === 'h') document.body.classList.toggle('nohud');
    else if (k === 'l') { state.names = !state.names; syncPanel(); }
    else if (k === '1' || k === '2' || k === '3') setScene(Object.keys(SCENES)[Number(k) - 1]);
    else return;
    e.preventDefault();
  });
}

// ------------------------------------------------------------------ address bar: the whole configuration
// ?model=opus&scene=hill&le=red&top=white&under=navy&frame=black&xray=0.6&wires=0&names=1&t=19.5&cam=...
function readCamera() {
  const c = (params.get('cam') || '').split(',');
  if (c.length !== 8 || !c.slice(0, 7).every((v) => Number.isFinite(Number(v)))) return null;
  const n = c.slice(0, 7).map(Number);
  return { projection: c[7] === 'o' ? 'orthographic' : 'perspective', pose: { target: new THREE.Vector3(n[0], n[1], n[2]), dir: new THREE.Vector3(n[3], n[4], n[5]).normalize(), size: n[6] } };
}
let urlTimer;
function saveUrlSoon() { clearTimeout(urlTimer); urlTimer = setTimeout(saveUrl, 400); }
function saveUrl() {
  if (!record || THUMB) return;
  const q = new URLSearchParams();
  q.set('model', state.model);
  if (state.scene !== 'studio') q.set('scene', state.scene);
  for (const [z, id] of Object.entries(state.colours)) if (id) q.set(z, id);
  if (state.seeThrough) q.set('xray', state.seeThrough.toFixed(2));
  if (!state.wires) q.set('wires', '0');
  if (state.pose !== 'bar') q.set('pose', state.pose);
  if (state.names) q.set('names', '1');
  if (state.scene === 'hill' && Math.abs(state.hours - 9.5) > 0.01) q.set('t', state.hours.toFixed(2));
  const p = rig.pose(), r = (v, d = 3) => Number(v.toFixed(d));
  q.set('cam', [...p.target.toArray().map((v) => r(v)), ...p.dir.toArray().map((v) => r(v, 4)), r(p.size), rig.projection === 'orthographic' ? 'o' : 'p'].join(','));
  history.replaceState(null, '', `${location.pathname}?${q.toString().replace(/%2C/g, ',')}`);
}

// ------------------------------------------------------------------ thumbnails (tools/thumbs.mjs)
async function runThumb() {
  document.body.classList.add('nohud');
  const [kind, id] = THUMB.split(':');
  if (kind === 'scene') { scenes.set(id); rig.animateTo(rig.frame(record.box, [0.5, 0.3, 1], 1.5), false); }
  if (kind === 'model') rig.animateTo(rig.frame(record.box, [0.42, 0.32, 1], 0.92), false);
  for (let i = 0; i < 40; i++) await frame();
  document.body.dataset.thumbReady = '1';
}

// ------------------------------------------------------------------ start (last, so every declaration above exists)
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true, preserveDrawingBuffer: Boolean(THUMB) });
} catch {
  loaderText('3D isn’t available', 'Turn on WebGL in your browser and reload the page.', 0, true);
}
if (renderer) boot();
