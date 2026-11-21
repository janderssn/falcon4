import './style.css';
import * as THREE from 'three';
import { CATEGORIES, loadCatalog, loadModel, trimCache, boundsOf, formatBytes, formatCount } from './lib/catalog.js';
import { CameraRig, VIEWS } from './lib/camera.js';
import { Environments, ENVIRONMENTS } from './lib/environments.js';
import { candidates, bestMatch } from './lib/match.js';
import { icon } from './lib/icons.js';

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const SLOTS = ['A', 'B'];
const MODES = {
  single: { label: 'Single', icon: 'single', hint: 'One model' },
  overlay: { label: 'Overlay', icon: 'overlay', hint: 'Both models in the same place' },
  side: { label: 'Side by side', icon: 'side', hint: 'Two viewports, cameras locked' },
  swipe: { label: 'Swipe', icon: 'swipe', hint: 'Drag the divider to compare' },
};
const CLOSEUPS = {
  nose: { label: 'Nose assembly', target: [0, 1.68, -0.08], offset: [0.25, -0.19, 0.43] },
  junction: { label: 'Crossbar / leading edge', target: [2.66, 1.68, -1.65], offset: [0.45, -0.4, 0.5] },
  basebar: { label: 'Basebar corner', target: [0.64, 0.23, -1.48], offset: [0.23, 0.16, 0.35] },
  tension: { label: 'Crossbar tension', target: [0, 1.7, -2.7], offset: [0.25, 0.2, 0.35] },
};

// ------------------------------------------------------------------ state
const state = {
  A: null, B: null,                 // source ids
  mode: 'single',
  env: 'studio', grid: true, shadows: true, wireframe: false, rotate: false,
  hiddenGroups: new Set(),
  hidden: { A: new Set(), B: new Set() },
  selection: { slot: 'A', names: new Set() },
  isolate: false, isoGhost: false,
  hover: null,
  fade: 0.3, tint: true, split: 0.5,
  listSlot: 'A', query: '',
  overrides: new Map(),             // "A:name" -> counterpart name in the other slot ('' = none)
};
const slots = { A: null, B: null };  // loaded model records
let catalog, renderer, rig, envs, grid;
const scene = new THREE.Scene();
const host = $('#canvas-host');

function start() {
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.info.autoReset = false;
  host.append(renderer.domElement);
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute('aria-label', '3D hang glider. Drag to orbit, scroll to zoom, right-drag to pan. Press F to fit, 1 to 5 for views.');

  rig = new CameraRig(renderer.domElement);
  rig.addEventListener('change', () => { requestRender(); saveUrlSoon(); });
  rig.controls.addEventListener('start', () => { rig.viewName = null; markView(); });
  envs = new Environments(renderer, scene);
  grid = new THREE.GridHelper(24, 48, 0x46525f, 0x303c49);
  grid.material.transparent = true;
  grid.material.opacity = 0.9;
  scene.add(grid);

  readUrl();
  envs.set(state.env, state.shadows);
  wireViewport();
  new ResizeObserver(resize).observe(host);
  resize();
  init();
}

async function init() {
  try {
    catalog = await loadCatalog();
  } catch (error) {
    fail('The model list could not load', error.message, () => location.reload());
    return;
  }
  fillSourceSelects();
  const firstModel = catalog.models[0].id;
  if (!catalog.sources.has(state.A)) state.A = firstModel;
  if (state.B && (!catalog.sources.has(state.B) || state.B === state.A)) state.B = null;
  if (state.mode !== 'single' && !state.B) state.B = defaultB();
  syncChrome();
  setSource('A', state.A);
  if (state.mode !== 'single') setSource('B', state.B);
}

function defaultB() {
  const a = catalog.sources.get(state.A);
  const other = catalog.models.find((m) => m.id !== a.modelId);
  if (other) return other.id;
  const version = [...catalog.sources.values()].find((s) => s.id !== state.A);
  return version ? version.id : null;
}

// ------------------------------------------------------------------ loading
const loading = { A: null, B: null };

async function setSource(slot, id) {
  const source = catalog.sources.get(id);
  if (!source) return;
  state[slot] = id;
  syncChrome();
  if (slots[slot] && slots[slot].source.id === id) return;
  loading[slot] = { id, progress: 0, label: source.label };
  showLoading();
  try {
    const record = await loadModel(source, (fraction, loaded) => {
      if (!loading[slot] || loading[slot].id !== id) return;
      loading[slot].progress = fraction;
      loading[slot].loaded = loaded;
      showLoading();
    });
    if (state[slot] !== id) return;
    loading[slot] = null;
    attach(slot, record);
  } catch (error) {
    console.error(error);
    if (state[slot] !== id) return;
    loading[slot] = { id, error: error.message, label: source.label };
    showLoading();
  }
}

function attach(slot, record) {
  const previous = slots[slot];
  if (previous && previous !== record) previous.root.removeFromParent();
  slots[slot] = record;
  scene.add(record.root);
  // Keep selection and hidden parts that exist in the new record (useful when comparing versions).
  for (const set of [state.hidden[slot], state.selection.slot === slot ? state.selection.names : null]) {
    if (!set) continue;
    for (const name of [...set]) if (!record.parts.has(name)) set.delete(name);
  }
  applyWireframe();
  placeGround();
  showLoading();
  const first = !rig.hasPose;
  if (first && slot === 'A') {
    if (pendingCamera) rig.animateTo(pendingCamera, false);
    else rig.animateTo(rig.frame(record.box, VIEWS.perspective.dir), false);
    rig.hasPose = true;
    pendingCamera = null;
    document.body.dataset.modelReady = 'true';
  }
  trimCache([state.A, state.B].filter(Boolean));
  refresh({ list: true });
  if (pendingFocus && slots.A && slots.B) { pendingFocus = false; focusParts(state.selection.slot, state.selection.names); }
}
let pendingFocus = false;

function showLoading() {
  const box = $('#loading');
  const active = SLOTS.filter((s) => loading[s] && (s === 'A' || state.mode !== 'single'));
  const nothingShown = !slots.A;
  const pill = $('#status-pill');
  if (!active.length) { box.hidden = true; pill.hidden = true; return; }
  const item = loading[active[0]];
  const pct = item.progress == null ? null : Math.round(item.progress * 100);
  const detail = item.error ? `${item.error}` : pct == null ? `${((item.loaded || 0) / 1048576).toFixed(1)} MB downloaded` : pct >= 100 ? 'Preparing materials…' : `${pct} %`;
  if (nothingShown && active.includes('A')) {
    box.hidden = false; pill.hidden = true;
    $('#load-title').textContent = item.error ? 'The model could not load' : `Loading ${item.label}…`;
    $('#load-detail').textContent = item.error ? `Check the connection and try again. ${detail}` : detail;
    $('#progress').hidden = Boolean(item.error);
    $('#progress').value = pct || 0;
    $('#retry').hidden = !item.error;
    $('#retry').onclick = () => setSource(active[0], item.id);
  } else {
    box.hidden = true; pill.hidden = false;
    pill.classList.toggle('error', Boolean(item.error));
    pill.innerHTML = item.error
      ? `<span>${esc(item.label)} could not load</span><button type="button">Retry</button>`
      : `<span class="spinner"></span><span>${active[0]} · ${esc(item.label)} — ${esc(detail)}</span>`;
    const retry = pill.querySelector('button');
    if (retry) retry.onclick = () => setSource(active[0], item.id);
  }
}

function fail(title, detail, retry) {
  $('#loading').hidden = false;
  $('#load-title').textContent = title;
  $('#load-detail').textContent = detail;
  $('#progress').hidden = true;
  $('#retry').hidden = !retry;
  if (retry) $('#retry').onclick = retry;
}

// ------------------------------------------------------------------ derived state
const shown = (slot) => slots[slot] && (slot === 'A' || state.mode !== 'single');
const other = (slot) => (slot === 'A' ? 'B' : 'A');
const comparing = () => state.mode !== 'single' && slots.A && slots.B;

function counterpart(slot, name) {
  const target = slots[other(slot)];
  const part = slots[slot] && slots[slot].parts.get(name);
  if (!target || !part) return null;
  const key = `${slot}:${name}`;
  if (state.overrides.has(key)) return target.parts.get(state.overrides.get(key)) || null;
  return bestMatch(part, target);
}

function selectedIn(slot) {
  const sel = state.selection;
  if (sel.slot === slot) return sel.names;
  if (!comparing()) return new Set();
  const out = new Set();
  for (const name of sel.names) {
    const match = counterpart(sel.slot, name);
    if (match) out.add(match.name);
  }
  return out;
}

function opacityOf(slot) {
  if (state.mode !== 'overlay') return 1;
  const f = state.fade;
  return slot === 'A' ? Math.min(1, 2 * (1 - f)) : Math.min(1, 2 * f);
}

// ------------------------------------------------------------------ styling
function restyle() {
  for (const slot of SLOTS) {
    const record = slots[slot];
    if (!record) continue;
    const sel = selectedIn(slot);
    const related = state.selection.slot !== slot;
    const iso = state.isolate && state.selection.names.size ? sel : null;
    const opacity = opacityOf(slot);
    const tint = state.mode === 'overlay' && state.tint && slot === 'B';
    for (const mesh of record.meshes) {
      const part = mesh.userData.part;
      const M = mesh.userData.materials;
      let visible = !state.hiddenGroups.has(part.group) && !state.hidden[slot].has(part.name);
      let alpha = opacity;
      if (iso && !iso.has(part.name)) {
        if (state.isoGhost) alpha = Math.min(alpha, 0.08);
        else visible = false;
      }
      const hover = state.hover && state.hover.slot === slot && state.hover.name === part.name;
      let mat = hover ? M.hover : sel.has(part.name) ? (related ? M.related : M.selected) : M.base;
      if (alpha < 0.999 || tint) {
        const g = M.ghost;
        g.opacity = alpha;
        g.transparent = alpha < 0.999;
        g.depthWrite = alpha >= 0.999;
        if (g.emissive) {
          if (mat !== M.base) { g.emissive.copy(mat.emissive); g.emissiveIntensity = mat.emissiveIntensity; }
          else if (tint) { g.emissive.set('#ff7a1a'); g.emissiveIntensity = 0.55; }
          else { g.emissive.set(0x000000); g.emissiveIntensity = 1; }
        }
        mat = g;
      }
      mesh.material = mat;
      mesh.visible = visible && alpha > 0.01;
    }
  }
  requestRender();
}

function applyWireframe() {
  for (const slot of SLOTS) {
    if (!slots[slot]) continue;
    for (const mesh of slots[slot].meshes) for (const m of Object.values(mesh.userData.materials)) m.wireframe = state.wireframe;
  }
  requestRender();
}

function placeGround() {
  const boxes = SLOTS.filter(shown).map((s) => slots[s].box);
  if (!boxes.length) return;
  const groundY = Math.min(...boxes.map((b) => b.min.y));
  const center = boxes[0].getCenter(new THREE.Vector3());
  center.y = groundY;
  envs.place(groundY, center);
  grid.position.set(center.x, groundY + 0.002, center.z);
  requestRender();
}

/** Re-renders everything that depends on state. */
function refresh({ list = false } = {}) {
  syncChrome();
  restyle();
  if (list) buildPartsList(); else markPartsList();
  renderLayers();
  renderInfo();
  renderStats();
  renderCount();
  saveUrlSoon();
}

// ------------------------------------------------------------------ rendering
let renderPending = false;
let previous = performance.now();
let size = { width: 1, height: 1 };

function requestRender() {
  if (renderPending || !renderer) return;
  renderPending = true;
  requestAnimationFrame(renderFrame);
}

function renderFrame(now) {
  renderPending = false;
  const dt = Math.min((now - previous) / 1000, 0.1);
  previous = now;
  const moving = rig.update(now, dt);
  draw();
  updateGizmo();
  if (moving) requestRender();
}

function setRootVisibility(only) {
  for (const slot of SLOTS) if (slots[slot]) slots[slot].root.visible = only ? slot === only && shown(slot) : shown(slot);
}

function draw() {
  const { width: w, height: h } = size;
  renderer.info.reset();
  renderer.setScissorTest(false);
  const cam = () => rig.camera;
  if (state.mode === 'side' && slots.B) {
    // Left / right, or top / bottom when the viewport is taller than wide.
    const stacked = h > w;
    const vw = stacked ? w : w / 2, vh = stacked ? h / 2 : h;
    rig.setAspect(vw / vh);
    renderer.setScissorTest(true);
    SLOTS.forEach((slot, i) => {
      const x = stacked ? 0 : i * vw, y = stacked ? (1 - i) * vh : 0;
      setRootVisibility(slot);
      renderer.setViewport(x, y, vw, vh);
      renderer.setScissor(x, y, vw, vh);
      renderer.render(scene, cam());
    });
  } else {
    rig.setAspect(w / h);
    renderer.setViewport(0, 0, w, h);
    if (state.mode === 'swipe' && slots.B) {
      const x = Math.round(state.split * w);
      setRootVisibility('A');
      renderer.setScissorTest(true);
      renderer.setScissor(0, 0, x, h);
      renderer.render(scene, cam());
      setRootVisibility('B');
      renderer.setScissor(x, 0, w - x, h);
      renderer.render(scene, cam());
    } else {
      setRootVisibility(null);
      renderer.render(scene, cam());
    }
  }
  renderer.setScissorTest(false);
  setRootVisibility(null);
  if (!$('[data-panel-body=stats]').hidden && now() - lastStats > 400) renderStats();
}
const now = () => performance.now();

function resize() {
  const { width, height } = host.getBoundingClientRect();
  size = { width: Math.max(1, width), height: Math.max(1, height) };
  document.body.classList.toggle('stacked', size.height > size.width);
  renderer.setSize(size.width, size.height);
  positionSwipe();
  requestRender();
}

// ------------------------------------------------------------------ camera helpers
let pendingCamera = null;

function setView(name, animate = !reduced) {
  const view = VIEWS[name];
  if (!view) return;
  rig.controls.autoRotate = state.rotate = false;
  rig.setProjection(view.projection);
  rig.animateTo(rig.frame(visibleBounds(), view.dir), animate);
  rig.viewName = name;
  markView();
  syncChrome();
}

function fit(animate = !reduced) {
  rig.animateTo(rig.frame(visibleBounds()), animate);
}

function visibleBounds() {
  const meshes = [];
  for (const slot of SLOTS) {
    if (!shown(slot)) continue;
    for (const m of slots[slot].meshes) if (m.visible && (!state.isolate || selectedIn(slot).has(m.userData.part.name) || !state.selection.names.size)) meshes.push(m);
  }
  if (!meshes.length) return slots.A ? slots.A.box : new THREE.Box3(new THREE.Vector3(-5, 0, -5), new THREE.Vector3(5, 3, 5));
  return boundsOf(meshes);
}

function focusParts(slot, names) {
  const meshes = [];
  // Side by side and swipe show each model in its own region with one camera,
  // so frame the selected model's part; overlay frames both.
  const both = state.mode === 'overlay';
  for (const s of SLOTS) {
    if (!shown(s) || (!both && s !== slot)) continue;
    const set = s === slot ? names : (comparing() ? new Set([...names].map((n) => counterpart(slot, n)?.name).filter(Boolean)) : new Set());
    for (const m of slots[s].meshes) if (set.has(m.userData.part.name)) meshes.push(m);
  }
  if (!meshes.length) return;
  const box = boundsOf(meshes);
  const pose = rig.frame(box, undefined, 1.6);
  pose.size = Math.max(pose.size, 0.12);
  rig.animateTo(pose, !reduced);
  rig.viewName = null;
  markView();
}

function markView() {
  $$('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === rig.viewName)));
  $('#view-name').textContent = rig.viewName ? VIEWS[rig.viewName]?.label || CLOSEUPS[rig.viewName]?.label : 'Custom view';
  $('#projection').setAttribute('aria-pressed', String(rig.projection === 'orthographic'));
  $('#projection').innerHTML = icon(rig.projection === 'orthographic' ? 'ortho' : 'persp') + `<span>${rig.projection === 'orthographic' ? 'Ortho' : 'Persp'}</span>`;
}

// ------------------------------------------------------------------ picking
const raycaster = new THREE.Raycaster();

function pick(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  let x = event.clientX - rect.left, y = event.clientY - rect.top;
  let w = rect.width, h = rect.height;
  let targets = SLOTS.filter(shown);
  if (state.mode === 'side' && slots.B) {
    if (h > w) {
      const bottom = y > h / 2;
      targets = [bottom ? 'B' : 'A'];
      if (bottom) y -= h / 2;
      h /= 2;
    } else {
      const right = x > w / 2;
      targets = [right ? 'B' : 'A'];
      if (right) x -= w / 2;
      w /= 2;
    }
  } else if (state.mode === 'swipe' && slots.B) {
    targets = [x > state.split * w ? 'B' : 'A'];
  } else if (state.mode === 'single') targets = ['A'];
  const ndc = new THREE.Vector2((x / w) * 2 - 1, -(y / h) * 2 + 1);
  raycaster.setFromCamera(ndc, rig.camera);
  raycaster.params.Line.threshold = 0.01;
  const meshes = [];
  for (const slot of targets) {
    if (!slots[slot]) continue;
    for (const m of slots[slot].meshes) if (m.visible && (!m.material.transparent || m.material.opacity > 0.25)) meshes.push(m);
  }
  const hit = raycaster.intersectObjects(meshes, false)[0];
  if (!hit) return null;
  const slot = targets.find((s) => slots[s].meshes.includes(hit.object));
  return { slot, name: hit.object.userData.part.name };
}

function select(slot, name, { toggle = false } = {}) {
  const sel = state.selection;
  if (!name) { sel.names = new Set(); state.isolate = false; }
  else if (toggle && sel.slot === slot) {
    if (sel.names.has(name)) sel.names.delete(name); else sel.names.add(name);
  } else {
    state.selection = { slot, names: new Set([name]) };
  }
  if (!state.selection.names.size) state.isolate = false;
  refresh();
  if (name) scrollListTo(slot, name);
}

function wireViewport() {
  const canvas = renderer.domElement;
  let down = null;
  canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
  canvas.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4 || e.button !== 0) return;
    const hit = pick(e);
    if (hit) select(hit.slot, hit.name, { toggle: e.shiftKey || e.metaKey || e.ctrlKey });
    else if (!e.shiftKey) select(null);
  });
  canvas.addEventListener('dblclick', (e) => {
    const hit = pick(e);
    if (hit) { select(hit.slot, hit.name); focusParts(hit.slot, new Set([hit.name])); }
  });
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    fail('Graphics connection interrupted', 'Reload the page to restore the model.', () => location.reload());
  });
  document.addEventListener('keydown', onKey);

  // Swipe divider.
  const handle = $('#swipe-handle');
  let dragging = false;
  handle.addEventListener('pointerdown', (e) => { dragging = true; handle.setPointerCapture(e.pointerId); });
  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const rect = host.getBoundingClientRect();
    state.split = THREE.MathUtils.clamp((e.clientX - rect.left) / rect.width, 0.02, 0.98);
    positionSwipe();
    requestRender();
  });
  handle.addEventListener('pointerup', () => { dragging = false; saveUrlSoon(); });
  handle.addEventListener('keydown', (e) => {
    const step = e.key === 'ArrowLeft' ? -0.02 : e.key === 'ArrowRight' ? 0.02 : 0;
    if (!step) return;
    e.preventDefault();
    state.split = THREE.MathUtils.clamp(state.split + step, 0.02, 0.98);
    positionSwipe(); requestRender(); saveUrlSoon();
  });
}

function positionSwipe() {
  const handle = $('#swipe-handle');
  handle.style.left = `${state.split * 100}%`;
  handle.setAttribute('aria-valuenow', String(Math.round(state.split * 100)));
}

// ------------------------------------------------------------------ keyboard
function onKey(e) {
  const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) && e.target.type !== 'checkbox' && e.target.type !== 'range';
  if (e.key === 'Escape') {
    if (typing) { e.target.blur(); return; }
    if ($('#help').open) return;
    if (state.isolate) { state.isolate = false; refresh(); return; }
    select(null);
    return;
  }
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  const key = e.key.toLowerCase();
  const view = Object.entries(VIEWS).find(([, v]) => v.key === e.key);
  if (view) { setView(view[0]); }
  else if (key === 'p') setView('perspective');
  else if (key === 'o') { rig.setProjection(rig.projection === 'orthographic' ? 'perspective' : 'orthographic'); markView(); }
  else if (key === 'f') fit();
  else if (key === 'i') toggleIsolate();
  else if (key === 'h' && e.shiftKey) showAllParts();
  else if (key === 'h') hideSelected();
  else if (key === 'g') setOption('grid', !state.grid);
  else if (key === 'w') setOption('wireframe', !state.wireframe);
  else if (key === 'r') setOption('rotate', !state.rotate);
  else if (key === 'e') { const names = Object.keys(ENVIRONMENTS); setOption('env', names[(names.indexOf(state.env) + 1) % names.length]); }
  else if (key === 'c') { const names = Object.keys(MODES); setMode(names[(names.indexOf(state.mode) + 1) % names.length]); }
  else if (e.key === '/') { e.preventDefault(); openPanel('parts'); $('#search').focus(); }
  else if (e.key === '?') $('#help').showModal();
  else return;
  e.preventDefault();
}

// ------------------------------------------------------------------ actions
function setMode(mode) {
  if (!MODES[mode]) return;
  state.mode = mode;
  if (mode !== 'single') {
    if (!state.B || state.B === state.A) state.B = defaultB();
    if (state.B && (!slots.B || slots.B.source.id !== state.B)) setSource('B', state.B);
  } else if (state.selection.slot === 'B') {
    state.selection = { slot: 'A', names: new Set() };
    state.isolate = false;
  }
  if (mode === 'single') state.listSlot = 'A';
  placeGround();
  showLoading();
  refresh({ list: true });
  positionSwipe();
}

function setOption(name, value) {
  state[name] = value;
  if (name === 'grid') grid.visible = value;
  if (name === 'wireframe') applyWireframe();
  if (name === 'rotate') { rig.controls.autoRotate = value; rig.transition = null; }
  if (name === 'env') { envs.set(value, state.shadows); placeGround(); }
  if (name === 'shadows') envs.setShadows(value);
  syncChrome();
  requestRender();
  saveUrlSoon();
}

function toggleIsolate(force) {
  if (!state.selection.names.size) { toast('Select a part to isolate it'); return; }
  state.isolate = force ?? !state.isolate;
  refresh();
  fit();
}

function hideSelected() {
  const sel = state.selection;
  if (!sel.names.size) return;
  for (const name of sel.names) state.hidden[sel.slot].add(name);
  select(null);
}

function showAllParts() {
  state.hidden.A.clear(); state.hidden.B.clear(); state.hiddenGroups.clear(); state.isolate = false;
  refresh();
}

function comparePart() {
  const sel = state.selection;
  if (!sel.names.size) return;
  if (state.mode === 'single') setMode('side');
  state.isolate = true;
  refresh();
  if (slots.A && slots.B) focusParts(sel.slot, sel.names);
  else pendingFocus = true;
}

function closeup(name) {
  const c = CLOSEUPS[name];
  rig.setProjection('perspective');
  const offset = new THREE.Vector3(...c.offset);
  rig.animateTo({ target: new THREE.Vector3(...c.target), dir: offset.clone().normalize(), size: 2 * offset.length() * Math.tan(THREE.MathUtils.degToRad(19)) }, !reduced);
  state.hiddenGroups = new Set(['01']);
  rig.viewName = null;
  refresh();
  $('#view-name').textContent = c.label;
}

function resetViewer() {
  Object.assign(state, { wireframe: false, rotate: false, grid: true, isolate: false, isoGhost: false, fade: 0.3, tint: true, split: 0.5 });
  state.hiddenGroups.clear(); state.hidden.A.clear(); state.hidden.B.clear();
  state.selection = { slot: 'A', names: new Set() };
  grid.visible = true;
  rig.controls.autoRotate = false;
  applyWireframe();
  refresh();
  setView('perspective');
}

let toastTimer;
function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
}

async function share() {
  saveUrl();
  try { await navigator.clipboard.writeText(location.href); toast('Link copied — it opens this exact view'); }
  catch { toast('Copy the address bar to share this view'); }
}

function capture() {
  draw();
  renderer.domElement.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `falcon4-${state.A}${state.mode !== 'single' && state.B ? `-vs-${state.B}` : ''}.png`.replace(/@/g, '-');
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
}

// ------------------------------------------------------------------ chrome (static UI)
function buildChrome() {
  $('#compare-modes').innerHTML = Object.entries(MODES).map(([key, m]) =>
    `<button type="button" data-mode="${key}" title="${m.hint}" aria-pressed="false">${icon(m.icon)}<span>${m.label}</span></button>`).join('');
  $('#viewbar').innerHTML = Object.entries(VIEWS).map(([key, v]) =>
    `<button type="button" data-view="${key}" title="${v.label} (${v.key})" aria-pressed="false">${v.label}</button>`).join('')
    + '<span class="sep"></span><button type="button" id="projection" title="Orthographic / perspective (O)" aria-pressed="false"></button>'
    + `<button type="button" id="fit" title="Fit to view (F)">${icon('fit')}<span>Fit</span></button>`;
  $('#env-list').innerHTML = Object.entries(ENVIRONMENTS).map(([key, e]) =>
    `<button type="button" class="env-card env-${key}" data-env="${key}" aria-pressed="false"><span class="env-swatch"></span><strong>${e.label}</strong><small>${e.detail}</small></button>`).join('');
  $('#closeups').innerHTML = Object.entries(CLOSEUPS).map(([key, c]) => `<button type="button" class="chip" data-closeup="${key}">${c.label}</button>`).join('');
  for (const el of $$('[data-icon]')) el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon));

  $('#compare-modes').addEventListener('click', (e) => { const b = e.target.closest('[data-mode]'); if (b) setMode(b.dataset.mode); });
  $('#viewbar').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.view) setView(b.dataset.view);
    else if (b.id === 'projection') { rig.setProjection(rig.projection === 'orthographic' ? 'perspective' : 'orthographic'); markView(); }
    else if (b.id === 'fit') fit();
  });
  $('#env-list').addEventListener('click', (e) => { const b = e.target.closest('[data-env]'); if (b) setOption('env', b.dataset.env); });
  $('#closeups').addEventListener('click', (e) => { const b = e.target.closest('[data-closeup]'); if (b) closeup(b.dataset.closeup); });
  for (const name of ['grid', 'shadows', 'wireframe', 'rotate']) $(`#opt-${name}`).addEventListener('change', (e) => setOption(name, e.target.checked));
  $('#reset').onclick = resetViewer;
  $('#share').onclick = share;
  $('#capture').onclick = capture;
  $('#help-btn').onclick = () => $('#help').showModal();
  $('#help-close').onclick = () => $('#help').close();
  $('#source-a').onchange = (e) => {
    const id = e.target.value;
    if (id === state.B) { state.B = slots.A ? slots.A.source.id : defaultB(); setSource('B', state.B); }
    setSource('A', id);
  };
  $('#source-b').onchange = (e) => {
    if (state.mode === 'single') setMode('side');
    setSource('B', e.target.value);
  };
  $('#fade').addEventListener('input', (e) => { state.fade = Number(e.target.value); restyle(); saveUrlSoon(); });
  $('#tint').addEventListener('change', (e) => { state.tint = e.target.checked; restyle(); saveUrlSoon(); });
  $('#iso-ghost').addEventListener('change', (e) => { state.isoGhost = e.target.checked; restyle(); saveUrlSoon(); });

  // Panels.
  $('#rail').addEventListener('click', (e) => { const b = e.target.closest('[data-panel]'); if (b) openPanel(b.dataset.panel, true); });
  $('#panel-close').onclick = () => openPanel(null);
  $('#search').addEventListener('input', (e) => { state.query = e.target.value; buildPartsList(); });
  $('#parts-slot').addEventListener('click', (e) => { const b = e.target.closest('[data-slot]'); if (b) { state.listSlot = b.dataset.slot; buildPartsList(); syncChrome(); } });
  wirePartsList();
  $('#layer-list').addEventListener('change', (e) => {
    const key = e.target.dataset.group;
    if (!key) return;
    if (e.target.checked) state.hiddenGroups.delete(key); else state.hiddenGroups.add(key);
    refresh();
  });
  $('#layers-extra').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.action === 'show-all') showAllParts();
    if (b.dataset.action === 'only-frame') { state.hiddenGroups = new Set(['01']); refresh(); }
    if (b.dataset.action === 'unhide') { state.hidden[b.dataset.slot].delete(b.dataset.name); refresh(); }
  });
  $('#info-card').addEventListener('click', onInfoClick);
  $('#info-card').addEventListener('change', (e) => {
    if (e.target.id !== 'counterpart') return;
    const sel = state.selection;
    const [name] = sel.names;
    state.overrides.set(`${sel.slot}:${name}`, e.target.value);
    refresh();
  });
  openPanel(matchMedia('(max-width: 800px)').matches ? null : 'parts');
}

function openPanel(name, toggle = false) {
  const current = document.body.dataset.panel || null;
  if (toggle && current === name) name = null;
  if (name) document.body.dataset.panel = name; else delete document.body.dataset.panel;
  for (const b of $$('#rail [data-panel]')) b.setAttribute('aria-pressed', String(b.dataset.panel === name));
  for (const s of $$('[data-panel-body]')) s.hidden = s.dataset.panelBody !== name;
  $('#panel-title').textContent = name ? $(`#rail [data-panel=${name}] span`).textContent : '';
  if (name === 'stats') renderStats();
  if (renderer) requestAnimationFrame(resize);
}

function fillSourceSelects() {
  const html = catalog.models.map((m) => {
    const versions = [...catalog.sources.values()].filter((s) => s.modelId === m.id);
    return `<optgroup label="${esc(m.label)}">${versions.map((s) => `<option value="${esc(s.id)}">${esc(s.current ? m.label : `${m.label} · ${s.versionLabel}`)}</option>`).join('')}</optgroup>`;
  }).join('');
  $('#source-a').innerHTML = html;
  $('#source-b').innerHTML = html;
}

function syncChrome() {
  document.body.dataset.mode = state.mode;
  $$('#compare-modes [data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === state.mode)));
  if (catalog) {
    $('#source-a').value = state.A;
    $('#source-b').value = state.B || defaultB() || '';
    for (const o of $$('#source-b option')) o.disabled = o.value === state.A;
    for (const o of $$('#source-a option')) o.disabled = state.mode !== 'single' && o.value === state.B;
    const a = catalog.sources.get(state.A);
    const b = state.B && catalog.sources.get(state.B);
    $('#download').href = a.glb;
    $('#download').download = a.download;
    $('#download').title = `Download ${a.label} GLB`;
    document.title = state.mode !== 'single' && b ? `Falcon 4 — ${a.label} vs ${b.label}` : `Falcon 4 — ${a.title}`;
    $('#label-a').textContent = `A · ${a.label}`;
    $('#label-b').textContent = b ? `B · ${b.label}` : '';
    $('#model-description').textContent = a.description;
    $('#parts-slot').innerHTML = SLOTS.map((s) => {
      const src = s === 'A' ? a : b;
      return src ? `<button type="button" data-slot="${s}" aria-pressed="${state.listSlot === s}"><span class="slot-tag">${s}</span>${esc(src.label)}</button>` : '';
    }).join('');
  }
  $('#parts-slot').hidden = state.mode === 'single';
  $('#slot-b').classList.toggle('inactive', state.mode === 'single');
  $('#overlay-controls').hidden = !(state.mode === 'overlay' && slots.B);
  $('#swipe-handle').hidden = !(state.mode === 'swipe' && slots.B);
  $('#fade').value = state.fade;
  $('#tint').checked = state.tint;
  $('#iso-ghost').checked = state.isoGhost;
  for (const name of ['grid', 'shadows', 'wireframe', 'rotate']) $(`#opt-${name}`).checked = state[name];
  $$('#env-list [data-env]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.env === state.env)));
  if (rig) markView();
}

// ------------------------------------------------------------------ parts list
let listRows = new Map();

function buildPartsList() {
  const slot = state.mode === 'single' ? 'A' : state.listSlot;
  const record = slots[slot];
  const list = $('#parts-list');
  listRows = new Map();
  if (!record) { list.innerHTML = '<p class="empty">Loading parts…</p>'; $('#parts-meta').textContent = ''; return; }
  const terms = state.query.toLowerCase().split(/\s+/).filter(Boolean);
  // One-letter terms ("L", "R") match whole words only, so "crossbar L" finds the left half.
  const tests = terms.map((t) => (t.length === 1 ? new RegExp(`(^|[^a-z0-9])${t}([^a-z0-9]|$)`) : { test: (s) => s.includes(t) }));
  const groups = Object.fromEntries(Object.keys(CATEGORIES).map((k) => [k, []]));
  let shownCount = 0;
  for (const part of record.parts.values()) {
    const hay = `${part.key} ${(part.info.part_no || '').toLowerCase()} ${(part.info.description || '').toLowerCase()}`;
    if (tests.every((t) => t.test(hay))) { (groups[part.group] || groups['06']).push(part); shownCount++; }
  }
  const numbered = record.stats.numbered;
  $('#parts-meta').textContent = `${shownCount} of ${record.parts.size} parts${numbered ? ` · ${numbered} with part numbers` : ' · no part numbers in this build'}`;
  const html = [];
  for (const [key, parts] of Object.entries(groups)) {
    if (!parts.length) continue;
    parts.sort((x, y) => x.name.localeCompare(y.name, 'en', { numeric: true }));
    html.push(`<details class="part-group" ${terms.length || collapsed.has(key) === false ? 'open' : collapsed.has(key) ? '' : 'open'} data-group="${key}"><summary>${icon('chevron', 'chev')}<span>${CATEGORIES[key]}</span><small>${parts.length}</small></summary><div role="listbox" aria-label="${CATEGORIES[key]}" aria-multiselectable="true">`);
    for (const p of parts) {
      html.push(`<div class="part-row" role="option" tabindex="-1" data-name="${esc(p.name)}" aria-selected="false"><span class="part-name">${highlight(p.name, terms)}</span>${p.info.part_no ? `<span class="part-no">${highlight(p.info.part_no, terms)}</span>` : ''}<button type="button" class="row-btn" data-act="hide" title="Hide / show">${icon('eye')}</button></div>`);
    }
    html.push('</div></details>');
  }
  list.innerHTML = html.join('') || '<p class="empty">No parts match. Try a part number such as <code>AN4</code> or a word such as <code>batten</code>.</p>';
  for (const row of $$('.part-row', list)) listRows.set(row.dataset.name, row);
  list.dataset.slot = slot;
  markPartsList();
}
const collapsed = new Map();

function highlight(text, terms) {
  let out = esc(text);
  for (const t of terms.filter((x) => x.length > 1)) out = out.replace(new RegExp(`(${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig'), '<mark>$1</mark>');
  return out;
}

function markPartsList() {
  const slot = $('#parts-list').dataset.slot;
  if (!slot) return;
  const sel = selectedIn(slot);
  for (const [name, row] of listRows) {
    row.setAttribute('aria-selected', String(sel.has(name)));
    row.classList.toggle('related', sel.has(name) && state.selection.slot !== slot);
    const hidden = state.hidden[slot].has(name);
    row.classList.toggle('is-hidden', hidden);
    const btn = row.querySelector('[data-act=hide]');
    btn.innerHTML = icon(hidden ? 'eyeOff' : 'eye');
    btn.title = hidden ? 'Show this part' : 'Hide this part';
  }
}

function scrollListTo(slot, name) {
  if ($('#parts-list').dataset.slot !== slot) return;
  const row = listRows.get(name);
  if (!row) return;
  const group = row.closest('details');
  if (group && !group.open) group.open = true;
  row.scrollIntoView({ block: 'nearest' });
}

function wirePartsList() {
  const list = $('#parts-list');
  const rowOf = (e) => e.target.closest('.part-row');
  list.addEventListener('click', (e) => {
    const row = rowOf(e);
    if (!row) return;
    const slot = list.dataset.slot;
    if (e.target.closest('[data-act=hide]')) {
      const set = state.hidden[slot];
      if (set.has(row.dataset.name)) set.delete(row.dataset.name); else set.add(row.dataset.name);
      refresh();
      return;
    }
    select(slot, row.dataset.name, { toggle: e.shiftKey || e.metaKey || e.ctrlKey });
  });
  list.addEventListener('dblclick', (e) => {
    const row = rowOf(e);
    if (row && !e.target.closest('button')) focusParts(list.dataset.slot, new Set([row.dataset.name]));
  });
  list.addEventListener('pointerover', (e) => {
    const row = rowOf(e);
    const next = row ? { slot: list.dataset.slot, name: row.dataset.name } : null;
    if (next?.name === state.hover?.name && next?.slot === state.hover?.slot) return;
    state.hover = next;
    restyle();
  });
  list.addEventListener('pointerleave', () => { state.hover = null; restyle(); });
  list.addEventListener('toggle', (e) => { if (e.target.dataset.group) collapsed.set(e.target.dataset.group, !e.target.open); }, true);
  list.addEventListener('keydown', (e) => {
    const rows = [...listRows.values()].filter((r) => r.offsetParent);
    const i = rows.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (next) { next.focus(); select(list.dataset.slot, next.dataset.name); }
    } else if (e.key === 'Enter' && i >= 0) focusParts(list.dataset.slot, new Set([rows[i].dataset.name]));
  });
  $('#search').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); const first = [...listRows.values()][0]; if (first) { first.focus(); select(list.dataset.slot, first.dataset.name); } }
  });
}

// ------------------------------------------------------------------ layers panel
function renderLayers() {
  const counts = (slot) => (shown(slot) ? slots[slot].groups : null);
  const a = counts('A'), b = counts('B');
  $('#layer-list').innerHTML = Object.entries(CATEGORIES).map(([key, label]) => `
    <label class="toggle"><span>${label}<small>${a ? a[key] || 0 : ''}${b ? ` / ${b[key] || 0}` : ''}</small></span>
    <input type="checkbox" data-group="${key}" ${state.hiddenGroups.has(key) ? '' : 'checked'}></label>`).join('');
  const hidden = SLOTS.flatMap((slot) => [...state.hidden[slot]].map((name) => ({ slot, name })));
  $('#layers-extra').innerHTML = `
    <div class="button-row"><button type="button" data-action="only-frame">Hide sail</button><button type="button" data-action="show-all">Show everything</button></div>
    ${hidden.length ? `<h3>Hidden parts <small>${hidden.length}</small></h3><ul class="hidden-list">${hidden.map((h) =>
      `<li><span class="slot-tag">${h.slot}</span><span>${esc(h.name)}</span><button type="button" data-action="unhide" data-slot="${h.slot}" data-name="${esc(h.name)}" title="Show">${icon('eye')}</button></li>`).join('')}</ul>` : ''}`;
}

function renderCount() {
  const parts = (slot) => {
    const r = slots[slot];
    if (!r) return '';
    const visible = new Set(r.meshes.filter((m) => m.visible).map((m) => m.userData.part.name)).size;
    return `${visible} / ${r.parts.size}`;
  };
  $('#part-count').textContent = shown('B') ? `A ${parts('A')} · B ${parts('B')} parts` : `${parts('A')} parts`;
}

// ------------------------------------------------------------------ info card
function renderInfo() {
  const card = $('#info-card');
  const sel = state.selection;
  const record = slots[sel.slot];
  if (!record || !sel.names.size || !shown(sel.slot)) { card.hidden = true; return; }
  card.hidden = false;
  const parts = [...sel.names].map((n) => record.parts.get(n)).filter(Boolean);
  const tag = state.mode !== 'single' ? `<span class="slot-tag">${sel.slot}</span>` : '';
  const actions = `<div class="card-actions">
    <button type="button" data-act="focus">${icon('focus')}<span>Focus</span></button>
    <button type="button" data-act="isolate" aria-pressed="${state.isolate}">${icon('isolate')}<span>${state.isolate ? 'Show all' : 'Isolate'}</span></button>
    <button type="button" data-act="hide">${icon('eyeOff')}<span>Hide</span></button>
    ${catalog.sources.size > 1 ? `<button type="button" data-act="compare">${icon('compare')}<span>Compare</span></button>` : ''}
  </div>`;
  if (parts.length > 1) {
    const tris = parts.reduce((n, p) => n + p.triangles, 0);
    card.innerHTML = `<div class="card-head">${tag}<h3>${parts.length} parts selected</h3><button type="button" class="icon-btn" data-act="close" title="Clear selection (Esc)">${icon('close')}</button></div>
      <ul class="card-list">${parts.slice(0, 8).map((p) => `<li>${esc(p.name)}${p.info.part_no ? ` <span class="part-no">${esc(p.info.part_no)}</span>` : ''}</li>`).join('')}${parts.length > 8 ? `<li class="muted">and ${parts.length - 8} more</li>` : ''}</ul>
      <dl class="facts"><dt>Triangles</dt><dd>${formatCount(tris)}</dd><dt>Size</dt><dd>${dims(boundsOf(parts.flatMap((p) => p.meshes)))}</dd></dl>${actions}`;
    return;
  }
  const p = parts[0];
  const info = p.info;
  let compare = '';
  const otherSlot = other(sel.slot);
  if (comparing()) {
    const match = counterpart(sel.slot, p.name);
    const options = candidates(p, slots[otherSlot]);
    if (match && !options.some((o) => o.part === match)) options.unshift({ part: match });
    compare = `<label class="counterpart"><span><span class="slot-tag">${otherSlot}</span> Matching part</span>
      <select id="counterpart"><option value="">— none —</option>${options.map((o) => `<option value="${esc(o.part.name)}" ${o.part === match ? 'selected' : ''}>${esc(o.part.name)}${o.part.info.part_no ? ` · ${esc(o.part.info.part_no)}` : ''}</option>`).join('')}</select></label>`;
    if (match) compare += `<p class="delta">${diffLine(p, match)}</p>`;
  }
  card.innerHTML = `<div class="card-head">${tag}<h3>${esc(p.name)}</h3><button type="button" class="icon-btn" data-act="close" title="Clear selection (Esc)">${icon('close')}</button></div>
    <div class="chips">${info.part_no ? `<span class="part-no big" title="Manufacturer part number">${esc(info.part_no)}</span>` : ''}<span class="chip static">${CATEGORIES[p.group]}</span></div>
    ${info.description ? `<p class="desc">${esc(info.description)}</p>` : ''}
    <dl class="facts">
      <dt>Size</dt><dd>${dims(boundsOf(p.meshes))}</dd>
      <dt>Mesh</dt><dd>${formatCount(p.triangles)} tris · ${formatCount(p.vertices)} verts</dd>
      ${info.source ? `<dt>Source</dt><dd>${esc(info.source)}</dd>` : ''}
      ${info.note ? `<dt>Note</dt><dd>${esc(info.note)}</dd>` : ''}
    </dl>${compare}${actions}`;
}

function dims(box) {
  const s = box.getSize(new THREE.Vector3()).multiplyScalar(1000);
  const f = (v) => (v >= 1000 ? `${(v / 1000).toFixed(2)} m` : `${Math.round(v)} mm`);
  return `${f(s.x)} × ${f(s.y)} × ${f(s.z)}`;
}

function diffLine(a, b) {
  const sa = boundsOf(a.meshes).getSize(new THREE.Vector3()), sb = boundsOf(b.meshes).getSize(new THREE.Vector3());
  const ca = boundsOf(a.meshes).getCenter(new THREE.Vector3()), cb = boundsOf(b.meshes).getCenter(new THREE.Vector3());
  const longest = (s) => Math.max(s.x, s.y, s.z) * 1000;
  const d = longest(sb) - longest(sa);
  return `Longest side ${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(0)} mm · centres ${(ca.distanceTo(cb) * 1000).toFixed(0)} mm apart · ${formatCount(a.triangles)} vs ${formatCount(b.triangles)} tris`;
}

function onInfoClick(e) {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const sel = state.selection;
  ({
    close: () => select(null),
    focus: () => focusParts(sel.slot, sel.names),
    isolate: () => toggleIsolate(),
    hide: hideSelected,
    compare: comparePart,
  })[b.dataset.act]?.();
}

// ------------------------------------------------------------------ stats
let lastStats = 0;
function renderStats() {
  if ($('[data-panel-body=stats]').hidden) return;
  lastStats = now();
  const cols = SLOTS.filter(shown);
  const head = cols.map((s) => `<th>${state.mode !== 'single' ? `<span class="slot-tag">${s}</span>` : ''}${esc(slots[s].source.label)}</th>`).join('');
  const row = (label, f) => `<tr><th>${label}</th>${cols.map((s) => `<td>${f(slots[s])}</td>`).join('')}</tr>`;
  const st = (r) => r.stats;
  const visible = (r) => r.meshes.filter((m) => m.visible);
  const sum = (ms, k) => ms.reduce((n, m) => n + (k === 't' ? (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3 : m.geometry.attributes.position.count), 0);
  const sel = state.selection;
  const selParts = (s) => [...selectedIn(s)].map((n) => slots[s].parts.get(n)).filter(Boolean);
  const info = renderer.info;
  $('#stats').innerHTML = cols.length ? `
    <table class="stats"><thead><tr><th></th>${head}</tr></thead><tbody>
    ${row('Triangles', (r) => formatCount(st(r).triangles))}
    ${row('Vertices', (r) => formatCount(st(r).vertices))}
    ${row('Parts', (r) => st(r).parts)}
    ${row('With part no.', (r) => st(r).numbered)}
    ${row('Meshes', (r) => st(r).meshes)}
    ${row('Materials', (r) => st(r).materials)}
    ${row('Textures', (r) => `${st(r).textures}${st(r).texturePixels ? ` · ${(st(r).texturePixels / 1e6).toFixed(1)} MP` : ''}`)}
    ${row('GLB size', (r) => formatBytes(st(r).bytes))}
    ${row('Size (W×H×L)', (r) => dims(r.box).replace(/ × /g, '×'))}
    </tbody><tbody class="sub"><tr><th colspan="${cols.length + 1}">Visible now</th></tr>
    ${row('Triangles', (r) => formatCount(sum(visible(r), 't')))}
    ${row('Vertices', (r) => formatCount(sum(visible(r), 'v')))}
    </tbody>${sel.names.size ? `<tbody class="sub"><tr><th colspan="${cols.length + 1}">Selection</th></tr>
    ${row('Parts', (r) => selParts(cols.find((s) => slots[s] === r)).length)}
    ${row('Triangles', (r) => formatCount(selParts(cols.find((s) => slots[s] === r)).reduce((n, p) => n + p.triangles, 0)))}
    ${row('Vertices', (r) => formatCount(selParts(cols.find((s) => slots[s] === r)).reduce((n, p) => n + p.vertices, 0)))}
    </tbody>` : ''}</table>
    <h3>Renderer</h3>
    <dl class="facts"><dt>Draw calls</dt><dd>${info.render.calls}</dd><dt>Drawn triangles</dt><dd>${formatCount(info.render.triangles)}</dd>
    <dt>GPU geometries</dt><dd>${info.memory.geometries}</dd><dt>GPU textures</dt><dd>${info.memory.textures}</dd>
    <dt>Pixel ratio</dt><dd>${renderer.getPixelRatio().toFixed(2)}</dd></dl>` : '<p class="empty">Loading…</p>';
}

// ------------------------------------------------------------------ gizmo
const AXES = [
  { v: [1, 0, 0], label: 'X', color: '#e0605a', dir: [1, 0, 0] },
  { v: [0, 1, 0], label: 'Y', color: '#7bc96f', dir: [0, 1, -1e-4] },
  { v: [0, 0, 1], label: 'Z', color: '#5f9be8', dir: [0, 0, 1] },
  { v: [-1, 0, 0], label: '', color: '#e0605a', dir: [-1, 0, 0] },
  { v: [0, -1, 0], label: '', color: '#7bc96f', dir: [0, -1, 1e-4] },
  { v: [0, 0, -1], label: '', color: '#5f9be8', dir: [0, 0, -1] },
];
const AXIS_NAMES = ['Side (+X)', 'Top', 'Front (nose, +Z)', 'Side (−X)', 'Bottom', 'Back'];
let gizmoQuat = null;
function updateGizmo() {
  const g = $('#gizmo');
  if (!g.firstChild) {
    // Negative ends first so the labelled positive ends draw on top.
    const order = [3, 4, 5, 0, 1, 2];
    g.innerHTML = `<svg viewBox="0 0 80 80" role="group" aria-label="Axis gizmo: click an axis to look along it">${order.map((i) => {
      const a = AXES[i];
      return `${a.label ? `<line data-line="${i}" x1="40" y1="40" stroke="${a.color}" stroke-width="2"/>` : ''}
      <g class="axis" data-axis="${i}" tabindex="0" role="button" aria-label="${AXIS_NAMES[i]} view"><title>${AXIS_NAMES[i]}</title>
      <circle r="${a.label ? 8 : 6}" fill="${a.label ? a.color : '#1b2530'}" stroke="${a.color}" stroke-width="1.5"/>
      ${a.label ? `<text text-anchor="middle">${a.label}</text>` : ''}</g>`;
    }).join('')}</svg>`;
  }
  if (gizmoQuat && gizmoQuat.equals(rig.camera.quaternion)) return;
  gizmoQuat = rig.camera.quaternion.clone();
  const q = gizmoQuat.clone().invert();
  AXES.forEach((a, i) => {
    const p = new THREE.Vector3(...a.v).applyQuaternion(q);
    const x = 40 + p.x * 27, y = 40 - p.y * 27;
    const el = g.querySelector(`[data-axis="${i}"]`);
    el.querySelector('circle').setAttribute('cx', x);
    el.querySelector('circle').setAttribute('cy', y);
    el.style.opacity = p.z < -0.2 ? 0.55 : 1;
    const t = el.querySelector('text');
    if (t) { t.setAttribute('x', x); t.setAttribute('y', y + 3.5); }
    const line = g.querySelector(`[data-line="${i}"]`);
    if (line) { line.setAttribute('x2', x); line.setAttribute('y2', y); }
  });
}
function wireGizmo() {
  const go = (el) => {
    const axis = AXES[Number(el.dataset.axis)];
    rig.setProjection('orthographic');
    rig.animateTo(rig.frame(visibleBounds(), axis.dir), !reduced);
    rig.viewName = Object.entries(VIEWS).find(([, v]) => v.dir.join() === axis.dir.join())?.[0] || null;
    markView();
  };
  $('#gizmo').addEventListener('click', (e) => { const el = e.target.closest('[data-axis]'); if (el) go(el); });
  $('#gizmo').addEventListener('keydown', (e) => { const el = e.target.closest('[data-axis]'); if (el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); go(el); } });
}
// ------------------------------------------------------------------ URL state
// ?model=A&b=B&mode=side&env=hangar&cam=tx,ty,tz,dx,dy,dz,size,o&sel=A:name&iso=1&hide=01,04&grid=0
function readUrl() {
  const q = new URLSearchParams(location.search);
  state.A = q.get('model');
  state.B = q.get('b');
  if (MODES[q.get('mode')]) state.mode = q.get('mode');
  if (ENVIRONMENTS[q.get('env')]) state.env = q.get('env');
  for (const [key, name] of [['grid', 'grid'], ['shadows', 'shadows'], ['wire', 'wireframe']]) if (q.has(key)) state[name] = q.get(key) === '1';
  grid.visible = state.grid;
  if (q.get('hide')) state.hiddenGroups = new Set(q.get('hide').split(',').filter((k) => CATEGORIES[k]));
  for (const slot of SLOTS) if (q.get(`hidden${slot}`)) state.hidden[slot] = new Set(q.get(`hidden${slot}`).split('|'));
  if (q.get('sel')) {
    const [slot, ...names] = q.get('sel').split(':');
    if (SLOTS.includes(slot)) state.selection = { slot, names: new Set(names.join(':').split('|').filter(Boolean)) };
  }
  state.isolate = q.get('iso') === '1';
  state.isoGhost = q.get('ghost') === '1';
  if (q.has('fade')) state.fade = THREE.MathUtils.clamp(Number(q.get('fade')) || 0, 0, 1);
  if (q.has('tint')) state.tint = q.get('tint') !== '0';
  if (q.has('split')) state.split = THREE.MathUtils.clamp(Number(q.get('split')) || 0.5, 0.02, 0.98);
  const cam = (q.get('cam') || '').split(',');
  if (cam.length === 8 && cam.slice(0, 7).every((v) => Number.isFinite(Number(v)))) {
    const n = cam.slice(0, 7).map(Number);
    rig.setProjection(cam[7] === 'o' ? 'orthographic' : 'perspective');
    pendingCamera = { target: new THREE.Vector3(n[0], n[1], n[2]), dir: new THREE.Vector3(n[3], n[4], n[5]).normalize(), size: n[6] };
    rig.viewName = null;
  }
}

let urlTimer;
function saveUrlSoon() { clearTimeout(urlTimer); urlTimer = setTimeout(saveUrl, 350); }
function saveUrl() {
  if (!catalog || !rig.hasPose) return;
  const q = new URLSearchParams();
  q.set('model', state.A);
  if (state.mode !== 'single') { q.set('mode', state.mode); if (state.B) q.set('b', state.B); }
  if (state.env !== 'studio') q.set('env', state.env);
  if (!state.grid) q.set('grid', '0');
  if (!state.shadows) q.set('shadows', '0');
  if (state.wireframe) q.set('wire', '1');
  if (state.hiddenGroups.size) q.set('hide', [...state.hiddenGroups].sort().join(','));
  for (const slot of SLOTS) if (state.hidden[slot].size) q.set(`hidden${slot}`, [...state.hidden[slot]].join('|'));
  if (state.selection.names.size) q.set('sel', `${state.selection.slot}:${[...state.selection.names].join('|')}`);
  if (state.isolate) q.set('iso', '1');
  if (state.isoGhost) q.set('ghost', '1');
  if (state.mode === 'overlay') { q.set('fade', state.fade.toFixed(2)); if (!state.tint) q.set('tint', '0'); }
  if (state.mode === 'swipe') q.set('split', state.split.toFixed(3));
  const p = rig.pose();
  const r = (v, d = 3) => Number(v.toFixed(d));
  q.set('cam', [...p.target.toArray().map((v) => r(v)), ...p.dir.toArray().map((v) => r(v, 4)), r(p.size), rig.projection === 'orthographic' ? 'o' : 'p'].join(','));
  history.replaceState(null, '', `${location.pathname}?${q.toString().replace(/%2C/g, ',').replace(/%3A/g, ':').replace(/%7C/g, '|')}`);
}

// ------------------------------------------------------------------ boot
buildChrome();
wireGizmo();
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
} catch {
  fail('3D viewing is unavailable', 'Enable WebGL in your browser, then reload this page.');
}
if (renderer) start();

