// Scenes for the glider: a plain studio, a hangar and a hilltop meadow (meadow.js).
// The studio and the hangar are generated in code, like the meadow.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Meadow } from './meadow.js';
import { GroundedSkybox } from 'three/addons/objects/GroundedSkybox.js';

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
      this.scene.environmentRotation.set(0, 0, 0);
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
    if (this.current === 'hangar') return HANGAR_LIMITS;
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
    this.scene.environmentRotation.set(0, env.envRotation || 0, 0);
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

const BUILDERS = { studio: buildStudio, hangar: buildPanoramaHangar };

// The club hangar is one generated 360° panorama (public/scenes/hangar.jpg), projected
// onto a dome with a flat floor, so the glider stands on the panorama's floor. The
// same image lights the glider and shows in its tubes. Keep the camera near the
// middle: far from where the panorama was "taken" the walls stretch.
const PANO = { url: './scenes/hangar.jpg', env: './scenes/hangar-env.jpg', height: 1.6, radius: 11, turn: Math.PI / 2 };
export const HANGAR_LIMITS = { minY: 0.3, maxY: 4, x: [-6.5, 6.5], z: [-6.5, 6.5] };

function buildPanoramaHangar(envs) {
  const group = new THREE.Group();
  envs.root.add(group);
  const loader = new THREE.TextureLoader();
  const map = loader.load(PANO.url, () => envs.onChange?.());
  map.colorSpace = THREE.SRGBColorSpace;
  map.mapping = THREE.EquirectangularReflectionMapping;
  const dome = new GroundedSkybox(map, PANO.height, PANO.radius, 96);
  dome.position.y = PANO.height;
  dome.rotation.y = PANO.turn;
  dome.material.depthWrite = false;
  dome.renderOrder = -5;
  group.add(dome);
  // The glider's shadow falls on the panorama floor.
  const catcher = new THREE.Mesh(new THREE.PlaneGeometry(22, 22), new THREE.ShadowMaterial({ opacity: 0.32 }));
  catcher.rotation.x = -Math.PI / 2;
  catcher.position.y = 0.002;
  catcher.receiveShadow = true;
  group.add(catcher);
  const env = {
    group, envMap: null, envRotation: PANO.turn, envIntensity: 0.9, background: new THREE.Color('#2b2016'), exposure: 1.0,
    sunColor: 0xffe2b8, sunIntensity: 1.2, sunDir: new THREE.Vector3(0.35, 1, -0.25).normalize(),
    hemi: [0xffe6c8, 0x6a5440, 0.55], fillIntensity: 0.1,
  };
  loader.load(PANO.env, (t) => {
    t.mapping = THREE.EquirectangularReflectionMapping;
    t.colorSpace = THREE.SRGBColorSpace;
    const rt = envs.pmrem.fromEquirectangular(t);
    t.dispose();
    env.envMap = rt.texture;
    if (envs.current === 'hangar') envs.scene.environment = env.envMap;
    envs.onChange?.();
  });
  return env;
}

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



