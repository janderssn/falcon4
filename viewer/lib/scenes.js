// Scenes for the glider: a plain studio, a hangar and a hilltop meadow (meadow.js).
// The studio and the hangar are generated in code, like the meadow.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { Meadow } from './meadow.js';
import { createHangarScene } from './hangar/index.js';

/** Backgrounds for the studio, chosen in Settings. */
export const BACKDROPS = {
  dark: { label: 'Dark' },
  light: { label: 'Light' },
  blueprint: { label: 'Blueprint' },
};

export const SCENES = {
  studio: { label: 'Studio' },
  hangar: { label: 'Hangar' },
  hill: { label: 'Hill' },
};

/**
 * The 2D light from below: the studio sun mirrored under the floor, so a view from below
 * is lit as the view from above. Not from the camera: a light along the view reflects
 * straight back and leaves a pale veil over the sail.
 */
const VIEW_LIGHT = 0.8;
const VIEW_DIR = new THREE.Vector3(3, -8, 5).normalize();

/** Switches between the scenes; the meadow is only built when the hill is first chosen. */
export class Scenes {
  constructor(renderer, scene, { grass = 170000 } = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.grass = grass;
    this.indoor = new Environments(renderer, scene);
    this.meadow = null;
    this.hangar = null;
    this.hangarPreset = 'day';
    this.gliderRoot = null;
    this.current = null;
    this.hours = 9.5;
    this.wind = 1;
    this.shadows = true;
    this.grid = false;
    this.spot = true;
    this.backdrop = 'dark';
    this.ground = null;
    // In 2D, a light from the camera for views from below: the sun lights the top of the
    // wing, and without it the underside comes out dark next to the top view. Always in the
    // scene (at zero when not needed), so switching views doesn't recompile the materials.
    this.viewLight = new THREE.DirectionalLight(0xffffff, 0);
    scene.add(this.viewLight, this.viewLight.target);
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
      this.hangar?.setActive(false);
      this.meadow.setActive(true);
      this.meadow.setShadows(this.shadows);
      this.meadow.setTime(this.hours);
    } else if (name === 'hangar') {
      this.indoor.setActive(false);
      this.meadow?.setActive(false);
      if (!this.hangar) {
        this.hangar = createHangarScene({
          renderer: this.renderer,
          scene: this.scene,
          assetBaseUrl: './hangar/',
          usePostFX: false,
          shadows: this.shadows,
          active: true,
        });
        this.hangar.setWind(this.wind);
        if (this.ground) this.hangar.place(...this.ground);
        if (this.gliderRoot) this.hangar.attachGlider(this.gliderRoot);
        this.hangar.load().catch((e) => console.warn('[hangar] failed to load:', e));
      }
      this.hangar.setActive(true);
      this.hangar.setShadows(this.shadows);
      this.hangar.setPreset(this.hangarPreset);
    } else {
      this.meadow?.setActive(false);
      this.hangar?.setActive(false);
      this.indoor.setActive(true);
      this.indoor.backdrop = this.backdrop;
      this.indoor.set(name, this.shadows);
      this.indoor.spotOn = this.spot;
      this.indoor.setGrid(this.grid);
    }
  }

  place(groundY, center) {
    this.ground = [groundY, center.clone()];
    this.indoor.place(groundY, center);
    this.meadow?.place(groundY, center);
    this.hangar?.place(groundY, center);
  }

  setHangarPreset(mode) {
    this.hangarPreset = mode === 'golden' || mode === 'golden_hour' ? 'golden' : 'day';
    if (this.hangar) this.hangar.setPreset(this.hangarPreset);
  }

  setHangarAudio(on) {
    return this.hangar ? this.hangar.setAudioEnabled(Boolean(on)) : false;
  }

  attachGlider(gliderRoot) {
    this.gliderRoot = gliderRoot || null;
    this.hangar?.attachGlider(this.gliderRoot);
  }

  notifyGliderMoved() {
    this.hangar?.notifyGliderMoved();
  }

  /**
   * Where the camera may go, relative to the glider's ground and the scene centre:
   * above the grass on the hill, above the floor & apron in the open-front hangar,
   * anywhere in the studio (looking up from under the floor shows the underside).
   */
  cameraLimits() {
    if (this.current === 'hill') return { minY: 0.5 };
    if (this.current === 'hangar') return { minY: 0.22 };
    return null;
  }

  setTime(h) {
    this.hours = h;
    if (this.current === 'hill') this.meadow?.setTime(h);
    if (this.current === 'hangar') this.hangar?.setTime(h);
  }
  setWind(w) { this.wind = w; this.meadow?.setWind(w); this.hangar?.setWind(w); }
  setShadows(on) { this.shadows = on; this.indoor.setShadows(on); this.meadow?.setShadows(on); this.hangar?.setShadows(on); }
  /** A metre grid on the studio floor. */
  setGrid(on) { this.grid = on; this.indoor.setGrid(on); }
  /** The soft pool of light under the glider in the studio. */
  setSpot(on) { this.spot = on; this.indoor.setSpot(on); }
  /** The studio background: 'dark', 'light' or 'blueprint'. */
  setBackdrop(name) {
    this.backdrop = BACKDROPS[name] ? name : 'dark';
    this.indoor.setBackdrop(this.backdrop);
  }
  /**
   * Seen from below, the studio floor (grid, spotlight pool, shadow) lies between the camera
   * and the glider and would veil it. Then it draws first, as a background, and the glider
   * covers it.
   */
  floorBehind(camera) {
    const studio = this.indoor.built?.studio;
    if (!studio) return;
    const below = camera.position.y < studio.group.getWorldPosition(new THREE.Vector3()).y;
    if (below === studio.below) return;
    studio.below = below;
    for (const o of [studio.floor, studio.catcher]) {
      const m = o.material;
      m.transparent = !below;
      m.blending = below ? THREE.CustomBlending : THREE.NormalBlending;   // still blended, in the opaque pass
      m.depthTest = !below;
      if (m.userData.depthWrite === undefined) m.userData.depthWrite = m.depthWrite;
      m.depthWrite = below ? false : m.userData.depthWrite;   // or the glider would fail against it
      // The floor's pool of light always draws before the shadow that falls on it. With the same order the
      // two were sorted by distance, which changes as the view turns: the pool then covered the shadow.
      o.renderOrder = (below ? -10 : 0) + (o === studio.floor ? -1 : 0);
      m.needsUpdate = true;
    }
  }

  update(camera, seconds, target) {
    if (this.current === 'hill') this.meadow?.update(camera, seconds);
    if (this.current === 'hangar') this.hangar?.update(camera, seconds, target);
    const look = camera.getWorldDirection(new THREE.Vector3());
    const up = camera.isOrthographicCamera ? Math.max(0, look.y) : 0;   // 1 looking straight up
    this.viewLight.intensity = VIEW_LIGHT * up;
    this.floorBehind(camera);
    this.viewLight.target.position.copy(camera.position).add(look);
    this.viewLight.position.copy(this.viewLight.target.position).addScaledVector(VIEW_DIR, 20);
    this.viewLight.target.updateMatrixWorld();
  }
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
    this.backdrop = 'dark';
    this.gridOn = false;
    this.spotOn = true;
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
    const studio = this.built.studio;
    if (studio) studio.floor.position.set(this.center.x, 0.002, this.center.z);   // centred under the glider
  }

  set(name, shadows = true) {
    if (!BUILDERS[name]) name = 'studio';
    if (!this.built[name]) this.built[name] = BUILDERS[name](this);
    if (name === 'studio') applyBackdrop(this.built.studio, this.backdrop);
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

  setGrid(on) {
    this.gridOn = on;
    const studio = this.built.studio;
    if (!studio) return;
    const u = studio.floor.material.uniforms;
    u.uGrid.value = on ? 1 : 0;
    u.uSpot.value = this.spotOn ? 1 : 0;
    studio.floor.visible = u.uGrid.value + u.uSpot.value > 0;
  }

  setSpot(on) { this.spotOn = on; this.setGrid(this.gridOn); }

  setBackdrop(name) {
    this.backdrop = name;
    if (!this.built.studio) return;
    applyBackdrop(this.built.studio, name);
    this.setGrid(this.gridOn);
    if (this.current === 'studio') this.set('studio', this.sun.castShadow);
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
  // Reflections and fill light from a real photo studio: Poly Haven "Studio Small 09" by
  // Sergej Majboroda (CC0), env/studio_small_09_1k.hdr. Three's room stands in while it loads.
  const room = new RoomEnvironment();
  const envMap = envs.pmrem.fromScene(room, 0.04).texture;
  room.dispose();
  new HDRLoader().loadAsync('./env/studio_small_09_1k.hdr').then((hdr) => {
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    const studio = envs.built.studio;
    studio.envMap = studioReflections(envs.pmrem, hdr);
    hdr.dispose();
    if (envs.current === 'studio') envs.set('studio', envs.sun.castShadow);
  }, (e) => console.warn('Studio HDRI unavailable; using the room light.', e));
  const catcher = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.ShadowMaterial({ opacity: 0.28 }));
  catcher.rotation.x = -Math.PI / 2;
  catcher.receiveShadow = true;
  group.add(catcher);
  const floor = buildFloor();
  group.add(floor);
  return {
    group, floor, catcher, envMap, envIntensity: 0.7, background: new THREE.Color('#222c38'), exposure: 1.05,
    sunColor: 0xfff8eb, sunIntensity: 1.6, sunDir: new THREE.Vector3(3, 8, 5).normalize(),
    hemi: [0xffffff, 0x919781, 0.6], fillIntensity: 0.5,
  };
}

/**
 * The studio photo with long light strips added on a dark floor mat, for
 * reflections only. The photo's floor is an even grey, so a tube seen from below that points
 * at the camera (the keel from the front) reflected nothing but that grey and looked flat and
 * white; the strips, both lengthwise and across, give tubes in every direction a highlight.
 */
function studioReflections(pmrem, hdr) {
  const room = new THREE.Scene();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(50, 64, 32), new THREE.MeshBasicMaterial({ map: hdr, side: THREE.BackSide }));
  sky.scale.x = -1;   // seen from inside: unmirrored, as fromEquirectangular would place it
  room.add(sky);
  const strip = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1).multiplyScalar(STRIP_GAIN) });
  const dark = new THREE.MeshBasicMaterial({ color: 0x080a0c });
  const add = (mat, w, d, x, y, z, rx = -Math.PI / 2, ry = 0) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
    m.position.set(x, y, z); m.rotation.set(rx, ry, 0, 'YXZ');
    room.add(m);
  };
  // On the floor, 2.5 m down: a dark mat with thin bright strips lengthwise and across, so
  // the light from below stays about what the photo gives, only no longer even.
  add(dark, 16, 16, 0, -2.5, 0);
  for (const x of [-2.5, 2.5]) add(strip, 0.35, 16, x, -2.45, 0);
  for (const z of [-3, 3]) add(strip, 16, 0.35, 0, -2.45, z);
  const env = pmrem.fromScene(room, 0.02).texture;
  room.traverse((o) => { o.geometry?.dispose(); });
  strip.dispose(); dark.dispose();
  return env;
}
const STRIP_GAIN = 4;

/**
 * The studio's three backgrounds. Dark and Light are a plain colour with the shadow on an
 * invisible floor; Blueprint is one cyan-blue for floor and sky, with a soft pool of light
 * and a white grid under the glider that fade out before any horizon shows.
 */
const STUDIO_LOOKS = {
  dark: { background: '#222c38', grid: [0xdfe6ee, 0.5], spot: [0x8fb0d0, 0.22], shadow: [0x000000, 0.28], hemi: [0xffffff, 0x919781, 0.6] },
  light: { background: '#cccccc', grid: [0x3c4654, 0.55], spot: [0xffffff, 0.75], shadow: [0x1c2430, 0.2], hemi: [0xffffff, 0xb9bdb3, 0.75] },
  blueprint: { background: '#1f9ee0', grid: [0xffffff, 1], spot: [0xbdeeff, 0.42], shadow: [0x063a6b, 0.3], hemi: [0xe6f7ff, 0x5fb4dc, 0.75] },
};
/** The Light background's shade (Settings, Experimental); the default is #cccccc (RGB 204, 204, 204). */
export const LIGHT_SHADE = STUDIO_LOOKS.light.background;
export function setLightShade(hex) { STUDIO_LOOKS.light.background = hex || LIGHT_SHADE; }
function applyBackdrop(studio, name) {
  const look = STUDIO_LOOKS[name] || STUDIO_LOOKS.dark;
  studio.backdrop = name;
  studio.background = new THREE.Color(look.background);
  const u = studio.floor.material.uniforms;
  u.uGridColor.value.set(look.grid[0]);
  u.uGridGain.value = look.grid[1];
  u.uSpotColor.value.set(look.spot[0]);
  u.uSpotGain.value = look.spot[1];
  u.uBack.value.copy(studio.background).convertLinearToSRGB();   // as shown on screen
  studio.catcher.material.color.set(look.shadow[0]);
  studio.catcher.material.opacity = look.shadow[1];
  studio.hemi = look.hemi;
}

/**
 * Studio floor: a transparent sheet over the plain background with a soft pool of light under
 * the glider and a metre grid, brighter every 5 m. Both fade out with distance, so far away
 * there is only the background colour and no horizon. It is seen from both sides, so the
 * Bottom view looks up through it, and the plan views stand a copy of it up as a wall.
 * uCentre is where the pool of light sits on the sheet (the wall moves it up to the glider).
 */
function buildFloor() {
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, extensions: { derivatives: true }, fog: false,
    uniforms: {
      uGrid: { value: 0 }, uGridColor: { value: new THREE.Color(0xffffff) }, uGridGain: { value: 1 },
      uSpot: { value: 1 }, uSpotColor: { value: new THREE.Color('#bdeeff') }, uSpotGain: { value: 0.42 },
      uCentre: { value: new THREE.Vector2() },
      uBack: { value: new THREE.Color('#222c38').convertLinearToSRGB() },                // the background behind the sheet (for the dither)
      uFade: { value: 1 },                                         // fades the whole floor, for 2D view changes
    },
    vertexShader: `#include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec2 vXY;
      void main() {
        vXY = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `#include <common>
      #include <logdepthbuf_pars_fragment>
      uniform float uGrid, uGridGain, uSpot, uSpotGain, uFade;
      uniform vec3 uGridColor, uSpotColor, uBack;
      uniform vec2 uCentre;
      varying vec2 vXY;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      // Anti-aliased grid lines that also fade where they get closer together than a few pixels.
      float lines(float step, float width) {
        vec2 p = vXY / step, d = fwidth(p);
        vec2 g = abs(fract(p - 0.5) - 0.5) / d;
        float l = 1.0 - min(min(g.x, g.y) / width, 1.0);
        return l * (1.0 - smoothstep(0.05, 0.22, max(d.x, d.y)));
      }
      void main() {
        #include <logdepthbuf_fragment>
        float r = length(vXY - uCentre);
        float spotA = exp(-r * r / 32.0) * uSpotGain * uSpot;               // soft pool of light, ~6 m across
        float grid = max(lines(1.0, 1.0) * 0.45, lines(5.0, 1.5) * 0.7);
        grid *= exp(-r * r / 45.0) * uGridGain * uGrid;                      // gone by about 14 m
        grid = min(grid, 1.0);
        float a = (grid + spotA * (1.0 - grid)) * uFade;
        if (a < 0.0005) discard;
        vec3 c = mix(uSpotColor, uGridColor, grid / max(grid + spotA * (1.0 - grid), 1e-4));
        gl_FragColor = vec4(c, a);
        #include <colorspace_fragment>
        // Dither: the pool's slow fade steps through the 8-bit levels of the screen in rings. Noise of one
        // level (triangular, per pixel) on the alpha hides the steps; it fades out with the pool's last level.
        vec3 d3 = abs(gl_FragColor.rgb - uBack);
        float level = 1.0 / (255.0 * max(max(d3.r, max(d3.g, d3.b)), 0.05));   // alpha of one screen level
        float n = hash(gl_FragCoord.xy) + hash(gl_FragCoord.xy + 17.31) - 1.0;
        gl_FragColor.a = clamp(a + n * level * min(1.0, a / (2.0 * level)), 0.0, 1.0);
      }`,
  }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.002;
  floor.renderOrder = -1;
  floor.name = 'studio floor';
  floor.visible = false;
  return floor;
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
