import './style.css';
import * as THREE from 'three';
import { CATEGORIES, loadCatalog, loadModel, trimCache, boundsOf } from './lib/catalog.js';
import { CameraRig } from './lib/camera.js';
import { Scenes, SCENES, BACKDROPS, LIGHT_SHADE, setLightShade } from './lib/scenes.js';
import { Outline } from './lib/outline.js';
import { Rope, RoutedRope } from './lib/rope.js';
import { FALCON_FABRICS, CALIBRATED, ORDER, isUpgrade } from './lib/fabrics.js';
import { openOrder } from './lib/order.js';
import { clothUniforms, setCloth, toCloth, patchCloth, filmAlpha, frost, clothKind } from './lib/cloth.js';
import { FilmBlur } from './lib/frost.js';

const $ = (s, root = document) => root.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const params = new URLSearchParams(location.search);
const THUMB = params.get('thumb');                   // set by tools/thumbs.mjs to render the thumbnails
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const small = matchMedia('(max-width: 760px)').matches;   // at load: sets the start state and the grass density

// ------------------------------------------------------------------ what can be tweaked
// Sail and frame zones. The sail panels follow the Wills Wing Falcon colour picker:
// P1 leading edge, P2, P3, P4 trailing edge on top, P5 undersurface (Opus uses the
// same panel names; Astra's panels 1-4 match P1-P4 and it has no P5). A part belongs
// to the first zone whose part-name pattern matches it, otherwise to the zone of its
// material. Rows only show for a build that has parts in them.
const ZONES = {
  pockets: { name: 'Batten pockets', parts: /^(Batten pocket [LR] [2-6]|[LR] batten [2-6] fabric pocket)$/ },
  p4: { name: 'P4 · Trailing edge', panel: 'P4', parts: /^(Trailing edge hem|[LR] sail panel 4)$/, mats: ['Sail P4 TE panel (white)'] },
  p3: { name: 'P3 · Middle', panel: 'P3', parts: /^[LR] sail panel 3$/, mats: ['Sail P3 (white)', 'Sail P5 tip piece (white)', 'Keel pocket front (white)', 'Keel pocket rear (white)', 'Batten pocket cloth (white)', 'Off-white Dacron'] },
  p1: { name: 'P1 · Leading edge', panel: 'P1', mats: ['Royal blue Dacron', 'Sail P1 LE panel (blue)', 'Sail P1 under the LE (blue)', 'Nosecone (blue)'] },
  p2: { name: 'P2 · Forward', panel: 'P2', mats: ['Signal red Dacron', 'Red inner cloth - underside only', 'Sail P2 (white)'] },
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
// The fabric's colour in the chosen colour profile (settings): the Wills Wing picker's, or calibrated.
const hexOf = ([id, , hex]) => (state.profile === 'calibrated' && CALIBRATED[id]) || hex;
// Baked colours of the textured opus sail panels (linear RGB), from falcon4-opus f4/sailmat.py.
const BAKED = { white: [0.93, 0.93, 0.9], blue: [0.02, 0.1, 0.62], red: [0.78, 0.05, 0.03] };

// Names and notes for the main parts, for the part card.
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
// Batten parts that tie into the sail: the strings at the batten ends hide with the sail
// or the battens, and the grommets they run through are sewn into the sail.
const SAIL_EYELET = /^Batten string grommet |^[LR] batten \d+ leech eyelet /;
const BATTEN_TIE = /^Batten string (?!grommet)|^[LR] batten \d+ (double purchase|knotted pull loop|pull-loop knot)$/;
/** How a part shows: 'eyelet' and 'tie' as above, 'batten' for the rest of the battens, or null. */
function battenRole(part) {
  if (part.group !== '03' || /washout/i.test(part.name)) return null;
  if (SAIL_EYELET.test(part.name)) return 'eyelet';
  if (BATTEN_TIE.test(part.name)) return 'tie';
  return 'batten';
}
const GROUP_TEXT = {
  '01': 'Part of the sail.', '02': 'Part of the main frame.', '03': 'Part of the battens and washout.', '04': 'A lower wire: carries the flight loads.',
  '05': 'An upper wire or bridle: holds the wing up on the ground.', '06': 'Hardware that joins the parts.', '07': 'Webbing: the hang loop and its backup.',
};

// ------------------------------------------------------------------ state
// What a visitor sees first, unless the link says otherwise. The address keeps only
// what differs from this; "built" in it means the colour as built.
const DEFAULTS = THUMB ? { colours: {}, seeThrough: 0, pose: 'bar', cam: null } : {
  colours: { p1: 'magenta-3958', p2: 'magenta-3958', p3: 'medium-blue-7314', p4: 'medium-blue-7314', p5: 'magenta-3958', pockets: 'magenta-3958', frame: 'graphite' },
  seeThrough: 0,
  pose: 'tail',
  cam: '-1.181,0.903,-2.922,-0.3601,0.1682,0.9176,3.593,p',
};
const pick = (key, list) => {
  const v = params.get(key);
  if (v === 'built') return null;
  if (list.some((x) => x[0] === v)) return v;
  return DEFAULTS.colours[key] ?? null;
};
const state = {
  model: params.get('model'),
  scene: SCENES[params.get('scene')] ? params.get('scene') : 'studio',
  colours: Object.fromEntries(Object.keys(ZONES).map((z) => [z, pick(z, fabricsFor(z))])),
  seeThrough: params.has('xray') ? Math.min(1, Math.max(0, Number(params.get('xray')) || 0)) : DEFAULTS.seeThrough,
  wires: params.get('wires') !== '0',
  battens: params.get('battens') !== '0',
  pose: ['bar', 'nose', 'tail'].includes(params.get('pose')) ? params.get('pose') : DEFAULTS.pose,
  vg: params.has('vg') ? Math.min(1, Math.max(0, Number(params.get('vg')) || 0)) : 1,   // VG: 0 loose, 1 tight (as modelled)
  compare: params.get('compare') === '1',
  split: Math.min(0.95, Math.max(0.05, Number(params.get('split')) || 0.5)),
  selSide: 'A',
  names: params.get('names') === '1',
  hours: Number(params.get('t')) || 9.5,
  profile: params.get('colors') === 'cal' ? 'calibrated' : 'default',   // settings: colour profile
  backdrop: BACKDROPS[params.get('bg')] ? params.get('bg') : 'dark',   // settings: studio background
  shadows: params.get('shadows') !== '0',          // settings: shadows
  spot: params.get('spot') !== '0',                // settings: soft spotlight in the studio
  frost: params.has('frost') ? params.get('frost') === '1' : !small,   // settings: laminates blur what is behind them
  wind: 1, sel: null, tour: false,
  grid: params.get('grid') === '1',                // settings: floor grid in the studio, the same for every background
  // settings, experimental: the Light background's shade, and an outline round the glider
  shade: /^[0-9a-f]{6}$/i.test(params.get('shade') || '') ? `#${params.get('shade').toLowerCase()}` : LIGHT_SHADE,
  outline: params.get('ol') === '1',
  outlineW: Math.min(8, Math.max(0.5, Number(params.get('olw')) || 2)),
  outlineC: /^[0-9a-f]{6}$/i.test(params.get('olc') || '') ? `#${params.get('olc').toLowerCase()}` : '#000000',
  outlineWires: params.get('olwires') === '1',
  outlineInner: params.get('olin') !== '0',
  outlineSens: params.has('olsens') ? Math.min(1, Math.max(0, Number(params.get('olsens')) || 0)) : 0.5,
  panel: null,                                     // the open side panel: 'custom', 'settings' or none
};
let catalog, record, renderer, rig, scenes;
let frostActive = false;                            // film blur in use this frame (see renderFrost)
let other = null;                                   // the second build, shown right of the divider when comparing
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
  scenes.setShadows(state.shadows);
  scenes.setGrid(state.grid);
  scenes.setSpot(state.spot);
  setLightShade(state.shade);
  scenes.setBackdrop(state.backdrop);
  wireUi();
  resize();
  addEventListener('resize', resize);
  addEventListener('resize', placeBars);
  // A bar that appears (the chip, the plan-view bar) or changes width is placed again.
  const ro = new ResizeObserver(() => placeBars());
  for (const sel of ['#posebar', '#chip', '#viewbar']) if ($(sel)) ro.observe($(sel));
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
      if (first) loaderText(source.glider, pct != null && pct >= 100 ? 'Putting it together…' : `Loading the ${source.label} build · ${((loaded || 0) / 1048576).toFixed(1)} MB`, 0.1 + 0.85 * (f || 0));
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
  if (other) { other.root.removeFromParent(); other = null; }   // the other build changes too
  record = rec;
  prepareTints(record);
  scene.add(record.root);
  applyPose();
  const center = record.box.getCenter(new THREE.Vector3());
  scenes.place(record.ground, new THREE.Vector3(center.x, record.ground, center.z));
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
    lastInput = performance.now();            // the slow idle turn counts from when the glider appears
    if (THUMB) runThumb();
  } else toast(`${source.title} · ${source.description}`);
  if (state.compare) setCompare(true); else syncCompare();
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
  for (const zone of Object.keys(ZONES)) rec.tints[zone] = { uTint: { value: new THREE.Color() }, uTintOn: { value: 0 }, meshes: [], cloth: clothUniforms(), plain: clothUniforms(), fabric: undefined };
  for (const mesh of rec.meshes) {
    const name = mesh.userData.materials.base.name;
    const zone = zoneOf(mesh);
    if (!zone) continue;
    const t = rec.tints[zone];
    t.meshes.push(mesh);
    // Sail cloth becomes a physical material whose look follows the cloth type (lib/cloth.js).
    const cloth = SAIL_ZONES.includes(zone);
    if (cloth) {
      const M = mesh.userData.materials;
      for (const key of Object.keys(M)) { const old = M[key]; M[key] = toCloth(old, mesh); old.dispose(); }
      mesh.material = M.base;
      mesh.receiveShadow = true;   // frame and batten shadows on the cloth (and through it, backlit)
    }
    for (const [key, m] of Object.entries(mesh.userData.materials)) {
      m.userData.original = m.color.clone();
      m.userData.originalRough = m.roughness;
      if (!m.map && !cloth) continue;
      const baked = /\(blue\)/.test(name) ? BAKED.blue : /\(colour\)/.test(name) ? BAKED.red : BAKED.white;
      const tinted = Boolean(m.map);
      m.onBeforeCompile = (s) => {
        // Only the sail panels take the panel's cloth; pockets coloured with it stay woven.
        const panel = /^Sail P/.test(name);
        if (cloth) patchCloth(s, panel ? t.cloth : t.plain, m, panel && key !== 'ghost');
        if (!tinted) return;
        s.uniforms.uTint = t.uTint; s.uniforms.uTintOn = t.uTintOn; s.uniforms.uBaked = { value: new THREE.Color(...baked) };
        s.fragmentShader = s.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform vec3 uTint; uniform float uTintOn; uniform vec3 uBaked;')
          .replace('#include <map_fragment>', `#include <map_fragment>
            if (uTintOn > 0.5) {
              const vec3 W = vec3(0.2126, 0.7152, 0.0722);
              diffuseColor.rgb = uTint * clamp(dot(diffuseColor.rgb, W) / max(dot(uBaked, W), 0.02), 0.0, 1.5);
            }`);
      };
      m.customProgramCacheKey = () => (cloth ? 'cloth' : '') + (tinted ? 'tint' : '');
      m.needsUpdate = true;
    }
  }
}

function fabricOf(zone, id) {
  const hit = fabricsFor(zone).find((c) => c[0] === id);
  return hit ? { colour: new THREE.Color().setStyle(hexOf(hit)), opacity: hit[3], name: hit[1] } : null;
}

function applyLook() {
  if (record) lookOf(record, 'A');
  if (other) lookOf(other, 'B');
}
function lookOf(rec, side) {
  const clear = {};
  for (const [zone, t] of Object.entries(rec.tints)) {
    const fabric = fabricOf(zone, state.colours[zone]);
    const colour = fabric?.colour;
    // Clear laminates: hazy film between opaque fibres (lib/cloth.js).
    const sail = SAIL_ZONES.includes(zone);
    if (fabric && fabric.opacity < 1) clear[zone] = sail ? filmAlpha(fabric.opacity) : fabric.opacity;
    t.uTintOn.value = colour ? 1 : 0;
    const id = state.colours[zone] || null;
    if (sail && id !== t.fabric) {
      t.fabric = id;
      const panel = (mesh) => /^Sail P/.test(mesh.userData.materials.base.name);
      const mats = (list) => list.flatMap((mesh) => Object.values(mesh.userData.materials));
      setCloth(t.cloth, mats(t.meshes.filter(panel)), id, fabric?.opacity ?? 1);
      setCloth(t.plain, mats(t.meshes.filter((mesh) => !panel(mesh))), null);
    }
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
  for (const mesh of rec.meshes) {
    const part = mesh.userData.part, M = mesh.userData.materials;
    const selected = part.name === state.sel && state.selSide === side;
    let mat = selected ? M.selected : M.base;
    let visible = true;
    if (part.group === '04' || part.group === '05') visible = state.wires;
    const role = mesh.userData.battenRole === undefined ? (mesh.userData.battenRole = battenRole(part)) : mesh.userData.battenRole;
    const sailGone = state.seeThrough >= 0.98;
    if (role === 'batten') visible = state.battens;
    else if (role === 'tie') visible = state.battens && !sailGone;
    else if (role === 'eyelet') visible = !sailGone;
    // See-through sail, or a clear laminate panel.
    // In a sail zone only the panels are laminate; pockets coloured with them stay woven.
    const inSail = SAIL_ZONES.includes(mesh.userData.zone);
    const laminate = !inSail || /^Sail P/.test(M.base.name) ? clear[mesh.userData.zone] : undefined;
    // With film blur the laminate draws solid and shows the blurred scene behind it.
    const frosted = laminate !== undefined && inSail && frostActive && state.seeThrough === 0;
    mesh.userData.frost = frosted;
    const ghost = (part.group === '01' && state.seeThrough > 0) || (laminate !== undefined && !frosted);
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
    // Laminates shade what is under them too (film and fibres take about half the light).
    if (part.group === '01') mesh.castShadow = state.seeThrough < 0.35;
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
    if (mesh.morphTargetInfluences) twin.morphTargetInfluences = mesh.morphTargetInfluences;   // same shape
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
 * The glider rocks over the lower outline of its side view (the lower convex hull of every
 * point, in z and y): from the lowest point it rolls along the outline, over a round basebar
 * or wheels, until the next step of the outline is a long one, to the nose or the tail. That
 * step lies on the ground at rest, and nothing is below it.
 */
function restingPose(rec) {
  const root = rec.root;
  root.position.set(0, 0, 0);
  root.quaternion.identity();
  root.updateMatrixWorld(true);
  // The lowest point in each 2 mm slice along the glider: the outline only needs those.
  // Flat arrays and plain loops: the models have up to a million vertices.
  const v = new THREE.Vector3(), SLICE = 0.002;
  const low = new Map();
  for (const m of rec.meshes) {
    if (!m.userData.part.ground) continue;   // a hanging rope end does not hold the glider up
    const pos = m.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      const k = Math.round(v.z / SLICE), q = low.get(k);
      if (!q || v.y < q[1]) low.set(k, [v.z, v.y]);
    }
  }
  const pts = [...low.values()].sort((a, b) => a[0] - b[0]);
  // Lower convex hull, front to back in z (monotone chain).
  const hull = [];
  for (const p of pts) {
    while (hull.length > 1) {
      const [a, b] = [hull[hull.length - 2], hull[hull.length - 1]];
      if ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) <= 0) hull.pop(); else break;
    }
    hull.push(p);
  }
  let bottom = 0;
  for (let i = 1; i < hull.length; i++) if (hull[i][1] < hull[bottom][1]) bottom = i;
  // From the bottom, roll one way until a step is longer than LONG: that step rests on the
  // ground, and its slope is the tilt.
  const LONG = 0.5;
  const roll = (dir) => {
    for (let i = bottom; i + dir >= 0 && i + dir < hull.length; i += dir) {
      const a = hull[i], b = hull[i + dir];
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) > LONG) return Math.atan2(b[1] - a[1], Math.abs(b[0] - a[0]));
    }
    return 0;
  };
  const nose = roll(1), tail = roll(-1);
  return {
    hull, foot: hull[bottom],   // the standing contact: the fixed point along the ground
    nose: { angle: nose },      // nose down: +rotation about X
    tail: { angle: -tail },     // tail down: the other way
  };
}
/** The plan views always show the glider standing, so its axes line up with the views. */
const restPose = () => (rig?.projection === 'orthographic' ? 'bar' : state.pose);
function applyPose(animate = false) {
  if (record) poseOf(record, animate);
  if (other) {
    poseOf(other, animate);                          // on the same floor (y = 0) as the first
  }
}
const POSE_TIME = 700;
/**
 * Places the build tilted by `angle` about X (nose down > 0, tail down < 0), with the lowest
 * point of its outline at that angle on the ground (y = 0, the same for every build). Along
 * the ground it turns about its standing contact, so the placement changes smoothly with the
 * angle even where the lowest point jumps (from the wheels to the keel tail at rest).
 */
function tiltTo(rec, angle) {
  const c = Math.cos(angle), sn = Math.sin(angle);
  let low = Infinity;
  // y after the turn about X: y' = y cos - z sin
  for (const p of rec.rest.hull) low = Math.min(low, p[1] * c - p[0] * sn);
  const [fz, fy] = rec.rest.foot;
  rec.root.quaternion.setFromAxisAngle(X_AXIS, angle);
  rec.root.position.set(0, -low, fz - (fy * sn + fz * c));   // z' = y sin + z cos
  rec.root.updateMatrixWorld(true);
  rec.angle = angle;
}
const X_AXIS = new THREE.Vector3(1, 0, 0);
/** Swings the builds from their last pose to the new one; true while they move. */
function stepPoses(now) {
  let moving = false;
  for (const rec of [record, other]) {
    const m = rec?.swing;
    if (!m) continue;
    const k = Math.min((now - m.start) / POSE_TIME, 1), e = k * k * (3 - 2 * k);
    setShapes(rec, Object.fromEntries(Object.keys(m.s1).map((n) => [n, m.s0[n] + (m.s1[n] - m.s0[n]) * e])));
    tiltTo(rec, m.a0 + (m.a1 - m.a0) * e);
    if (k === 1) rec.swing = null; else moving = true;
  }
  return moving;
}
function poseOf(rec, animate = false) {
  if (!rec.rest) rec.rest = restingPose(rec);
  const fresh = !rec.ropes;
  const a0 = rec.angle ?? 0;
  const a1 = rec.rest[restPose()]?.angle ?? 0;   // standing: no tilt
  const s0 = { ...shapesNow(rec) }, s1 = shapesFor(rec, restPose());
  setShapes(rec, s1);
  tiltTo(rec, a1);
  // Exact bounds: the quick box of rotated parts reaches below the glider.
  rec.box.setFromObject(rec.root, true);
  rec.ground = 0;
  // The box above is the one of the new pose, so views frame where the glider ends up.
  rec.swing = null;
  const reshape = Object.keys(s1).some((n) => s0[n] !== s1[n]);
  if (animate && (a0 !== a1 || reshape)) {
    rec.swing = { a0, a1, s0, s1, start: performance.now() };
    setShapes(rec, s0);
    tiltTo(rec, a0);
  }
  if (fresh) { ropesOf(rec); vgOf(rec); setVG(rec, state.vg); }
}
/**
 * VG: a rigged build carries its loose state too (sport3-opus tools/vg_rig.py): parts that move
 * keep keyframes (time 0 loose, end tight) and parts that change shape the morph target
 * "VG loose"; the ropes that slide through the blocks follow their routes. A rope's surplus pays
 * out as the VG is pulled ("lengthLoose" in models.json).
 */
const VG_SHAPE = 'VG loose';
function vgOf(rec) {
  const shaped = rec.meshes.filter((m) => m.morphTargetDictionary?.[VG_SHAPE] !== undefined);
  for (const m of shaped) m.frustumCulled = false;   // the loose shape reaches past the tight bounds
  const tracks = rec.clips.flatMap((c) => c.tracks.filter((t) => !t.name.endsWith('.morphTargetInfluences')));
  // Glide between the settings: Blender writes these two-key tracks as STEP.
  for (const t of tracks) t.setInterpolation(THREE.InterpolateLinear);
  let mixer = null, action = null, duration = 0;
  if (tracks.length) {
    const clip = new THREE.AnimationClip('VG', -1, tracks);
    mixer = new THREE.AnimationMixer(rec.root.children[0]);
    action = mixer.clipAction(clip);
    action.play();
    action.paused = true;
    duration = clip.duration;
  }
  // Ropes that slide through the moving blocks are drawn along their routes (lib/rope.js).
  const routed = [];
  for (const m of rec.meshes) {
    let node = m;
    while (node && !node.userData.vg_route) node = node.parent;
    if (node) routed.push(new RoutedRope(m, JSON.parse(node.userData.vg_route), rec.root.children[0]));
  }
  rec.vg = shaped.length || tracks.length ? { shaped, mixer, action, duration, routed } : null;
}
function setVG(rec, v) {
  if (!rec?.vg) return;
  const { shaped, mixer, action, duration, routed } = rec.vg;
  for (const m of shaped) m.morphTargetInfluences[m.morphTargetDictionary[VG_SHAPE]] = 1 - v;
  if (mixer) { action.time = v * duration; mixer.update(0); }
  rec.root.updateMatrixWorld(true);
  for (const r of routed) r.update();
  rec.ropes.forEach((r, i) => {
    const spec = rec.source.ropes[i];
    if (spec.lengthLoose !== undefined) r.setLength(spec.lengthLoose + (spec.length - spec.lengthLoose) * v);
  });
}
/**
 * Soft rope ends: a part named in models.json ("ropes": [{ part, start, dir, length, radius,
 * colliders, lay }], model space) is redrawn as a rope that hangs from where it leaves its cleat,
 * lies on the floor and drapes over the colliders' tubes (lib/rope.js).
 */
function ropesOf(rec) {
  rec.ropes = [];
  for (const spec of rec.source.ropes || []) {
    const part = rec.parts.get(spec.part);
    if (!part) { console.warn(`No part ${spec.part} for a rope.`); continue; }
    const [mesh, ...rest] = part.meshes;
    for (const m of rest) m.geometry = new THREE.BufferGeometry();
    const colliders = (spec.colliders || []).map((n) => rec.parts.get(n)?.meshes || []);
    rec.ropes.push(new Rope(spec, rec.root.children[0], mesh, colliders));
  }
}
function stepRopes(dt) {
  for (const rec of [record, other]) for (const r of rec?.ropes || []) if (r.mesh.visible) r.step(dt);
}
/**
 * Configurations: a build can name shape keys (glTF morph targets) and their weight in each
 * resting pose, in models.json: "poseShapes": { "bar": { "In flight": 1 } }. A key gets weight
 * 0 in the poses that leave it out, and the weights swing with the tilt. The Tecma stands in
 * its flight shape and lies parked, rigged on the ground, in the other two poses.
 */
function shapesFor(rec, pose) {
  const table = rec.source.poseShapes;
  if (!table) return {};
  const names = new Set(Object.values(table).flatMap((w) => Object.keys(w)));
  return Object.fromEntries([...names].map((n) => [n, table[pose]?.[n] ?? 0]));
}
function shapesNow(rec) {
  if (!rec.shapes) {
    rec.shapes = {};
    for (const n of Object.keys(shapesFor(rec, 'bar'))) {
      // As loaded: the weight the GLB gives the key (the first mesh that has it).
      const m = rec.meshes.find((x) => x.morphTargetDictionary?.[n] !== undefined);
      rec.shapes[n] = m ? m.morphTargetInfluences[m.morphTargetDictionary[n]] : 0;
      if (m) for (const x of rec.meshes) { const i = x.morphTargetDictionary?.[n]; if (i !== undefined) x.morphTargetInfluences[i] = rec.shapes[n]; }
    }
  }
  return rec.shapes;
}
function setShapes(rec, weights) {
  const now = shapesNow(rec);
  for (const [n, w] of Object.entries(weights)) {
    if (now[n] === w) continue;
    now[n] = w;
    for (const m of rec.meshes) {
      const i = m.morphTargetDictionary?.[n];
      if (i !== undefined) m.morphTargetInfluences[i] = w;
    }
  }
}

// ------------------------------------------------------------------ compare
/** The build that is not the current one. */
const otherId = () => catalog.models.map((m) => m.id).find((id) => id !== state.model);
async function setCompare(on) {
  if (on && plan.quad) setQuad(false);
  state.compare = on && Boolean(otherId());
  if (!state.compare) {
    other?.root.removeFromParent();
    other = null;
    if (state.selSide === 'B') { state.sel = null; state.selSide = 'A'; renderChip(); }
    syncCompare();
    saveUrlSoon();
    return;
  }
  const id = otherId();
  syncCompare();
  if (other?.source.id === id) return;
  const source = catalog.sources.get(id);
  toast(`Loading the ${source.label} build to compare…`, true);
  let rec;
  try { rec = await loadModel(source, (f) => { if (f != null && f < 1) toast(`Loading the ${source.label} build · ${Math.round(f * 100)} %`, true); }); }
  catch (e) { console.error(e); toast(`The ${source.label} build didn’t load`); state.compare = false; syncCompare(); return; }
  if (!state.compare || otherId() !== id) return;
  other?.root.removeFromParent();
  other = rec;
  prepareTints(other);
  scene.add(other.root);
  applyPose();
  applyLook();
  syncCompare();
  toast(`Drag the divider to compare ${catalog.sources.get(state.model).label} and ${source.label}`);
  saveUrlSoon();
}
function syncCompare() {
  const on = state.compare && Boolean(other);
  document.body.classList.toggle('comparing', on);
  $('#btn-compare').classList.toggle('on', state.compare);
  $('#btn-compare').setAttribute('aria-pressed', String(state.compare));
  $('#swipe').hidden = !on;
  if (on) {
    $('#swipe').style.left = `${state.split * 100}%`;
    $('#swipe-a').textContent = catalog.sources.get(state.model).label;
    $('#swipe-b').textContent = catalog.sources.get(otherId()).label;
  }
}
function wireSwipe() {
  const el = $('#swipe');
  let drag = false;
  const move = (x) => { state.split = Math.min(0.95, Math.max(0.05, x / innerWidth)); el.style.left = `${state.split * 100}%`; saveUrlSoon(); };
  el.addEventListener('pointerdown', (e) => { drag = true; el.setPointerCapture(e.pointerId); e.preventDefault(); });
  el.addEventListener('pointermove', (e) => { if (drag) move(e.clientX); });
  el.addEventListener('pointerup', () => { drag = false; });
  el.addEventListener('keydown', (e) => {
    const step = e.key === 'ArrowLeft' ? -0.02 : e.key === 'ArrowRight' ? 0.02 : 0;
    if (step) { e.preventDefault(); move((state.split + step) * innerWidth); }
  });
}
function setPose(pose) {
  state.pose = pose;
  applyPose(!reduced);
  syncPanel();
  saveUrlSoon();
}

// ------------------------------------------------------------------ camera
/** The start view: the default camera, or a framing of the whole glider. */
function frontView(animate = !reduced) {
  if (!record) return;
  const cam = parseCamera(DEFAULTS.cam);
  rig.setProjection(cam ? cam.projection : 'perspective', animate);
  rig.animateTo(cam ? cam.pose : rig.frame(record.box, [0.42, 0.32, 1], 1.0), animate, fitSize);
  syncPanel();
}
function zoom(f) { const p = rig.pose(); p.size *= f; rig.animateTo(p, !reduced); userActive(); }
function toggle2d() {
  const ortho = rig.projection !== 'orthographic';
  rig.setProjection(ortho ? 'orthographic' : 'perspective', !reduced);
  if (ortho && record) rig.animateTo(planFrame(PLAN.top), !reduced, fitSize);
  else if (record) frontView();
  syncPanel();
  userActive();
}
// ------------------------------------------------------------------ plan views (2D)
// In 2D a bar at the top looks straight along an axis, or splits the screen into four
// views, each with its own pan and zoom. The nose points to +Z, the left wing to +X.
const PLAN = { front: [0, 0, 1], back: [0, 0, -1], top: [0, 1, -1e-4], bottom: [0, -1, 1e-4], left: [1, 0, 0], right: [-1, 0, 0] };
const QUAD = [PLAN.top, PLAN.front, PLAN.left, [0.42, 0.32, 1]];   // top left, top right, bottom left, bottom right (3D)
const SPLIT_TIME = 650;
// split: how far the four views are open (0 one view, 1 four), and where it is going.
// panes: the centre and size of each quarter; the active one is driven by the camera rig.
const plan = { quad: false, view: null, cams: null, panes: null, active: 0, flat: false, wall: null, split: 0, splitFrom: 0, splitStart: 0 };
function planView(name) {
  if (!record) return;
  if (rig.projection !== 'orthographic') rig.setProjection('orthographic', !reduced);
  stopTour();
  if (name === 'quad') return setQuad(!plan.quad);
  viewFrom(PLAN[name]);
}
/** A 2D view looking from `dir` (from the glider towards the camera), framing the glider. */
function viewFrom(dir) {
  if (!record) return;
  if (rig.projection !== 'orthographic') rig.setProjection('orthographic', !reduced);
  stopTour();
  setQuad(false);
  rig.animateTo(planFrame(dir), !reduced, fitSize);
  userActive();
}
/** Turns the camera around the target, in degrees: yaw about the vertical, pitch up or down. */
function orbit(yaw, pitch) {
  if (!record || plan.quad) return;
  stopTour();
  const p = rig.pose(), d = p.dir;
  const lim = THREE.MathUtils.degToRad(89.9);
  const el = THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp(d.y, -1, 1)) + THREE.MathUtils.degToRad(pitch), -lim, lim);
  const az = Math.atan2(d.x, d.z) + THREE.MathUtils.degToRad(yaw);
  p.dir = new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
  rig.animateTo(p, !reduced);
  userActive();
}
/**
 * Blender's numpad: 1 front, 3 right, 7 top (Ctrl for back, left, bottom), 9 the opposite
 * side, 5 2D/3D, 0 the start view, 2 4 6 8 turn 15 degrees, . the selected part, + - zoom.
 * By key position (e.code), so the number row keeps its own keys and NumLock doesn't matter.
 */
function numpadKey(e) {
  const m = /^Numpad(\d|Decimal|Add|Subtract)$/.exec(e.code);
  if (!m || e.metaKey || e.altKey) return false;
  const k = m[1], ctrl = e.ctrlKey;
  if (k === '1') planView(ctrl ? 'back' : 'front');
  else if (k === '3') planView(ctrl ? 'left' : 'right');
  else if (k === '7') planView(ctrl ? 'bottom' : 'top');
  else if (k === '9') { if (record && !plan.quad) viewFrom(rig.pose().dir.negate()); }
  else if (k === '5') { rig.setProjection(rig.projection === 'orthographic' ? 'perspective' : 'orthographic', !reduced); syncPanel(); userActive(); }
  else if (k === '0') frontView();
  else if (k === '4') orbit(-15, 0);
  else if (k === '6') orbit(15, 0);
  else if (k === '8') orbit(0, 15);
  else if (k === '2') orbit(0, -15);
  else if (k === 'Decimal') { if (state.sel) focusPart(selRec().parts.get(state.sel)); }
  else if (k === 'Add') zoom(0.7);
  else if (k === 'Subtract') zoom(1.4);
  else return false;
  return true;
}
/**
 * Pose that frames the glider from `dir`: on the whole screen, or in a quarter of it in
 * four views. The panels draw over the scene and don't move it.
 */
function planFrame(dir, margin = 1.15, quad = false) {
  const a = quad ? viewArea() : { w: innerWidth, h: innerHeight };
  return rig.frame(record.box, dir, margin, a.w / a.h);
}
/** The size that shows the whole glider from dir, for transitions to zoom out to. */
const fitSize = (dir) => planFrame(dir, 1.25).size;
function setQuad(on) {
  if (on === plan.quad) return;
  plan.quad = on;
  rig.controls.enableRotate = !on;
  rig.controls.zoomToCursor = !on;
  plan.splitFrom = plan.split;
  plan.splitStart = performance.now();
  if (on) {
    if (state.compare) setCompare(false);
    // Each quarter frames the glider on its own and then pans and zooms on its own. The
    // top left quarter grows out of the current view while it turns to the top view.
    plan.panes = QUAD.map((d) => { const f = planFrame(d, 1.2, true); return { target: f.target, size: f.size }; });
    plan.active = 0;
    rig.animateTo({ ...plan.panes[0], dir: new THREE.Vector3(...PLAN.top) }, !reduced, fitSize);
  } else {
    // The top left quarter shows the top view; the single view grows back out of it.
    rig.transition = null;
    if (plan.active !== 0) { holdPane(); plan.active = 0; }
    const p = plan.panes?.[0] || rig.pose();
    rig.setPose({ target: p.target.clone(), size: p.size, dir: new THREE.Vector3(...PLAN.top) });
  }
  if (reduced) plan.split = on ? 1 : 0;
  syncPlan();
}
/** Moves the split towards open or closed; true while it moves. */
function stepSplit(now) {
  const to = plan.quad ? 1 : 0;
  if (plan.split === to) return false;
  const k = Math.min((now - plan.splitStart) / SPLIT_TIME, 1), e = k * k * (3 - 2 * k);
  plan.split = k === 1 ? to : plan.splitFrom + (to - plan.splitFrom) * e;
  return true;
}
function syncPlan() {
  const on = rig?.projection === 'orthographic';
  if (!on && plan.quad) setQuad(false);
  if (rig && on !== plan.flat) {
    plan.flat = on;
    applyPose(!reduced);
    // In 2D a drag moves the drawing; right-drag still turns it.
    const c = rig.controls;
    c.mouseButtons = on ? { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }
      : { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    c.touches = on ? { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE } : { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  }
  document.body.classList.toggle('plan', on);
  document.body.classList.toggle('quad', plan.quad);
  $('#viewbar').hidden = !on;
  const dir = rig?.pose().dir;
  const view = plan.quad ? 'quad' : on && dir ? Object.keys(PLAN).find((k) => dir.dot(new THREE.Vector3(...PLAN[k]).normalize()) > 0.9995) || null : null;
  if (view === plan.view) return;
  plan.view = view;
  for (const b of document.querySelectorAll('#viewbar [data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === view));
}
function wirePlan() {
  $('#viewbar').addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (b) planView(b.dataset.view); });
  rig.addEventListener('projection', syncPlan);
  rig.addEventListener('change', syncPlan);
  // In four views, a drag or wheel pans or zooms the quarter it starts in, and only that one.
  const pick = (e) => {
    const v = plan.quad && plan.split === 1 && viewAt(e.clientX, e.clientY);
    if (v && v.index >= 0) usePane(v.index);
  };
  canvas.addEventListener('pointerdown', pick, true);
  canvas.addEventListener('wheel', pick, { capture: true, passive: true });
  syncPlan();
}
/** Keeps the active quarter's centre and size while the rig moves to another quarter. */
function holdPane() {
  const p = rig.pose();
  plan.panes[plan.active] = { target: p.target.clone(), size: p.size };
}
/** Hands the camera rig to quarter i, so the controls move that quarter. */
function usePane(i) {
  if (i === plan.active || !plan.panes) return;
  rig.transition = null;
  holdPane();
  plan.active = i;
  const p = plan.panes[i];
  rig.setPose({ target: p.target.clone(), size: p.size, dir: new THREE.Vector3(...QUAD[i]).normalize() });
}
/** Centre and size of quarter i: live from the rig for the active one. */
function paneOf(i) {
  if (i === plan.active || !plan.panes) { const p = rig.pose(); return { target: p.target, size: p.size }; }
  return plan.panes[i];
}
/** The area the views are drawn in, in CSS pixels: the whole screen (the panels draw over it). */
function viewArea() {
  return { x: 0, y: 0, w: innerWidth, h: innerHeight };
}
/** The four quarters as { x, y, w, h } in CSS pixels from the top left, for a split of s. */
function cells(s = plan.split) {
  const a = viewArea(), cw = Math.round(a.w * (1 - s / 2)), ch = Math.round(a.h * (1 - s / 2));
  return [[0, 0, cw, ch], [cw, 0, a.w - cw, ch], [0, ch, cw, a.h - ch], [cw, ch, a.w - cw, a.h - ch]]
    .map(([x, y, w, h]) => ({ x: a.x + x, y: a.y + y, w, h }));
}
/** The camera under a screen point and the point in its view (-1..1). */
function viewAt(x, y) {
  if (!plan.quad) return { camera: rig.camera, index: -1, ndc: new THREE.Vector2((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1) };
  const index = cells().findIndex((c) => x >= c.x && x < c.x + c.w && y >= c.y && y < c.y + c.h);
  const c = cells()[Math.max(index, 0)];
  return { camera: cellCam(Math.max(index, 0), c.w / c.h), index, ndc: new THREE.Vector2(((x - c.x) / c.w) * 2 - 1, -((y - c.y) / c.h) * 2 + 1) };
}
/** The camera distance that keeps a plan view clear of the scene around the glider. */
const reachOf = () => (record ? record.box.getSize(new THREE.Vector3()).length() / 2 + 2 : 10);
function closeIn(cam) {
  const t = rig.controls.target, off = cam.position.clone().sub(t);
  if (off.lengthSq() > 0) cam.position.copy(t).addScaledVector(off.normalize(), reachOf());
}
/**
 * The studio floor stands up behind the glider in the views from the side, so Front, Left
 * and Right get the same metre grid and pool of light as Top and Bottom. It is a copy of
 * the floor with the floor's settings, its light raised to the height of the view's centre.
 */
function placeWallGrid(dir, flat, t = rig.controls.target) {
  const floor = scenes.indoor.built?.studio?.floor;
  // The wall fades in as the view turns from looking down (or up) to looking across, and the
  // floor fades out as much, so a turn from Top to Bottom passes one into the other.
  const fade = flat ? THREE.MathUtils.smoothstep(Math.abs(dir.y), 0.55, 0.85) : 1;   // 1: the floor only
  if (floor) floor.material.uniforms.uFade.value = fade;
  const on = flat && floor?.visible && scenes.current === 'studio' && fade < 1;
  if (!on) { if (plan.wall) plan.wall.visible = false; return; }
  if (!plan.wall) { plan.wall = new THREE.Mesh(floor.geometry, floor.material.clone()); plan.wall.renderOrder = floor.renderOrder; scene.add(plan.wall); }
  const w = plan.wall, u = w.material.uniforms, back = reachOf() - 1, base = floor.getWorldPosition(new THREE.Vector3());
  for (const [k, v] of Object.entries(floor.material.uniforms)) if (k !== 'uCentre' && k !== 'uFade') { if (v.value?.copy) u[k].value.copy(v.value); else u[k].value = v.value; }
  w.visible = true;
  u.uFade.value = 1 - fade;
  // Square to the view at every angle, so a turn between views (Right to Left goes round
  // through Front) keeps the pool of light steady behind the glider instead of flipping.
  const h = new THREE.Vector3(dir.x, 0, dir.z).normalize();
  w.rotation.set(0, Math.atan2(h.x, h.z), 0);
  w.position.set(t.x - h.x * back, base.y, t.z - h.z * back);
  w.updateMatrixWorld();
  const c = w.worldToLocal(t.clone());
  u.uCentre.value.set(c.x, c.y);
}
/** The camera of quarter i (top, front, left, 3D) for a quarter of the given aspect. */
function cellCam(i, aspect) {
  if (!plan.cams) plan.cams = [0, 1, 2].map(() => new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 400)).concat(new THREE.PerspectiveCamera(38, 1, 0.01, 2000));
  const cam = plan.cams[i], { target, size: s } = paneOf(i);
  const dir = new THREE.Vector3(...QUAD[i]).normalize(), reach = reachOf();
  if (cam.isOrthographicCamera) {
    // Close in, so walls and roof of the hangar stay behind the camera.
    cam.position.copy(target).addScaledVector(dir, reach);
    Object.assign(cam, { top: s / 2, bottom: -s / 2, left: -s * aspect / 2, right: s * aspect / 2 });
  } else {
    cam.aspect = aspect;
    cam.position.copy(target).addScaledVector(dir, s / (2 * Math.tan(THREE.MathUtils.degToRad(19))) + reach * 0.1);
  }
  cam.lookAt(target);
  cam.updateProjectionMatrix();
  return cam;
}
function renderQuad() {
  const list = cells(), split = plan.split, moving = split < 1;
  const el = $('#quad'), a = viewArea();
  el.hidden = false;
  Object.assign(el.style, { left: `${a.x}px`, top: `${a.y}px`, width: `${a.w}px`, height: `${a.h}px`,
    gridTemplateColumns: `${list[0].w}px 1fr`, gridTemplateRows: `${list[0].h}px 1fr`, opacity: split });
  renderer.setScissorTest(true);
  list.forEach((c, i) => {
    if (c.w < 1 || c.h < 1) return;
    const x = c.x, y = innerHeight - c.y - c.h;
    renderer.setViewport(x, y, c.w, c.h);
    renderer.setScissor(x, y, c.w, c.h);
    let cam;
    if (i === 0 && moving) {
      // While the split opens or closes, the top left quarter is the main view itself,
      // so it hands over to the single view without a jump.
      rig.setAspect(c.w / c.h);
      rig.setPose(rig.pose());
      cam = rig.camera;
      placeWallGrid(rig.pose().dir, rig.projection === 'orthographic');
    } else {
      cam = cellCam(i, c.w / c.h);
      placeWallGrid(new THREE.Vector3(...QUAD[i]), cam.isOrthographicCamera, paneOf(i).target);
    }
    renderer.render(scene, cam);
  });
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, innerWidth, innerHeight);
  if (moving) { rig.setAspect(innerWidth / innerHeight); rig.setPose(rig.pose()); }
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
  const g = record.ground, t = c.target;
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
  const g = record.ground, cam = rig.camera.position, t = rig.controls.target;
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
function startTour() { state.tour = true; rig.setProjection('perspective', !reduced); rig.controls.autoRotate = true; rig.controls.autoRotateSpeed = 1.6; syncPanel(); }
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
  // Plan views may look from any side, even up from under the ground: the camera sits
  // just outside the glider, so floors, walls and the roof stay behind it.
  // While the projection changes the camera is placed by the rig alone.
  const flat = rig.projection === 'orthographic' && !rig.morph;
  rig.orthoDistance = reachOf();
  if (flat || rig.morph) rig.controls.maxPolarAngle = Math.PI; else limitCamera();
  rig.update(now, dt);
  if (flat) closeIn(rig.camera); else if (!rig.morph) clampCamera();
  stepSplit(now);
  stepPoses(now);
  stepRopes(dt);
  scenes.update(rig.camera, (now - clock0) / 1000);
  const split = plan.quad || plan.split > 0;
  // Film blur needs one camera over the whole picture: off in four views and compare.
  const fb = Boolean(state.frost && !THUMB && !split && !(other && state.compare));
  if (fb !== frostActive) { frostActive = fb; applyLook(); }
  frost.uFrostOn.value = 0;   // on only for a frame whose blurred picture is fresh (renderFrost)
  if (!split) { $('#quad').hidden = true; placeWallGrid(rig.pose().dir, rig.projection === 'orthographic'); }
  if (split) renderQuad();
  else if (other && state.compare) {
    // Left of the divider the chosen build, right of it the other one.
    const w = renderer.domElement.width / renderer.getPixelRatio(), h = renderer.domElement.height / renderer.getPixelRatio();
    const x = Math.round(state.split * w);
    renderer.setScissorTest(true);
    record.root.visible = true; other.root.visible = false;
    renderer.setScissor(0, 0, x, h);
    renderer.render(scene, rig.camera);
    record.root.visible = false; other.root.visible = true;
    renderer.setScissor(x, 0, w - x, h);
    renderer.render(scene, rig.camera);
    renderer.setScissorTest(false);
    record.root.visible = true; other.root.visible = true;
  } else {
    if (frostActive) renderFrost(rig.camera);
    renderer.render(scene, rig.camera);
    if (state.outline && record) {
      if (record.outlineWires !== state.outlineWires) { record.outlineWires = state.outlineWires; outline.setMeshes(record.meshes, state.outlineWires); }
      outline.render(renderer, scene, rig.camera, state.outlineW, state.outlineC, state.outlineInner ? Math.max(0.001, state.outlineSens) : 0);
    }
  }
  updateLabels();
}
const outline = new Outline();                      // experimental (Settings); lib/outline.js
// ------------------------------------------------------------------ film blur
// Laminates show the scene behind them blurred by distance (lib/frost.js).
const filmBlur = new FilmBlur();
function renderFrost(camera) {
  const films = [], hide = [];
  scene.traverse((o) => {
    if (!o.visible) return;
    const m = o.material;
    if (o.userData.frost) films.push(o);
    else if (m && !Array.isArray(m) && (m.transparent || m.colorWrite === false)) hide.push(o);
  });
  if (!films.length) return;   // no laminate in sight: nothing reads the picture
  // Sail panels hold the blurred texture: unbound while drawing (a feedback loop makes
  // WebGL skip those draws).
  frost.uFrostColor.value = null;
  const size = filmBlur.render(renderer, scene, camera, films, hide);
  frost.uFrostColor.value = filmBlur.texture;
  frost.uFrostSize.value.copy(size);
  frost.uFrostOn.value = 1;
}

// ------------------------------------------------------------------ order summary
const orderOptions = new Set();   // options ticked in the order, kept while the page is open
function showOrder() {
  if (!record) return;
  saveUrl();
  const builtHex = (z) => document.querySelector(`.sw.original[data-zone="${z}"]`)?.style.getPropertyValue('--c') || '#ccc';
  const panels = ['p1', 'p2', 'p3', 'p4', 'p5'].filter((z) => record.tints[z]?.meshes.length).map((z) => {
    const id = state.colours[z];
    const f = id && fabricsFor(z).find((c) => c[0] === id);
    return { zone: z, label: ZONES[z].name, asBuilt: builtHex(z), fabric: f ? { id, name: f[1], hex: hexOf(f), opacity: f[3] } : null };
  });
  const fill = (p) => (p.fabric ? p.fabric.hex : p.asBuilt);
  const by = Object.fromEntries(panels.map((p) => [p.zone, p]));
  const extras = [];
  if (state.colours.pockets) extras.push({ name: 'Batten pockets', value: fabricOf('pockets', state.colours.pockets)?.name });
  if (state.colours.frame) extras.push({ name: 'Frame', value: fabricOf('frame', state.colours.frame)?.name });
  openOrder({
    model: 'Wills Wing Falcon 4', size: '170',
    colours: state.profile === 'calibrated' ? 'calibrated to the cloth' : 'Wills Wing colour picker',
    diagram: planSvg((z) => (by[z] ? { fill: fill(by[z]), opacity: by[z].fabric?.opacity ?? 1 } : null)), panels, extras,
  }, orderOptions);
}

/**
 * The sail from above and below as a flat plan, each panel in its colour: P1 along the leading
 * edge, then P2, P3 and P4 back to the trailing edge; P5 under the front of the wing.
 */
function planSvg(panel) {
  const W = 220, nose = [W / 2, 8], tip = [6, 74], root = [W / 2, 58], tipTe = [12, 84];
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const at = (s, f) => lerp(lerp(nose, tip, s), lerp(root, tipTe, s), f);   // s: root to tip, f: LE to TE
  const band = (f0, f1) => {
    const pts = [];
    for (let i = 0; i <= 8; i++) pts.push(at(i / 8, f0));
    for (let i = 8; i >= 0; i--) pts.push(at(i / 8, f1));
    return [pts.map((p) => p.join(',')).join(' '), pts.map(([x, y]) => `${W - x},${y}`).join(' ')];
  };
  const draw = (z, f0, f1) => {
    const p = panel(z);
    if (!p) return '';
    return band(f0, f1).map((pts) => `<polygon points="${pts}" fill="${p.fill}" fill-opacity="${p.opacity < 1 ? 0.25 + p.opacity * 0.5 : 1}"/>`).join('');
  };
  const tag = (z, f) => { const [x, y] = at(0.62, f); return panel(z) ? `<text x="${W - x}" y="${y + 1.6}">${z.toUpperCase()}</text>` : ''; };
  const top = draw('p1', 0, 0.2) + draw('p2', 0.2, 0.42) + draw('p3', 0.42, 0.78) + draw('p4', 0.78, 1);
  const topTags = tag('p1', 0.1) + tag('p2', 0.31) + tag('p3', 0.6) + tag('p4', 0.89);
  const under = draw('p5', 0, 0.45) + `<g fill-opacity="0">${draw('p3', 0.45, 0.78)}${draw('p4', 0.78, 1)}</g>`;
  const svg = (inner, tags, label) => `<figure><svg viewBox="0 0 ${W} 92" role="img" aria-label="${label}"><g stroke="#1a1a1a" stroke-width=".5" stroke-linejoin="round">${inner}</g><g class="of-tags">${tags}</g></svg><figcaption>${label}</figcaption></figure>`;
  return svg(top, topTags, 'Top surface') + svg(under, tag('p5', 0.22), 'Bottom surface');
}

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  rig.setAspect(innerWidth / innerHeight);
}
// ------------------------------------------------------------------ clicking a part
const raycaster = new THREE.Raycaster();
function pickPart(e) {
  const r = canvas.getBoundingClientRect();
  const view = viewAt(e.clientX - r.left, e.clientY - r.top);
  raycaster.setFromCamera(view.ndc, view.camera);
  const side = other && state.compare && e.clientX > state.split * innerWidth ? 'B' : 'A';
  const rec = side === 'B' ? other : record;
  const meshes = rec.meshes.filter((m) => m.visible && !(m.material.transparent && m.material.opacity < 0.5));
  const part = raycaster.intersectObjects(meshes, false)[0]?.object.userData.part || null;
  if (part) part.side = side;
  return part;
}
/** The Customize zone (P1 to P5, pockets, frame) of the part under the pointer, if any. */
function pickZone(e) {
  const r = canvas.getBoundingClientRect();
  const view = viewAt(e.clientX - r.left, e.clientY - r.top);
  raycaster.setFromCamera(view.ndc, view.camera);
  const rec = other && state.compare && e.clientX > state.split * innerWidth ? other : record;
  const meshes = rec.meshes.filter((m) => m.visible && !(m.material.transparent && m.material.opacity < 0.5));
  for (const hit of raycaster.intersectObjects(meshes, false)) {
    const z = hit.object.userData.zone;
    if (z) return z;
    if (hit.object.userData.part?.group === '01') return null;   // other sail parts hide what is behind
  }
  return null;
}
function select(part) {
  state.sel = part ? part.name : null;
  state.selSide = part?.side || 'A';
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
/** A real part number, or '' for placeholders such as "(sail)". */
const partNo = (part) => { const n = (part.info.part_no || '').trim(); return /^\(.*\)$/.test(n) ? '' : n; };
const selRec = () => (state.selSide === 'B' && other ? other : record);
function renderChip() {
  const chip = $('#chip');
  const part = state.sel && selRec()?.parts.get(state.sel);
  if (!part) { chip.hidden = true; return; }
  const concept = CONCEPTS.find((c) => c.re.test(part.name));
  chip.hidden = false;
  chip.innerHTML = `<div class="chip-text"><b>${esc(concept ? concept.name : part.name)}</b>
    <span class="chip-meta">${other && state.compare ? `${esc(selRec().source.label)} · ` : ''}${concept ? `${esc(part.name)} · ` : ''}${esc(CATEGORIES[part.group])}${partNo(part) ? ` · <span class="pn">${esc(partNo(part))}</span>` : ''}</span>
    <span class="chip-lead">${esc(concept ? concept.text : firstSentence(part.info.description) || GROUP_TEXT[part.group])}</span></div>
    <button type="button" class="chip-btn" data-act="focus" title="Go to it">Go to it</button>
    <button type="button" class="chip-close" data-act="close" aria-label="Close (Esc)"><svg viewBox="0 0 24 24" class="ic"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`;
}

// ------------------------------------------------------------------ labels for the customize rows
// "Labels on the glider" names each colour row of Customize (P1 to P5, the batten pockets,
// the frame) where it is on the glider, with its current colour as a swatch. Each sits on
// one wing (side: the left wing is +X) at its own fraction of the span, so they spread out.
const LABEL_ZONES = [['p1', 1, 0.55], ['p2', -1, 0.35], ['p3', 1, 0.3], ['p4', -1, 0.75], ['p5', 1, 0.8], ['pockets', -1, 0.55], ['frame', -1, 0.12]];
const labelEls = new Map();
/**
 * A point on the zone's own surface in the model's frame, so it holds for every pose: the
 * vertex nearest the middle of the zone's parts in a strip across one wing at `at` of the span.
 */
function zoneAnchor(rec, zone, side, at) {
  rec.zoneAnchors ??= {};
  if (zone in rec.zoneAnchors) return rec.zoneAnchors[zone];
  const meshes = rec.tints[zone]?.meshes || [];
  const toModel = new THREE.Matrix4().copy(rec.root.matrixWorld).invert(), m4 = new THREE.Matrix4();
  const xs = [], ys = [], zs = [], v = new THREE.Vector3();
  for (const m of meshes) {
    m.updateWorldMatrix(true, false);
    m4.multiplyMatrices(toModel, m.matrixWorld);
    const pos = m.geometry.attributes.position;
    for (let i = 0; i < pos.count; i += 3) { v.fromBufferAttribute(pos, i).applyMatrix4(m4); xs.push(v.x); ys.push(v.y); zs.push(v.z); }
  }
  let span = 0;
  for (const x of xs) span = Math.max(span, Math.abs(x));
  const pick = (i) => Math.abs(xs[i] * side / span - at) < 0.06;
  const c = new THREE.Vector3();
  let n = 0;
  for (let i = 0; i < xs.length; i++) if (pick(i)) { c.x += xs[i]; c.y += ys[i]; c.z += zs[i]; n++; }
  let anchor = null;
  if (n) {
    c.divideScalar(n);
    let best = Infinity;
    for (let i = 0; i < xs.length; i++) {
      if (!pick(i)) continue;
      const d = (xs[i] - c.x) ** 2 + (ys[i] - c.y) ** 2 + (zs[i] - c.z) ** 2;
      if (d < best) { best = d; anchor = new THREE.Vector3(xs[i], ys[i], zs[i]); }
    }
  }
  return (rec.zoneAnchors[zone] = anchor);
}
const SVGNS = 'http://www.w3.org/2000/svg';
const leaderEls = new Map();   // zone: { line, dot }
function buildLabels() {
  const host = $('#labels');
  host.innerHTML = '';
  labelEls.clear();
  leaderEls.clear();
  labelPlace.clear();
  labelMask.key = '';   // lay the new labels out
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.classList.add('leaders');
  host.append(svg);
  for (const [zone] of LABEL_ZONES) {
    if (!record.tints[zone]?.meshes.length) continue;
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'label';
    el.tabIndex = -1;
    el.innerHTML = `<span class="label-tag"><span class="sw"><i></i></span><b>${esc(ZONES[zone].name)}</b></span>`;
    el.onclick = () => { const r = el.getBoundingClientRect(); showRow(zone, r.right, r.top + r.height / 2); };
    host.append(el);
    labelEls.set(zone, el);
    const line = document.createElementNS(SVGNS, 'polyline'), dot = document.createElementNS(SVGNS, 'circle');
    dot.setAttribute('r', '3');
    svg.append(line, dot);
    leaderEls.set(zone, { line, dot });
  }
  syncLabelSwatches();
}
/** Each label's swatch looks like the option chosen in its row. */
function syncLabelSwatches() {
  for (const [zone, el] of labelEls) {
    const on = document.querySelector(`.swatches .sw.on[data-zone="${zone}"]`), sw = el.querySelector('.sw');
    if (!on) continue;
    sw.className = on.className.replace(/\bon\b/, '').trim();
    sw.style.cssText = on.style.cssText;
  }
}
// Customize lists each part on one line (its colour and fabric); a line opens to its swatches.
const ui = { open: null, picker: null };
/** Copies the chosen swatch's look onto a line's (or the picker's) current-colour dot. */
function showCurrent(cur, zone) {
  const on = document.querySelector(`#custom .swatches .sw.on[data-zone="${zone}"]`);
  if (on && cur) { cur.className = `cur ${on.className.replace(/\b(on|sw)\b/g, '').trim()}`; cur.style.cssText = on.style.cssText; }
}
/** The rows: which part is open, and each line's current swatch. */
function syncRows() {
  for (const row of document.querySelectorAll('#custom [data-row]')) {
    const z = row.dataset.row, open = ui.open === z;
    row.classList.toggle('open', open);
    row.querySelector('.row-head').setAttribute('aria-expanded', String(open));
    showCurrent(row.querySelector('.cur'), z);
  }
  if (ui.picker) showCurrent($('#picker .cur'), ui.picker);
}

// Clicking a part of the glider, or its label, opens a small colour picker right there.
/** Opens the inline picker for a zone, next to a point on the screen (CSS px). */
function showRow(zone, x = innerWidth / 2, y = innerHeight / 2) {
  if (!ZONES[zone]) return;
  const el = $('#picker');
  ui.picker = zone;
  el.innerHTML = `<header><span class="cur" aria-hidden="true"><i></i></span><span class="pk-title"><b>${esc(zone === 'frame' ? 'Frame' : ZONES[zone].name)}</b><small data-name="${zone}"></small></span>
    <button type="button" class="pk-close" aria-label="Close"><svg viewBox="0 0 24 24" class="ic"><path d="M6 6l12 12M18 6L6 18"/></svg></button></header>
    ${swatches(zone)}`;
  el.hidden = false;
  syncPanel();
  // Beside the point, flipped or nudged to stay on screen.
  const w = el.offsetWidth, h = el.offsetHeight, gap = 14, m = 12;
  let left = x + gap, top = y - h / 2;
  if (left + w > innerWidth - m) left = x - gap - w;
  left = Math.max(m, Math.min(left, innerWidth - m - w));
  top = Math.max(m, Math.min(top, innerHeight - m - h));
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  el.querySelector('.sw.on')?.focus({ preventScroll: true });
}
function closePicker() {
  if (!ui.picker) return;
  ui.picker = null;
  $('#picker').hidden = true;
  $('#picker').innerHTML = '';
}
const tmp = new THREE.Vector3();
/**
 * Labels stand close to their part, with a straight leader to a dot on it (one sharp bend where
 * it meets the label). Each label has a few candidate spots: the nearest one clear of the glider
 * in each of 12 directions, and spots on the glider right beside the dot. They are chosen
 * together, for short leaders that run little over the glider, never cross each other or another
 * label, and keep a label where it was. The labels fade out while the view moves and are laid
 * out once it is still. The glider's shape on screen comes from a small mask.
 */
const MASK_CELL = 8;                 // CSS px per mask cell
const GLIDER_LAYER = 2;              // the glider's solid parts (not the wires), for the mask
const labelMask = { target: null, data: null, cols: 0, rows: 0, key: '', flat: new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }) };
/** Draws the glider (no wires) as white on black, a cell per MASK_CELL px, and reads it back. */
function drawLabelMask(rec) {
  const cols = Math.ceil(innerWidth / MASK_CELL), rows = Math.ceil(innerHeight / MASK_CELL);
  const M = labelMask;
  if (!M.target || M.cols !== cols || M.rows !== rows) {
    M.target?.dispose();
    M.target = new THREE.WebGLRenderTarget(cols, rows);
    M.data = new Uint8Array(cols * rows * 4);
    M.cols = cols; M.rows = rows;
  }
  if (!rec.maskLayer) {
    for (const mesh of rec.meshes) if (!['04', '05'].includes(mesh.userData.part.group)) mesh.layers.enable(GLIDER_LAYER);
    rec.maskLayer = true;
  }
  const cam = rig.camera, layers = cam.layers.mask, bg = scene.background, ov = scene.overrideMaterial, fog = scene.fog;
  const autoShadow = renderer.shadowMap.autoUpdate, clear = renderer.getClearColor(new THREE.Color()), alpha = renderer.getClearAlpha();
  cam.layers.set(GLIDER_LAYER);
  scene.background = null; scene.overrideMaterial = M.flat; scene.fog = null;
  renderer.shadowMap.autoUpdate = false;
  renderer.setClearColor(0x000000, 1);
  renderer.setRenderTarget(M.target);
  renderer.clear();
  renderer.render(scene, cam);
  renderer.readRenderTargetPixels(M.target, 0, 0, cols, rows, M.data);
  renderer.setRenderTarget(null);
  renderer.setClearColor(clear, alpha);
  renderer.shadowMap.autoUpdate = autoShadow;
  cam.layers.mask = layers; scene.background = bg; scene.overrideMaterial = ov; scene.fog = fog;
}
/** True if the screen rectangle touches the glider. */
function onGlider(x0, y0, x1, y1) {
  const M = labelMask;
  const c0 = Math.max(0, Math.floor(x0 / MASK_CELL)), c1 = Math.min(M.cols - 1, Math.floor(x1 / MASK_CELL));
  const r0 = Math.max(0, Math.floor(y0 / MASK_CELL)), r1 = Math.min(M.rows - 1, Math.floor(y1 / MASK_CELL));
  for (let r = r0; r <= r1; r++) {
    const row = (M.rows - 1 - r) * M.cols;   // the target's rows run bottom up
    for (let c = c0; c <= c1; c++) if (M.data[(row + c) * 4] > 0) return true;
  }
  return false;
}
const LABEL_MIN = 40, LABEL_MAX = 560;
// zone: { dx, dy, d } the spot a label took (kept while free), its target box and anchor.
const labelPlace = new Map();
const LABEL_SETTLE = 160;   // ms of a still view before the labels are laid out and shown again
/**
 * While the view moves the labels fade out; once it has been still for LABEL_SETTLE ms they are
 * laid out for it and fade back in.
 */
const labelView = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), proj: 0, at: new THREE.Vector3(), atQuat: new THREE.Quaternion() };
function updateLabels() {
  if (!record || !state.names) return;
  const W = innerWidth, H = innerHeight, m = record.root.matrixWorld, cam = rig.camera, now = performance.now();
  const host = $('#labels'), V = labelView;
  // Moving: the view turned or travelled noticeably since the last frame (the orbit's damping
  // drifts on for a while; that counts as still), or the pose, size or panel changed.
  const rest = `${m.elements.map((v) => v.toFixed(3))}${W}x${H}${state.panel}${state.compare}${state.split}${state.wires}${state.battens}`;
  const proj = cam.isOrthographicCamera ? cam.zoom * (cam.top - cam.bottom) : cam.projectionMatrix.elements[5];
  const fast = cam.position.distanceTo(V.pos) > 0.004 || cam.quaternion.angleTo(V.quat) > 0.002 || Math.abs(proj - V.proj) > 1e-3 * Math.abs(proj);
  V.pos.copy(cam.position); V.quat.copy(cam.quaternion); V.proj = proj;
  if (fast || rest !== labelMask.key) { labelMask.key = rest; labelMask.movedAt = now; labelMask.settled = false; host.classList.add('moving'); return; }
  // Settled, but drifted since the layout: lay out again in place, without fading.
  if (labelMask.settled && (cam.position.distanceTo(V.at) > 0.003 || cam.quaternion.angleTo(V.atQuat) > 0.0015)) labelMask.settled = false;
  if (labelMask.settled || now - labelMask.movedAt < LABEL_SETTLE) return;
  V.at.copy(cam.position); V.atQuat.copy(cam.quaternion);
  labelMask.settled = true;
  layoutLabels();
  for (const [z, L] of labelPlace) {
    if (!L.shown || !L.target) continue;
    const el = labelEls.get(z), lead = leaderEls.get(z), r = L.target, p = L.p;
    el.style.transform = `translate(${r.x0}px, ${r.y0}px)`;
    lead.line.setAttribute('points', L.pts.map((q) => q.join(',')).join(' '));
    lead.dot.setAttribute('cx', p.x);
    lead.dot.setAttribute('cy', p.y);
  }
  host.classList.remove('moving');
}
function layoutLabels() {
  const W = innerWidth, H = innerHeight, m = record.root.matrixWorld, cam = rig.camera;
  drawLabelMask(record);
  // On screen, clear of the title, the bars, the buttons and any open panel.
  const huds = [...document.querySelectorAll('#title, #topbtns > *, #navstack > *, #posebar, #scene-pick, #viewbar, #chip, #custom, #settings, #picker, #swipe')]
    .filter((el) => !el.hidden && el.offsetParent !== null).map((el) => el.getBoundingClientRect()).filter((b) => b.width && b.height);
  const inBox = (r) => r.x0 >= 12 && r.x1 <= W - 12 && r.y0 >= 12 && r.y1 <= H - 12
    && !huds.some((b) => r.x0 < b.right + 10 && r.x1 > b.left - 10 && r.y0 < b.bottom + 8 && r.y1 > b.top - 8);
  // The label's near edge (or corner) d px from the anchor, in direction (dx, dy).
  const rectAt = (it, dx, dy, d) => {
    const cx = it.p.x + dx * d + Math.sign(Math.round(dx * 10)) * it.w / 2, cy = it.p.y + dy * d + Math.sign(Math.round(dy * 10)) * it.h / 2;
    return { x0: cx - it.w / 2, y0: cy - it.h / 2, x1: cx + it.w / 2, y1: cy + it.h / 2 };
  };
  // The leader: from the dot straight to the label, with one sharp bend into its near side.
  const leader = (p, r, dx, dy) => {
    const cy = (r.y0 + r.y1) / 2;
    if (Math.abs(dx) < 0.3) {   // above or below: straight to the label's edge
      const ex = Math.min(Math.max(p.x, r.x0 + 10), r.x1 - 10);
      return [[p.x, p.y], [ex, dy < 0 ? r.y1 + 3 : r.y0 - 3]];
    }
    const side = dx > 0 ? r.x0 - 3 : r.x1 + 3;
    return [[p.x, p.y], [side - Math.sign(dx) * 12, cy], [side, cy]];
  };
  const segs = (pts) => pts.slice(1).map((q, i) => [pts[i], q]);
  const len = (pts) => segs(pts).reduce((s, [a, b]) => s + Math.hypot(b[0] - a[0], b[1] - a[1]), 0);
  // Pixels of the leader that run over the glider (past the first few, which leave the part).
  const overGlider = (pts) => {
    let n = 0, t = 0;
    for (const [a, b] of segs(pts)) {
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let s = 0; s < l; s += 4, t += 4) {
        if (t < 14) continue;
        const x = a[0] + (b[0] - a[0]) * s / l, y = a[1] + (b[1] - a[1]) * s / l;
        if (onGlider(x, y, x, y)) n += 4;
      }
    }
    return n;
  };
  const cross = (a, b, c, d) => {
    const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
    return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
  };
  const hitsRect = ([a, b], r) => {
    for (let s = 0; s <= 1; s += 0.1) { const x = a[0] + (b[0] - a[0]) * s, y = a[1] + (b[1] - a[1]) * s; if (x > r.x0 - 2 && x < r.x1 + 2 && y > r.y0 - 2 && y < r.y1 + 2) return true; }
    return false;
  };

  // The labels in view, each with its candidate spots: the nearest clear spot in each of 12
  // directions, scored on its own (leader length, leader over the glider, a change of side).
  const items = [];
  for (const [z, side, at] of LABEL_ZONES) {
    const el = labelEls.get(z), lead = leaderEls.get(z);
    if (!el) continue;
    const a = zoneAnchor(record, z, side, at);
    if (a) tmp.copy(a).applyMatrix4(m).project(cam);
    const p = a && { x: (tmp.x + 1) / 2 * W, y: (1 - tmp.y) / 2 * H };
    const shown = Boolean(a && record.tints[z].meshes.some((mesh) => mesh.visible) && tmp.z < 1 && p.x > 0 && p.x < W && p.y > 0 && p.y < H
      && !(other && state.compare && p.x > state.split * W - 20));
    el.style.opacity = shown ? 1 : 0;
    el.style.pointerEvents = shown ? 'auto' : 'none';
    lead.line.style.display = lead.dot.style.display = shown ? '' : 'none';
    const L = labelPlace.get(z) || {};
    labelPlace.set(z, L);
    L.shown = shown;
    if (!shown) continue;
    const it = { z, L, p, w: el.offsetWidth, h: el.offsetHeight || 18, cands: [] };
    for (let k = 0; k < 12; k++) {
      const ang = k * Math.PI / 6, dx = Math.round(Math.cos(ang) * 100) / 100, dy = Math.round(Math.sin(ang) * 100) / 100;
      for (let d = LABEL_MIN; d < LABEL_MAX; d += 8) {
        const r = rectAt(it, dx, dy, d);
        if (!inBox(r)) break;
        if (onGlider(r.x0 - 6, r.y0 - 4, r.x1 + 6, r.y1 + 4)) continue;
        const pts = leader(p, r, dx, dy);
        const same = L.dx !== undefined && Math.abs(L.dx - dx) < 0.01 && Math.abs(L.dy - dy) < 0.01;
        it.cands.push({ dx, dy, d, r, pts, cost: len(pts) + 2.5 * overGlider(pts) + (same ? 0 : 60) });
        break;
      }
    }
    // On the glider right beside the dot: tidier than a long leader across the glider.
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, -1], [0, 1]]) {
      const r = rectAt(it, dx, dy, 24);
      if (inBox(r)) it.cands.push({ dx, dy, d: 24, r, pts: leader(p, r, dx, dy), cost: 420 });
    }
    if (!it.cands.length) { const r = rectAt(it, 1, 0, LABEL_MIN); it.cands.push({ dx: 1, dy: 0, d: LABEL_MIN, r, pts: leader(p, r, 1, 0), cost: 4000 }); }
    it.cands.sort((x, y) => x.cost - y.cost);
    items.push(it);
  }

  // Two labels together: overlapping labels are out; crossing leaders and a leader through
  // another label cost a lot.
  const pair = (A, B) => {
    const r = A.r, q = B.r;
    if (r.x0 < q.x1 + 8 && r.x1 > q.x0 - 8 && r.y0 < q.y1 + 6 && r.y1 > q.y0 - 6) return 1e6;
    let c = 0;
    const sa = segs(A.pts), sb = segs(B.pts);
    for (const s of sa) for (const t of sb) if (cross(s[0], s[1], t[0], t[1])) c += 500;
    for (const s of sa) if (hitsRect(s, q)) c += 400;
    for (const t of sb) if (hitsRect(t, r)) c += 400;
    return c;
  };
  // Start from each label's own best, then move one label at a time to whichever of its spots
  // lowers the total, until nothing improves.
  const pick = items.map(() => 0);
  const total = (i, c) => items[i].cands[c].cost + items.reduce((s, it, j) => (j === i ? s : s + pair(items[i].cands[c], it.cands[pick[j]])), 0);
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    for (let i = 0; i < items.length; i++) {
      let best = pick[i], bestCost = total(i, pick[i]);
      for (let c = 0; c < items[i].cands.length; c++) { const t = total(i, c); if (t < bestCost - 1) { best = c; bestCost = t; } }
      if (best !== pick[i]) { pick[i] = best; changed = true; }
    }
    if (!changed) break;
  }
  items.forEach((it, i) => {
    const c = it.cands[pick[i]];
    Object.assign(it.L, { dx: c.dx, dy: c.dy, d: c.d, target: c.r, pts: c.pts, p: it.p, w: it.w, h: it.h });
  });
}

// ------------------------------------------------------------------ customize and settings panels
const thumb = (name) => `url('./thumbs/${name}.jpg')`;
// A swatch shows what it is: plain colours as dots; after a thin divider, the heavier woven
// cloths with a faint ripstop and the laminates with a faint scrim (dark in the "B" cloths).
// Dark swatches get a light ring. The row header names the swatch under the pointer.
const luma = (hex) => { const c = new THREE.Color(hex); return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; };
function swatch(zone, [id, name, hex, opacity]) {
  const kind = clothKind(id);
  const sail = SAIL_ZONES.includes(zone) && zone !== 'pockets';
  const cls = ['sw', opacity < 1 && 'clear', kind === 1 && 'cloth-mt', kind >= 2 && 'cloth-lam',
    /^uvpxb|^uvp2lxb|odl/.test(id) && 'fib-dark', kind >= 2 && opacity >= 1 && 'fib-grey', luma(hex) < 0.02 && 'dark'].filter(Boolean).join(' ');
  const label = sail && isUpgrade(id) ? `${name} · extra cost` : name;
  return `<button type="button" class="${cls}" data-zone="${zone}" data-colour="${id}" title="${esc(label)}" aria-label="${esc(label)}" style="--c:${hexOf([id, name, hex])};--o:${opacity}"><i></i></button>`;
}
function swatches(zone) {
  const all = fabricsFor(zone);
  const colours = all.filter((f) => clothKind(f[0]) === 0), cloths = all.filter((f) => clothKind(f[0]) > 0);
  return `<div class="swatches" role="radiogroup" aria-label="${esc(ZONES[zone].name)}">
    <button type="button" class="sw original" data-zone="${zone}" data-colour="" title="As built" aria-label="As built"><i></i></button>
    ${colours.map((f) => swatch(zone, f)).join('')}
    ${cloths.length ? `<span class="sw-gap" aria-hidden="true"></span>${cloths.map((f) => swatch(zone, f)).join('')}` : ''}
  </div>`;
}
function buildPanel() {
  $('#builds').innerHTML = catalog.models.map((m) => `
    <button type="button" class="build" data-model="${m.id}">
      <span class="art" style="background-image:${thumb(`model-${m.id}`)}"></span>
      <span class="build-text"><b>${esc(m.label)}</b><small>${esc(m.description.replace(/^\d+ parts · /, ''))}</small></span>
    </button>`).join('');
  const row = (z, name) => `<div class="row" data-row="${z}">
    <button type="button" class="row-head" data-toggle="${z}" aria-expanded="false"><span class="cur" data-cur="${z}"><i></i></span><span class="row-title">${name}</span><small data-name="${z}"></small><svg viewBox="0 0 24 24" class="chev" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>
    ${swatches(z)}</div>`;
  $('#sail-rows').innerHTML = SAIL_ZONES.map((z) => row(z, ZONES[z].name)).join('');
  $('#frame-row').innerHTML = row('frame', 'Tubes');
  $('#scene-fly').innerHTML = Object.entries(SCENES).map(([id, s]) =>
    `<button type="button" class="tile" data-scene="${id}" title="${s.label}"><span class="art" style="background-image:${thumb(`scene-${id}`)}"></span><span class="cap">${s.label}</span></button>`).join('');
}
/**
 * The pose bar, the part chip and the plan-view bar stay centred on the screen when a side
 * panel opens, and move left only as far as they must to clear it: the pose bar and the chip
 * clear the view controls beside the panel, the plan-view bar the panel itself.
 * Small screens lay these out in style.css.
 */
const narrow = matchMedia('(max-width: 760px)');
function placeBars() {
  const open = Boolean(state.panel) && !narrow.matches;
  const panel = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--panel')) || 340;
  const gap = 12, W = innerWidth;
  const bars = [['#posebar', W - (panel + 32) - 40], ['#chip', W - (panel + 32) - 40], ['#viewbar', W - 16 - panel]];
  for (const [sel, edge] of bars) {
    const el = $(sel);
    if (!el) continue;
    if (!open) { el.style.left = ''; continue; }
    const w = el.offsetWidth;
    el.style.left = `${Math.max(w / 2 + gap, Math.min(W / 2, edge - gap - w / 2))}px`;
  }
}
/** Each row header names the chosen fabric (or the swatch under the pointer) and any extra cost. */
function syncNames(hover = null) {
  for (const el of document.querySelectorAll('[data-name]')) {
    const z = el.dataset.name;
    if (hover && hover.dataset.zone === z) { el.textContent = hover.title; el.classList.add('peek'); continue; }
    const id = state.colours[z];
    const c = ORDER.colouredPanel;
    const cost = c.zones.includes(z) && id && id !== c.standard ? ` · +$${c.price}` : SAIL_ZONES.includes(z) && z !== 'pockets' && isUpgrade(id) ? ' · extra cost' : '';
    el.textContent = (id ? fabricOf(z, id)?.name || 'As built' : 'As built') + cost;
    el.classList.remove('peek');
  }
}

function syncPanel() {
  document.body.classList.toggle('panel-open', Boolean(state.panel));
  placeBars();
  for (const id of ['custom', 'settings']) {
    $(`#${id}`).hidden = state.panel !== id;
    $(`#btn-${id}`).setAttribute('aria-expanded', String(state.panel === id));
  }
  for (const b of document.querySelectorAll('.build')) b.classList.toggle('on', b.dataset.model === state.model);
  for (const b of document.querySelectorAll('.sw')) {
    const on = (state.colours[b.dataset.zone] || '') === b.dataset.colour;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  }
  for (const b of document.querySelectorAll('.sw[data-colour]:not(.original)')) {
    const f = fabricsFor(b.dataset.zone).find((c) => c[0] === b.dataset.colour);
    if (f) b.style.setProperty('--c', hexOf(f));
  }
  for (const b of document.querySelectorAll('[data-profile]')) {
    const on = b.dataset.profile === state.profile;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  }
  syncNames();
  if (record) for (const b of document.querySelectorAll('.sw.original')) {
    const t = record.tints[b.dataset.zone];
    const m = t?.meshes[0]?.userData.materials.base;
    const c = !m ? null : m.map ? new THREE.Color(.../\(blue\)/.test(m.name) ? BAKED.blue : /\(colour\)/.test(m.name) ? BAKED.red : BAKED.white) : m.userData.original;
    b.style.setProperty('--c', c ? `#${c.getHexString(THREE.SRGBColorSpace)}` : '#888');
  }
  syncLabelSwatches();
  if (record) for (const row of document.querySelectorAll('[data-row]')) row.hidden = !record.tints[row.dataset.row]?.meshes.length;
  syncRows();
  for (const b of document.querySelectorAll('[data-pose]')) b.setAttribute('aria-pressed', String(b.dataset.pose === state.pose));
  $('#vgctl').hidden = !record?.vg;
  $('#vg').value = state.vg;
  $('#vg-val').textContent = state.vg >= 1 ? 'tight' : state.vg <= 0 ? 'loose' : `${Math.round(state.vg * 100)} %`;
  $('#xray').value = state.seeThrough;
  $('#opt-wires').checked = state.wires;
  $('#opt-battens').checked = state.battens;
  $('#opt-names').checked = state.names;
  $('#opt-grid').checked = state.grid;
  $('#opt-grid').disabled = state.scene !== 'studio';
  for (const b of document.querySelectorAll('[data-backdrop]')) {
    const on = b.dataset.backdrop === state.backdrop;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
    b.disabled = state.scene !== 'studio';
  }
  $('#backdrop-hint').hidden = state.scene === 'studio';
  // Dark title text on a pale background; a dark custom shade keeps the light text.
  const sh = new THREE.Color(state.shade), pale = 0.2126 * sh.r + 0.7152 * sh.g + 0.0722 * sh.b > 0.35;
  document.body.classList.toggle('bg-light', state.scene === 'studio' && state.backdrop === 'light' && pale);
  $('#opt-shade').value = state.shade;
  $('#shade-reset').disabled = state.shade === LIGHT_SHADE;
  $('#shade-hint').textContent = state.scene === 'studio' && state.backdrop === 'light' ? 'The Light background' : 'Picks the Light studio background';
  $('#opt-outline').checked = state.outline;
  $('#opt-outline-w').value = state.outlineW;
  $('#outline-w-label').textContent = `${state.outlineW} px`;
  $('#opt-outline-c').value = state.outlineC;
  $('#opt-outline-wires').checked = state.outlineWires;
  $('#opt-outline-inner').checked = state.outlineInner;
  $('#opt-outline-sens').value = state.outlineSens;
  for (const id of ['#outline-w-row', '#outline-c-row', '#outline-wires-row', '#outline-inner-row']) $(id).hidden = !state.outline;
  $('#outline-sens-row').hidden = !state.outline || !state.outlineInner;
  $('#opt-shadows').checked = state.shadows;
  $('#opt-frost').checked = state.frost;
  $('#opt-spot').checked = state.spot;
  $('#opt-spot').disabled = state.scene !== 'studio';
  $('#spot-hint').textContent = state.scene === 'studio' ? 'Soft light under the glider' : 'In the studio';
  document.body.classList.toggle('nolabels', !state.names);
  $('#light').hidden = state.scene !== 'hill';
  $('#scene-art').style.backgroundImage = thumb(`scene-${state.scene}`);
  $('#scene-cap').textContent = SCENES[state.scene].label;
  for (const t of document.querySelectorAll('#scene-fly .tile')) t.classList.toggle('on', t.dataset.scene === state.scene);
  const src = catalog?.sources.get(state.model);
  if (src) {
    $('h1').textContent = src.glider;
    $('#subtitle').textContent = src.subtitle;
    document.title = document.title.replace(/^[^—]*—/, `${src.glider} —`);
    $('#download').href = src.glb;
    $('#download').download = src.download;
  }
  $('#btn-2d').classList.toggle('on', rig?.projection === 'orthographic');
  $('#btn-2d').textContent = rig?.projection === 'orthographic' ? '3D' : '2D';
  $('#btn-tour').classList.toggle('on', state.tour);
}

/** Opens one side panel (closing the other), or closes it if it is already open. */
function togglePanel(id) {
  state.panel = id && state.panel !== id ? id : null;
  syncPanel();
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
  $('#btn-custom').onclick = () => togglePanel('custom');
  $('#btn-settings').onclick = () => togglePanel('settings');
  for (const b of document.querySelectorAll('.btn-close')) b.onclick = () => togglePanel(null);
  $('#btn-tour').onclick = () => (state.tour ? stopTour() : startTour());
  $('#btn-compare').onclick = () => setCompare(!state.compare);
  wireSwipe();
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
    const head = e.target.closest('[data-toggle]');
    if (head) { ui.open = ui.open === head.dataset.toggle ? null : head.dataset.toggle; syncRows(); return; }
    const sw = e.target.closest('.swatches .sw');
    if (sw) {
      state.colours[sw.dataset.zone] = sw.dataset.colour || null;
      ui.open = null;   // the line closes again
      applyLook(); syncPanel(); saveUrlSoon();
    }
  });
  $('#settings').addEventListener('click', (e) => {
    const build = e.target.closest('.build');
    if (build && build.dataset.model !== state.model) setModel(build.dataset.model);
    const pr = e.target.closest('[data-profile]');
    if (pr && pr.dataset.profile !== state.profile) {
      state.profile = pr.dataset.profile;
      applyLook();
      syncPanel();
      saveUrlSoon();
    }
    const bd = e.target.closest('[data-backdrop]');
    if (bd && bd.dataset.backdrop !== state.backdrop) {
      state.backdrop = bd.dataset.backdrop;
      scenes.setBackdrop(state.backdrop);
      syncPanel();
      saveUrlSoon();
    }
  });
  $('#opt-grid').addEventListener('change', (e) => { state.grid = e.target.checked; scenes.setGrid(state.grid); saveUrlSoon(); });
  $('#opt-shadows').addEventListener('change', (e) => { state.shadows = e.target.checked; scenes.setShadows(state.shadows); saveUrlSoon(); });
  $('#opt-frost').addEventListener('change', (e) => { state.frost = e.target.checked; saveUrlSoon(); });
  // Experimental: the shade switches to the Light studio, so the change shows.
  const shade = (hex) => {
    state.shade = hex;
    setLightShade(hex);
    if (state.scene !== 'studio') setScene('studio');
    state.backdrop = 'light';
    scenes.setBackdrop('light');
    syncPanel(); saveUrlSoon();
  };
  $('#opt-shade').addEventListener('input', (e) => shade(e.target.value));
  $('#shade-reset').addEventListener('click', () => shade(LIGHT_SHADE));
  $('#opt-outline').addEventListener('change', (e) => { state.outline = e.target.checked; syncPanel(); saveUrlSoon(); });
  $('#opt-outline-w').addEventListener('input', (e) => { state.outlineW = Number(e.target.value); $('#outline-w-label').textContent = `${state.outlineW} px`; saveUrlSoon(); });
  $('#opt-outline-c').addEventListener('input', (e) => { state.outlineC = e.target.value; saveUrlSoon(); });
  $('#opt-outline-inner').addEventListener('change', (e) => { state.outlineInner = e.target.checked; syncPanel(); saveUrlSoon(); });
  $('#opt-outline-sens').addEventListener('input', (e) => { state.outlineSens = Number(e.target.value); saveUrlSoon(); });
  $('#opt-outline-wires').addEventListener('change', (e) => { state.outlineWires = e.target.checked; saveUrlSoon(); });
  $('#opt-spot').addEventListener('change', (e) => { state.spot = e.target.checked; scenes.setSpot(state.spot); saveUrlSoon(); });
  $('#xray').addEventListener('input', (e) => { state.seeThrough = Number(e.target.value); applyLook(); saveUrlSoon(); });
  $('#opt-wires').addEventListener('change', (e) => { state.wires = e.target.checked; applyLook(); saveUrlSoon(); });
  $('#opt-battens').addEventListener('change', (e) => { state.battens = e.target.checked; applyLook(); saveUrlSoon(); });
  $('#opt-names').addEventListener('change', (e) => { state.names = e.target.checked; syncPanel(); saveUrlSoon(); });
  $('#btn-reset').onclick = () => {
    state.colours = Object.fromEntries(Object.keys(ZONES).map((z) => [z, DEFAULTS.colours[z] ?? null]));
    state.seeThrough = DEFAULTS.seeThrough; state.wires = true; state.battens = true;
    applyLook(); syncPanel(); saveUrlSoon();
  };
  $('#custom').addEventListener('pointerover', (e) => { const b = e.target.closest('.swatches .sw'); if (b) syncNames(b); });
  $('#custom').addEventListener('pointerout', (e) => { if (e.target.closest('.swatches .sw')) syncNames(); });
  $('#custom').addEventListener('focusin', (e) => { const b = e.target.closest('.swatches .sw'); if (b) syncNames(b); });
  $('#custom').addEventListener('focusout', (e) => { if (e.target.closest('.swatches .sw')) syncNames(); });
  $('#btn-order').onclick = showOrder;
  // The inline picker: choosing a swatch keeps it open to try others; it closes on its button,
  // Esc, or a press anywhere else.
  $('#picker').addEventListener('click', (e) => {
    if (e.target.closest('.pk-close')) return closePicker();
    const sw = e.target.closest('.swatches .sw');
    if (sw) { state.colours[sw.dataset.zone] = sw.dataset.colour || null; applyLook(); syncPanel(); saveUrlSoon(); }
  });
  $('#picker').addEventListener('pointerover', (e) => { const b = e.target.closest('.swatches .sw'); if (b) syncNames(b); });
  $('#picker').addEventListener('pointerout', (e) => { if (e.target.closest('.swatches .sw')) syncNames(); });
  document.addEventListener('pointerdown', (e) => { if (ui.picker && !e.target.closest('#picker, .label')) closePicker(); }, true);
  $('#btn-share').onclick = async () => {
    saveUrl();
    try { await navigator.clipboard.writeText(location.href); toast('Link copied: it opens this glider just like this'); }
    catch { toast('Copy the address bar to share this glider'); }
  };
  $('#posebar').addEventListener('click', (e) => { const b = e.target.closest('[data-pose]'); if (b) setPose(b.dataset.pose); });
  $('#vg').addEventListener('input', (e) => {
    state.vg = Number(e.target.value);
    setVG(record, state.vg);
    setVG(other, state.vg);
    $('#vg-val').textContent = state.vg >= 1 ? 'tight' : state.vg <= 0 ? 'loose' : `${Math.round(state.vg * 100)} %`;
    saveUrlSoon();
  });
  $('#chip').addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') select(null);
    if (act === 'focus' && state.sel) focusPart(selRec().parts.get(state.sel));
  });
  let down = null;
  canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; userActive(); $('#scene-fly').hidden = true; });
  // A click on a part that can be coloured opens its choices in Customize. (The part card,
  // select() and renderChip(), stays for a parts view.)
  canvas.addEventListener('pointerup', (e) => {
    if (!down || e.button !== 0 || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5 || !record) return;
    const zone = pickZone(e);
    if (zone) showRow(zone, e.clientX, e.clientY);
  });
  canvas.addEventListener('wheel', userActive, { passive: true });
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    $('#loader').classList.remove('done');
    loaderText('The graphics stopped', 'Reload the page to bring the glider back.', 0, true);
    $('#ld-retry').onclick = () => location.reload();
  });
  document.addEventListener('keydown', (e) => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && e.target.type !== 'checkbox' && e.target.type !== 'range') return;
    if (numpadKey(e)) { e.preventDefault(); return; }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    userActive();
    const k = e.key.toLowerCase();
    if (e.key === 'Escape') { if (ui.picker) closePicker(); else if (!$('#scene-fly').hidden) $('#scene-fly').hidden = true; else if (state.sel) select(null); else document.body.classList.remove('nohud'); return; }
    if (k === 'c') togglePanel('custom');
    else if (k === 's') togglePanel('settings');
    else if (k === 't') toggle2d();
    else if (k === 'n') frontView();
    else if (k === 'f') (state.tour ? stopTour() : startTour());
    else if (k === 'v') setCompare(!state.compare);
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
// ?model=opus&scene=hill&p1=red-3125&p3=built&frame=black&xray=0.6&pose=bar&wires=0&battens=0&names=1&grid=1&colors=cal&bg=blueprint&shadows=0&spot=0&t=19.5&cam=...
function readCamera() { return parseCamera(params.get('cam')); }
function parseCamera(text) {
  const c = (text || '').split(',');
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
  for (const [z, id] of Object.entries(state.colours)) if (id !== (DEFAULTS.colours[z] ?? null)) q.set(z, id || 'built');
  if (Math.abs(state.seeThrough - DEFAULTS.seeThrough) > 0.001) q.set('xray', state.seeThrough.toFixed(2));
  if (!state.wires) q.set('wires', '0');
  if (!state.battens) q.set('battens', '0');
  if (state.pose !== DEFAULTS.pose) q.set('pose', state.pose);
  if (state.vg !== 1) q.set('vg', state.vg.toFixed(2));
  if (state.compare) { q.set('compare', '1'); if (Math.abs(state.split - 0.5) > 0.005) q.set('split', state.split.toFixed(3)); }
  if (state.names) q.set('names', '1');
  if (state.grid) q.set('grid', '1');
  if (state.profile === 'calibrated') q.set('colors', 'cal');
  if (state.frost !== !small) q.set('frost', state.frost ? '1' : '0');
  if (state.backdrop !== 'dark') q.set('bg', state.backdrop);
  if (!state.shadows) q.set('shadows', '0');
  if (!state.spot) q.set('spot', '0');
  if (state.shade !== LIGHT_SHADE) q.set('shade', state.shade.slice(1));
  if (state.outline) {
    q.set('ol', '1');
    if (state.outlineW !== 2) q.set('olw', String(state.outlineW));
    if (state.outlineC !== '#000000') q.set('olc', state.outlineC.slice(1));
    if (state.outlineWires) q.set('olwires', '1');
    if (!state.outlineInner) q.set('olin', '0');
    if (Math.abs(state.outlineSens - 0.5) > 0.001) q.set('olsens', state.outlineSens.toFixed(2));
  }
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
if (renderer) { boot(); wirePlan(); }               // boot makes the camera rig before its first wait
