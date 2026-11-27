/**
 * Sail designs (issue #48): the Wills Wing colour picker's designs for a glider (tools/sail_designs.py),
 * painted onto the 3D sail.
 *
 * Each design comes as maps in cloth coordinates, for the top and the bottom of the sail: s the share
 * of the half span (keel to tip) and t the share of the chord (leading to trailing edge). Every
 * vertex of the sail skins gets its own (s, t) here, measured from the skins' outline in the model.
 * Each zone has a signed distance field (its distance to its edge, one zone per channel), so the
 * shader draws every edge as a smooth line, antialiased per pixel at any zoom; a zone-number map
 * fills in where no zone's field reaches (under the leading-edge cloth). The leading-edge zone (P1) is the model's
 * own leading-edge cloth; bound edges and wire-exit patches keep a darker shade of the panel under them.
 */
import * as THREE from 'three';
import { clothKind, CLOTH, filmAlpha, frost } from './cloth.js';

// Also the names of a sail built with hgkit.sail (the U2): one top and one undersurface mesh over both wings,
// the leading-edge cloth the material of slot P1, pockets "Batten pocket R 5".
const SKIN = /^(Sail( [LR])?|(Upper sail|Undersurface) [LR]|Sail (top surface|undersurface))$/;
const isSail = (m) => /^Sail( [LR])?$/.test(m.userData.part?.name || '');
/** A skin that covers both wings in one mesh (its seams are read on the right wing). */
const bothWings = (m) => isSail(m) || /^Sail (top surface|undersurface)$/.test(m.userData.part?.name || '');
const isLowerMat = (m) => /lower panel|undersurface| P5$/i.test(m.userData.materials.base.name);
const isSharedMat = (m) => isSail(m) && (LE_CLOTH.test(m.userData.materials.base.name) || TRIM.test(m.userData.materials.base.name));
const isUpperMesh = (m) => (isSail(m) ? !isLowerMat(m) : /^(Upper|Sail top)/.test(m.userData.part.name));
const isLowerMesh = (m) => (isSail(m) ? isLowerMat(m) : /^(Undersurface|Sail undersurface)/.test(m.userData.part.name));
// Sewn on the skins: the panel laps and the batten pockets take the colour of the cloth under them.
const LAP = /^Upper panel lap [LR]$/;
const ZIP = /^Sail .*zipper( [LR])?$/;
const PATCH = /^Sail sprog patch [LR]$/;
const UNDER_TOP = (m) => /^(Sail (nose )?batten |Batten pocket |Nose batten pocket|(Inner|Outer) transverse batten pocket)/.test(m.userData.part?.name || '');   // pockets under the top skin
const POCKET = /^(Sail (nose batten|(lower |speed )?batten [\d-]+ [LR]) pocket|(Bottom batten|Batten) pocket [LR] \d+|Nose batten pocket|(Inner|Outer) transverse batten pocket [LR])$/;
const THREAD = /^Topstitch/;
const LE_CLOTH = /leading-edge cloth| P1$/;
const TRIM = /bound panel edge|reinforced wire exits/;
// The outline profile, the same as tools/sail_designs.py (smooth_profile): bins over the half span;
// the trailing edge runs straight between the batten tips (over the scallops), then both edges are smoothed,
// except towards the round tip.
const BINS = 512, ENVELOPE = 0.15, ENVELOPE_LE = 0.06, SMOOTH = 0.015, SMOOTH_TE = 0.05, TIP = 0.85, TIP_BLEND = 0.06;
/** The edge less its least-squares parabola over the bins. */
function residual(a) {
  const n = a.length, xs = Array.from({ length: n }, (_, i) => (i + 0.5) / n);
  const S = Array(5).fill(0), T = Array(3).fill(0);
  xs.forEach((x, i) => { for (let k = 0; k < 5; k++) S[k] += x ** k; for (let k = 0; k < 3; k++) T[k] += a[i] * x ** k; });
  const M = [[S[0], S[1], S[2]], [S[1], S[2], S[3]], [S[2], S[3], S[4]]];
  const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const d = det(M), c = [0, 1, 2].map((k) => det(M.map((row, i) => row.map((v, j) => (j === k ? T[i] : v)))) / d);
  return Float32Array.from(a, (v, i) => v - (c[0] + c[1] * xs[i] + c[2] * xs[i] ** 2));
}
/**
 * Straight lines through the points that stand out most (relative to a fitted parabola) within
 * `window` of span: over the trailing edge's scallops (upper), or through the leading edge's
 * foremost points (a mesh has no point at every bin). As tools/sail_designs.py (envelope).
 */
function envelope(a, window, upper) {
  const r = residual(a).map((v) => (upper ? v : -v)), half = Math.max(1, Math.round((window / 2) * BINS)), keep = [0];
  for (let i = 1; i < BINS - 1; i++) {
    let m = -Infinity;
    for (let j = Math.max(0, i - half); j <= Math.min(BINS - 1, i + half); j++) m = Math.max(m, r[j]);
    if (r[i] >= m) keep.push(i);
  }
  keep.push(BINS - 1);
  return Float32Array.from(a, (_, i) => {
    const k = keep.findIndex((p) => p >= i), hi = keep[k], lo = k <= 0 ? hi : keep[k - 1];
    return hi === lo ? a[hi] : a[lo] + ((a[hi] - a[lo]) * (i - lo)) / (hi - lo);
  });
}
/** Morphological closing (fills dips narrower than CLOSE bins) or, with open, opening (cuts peaks). */
function closing(a, open = false) {
  const roll = (x, f) => Float32Array.from(x, (_, i) => {
    let m = x[i];
    for (let j = Math.max(0, i - CLOSE); j <= Math.min(BINS - 1, i + CLOSE); j++) m = f(m, x[j]);
    return m;
  });
  return open ? roll(roll(a, Math.min), Math.max) : roll(roll(a, Math.max), Math.min);
}

function smoothProfile(le, te) {
  const blur = (a, sigma) => {
    const r = Math.ceil(3 * sigma * BINS), g = [];
    for (let k = -r; k <= r; k++) g.push(Math.exp(-0.5 * (k / (sigma * BINS)) ** 2));
    const gs = g.reduce((x, y) => x + y, 0);
    return Float32Array.from(a, (_, i) => g.reduce((acc, w, k) => acc + w * a[Math.min(BINS - 1, Math.max(0, i + k - r))], 0) / gs);
  };
  const env = envelope(te, ENVELOPE, true);
  const sl = blur(envelope(le, ENVELOPE_LE, false), SMOOTH), st = blur(env, SMOOTH_TE);
  // Towards the tip, the edges unsmoothed (the tip is round, and the design wraps round it): the
  // leading edge as it is (gaps between the mesh's points filled), the trailing edge still straight
  // between the batten tips, over the scallops.
  const tipLe = closing(le, true);
  for (let i = 0; i < BINS; i++) {
    const f = Math.min(1, Math.max(0, ((i + 0.5) / BINS - TIP) / TIP_BLEND));
    sl[i] = sl[i] * (1 - f) + tipLe[i] * f; st[i] = st[i] * (1 - f) + env[i] * f;
  }
  return [sl, st];
}

/** The undersurface's trailing edge: smoothed as the leading edge, plain towards the tip (as tools/sail_designs.py). */
function smoothUnder(a) {
  a = closing(a);   // a mesh has no point at the edge in every bin: fill the dips, keep the edge where it is
  const r = Math.ceil(3 * SMOOTH * BINS), g = [];
  for (let k = -r; k <= r; k++) g.push(Math.exp(-0.5 * (k / (SMOOTH * BINS)) ** 2));
  const gs = g.reduce((x, y) => x + y, 0);
  return Float32Array.from(a, (v, i) => {
    const b = g.reduce((acc, w, k) => acc + w * a[Math.min(BINS - 1, Math.max(0, i + k - r))], 0) / gs;
    const f = Math.min(1, Math.max(0, ((i + 0.5) / BINS - TIP) / TIP_BLEND));
    return b * (1 - f) + v * f;
  });
}

const STRAIGHT_FROM = 0.12;   // as tools/sail_designs.py STRAIGHT
const EDGE = 0.1;                                                                   // share of the chord texels up to the leading-edge panel's rear edge (tools/sail_designs.py)
const UNDER = 0.85, CLOSE = 6;                 // bottom maps: share of the chord texels up to the undersurface's trailing edge
const P1 = 15;                      // palette slot of the leading-edge colour
/** 1 while a skin is drawn to read back which zone lies under a pixel (zoneAt, anchors). */
const pick = { value: 0 };
const ZONES = 12;                   // at most: three distance-field images of four channels

/** The designs of a glider ("designs" in models.json: the folder with designs.json and the maps). */
export async function loadDesigns(dir) {
  const res = await fetch(`${dir}/designs.json`);
  if (!res.ok) throw new Error(`${dir}/designs.json: ${res.status}`);
  const data = await res.json();
  for (const d of data.designs) d.zoneIndex = Object.fromEntries(d.zones.map((z, i) => [z.id, i + 1]));
  return { dir, ...data, maps: new Map() };
}

function texture(designs, file, nearest) {
  if (!designs.maps.has(file)) {
    const tex = new THREE.TextureLoader().load(`${designs.dir}/${file}`);
    // Zone numbers never blend two; the distance fields blend smoothly between texels, and from far
    // off their mipmaps average the distance over the pixel: its share inside the zone, where a single
    // sample would be all in or all out (edges in dashes, thin stripes breaking up).
    tex.magFilter = nearest ? THREE.NearestFilter : THREE.LinearFilter;
    tex.minFilter = nearest ? THREE.NearestFilter : THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = !nearest;
    tex.anisotropy = nearest ? 1 : 8;
    tex.colorSpace = THREE.NoColorSpace;
    tex.flipY = true;
    designs.maps.set(file, tex);
  }
  return designs.maps.get(file);
}
/**
 * A fabric's colour as cloth: the picker's black is #000000, but black sailcloth still reflects a few
 * per cent, and without that its seams, pockets and shape could not show.
 */
const BLACKEST = 0.022;   // linear: black woven polyester in daylight
function clothColour(c, hex) {
  c.setStyle(hex);
  return asCloth(c);
}
/** The same for a colour already set (the nose cone's tint, main.js). */
export function asCloth(c) {
  c.r = Math.max(c.r, BLACKEST); c.g = Math.max(c.g, BLACKEST); c.b = Math.max(c.b, BLACKEST * 1.08);
  return c;
}
const blank = new THREE.DataTexture(new Uint8Array(4), 1, 1);   // a missing field: every zone outside
blank.needsUpdate = true;

/**
 * Plan position of every vertex of the sail skins (and the parts sewn on them) in the tight shape:
 * x over the half span (signed) and z, the chord (aft is +z). The fragment shader turns it into cloth
 * coordinates (s, t) per pixel, so the design follows the rendered surface exactly. Returns the
 * outline profile (leading and trailing edge per bin) as a float texture for that.
 */
function planCoords(skins, sewn, root) {
  const v = new THREE.Vector3(), toRoot = new THREE.Matrix4(), inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const pts = [...skins, ...sewn].map((mesh) => {
    toRoot.multiplyMatrices(inv, mesh.matrixWorld);
    const pos = mesh.geometry.attributes.position, out = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(toRoot);
      out[2 * i] = v.x; out[2 * i + 1] = v.z;
    }
    return out;
  });
  let half = 0;
  const outline = pts.slice(0, skins.length);
  for (const p of outline) for (let i = 0; i < p.length; i += 2) half = Math.max(half, Math.abs(p[i]));
  // The meshes' extent along the chord at each bin's centre, exactly: where their triangles' edges cross
  // that station (binning the vertices leaves the edge toothed, most of all at the tip, and a band of the
  // design drawn at a constant share of the chord would follow every tooth).
  const extent = (k0, k1, lo, hi) => {
    for (let k = k0; k < k1; k++) {
      const p = pts[k], idx = skins[k].geometry.index?.array;
      if (!idx) {
        for (let i = 0; i < p.length; i += 2) {
          const b = Math.min(BINS - 1, Math.floor((Math.abs(p[i]) / half) * BINS));
          lo[b] = Math.min(lo[b], p[i + 1]); hi[b] = Math.max(hi[b], p[i + 1]);
        }
        continue;
      }
      for (let t = 0; t + 2 < idx.length; t += 3) for (let e = 0; e < 3; e++) {
        const a = idx[t + e], c = idx[t + ((e + 1) % 3)];
        let xa = (Math.abs(p[2 * a]) / half) * BINS - 0.5, xc = (Math.abs(p[2 * c]) / half) * BINS - 0.5, za = p[2 * a + 1], zc = p[2 * c + 1];
        if (xa > xc) [xa, xc, za, zc] = [xc, xa, zc, za];
        for (let b = Math.max(0, Math.ceil(xa)); b <= Math.min(BINS - 1, Math.floor(xc)); b++) {
          const z = xc > xa ? za + ((zc - za) * (b - xa)) / (xc - xa) : za;
          lo[b] = Math.min(lo[b], z); hi[b] = Math.max(hi[b], z);
        }
      }
    }
  };
  let le = new Float32Array(BINS).fill(Infinity), te = new Float32Array(BINS).fill(-Infinity);
  extent(0, skins.length, le, te);
  // Empty bins (none on a fine mesh): between their neighbours.
  const full = [...Array(BINS).keys()].filter((b) => Number.isFinite(le[b]));
  for (let b = 0; b < BINS; b++) if (!Number.isFinite(le[b])) {
    const lo = full.filter((x) => x < b).pop() ?? full[0], hi = full.find((x) => x > b) ?? full[full.length - 1];
    const f = hi === lo ? 0 : (b - lo) / (hi - lo);
    le[b] = le[lo] + (le[hi] - le[lo]) * f; te[b] = te[lo] + (te[hi] - te[lo]) * f;
  }
  // The undersurface's trailing edge (bottom maps: tools/sail_designs.py, UNDER); past its tip, the
  // trailing edge. Empty bins inside its span: between their neighbours.
  const under = new Float32Array(BINS).fill(-Infinity);
  skins.forEach((mesh, k) => {
    if (isLowerMesh(mesh)) extent(k, k + 1, new Float32Array(BINS).fill(Infinity), under);
  });
  const inUnder = [...Array(BINS).keys()].filter((b) => Number.isFinite(under[b]));
  const last = inUnder[inUnder.length - 1] ?? -1;
  for (let b = 0; b < BINS; b++) if (!Number.isFinite(under[b])) {
    if (b > last) { under[b] = te[b]; continue; }
    const lo = inUnder.filter((x) => x < b).pop() ?? inUnder[0], hi = inUnder.find((x) => x > b);
    under[b] = under[lo] + ((under[hi] - under[lo]) * (b - lo)) / Math.max(1, hi - lo);
  }
  [le, te] = smoothProfile(le, te);
  // The undersurface's trailing edge as one straight line (it is straight on the sail, to within a
  // couple of centimetres): designs whose bands run straight along it to the tip (designs.json "straight").
  let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let b = 0; b <= last; b++) {
    const x = (b + 0.5) / BINS;
    if (x < 0.15 || x > 0.85) continue;
    sw++; sx += x; sy += under[b]; sxx += x * x; sxy += x * under[b];
  }
  const slope = sw > 1 ? (sw * sxy - sx * sy) / (sw * sxx - sx * sx) : 0, icpt = sw ? (sy - slope * sx) / sw : 0;
  const line = Float32Array.from({ length: BINS }, (_, b) => icpt + slope * (b + 0.5) / BINS);
  const un = smoothUnder(under);
  // The rear edge of the leading-edge panel on each skin: where its other cloth starts (the drawings'
  // leading-edge zone lands on the model's leading-edge cloth, round the tip too). Past the last of
  // that cloth: the trailing edge (top) or the undersurface's (bottom). As tools/sail_designs.py (front_edge).
  const front = (upper, rest) => {
    const lo = new Float32Array(BINS).fill(Infinity), hi = new Float32Array(BINS).fill(-Infinity);
    skins.forEach((mesh, k) => {
      if (isUpperMesh(mesh) === upper && !LE_CLOTH.test(mesh.userData.materials.base.name)) extent(k, k + 1, lo, hi);
    });
    const raw = Float32Array.from(lo, (v, b) => (Number.isFinite(v) ? v : rest[b]));
    const r = Math.ceil(3 * SMOOTH * BINS), g = [];
    for (let k = -r; k <= r; k++) g.push(Math.exp(-0.5 * (k / (SMOOTH * BINS)) ** 2));
    const gs = g.reduce((x, y) => x + y, 0);
    return Float32Array.from(raw, (v, i) => {
      const sm = g.reduce((acc, w, k) => acc + w * raw[Math.min(BINS - 1, Math.max(0, i + k - r))], 0) / gs;
      const f = Math.min(1, Math.max(0, ((i + 0.5) / BINS - 0.78) / TIP_BLEND));
      return Math.min(rest[i], Math.max(le[i], sm * (1 - f) + v * f));
    });
  };
  const unc = Float32Array.from(un, (v, b) => Math.min(te[b], Math.max(le[b], v)));
  const et = front(true, te), eb = front(false, unc);
  [...skins, ...sewn].forEach((mesh, k) => {
    const p = pts[k];
    for (let i = 0; i < p.length; i += 2) p[i] /= half;
    mesh.geometry.setAttribute('aSailPlan', new THREE.BufferAttribute(p, 2));
  });
  const data = new Float32Array(BINS * 4), data2 = new Float32Array(BINS * 4);
  for (let b = 0; b < BINS; b++) {
    data[4 * b] = le[b]; data[4 * b + 1] = te[b]; data[4 * b + 2] = unc[b]; data[4 * b + 3] = line[b];
    data2[4 * b] = et[b]; data2[4 * b + 1] = eb[b];
  }
  const [tex, tex2] = [data, data2].map((d) => {
    const t = new THREE.DataTexture(d, BINS, 1, THREE.RGBAFormat, THREE.FloatType);
    t.magFilter = t.minFilter = THREE.NearestFilter;
    t.needsUpdate = true;
    return t;
  });
  // Straight bands: their offsets from that line in metres, measured on the chord at STRAIGHT_FROM.
  const b0 = Math.round(STRAIGHT_FROM * BINS);
  return { profile: tex, profile2: tex2, half, le, te, un, et, eb, line, cref: line[b0] - le[b0], eref: Math.min(eb[b0], line[b0]) - le[b0] };
}

// ------------------------------------------------------------------ seams
// Where two zones meet, the panel sewn over the other laps it by LAP_W and is held by a zigzag
// stitch (as the Falcon's sail): drawn per pixel from a field over the plan (SEAM_NX x SEAM_NZ
// texels on the right wing), which holds for the nearest seam its direction T and two offsets, so
// that along it L = p.T + C and across it d = p.N - D (metres; d > 0 on the panel sewn over).
// Both are straight in p, so they interpolate between texels exactly along a straight seam.
const SEAM_NX = 1024, SEAM_NZ = 512, SEAM_BAND = 0.03;
// As the seams in the model's own detail map (sport3-opus s3/sail_detail.py): 1/2 in lap, zigzag 0.18 in wide.
const LAP_W = 0.0127, ZIG_PITCH = 0.0076, ZIG_AMP = 0.0023, THREAD_W = 0.0012, RELIEF = 0.00035;

/**
 * Plan position (x on the right wing, z) of cloth coordinates (s, t); `under`: the bottom maps' two-part
 * chord; `straight`: up to the undersurface's edge, metres from its straight line (as designST).
 */
function planOf(prof, s, t, kind, straight) {
  const under = kind > 0, bottom = kind === 1;
  const f = Math.min(BINS - 1, Math.max(0, s * BINS - 0.5)), i = Math.floor(f), j = Math.min(i + 1, BINS - 1), w = f - i;
  const lerp = (a) => a[i] + (a[j] - a[i]) * w;
  const le = lerp(prof.le), te = lerp(prof.te), un = Math.min(te, Math.max(le, lerp(prof.un)));
  const e = bottom ? lerp(prof.eb) : Math.min(lerp(prof.et), under ? un : te), top = under ? UNDER : 1;
  // Up to the leading-edge panel's rear edge e, then on to u (the trailing edge; the undersurface's on the bottom).
  const part = (a, ee, u) => (t <= EDGE ? a + (t / EDGE) * (ee - a) : ee + ((t - EDGE) / (top - EDGE)) * (u - ee));
  let z;
  if (!under) z = part(le, e, te);
  else if (bottom && straight && t <= UNDER) z = lerp(prof.line) - prof.cref + part(0, prof.eref, prof.cref);
  else if (t <= UNDER) z = part(le, e, un);
  else z = un + ((t - UNDER) / (1 - UNDER)) * (te - un);
  return [s * prof.half, z];
}

/** Drawing seams (tools/sail_designs.py, cloth coordinates) as plan polylines. */
function drawingLines(lines, prof, kind, toPattern, straight) {
  // Not in the centre strip (keel pocket): the drawing's zones meet there in bits of seams.
  const out = [];
  for (const line of lines) {
    let pts = [];
    for (let k = 0; k < line.st.length; k += 2) {
      if (line.st[k] < CENTRE) { if (pts.length > 1) out.push(pts); pts = []; continue; }
      const q = toPattern(...planOf(prof, line.st[k], line.st[k + 1], kind, straight));
      if (q) pts.push(q); else { if (pts.length > 1) out.push(pts); pts = []; }
    }
    if (pts.length > 1) out.push(pts);
  }
  // The pattern may be the plan's mirror image: keep the panel sewn over to the left.
  return toPattern.flip ? out.map((l) => l.reverse()) : out;
}
const CENTRE = 0.036;   // share of the half span

/**
 * Seams and hems the model has itself, on one skin (its parts on the right wing): where the
 * leading-edge cloth, the bound edges and the wire-exit patches meet the cloth (sewn over it), and
 * the skin's free edges (hemmed). Plan polylines, each with the side it is sewn on to its left.
 */
function meshLines(meshes, half, up = 0, smooth = 4) {
  const role = (m) => (LE_CLOTH.test(m.userData.materials.base.name) ? 1 : TRIM.test(m.userData.materials.base.name) ? 2 : 0);
  const pk = (q) => `${Math.round(q[0] * 1000)},${Math.round(q[1] * 1000)}`;   // ends meet within a millimetre
  // Each part's outline (right wing): its boundary edges chained into lines, each resampled every
  // 5 mm, with the part's cloth to the left.
  const prims = meshes.filter((m) => {
    if (bothWings(m)) return true;
    const a = m.geometry.attributes.aSailPlan;
    let sx = 0;
    for (let i = 0; i < a.count; i += 17) sx += a.getX(i);
    return sx > 0;
  }).map((m) => {
    const g = m.geometry, pos = g.attributes.position, plan = g.attributes.aSailPlan, pat = g.attributes.aSailUv;
    const keys = Array.from({ length: pos.count }, (_, i) => `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`);
    const P = (i) => [pat.getX(i), pat.getY(i), plan.getX(i) * half];   // pattern (metres), plan x
    const idx = g.index ? g.index.array : Array.from({ length: pos.count }, (_, i) => i);
    const filterSide = bothWings(m), filterUp = isSharedMat(m) && up !== 0;
    const count = new Map(), edges = [];
    for (let t = 0; t + 2 < idx.length; t += 3) {
      const i0 = idx[t], i1 = idx[t + 1], i2 = idx[t + 2];
      if (filterSide && plan.getX(i0) + plan.getX(i1) + plan.getX(i2) < 0) continue;
      if (filterUp) {
        const ax = pos.getX(i1) - pos.getX(i0), ay = pos.getY(i1) - pos.getY(i0), az = pos.getZ(i1) - pos.getZ(i0);
        const bx = pos.getX(i2) - pos.getX(i0), by = pos.getY(i2) - pos.getY(i0), bz = pos.getZ(i2) - pos.getZ(i0);
        const ny = az * bx - ax * bz;
        if (ny * up < 0) continue;
      }
      for (let e = 0; e < 3; e++) {
        const a = idx[t + e], b = idx[t + ((e + 1) % 3)], c = idx[t + ((e + 2) % 3)];
        const k = keys[a] < keys[b] ? `${keys[a]}|${keys[b]}` : `${keys[b]}|${keys[a]}`;
        count.set(k, (count.get(k) || 0) + 1);
        edges.push({ k, a, b, c });
      }
    }
    const boundary = edges.filter((e) => count.get(e.k) === 1).map((e) => {
      let A = P(e.a), B = P(e.b);
      const C = P(e.c);
      if (-(B[1] - A[1]) * (C[0] - A[0]) + (B[0] - A[0]) * (C[1] - A[1]) < 0) [A, B] = [B, A];   // cloth to the left
      return { A, B, ka: pk(A), kb: pk(B) };
    });
    return { role: role(m), lines: chain(boundary).map((l) => resample(l, 0.005)) };
  });
  // Every part's outline points, to find where two parts meet.
  const cell = 0.01, grid = new Map();
  prims.forEach((p, n) => p.lines.forEach((l, li) => l.forEach((q, i) => {
    const k = `${Math.floor(q[0] / cell)},${Math.floor(q[1] / cell)}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push({ n, q, li, i });
  })));
  // A split in the part's own mesh (its vertices doubled along a crease): another stretch of its own
  // outline within 3 mm. Not an edge of the cloth.
  const split = (n, li, i, q) => {
    const ci = Math.floor(q[0] / cell), cj = Math.floor(q[1] / cell);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const o of grid.get(`${ci + a},${cj + b}`) || []) {
      if (o.n === n && (o.li !== li || Math.abs(o.i - i) > 3) && Math.hypot(o.q[0] - q[0], o.q[1] - q[1]) < 0.003) return true;
    }
    return false;
  };
  const near = (n, q, bd = 0.008) => {   // the role of the nearest other part's outline within 8 mm (the parts were simplified apart)
    let best = -1;
    const ci = Math.floor(q[0] / cell), cj = Math.floor(q[1] / cell), R = Math.ceil(bd / cell);
    for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) for (const o of grid.get(`${ci + i},${cj + j}`) || []) {
      if (o.n === n) continue;
      const d = Math.hypot(o.q[0] - q[0], o.q[1] - q[1]);
      if (d < bd) { bd = d; best = prims[o.n].role; }
    }
    return best;
  };
  const out = [];
  prims.forEach((p, n) => p.lines.forEach((l, li) => {
    // Sewn over another part (a higher role over a lower), or a free edge (hemmed: cloth and
    // leading-edge cloth). Decided per point, then smoothed along the line, so it never flickers.
    const raw = l.map((q, i) => {
      if (q[2] < 0.01 || split(n, li, i, q)) return 0;  // the centre line (the other wing goes on), or a split
      const r = near(n, q);
      return (r < 0 ? p.role < 2 : p.role > r) ? 1 : 0;
    });
    const W = 6, keep = raw.map((_, i) => {
      let s = 0, c = 0;
      for (let j = Math.max(0, i - W); j <= Math.min(raw.length - 1, i + W); j++) { s += raw[j]; c++; }
      return s * 2 > c;
    });
    // The part on the other side (-1: none, a free edge), the most common one around each point.
    const other = l.map((q) => (q[2] < 0.01 ? -1 : near(n, q, 0.03)));
    const nb = other.map((_, i) => {
      const c = new Map();
      for (let j = Math.max(0, i - W); j <= Math.min(other.length - 1, i + W); j++) c.set(other[j], (c.get(other[j]) || 0) + 1);
      return [...c].sort((x, y) => y[1] - x[1])[0][0];
    });
    let run = [], side = null;
    const flush = () => {
      if (run.length >= 7) {
        // Between two parts the shader draws each part's colour up to this smooth line, not up to
        // the mesh's triangles (which step along it by a centimetre or two): code 1 + 3 x the role
        // to its left (this part) + the role to its right. A hem (free edge): 15. (The design's seams: 0.)
        const code = side >= 0 ? 1 + 3 * p.role + side : 15;
        const line = smoothLine(run, smooth).map((q) => [q[0], q[1]]);
        line.code = code;
        line.dev = Math.sqrt(run.reduce((a, q, i) => a + (q[0] - line[i][0]) ** 2 + (q[1] - line[i][1]) ** 2, 0) / run.length);
        line.role = p.role;
        out.push(line);
      }
      run = []; side = null;
    };
    l.forEach((q, i) => {
      if (!keep[i] || (side !== null && nb[i] !== side)) flush();
      if (keep[i]) { run.push(q); side = nb[i]; }
    });
    flush();
  }));
  return out;
}

/** Edges (A -> B, with keys ka, kb) chained end to end into polylines. */
function chain(edges) {
  const from = new Map();
  for (const e of edges) { if (!from.has(e.ka)) from.set(e.ka, []); from.get(e.ka).push(e); }
  const used = new Set(), out = [];
  const hasPrev = new Set(edges.map((e) => e.kb));
  for (const e0 of [...edges.filter((e) => !hasPrev.has(e.ka)), ...edges]) {
    if (used.has(e0)) continue;
    const pts = [e0.A];
    let e = e0;
    while (e && !used.has(e)) {
      used.add(e);
      pts.push(e.B);
      e = (from.get(e.kb) || []).find((x) => !used.has(x));
    }
    if (pts.length >= 2) out.push(pts);
  }
  return out;
}

/** A polyline resampled every `step`, ends kept. */
function resample(pts, step) {
  const out = [pts[0]];
  let carry = 0;
  for (let k = 0; k + 1 < pts.length; k++) {
    const [ax, az] = pts[k], [bx, bz] = pts[k + 1], len = Math.hypot(bx - ax, bz - az);
    let t = step - carry;
    while (t <= len) { const f = t / len; out.push(pts[k].map((c, n) => c + (pts[k + 1][n] - c) * f)); t += step; }
    carry = len - (t - step);
  }
  if (Math.hypot(out.at(-1)[0] - pts.at(-1)[0], out.at(-1)[1] - pts.at(-1)[1]) > 1e-4) out.push(pts.at(-1));
  return out;
}

/** A seam from a mesh edge: smoothed over a few centimetres (the mesh's edges zigzag a little), ends kept. */
function smoothLine(out, radius = 4) {
  if (out.length < 3) return out;
  return out.map((q, i) => {
    const r = Math.min(radius, i, out.length - 1 - i);
    const sum = q.map(() => 0);
    for (let j = i - r; j <= i + r; j++) out[j].forEach((c, n) => { sum[n] += c; });
    return sum.map((c) => c / (2 * r + 1));
  });
}

/**
 * Seam fields over the plan (see SEAM_NX): per texel the nearest seam and the nearest other one
 * (seams run close together: a hem and the seam next to it), each as its angle (+ 8 x its number),
 * C, D and length (negative: a loop).
 */
function seamField(lines) {
  let xmin = Infinity, xmax = -Infinity, zmin = Infinity, zmax = -Infinity;
  for (const l of lines) for (const [x, z] of l) { xmin = Math.min(xmin, x); xmax = Math.max(xmax, x); zmin = Math.min(zmin, z); zmax = Math.max(zmax, z); }
  if (!Number.isFinite(xmin)) return null;
  xmin -= 0.05; zmin -= 0.05; xmax += 0.05; zmax += 0.05;
  const n2 = SEAM_NX * SEAM_NZ, data = [new Float32Array(n2 * 4), new Float32Array(n2 * 4)];
  const best = [new Float32Array(n2).fill(Infinity), new Float32Array(n2).fill(Infinity)], who = [new Int32Array(n2).fill(-1), new Int32Array(n2).fill(-1)];
  const dx = (xmax - xmin) / SEAM_NX, dz = (zmax - zmin) / SEAM_NZ;
  lines.forEach((pts, id) => {
    let total = 0;
    for (let k = 0; k + 1 < pts.length; k++) total += Math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]);
    if (total < 0.04) return;                       // scraps of the drawing's outlines, not seams
    const closed = Math.hypot(pts[0][0] - pts.at(-1)[0], pts[0][1] - pts.at(-1)[1]) < 0.002;
    const end = closed ? -total : total;            // a loop has no ends
    let L0 = 0;
    for (let k = 0; k + 1 < pts.length; k++) {
      const [ax, az] = pts[k], [bx, bz] = pts[k + 1], len = Math.hypot(bx - ax, bz - az);
      if (len < 1e-6) continue;
      const tx = (bx - ax) / len, tz = (bz - az) / len, nx = -tz, nz = tx;
      const v = [Math.atan2(tz, tx) + 8 * (16 * id + (pts.code || 0)), L0 - (ax * tx + az * tz), ax * nx + az * nz, end];
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - SEAM_BAND - xmin) / dx)), i1 = Math.min(SEAM_NX - 1, Math.ceil((Math.max(ax, bx) + SEAM_BAND - xmin) / dx));
      const j0 = Math.max(0, Math.floor((Math.min(az, bz) - SEAM_BAND - zmin) / dz)), j1 = Math.min(SEAM_NZ - 1, Math.ceil((Math.max(az, bz) + SEAM_BAND - zmin) / dz));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const px = xmin + (i + 0.5) * dx, pz = zmin + (j + 0.5) * dz;
        const h = Math.min(len, Math.max(0, (px - ax) * tx + (pz - az) * tz));
        const dist = Math.hypot(px - ax - h * tx, pz - az - h * tz), n = j * SEAM_NX + i;
        if (dist > SEAM_BAND) continue;
        if (who[0][n] === id) {                     // this seam again: keep its nearest segment
          if (dist < best[0][n]) { best[0][n] = dist; data[0].set(v, 4 * n); }
        } else if (dist < best[0][n]) {             // a new nearest: the old one becomes the other
          best[1][n] = best[0][n]; who[1][n] = who[0][n]; data[1].set(data[0].subarray(4 * n, 4 * n + 4), 4 * n);
          best[0][n] = dist; who[0][n] = id; data[0].set(v, 4 * n);
        } else if (dist < best[1][n]) {
          best[1][n] = dist; who[1][n] = id; data[1].set(v, 4 * n);
        }
      }
      L0 += len;
    }
  });
  const tex = data.map((d) => {
    const t = new THREE.DataTexture(d, SEAM_NX, SEAM_NZ, THREE.RGBAFormat, THREE.FloatType);
    t.magFilter = t.minFilter = THREE.NearestFilter;   // filtered in the shader (float textures need not filter)
    t.needsUpdate = true;
    return t;
  });
  return { tex, box: new THREE.Vector4(xmin, zmin, xmax - xmin, zmax - zmin) };
}
const noSeams = new THREE.DataTexture(new Float32Array(4), 1, 1, THREE.RGBAFormat, THREE.FloatType);
noSeams.needsUpdate = true;

const SEAM_GLSL = /* glsl */ `
  // The nearest seam here: (L along it, d across it, 1 if there is one). Each of the four texels
  // around gives L and d for its own seam; the nearest seam wins, blended only with the texels on
  // the same seam (so no seam bleeds into another where their bands meet).
  // The two nearest seams here, each (L along it, d across it, 1 if there is one), from the eight
  // texels around in the two fields; each seam's L and d blended over the texels that hold it.
  void designSeams(sampler2D f0, sampler2D f1, vec4 box, vec2 p, out vec3 s0, out vec3 s1) {
    vec2 g = (p - box.xy) / box.zw * vec2(${SEAM_NX}.0, ${SEAM_NZ}.0) - 0.5;
    ivec2 i0 = ivec2(floor(g)); vec2 w = g - floor(g);
    vec2 ld[8]; float wk[8], id[8];
    for (int k = 0; k < 8; k++) {
      ivec2 o = ivec2(k & 1, (k >> 1) & 1), q = clamp(i0 + o, ivec2(0), ivec2(${SEAM_NX - 1}, ${SEAM_NZ - 1}));
      vec4 v = k < 4 ? texelFetch(f0, q, 0) : texelFetch(f1, q, 0);
      float n = floor(v.x / 8.0 + 0.5), a = v.x - 8.0 * n;
      vec2 t = vec2(cos(a), sin(a));
      ld[k] = vec2(dot(p, t) + v.y, dot(p, vec2(-t.y, t.x)) - v.z);
      // Empty, or past the end of its seam (a loop, v.w < 0, has none).
      bool ok = v.w != 0.0 && (v.w < 0.0 || (ld[k].x >= 0.0 && ld[k].x <= v.w));
      wk[k] = ok ? (o.x == 1 ? w.x : 1.0 - w.x) * (o.y == 1 ? w.y : 1.0 - w.y) : 0.0;
      id[k] = ok ? n : -1.0;
    }
    float a = -1.0, b = -1.0, da = 1e9, db = 1e9;
    for (int k = 0; k < 8; k++) if (id[k] >= 0.0 && abs(ld[k].y) < da) { da = abs(ld[k].y); a = id[k]; }
    for (int k = 0; k < 8; k++) if (id[k] >= 0.0 && id[k] != a && abs(ld[k].y) < db) { db = abs(ld[k].y); b = id[k]; }
    vec3 acc0 = vec3(0.0), acc1 = vec3(0.0);
    for (int k = 0; k < 8; k++) {
      if (id[k] == a && a >= 0.0) acc0 += vec3(wk[k] * ld[k], wk[k]);
      else if (id[k] == b && b >= 0.0) acc1 += vec3(wk[k] * ld[k], wk[k]);
    }
    // z: 1 + the seam's code (meshLines: which parts it parts), 0 none.
    s0 = acc0.z > 0.0 ? vec3(acc0.xy / acc0.z, 1.0 + mod(a, 16.0)) : vec3(0.0);
    s1 = acc1.z > 0.0 ? vec3(acc1.xy / acc1.z, 1.0 + mod(b, 16.0)) : vec3(0.0);
  }
  // A seam on the cloth colour c: the panel sewn over laps it by ${LAP_W} m (two layers, a shade
  // darker), its edge shows as a fine shadow and the edge under it faintly, and a zigzag stitch
  // runs along the middle of the lap. Fades to its average where it gets smaller than a pixel.
  vec3 designStitch(vec3 c, vec3 sm, inout vec2 grad) {
    // Pixel widths, clamped: where the field ends (or another seam takes over) d and L jump between
    // neighbouring pixels, and an unclamped width there would draw a hairline along the jump.
    float d = sm.y, fd = clamp(fwidth(d), 1e-5, 0.002), fph = min(fwidth(sm.x / ${ZIG_PITCH}), 0.5);
    float lap = smoothstep(-fd, fd, d) * (1.0 - smoothstep(${LAP_W} - fd, ${LAP_W} + fd, d));
    float edge = 1.0 - smoothstep(0.0, 0.0005 + fd, abs(d));
    float hid = 1.0 - smoothstep(0.0, 0.0007 + fd, abs(d - ${LAP_W}));
    float ph = sm.x / ${ZIG_PITCH}, slope = ${(4 * ZIG_AMP / ZIG_PITCH).toFixed(4)};
    float o = ${LAP_W / 2} + ${ZIG_AMP} * (abs(fract(ph) - 0.5) * 4.0 - 1.0);
    float dist = abs(d - o) / sqrt(1.0 + slope * slope), fz = max(fph * ${ZIG_PITCH}, fd);
    float thread = 1.0 - smoothstep(${THREAD_W / 2} - fz, ${THREAD_W / 2} + fz, dist);
    float avg = ${Math.min(1, (THREAD_W * Math.sqrt(1 + (4 * ZIG_AMP / ZIG_PITCH) ** 2)) / (2 * ZIG_AMP)).toFixed(4)}
      * (1.0 - smoothstep(${ZIG_AMP} - fz, ${ZIG_AMP} + fz, abs(d - ${LAP_W / 2})));
    // Too small to draw (along the seam, or across it seen at a slant): its average.
    thread = mix(thread, avg, max(smoothstep(0.15, 0.4, fph), smoothstep(0.15, 0.5, fd / ${ZIG_AMP})));
    // Two layers are a shade darker and stand a cloth's thickness proud, the thread a little more. The
    // normal takes the slope of that relief (grad: height per pixel, in units of RELIEF), worked out
    // from the seam's own distances, not from the drawn shades: their edges are pixel-sharp, and a slope
    // taken from them bends the normal right over (a white glint along every edge, in dashes from far
    // off). The steps are soft, half a millimetre wide, and each fades out as it gets smaller than a pixel.
    float wl = max(fd, 0.0006), wt = max(fz, 0.0005);
    vec2 gd = clamp(vec2(dFdx(d), dFdy(d)), -0.002, 0.002), gt = clamp(vec2(dFdx(dist), dFdy(dist)), -0.002, 0.002);
    float xa = clamp((d + wl) / (2.0 * wl), 0.0, 1.0), xb = clamp((d - ${LAP_W} + wl) / (2.0 * wl), 0.0, 1.0);
    float xt = clamp((dist - ${THREAD_W / 2} + wt) / (2.0 * wt), 0.0, 1.0);
    grad += 0.6 * 6.0 * (xa * (1.0 - xa) - xb * (1.0 - xb)) / (2.0 * wl) * (1.0 - smoothstep(0.1, 0.3, fd / ${LAP_W})) * gd
      - 0.8 * 6.0 * xt * (1.0 - xt) / (2.0 * wt) * (1.0 - smoothstep(0.25, 0.8, max(fd, fph * ${ZIG_PITCH}) / ${THREAD_W})) * gt;
    // Shades as the model's detail map (sport3-opus s3/sail_detail.py): a second layer 30 % darker, thread 35 %.
    c *= 1.0 - 0.30 * lap - 0.25 * edge * (1.0 - lap * 0.5) - 0.1 * hid;
    return c * (1.0 - 0.35 * thread);
  }`;

// One side's design in the shader: its maps and its palette (colour, film alpha, laminate fibres per zone).
const SIDE_GLSL = (n) => `uniform sampler2D uDesignMap${n}, uDesignSdf0${n}, uDesignSdf1${n}, uDesignSdf2${n}, uSeam${n}, uSeam2${n};
  uniform vec4 uSeamBox${n};
  uniform vec3 uDesignPal${n}[16]; uniform vec4 uDesignFilm${n}[16];`;
// The design's colour here (rgb) and how much the film lets through (a: 1 opaque); lam: the share
// of laminate, fib: its fibre colour, rip: the share of ripstop cloth (205MT, 240MT).
const DESIGN_FN = (n) => `
        vec4 designColour${n}(vec2 uv, out float lam, out vec3 fib, out float rip) {
          vec4 f0 = texture2D(uDesignSdf0${n}, uv), f1 = texture2D(uDesignSdf1${n}, uv), f2 = texture2D(uDesignSdf2${n}, uv);
          float e[${ZONES}] = float[${ZONES}](f0.r, f0.g, f0.b, f0.a, f1.r, f1.g, f1.b, f1.a, f2.r, f2.g, f2.b, f2.a);
          vec4 acc = vec4(0.0); vec4 film = vec4(0.0); float sum = 0.0, rsum = 0.0;
          for (int k = 0; k < ${ZONES}; k++) {
            float w = designCover(e[k]);
            acc += w * vec4(uDesignPal${n}[k + 1], uDesignFilm${n}[k + 1].x);
            film += w * uDesignFilm${n}[k + 1].y * vec4(vec3(uDesignFilm${n}[k + 1].z), 1.0);
            rsum += w * uDesignFilm${n}[k + 1].w;
            sum += w;
          }
          int k = clamp(int(floor(texture2D(uDesignMap${n}, uv).r * 255.0 + 0.5)), 0, 15);
          vec4 fill = vec4(uDesignPal${n}[k], uDesignFilm${n}[k].x);
          vec4 ffill = uDesignFilm${n}[k].y * vec4(vec3(uDesignFilm${n}[k].z), 1.0);
          vec4 c = sum > 0.0 ? acc / sum : fill; vec4 g = sum > 0.0 ? film / sum : ffill;
          if (sum > 0.0 && sum < 1.0) { c = mix(fill, c, sum); g = mix(ffill, g, sum); }
          lam = g.a; fib = lam > 0.0 ? g.rgb / max(lam, 1e-3) : vec3(0.0);
          rip = sum > 0.0 ? mix(uDesignFilm${n}[k].w, rsum / sum, min(sum, 1.0)) : uDesignFilm${n}[k].w;
          return c;
        }`;
const sideUniforms = (s, u, n) => {
  s.uniforms[`uDesignMap${n}`] = u.map; s.uniforms[`uDesignPal${n}`] = u.pal; s.uniforms[`uDesignFilm${n}`] = u.film;
  u.sdf.forEach((t, i) => { s.uniforms[`uDesignSdf${i}${n}`] = t; });
};
const seamUniforms = (s, u, n) => { s.uniforms[`uSeam${n}`] = u.seam; s.uniforms[`uSeam2${n}`] = u.seam2; s.uniforms[`uSeamBox${n}`] = u.seamBox; };

/**
 * role: 0 cloth, 1 leading-edge cloth (P1), 2 bound edges and wire exits (darker), 3 thread and laps, 4 pocket tape,
 * 5 thread on the leading-edge cloth.
 * u: this side's design; back: the design seen from behind (the top skin from below shows the
 * bottom drawing, as the picker draws it: past the undersurface, that is the top skin).
 */
function patch(material, u, role, back = u, seamsBack = back, canFrost = false, seamsFront = u) {
  const prev = material.onBeforeCompile;
  const own = material.userData.designOwn = { value: 0 };   // a panel of the model that is a zone of the design (set())
  material.onBeforeCompile = (s, r) => {
    prev?.call(material, s, r);
    if (canFrost) Object.assign(s.uniforms, frost);
    sideUniforms(s, u, 'F'); sideUniforms(s, back, 'B');
    seamUniforms(s, seamsFront, 'F'); seamUniforms(s, seamsBack, 'B');
    s.uniforms.uDesignPick = pick;
    s.uniforms.uDesignOn = u.on; s.uniforms.uDesignBand = u.band; s.uniforms.uDesignProfile = u.profile;
    s.uniforms.uDesignProfile2 = u.profile2; s.uniforms.uDesignEref = u.eref;
    s.uniforms.uDesignHalf = u.half; s.uniforms.uDesignRole = { value: role };
    s.uniforms.uDesignOwn = own;
    s.uniforms.uDesignUnderF = u.kind; s.uniforms.uDesignUnderB = back.kind;
    s.uniforms.uDesignStraight = u.straight; s.uniforms.uDesignCref = u.cref;
    s.uniforms.uDesignBaked = { value: material.map && material.normalMap ? 1 : 0 };   // seams and hems in the model's detail map
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aSailPlan, aSailUv; varying vec2 vSailPlan, vSailUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSailPlan = aSailPlan; vSailUv = aSailUv;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uDesignPick;
        uniform float uDesignOn, uDesignRole, uDesignOwn, uDesignBand, uDesignHalf, uDesignUnderF, uDesignUnderB, uDesignStraight, uDesignCref, uDesignEref, uDesignBaked;
        uniform sampler2D uDesignProfile, uDesignProfile2;
        ${SIDE_GLSL('F')}
        ${SIDE_GLSL('B')}
        varying vec2 vSailPlan, vSailUv;
        ${canFrost ? 'uniform float uFrostOn; uniform sampler2D uFrostColor; uniform vec2 uFrostSize; uniform float uFrostPass;' : ''}
        // Cloth coordinates of this pixel: share of the half span, and of the chord between the
        // (smoothed) leading and trailing edge there.
        // kind: 1 the bottom maps, 2 the top maps of a design whose trailing-edge panel starts at the seam
        // where the undersurface is sewn on (both measure up to that seam, then past it), 0 other top maps.
        vec2 designST(float kind) {
          bool under = kind > 0.5, bottom = kind > 0.5 && kind < 1.5;
          float s = abs(vSailPlan.x), f = clamp(s * ${BINS}.0 - 0.5, 0.0, ${BINS - 1}.0);
          int i = int(floor(f)), j = min(i + 1, ${BINS - 1});
          vec4 p = mix(texelFetch(uDesignProfile, ivec2(i, 0), 0), texelFetch(uDesignProfile, ivec2(j, 0), 0), f - float(i));
          vec4 p2 = mix(texelFetch(uDesignProfile2, ivec2(i, 0), 0), texelFetch(uDesignProfile2, ivec2(j, 0), 0), f - float(i));
          // The chord in parts: to the leading-edge panel's rear edge e (${EDGE}), then on to the trailing
          // edge, or on the bottom maps to the undersurface's (${UNDER}) and from there to the trailing edge.
          float z = vSailPlan.y, t, e = bottom ? p2.y : min(p2.x, under ? p.z : p.y);
          if (!under) t = z <= e ? ${EDGE} * (z - p.x) / max(e - p.x, 1e-6) : ${EDGE} + ${(1 - EDGE).toFixed(2)} * (z - e) / max(p.y - e, 1e-6);
          else if (bottom && uDesignStraight > 0.5) {
            // Bands straight along the undersurface's edge: metres from its straight line, as the parts
            // of the reference chord. The undersurface itself never shows what lies past its edge: its
            // band runs to its hem.
            float zr = uDesignCref - (p.w - z);
            t = z > p.w ? ${UNDER} + ${(1 - UNDER).toFixed(2)} * (z - p.w) / max(p.y - p.w, 1e-3)
              : zr <= uDesignEref ? ${EDGE} * zr / max(uDesignEref, 1e-6)
              : ${EDGE} + ${(UNDER - EDGE).toFixed(2)} * (zr - uDesignEref) / max(uDesignCref - uDesignEref, 1e-6);
            if (uDesignUnderF > 0.5 && uDesignUnderF < 1.5) t = min(t, ${UNDER} - 0.001);
          }
          else if (z <= e) t = ${EDGE} * (z - p.x) / max(e - p.x, 1e-6);
          else if (z <= p.z) t = ${EDGE} + ${(UNDER - EDGE).toFixed(2)} * (z - e) / max(p.z - e, 1e-6);
          else t = ${UNDER} + ${(1 - UNDER).toFixed(2)} * (z - p.z) / max(p.y - p.z, 1e-6);
          return vec2(min(s, 1.0), clamp(t, 0.0, 1.0));
        }
        // Zone k's share of this pixel: its signed distance to its edge (texels), over the pixel's width.
        float designCover(float e) {
          float d = (e - 0.5) * 2.0 * uDesignBand;
          return clamp(0.5 + d / clamp(fwidth(d), 1e-4, 0.8), 0.0, 1.0);
        }
        // Laminate fibres (as lib/cloth.js, PX): square scrim every 6 mm, X-ply at +-30 degrees every
        // 20 mm, tows 0.7 mm; on the plan, in metres. Fade to their average when under a pixel.
        float designLine(float x, float w) {
          float fw = fwidth(x), d = abs(fract(x + 0.5) - 0.5);
          return mix(1.0 - smoothstep(0.5 * w - fw, 0.5 * w + fw, d), w, smoothstep(0.08, 0.35, fw));
        }
        float designRun(vec2 p, float a, float s, float w) { return designLine(dot(p, vec2(-sin(a), cos(a))) / s, w / s); }
        float designFibres(vec2 p) {
          return max(max(designRun(p, 0.0, 0.006, 0.0007), designRun(p, 1.5708, 0.006, 0.0007)),
                     max(designRun(p, 1.0472, 0.02, 0.0008), designRun(p, 2.0944, 0.02, 0.0008)));
        }
        // Ripstop (as lib/cloth.js, 205MT and 240MT): pairs of heavier threads 1 mm apart in 7 mm diamonds.
        // Relief in metres: the ripstop's threads, and the weave [EST: a hot-pressed cloth is nearly flat].
        #define WEAVE_RIB 0.0003
        #define WEAVE_H 0.00008
        float designRipstop(vec2 p) {
          float rib = 0.0;
          for (int k = 0; k < 2; k++) {
            vec2 q = p + float(k) * vec2(0.0, 0.001);
            rib = max(rib, max(designRun(q, 0.61, 0.007, 0.0005), designRun(q, -0.61, 0.007, 0.0005)));
          }
          return rib;
        }
        // Woven polyester: fine plain weave up very close (0.4 x 0.25 mm) plus subtle calendered
        // fabric grain (2.2 mm cross-weave) that reads cleanly at normal close-up distances.
        float designWeave(vec2 p) {
          vec2 q = p / vec2(0.0004, 0.00025), fw = fwidth(q);
          float keep = 1.0 - smoothstep(0.2, 0.55, max(fw.x, fw.y));
          vec2 c = cos(3.14159265 * fract(q * 0.5) * 2.0), t = cos(6.2831853 * fract(q));
          float fine = keep * mix(t.y, t.x, 0.5 + 0.5 * c.x * c.y);
          vec2 q2 = p / vec2(0.0022, 0.0018), fw2 = fwidth(q2);
          float keep2 = 1.0 - smoothstep(0.25, 0.7, max(fw2.x, fw2.y));
          vec2 c2 = cos(3.14159265 * fract(q2 * 0.5) * 2.0), t2 = cos(6.2831853 * fract(q2));
          float grain = keep2 * mix(t2.y, t2.x, 0.5 + 0.5 * c2.x * c2.y);
          return fine * 0.65 + grain * 0.55;
        }
        ${DESIGN_FN('F')}
        ${DESIGN_FN('B')}
        ${SEAM_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float designLam = 0.0, designA = 1.0, designRip = 0.0, designRib = 0.0, designRelief = 0.0;
        vec2 designGrad = vec2(0.0);
        vec3 designTint = vec3(1.0);
        if (uDesignOn > 0.5 || uDesignPick > 0.5) {   // (the zone under a pixel is read as built too)
          vec3 fib = vec3(0.0);
          vec4 dc;
          bool front = gl_FrontFacing;
          vec2 st = designST(front ? uDesignUnderF : uDesignUnderB), uv = vec2(st.x, 1.0 - st.y);
          if (front) dc = designColourF(uv, designLam, fib, designRip); else dc = designColourB(uv, designLam, fib, designRip);
          if (uDesignOwn > 0.5) {
            // A panel the model has itself (its own material, sewn on its own seam) that is a zone of the
            // design: all of it in that zone's cloth. The picker's drawing has the seam a few centimetres off.
            int ko = int(uDesignOwn + 0.5);
            vec4 fo = front ? uDesignFilmF[ko] : uDesignFilmB[ko];
            dc = vec4(front ? uDesignPalF[ko] : uDesignPalB[ko], fo.x);
            designLam = fo.y; fib = vec3(fo.z); designRip = fo.w;
          }
          vec3 s0 = vec3(0.0), s1 = vec3(0.0);
          vec2 pm = vSailUv;                                                     // the cloth laid flat (metres)
          if (uDesignRole < 0.5 || (uDesignRole > 1.5 && uDesignRole < 2.5) || (uDesignRole > 3.5 && uDesignRole < 4.5)) {   // body cloth, trim and pockets (welded LE cloth stays pure P1)
            if (front) designSeams(uSeamF, uSeam2F, uSeamBoxF, pm, s0, s1); else designSeams(uSeamB, uSeam2B, uSeamBoxB, pm, s0, s1);
          }
          // The leading-edge cloth (P1) and the bound edges: their parts, but near an edge between two
          // parts the smooth seam line decides which is where (the mesh's own edges step along its triangles).
          float le = (uDesignRole > 0.5 && uDesignRole < 1.5) || uDesignRole > 4.5 ? 1.0 : 0.0;
          float trim = uDesignRole > 1.5 && uDesignRole < 2.5 ? 1.0 : 0.0, onLe = 0.0;
          if (uDesignRole < 0.5 || (uDesignRole > 1.5 && uDesignRole < 2.5) || (uDesignRole > 3.5 && uDesignRole < 4.5)) {   // body cloth, trim and pockets (welded LE cloth stays pure P1)
            // A line between two parts decides only for a pixel of one of those parts (pockets: any).
            float own = uDesignRole;
            bool pocket = uDesignRole > 3.5;
            float c0 = s0.z - 2.0, l0 = floor(c0 / 3.0 + 0.01), r0 = c0 - 3.0 * l0;
            float c1 = s1.z - 2.0, l1 = floor(c1 / 3.0 + 0.01), r1 = c1 - 3.0 * l1;
            bool ok0 = s0.z > 1.5 && s0.z < 15.5 && (pocket || abs(l0 - own) < 0.5 || abs(r0 - own) < 0.5);
            bool ok1 = s1.z > 1.5 && s1.z < 15.5 && (pocket || abs(l1 - own) < 0.5 || abs(r1 - own) < 0.5);
            vec3 e = ok0 ? s0 : ok1 ? s1 : vec3(0.0);
            if (e.z > 1.5) {
              float c = e.z - 2.0, l = floor(c / 3.0 + 0.01), r = c - 3.0 * l;
              float fe = clamp(fwidth(e.y), 1e-5, 0.002), w = smoothstep(-fe, fe, e.y);
              // Only close to the line (the mesh's edge steps about it by millimetres); further out the
              // part's own role, so the hand-over is never at the field's toothed edge.
              float near = 1.0 - smoothstep(0.006, 0.012, abs(e.y));
              le = mix(le, mix(float(abs(r - 1.0) < 0.5), float(abs(l - 1.0) < 0.5), w), near);
              trim = mix(trim, mix(float(abs(r - 2.0) < 0.5), float(abs(l - 2.0) < 0.5), w), near);
              onLe = near * float(abs(l - 2.0) < 0.5 && abs(r - 1.0) < 0.5);   // a patch on the leading-edge cloth
            }
          }
          le = max(le, trim * onLe);   // in that cloth's colour, a shade darker
          // The leading-edge cloth can be laminate too: its film and fibres (uDesignFilm, as a zone's).
          vec4 leFilm = gl_FrontFacing ? uDesignFilmF[${P1}] : uDesignFilmB[${P1}];
          dc = mix(dc, vec4(gl_FrontFacing ? uDesignPalF[${P1}] : uDesignPalB[${P1}], leFilm.x), le);
          fib = mix(fib, vec3(leFilm.z), le);
          if (uDesignPick > 0.5) {
            // The zone under this pixel, as its number in the design's map (${P1}: the leading-edge cloth).
            float zone = front ? texture2D(uDesignMapF, uv).r : texture2D(uDesignMapB, uv).r;
            gl_FragColor = vec4(le > 0.5 ? ${P1}.0 / 255.0 : uDesignOwn > 0.5 ? uDesignOwn / 255.0 : zone, 1.0, 0.0, 1.0);
            return;
          }
          designLam = mix(designLam, leFilm.y, le) * (1.0 - trim);
          designRip = mix(designRip, leFilm.w, le) * (1.0 - trim);
          dc.rgb *= mix(1.0, 0.55, trim);                                       // bound edges, wire-exit patches
          if (uDesignRole < 2.5) {                                              // the cloth: its seams and hems
            // Only where the cloth lies flat enough to the plan (not where it rolls round the
            // leading edge): plan and surface areas of this pixel.
            vec2 px = dFdx(pm), py = dFdy(pm);
            float level = abs(px.x * py.y - px.y * py.x) / max(length(cross(dFdx(vViewPosition), dFdy(vViewPosition))), 1e-12);
            float keep = smoothstep(0.35, 0.6, level);
            vec3 c0 = dc.rgb;
            // The model's own seams and hems (codes above 0) are in its detail map, where it has one.
            vec2 g = vec2(0.0);
            if (s0.z > 0.5 && (s0.z < 1.5 || uDesignBaked < 0.5)) dc.rgb = designStitch(dc.rgb, s0, g);
            if (s1.z > 0.5 && (s1.z < 1.5 || uDesignBaked < 0.5)) dc.rgb = designStitch(dc.rgb, s1, g);
            dc.rgb = mix(c0, dc.rgb, keep);
            designGrad = g * keep;
          }
          if (uDesignRole > 2.5) { designLam = 0.0; designRip = 0.0; }         // thread, laps, tape: woven
          if (uDesignRole > 2.5 && uDesignRole < 3.5) dc.rgb *= 0.8;            // thread and laps on the cloth
          if (uDesignRole > 3.5 && uDesignRole < 4.5) dc.rgb *= 0.92;           // pocket tape: two layers
          if (uDesignRole > 4.5) dc.rgb *= 0.85;                                // thread on the leading-edge cloth
          #ifdef USE_MAP
            // The cloth's own seams, hems, pocket tapes and patches (the model's detail map, colour-free).
            dc.rgb *= texture2D(map, vMapUv).rgb;
          #endif
          diffuseColor.rgb = dc.rgb;
          // On the plan for the panels; on the cloth laid flat where it rolls round the leading edge.
          vec2 pp = vec2(vSailPlan.x * uDesignHalf, vSailPlan.y);
          float fibres = mix(designFibres(pp), designFibres(pm), le), ribs = mix(designRipstop(pp), designRipstop(pm), le);
          // Ripstop threads: proud of the cloth, and a shade darker (on white a lighter thread would not show) [EST].
          designRib = ribs * designRip;
          diffuseColor.rgb *= 1.0 - designRib * 0.16;
          designRelief = designRib * WEAVE_RIB + fibres * designLam * 0.00006 + designWeave(pm) * (1.0 - designLam) * WEAVE_H;
          if (designLam > 0.0) {
            // Film: tinted and hazy; the fibres are opaque, in their own colour.
            float fibre = fibres * designLam;
            diffuseColor.rgb = mix(diffuseColor.rgb, fib, fibre);
            designA = mix(dc.a, 1.0, fibre);
            diffuseColor.a *= designA;
            // The film's tint, as a colour that lets the brightest channel fully through.
            designTint = dc.rgb / max(max(dc.r, max(dc.g, dc.b)), 1e-3);
            // In the picture of what lies behind the films, a film leaves only its opaque cloth: woven
            // panels, stripes and solid laminates (seen through the other skin's film). Not its own
            // fibres: where they merge under a pixel they would paint that picture dark, and the film
            // then showed a black patch over anything lying close behind it.
            ${canFrost ? 'if (uFrostPass > 0.5 && dc.a < 0.999) discard;' : ''}
          }
        }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        // The weave, ripstop threads and laminate fibres stand proud (heights in metres, as lib/cloth.js).
        if (uDesignOn < 0.5) {
          float wv = designWeave(vSailUv);
          float rs = designRipstop(vSailUv);
          designRelief = wv * WEAVE_H + rs * (WEAVE_RIB * 0.55);   // as built: woven polyester + subtle MT ripstop
          diffuseColor.rgb *= (1.0 + wv * 0.035) * (1.0 - rs * 0.075);
        }
        {
          vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition), r1 = cross(sy, normal), r2 = cross(normal, sx);
          float det = dot(sx, r1) * faceDirection;
          normal = normalize(abs(det) * normal - sign(det) * (dFdx(designRelief) * r1 + dFdy(designRelief) * r2));
        }
        // The design's seams stand proud, as the model's own in its normal map.
        if (designGrad != vec2(0.0)) {
          vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition), r1 = cross(sy, normal), r2 = cross(normal, sx);
          float det = dot(sx, r1) * faceDirection;
          normal = normalize(abs(det) * normal - sign(det) * ${RELIEF} * (designGrad.x * r1 + designGrad.y * r2));
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        // As the Falcon's cloth (lib/cloth.js): woven polyester matt, the film's gloss in its clear coat.
        if (uDesignOn > 0.5) roughnessFactor = min(1.0, mix(0.7, 0.6, designLam) + designRib * 0.1);`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
        #ifdef USE_CLEARCOAT
          material.clearcoat *= designLam;
        #endif`)
      .replace('#include <transmission_fragment>', `#include <transmission_fragment>
        ${canFrost ? `if (uFrostOn > 0.5 && designLam > 0.0)   // film blur: the scene behind, through the film
          totalDiffuse = texture(uFrostColor, gl_FragCoord.xy / uFrostSize).rgb * designTint * (1.0 - designA) + totalDiffuse * designA;` : ''}`);
  };
  const key = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => `${key ? key() : ''}design${role}${canFrost ? 'f' : ''}`;
  material.needsUpdate = true;
}

/**
 * Pattern coordinates (aSailUv, metres): the skins' own UVs, which lay their panels out flat at an
 * even scale, times that scale. The parts sewn on (`sewn`) take the pattern of the skin under them,
 * by their plan position. Returns plan (x on the right wing, z) -> pattern, or null off the skin;
 * `flip` when the pattern is the plan's mirror image. up: 1 the top skin (its upper layer where it
 * folds round the leading edge), -1 the undersurface.
 */
function patternCoords(skins, sewn, root, half, up) {
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(), M = new THREE.Matrix4();
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  const ratios = [];
  for (const mesh of skins) {
    const g = mesh.geometry, pos = g.attributes.position, uv = g.attributes.uv, idx = g.index?.array;
    if (!uv || !idx) continue;
    M.multiplyMatrices(inv, mesh.matrixWorld);
    for (let t = 0; t + 2 < idx.length; t += 9) {
      const i = idx[t], j = idx[t + 1];
      const du = Math.hypot(uv.getX(i) - uv.getX(j), uv.getY(i) - uv.getY(j));
      if (du > 1e-9) ratios.push(a.fromBufferAttribute(pos, i).applyMatrix4(M).distanceTo(b.fromBufferAttribute(pos, j).applyMatrix4(M)) / du);
    }
  }
  ratios.sort((x, y) => x - y);
  const k = ratios[ratios.length >> 1] || 1;
  // Plan -> pattern on a grid over the right wing, from the skins' triangles.
  const NX = 1024, NZ = 512;
  let zmin = Infinity, zmax = -Infinity;
  for (const mesh of skins) { const p = mesh.geometry.attributes.aSailPlan; for (let i = 0; i < p.count; i++) { zmin = Math.min(zmin, p.getY(i)); zmax = Math.max(zmax, p.getY(i)); } }
  const dx = half / NX, dz = (zmax - zmin) / NZ;
  const gu = new Float32Array(NX * NZ), gv = new Float32Array(NX * NZ), gy = new Float32Array(NX * NZ).fill(-Infinity);
  let flip = 0;
  for (const mesh of skins) {
    const g = mesh.geometry, uv = g.attributes.uv, plan = g.attributes.aSailPlan, pos = g.attributes.position, idx = g.index?.array;
    if (!uv || !idx) continue;
    const out = new Float32Array(uv.count * 2);
    for (let i = 0; i < uv.count; i++) { out[2 * i] = uv.getX(i) * k; out[2 * i + 1] = uv.getY(i) * k; }
    g.setAttribute('aSailUv', new THREE.BufferAttribute(out, 2));
    M.multiplyMatrices(inv, mesh.matrixWorld);
    const Y = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) Y[i] = a.fromBufferAttribute(pos, i).applyMatrix4(M).y * up;
    for (let t = 0; t + 2 < idx.length; t += 3) {
      const [i, j, l] = [idx[t], idx[t + 1], idx[t + 2]];
      const X = [plan.getX(i) * half, plan.getX(j) * half, plan.getX(l) * half];
      if (X[0] + X[1] + X[2] < 0) continue;                // the right wing (the left has the same pattern)
      const Z = [plan.getY(i), plan.getY(j), plan.getY(l)];
      const det = (X[1] - X[0]) * (Z[2] - Z[0]) - (X[2] - X[0]) * (Z[1] - Z[0]);
      if (Math.abs(det) < 1e-12) continue;
      const U = [out[2 * i], out[2 * j], out[2 * l]], V = [out[2 * i + 1], out[2 * j + 1], out[2 * l + 1]];
      flip += Math.sign(det * ((U[1] - U[0]) * (V[2] - V[0]) - (U[2] - U[0]) * (V[1] - V[0])));
      const c0 = Math.max(0, Math.floor(Math.min(...X) / dx - 0.5)), c1 = Math.min(NX - 1, Math.ceil(Math.max(...X) / dx - 0.5));
      const r0 = Math.max(0, Math.floor((Math.min(...Z) - zmin) / dz - 0.5)), r1 = Math.min(NZ - 1, Math.ceil((Math.max(...Z) - zmin) / dz - 0.5));
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        const px = (c + 0.5) * dx, pz = zmin + (r + 0.5) * dz;
        const w1 = ((px - X[0]) * (Z[2] - Z[0]) - (X[2] - X[0]) * (pz - Z[0])) / det;
        const w2 = ((X[1] - X[0]) * (pz - Z[0]) - (px - X[0]) * (Z[1] - Z[0])) / det, w0 = 1 - w1 - w2;
        if (w0 < -1e-4 || w1 < -1e-4 || w2 < -1e-4) continue;
        const y = w0 * Y[i] + w1 * Y[j] + w2 * Y[l], n = r * NX + c;
        if (y <= gy[n]) continue;
        gy[n] = y; gu[n] = w0 * U[0] + w1 * U[1] + w2 * U[2]; gv[n] = w0 * V[0] + w1 * V[1] + w2 * V[2];
      }
    }
  }
  // Bilinear over the filled cells around.
  const toPattern = (x, z) => {
    const fx = Math.abs(x) / dx - 0.5, fz = (z - zmin) / dz - 0.5;
    const c = Math.floor(fx), r = Math.floor(fz), wx = fx - c, wz = fz - r;
    let su = 0, sv = 0, sw = 0;
    for (const [oc, or, w] of [[0, 0, (1 - wx) * (1 - wz)], [1, 0, wx * (1 - wz)], [0, 1, (1 - wx) * wz], [1, 1, wx * wz]]) {
      const cc = c + oc, rr = r + or;
      if (cc < 0 || rr < 0 || cc >= NX || rr >= NZ) continue;
      const n = rr * NX + cc;
      if (gy[n] === -Infinity || w <= 0) continue;
      su += w * gu[n]; sv += w * gv[n]; sw += w;
    }
    return sw > 0.2 ? [su / sw, sv / sw] : null;
  };
  toPattern.flip = flip < 0;
  // Sewn parts: from the nearest point of the skin under them, in 3D (in plan the cloth folds round
  // the leading edge, so a plan position can lie on either layer).
  const tri = [], CELL = 0.05, cells = new Map();
  const cellOf = (p) => `${Math.floor(p.x / CELL)},${Math.floor(p.y / CELL)},${Math.floor(p.z / CELL)}`;
  for (const mesh of skins) {
    const g = mesh.geometry, pos = g.attributes.position, pat = g.attributes.aSailUv, idx = g.index?.array;
    if (!pat || !idx) continue;
    M.multiplyMatrices(inv, mesh.matrixWorld);
    const W = Array.from({ length: pos.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(M));
    for (let t = 0; t + 2 < idx.length; t += 3) {
      const ids = [idx[t], idx[t + 1], idx[t + 2]];
      const T = { tri: new THREE.Triangle(W[ids[0]], W[ids[1]], W[ids[2]]), uv: ids.map((i) => new THREE.Vector2(pat.getX(i), pat.getY(i))) };
      const box = new THREE.Box3().setFromPoints([T.tri.a, T.tri.b, T.tri.c]);
      for (let x = Math.floor(box.min.x / CELL); x <= Math.floor(box.max.x / CELL); x++)
        for (let y = Math.floor(box.min.y / CELL); y <= Math.floor(box.max.y / CELL); y++)
          for (let z = Math.floor(box.min.z / CELL); z <= Math.floor(box.max.z / CELL); z++) {
            const k = `${x},${y},${z}`;
            if (!cells.has(k)) cells.set(k, []);
            cells.get(k).push(T);
          }
      tri.push(T);
    }
  }
  const q = new THREE.Vector3(), bc = new THREE.Vector3();
  const nearest = (p) => {
    let best = null, bd = Infinity;
    for (let r = 0; r <= 2 && !best; r++) {
      const [cx, cy, cz] = [p.x, p.y, p.z].map((c) => Math.floor(c / CELL));
      for (let x = cx - r; x <= cx + r; x++) for (let y = cy - r; y <= cy + r; y++) for (let z = cz - r; z <= cz + r; z++) {
        for (const T of cells.get(`${x},${y},${z}`) || []) {
          T.tri.closestPointToPoint(p, q);
          const d = q.distanceToSquared(p);
          if (d < bd) { bd = d; best = T; }
        }
      }
    }
    if (!best) return [0, 0];
    best.tri.closestPointToPoint(p, q);
    best.tri.getBarycoord(q, bc);
    return [bc.x * best.uv[0].x + bc.y * best.uv[1].x + bc.z * best.uv[2].x, bc.x * best.uv[0].y + bc.y * best.uv[1].y + bc.z * best.uv[2].y];
  };
  for (const mesh of sewn) {
    const g = mesh.geometry, pos = g.attributes.position;
    M.multiplyMatrices(inv, mesh.matrixWorld);
    const out = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      const [u, v] = nearest(a.fromBufferAttribute(pos, i).applyMatrix4(M));
      out[2 * i] = u; out[2 * i + 1] = v;
    }
    g.setAttribute('aSailUv', new THREE.BufferAttribute(out, 2));
  }
  return toPattern;
}

/** A MeshPhysicalMaterial copy of a skin material (clear coat on; the shader keeps it to the film). */
function toPhysical(old) {
  let m;
  if (old.isMeshPhysicalMaterial) m = old.clone();   // the GLB's own: its normal map and scale
  else {
    m = new THREE.MeshPhysicalMaterial();
    for (const key of ['name', 'map', 'color', 'emissive', 'emissiveIntensity', 'side', 'alphaTest', 'transparent', 'opacity', 'depthWrite', 'metalness', 'roughness', 'normalMap', 'normalScale', 'roughnessMap']) {
      if (old[key] === undefined) continue;
      if (old[key]?.isColor || old[key]?.isVector2) m[key].copy(old[key]); else m[key] = old[key];
    }
    m.userData = { ...old.userData };
  }
  // As the Falcon's woven cloth (lib/cloth.js): no sheen (a white sheen turns the colours milky).
  m.sheen = 0;
  m.specularIntensity = 0.2;
  m.clearcoat = 1;
  m.clearcoatRoughness = 0.08;
  for (const t of [m.map, m.normalMap]) if (t) { t.anisotropy = 8; t.needsUpdate = true; }
  return m;
}

/**
 * "As built" as a design: the model's own cloths as zones (leading edge, top skin, undersurface), each in
 * its own colour until another cloth is chosen; a zone offers the cloths the picker's designs list for it.
 */
function builtDesign(skins, upper, designs) {
  const name = (m) => m.userData.materials.base.name;
  const plain = (m) => !LE_CLOTH.test(name(m)) && !TRIM.test(name(m));
  const hex = (test) => { const m = skins.find(test); return m ? `#${m.userData.materials.base.color.getHexString()}` : '#808080'; };
  // A trailing-edge panel of its own (the U2's P4, in its own material): a zone too, so it keeps its cloth
  // when another zone is given a colour.
  const rear = (m) => upper.has(m) && / P4$/.test(name(m));
  const own = { P1: hex((m) => LE_CLOTH.test(name(m))), P3: hex((m) => upper.has(m) && plain(m) && !rear(m)), P4: hex(rear), P5: hex((m) => !upper.has(m) && plain(m)) };
  const listOf = (id) => designs.designs.map((d) => d.zones.find((z) => z.id === id)?.fabrics || []).sort((a, b) => b.length - a.length)[0] || [];
  const zone = (id, title, sides) => ({ id, name: title, sides, default: 'as-built', fabrics: [['as-built', 'As built', own[id], 1], ...listOf(id)] });
  return { id: 'built', label: 'As built', zones: [zone('P1', 'Leading edge', ['top', 'bottom']), zone('P3', 'Top', ['top']),
    ...(skins.some(rear) ? [zone('P4', 'Trailing edge', ['top'])] : []), zone('P5', 'Undersurface', ['bottom'])] };
}
/** A drawing of one zone all over (zone number k). */
function flatMap(k) {
  const t = new THREE.DataTexture(new Uint8Array([k, 0, 0, 255]), 1, 1);
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Paints a design on a loaded glider; set('built') shows the sail as built, its cloths open to choice. */
export class SailDesigns {
  constructor(rec, designs) {
    this.designs = designs;
    const skins = rec.meshes.filter((m) => SKIN.test(m.userData.part?.name || ''));
    const laps = rec.meshes.filter((m) => LAP.test(m.userData.part?.name || ''));
    // Batten pockets: in the colour of the cloth they are sewn to as seen from below (a shade
    // darker: two layers), with their stitching; they hang under the top skin or the undersurface.
    const pockets = rec.meshes.filter((m) => POCKET.test(m.userData.part?.name || ''));
    // Zippers in the undersurface (sprog access): the tape in the cloth's colour, the coil as it is.
    const zips = rec.meshes.filter((m) => ZIP.test(m.userData.part?.name || ''));
    // The patches round the sprog access: a second layer of the cloth they are sewn to.
    const patches = rec.meshes.filter((m) => PATCH.test(m.userData.part?.name || ''));
    const sewn = [...laps, ...pockets, ...zips, ...patches];
    this.ok = skins.length > 0;
    if (!this.ok) return;
    // The keel pocket is a piece of the undersurface's cloth (P5) in every design [PHOTO U004].
    this.keelPocket = rec.meshes.filter((m) => /^Keel pocket (front|rear)$/.test(m.userData.part?.name || ''));
    this.upper = new Set(skins.filter((m) => isUpperMesh(m)));
    this.lower = new Set(skins.filter((m) => isLowerMesh(m) || isSharedMat(m)));
    this.clear = { top: false, bottom: false };
    this.built = builtDesign(skins, this.upper, designs);
    const zoneNo = (id) => this.built.zones.findIndex((z) => z.id === id) + 1;
    this.flat = { top: flatMap(zoneNo('P3')), bottom: flatMap(zoneNo('P5')) };   // as built: the top skin is all P3, the undersurface all P5
    const { profile, profile2, half, le, te, un, et, eb, line, cref, eref } = planCoords(skins, sewn, rec.root.children[0]);
    this.prof = { half, le, te, un, et, eb, line, cref, eref };
    const straight = { value: 0 };   // the design's bands run straight to the tip (bottom maps)
    // Seams and hems are drawn on the cloth laid flat (its pattern), so they follow it round the
    // leading edge; the parts sewn on take the pattern of the skin under them.
    this.toPattern = {
      top: patternCoords([...this.upper], [...laps, ...pockets.filter(UNDER_TOP)], rec.root.children[0], half, 1),
      bottom: patternCoords([...this.lower], [...pockets.filter((m) => !UNDER_TOP(m)), ...zips, ...patches], rec.root.children[0], half, -1),
    };
    this.seams = new Map();   // design-side -> seam field (built on first use)
    this.own = { top: meshLines([...this.upper], half, 1), bottom: meshLines([...this.lower], half, -1) };
    const uniforms = () => ({ map: { value: null }, on: { value: 0 }, half: { value: half }, straight, cref: { value: cref },
      seam: { value: noSeams }, seam2: { value: noSeams }, seamBox: { value: new THREE.Vector4(0, 0, 1, 1) },
      pal: { value: Array.from({ length: 16 }, () => new THREE.Color()) },
      film: { value: Array.from({ length: 16 }, () => new THREE.Vector4(1, 0, 0, 0)) },   // film alpha, laminate, fibre grey, ripstop
      sdf: [0, 1, 2].map(() => ({ value: blank })), band: { value: designs.map?.band || 4 }, profile: { value: profile },
      profile2: { value: profile2 }, eref: { value: eref } });
    // kind (designST): the bottom maps 1; the top maps 0, or 2 for a design whose top is measured to the undersurface's seam.
    this.u = { top: { ...uniforms(), kind: { value: 0 } }, bottom: { ...uniforms(), kind: { value: 1 } } };
    // The pockets inside the undersurface: one tape from end to end, in the undersurface's own cloth (P5),
    // not striped with the panels it crosses. They lie up to half an inch off the cloth, so a pocket that
    // changed colour with the cloth showed past a stripe's edge from the side, through a clear film.
    const pal = () => ({ value: Array.from({ length: 16 }, () => new THREE.Color()) });
    this.u.pocket = { ...this.u.bottom, pal: pal(), film: { value: Array.from({ length: 16 }, () => new THREE.Vector4(1, 0, 0, 0)) } };
    for (const mesh of skins) {
      const upper = isUpperMesh(mesh);
      const M = mesh.userData.materials;
      for (const [key, old] of Object.entries(M)) {
        // Physical, as the Falcon's cloth: the laminates' gloss is a clear coat.
        const m = M[key] = toPhysical(old);
        if (mesh.material === old) mesh.material = m;
        old.dispose();
        const name = m.name || M.base.name;
        // The top skin seen from below: the bottom drawing's colours, its own seams. Drawn solid,
        // a laminate shows the blurred scene behind it (film blur); blended (ghost), it can't.
        patch(m, upper ? this.u.top : this.u.bottom, LE_CLOTH.test(name) ? 1 : TRIM.test(name) ? 2 : 0, upper ? this.u.top : this.u.bottom,
          upper ? this.u.top : this.u.bottom, key !== 'ghost');
      }
    }
    for (const mesh of laps) for (const m of Object.values(mesh.userData.materials)) {
      const name = m.name || mesh.userData.materials.base.name;
      patch(m, this.u.top, /leading-edge/.test(name) ? 1 : /bound panel edge/.test(name) ? 2 : 3, this.u.bottom, this.u.top);
    }
    const pushDepth = (m) => {
      m.polygonOffset = true; m.polygonOffsetFactor = 2; m.polygonOffsetUnits = 2;
      const prev = m.onBeforeCompile;
      m.onBeforeCompile = (s, r) => {
        prev?.call(m, s, r);
        s.vertexShader = s.vertexShader.replace('#include <logdepthbuf_vertex>',
          `#include <logdepthbuf_vertex>
          #ifdef USE_LOGARITHMIC_DEPTH_BUFFER
            vFragDepth *= 1.006;
          #endif
          gl_Position.z += 0.0005 * gl_Position.w;`);
      };
      const prevKey = m.customProgramCacheKey?.bind(m);
      m.customProgramCacheKey = () => `${prevKey ? prevKey() : ''}pushdv3`;
      m.needsUpdate = true;
    };
    for (const mesh of rec.meshes) {
      const pn = mesh.userData.part?.name || '';
      if (/^Rear keel pocket/.test(pn)) {
        for (const m of Object.values(mesh.userData.materials)) { m.side = THREE.FrontSide; pushDepth(m); }
      } else if (/^(Sail (nose |lower |speed )?batten|Sweep wire tubing)/.test(pn) && !/pocket$/.test(pn)) {
        for (const m of Object.values(mesh.userData.materials)) pushDepth(m);
      }
    }
    for (const mesh of pockets) {
      for (const m of Object.values(mesh.userData.materials)) {
        const name = m.name || mesh.userData.materials.base.name;
        // All batten pockets (top-skin and undersurface) face into the wing; cull their back faces
        // so they never bleed through the sail skin from outside.
        m.side = THREE.FrontSide;
        // Stitching under the leading-edge cloth shows in that cloth's colour.
        const r = THREAD.test(name) ? (LE_CLOTH.test(name) ? 5 : 3) : 4;
        // The top skin's pockets: in the bottom drawing's colours, and the leading-edge cloth's where they
        // run in under it (from the top skin's own part edges).
        const top = UNDER_TOP(mesh);
        // Their topstitching shows on the cloth it goes through: the top skin's in the top drawing's colours.
        const u = top ? this.u.top : this.u.pocket;
        patch(m, u, r, u, u, false, u);
        pushDepth(m);
      }
    }
    for (const mesh of zips) for (const m of Object.values(mesh.userData.materials)) {
      if (/zipper tape/.test(m.name || mesh.userData.materials.base.name)) patch(m, this.u.bottom, 4);
    }
    const topBody = skins.find((m) => isUpperMesh(m) && !LE_CLOTH.test(m.userData.materials.base.name) && !TRIM.test(m.userData.materials.base.name));
    for (const mesh of patches) {
      for (const m of Object.values(mesh.userData.materials)) {
        if (topBody && m.color) m.color.copy(topBody.userData.materials.base.color).multiplyScalar(0.85);
        patch(m, this.u.top, 4);
      }
    }
  }

  /** The seam field of a design's side (null: none drawn). */
  seamsOf(id, side) {
    const key = `${id}-${side}`;
    if (!this.seams.has(key)) {
      // (As built: no drawing, only the model's own seams.)
      this.seams.set(key, (id === 'built' ? Promise.resolve([]) : fetch(`${this.designs.dir}/${key}-seams.json`)
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []))
        .then((lines) => seamField([...drawingLines(lines, this.prof, side === 'bottom' ? 1 : this.design(id)?.topHem ? 2 : 0, this.toPattern[side], this.design(id)?.straight), ...this.own[side]])));
    }
    return this.seams.get(key);
  }

  /** True for a part of a sail skin with a see-through laminate in the design on it. */
  seeThrough(mesh) {
    if (!this.ok || !(this.upper.has(mesh) || this.lower.has(mesh))) return false;
    // The leading-edge cloth (P1) is its own part of each skin.
    if (LE_CLOTH.test(mesh.userData.materials.base.name)) return this.clear.le;
    return this.upper.has(mesh) ? this.clear.top : this.clear.bottom;
  }

  design(id) { return id === 'built' ? this.built : this.designs.designs.find((d) => d.id === id) || null; }

  /** Draws skin meshes with each pixel's zone number in red; returns the bytes (RGBA, rows bottom up). */
  zonePixels(renderer, camera, meshes, target) {
    const before = { target: renderer.getRenderTarget(), auto: renderer.autoClear, colour: renderer.getClearColor(new THREE.Color()), alpha: renderer.getClearAlpha() };
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.autoClear = false;
    pick.value = 1;
    renderer.info.render.frame++;   // (so the plan attributes are bound in this program too: see lib/frost.js)
    for (const m of meshes) if (m.visible) renderer.render(m, camera);
    pick.value = 0;
    const px = new Uint8Array(target.width * target.height * 4);
    renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, px);
    renderer.setRenderTarget(before.target);
    renderer.setClearColor(before.colour, before.alpha);
    renderer.autoClear = before.auto;
    return px;
  }

  zoneOfByte(v) {
    const d = this.design(this.current);
    if (!d || !v) return null;
    return v === P1 ? (d.zones.find((z) => z.id === 'P1')?.id ?? null) : d.zones[v - 1]?.id ?? null;
  }

  /** The design zone drawn on a skin mesh at a point of the view (ndc: -1..1), or null. */
  zoneAt(renderer, camera, mesh, ndc) {
    if (!this.ok || !this.current || !(this.upper.has(mesh) || this.lower.has(mesh))) return null;
    this.one ??= new THREE.WebGLRenderTarget(1, 1);
    // (A perspective camera takes its aspect from the full size given here and keeps it afterwards:
    // the full size has the view's own aspect, and the aspect is put back.)
    const aspect = camera.isPerspectiveCamera ? camera.aspect : 1, high = 4096, wide = Math.round(high * aspect);
    const had = camera.view ? { ...camera.view } : null;
    camera.setViewOffset(wide, high, Math.floor((ndc.x + 1) / 2 * wide), Math.floor((1 - ndc.y) / 2 * high), 1, 1);
    const px = this.zonePixels(renderer, camera, [mesh], this.one);
    if (had?.enabled) camera.setViewOffset(had.fullWidth, had.fullHeight, had.offsetX, had.offsetY, had.width, had.height); else camera.clearViewOffset();
    if (camera.isPerspectiveCamera) { camera.aspect = aspect; camera.updateProjectionMatrix(); }
    return px[3] ? this.zoneOfByte(px[0]) : null;
  }

  /**
   * A point on the sail in each zone of the design (the model's frame), for its label: the zone's
   * pixel nearest the middle of its area on one wing, seen straight from above (zones on the top
   * drawing) or below. Returns zone id -> { p, top }.
   */
  anchors(renderer, root) {
    if (this.anchored?.id === this.current) return this.anchored.map;
    const map = new Map(), d = this.design(this.current);
    this.anchored = { id: this.current, map };
    if (!this.ok || !d) return map;
    root.updateWorldMatrix(true, true);
    const toModel = new THREE.Matrix4().copy(root.matrixWorld).invert(), m4 = new THREE.Matrix4();
    const skins = [...this.upper, ...this.lower], box = new THREE.Box3();
    for (const m of skins) {
      m.geometry.computeBoundingBox();
      box.union(m.geometry.boundingBox.clone().applyMatrix4(m4.multiplyMatrices(toModel, m.matrixWorld)));
    }
    const c = box.getCenter(new THREE.Vector3()), hx = (box.max.x - box.min.x) / 2 + 0.05, hz = (box.max.z - box.min.z) / 2 + 0.05;
    const W = 512, H = Math.max(64, Math.round(W * hz / hx));
    this.plan ??= new THREE.WebGLRenderTarget(W, H);
    this.plan.setSize(W, H);
    const cam = new THREE.OrthographicCamera(-hx, hx, hz, -hz, 0.01, box.max.y - box.min.y + 2);
    cam.matrixAutoUpdate = false;
    const ray = new THREE.Raycaster();
    for (const top of [true, false]) {
      // Looking down the model's -Y (x right, -z up on the picture), or up its +Y (x right, z up).
      const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 0, top ? -1 : 1), Z = new THREE.Vector3(0, top ? 1 : -1, 0);
      const eye = new THREE.Vector3(c.x, top ? box.max.y + 1 : box.min.y - 1, c.z);
      cam.matrixWorld.copy(root.matrixWorld).multiply(m4.makeBasis(X, Y, Z).setPosition(eye));
      cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
      const px = this.zonePixels(renderer, cam, top ? [...this.upper] : skins, this.plan);
      d.zones.forEach((z, i) => {
        if (map.has(z.id) || (z.sides?.includes('top') ?? true) !== top) return;
        const want = z.id === 'P1' ? P1 : i + 1, side = i % 2 ? -1 : 1;   // the wings in turn, so the labels spread
        let n = 0, su = 0, sv = 0;
        const own = [];
        // (A zone astride the centre line, as a centre stripe, has little or nothing out on one wing: all of it then.)
        for (const clear of [W * 0.04, -W]) {
          for (let v = 0; v < H; v++) for (let u = 0; u < W; u++) {
            if (px[(v * W + u) * 4] !== want || !px[(v * W + u) * 4 + 3] || (u - W / 2) * side < clear) continue;
            own.push(u, v); n++; su += u; sv += v;
          }
          if (n > 20) break;
          n = 0; su = 0; sv = 0; own.length = 0;
        }
        if (!n) return;
        let best = Infinity, bu = 0, bv = 0;
        for (let k = 0; k < own.length; k += 2) {
          const e = (own[k] - su / n) ** 2 + (own[k + 1] - sv / n) ** 2;
          if (e < best) { best = e; bu = own[k]; bv = own[k + 1]; }
        }
        const from = eye.clone().addScaledVector(X, ((bu + 0.5) / W * 2 - 1) * hx).addScaledVector(Y, ((bv + 0.5) / H * 2 - 1) * hz).applyMatrix4(root.matrixWorld);
        ray.set(from, Z.clone().negate().transformDirection(root.matrixWorld));
        const hit = ray.intersectObjects(top ? [...this.upper] : skins, false)[0];
        if (hit) map.set(z.id, { p: hit.point.applyMatrix4(toModel), top });
      });
    }
    return map;
  }

  /**
   * colours: zone -> fabric id (the design's default where missing); hexOf turns a fabric into a
   * colour. Afterwards `clear` tells, per side, whether a see-through laminate is in it (that skin then
   * draws blended; see seeThrough).
   */
  set(id, colours = {}, hexOf = (f) => f[2]) {
    if (!this.ok) return;
    const d = this.design(id), built = d === this.built;
    // As built with no cloth chosen: the model's own materials draw. The design stays loaded, for the
    // zone under a click and the labels.
    const paint = Boolean(d) && !(built && d.zones.every((z) => (colours[z.id] || z.default) === z.default));
    this.current = d?.id ?? null;
    this.clear = { top: false, bottom: false, le: false };
    // The top skin's own panels (materials named for their slot, "... P3") that are zones of this design.
    for (const mesh of this.upper) {
      const slot = / (P\d\w*)$/.exec(mesh.userData.materials.base.name)?.[1];
      const k = d && slot ? d.zones.findIndex((z) => z.id === slot && (z.sides || ['top']).includes('top')) + 1 : 0;
      for (const m of Object.values(mesh.userData.materials)) if (m.userData.designOwn) m.userData.designOwn.value = k;
    }
    for (const side of ['top', 'bottom']) {
      const u = this.u[side];
      u.on.value = paint ? 1 : 0;
      u.straight.value = d?.straight ? 1 : 0;
      if (side === 'top') u.kind.value = d?.topHem ? 2 : 0;
      if (!d) continue;
      u.map.value = built ? this.flat[side] : texture(this.designs, `${d.id}-${side}.png`, true);
      this.seamsOf(d.id, side).then((f) => {
        if (this.current !== d.id) return;
        u.seam.value = f ? f.tex[0] : noSeams; u.seam2.value = f ? f.tex[1] : noSeams;
        if (f) u.seamBox.value.copy(f.box);
      });
      u.sdf.forEach((t, i) => { t.value = !built && i * 4 < d.zones.length ? texture(this.designs, `${d.id}-${side}-sdf${i}.png`, false) : blank; });
      for (const c of u.pal.value) c.set(0x808080);
      for (const v of u.film.value) v.set(1, 0, 0, 0);
      d.zones.forEach((z, i) => {
        const f = z.fabrics.find((x) => x[0] === (colours[z.id] || z.default)) || z.fabrics[0];
        // Clear laminates (opacity < 1 in the picker): hazy film between opaque fibres, as lib/cloth.js.
        const lam = clothKind(f[0]) >= CLOTH.laminate;
        const film = new THREE.Vector4(lam && f[3] < 1 ? filmAlpha(f[3]) : 1, lam ? 1 : 0, /^uvpxb|^uvp2lxb|^uvodl|^odl/.test(f[0]) ? 0.006 : 0.82, clothKind(f[0]) === CLOTH.ripstop ? 1 : 0);
        // P1 and P4 on the bottom drawing are the top skin seen from below, not the undersurface.
        const onSkin = side === 'top' || !/^P[14]$/.test(z.id);
        if (film.x < 1 && z.id !== 'P1' && onSkin && (z.sides || [side]).includes(side)) this.clear[side] = true;
        clothColour(u.pal.value[i + 1], hexOf(f));
        u.film.value[i + 1].copy(film);
        if (z.id === 'P1') {
          clothColour(u.pal.value[P1], hexOf(f));
          u.film.value[P1].copy(film);
          if (film.x < 1) this.clear.le = true;
        }
      });
      if (side === 'bottom') {
        const base = d.zones.findIndex((z) => z.id === 'P5') + 1;
        if (base) for (const mesh of this.keelPocket) for (const m of Object.values(mesh.userData.materials)) m.color?.copy(u.pal.value[base]);
        d.zones.forEach((z, i) => {
          const from = base && !/^P[1345]$/.test(z.id) ? base : i + 1;
          this.u.pocket.pal.value[i + 1].copy(u.pal.value[from]);
          this.u.pocket.film.value[i + 1].copy(u.film.value[from]);
        });
        this.u.pocket.pal.value[0].copy(u.pal.value[0]); this.u.pocket.pal.value[P1].copy(u.pal.value[P1]);
      }
    }
  }
}
