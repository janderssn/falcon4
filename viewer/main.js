import './style.css';
import * as THREE from 'three';
import { CATEGORIES, loadCatalog, loadModel, trimCache, boundsOf } from './lib/catalog.js';
import { CameraRig } from './lib/camera.js';
import { Meadow } from './lib/meadow.js';

const $ = (s, root = document) => root.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const params = new URLSearchParams(location.search);
const THUMB = params.get('thumb');                   // set by tools/thumbs.mjs to render the thumbnails
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const small = matchMedia('(max-width: 760px)').matches;

// ------------------------------------------------------------------ what there is to learn
// The main parts, found by name in either build. `at` says where the name sits on the part.
const CONCEPTS = [
  { id: 'nose', name: 'Nose', sub: 'Where the keel and leading edges meet', at: { dir: [0, 0, 1], f: 1 }, re: /^(Removable nose cone|Nosecone)$/,
    text: 'The nose plates bolt the keel and both leading edges together. The nose cone covers them and smooths the airflow.' },
  { id: 'keel', name: 'Keel', sub: 'Backbone of the glider', at: { dir: [0, 0, 1], f: 0.02 }, re: /^(Keel 42mm.*|Keel)$/,
    text: 'The centre tube from the nose to the tail. The kingpost, the control frame and the hang loop are all fixed to it.' },
  { id: 'kingpost', name: 'Kingpost', sub: 'Mast for the top wires', at: { dir: [0, 1, 0], f: 1 }, re: /^(Streamlined kingpost|Kingpost)$/,
    text: 'The short mast above the keel. The top wires run from its tip to the nose, the tail and the crossbar ends, and hold the wing up on the ground.' },
  { id: 'le', name: 'Leading edge', sub: 'Front tube of each wing', at: { dir: [1, 0, -0.6], f: 0.6 }, re: /^(L leading edge front 50mm|LE front L)$/,
    text: 'The two tubes that form the front of the wing. The sail is pulled over them and fixed at the nose and the tips.' },
  { id: 'crossbar', name: 'Crossbar', sub: 'Holds the wings apart', at: { dir: [1, 0, 0], f: 0.8 }, re: /^(L crossbar 52mm|Crossbar L)$/,
    text: 'Two tubes joined at the keel that push the leading edges apart and keep the sail tight.' },
  { id: 'upright', name: 'Control frame', sub: 'The A-frame you hold', at: { dir: [0, 1, 0], f: 0.55 }, re: /^(L control frame upright|Downtube L)$/,
    text: 'The triangle under the wing. In flight the pilot hangs from the keel and steers by shifting weight against it.' },
  { id: 'basebar', name: 'Basebar', sub: 'Push out to slow down', at: { dir: [1, 0, 0], f: 0.5 }, re: /^(Control frame base tube|Basetube \(speedbar\))$/,
    text: 'The bottom bar of the control frame, where the pilot holds on. Pushing it out raises the nose and slows down; pulling in speeds up.' },
  { id: 'batten', name: 'Batten', sub: 'Gives the sail its shape', at: { dir: [0, 0, 1], f: 0.1 }, re: /^(L cambered batten 4|Batten L 4)$/,
    text: 'Curved ribs that slide into pockets in the sail. Their shape gives the wing its airfoil.' },
  { id: 'sail', name: 'Sail', sub: 'The wing surface', at: 'sail', re: /^(L sail panel 3|Sail top surface)$/,
    text: 'Dacron cloth stretched over the frame. The battens and the frame give it the shape that makes lift.' },
];
const GROUP_TEXT = {
  '01': 'Part of the sail: the cloth and what is sewn to it.',
  '02': 'Part of the main frame: the aluminium tubes that carry the loads.',
  '03': 'Part of the battens, the ribs that shape the sail, and the washout tubes that keep the tips twisted.',
  '04': 'A lower wire. The lower wires carry the flight loads from the control frame to the wing.',
  '05': 'An upper wire or bridle. They hold the wing up on the ground and keep the sail shape in flight.',
  '06': 'Hardware: a bolt, nut, fitting or bracket that joins the parts.',
  '07': 'Webbing: the strap the pilot hangs from, and its backup.',
};

// Views along the bottom. Close-ups find their spot on the glider from its parts.
const PLACES = [
  { id: 'overview', name: 'Overview', dir: [0.35, 0.48, 1], layer: 'glider' },
  { id: 'front', name: 'Front', dir: [0, 0, 1], ortho: true },
  { id: 'side', name: 'Side', dir: [1, 0, 0], ortho: true },
  { id: 'top', name: 'From above', dir: [0, 1, -1e-4], ortho: true },
  { id: 'nose', name: 'Nose', concept: 'nose', dir: [0.62, 0.42, 0.68], size: 0.85, layer: 'airframe' },
  { id: 'junction', name: 'Crossbar joint', concept: 'crossbar', end: true, dir: [0.4, 0.55, 0.75], size: 1.0, layer: 'airframe' },
  { id: 'kingpost', name: 'Kingpost', concept: 'kingpost', dir: [0.55, 0.2, 0.8], size: 0.9, layer: 'glider' },
  { id: 'controlbar', name: 'Control bar', concept: 'basebar', end: true, dir: [0.75, 0.35, 0.6], size: 0.9, layer: 'glider' },
];
// Layer presets in the tile at the bottom left: which part groups are shown.
const LAYERS = [
  { id: 'glider', name: 'Whole glider', groups: ['01', '02', '03', '04', '05', '06', '07'] },
  { id: 'airframe', name: 'Without sail', groups: ['02', '03', '04', '05', '06', '07'] },
  { id: 'frame', name: 'Frame', groups: ['02', '06'] },
  { id: 'rigging', name: 'Frame + wires', groups: ['02', '04', '05', '06'] },
  { id: 'sail', name: 'Sail + battens', groups: ['01', '03'] },
];

// ------------------------------------------------------------------ state
const state = {
  model: params.get('model'), groups: new Set(LAYERS[0].groups), sel: params.get('sel'), alone: false,
  hours: Number(params.get('t')) || 9.5, wind: 1, labels: true, idle: !THUMB, shadows: true, wire: false,
  place: params.get('view') || 'overview', tour: false,
};
let catalog, record, renderer, rig, meadow;
const scene = new THREE.Scene();
const canvas = $('#scene');


async function boot() {
  renderer.setPixelRatio(Math.min(devicePixelRatio, THUMB ? 2 : 1.6));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  rig = new CameraRig(canvas);
  rig.controls.maxDistance = 70;
  rig.controls.autoRotateSpeed = 0.35;
  rig.controls.addEventListener('start', () => { userActive(); state.place = null; markPlaces(); });
  rig.addEventListener('change', saveUrlSoon);
  loaderText('Falcon 4', 'Growing the meadow…', 0.05);
  await frame();
  meadow = new Meadow(renderer, scene, { grass: Number(params.get('grass')) || (small ? 70000 : 170000) });
  meadow.setTime(state.hours);
  wireUi();
  resize();
  addEventListener('resize', resize);
  try { catalog = await loadCatalog(); }
  catch (e) { loaderText('The model list didn’t load', e.message, 0, true); return; }
  const ids = catalog.models.map((m) => m.id);
  if (!ids.includes(state.model)) state.model = ids.includes('opus') ? 'opus' : ids[0];
  buildChrome();
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

// ------------------------------------------------------------------ models
async function setModel(id, first = false) {
  const source = catalog.sources.get(id);
  state.model = id;
  if (!first) toast(`Loading the ${source.label} build…`);
  let rec;
  try {
    rec = await loadModel(source, (f, loaded) => {
      const pct = f == null ? null : Math.round(f * 100);
      const text = pct == null ? `${(loaded / 1048576).toFixed(1)} MB` : pct >= 100 ? 'Putting it together…' : `Loading the ${source.label} build · ${(loaded / 1048576).toFixed(1)} MB`;
      if (first) loaderText('Falcon 4', text, 0.1 + 0.85 * (f || 0));
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
  scene.add(record.root);
  anchors.clear();
  const center = record.box.getCenter(new THREE.Vector3());
  meadow.place(record.box.min.y, new THREE.Vector3(center.x, record.box.min.y, center.z));
  if (state.sel && !record.parts.has(state.sel)) state.sel = null;
  applyWire();
  restyle();
  syncChrome();
  buildLabels();
  if (first) {
    const cam = readCamera();
    if (cam) { rig.setProjection(cam.projection); rig.animateTo(cam.pose, false); state.place = null; }
    else goTo(state.place || 'overview', false);
    if (state.sel) renderCard();
    $('#loader').classList.add('done');
    if (THUMB) runThumb();
  } else toast(`${source.title} · ${record.parts.size} parts`);
  trimCache([id]);
  saveUrlSoon();
}

// ------------------------------------------------------------------ geometry helpers
const anchors = new Map();
function conceptPart(c) {
  for (const p of record.parts.values()) if (c.re.test(p.name)) return p;
  return null;
}
/** The point of a part farthest along a direction. */
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
/** Where a concept's name sits (or a close-up looks), cached per model. */
function anchorOf(c, end = false) {
  const key = c.id + (end ? ':end' : '');
  if (anchors.has(key)) return anchors.get(key);
  const part = conceptPart(c);
  let p = null;
  if (part) {
    const box = boundsOf(part.meshes);
    if (end) p = extreme(part, new THREE.Vector3(1, 0, 0));
    else if (c.at === 'sail') {
      // On the right wing, away from the names on the left-wing tubes: the upper
      // sail vertex nearest a point over the middle of that wing.
      const want = new THREE.Vector2(-3.4, box.getCenter(new THREE.Vector3()).z + 0.2), v = new THREE.Vector3();
      let best = Infinity;
      for (const m of part.meshes) {
        const pos = m.geometry.attributes.position;
        for (let i = 0; i < pos.count; i += 2) {
          v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
          const d = Math.hypot(v.x - want.x, v.z - want.y) - v.y * 0.05;
          if (d < best) { best = d; p = v.clone(); }
        }
      }
    } else {
      const d = new THREE.Vector3(...c.at.dir).normalize();
      p = extreme(part, d.clone().negate()).lerp(extreme(part, d), c.at.f);
    }
  }
  anchors.set(key, p);
  return p;
}

// ------------------------------------------------------------------ appearance
function restyle() {
  if (!record) return;
  for (const mesh of record.meshes) {
    const part = mesh.userData.part, M = mesh.userData.materials;
    const shown = state.groups.has(part.group);
    const selected = part.name === state.sel;
    let mat = selected ? M.selected : M.base;
    let visible = shown;
    if (state.alone && state.sel) {
      if (selected) visible = true;                 // shown even if its group is turned off
      else {                                        // everything else stays as a faint outline for context
        mat = M.ghost; M.ghost.opacity = 0.1; M.ghost.transparent = true; M.ghost.depthWrite = false;
        if (M.ghost.emissive) M.ghost.emissive.set(0x000000);
      }
    }
    mesh.material = mat;
    mesh.visible = visible;
  }
}
function applyWire() {
  if (!record) return;
  for (const mesh of record.meshes) for (const m of Object.values(mesh.userData.materials)) m.wireframe = state.wire;
}

function setGroups(groups) {
  state.groups = new Set(groups);
  restyle();
  syncChrome();
  saveUrlSoon();
}

// ------------------------------------------------------------------ camera
function goTo(id, animate = !reduced) {
  const place = PLACES.find((p) => p.id === id);
  if (!place || !record) return;
  stopTour();
  if (place.layer) setGroups(LAYERS.find((l) => l.id === place.layer).groups);
  rig.setProjection(place.ortho ? 'orthographic' : 'perspective');
  let pose;
  if (place.concept) {
    const c = CONCEPTS.find((x) => x.id === place.concept);
    const target = anchorOf(c, place.end) || record.box.getCenter(new THREE.Vector3());
    pose = { target: target.clone(), dir: new THREE.Vector3(...place.dir).normalize(), size: place.size };
  } else if (place.under) {
    const c = record.box.getCenter(new THREE.Vector3());
    pose = { target: new THREE.Vector3(c.x, record.box.min.y + 1.55, c.z), dir: new THREE.Vector3(-0.55, -0.1, 0.83).normalize(), size: 4.2 };
  } else {
    pose = rig.frame(record.box, place.dir, place.ortho ? 1.08 : 1.02);
  }
  rig.animateTo(pose, animate);
  state.place = id;
  markPlaces();
  saveUrlSoon();
}

function zoom(f) {
  const p = rig.pose();
  p.size *= f;
  rig.animateTo(p, !reduced);
  userActive();
}

function toggle2d() {
  rig.setProjection(rig.projection === 'orthographic' ? 'perspective' : 'orthographic');
  syncChrome();
  userActive();
}

function focusPart(name) {
  const part = record.parts.get(name);
  if (!part) return;
  stopTour();
  if (!state.groups.has(part.group)) setGroups([...state.groups, part.group]);
  const box = boundsOf(part.meshes);
  const pose = rig.frame(box, undefined, 1.8);
  pose.size = Math.max(pose.size, 0.35);
  rig.animateTo(pose, !reduced);
  state.place = null;
  markPlaces();
}

// Slow turn: a fly-around on request, or on its own after a while without input.
let lastInput = performance.now();
function userActive() { lastInput = performance.now(); if (!state.tour) rig.controls.autoRotate = false; }
function startTour() { state.tour = true; rig.setProjection('perspective'); rig.controls.autoRotate = true; rig.controls.autoRotateSpeed = 1.6; syncChrome(); }
function stopTour() { state.tour = false; rig.controls.autoRotate = false; rig.controls.autoRotateSpeed = 0.35; syncChrome(); }

// ------------------------------------------------------------------ render loop
let last = performance.now();
const clock0 = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  if (document.hidden) return;
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  if (state.idle && !state.tour && !rig.transition && now - lastInput > 25000 && rig.projection === 'perspective') rig.controls.autoRotate = true;
  rig.update(now, dt);
  meadow.update(rig.camera, (now - clock0) / 1000);
  renderer.render(scene, rig.camera);
  updateLabels();
  updateHudGeometry();
}

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  rig.setAspect(w / h);
}

// ------------------------------------------------------------------ picking
const raycaster = new THREE.Raycaster();
function pick(e) {
  const r = canvas.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), rig.camera);
  const meshes = record.meshes.filter((m) => m.visible && !(m.material.transparent && m.material.opacity < 0.3));
  return raycaster.intersectObjects(meshes, false)[0]?.object.userData.part || null;
}

function select(name, { focus = false } = {}) {
  state.sel = name;
  if (!name) state.alone = false;
  restyle();
  renderCard();
  if (focus && name) focusPart(name);
  saveUrlSoon();
}

// ------------------------------------------------------------------ part card
function renderCard() {
  const card = $('#card');
  const part = state.sel && record?.parts.get(state.sel);
  document.body.classList.toggle('carded', Boolean(part));
  if (!part) { card.hidden = true; return; }
  const concept = CONCEPTS.find((c) => c.re.test(part.name));
  const info = part.info;
  const lead = concept ? concept.text : GROUP_TEXT[part.group];
  const desc = info.description && info.description !== lead ? info.description : '';
  card.hidden = false;
  card.innerHTML = `
    <header><h2>${esc(concept ? concept.name : part.name)}</h2>
      <button type="button" class="close" data-act="close" aria-label="Close (Esc)" title="Close (Esc)"><svg viewBox="0 0 24 24" class="ic"><path d="M6 6l12 12M18 6L6 18"/></svg></button></header>
    <p class="meta">${concept ? `${esc(part.name)} · ` : ''}${esc(CATEGORIES[part.group])}${info.part_no ? ` · <span class="pn" title="Wills Wing part number">${esc(info.part_no)}</span>` : ''}</p>
    <p class="lead">${esc(lead)}</p>
    ${desc ? `<p class="desc">${esc(desc)}</p>` : ''}
    ${info.note ? `<p class="desc">${esc(info.note)}</p>` : ''}
    ${info.source ? `<p class="src">Source: ${esc(info.source)}</p>` : ''}
    <div class="actions">
      <button type="button" class="pill" data-act="focus"><svg viewBox="0 0 24 24" class="ic"><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/></svg>Go to it</button>
      <button type="button" class="pill ${state.alone ? 'on' : ''}" data-act="alone" aria-pressed="${state.alone}"><svg viewBox="0 0 24 24" class="ic"><rect x="8" y="8" width="8" height="8" rx="1"/><path d="M3 7V3h4M17 3h4v4M21 17v4h-4M7 21H3v-4"/></svg>Show alone</button>
    </div>`;
}

// ------------------------------------------------------------------ names on the glider
const labelEls = new Map();
function buildLabels() {
  const host = $('#labels');
  host.innerHTML = '';
  labelEls.clear();
  for (const c of CONCEPTS) {
    if (!conceptPart(c)) continue;
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'label concept';
    el.innerHTML = `<b>${esc(c.name)}</b>`;
    el.title = c.sub;
    el.tabIndex = -1;
    el.onclick = () => select(conceptPart(c).name, { focus: false });
    host.append(el);
    labelEls.set(c.id, el);
  }
  const sel = document.createElement('div');
  sel.className = 'label selected';
  host.append(sel);
  labelEls.set('__sel', sel);
}
const tmp = new THREE.Vector3();
function project(p) {
  tmp.copy(p).project(rig.camera);
  return { x: (tmp.x + 1) / 2 * innerWidth, y: (1 - tmp.y) / 2 * innerHeight, ok: tmp.z < 1 && tmp.z > -1 && Math.abs(tmp.x) < 1.1 && Math.abs(tmp.y) < 1.1 };
}
function updateLabels() {
  if (!record) return;
  const selPart = state.sel && record.parts.get(state.sel);
  const selConcept = selPart && CONCEPTS.find((c) => c.re.test(selPart.name));
  // Nearest names first; a name that would overlap one already placed is left out.
  const placed = [];
  const items = CONCEPTS.map((c) => ({ c, el: labelEls.get(c.id), p: labelEls.get(c.id) && anchorOf(c) }))
    .filter((x) => x.el && x.p)
    .map((x) => ({ ...x, d: x.p.distanceTo(rig.camera.position) }))
    .sort((a, b) => a.d - b.d);
  for (const { c, el, p } of items) {
    const part = conceptPart(c);
    const shown = state.labels && part.meshes.some((m) => m.visible && !(m.material.transparent && m.material.opacity < 0.3)) && selConcept !== c;
    const s = shown && project(p);
    let ok = s && s.ok;
    if (ok) {
      const w = c.name.length * 8 + 12, r = { x0: s.x - w / 2, x1: s.x + w / 2, y0: s.y - 44, y1: s.y };
      if (placed.some((q) => r.x0 < q.x1 && r.x1 > q.x0 && r.y0 < q.y1 && r.y1 > q.y0)) ok = false;
      else placed.push(r);
    }
    el.style.opacity = ok ? 1 : 0;
    el.style.pointerEvents = ok ? 'auto' : 'none';
    if (s && s.ok) el.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -100%)`;
  }
  const el = labelEls.get('__sel');
  if (selPart) {
    const box = boundsOf(selPart.meshes);
    const c = box.getCenter(new THREE.Vector3());
    const p = selConcept ? anchorOf(selConcept) : c.setY(box.max.y);
    const s = project(p);
    el.innerHTML = `<b>${esc(selConcept ? selConcept.name : selPart.name)}</b>`;
    el.style.opacity = s.ok ? 1 : 0;
    el.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -100%)`;
  } else el.style.opacity = 0;
}

// Compass needle (red end points to the nose) and the scale bar.
function updateHudGeometry() {
  const pose = rig.pose();
  const angle = Math.atan2(pose.dir.x, pose.dir.z);
  $('#needle').style.transform = `rotate(${(-angle * 180) / Math.PI + 180}deg)`;
  const pxPerM = innerHeight / pose.size;
  const steps = [0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10];
  const len = steps.find((s) => s * pxPerM >= 50) || 10;
  $('#scale-bar').style.width = `${Math.round(len * pxPerM)}px`;
  $('#scale-label').textContent = len >= 1 ? `${len} m` : `${Math.round(len * 100)} cm`;
}

// ------------------------------------------------------------------ search
let results = [];
let active = -1;
function search(q) {
  const list = $('#results');
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length || !record) { list.hidden = true; $('#q').setAttribute('aria-expanded', 'false'); return; }
  const scored = [];
  for (const c of CONCEPTS) {
    const part = conceptPart(c);
    if (part && terms.every((t) => c.name.toLowerCase().includes(t))) scored.push({ part, label: c.name, score: 0 });
  }
  for (const part of record.parts.values()) {
    const name = part.name.toLowerCase(), no = (part.info.part_no || '').toLowerCase(), desc = (part.info.description || '').toLowerCase();
    const hit = (t) => (t.length === 1 ? new RegExp(`(^|[^a-z0-9])${t}([^a-z0-9]|$)`).test(name) : name.includes(t) || no.includes(t) || desc.includes(t));
    if (!terms.every(hit)) continue;
    const score = name.startsWith(terms[0]) ? 1 : name.includes(terms.join(' ')) ? 2 : no.includes(terms[0]) ? 2.5 : 3;
    if (!scored.some((s) => s.part === part)) scored.push({ part, label: part.name, score });
  }
  scored.sort((a, b) => a.score - b.score || a.label.localeCompare(b.label, 'en', { numeric: true }));
  results = scored.slice(0, 8);
  active = results.length ? 0 : -1;
  list.innerHTML = results.length
    ? results.map((r, i) => `<li role="option" data-i="${i}" aria-selected="${i === active}"><span>${esc(r.label)}</span>${r.part.info.part_no ? `<small class="pn">${esc(r.part.info.part_no)}</small>` : `<small>${esc(CATEGORIES[r.part.group])}</small>`}</li>`).join('')
    : '<li class="empty">No part by that name. Try “batten”, “nose” or a part number such as 10A.</li>';
  list.hidden = false;
  $('#q').setAttribute('aria-expanded', 'true');
}
function choose(i) {
  const r = results[i];
  if (!r) return;
  $('#results').hidden = true;
  $('#q').value = '';
  $('#q').blur();
  select(r.part.name, { focus: true });
}

// ------------------------------------------------------------------ chrome
const thumb = (name) => `url("./thumbs/${name}.jpg")`;
function tile({ id, name, art, cls = '', key }) {
  return `<button type="button" class="tile ${cls}" data-id="${id}" title="${esc(name)}${key ? ` (${key})` : ''}">${key ? `<kbd>${key}</kbd>` : ''}<span class="art" style="background-image:${art}"></span><span class="cap">${esc(name)}</span></button>`;
}
function buildChrome() {
  $('#places').innerHTML = PLACES.map((p, i) => tile({ id: p.id, name: p.name, art: thumb(`view-${p.id}`), key: String((i + 1) % 10) })).join('');
  $('#layer-fly').innerHTML = LAYERS.map((l) => tile({ id: l.id, name: l.name, art: thumb(`layer-${l.id}`) })).join('');
  $('#model-cards').innerHTML = catalog.models.map((m) => tile({ id: m.id, name: m.label, art: thumb(`model-${m.id}`) })).join('');
  $('#groups').innerHTML = Object.entries(CATEGORIES).map(([k, name]) =>
    `<label class="switch"><input type="checkbox" data-group="${k}"><i></i><span>${name}<span class="count" data-count="${k}"></span></span></label>`).join('');
}
function syncChrome() {
  const layer = LAYERS.find((l) => l.groups.length === state.groups.size && l.groups.every((g) => state.groups.has(g)));
  $('#layer-art').style.backgroundImage = thumb(`layer-${layer ? layer.id : 'glider'}`);
  for (const t of document.querySelectorAll('#layer-fly .tile')) t.classList.toggle('on', layer?.id === t.dataset.id);
  for (const t of document.querySelectorAll('#model-cards .tile')) t.classList.toggle('on', t.dataset.id === state.model);
  for (const i of document.querySelectorAll('#groups input')) i.checked = state.groups.has(i.dataset.group);
  if (record) for (const el of document.querySelectorAll('[data-count]')) el.textContent = record.groups[el.dataset.count] || 0;
  const src = catalog?.sources.get(state.model);
  if (src) {
    $('#subtitle').textContent = `Wills Wing · 170 · ${src.label} build`;
    $('#model-note').textContent = src.description;
    $('#download').href = src.glb;
    $('#download').download = src.download;
    document.title = `Falcon 4 · ${src.title}`;
  }
  $('#btn-2d').classList.toggle('on', rig.projection === 'orthographic');
  $('#btn-2d').textContent = rig.projection === 'orthographic' ? '3D' : '2D';
  $('#btn-tour').classList.toggle('on', state.tour);
  document.body.classList.toggle('nolabels', !state.labels);
  $('#opt-labels').checked = state.labels;
  $('#opt-idle').checked = state.idle;
  $('#opt-shadows').checked = state.shadows;
  $('#opt-wire').checked = state.wire;
  markPlaces();
}
function markPlaces() {
  for (const t of document.querySelectorAll('#places .tile')) t.classList.toggle('on', t.dataset.id === state.place);
}

function setTime(h) {
  state.hours = h;
  meadow.setTime(h);
  const label = `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60) % 60).padStart(2, '0')}`;
  $('#time').value = h; $('#time2').value = h;
  $('#time-label').textContent = label; $('#time2-label').textContent = label;
  saveUrlSoon();
}

function openSettings(open = true) {
  $('#settings').hidden = !open;
  $('#scrim').hidden = !open;
  if (open) $('#btn-close').focus();
}

let toastTimer;
function toast(text, keep = false) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), keep ? 4000 : 2200);
}

function wireUi() {
  setTime(state.hours);
  $('#time').addEventListener('input', (e) => setTime(Number(e.target.value)));
  $('#time2').addEventListener('input', (e) => setTime(Number(e.target.value)));
  $('#wind').addEventListener('input', (e) => { state.wind = Number(e.target.value); meadow.setWind(state.wind); });
  $('#btn-settings').onclick = () => openSettings(true);
  $('#btn-close').onclick = () => openSettings(false);
  $('#scrim').onclick = () => openSettings(false);
  $('#btn-tour').onclick = () => (state.tour ? stopTour() : startTour());
  $('#btn-compass').onclick = () => goTo('overview');
  $('#btn-2d').onclick = toggle2d;
  $('#btn-zin').onclick = () => zoom(0.7);
  $('#btn-zout').onclick = () => zoom(1.4);
  $('#btn-about').onclick = () => openSettings(true);
  $('#btn-showhud').onclick = () => document.body.classList.remove('nohud');
  $('#places').addEventListener('click', (e) => { const t = e.target.closest('.tile'); if (t) goTo(t.dataset.id); });
  $('#layer-btn').onclick = () => {
    const fly = $('#layer-fly');
    fly.hidden = !fly.hidden;
    $('#layer-btn').setAttribute('aria-expanded', String(!fly.hidden));
  };
  $('#layer-fly').addEventListener('click', (e) => {
    const t = e.target.closest('.tile');
    if (!t) return;
    setGroups(LAYERS.find((l) => l.id === t.dataset.id).groups);
    $('#layer-fly').hidden = true;
    $('#layer-btn').setAttribute('aria-expanded', 'false');
  });
  $('#model-cards').addEventListener('click', (e) => { const t = e.target.closest('.tile'); if (t && t.dataset.id !== state.model) setModel(t.dataset.id); });
  $('#groups').addEventListener('change', (e) => {
    const g = e.target.dataset.group;
    const next = new Set(state.groups);
    if (e.target.checked) next.add(g); else next.delete(g);
    setGroups([...next]);
  });
  for (const [id, key] of [['opt-labels', 'labels'], ['opt-idle', 'idle'], ['opt-shadows', 'shadows'], ['opt-wire', 'wire']]) {
    $(`#${id}`).addEventListener('change', (e) => {
      state[key] = e.target.checked;
      if (key === 'shadows') meadow.setShadows(state.shadows);
      if (key === 'wire') applyWire();
      if (key === 'idle' && !state.idle && !state.tour) rig.controls.autoRotate = false;
      syncChrome();
    });
  }
  // Search.
  const q = $('#q');
  q.addEventListener('input', () => search(q.value));
  q.addEventListener('focus', () => q.value && search(q.value));
  q.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = Math.max(0, Math.min(results.length - 1, active + (e.key === 'ArrowDown' ? 1 : -1)));
      for (const li of document.querySelectorAll('#results li')) li.setAttribute('aria-selected', String(Number(li.dataset.i) === active));
    } else if (e.key === 'Enter') { e.preventDefault(); choose(active); }
    else if (e.key === 'Escape') { q.value = ''; $('#results').hidden = true; q.blur(); }
  });
  $('#results').addEventListener('mousedown', (e) => { const li = e.target.closest('li[data-i]'); if (li) { e.preventDefault(); choose(Number(li.dataset.i)); } });
  q.addEventListener('blur', () => setTimeout(() => { $('#results').hidden = true; }, 120));
  // Card.
  $('#card').addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') select(null);
    if (act === 'focus') focusPart(state.sel);
    if (act === 'alone') { state.alone = !state.alone; restyle(); renderCard(); if (state.alone) focusPart(state.sel); }
  });
  // Scene.
  let down = null;
  canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; userActive(); $('#layer-fly').hidden = true; });
  canvas.addEventListener('pointerup', (e) => {
    if (!down || e.button !== 0 || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
    const part = pick(e);
    if (part) select(part.name);
    else if (state.sel && !state.alone) select(null);
  });
  canvas.addEventListener('dblclick', (e) => { const part = pick(e); if (part) select(part.name, { focus: true }); });
  canvas.addEventListener('wheel', userActive, { passive: true });
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    $('#loader').classList.remove('done');
    loaderText('The graphics stopped', 'Reload the page to bring the glider back.', 0, true);
    $('#ld-retry').onclick = () => location.reload();
  });
  document.addEventListener('keydown', onKey);
}

function onKey(e) {
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && e.target.type !== 'checkbox' && e.target.type !== 'range') return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key;
  userActive();
  if (k === 'Escape') {
    if (!$('#settings').hidden) openSettings(false);
    else if (!$('#layer-fly').hidden) $('#layer-fly').hidden = true;
    else if (state.sel) select(null);
    else document.body.classList.remove('nohud');
    return;
  }
  const n = '1234567890'.indexOf(k);
  if (n >= 0 && PLACES[n]) goTo(PLACES[n].id);
  else if (k === '/') { e.preventDefault(); $('#q').focus(); }
  else if (k === 't' || k === 'T') toggle2d();
  else if (k === 'n' || k === 'N') goTo('overview');
  else if (k === '+' || k === '=') zoom(0.7);
  else if (k === '-' || k === '_') zoom(1.4);
  else if (k === 'f' || k === 'F') (state.tour ? stopTour() : startTour());
  else if (k === 'l' || k === 'L') { state.labels = !state.labels; syncChrome(); }
  else if (k === 'h' || k === 'H') document.body.classList.toggle('nohud');
  else if (k === ',') openSettings($('#settings').hidden);
  else return;
  e.preventDefault();
}

// ------------------------------------------------------------------ address bar
// ?model=opus&view=nose&t=9.5&sel=Kingpost&hide=01&cam=tx,ty,tz,dx,dy,dz,size,p
function readCamera() {
  const c = (params.get('cam') || '').split(',');
  if (c.length !== 8 || !c.slice(0, 7).every((v) => Number.isFinite(Number(v)))) {
    if (params.get('hide')) state.groups = new Set(LAYERS[0].groups.filter((g) => !params.get('hide').split(',').includes(g)));
    return null;
  }
  if (params.get('hide')) state.groups = new Set(LAYERS[0].groups.filter((g) => !params.get('hide').split(',').includes(g)));
  restyle();
  const n = c.slice(0, 7).map(Number);
  return { projection: c[7] === 'o' ? 'orthographic' : 'perspective', pose: { target: new THREE.Vector3(n[0], n[1], n[2]), dir: new THREE.Vector3(n[3], n[4], n[5]).normalize(), size: n[6] } };
}
let urlTimer;
function saveUrlSoon() { clearTimeout(urlTimer); urlTimer = setTimeout(saveUrl, 400); }
function saveUrl() {
  if (!record || THUMB) return;
  const q = new URLSearchParams();
  q.set('model', state.model);
  if (state.place) q.set('view', state.place);
  if (Math.abs(state.hours - 9.5) > 0.01) q.set('t', state.hours.toFixed(2));
  if (state.sel) q.set('sel', state.sel);
  const hidden = LAYERS[0].groups.filter((g) => !state.groups.has(g));
  if (hidden.length) q.set('hide', hidden.join(','));
  if (!state.place) {
    const p = rig.pose(), r = (v, d = 3) => Number(v.toFixed(d));
    q.set('cam', [...p.target.toArray().map((v) => r(v)), ...p.dir.toArray().map((v) => r(v, 4)), r(p.size), rig.projection === 'orthographic' ? 'o' : 'p'].join(','));
  }
  history.replaceState(null, '', `${location.pathname}?${q.toString().replace(/%2C/g, ',')}`);
}

// ------------------------------------------------------------------ thumbnails (tools/thumbs.mjs)
async function runThumb() {
  document.body.classList.add('nohud');
  state.labels = false;
  syncChrome();
  const [kind, id] = THUMB.split(':');
  if (kind === 'view') goTo(id, false);
  if (kind === 'layer') { goTo('overview', false); setGroups(LAYERS.find((l) => l.id === id).groups); rig.animateTo(rig.frame(record.box, [0.5, 0.75, 1], 0.95), false); }
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
