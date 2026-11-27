import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

import { AtmosphereSystem, SUN_PRESETS } from './shaders/atmosphere.js';
import { VolumetricSystem } from './shaders/volumetrics.js';
import { CustomMaterialSystem } from './shaders/materials.js';
import { AAAEnvironment } from './shaders/environment_aaa.js';
import { WildlifeSystem } from './shaders/wildlife.js';
import { CinematicPostFX, AirfieldWindAudio } from './shaders/postfx.js';

export {
  SUN_PRESETS,
  AtmosphereSystem,
  VolumetricSystem,
  CustomMaterialSystem,
  AAAEnvironment,
  WildlifeSystem,
  CinematicPostFX,
  AirfieldWindAudio,
};

function ensureTrailingSlash(url) {
  if (!url) return './';
  return url.endsWith('/') ? url : `${url}/`;
}

function countGeometryTriangles(root) {
  let tris = 0;
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry;
    tris += g.index ? g.index.count / 3 : g.attributes.position.count / 3;
  });
  return Math.round(tris);
}

/**
 * Reusable Sala flygfält Nordic Timber Hangar scene module.
 * Contains ONLY the hangar environment (architecture, PBR terrain splatting, atmosphere,
 * volumetrics, wildlife, and optional post-processing) — zero hang-glider models or loaders.
 * Host apps attach their own glider Object3D via `attachGlider(gliderRoot)`.
 */
export class HangarScene {
  constructor({
    renderer,
    scene,
    camera = null,
    controls = null,
    assetBaseUrl = './hangar/',
    hangarUrl = null,
    catUrl = null,
    deerUrl = null,
    texturesBaseUrl = null,
    preset = 'nordic_day',
    usePostFX = false,
    shadows = true,
    volumetrics = true,
    wildlife = true,
    detailShaders = true,
    ao = true,
    dof = true,
    cinematic = true,
    wetness = 0.50,
    grassLushness = 1.0,
    dustOpacity = 1.0,
    active = true,
  } = {}) {
    if (!renderer || !scene) {
      throw new Error('HangarScene requires { renderer, scene }');
    }
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.controls = controls;

    const base = ensureTrailingSlash(assetBaseUrl);
    this.urls = {
      hangar: hangarUrl || `${base}hangar.glb`,
      cat: catUrl || `${base}cat.glb`,
      deer: deerUrl || `${base}deer.glb`,
      textures: ensureTrailingSlash(texturesBaseUrl || base),
    };

    this.loader = new GLTFLoader();
    this.loader.setMeshoptDecoder(MeshoptDecoder);

    this.worldGroup = new THREE.Group();
    this.worldGroup.name = 'NordicHangarWorld';
    scene.add(this.worldGroup);

    this.hangarRoot = new THREE.Group();
    this.hangarRoot.name = 'HangarRoot';
    this.worldGroup.add(this.hangarRoot);

    this.atmosphere = new AtmosphereSystem(renderer, scene);
    this.volumetrics = new VolumetricSystem(this.worldGroup);
    this.materialSys = new CustomMaterialSystem(renderer);
    this.aaaEnv = new AAAEnvironment(this.worldGroup, renderer);
    this.wildlife = new WildlifeSystem(this.worldGroup, this.loader);

    this.gtaoExclude = [
      this.volumetrics.root,
      this.aaaEnv.root.getObjectByName('GroundedContactAO'),
      this.aaaEnv.root.getObjectByName('NordicTreelineRing'),
      this.wildlife.root.getObjectByName('FloatingSunlitDust'),
      this.wildlife.root.getObjectByName('DandelionSpores'),
    ].filter(Boolean);

    this.usePostFX = Boolean(usePostFX && camera);
    this.postFx = this.usePostFX
      ? new CinematicPostFX(renderer, scene, camera, this.gtaoExclude)
      : null;

    this.state = {
      active: Boolean(active),
      preset: SUN_PRESETS[preset] ? preset : 'nordic_day',
      shadows: Boolean(shadows),
      volumetrics: Boolean(volumetrics),
      wildlife: Boolean(wildlife),
      detailShaders: Boolean(detailShaders),
      ao: Boolean(ao),
      dof: Boolean(dof),
      cinematic: Boolean(cinematic),
      wetness,
      grassLushness,
      dustOpacity,
      wind: 1.0,
    };

    this.gliderRoot = null;
    this.hangarBytes = 0;
    this.hangarTriangles = 0;
    this.loaded = false;
    this._loadPromise = null;
    this._iblTimer = null;

    // Apply initial look & visibility
    this.setPreset(this.state.preset);
    this.setOptions({
      shadows: this.state.shadows,
      volumetrics: this.state.volumetrics,
      wildlife: this.state.wildlife,
      detailShaders: this.state.detailShaders,
      ao: this.state.ao,
      dof: this.state.dof,
      cinematic: this.state.cinematic,
      wetness: this.state.wetness,
      grassLushness: this.state.grassLushness,
      dustOpacity: this.state.dustOpacity,
    });
    this.setActive(this.state.active);
  }

  async load() {
    if (this.loaded) {
      return { glbBytes: this.hangarBytes, hangarTriangles: this.hangarTriangles };
    }
    if (this._loadPromise) return this._loadPromise;

    this._loadPromise = (async () => {
      const [, resp] = await Promise.all([
        this.materialSys.loadDetailTextures(this.urls.textures),
        fetch(this.urls.hangar),
      ]);
      if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching ${this.urls.hangar}`);
      const buf = await resp.arrayBuffer();
      this.hangarBytes = buf.byteLength;

      const gltf = await new Promise((resolve, reject) => {
        this.loader.parse(buf, '', resolve, reject);
      });

      this.hangarRoot.clear();
      const model = gltf.scene;
      const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
      model.traverse((o) => {
        if (!o.isMesh) return;
        if (o.name === 'Hangar_Ground' || o.name === 'Hangar_Floor' || o.name === 'Hangar_Slab') {
          o.visible = false;
          return;
        }
        o.castShadow = !/Ground|Slab|Floor/i.test(o.name);
        o.receiveShadow = true;
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) {
            for (const slot of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) {
              if (m[slot]) {
                m[slot].anisotropy = maxAniso;
                m[slot].minFilter = THREE.LinearMipmapLinearFilter;
                m[slot].magFilter = THREE.LinearFilter;
                m[slot].needsUpdate = true;
              }
            }
          }
        }
      });

      this.aaaEnv.buildUnifiedGround(this.materialSys.textures);
      this.materialSys.enhanceHangar(model);
      this.materialSys.setEnabled(this.state.detailShaders);
      this.aaaEnv.setDetailEnabled(this.state.detailShaders);
      this.aaaEnv.setTerrainLook({
        wetness: this.state.wetness,
        grassLushness: this.state.grassLushness,
      });

      this.hangarRoot.add(model);
      this._initOccluderProps(model);
      this.hangarTriangles = countGeometryTriangles(model);
      const b = new THREE.Box3().setFromObject(this.hangarRoot);
      console.info(
        `[hangar] loaded ${(this.hangarBytes / 1048576).toFixed(2)} MB, ${this.hangarTriangles} tris, worldPos=${this.worldGroup.position.toArray().map(n => n.toFixed(2))}, boundsY=[${b.min.y.toFixed(2)},${b.max.y.toFixed(2)}]`
      );

      // Load hangar wildlife GLBs (cat & deer)
      await Promise.all([
        this.wildlife.loadCat(this.urls.cat),
        this.wildlife.loadDeer(this.urls.deer),
      ]);

      this.wildlife.setPerchTargets({
        gliderRoot: this.gliderRoot,
        hangarRoot: this.hangarRoot,
      });

      this.loaded = true;
      return { glbBytes: this.hangarBytes, hangarTriangles: this.hangarTriangles };
    })();

    return this._loadPromise;
  }

  place(groundY, center = new THREE.Vector3()) {
    const c = center ? new THREE.Vector3(center.x, groundY, center.z) : new THREE.Vector3(0, groundY, 0);
    this.worldGroup.position.copy(c);
    this.atmosphere.setCenter(c);
  }

  setActive(on) {
    this.state.active = Boolean(on);
    this.worldGroup.visible = this.state.active;
    this.atmosphere.setActive(this.state.active);
    if (this.state.active) {
      this.volumetrics.setEnabled(this.state.volumetrics);
      this.wildlife.setEnabled(this.state.wildlife);
      this.atmosphere.setShadows(this.state.shadows);
    }
  }

  attachGlider(gliderRoot) {
    this.gliderRoot = gliderRoot || null;
    this.aaaEnv.setGliderAOVisible(Boolean(this.gliderRoot));
    this.wildlife.setPerchTargets({
      gliderRoot: this.gliderRoot,
      hangarRoot: this.hangarRoot,
    });
  }

  notifyGliderMoved() {
    this.wildlife.startleGliderButterflies();
  }

  setPreset(id) {
    const alias = id === 'day' ? 'nordic_day' : id === 'golden' ? 'golden_hour' : id;
    const preset = this.atmosphere.applyPreset(alias);
    this.state.preset = preset.id;
    this.volumetrics.syncSun(this.atmosphere.sunDir, preset);
    this.materialSys.syncSun(this.atmosphere.sunDir, preset.sunColor, preset.fogColor);
    this.aaaEnv.syncSun(this.atmosphere.sunDir, preset);
    this.wildlife.syncSun(preset);
    if (this.postFx) this.postFx.syncPreset(preset.id);
    return preset;
  }

  setTime(hours) {
    // Map time-of-day (5..21 h) smoothly to Nordic sun elevation/azimuth & mood
    const h = THREE.MathUtils.clamp(Number(hours) || 11.5, 5.5, 20.5);
    const desiredPreset = (h < 7.8 || h > 17.5) ? 'golden_hour' : 'nordic_day';
    if (this.state.preset !== desiredPreset) {
      this.setPreset(desiredPreset);
    }
    const t = (h - 12.0) / 7.5; // -1..+1
    const elev = THREE.MathUtils.clamp(38.0 * Math.cos(t * Math.PI * 0.48), 7.5, 42.0);
    const azim = THREE.MathUtils.clamp(t * 72.0 + 36.0, -140, 140);
    this.atmosphere.setSunAngles(elev, azim, { rebake: false });
    const p = SUN_PRESETS[this.state.preset] || SUN_PRESETS.nordic_day;
    this.volumetrics.syncSun(this.atmosphere.sunDir, p);
    this.materialSys.syncSun(this.atmosphere.sunDir, p.sunColor, p.fogColor);
    this.aaaEnv.syncSun(this.atmosphere.sunDir, p);
    clearTimeout(this._iblTimer);
    this._iblTimer = setTimeout(() => {
      if (this.state.active) this.atmosphere.rebakeIBL();
    }, 140);
  }

  setWind(w) {
    this.state.wind = Math.max(0, Number(w) || 0);
  }

  setShadows(on) {
    this.state.shadows = Boolean(on);
    this.atmosphere.setShadows(this.state.shadows);
  }

  setOptions(opts = {}) {
    if (opts.shadows !== undefined) this.setShadows(opts.shadows);
    if (opts.volumetrics !== undefined) {
      this.state.volumetrics = Boolean(opts.volumetrics);
      this.volumetrics.setEnabled(this.state.volumetrics);
    }
    if (opts.wildlife !== undefined) {
      this.state.wildlife = Boolean(opts.wildlife);
      this.wildlife.setEnabled(this.state.wildlife);
    }
    if (opts.detailShaders !== undefined) {
      this.state.detailShaders = Boolean(opts.detailShaders);
      this.materialSys.setEnabled(this.state.detailShaders);
      this.aaaEnv.setDetailEnabled(this.state.detailShaders);
    }
    if (opts.wetness !== undefined || opts.grassLushness !== undefined) {
      if (opts.wetness !== undefined) this.state.wetness = opts.wetness;
      if (opts.grassLushness !== undefined) this.state.grassLushness = opts.grassLushness;
      this.aaaEnv.setTerrainLook({
        wetness: this.state.wetness,
        grassLushness: this.state.grassLushness,
      });
    }
    if (opts.dustOpacity !== undefined) {
      this.state.dustOpacity = opts.dustOpacity;
      this.wildlife.setDustOpacity(this.state.dustOpacity);
    }
    if (this.postFx) {
      if (opts.ao !== undefined) { this.state.ao = Boolean(opts.ao); this.postFx.setAO(this.state.ao); }
      if (opts.dof !== undefined) { this.state.dof = Boolean(opts.dof); this.postFx.setDoF(this.state.dof); }
      if (opts.cinematic !== undefined) { this.state.cinematic = Boolean(opts.cinematic); this.postFx.setEnabled(this.state.cinematic); }
    }
  }

  _initOccluderProps(model) {
    this._occluderProps = [];
    this._lastUpdateSec = null;
    const FADE_RE = /^Hangar_Props_(GliderRack|PackedGliders|Ladder|SwingStand|AluTubes|LeftRack|Chairs|RightDolly)/i;
    model.updateMatrixWorld(true);
    const origin = this.worldGroup.position;
    model.traverse((o) => {
      if (!o.isMesh) return;
      // Check mesh name or parent name
      let matched = FADE_RE.test(o.name);
      let p = o.parent;
      while (!matched && p && p !== model) {
        if (FADE_RE.test(p.name)) matched = true;
        p = p.parent;
      }
      if (!matched || !o.material) return;
      // Clone materials per fadeable prop once so fading one prop never affects shared materials elsewhere
      const origMats = Array.isArray(o.material) ? o.material : [o.material];
      const cloned = origMats.map((m) => {
        const cm = m.clone();
        cm.userData = {
          ...m.userData,
          _origTransparent: Boolean(cm.transparent),
          _origOpacity: cm.opacity !== undefined ? cm.opacity : 1.0,
          _origDepthWrite: cm.depthWrite !== undefined ? cm.depthWrite : true,
        };
        return cm;
      });
      o.material = Array.isArray(o.material) ? cloned : cloned[0];
      const box = new THREE.Box3().setFromObject(o);
      box.min.sub(origin);
      box.max.sub(origin);
      const center = box.getCenter(new THREE.Vector3());
      this._occluderProps.push({
        name: o.name,
        mesh: o,
        mats: cloned,
        localBox: box,
        center,
        opacity: 1.0,
      });
    });
  }

  _segmentIntersectsBox(p0, p1, box, inflate = 0.45, maxT = 0.92) {
    let tMin = 0.0;
    let tMax = maxT;
    const axes = ['x', 'y', 'z'];
    for (let i = 0; i < 3; i++) {
      const k = axes[i];
      const d = p1[k] - p0[k];
      const bMin = box.min[k] - inflate;
      const bMax = box.max[k] + inflate;
      if (Math.abs(d) < 1e-6) {
        if (p0[k] < bMin || p0[k] > bMax) return false;
      } else {
        const inv = 1.0 / d;
        let t1 = (bMin - p0[k]) * inv;
        let t2 = (bMax - p0[k]) * inv;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        tMin = Math.max(tMin, t1);
        tMax = Math.min(tMax, t2);
        if (tMin > tMax) return false;
      }
    }
    return tMax >= 0.0 && tMin <= maxT;
  }

  _updateOccluderFade(camera, dt, targetWorld) {
    if (!this._occluderProps?.length || !camera) return;
    const origin = this.worldGroup.position;
    const camL = new THREE.Vector3().copy(camera.position).sub(origin);
    const tgtL = targetWorld
      ? new THREE.Vector3().copy(targetWorld).sub(origin)
      : (this.controls?.target
        ? new THREE.Vector3().copy(this.controls.target).sub(origin)
        : new THREE.Vector3(0, 1.15, 0));
    const sightDir = new THREE.Vector3().subVectors(tgtL, camL);
    const sightLen = sightDir.length();
    if (sightLen > 1e-5) sightDir.divideScalar(sightLen);

    const toBox = new THREE.Vector3();
    const clampedPt = new THREE.Vector3();
    let fadedCount = 0;

    for (const prop of this._occluderProps) {
      let occluded = this._segmentIntersectsBox(camL, tgtL, prop.localBox, 0.45, 0.92);
      if (!occluded) {
        prop.localBox.clampPoint(camL, clampedPt);
        const distToCam = clampedPt.distanceTo(camL);
        if (distToCam < 1.45) {
          toBox.subVectors(prop.center, camL);
          const len = toBox.length();
          if (len < 1e-4 || toBox.dot(sightDir) / len > -0.35) {
            occluded = true;
          }
        }
      }
      const targetOp = occluded ? 0.0 : 1.0;
      if (dt <= 0) {
        prop.opacity = targetOp;
      } else {
        const rate = occluded ? 14.0 : 9.0;
        prop.opacity += (targetOp - prop.opacity) * (1 - Math.exp(-rate * dt));
        if (Math.abs(prop.opacity - targetOp) < 0.005) prop.opacity = targetOp;
      }

      if (prop.opacity < 0.04) {
        prop.mesh.visible = false;
        fadedCount++;
      } else if (prop.opacity >= 0.995) {
        prop.mesh.visible = true;
        for (const m of prop.mats) {
          if (m.transparent !== m.userData._origTransparent || m.opacity !== m.userData._origOpacity) {
            m.transparent = m.userData._origTransparent;
            m.opacity = m.userData._origOpacity;
            m.depthWrite = m.userData._origDepthWrite;
            m.needsUpdate = true;
          }
        }
      } else {
        prop.mesh.visible = true;
        fadedCount++;
        for (const m of prop.mats) {
          if (!m.transparent) {
            m.transparent = true;
            m.depthWrite = false;
            m.needsUpdate = true;
          }
          m.opacity = prop.opacity * m.userData._origOpacity;
        }
      }
    }
    this.fadedPropCount = fadedCount;
  }

  update(a, b, targetWorld) {
    if (!this.state.active) return;
    if (a && a.isCamera) this.camera = a;
    // Accept either update(dt, elapsedSeconds) OR update(camera, elapsedSeconds, targetWorld)
    const sec = typeof b === 'number' ? b : (typeof a === 'number' ? a : 0);
    const dt = this._lastUpdateSec === null ? 0 : Math.min(Math.max(sec - this._lastUpdateSec, 0), 0.1);
    this._lastUpdateSec = sec;
    const windSec = sec * Math.max(0.25, this.state.wind);
    this.atmosphere.update(sec);
    this.volumetrics.update(sec);
    this.aaaEnv.update(windSec);
    this.wildlife.update(sec);
    this._updateOccluderFade(this.camera, dt, targetWorld);
    if (this.postFx && this.camera && this.controls) {
      this.postFx.updateFocus(this.camera.position.distanceTo(this.controls.target));
    }
  }

  render() {
    if (this.postFx) {
      this.postFx.render();
    } else if (this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  resize(w, h) {
    if (this.postFx) this.postFx.resize(w, h);
  }

  dispose() {
    clearTimeout(this._iblTimer);
    this.atmosphere.dispose();
    this.worldGroup.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) m.dispose?.();
      }
    });
    this.scene.remove(this.worldGroup);
  }
}

export function createHangarScene(options) {
  return new HangarScene(options);
}
