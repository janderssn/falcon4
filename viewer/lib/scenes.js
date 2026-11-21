// Scenes for the glider: a plain studio, a hangar and a hilltop meadow (meadow.js).
// The studio and the hangar are generated in code, like the meadow.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Meadow } from './meadow.js';
import { buildClubHangar, ROOM } from './clubhouse.js';

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

  /**
   * Where the camera may go, relative to the glider's ground and the scene centre:
   * above the grass on the hill, inside the walls and under the roof in the hangar,
   * anywhere in the studio (looking up from under the floor shows the underside).
   */
  cameraLimits() {
    if (this.current === 'hill') return { minY: 0.5 };
    if (this.current === 'hangar') return { minY: 0.3, maxY: ROOM.wall - 0.4, x: [-ROOM.x + 0.5, ROOM.x - 0.5], z: [ROOM.zBack + 0.5, ROOM.zFront - 0.5] };
    return null;
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

const BUILDERS = { studio: buildStudio, hangar: buildClubHangar };

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



