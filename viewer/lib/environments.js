// Scene environments: studio (plain), hangar and a mountain launch site.
// Everything is generated in code, so no extra downloads are needed.
// Each environment sits on the ground plane (y = 0 of its group); the app
// moves the group to the lowest point of the loaded glider.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Sky } from 'three/addons/objects/Sky.js';

export const ENVIRONMENTS = {
  studio: { label: 'Studio', detail: 'Plain backdrop, soft room light' },
  hangar: { label: 'Hangar', detail: 'Hangar floor with skylights' },
  mountain: { label: 'Mountain launch', detail: 'Launch ramp above a valley' },
};

export class Environments {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.scene = scene;
    this.root = new THREE.Group();
    this.root.name = 'environment';
    scene.add(this.root);
    this.built = {};
    this.current = null;
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    const s = this.sun.shadow.camera;
    s.left = -9; s.right = 9; s.top = 9; s.bottom = -9; s.near = 0.5; s.far = 60;
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x919781, 0.6);
    this.fill = new THREE.DirectionalLight(0xe0f0ff, 0.5);
    this.fill.position.set(-3, -3, -5);
    scene.add(this.sun, this.sun.target, this.hemi, this.fill);
  }

  /** Centre of the glider on the ground; the sun's shadow box follows it. */
  place(groundY, center) {
    this.root.position.y = groundY;
    this.center = center.clone();
    this.groundY = groundY;
    this.aimSun();
  }

  aimSun() {
    if (!this.center || !this.current) return;
    const dir = this.built[this.current].sunDir;
    this.sun.target.position.copy(this.center);
    this.sun.position.copy(this.center).addScaledVector(dir, 25);
    this.sun.target.updateMatrixWorld();
  }

  set(name, shadows = true) {
    if (!ENVIRONMENTS[name]) name = 'studio';
    if (!this.built[name]) this.built[name] = BUILDERS[name](this);
    for (const [key, env] of Object.entries(this.built)) env.group.visible = key === name;
    const env = this.built[name];
    this.current = name;
    this.scene.background = env.background;
    this.scene.environment = env.envMap;
    this.scene.environmentIntensity = env.envIntensity;
    this.scene.fog = env.fog || null;
    this.sun.color.set(env.sunColor);
    this.sun.intensity = env.sunIntensity;
    this.hemi.color.set(env.hemi[0]); this.hemi.groundColor.set(env.hemi[1]); this.hemi.intensity = env.hemi[2];
    this.fill.intensity = env.fillIntensity;
    this.renderer.toneMappingExposure = env.exposure;
    this.setShadows(shadows);
    this.aimSun();
  }

  setShadows(on) {
    this.sun.castShadow = on;
    this.renderer.shadowMap.needsUpdate = true;
  }
}

const BUILDERS = { studio: buildStudio, hangar: buildHangar, mountain: buildMountain };

function buildStudio(envs) {
  const group = new THREE.Group();
  envs.root.add(group);
  const room = new RoomEnvironment();
  const envMap = envs.pmrem.fromScene(room, 0.04).texture;
  room.dispose();
  const catcher = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.ShadowMaterial({ opacity: 0.28 }));
  catcher.rotation.x = -Math.PI / 2;
  catcher.receiveShadow = true;
  group.add(catcher);
  return {
    group, envMap, envIntensity: 0.7, background: new THREE.Color('#222c38'), exposure: 1.05,
    sunColor: 0xfff8eb, sunIntensity: 1.6, sunDir: new THREE.Vector3(3, 8, 5).normalize(),
    hemi: [0xffffff, 0x919781, 0.6], fillIntensity: 0.5,
  };
}

// ---------------------------------------------------------------- hangar

function canvasTexture(w, h, draw, repeat = [1, 1], srgb = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function speckle(ctx, w, h, n, alpha, light) {
  const rnd = mulberry(7);
  for (let i = 0; i < n; i++) {
    const v = Math.floor(rnd() * 60) + (light ? 150 : 40);
    ctx.fillStyle = `rgba(${v},${v},${v},${alpha * rnd()})`;
    ctx.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 3, 1 + rnd() * 3);
  }
}

function buildHangar(envs) {
  const W = 46, D = 40, H = 13;
  const group = new THREE.Group();
  envs.root.add(group);

  // Polished concrete: 5 m slabs with saw cuts, a painted safety line near the walls.
  const concrete = canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#8d9196'; ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 9000, 0.25, true);
    speckle(ctx, w, h, 6000, 0.2, false);
    const rnd = mulberry(3);
    for (let i = 0; i < 18; i++) {
      ctx.fillStyle = `rgba(60,62,66,${0.02 + rnd() * 0.03})`;
      ctx.beginPath(); ctx.ellipse(rnd() * w, rnd() * h, 20 + rnd() * 80, 10 + rnd() * 50, rnd() * 3, 0, 7); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(40,42,46,.55)'; ctx.lineWidth = 2; ctx.strokeRect(1, 1, w - 2, h - 2);
  }, [W / 5, D / 5]);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ map: concrete, roughness: 0.55, metalness: 0 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);
  const line = new THREE.MeshStandardMaterial({ color: '#e0b422', roughness: 0.6 });
  for (const [w, d, x, z] of [[W - 4, 0.12, 0, -D / 2 + 2], [0.12, D - 4, -W / 2 + 2, 0], [0.12, D - 4, W / 2 - 2, 0]]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), line);
    m.rotation.x = -Math.PI / 2; m.position.set(x, 0.004, z); m.receiveShadow = true;
    group.add(m);
  }
  // Parking "T" for the glider.
  for (const [w, d, x, z] of [[3, 0.15, 0, 3.6], [0.15, 4, 0, 1.6]]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ color: '#e8e8e2', roughness: 0.6 }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, 0.004, z); m.receiveShadow = true;
    group.add(m);
  }

  // Corrugated steel walls.
  const ribs = canvasTexture(64, 256, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, '#a9b3bb'); g.addColorStop(0.45, '#d5dce1'); g.addColorStop(0.55, '#cfd6db'); g.addColorStop(1, '#a3adb5');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }, [W / 0.4, 1]);
  const wallMat = new THREE.MeshStandardMaterial({ map: ribs, roughness: 0.5, metalness: 0.35, side: THREE.DoubleSide });
  const back = new THREE.Mesh(new THREE.PlaneGeometry(W, H), wallMat);
  back.position.set(0, H / 2, -D / 2);
  group.add(back);
  const sideMat = wallMat.clone();
  sideMat.map = ribs.clone(); sideMat.map.repeat.set(D / 0.4, 1); sideMat.map.needsUpdate = true;
  for (const s of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(D, H), sideMat);
    wall.rotation.y = s * Math.PI / 2; wall.position.set(-s * W / 2, H / 2, 0);
    group.add(wall);
  }
  // Front: open sliding doors (frame above the opening, door panels pushed aside).
  const frameMat = new THREE.MeshStandardMaterial({ color: '#4a535c', roughness: 0.6, metalness: 0.5 });
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(W, 3, 0.4), frameMat);
  lintel.position.set(0, H - 1.5, D / 2);
  group.add(lintel);
  for (const s of [-1, 1]) {
    const door = new THREE.Mesh(new THREE.BoxGeometry(7, H - 3, 0.25), wallMat);
    door.position.set(s * (W / 2 - 3.5), (H - 3) / 2, D / 2 - 0.2);
    group.add(door);
  }
  // Apron outside the door.
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(400, 300), new THREE.MeshStandardMaterial({ color: '#6f7a72', roughness: 1 }));
  apron.rotation.x = -Math.PI / 2; apron.position.set(0, -0.02, D / 2 + 150);
  group.add(apron);

  // Roof with steel trusses and skylight panels.
  const roof = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ color: '#5b646c', roughness: 0.8, side: THREE.DoubleSide }));
  roof.rotation.x = Math.PI / 2; roof.position.y = H;
  group.add(roof);
  const beamMat = new THREE.MeshStandardMaterial({ color: '#2f6a9a', roughness: 0.5, metalness: 0.6 });
  const lamp = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff6e8', emissiveIntensity: 4 });
  for (let z = -D / 2 + 4; z < D / 2; z += 6) {
    const chord = new THREE.Mesh(new THREE.BoxGeometry(W, 0.35, 0.25), beamMat);
    chord.position.set(0, H - 1.6, z); group.add(chord);
    const top = new THREE.Mesh(new THREE.BoxGeometry(W, 0.3, 0.25), beamMat);
    top.position.set(0, H - 0.2, z); group.add(top);
    for (let x = -W / 2 + 2; x < W / 2; x += 2) {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.9, 0.1), beamMat);
      strut.position.set(x, H - 0.9, z); strut.rotation.z = (x / 2) % 2 ? 0.6 : -0.6; group.add(strut);
    }
    for (const x of [-12, 0, 12]) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(4, 0.08, 0.6), lamp);
      l.position.set(x, H - 1.9, z + 3); group.add(l);
    }
  }
  // A few props along the walls.
  const crate = new THREE.MeshStandardMaterial({ color: '#8b6b43', roughness: 0.85 });
  const cabinet = new THREE.MeshStandardMaterial({ color: '#b2372d', roughness: 0.45, metalness: 0.3 });
  for (const [w, h, d, x, z, m] of [[1.2, 1, 1, -19, -17, crate], [1, 0.8, 1.2, -17.6, -17.3, crate], [1.2, 1.9, 0.6, 14, -19.3, cabinet], [1.2, 1.9, 0.6, 15.4, -19.3, cabinet], [2.2, 0.9, 0.8, 21, -8, crate]]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    b.position.set(x, h / 2, z); b.castShadow = b.receiveShadow = true; group.add(b);
  }

  // Reflections: render the hangar itself (no glider) into an environment map.
  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color('#b9c6d2');
  const copy = group.clone();
  copy.position.y = -1.6;
  envScene.add(copy, new THREE.HemisphereLight(0xffffff, 0x777777, 2));
  const envMap = envs.pmrem.fromScene(envScene, 0.03).texture;
  return {
    group, envMap, envIntensity: 0.8, background: new THREE.Color('#c7d3de'), exposure: 1.0,
    sunColor: 0xfff4e2, sunIntensity: 1.3, sunDir: new THREE.Vector3(0.4, 1, 0.5).normalize(),
    hemi: [0xf2f5ff, 0x8a8d90, 0.85], fillIntensity: 0.35,
  };
}

// ---------------------------------------------------------------- mountain

function mulberry(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeNoise(seed) {
  const rnd = mulberry(seed);
  const perm = new Uint8Array(512);
  const p = [...Array(256).keys()].sort(() => rnd() - 0.5);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const grad = (h, x, y) => ((h & 1) ? x : -x) + ((h & 2) ? y : -y);
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const noise = (x, y) => {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
    x -= Math.floor(x); y -= Math.floor(y);
    const u = fade(x), v = fade(y);
    const a = perm[X] + Y, b = perm[X + 1] + Y;
    return THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(grad(perm[a], x, y), grad(perm[b], x - 1, y), u),
      THREE.MathUtils.lerp(grad(perm[a + 1], x, y - 1), grad(perm[b + 1], x - 1, y - 1), u), v);
  };
  return (x, y, octaves = 5) => {
    let sum = 0, amp = 1, f = 1, norm = 0;
    for (let i = 0; i < octaves; i++) { sum += amp * noise(x * f, y * f); norm += amp; amp *= 0.5; f *= 2.03; }
    return sum / norm;
  };
}

const smooth = (a, b, x) => { const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const EDGE = 15;   // the launch edge is 15 m in front of the glider (+Z)

function terrainHeight(fbm, x, z) {
  const r = Math.hypot(x, z);
  const flat = smooth(18, 60, r);            // keep the launch area flat
  let h = 0;
  // Mountain behind the launch rises gently, the slope in front drops into the valley.
  h += smooth(-30, -400, z) * 220 + Math.max(0, -z - 30) * 0.12;
  const drop = smooth(EDGE, EDGE + 40, z) * (z - EDGE) * 0.8 + smooth(EDGE + 30, 1100, z) * 520;
  h -= Math.min(drop, 720);
  // The ridge continues to both sides.
  h += smooth(30, 200, Math.abs(x)) * 60 * (1 - smooth(EDGE, 300, z) * 0.7);
  // Mountains around the valley.
  h += smooth(900, 2200, r) * (380 + fbm(x / 520, z / 520, 4) * 900);
  h += fbm(x / 140, z / 140) * 28 * flat + fbm(x / 22, z / 22, 3) * 1.6 * flat;
  // The ramp deck is the glider's ground; the grass sits a little below it.
  h -= 0.55 * (1 - smooth(12, 26, Math.hypot(x * 1.4, z)));
  h += fbm(x / 3, z / 3, 2) * 0.06;
  return h;
}

function buildMountain(envs) {
  const group = new THREE.Group();
  envs.root.add(group);
  const fbm = makeNoise(11);

  // Terrain grid that is dense near the glider and coarse far away.
  const N = 300, R = 4200;
  const geo = new THREE.PlaneGeometry(2, 2, N, N);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const warp = (s) => Math.sign(s) * (Math.abs(s) ** 3 * (R - 40) + Math.abs(s) * 40);
  for (let i = 0; i < pos.count; i++) {
    const x = warp(pos.getX(i)), z = warp(pos.getZ(i));
    pos.setXYZ(i, x, terrainHeight(fbm, x, z), z);
  }
  geo.computeVertexNormals();
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const grass = new THREE.Color('#5b7a33'), dry = new THREE.Color('#8f8a4f'), rock = new THREE.Color('#7a7368'), snow = new THREE.Color('#f2f4f6'), forest = new THREE.Color('#2f4a2a');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const ny = geo.attributes.normal.getY(i);
    const n = fbm(x / 60, z / 60, 3);
    c.copy(grass).lerp(dry, smooth(-0.2, 0.5, n));
    if (y < -200) c.lerp(forest, smooth(-200, -420, y) * 0.8);
    c.lerp(rock, smooth(0.85, 0.6, ny));
    c.lerp(snow, smooth(380, 620, y + n * 80) * smooth(0.45, 0.7, ny));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  // World-space UVs for a grass detail texture that tiles every 4 m.
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / 4, pos.getZ(i) / 4);
  const detail = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#e6e6e6'; ctx.fillRect(0, 0, w, h);
    const rnd = mulberry(5);
    for (let i = 0; i < 2600; i++) {
      const v = 150 + rnd() * 105;
      ctx.strokeStyle = `rgba(${v * 0.95},${v},${v * 0.8},${0.25 + rnd() * 0.35})`;
      ctx.lineWidth = 0.6 + rnd();
      const x = rnd() * w, y = rnd() * h;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (rnd() - 0.5) * 4, y - 3 - rnd() * 6); ctx.stroke();
    }
  });
  const terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, map: detail, roughness: 0.95 }));
  terrain.receiveShadow = true;
  group.add(terrain);

  // Wooden launch ramp: the glider stands on the deck, which overhangs the edge.
  const plank = canvasTexture(256, 256, (ctx, w, h) => {
    for (let i = 0; i < 8; i++) {
      const v = 120 + ((i * 37) % 40);
      ctx.fillStyle = `rgb(${v + 20},${v - 10},${v - 50})`;
      ctx.fillRect(0, i * h / 8, w, h / 8 - 2);
      ctx.fillStyle = 'rgba(40,25,10,.6)'; ctx.fillRect(0, (i + 1) * h / 8 - 2, w, 2);
    }
    speckle(ctx, w, h, 2500, 0.15, false);
  }, [1, 6]);
  const wood = new THREE.MeshStandardMaterial({ map: plank, roughness: 0.8 });
  const deckLength = 26, deckStart = -8;
  // Level under the glider, then sloping down over the edge.
  const deckGeo = new THREE.BoxGeometry(5, 0.12, deckLength, 1, 1, 13);
  const dp = deckGeo.attributes.position;
  for (let i = 0; i < dp.count; i++) {
    const z = dp.getZ(i) + deckStart + deckLength / 2;
    dp.setY(i, dp.getY(i) + (z > 6 ? -(z - 6) * 0.22 : 0));
  }
  deckGeo.computeVertexNormals();
  const deck = new THREE.Mesh(deckGeo, wood);
  deck.position.set(0, -0.06, deckStart + deckLength / 2);
  deck.castShadow = deck.receiveShadow = true;
  group.add(deck);
  const post = new THREE.MeshStandardMaterial({ color: '#5a4630', roughness: 0.9 });
  for (let z = deckStart + 1; z < deckStart + deckLength; z += 3) {
    for (const x of [-2.2, 2.2]) {
      const top = z > 6 ? -(z - 6) * 0.22 - 0.1 : -0.1;
      const ground = terrainHeight(fbm, x, z);
      const len = top - ground;
      if (len < 0.2) continue;
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, len, 8), post);
      p.position.set(x, ground + len / 2, z); p.castShadow = true; group.add(p);
    }
  }
  // Windsock.
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 6, 8), new THREE.MeshStandardMaterial({ color: '#d8d8d8', metalness: 0.6, roughness: 0.4 }));
  pole.position.set(9, 3, 9); pole.castShadow = true; group.add(pole);
  const sockGeo = new THREE.CylinderGeometry(0.28, 0.12, 1.8, 16, 4, true);
  sockGeo.rotateZ(Math.PI / 2);
  sockGeo.translate(0.9, 0, 0);
  const sock = new THREE.Mesh(sockGeo, new THREE.MeshStandardMaterial({ color: '#f26a1b', roughness: 0.7, side: THREE.DoubleSide }));
  sock.position.set(9, 5.7, 9); sock.rotation.set(0, Math.PI * 0.62, -0.12); sock.castShadow = true;
  group.add(sock);

  // Physical sky; the same sky lights the scene through an environment map.
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(58), THREE.MathUtils.degToRad(35));
  const makeSky = () => {
    const sky = new Sky();
    sky.scale.setScalar(5000);
    const u = sky.material.uniforms;
    u.turbidity.value = 3.5; u.rayleigh.value = 1.2; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.8;
    u.sunPosition.value.copy(sunDir);
    return sky;
  };
  const sky = makeSky();
  sky.material.depthWrite = false;
  group.add(sky);
  const skyScene = new THREE.Scene();
  skyScene.add(makeSky());
  const envMap = envs.pmrem.fromScene(skyScene).texture;
  return {
    group, envMap, envIntensity: 0.55, background: null, exposure: 0.62,
    fog: new THREE.Fog('#b4c6d8', 900, 5200),
    sunColor: 0xfff1dc, sunIntensity: 2.6, sunDir,
    hemi: [0xbcd6ff, 0x5b6b3a, 0.55], fillIntensity: 0.15,
  };
}
