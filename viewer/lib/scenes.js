// Scenes for the glider: a plain studio, a hangar and a hilltop meadow (meadow.js).
// The studio and the hangar are generated in code, like the meadow.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Meadow } from './meadow.js';

export const SCENES = {
  studio: { label: 'Studio' },
  hangar: { label: 'Hangar' },
  hill: { label: 'Hill' },
};

/** Switches between the scenes; the meadow is only built when the hill is first chosen. */
export class Scenes {
  constructor(renderer, scene, { grass = 170000 } = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.grass = grass;
    this.indoor = new Environments(renderer, scene);
    this.meadow = null;
    this.current = null;
    this.hours = 9.5;
    this.wind = 1;
    this.shadows = true;
    this.ground = null;
  }

  set(name) {
    if (!SCENES[name]) name = 'studio';
    this.current = name;
    if (name === 'hill') {
      if (!this.meadow) {
        this.meadow = new Meadow(this.renderer, this.scene, { grass: this.grass });
        this.meadow.setWind(this.wind);
        if (this.ground) this.meadow.place(...this.ground);
      }
      this.indoor.setActive(false);
      this.meadow.setActive(true);
      this.meadow.setShadows(this.shadows);
      this.meadow.setTime(this.hours);
    } else {
      this.meadow?.setActive(false);
      this.indoor.setActive(true);
      this.indoor.set(name, this.shadows);
    }
  }

  place(groundY, center) {
    this.ground = [groundY, center.clone()];
    this.indoor.place(groundY, center);
    this.meadow?.place(groundY, center);
  }

  setTime(h) { this.hours = h; if (this.current === 'hill') this.meadow.setTime(h); }
  setWind(w) { this.wind = w; this.meadow?.setWind(w); }
  setShadows(on) { this.shadows = on; this.indoor.setShadows(on); this.meadow?.setShadows(on); }
  update(camera, seconds) { if (this.current === 'hill') this.meadow.update(camera, seconds); }
}

class Environments {
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
    if (!BUILDERS[name]) name = 'studio';
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

  /** Shows or hides the studio and hangar, with their lights. */
  setActive(on) {
    this.root.visible = on;
    this.sun.visible = this.hemi.visible = this.fill.visible = on;
  }
}

const BUILDERS = { studio: buildStudio, hangar: buildHangar };

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

function mulberry(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
