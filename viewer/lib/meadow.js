// A hilltop meadow for the glider: sky with time of day, wind-blown grass, wild flowers,
// a tree line and rolling land in the haze. Everything is generated in code.
// The look, the sun model and the sky palette follow janderssn/granholmstoppen-fable
// (src/sky.js, src/grass.js); the geometry here is a generic hill, not a real place.
import * as THREE from 'three';

// ---------------------------------------------------------------- sun and sky palette
const LAT = 59.4 * Math.PI / 180;            // the same latitude as Granholmstoppen
const DECL = 22.6 * Math.PI / 180;           // early June

/** Solar elevation and azimuth (from north, clockwise) for a clock time in hours. */
export function sunAngles(hours, decl = DECL, noon = 12.75) {
  const ha = (hours - noon) * 15 * Math.PI / 180;
  const el = Math.asin(Math.sin(LAT) * Math.sin(decl) + Math.cos(LAT) * Math.cos(decl) * Math.cos(ha));
  let az = Math.atan2(-Math.sin(ha), Math.tan(decl) * Math.cos(LAT) - Math.sin(LAT) * Math.cos(ha));
  if (az < 0) az += Math.PI * 2;
  return { el, az };
}

const KEYS = [   // sun elevation (deg) -> palette, linear RGB
  { e: -18, sun: [0.9, 0.35, 0.2], si: 0.0, zen: [0.0022, 0.0036, 0.0105], hor: [0.0055, 0.0075, 0.017], amb: 0.06 },
  { e: -8, sun: [0.9, 0.35, 0.2], si: 0.0, zen: [0.012, 0.022, 0.07], hor: [0.10, 0.09, 0.14], amb: 0.10 },
  { e: -1, sun: [1.0, 0.42, 0.18], si: 0.5, zen: [0.05, 0.10, 0.30], hor: [0.95, 0.46, 0.24], amb: 0.5 },
  { e: 5, sun: [1.0, 0.60, 0.30], si: 2.8, zen: [0.09, 0.21, 0.54], hor: [1.0, 0.66, 0.40], amb: 0.85 },
  { e: 14, sun: [1.0, 0.80, 0.56], si: 3.2, zen: [0.10, 0.26, 0.66], hor: [0.84, 0.80, 0.78], amb: 0.95 },
  { e: 30, sun: [1.0, 0.93, 0.80], si: 3.4, zen: [0.10, 0.28, 0.72], hor: [0.60, 0.76, 0.95], amb: 1.0 },
  { e: 60, sun: [1.0, 0.97, 0.90], si: 3.6, zen: [0.09, 0.26, 0.74], hor: [0.56, 0.74, 0.97], amb: 1.05 },
];
const lerp3 = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function noise2(seed) {
  const r = rng(seed), perm = new Uint8Array(512), p = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const g = (h, x, y) => ((h & 1) ? x : -x) + ((h & 2) ? y : -y);
  const f = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const n = (x, y) => {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255; x -= Math.floor(x); y -= Math.floor(y);
    const u = f(x), v = f(y), a = perm[X] + Y, b = perm[X + 1] + Y;
    const l = (A, B, t) => A + (B - A) * t;
    return l(l(g(perm[a], x, y), g(perm[b], x - 1, y), u), l(g(perm[a + 1], x, y - 1), g(perm[b + 1], x - 1, y - 1), u), v);
  };
  return (x, y, oct = 4) => { let s = 0, a = 1, fr = 1, nn = 0; for (let i = 0; i < oct; i++) { s += a * n(x * fr, y * fr); nn += a; a *= 0.5; fr *= 2.03; } return s / nn; };
}

// ---------------------------------------------------------------- the land
// The glider stands on a flat hilltop (y = 0). The hill falls away gently in every
// direction and more steeply in front of the nose (+Z), down to a valley; a worn
// path runs from the launch down the slope. Farther out the land rises into
// wooded hills that fade into the haze.
const fbm = noise2(7);
const PATH = [[0.5, 7], [1.5, 16], [-1, 28], [2.5, 42], [7, 60], [6, 82], [11, 110], [18, 150], [16, 200]];
function pathDistance(x, z) {
  let best = 1e9;
  for (let i = 0; i < PATH.length - 1; i++) {
    const [ax, az] = PATH[i], [bx, bz] = PATH[i + 1];
    const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}
export function groundHeight(x, z) {
  const rr = Math.hypot(x, z > 0 ? z * 1.25 : z * 0.9);
  let h = 18 * (Math.exp(-((rr / 85) ** 2)) - 1);                     // the hill
  h -= smooth(20, 260, z) * smooth(-120, 0, -Math.abs(x) + 60) * 10;   // the valley in front
  const r = Math.hypot(x, z);
  h += fbm(x / 38, z / 38) * 1.6 * smooth(10, 40, r);                  // undulation off the top
  h += smooth(380, 1400, r) * (28 + fbm(x / 420, z / 420, 3) * 70);     // wooded hills around
  return h;
}

function canvasTexture(size, draw, repeat = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function buildGround() {
  const N = 260, R = 6000;
  const geo = new THREE.PlaneGeometry(2, 2, N, N);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  // Dense near the glider, coarse far away.
  const warp = (s) => Math.sign(s) * (Math.abs(s) ** 3.2 * (R - 60) + Math.abs(s) * 60);
  for (let i = 0; i < pos.count; i++) {
    const x = warp(pos.getX(i)), z = warp(pos.getZ(i));
    pos.setXYZ(i, x, groundHeight(x, z), z);
    uv.setXY(i, x / 3, z / 3);
  }
  geo.computeVertexNormals();
  const col = new Float32Array(pos.count * 3), c = new THREE.Color();
  const lawn = new THREE.Color('#5f8a33'), meadow = new THREE.Color('#6f8d35'), dry = new THREE.Color('#a69b55'),
    dark = new THREE.Color('#3f5f27'), path = new THREE.Color('#a8957a'), forest = new THREE.Color('#2c4524'), field = new THREE.Color('#8a9a48');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), r = Math.hypot(x, z);
    const n = fbm(x / 30, z / 30, 3), n2 = fbm(x / 7 + 40, z / 7, 2);
    c.copy(meadow).lerp(dry, smooth(0.1, 0.55, n) * 0.7).lerp(dark, smooth(0.1, 0.5, -n2) * 0.35);
    c.lerp(lawn, 1 - smooth(8, 14, r));                                  // the mown launch
    if (r > 300) c.lerp(fbm(x / 160, z / 160, 2) > -0.05 ? forest : field, smooth(300, 700, r) * 0.9);
    c.lerp(path, (1 - smooth(0.7, 1.6, pathDistance(x, z))) * (r < 230 ? 0.85 : 0));
    c.multiplyScalar(0.92 + 0.08 * Math.max(-1, Math.min(1, y / 20)));
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const detail = canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#e8e8e8'; ctx.fillRect(0, 0, s, s);
    const r = rng(5);
    for (let i = 0; i < 3200; i++) {
      const v = 150 + r() * 105, x = r() * s, y = r() * s;
      ctx.strokeStyle = `rgba(${v * 0.94},${v},${v * 0.78},${0.2 + r() * 0.35})`;
      ctx.lineWidth = 0.6 + r();
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (r() - 0.5) * 4, y - 2 - r() * 6); ctx.stroke();
    }
  });
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, map: detail, roughness: 0.96 }));
  mesh.receiveShadow = true;
  mesh.name = 'ground';
  return mesh;
}

// ---------------------------------------------------------------- grass
function bladeGeometry() {
  // One blade: four tapered segments, x in [-0.5, 0.5], y in [0, 1].
  const ys = [0, 0.3, 0.58, 0.82, 1.0], ws = [1, 0.86, 0.62, 0.34, 0];
  const pos = [], idx = [];
  ys.forEach((y, i) => { if (i < 4) pos.push(-0.5 * ws[i], y, 0, 0.5 * ws[i], y, 0); else pos.push(0, y, 0); });
  for (let i = 0; i < 3; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  idx.push(6, 7, 8);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(idx);
  return g;
}

function buildGrass(count, uniforms) {
  const g = bladeGeometry();
  const r = rng(11), R = 46;
  const at = new Float32Array(count * 4), shape = new Float32Array(count * 4);
  let n = 0;
  for (let tries = 0; n < count && tries < count * 3; tries++) {
    // More blades near the glider, where the camera usually is.
    const rad = R * Math.pow(r(), 0.62), ang = r() * Math.PI * 2;
    const x = Math.cos(ang) * rad, z = Math.sin(ang) * rad;
    const pd = pathDistance(x, z);
    if (pd < 0.6 && r() < 0.85) continue;
    const mown = smooth(8, 13, rad);                                   // short on the launch
    let h = THREE.MathUtils.lerp(0.05 + r() * 0.07, 0.22 + r() * r() * 0.5, mown);
    h *= smooth(0.4, 1.8, pd) * 0.7 + 0.3;
    h *= 1 - smooth(R * 0.78, R, rad);                                 // fade into the ground texture
    at.set([x, groundHeight(x, z), z, r() * Math.PI * 2], n * 4);
    shape.set([h, 0.012 + r() * 0.014, r(), r()], n * 4);
    n++;
  }
  g.setAttribute('aAt', new THREE.InstancedBufferAttribute(at.subarray(0, n * 4), 4));
  g.setAttribute('aShape', new THREE.InstancedBufferAttribute(shape.subarray(0, n * 4), 4));
  g.instanceCount = n;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), R + 5);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, side: THREE.DoubleSide });
  mat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, uniforms);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aAt; attribute vec4 aShape; uniform float uTime; uniform float uWind; varying float vY; varying float vTone;`)
      .replace('#include <begin_vertex>', `
        float h = aShape.x, w = aShape.y; vY = position.y; vTone = aShape.z;
        float c = cos(aAt.w), s = sin(aAt.w);
        vec3 p = vec3(position.x * w, position.y * h, 0.0);
        p = vec3(p.x * c, p.y, p.x * s);
        // wind: a steady lean plus gusts that roll across the hill
        float gust = sin(uTime * 1.3 + aAt.x * 0.21 + aAt.z * 0.17) * 0.5 + sin(uTime * 2.9 + aAt.x * 0.9 - aAt.z * 0.6) * 0.22;
        float bend = position.y * position.y * h * uWind * (0.35 + gust * 0.45 + aShape.w * 0.2);
        p.x += bend * 0.9; p.z += bend * 0.35; p.y -= bend * bend * 0.6;
        vec3 transformed = p + aAt.xyz;`)
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vY; varying float vTone;')
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', `
        vec3 base = mix(vec3(0.10, 0.17, 0.04), vec3(0.16, 0.24, 0.06), vTone);
        vec3 tip = mix(vec3(0.36, 0.45, 0.13), vec3(0.55, 0.52, 0.22), vTone * vTone);
        vec4 diffuseColor = vec4(mix(base, tip, smoothstep(0.0, 1.0, vY)), opacity);`);
  };
  const mesh = new THREE.Mesh(g, mat);
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.name = 'grass';
  return mesh;
}

function buildFlowers(count) {
  const r = rng(23);
  const geo = new THREE.IcosahedronGeometry(0.035, 0);
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.7 });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const m = new THREE.Matrix4(), c = new THREE.Color();
  const tones = ['#f4f1e6', '#f2d24b', '#b78ad6', '#e9e3f2', '#f0b6c8', '#7d8fe0'];
  for (let i = 0; i < count; i++) {
    const rad = 11 + Math.pow(r(), 0.8) * 33, a = r() * Math.PI * 2, x = Math.cos(a) * rad, z = Math.sin(a) * rad;
    const s = 0.7 + r() * 0.8;
    m.makeScale(s, s * 0.7, s).setPosition(x, groundHeight(x, z) + 0.18 + r() * 0.3, z);
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, c.set(tones[Math.floor(r() * r() * tones.length)]));
  }
  mesh.name = 'flowers';
  return mesh;
}

// ---------------------------------------------------------------- trees
function crownGeometry(seed) {
  const r = rng(seed), parts = [];
  for (let i = 0; i < 16; i++) {
    const g = new THREE.IcosahedronGeometry(0.28 + r() * 0.22, 1);
    const a = r() * Math.PI * 2, d = i < 3 ? r() * 0.2 : 0.3 + r() * 0.42, y = 0.1 + r() * 0.85;
    g.translate(Math.cos(a) * d * (1.1 - y * 0.4), y, Math.sin(a) * d * (1.1 - y * 0.4));
    parts.push(g.toNonIndexed());
  }
  const pos = parts.flatMap((g) => [...g.attributes.position.array]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const p = geo.attributes.position, n3 = noise2(seed + 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 1 + n3(x * 3.1, z * 3.1 + y * 2.3, 2) * 0.28;
    p.setXYZ(i, x * k, y * (0.95 + (k - 1) * 0.4), z * k);
  }
  geo.computeVertexNormals();
  // Normals that point out from the crown centre read as foliage, not facets; leaves
  // underneath and inside the crown are darker.
  const nv = geo.attributes.normal, nrm = [], col = [];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const out = new THREE.Vector3(x, y - 0.5, z).normalize();
    const f = new THREE.Vector3(nv.getX(i), nv.getY(i), nv.getZ(i)).lerp(out, 0.55).normalize();
    nrm.push(f.x, f.y, f.z);
    const shade = 0.5 + 0.45 * Math.min(1, y) + 0.25 * Math.min(1, Math.hypot(x, z) / 0.7) + n3(x * 9, z * 9 + y * 7, 1) * 0.18;
    col.push(shade * 0.95, shade, shade * 0.85);
  }
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return geo;
}

function coniferGeometry() {
  const parts = [[1.0, 1.4, 0.2], [0.78, 1.2, 0.9], [0.55, 1.0, 1.55], [0.32, 0.8, 2.1]].map(([rad, h, y]) => {
    const g = new THREE.ConeGeometry(rad, h, 9, 1, true); g.translate(0, y + h / 2, 0); return g.toNonIndexed();
  });
  const pos = parts.flatMap((g) => [...g.attributes.position.array]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

function buildTrees() {
  const group = new THREE.Group();
  group.name = 'trees';
  const r = rng(31);
  const spots = [];
  // Groves of trees on the slopes around the hill, leaving the view down the valley
  // (+Z) open, then woods on the far hills.
  for (let g = 0; g < 16; g++) {
    const a = r() * Math.PI * 2, rad = 85 + r() * 170;
    const front = Math.abs(Math.atan2(Math.sin(a - Math.PI / 2), Math.cos(a - Math.PI / 2)));
    if (front < 0.55) continue;
    const cx = Math.cos(a) * rad, cz = Math.sin(a) * rad, n = 4 + Math.floor(r() * 14), spread = 8 + r() * 14;
    for (let i = 0; i < n; i++) {
      const x = cx + (r() - 0.5) * 2 * spread, z = cz + (r() - 0.5) * 2 * spread;
      if (pathDistance(x, z) > 4) spots.push([x, groundHeight(x, z), z, true]);
    }
  }
  for (let i = 0; i < 4000 && spots.length < 950; i++) {
    const a = r() * Math.PI * 2, rad = 320 + r() * 1200, x = Math.cos(a) * rad, z = Math.sin(a) * rad;
    if (fbm(x / 160, z / 160, 2) < -0.05) continue;                       // fields between woods
    spots.push([x, groundHeight(x, z), z, false]);
  }
  const crown = crownGeometry(41), conifer = coniferGeometry();
  const trunkGeo = new THREE.CylinderGeometry(0.09, 0.14, 1, 6); trunkGeo.translate(0, 0.5, 0);
  const leafMat = new THREE.MeshStandardMaterial({ roughness: 0.9, vertexColors: true }), needleMat = new THREE.MeshStandardMaterial({ roughness: 0.92 });
  const barkMat = new THREE.MeshStandardMaterial({ color: '#4a3b2c', roughness: 0.95 });
  const decid = spots.filter(() => r() > 0.3), con = spots.filter((s) => !decid.includes(s));
  const crowns = new THREE.InstancedMesh(crown, leafMat, decid.length);
  const cones = new THREE.InstancedMesh(conifer, needleMat, con.length);
  const trunks = new THREE.InstancedMesh(trunkGeo, barkMat, spots.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
  const greens = ['#4a7a30', '#5a8a38', '#3f6e2c', '#6b9640', '#38652a', '#7a9a42'];
  let ti = 0;
  decid.forEach(([x, y, z, near], i) => {
    const h = (near ? 6 : 8) + r() * 9, w = h * (0.38 + r() * 0.2);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6.28);
    crowns.setMatrixAt(i, m.compose(p.set(x, y + h * 0.42, z), q, s.set(w, h * 0.55, w)));
    crowns.setColorAt(i, c.set(greens[Math.floor(r() * greens.length)]).multiplyScalar(0.85 + r() * 0.3));
    trunks.setMatrixAt(ti++, m.compose(p.set(x, y - 0.3, z), q, s.set(h * 0.09, h * 0.62, h * 0.09)));
  });
  con.forEach(([x, y, z, near], i) => {
    const h = (near ? 7 : 10) + r() * 10, w = h * (0.32 + r() * 0.08);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6.28);
    cones.setMatrixAt(i, m.compose(p.set(x, y + h * 0.08, z), q, s.set(w, h / 2.9, w)));
    cones.setColorAt(i, c.set('#24402a').multiplyScalar(0.8 + r() * 0.35));
    trunks.setMatrixAt(ti++, m.compose(p.set(x, y - 0.3, z), q, s.set(h * 0.07, h * 0.3, h * 0.07)));
  });
  trunks.count = ti;
  group.add(crowns, cones, trunks);
  return group;
}

// ---------------------------------------------------------------- sky dome
const SKY_GLSL = /* glsl */`
  uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uZenith; uniform vec3 uHorizon; uniform float uTime; uniform float uCloud; uniform float uSunGlow;
  varying vec3 vDir;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y); }
  float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
  void main() {
    vec3 d = normalize(vDir);
    float h = max(d.y, 0.0);
    vec3 col = mix(uHorizon, uZenith, pow(h, 0.5));
    float sd = max(dot(d, uSunDir), 0.0);
    col += uSunColor * (pow(sd, 8.0) * 0.18 * (1.0 - h) + pow(sd, 120.0) * 0.6) * uSunGlow;
    col += uSunColor * smoothstep(0.99975, 0.9999, sd) * 22.0 * uSunGlow;
    if (d.y > 0.0) {
      vec2 uv = d.xz / (d.y + 0.18) * 1.4 + vec2(uTime * 0.006, uTime * 0.002);
      float c = fbm(uv * 1.3);
      c = smoothstep(0.62 - uCloud * 0.28, 0.9, c) * smoothstep(0.0, 0.18, d.y);
      vec3 lit = mix(uHorizon, vec3(1.0), 0.55) * (0.55 + 0.6 * max(uSunColor.r, 0.2)) + uSunColor * pow(sd, 6.0) * 0.6;
      col = mix(col, lit * (0.8 + 0.25 * fbm(uv * 3.0)), c * 0.92);
    }
    col = mix(col, uHorizon * 0.9, smoothstep(0.0, -0.06, d.y));
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

function buildSky(uniforms) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, uniforms,
    vertexShader: `varying vec3 vDir; void main() { vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w * 0.99999; }`,
    fragmentShader: SKY_GLSL,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(4000, 48, 24), mat);
  dome.frustumCulled = false;
  dome.renderOrder = -10;
  dome.name = 'sky';
  return dome;
}

// ---------------------------------------------------------------- public
export class Meadow {
  constructor(renderer, scene, { grass = 160000 } = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.uniforms = {
      uTime: { value: 0 }, uWind: { value: 1 }, uCloud: { value: 0.45 }, uSunGlow: { value: 1 },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color() },
      uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() },
    };
    this.group = new THREE.Group();
    this.group.name = 'meadow';
    this.sky = buildSky(this.uniforms);
    this.group.add(buildGround(), buildGrass(grass, this.uniforms), buildFlowers(1800), buildTrees());
    scene.add(this.group, this.sky);

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.03;
    const sc = this.sun.shadow.camera;
    sc.left = -8; sc.right = 8; sc.top = 8; sc.bottom = -8; sc.near = 0.5; sc.far = 80;
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x445522, 1);
    scene.add(this.sun, this.sun.target, this.hemi);
    scene.fog = new THREE.Fog(0xffffff, 160, 3800);

    this.envScene = new THREE.Scene();
    this.envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), this.sky.material));
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.center = new THREE.Vector3(0, 1.2, -1.7);
    this.hours = 9.5;
    this.setTime(this.hours);
  }

  /** Glider footprint: the meadow is lifted so its flat top meets the lowest point of the glider. */
  place(groundY, center) {
    this.group.position.y = groundY;
    this.center.copy(center);
    this.aimSun();
  }

  aimSun() {
    this.sun.target.position.copy(this.center);
    this.sun.position.copy(this.center).addScaledVector(this.uniforms.uSunDir.value, 40);
    this.sun.target.updateMatrixWorld();
  }

  setTime(hours) {
    this.hours = hours;
    const { el, az } = sunAngles(hours);
    const U = this.uniforms;
    // x = east, z = south; the glider's nose points south.
    U.uSunDir.value.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
    const e = el * 180 / Math.PI;
    let a = KEYS[0], b = KEYS[KEYS.length - 1], t = 0;
    for (let i = 0; i < KEYS.length - 1; i++) if (e >= KEYS[i].e && e <= KEYS[i + 1].e) { a = KEYS[i]; b = KEYS[i + 1]; t = (e - a.e) / (b.e - a.e); }
    if (e < KEYS[0].e) b = a; else if (e > KEYS[KEYS.length - 1].e) a = b;
    t = t * t * (3 - 2 * t);
    const sunC = lerp3(a.sun, b.sun, t), zen = lerp3(a.zen, b.zen, t), hor = lerp3(a.hor, b.hor, t);
    const si = a.si + (b.si - a.si) * t, amb = a.amb + (b.amb - a.amb) * t;
    U.uSunColor.value.setRGB(...sunC); U.uZenith.value.setRGB(...zen); U.uHorizon.value.setRGB(...hor);
    const day = Math.min(1, Math.max(0, (e + 15) / 11));
    U.uSunGlow.value = Math.min(1, si / 1.5 + 0.25 * day);
    this.sun.color.setRGB(...sunC);
    this.sun.intensity = si * 0.95;
    this.hemi.color.setRGB(zen[0] * 0.3 + hor[0] * 0.55 + 0.1, zen[1] * 0.3 + hor[1] * 0.55 + 0.1, zen[2] * 0.3 + hor[2] * 0.55 + 0.06);
    this.hemi.groundColor.setRGB(0.20 * amb + 0.05, 0.26 * amb + 0.05, 0.10 * amb + 0.04);
    this.hemi.intensity = 1.15 * amb * (0.45 + 0.55 * Math.min(1, Math.max(0, e / 16))) + (1 - day) * 0.5;
    this.scene.fog.color.setRGB(...hor).multiplyScalar(0.95);
    this.renderer.toneMappingExposure = 0.95 + 0.35 * (1 - Math.min(1, Math.max(0, e / 25)));
    this.aimSun();
    this.refreshEnvironment();
  }

  /** Reflections in the tubes come from the same sky (debounced; PMREM is not free). */
  refreshEnvironment() {
    clearTimeout(this.envTimer);
    this.envTimer = setTimeout(() => {
      const old = this.scene.environment;
      this.scene.environment = this.pmrem.fromScene(this.envScene, 0.02).texture;
      this.scene.environmentIntensity = 0.7;
      if (old) old.dispose();
      this.onChange?.();
    }, this.scene.environment ? 120 : 0);
  }

  setWind(w) { this.uniforms.uWind.value = w; }
  setShadows(on) { this.sun.castShadow = on; }

  /** Per frame: wind animation and the sky following the camera. */
  update(camera, seconds) {
    this.uniforms.uTime.value = seconds;
    this.sky.position.copy(camera.position);
  }
}
