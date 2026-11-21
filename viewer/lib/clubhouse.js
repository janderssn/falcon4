// A cosy hang gliding club hangar: timber trusses under a corrugated roof, warm
// pendant lamps and string lights, a window onto green hills, a workbench with tools,
// glider bags in racks, helmets and harnesses on the wall, an armchair and a table with
// coffee. Everything is generated in code (boxes, cylinders and canvas textures).
import * as THREE from 'three';

// Room, in metres: the glider stands near the middle; the nose points to +Z.
export const ROOM = { x: 13, zBack: -13, zFront: 10, wall: 5.5, ridge: 9 };

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function tex(w, h, draw, repeat = [1, 1]) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------- textures
const r0 = rng(17);
const grain = (ctx, w, h, base, n = 140) => {
  ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < n; i++) {
    const y = r0() * h, a = 0.05 + r0() * 0.12;
    ctx.strokeStyle = `rgba(${r0() > 0.5 ? '40,22,10' : '255,220,170'},${a})`;
    ctx.lineWidth = 0.5 + r0() * 2;
    ctx.beginPath(); ctx.moveTo(0, y);
    for (let x = 0; x <= w; x += 16) ctx.lineTo(x, y + Math.sin(x / 40 + i) * 2 + (r0() - 0.5) * 2);
    ctx.stroke();
  }
};
const woodTex = (base = '#7a4a28') => tex(256, 64, (ctx, w, h) => grain(ctx, w, h, base), [1, 1]);

function corrugated(base, rust, repeat) {
  return tex(128, 256, (ctx, w, h) => {
    for (let x = 0; x < w; x++) {
      const v = 0.75 + 0.25 * Math.cos((x / w) * Math.PI * 2 * 4);
      ctx.fillStyle = `rgb(${base[0] * v | 0},${base[1] * v | 0},${base[2] * v | 0})`;
      ctx.fillRect(x, 0, 1, h);
    }
    const r = rng(5);
    for (let i = 0; i < 40; i++) {           // rust streaks and stains
      const x = r() * w, y = r() * h, l = 20 + r() * 120;
      const g = ctx.createLinearGradient(0, y, 0, y + l);
      g.addColorStop(0, `rgba(${rust},${0.25 + r() * 0.3})`); g.addColorStop(1, `rgba(${rust},0)`);
      ctx.fillStyle = g; ctx.fillRect(x, y, 2 + r() * 6, l);
    }
  }, repeat);
}

const concrete = tex(512, 512, (ctx, w, h) => {
  ctx.fillStyle = '#8e8a82'; ctx.fillRect(0, 0, w, h);
  const r = rng(9);
  for (let i = 0; i < 9000; i++) {
    const v = 90 + r() * 90;
    ctx.fillStyle = `rgba(${v + 4},${v},${v - 6},${r() * 0.2})`;
    ctx.fillRect(r() * w, r() * h, 1 + r() * 3, 1 + r() * 3);
  }
  for (let i = 0; i < 26; i++) {
    ctx.fillStyle = `rgba(${r() > 0.6 ? '70,62,52' : '175,168,155'},${0.03 + r() * 0.05})`;
    ctx.beginPath(); ctx.ellipse(r() * w, r() * h, 20 + r() * 110, 10 + r() * 60, r() * 3, 0, 7); ctx.fill();
  }
  ctx.strokeStyle = 'rgba(50,40,30,.35)'; ctx.lineWidth = 2; ctx.strokeRect(1, 1, w - 2, h - 2);
}, [ROOM.x * 2 / 4, (ROOM.zFront - ROOM.zBack) / 4]);

/** A landscape: sky, rolling green hills, a hang glider in the sky. */
function landscape(w, h, { glider = true, sun = false, seed = 3 } = {}) {
  return tex(w, h, (ctx) => {
    const sky = ctx.createLinearGradient(0, 0, 0, h * 0.6);
    sky.addColorStop(0, '#6fa6d8'); sky.addColorStop(1, '#e9e2c8');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
    if (sun) { ctx.fillStyle = '#f2b23a'; ctx.beginPath(); ctx.arc(w * 0.62, h * 0.52, h * 0.12, 0, 7); ctx.fill(); }
    const r = rng(seed);
    const greens = ['#7e9d55', '#5f8a3e', '#4a7433', '#3b6029'];
    greens.forEach((g, i) => {
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0, h);
      const base = h * (0.45 + i * 0.12), a = h * (0.05 + r() * 0.05), f = 1.5 + r() * 2, ph = r() * 6;
      for (let x = 0; x <= w; x += 4) ctx.lineTo(x, base - a * Math.sin(x / w * Math.PI * f + ph));
      ctx.lineTo(w, h); ctx.fill();
    });
    if (glider) {
      const gx = w * (0.3 + r() * 0.3), gy = h * (0.18 + r() * 0.1), s = w * 0.07;
      ctx.fillStyle = '#1d2228';
      ctx.beginPath(); ctx.moveTo(gx - s, gy + s * 0.25); ctx.lineTo(gx, gy - s * 0.15); ctx.lineTo(gx + s, gy + s * 0.25); ctx.lineTo(gx, gy + s * 0.08); ctx.fill();
      ctx.strokeStyle = '#1d2228'; ctx.lineWidth = Math.max(1, s * 0.04);
      ctx.beginPath(); ctx.moveTo(gx - s * 0.25, gy + s * 0.55); ctx.lineTo(gx, gy); ctx.lineTo(gx + s * 0.25, gy + s * 0.55); ctx.closePath(); ctx.stroke();
    }
  });
}

const pegboard = tex(512, 256, (ctx, w, h) => {
  ctx.fillStyle = '#b48a5e'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(60,40,20,.55)';
  for (let x = 8; x < w; x += 16) for (let y = 8; y < h; y += 16) { ctx.beginPath(); ctx.arc(x, y, 1.6, 0, 7); ctx.fill(); }
  const r = rng(21);
  const tools = ['#3d3f44', '#5b5f66', '#c43a2b', '#2b5fa8', '#d9a53a', '#2f2f2f'];
  for (let i = 0; i < 26; i++) {
    const x = 16 + (i % 13) * 37 + r() * 6, y = i < 13 ? 30 : 140, len = 60 + r() * 50;
    ctx.fillStyle = tools[Math.floor(r() * tools.length)];
    ctx.fillRect(x, y, 6, len);                                    // handle
    ctx.fillStyle = '#9aa0a8';
    if (r() > 0.5) ctx.fillRect(x - 6, y - 4, 18, 10);             // hammer / spanner head
    else { ctx.beginPath(); ctx.arc(x + 3, y - 2, 8, 0, 7); ctx.fill(); }
  }
});

const banner = tex(512, 320, (ctx, w, h) => {
  ctx.fillStyle = '#e9dcc0'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#f0a630'; ctx.beginPath(); ctx.arc(w * 0.38, h * 0.72, h * 0.13, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.arc(w * 0.64, h * 0.74, h * 0.1, 0, 7); ctx.fill();
  ctx.fillStyle = '#4f7a3a'; ctx.beginPath(); ctx.moveTo(0, h); ctx.quadraticCurveTo(w * 0.3, h * 0.62, w * 0.55, h * 0.8); ctx.quadraticCurveTo(w * 0.8, h * 0.66, w, h * 0.78); ctx.lineTo(w, h); ctx.fill();
  ctx.fillStyle = '#2d5a2a'; ctx.fillRect(0, h * 0.92, w, h * 0.08);
  ctx.fillStyle = '#222'; const gx = w / 2, gy = h * 0.3, s = w * 0.2;
  ctx.beginPath(); ctx.moveTo(gx - s, gy + s * 0.18); ctx.lineTo(gx, gy - s * 0.1); ctx.lineTo(gx + s, gy + s * 0.18); ctx.lineTo(gx, gy + s * 0.05); ctx.fill();
  ctx.strokeStyle = '#222'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(gx - s * 0.18, gy + s * 0.42); ctx.lineTo(gx, gy); ctx.lineTo(gx + s * 0.18, gy + s * 0.42); ctx.closePath(); ctx.stroke();
});

const rug = tex(256, 384, (ctx, w, h) => {
  const bands = ['#7a2a24', '#a8452c', '#3a2a22', '#c58a3a', '#5a2a3a', '#2f4a5a'];
  for (let y = 0; y < h; y += 6) { ctx.fillStyle = bands[(y / 6 | 0) % bands.length]; ctx.fillRect(0, y, w, 6); }
  const r = rng(13);
  for (let i = 0; i < 4000; i++) { ctx.fillStyle = `rgba(0,0,0,${r() * 0.15})`; ctx.fillRect(r() * w, r() * h, 2, 1); }
  ctx.strokeStyle = '#e6d2a8'; ctx.lineWidth = 6; ctx.strokeRect(10, 10, w - 20, h - 20);
});

const map = tex(256, 256, (ctx, w, h) => {
  ctx.fillStyle = '#e8dcbc'; ctx.fillRect(0, 0, w, h);
  const r = rng(31);
  ctx.strokeStyle = 'rgba(120,90,50,.5)';
  for (let i = 0; i < 18; i++) { ctx.beginPath(); ctx.moveTo(r() * w, 0); ctx.bezierCurveTo(r() * w, h / 3, r() * w, h * 2 / 3, r() * w, h); ctx.stroke(); }
  ctx.strokeStyle = 'rgba(60,110,170,.7)'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(0, h * 0.7); ctx.bezierCurveTo(w * 0.3, h * 0.5, w * 0.6, h * 0.9, w, h * 0.6); ctx.stroke();
  ctx.fillStyle = '#c0392b'; for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(r() * w, r() * h, 4, 0, 7); ctx.fill(); }
});

// ---------------------------------------------------------------- building blocks
const M = (o) => new THREE.MeshStandardMaterial(o);
function add(group, geo, mat, x, y, z, { ry = 0, rx = 0, rz = 0, shadow = true } = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = shadow; m.receiveShadow = true;
  group.add(m);
  return m;
}
const box = (g, w, h, d, mat, x, y, z, o) => add(g, new THREE.BoxGeometry(w, h, d), mat, x, y, z, o);
const cyl = (g, r, len, mat, x, y, z, o) => add(g, new THREE.CylinderGeometry(r, r, len, 20), mat, x, y, z, o);
const beam = (g, a, b, size, mat) => {                          // a timber between two points
  const d = new THREE.Vector3().subVectors(b, a), len = d.length();
  const m = new THREE.Mesh(new THREE.BoxGeometry(size, len, size), mat);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  m.castShadow = false; m.receiveShadow = true;   // roof timbers: the roof itself doesn't block the sun
  g.add(m);
  return m;
};

export function buildClubHangar(envs) {
  const { x: X, zBack: ZB, zFront: ZF, wall: H, ridge: R } = ROOM;
  const D = ZF - ZB, zc = (ZF + ZB) / 2;
  const group = new THREE.Group();
  envs.root.add(group);

  const wood = M({ map: woodTex('#6b3f22'), roughness: 0.8 });
  const darkWood = M({ map: woodTex('#4a2c18'), roughness: 0.85 });
  const lightWood = M({ map: woodTex('#9a6a3e'), roughness: 0.75 });
  const wallMetal = M({ map: corrugated([150, 150, 148], '125,72,38', [X * 2 / 0.8, 1]), roughness: 0.55, metalness: 0.4, side: THREE.DoubleSide });
  const endMetal = wallMetal.clone(); endMetal.map = corrugated([150, 150, 148], '125,72,38', [X * 2 / 0.8, 1.5]);
  const roofMetal = M({ map: corrugated([110, 108, 104], '110,60,30', [D / 0.8, 1]), roughness: 0.6, metalness: 0.45, side: THREE.DoubleSide });

  // Floor and painted line.
  const floor = add(group, new THREE.PlaneGeometry(X * 2, D), M({ map: concrete, roughness: 0.9 }), 0, 0, zc, { rx: -Math.PI / 2, shadow: false });
  floor.receiveShadow = true;
  const paint = M({ color: '#e7dfc8', roughness: 0.8 });
  for (let z = ZB + 2; z < ZF - 1; z += 1.6) add(group, new THREE.PlaneGeometry(0.12, 0.9), paint, 5.2, 0.004, z, { rx: -Math.PI / 2, shadow: false });

  // Walls: two long sides and gable ends.
  add(group, new THREE.PlaneGeometry(D, H), wallMetal, -X, H / 2, zc, { ry: Math.PI / 2, shadow: false });
  add(group, new THREE.PlaneGeometry(D, H), wallMetal, X, H / 2, zc, { ry: -Math.PI / 2, shadow: false });
  const gable = new THREE.Shape([new THREE.Vector2(-X, 0), new THREE.Vector2(X, 0), new THREE.Vector2(X, H), new THREE.Vector2(0, R), new THREE.Vector2(-X, H)]);
  const gableGeo = new THREE.ShapeGeometry(gable);
  const uv = gableGeo.attributes.uv, gp = gableGeo.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (gp.getX(i) + X) / (2 * X), gp.getY(i) / R);
  add(group, gableGeo, endMetal, 0, 0, ZB, { shadow: false });
  add(group, gableGeo, endMetal, 0, 0, ZF, { ry: Math.PI, shadow: false });

  // Roof: two slopes, with skylights.
  const slope = Math.hypot(X, R - H), pitch = Math.atan2(R - H, X);
  const flat = (w, d) => new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2);   // lying in X-Z, facing up
  const skylight = M({ color: '#dfeaf2', emissive: '#cfe0ee', emissiveIntensity: 1.4, side: THREE.DoubleSide });
  for (const s of [-1, 1]) {
    // Each slope rises from the wall (x = s*X) to the ridge (x = 0).
    add(group, flat(slope, D), roofMetal, s * X / 2, (H + R) / 2, zc, { rz: -s * pitch, shadow: false });
    for (const z of [ZB + 5, zc + 1, ZF - 5]) {
      add(group, flat(1.4, 2.6), skylight, s * X * 0.45, H + (R - H) * 0.55 - 0.03, z, { rz: -s * pitch, shadow: false });
    }
  }

  // Timber trusses with string lights along the tie beams.
  const bulb = M({ color: '#fff2c8', emissive: '#ffcf7a', emissiveIntensity: 3 });
  const bulbGeo = new THREE.SphereGeometry(0.035, 8, 6);
  for (let z = ZB + 2.5; z < ZF; z += 4) {
    const L = new THREE.Vector3(-X, H, z), Rr = new THREE.Vector3(X, H, z), top = new THREE.Vector3(0, R - 0.1, z);
    beam(group, L, top, 0.24, wood); beam(group, Rr, top, 0.24, wood);
    beam(group, L, Rr, 0.22, wood);                                   // tie beam
    beam(group, new THREE.Vector3(0, H, z), top, 0.18, wood);         // king post
    for (const s of [-1, 1]) {
      beam(group, new THREE.Vector3(0, H, z), new THREE.Vector3(s * X * 0.5, (H + R) / 2, z), 0.14, wood);
      box(group, 0.3, 0.3, 0.06, M({ color: '#2b2b2b', metalness: 0.7, roughness: 0.4 }), s * X * 0.5, (H + R) / 2 - 0.05, z, { shadow: false });   // steel plate
    }
    for (let i = 0; i <= 26; i++) {                                    // string lights sag between posts
      const t = i / 26, x = -X + 0.5 + t * (2 * X - 1);
      const m = new THREE.Mesh(bulbGeo, bulb);
      m.position.set(x, H - 0.16 - Math.sin(t * Math.PI * 4) ** 2 * 0.18, z + 0.12);
      group.add(m);
    }
  }
  for (const s of [-1, 1]) beam(group, new THREE.Vector3(s * X * 0.5, (H + R) / 2 + 0.25, ZB), new THREE.Vector3(s * X * 0.5, (H + R) / 2 + 0.25, ZF), 0.18, darkWood);   // purlins
  beam(group, new THREE.Vector3(0, R - 0.1, ZB), new THREE.Vector3(0, R - 0.1, ZF), 0.22, darkWood);

  // Pendant lamps: green enamel shades with warm bulbs.
  const shade = M({ color: '#2f4a32', roughness: 0.45, metalness: 0.3, side: THREE.DoubleSide });
  const glow = M({ color: '#fff4d6', emissive: '#ffc874', emissiveIntensity: 6 });
  for (const [x, z] of [[-2.5, -4], [3.5, 1], [-5, 5]]) {
    const y = H - 0.9;
    cyl(group, 0.006, R - y - 0.4, M({ color: '#111' }), x, (R - 0.4 + y) / 2, z, { shadow: false });
    add(group, new THREE.ConeGeometry(0.42, 0.3, 28, 1, true), shade, x, y, z, { shadow: false });
    add(group, new THREE.SphereGeometry(0.1, 12, 8), glow, x, y - 0.12, z, { shadow: false });
    const lamp = new THREE.PointLight('#ffc98a', 30, 16, 2);
    lamp.position.set(x, y - 0.25, z);
    group.add(lamp);
  }

  // Left wall: window onto the hills, workbench, pegboard, shelves, a plant.
  const view = M({ map: landscape(512, 320, { glider: true, seed: 7 }), emissive: '#ffffff', emissiveMap: null, emissiveIntensity: 0, roughness: 1 });
  view.emissiveMap = view.map; view.emissive.set('#ffffff'); view.emissiveIntensity = 1.1;
  add(group, new THREE.PlaneGeometry(4.2, 2.6), view, -X + 0.03, 2.5, 1.5, { ry: Math.PI / 2, shadow: false });
  for (let i = 0; i <= 4; i++) box(group, 0.08, 2.7, 0.08, lightWood, -X + 0.08, 2.5, -0.6 + i * 1.05);
  for (const y of [1.2, 2.5, 3.8]) box(group, 0.08, 0.08, 4.3, lightWood, -X + 0.08, y, 1.5);
  // Bench.
  box(group, 0.9, 0.08, 6, lightWood, -X + 0.6, 0.95, -6);
  for (const z of [-8.8, -3.2]) for (const dx of [0.2, 0.95]) box(group, 0.08, 0.95, 0.08, darkWood, -X + dx, 0.47, z);
  box(group, 0.8, 0.06, 5.8, darkWood, -X + 0.6, 0.3, -6);
  add(group, new THREE.PlaneGeometry(6, 1.6), M({ map: pegboard, roughness: 0.85 }), -X + 0.04, 1.95, -6, { ry: Math.PI / 2, shadow: false });
  for (const y of [3.1, 3.8]) {
    box(group, 0.35, 0.05, 6, lightWood, -X + 0.2, y, -6);
    const r = rng(y * 10);
    for (let z = -8.8; z < -3.3; z += 0.25 + r() * 0.2) {
      const h = 0.12 + r() * 0.22, c = ['#c43a2b', '#2b5fa8', '#d9a53a', '#3f6d3a', '#e8e0cc', '#6b4a8a'][Math.floor(r() * 6)];
      if (r() > 0.4) box(group, 0.22, h, 0.12 + r() * 0.12, M({ color: c, roughness: 0.7 }), -X + 0.22, y + h / 2 + 0.025, z, { shadow: false });
      else cyl(group, 0.06, h, M({ color: c, roughness: 0.5, metalness: 0.3 }), -X + 0.22, y + h / 2 + 0.025, z, { shadow: false });
    }
  }
  // Bench things: lamp, mugs, a small plant.
  cyl(group, 0.05, 0.1, M({ color: '#e9e2d0', roughness: 0.5 }), -X + 0.55, 1.04, -4.2);
  cyl(group, 0.05, 0.1, M({ color: '#c9b48a', roughness: 0.5 }), -X + 0.7, 1.04, -4.5);
  add(group, new THREE.ConeGeometry(0.14, 0.18, 16, 1, true), shade, -X + 0.5, 1.5, -7.5, { rx: 0.5, shadow: false });
  // Hanging plant by the window.
  const leaf = M({ color: '#4f7f36', roughness: 0.8 });
  cyl(group, 0.18, 0.2, M({ color: '#8a5a3a', roughness: 0.8 }), -X + 0.6, 3.9, -1.3);
  const rp = rng(4);
  for (let i = 0; i < 28; i++) add(group, new THREE.IcosahedronGeometry(0.08 + rp() * 0.07, 0), leaf, -X + 0.6 + (rp() - 0.5) * 0.4, 3.95 - rp() * 1.2, -1.3 + (rp() - 0.5) * 0.4, { shadow: false });

  // Back wall: club banner and framed posters.
  add(group, new THREE.PlaneGeometry(3.4, 2.1), M({ map: banner, roughness: 0.95 }), 0, 4.1, ZB + 0.05, { shadow: false });
  const frame = M({ color: '#3a2615', roughness: 0.7 });
  [[-7.5, 3.0, 5], [-4.8, 2.6, 9], [6.5, 3.2, 12]].forEach(([x, y, seed]) => {
    box(group, 1.5, 1.1, 0.05, frame, x, y, ZB + 0.04, { shadow: false });
    add(group, new THREE.PlaneGeometry(1.36, 0.96), M({ map: landscape(256, 180, { seed, sun: seed > 8 }), roughness: 0.9 }), x, y, ZB + 0.075, { shadow: false });
  });
  // Crates along the back.
  const crate = M({ map: woodTex('#9b7448'), roughness: 0.85 });
  for (const [x, w, h, d] of [[-10.5, 0.9, 0.6, 0.7], [-9.5, 0.7, 0.5, 0.6], [9.6, 1.0, 0.7, 0.8], [10.6, 0.8, 0.45, 0.6]]) box(group, w, h, d, crate, x, h / 2, ZB + 0.6);

  // Right wall: racked glider bags, helmets, harnesses, map, standing bags.
  const bagColours = ['#c8c2b2', '#2c4f8a', '#b8312a', '#5c6670', '#2f3f63'];
  for (const [y, n] of [[4.15, 3], [3.55, 2]]) {
    box(group, 0.5, 0.05, 6.2, darkWood, X - 0.3, y - 0.25, -3);
    for (let i = 0; i < n; i++) cyl(group, 0.16, 6, M({ color: bagColours[(i + n) % 5], roughness: 0.75 }), X - 0.2 - i * 0.33, y, -3, { rx: Math.PI / 2 });
  }
  box(group, 0.35, 0.05, 3.6, lightWood, X - 0.2, 2.3, -6.8);
  const helmet = new THREE.SphereGeometry(0.16, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  ['#2a2a2c', '#4a4a4e', '#d8d8d8', '#c8202a', '#2058c0', '#e8c020'].forEach((c, i) => add(group, helmet, M({ color: c, roughness: 0.3, metalness: 0.1 }), X - 0.2, 2.33, -8.3 + i * 0.6));
  const rh = rng(8);
  ['#2b2b30', '#7a1f2a', '#1f4a6a', '#2b2b30', '#5b2a6a', '#1f3a5a', '#2a5a3a'].forEach((c, i) => {
    const z = -8.4 + i * 0.55;
    cyl(group, 0.012, 0.25, M({ color: '#888', metalness: 0.8 }), X - 0.2, 1.95, z, { shadow: false });
    add(group, new THREE.CapsuleGeometry(0.17, 0.7 + rh() * 0.2, 4, 10), M({ color: c, roughness: 0.8 }), X - 0.24, 1.3, z);
    add(group, new THREE.TorusGeometry(0.1, 0.012, 6, 16), M({ color: '#d9b030', metalness: 0.6, roughness: 0.4 }), X - 0.4, 1.6, z, { ry: Math.PI / 2, shadow: false });
  });
  add(group, new THREE.PlaneGeometry(1.4, 1.2), M({ map: map, roughness: 0.9 }), X - 0.04, 2.6, -1.4, { ry: -Math.PI / 2, shadow: false });
  ['#b8312a', '#5c6670', '#b8312a', '#c8c2b2', '#2c4f8a'].forEach((c, i) => {
    cyl(group, 0.15, 5.2, M({ color: c, roughness: 0.75 }), X - 0.35 - (i % 2) * 0.2, 2.55, 1.2 + i * 0.4, { rz: 0.09 });
  });
  for (const [z, c] of [[4.2, '#c03a6a'], [4.6, '#d9a020'], [5.0, '#2a6aa0']]) add(group, new THREE.TorusGeometry(0.22, 0.03, 6, 20), M({ color: c, roughness: 0.6 }), X - 0.1, 2.2, z, { ry: Math.PI / 2, shadow: false });   // coiled lines

  // Lounge corner: rug, leather armchair, table with coffee, magazines.
  add(group, new THREE.PlaneGeometry(3.6, 4.6), M({ map: rug, roughness: 1 }), -8.2, 0.006, 6.4, { rx: -Math.PI / 2, rz: 0.15, shadow: false });
  const leather = M({ color: '#5a321c', roughness: 0.45, metalness: 0.05 });
  const chair = new THREE.Group();
  box(chair, 1.1, 0.4, 1.0, leather, 0, 0.35, 0);
  box(chair, 1.1, 0.8, 0.25, leather, 0, 0.75, -0.42);
  for (const s of [-1, 1]) box(chair, 0.22, 0.6, 1.0, leather, s * 0.55, 0.55, 0);
  box(chair, 0.9, 0.12, 0.8, M({ color: '#a63a2c', roughness: 0.9 }), 0.05, 0.6, 0.05, { rz: 0.06 });   // tartan throw
  chair.position.set(-10.4, 0, 5.2); chair.rotation.y = 0.9;
  group.add(chair);
  const table = new THREE.Group();
  box(table, 1.6, 0.07, 1.0, lightWood, 0, 0.75, 0);
  for (const sx of [-0.7, 0.7]) for (const sz of [-0.4, 0.4]) box(table, 0.07, 0.75, 0.07, darkWood, sx, 0.375, sz);
  const mug = M({ color: '#ece4d2', roughness: 0.4 });
  cyl(table, 0.045, 0.1, mug, -0.3, 0.84, 0.1); cyl(table, 0.045, 0.1, mug, 0.15, 0.84, -0.2);
  cyl(table, 0.06, 0.2, M({ color: '#3a1e10', roughness: 0.2, transparent: true, opacity: 0.85 }), -0.55, 0.89, -0.25);   // French press
  box(table, 0.42, 0.012, 0.3, M({ map: landscape(256, 180, { seed: 11 }), roughness: 0.6 }), 0.35, 0.79, 0.2, { ry: 0.3, shadow: false });
  box(table, 0.4, 0.012, 0.28, M({ map: map, roughness: 0.8 }), 0.0, 0.8, 0.25, { ry: -0.2, shadow: false });
  table.position.set(-8, 0, 7.2); table.rotation.y = 0.2;
  group.add(table);
  for (const [x, z, ry] of [[-7.2, 6.4, 2.6], [-8.6, 8.0, -0.4]]) {
    const c = new THREE.Group();
    box(c, 0.45, 0.05, 0.45, lightWood, 0, 0.46, 0);
    for (const sx of [-0.18, 0.18]) for (const sz of [-0.18, 0.18]) box(c, 0.04, 0.46, 0.04, darkWood, sx, 0.23, sz);
    for (let i = 0; i < 5; i++) box(c, 0.03, 0.5, 0.03, lightWood, -0.18 + i * 0.09, 0.73, -0.2);
    box(c, 0.45, 0.05, 0.04, lightWood, 0, 0.98, -0.2);
    c.position.set(x, 0, z); c.rotation.y = ry;
    group.add(c);
  }

  // Front right: kit trunk and duffel bags.
  box(group, 1.2, 0.8, 0.7, M({ color: '#3d5a3a', roughness: 0.6, metalness: 0.2 }), 9.6, 0.4, 7.8, { ry: -0.25 });
  for (const [x, z, c] of [[8.2, 7.4, '#283a6a'], [8.5, 8.4, '#22325a']]) add(group, new THREE.CapsuleGeometry(0.28, 0.6, 4, 12), M({ color: c, roughness: 0.85 }), x, 0.28, z, { rz: Math.PI / 2, ry: 0.4 });

  // Reflections: render the room itself, with its lamps, into an environment map.
  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color('#3a2a1c');
  const copy = group.clone();
  copy.position.y = -1.5;
  envScene.add(copy, new THREE.HemisphereLight(0xffe2b8, 0x4a3422, 2.2));
  const envMap = envs.pmrem.fromScene(envScene, 0.03).texture;

  return {
    group, envMap, envIntensity: 0.6, background: new THREE.Color('#2b2016'), exposure: 1.14,
    sunColor: 0xffe6c4, sunIntensity: 0.9, sunDir: new THREE.Vector3(-0.35, 1, 0.45).normalize(),
    hemi: [0xfff0dc, 0x6a5c4c, 0.85], fillIntensity: 0.12,
  };
}
