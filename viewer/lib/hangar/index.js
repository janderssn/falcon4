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
    cranesUrl = null,
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
      cranes: cranesUrl || `${base}cranes.glb`,
      textures: ensureTrailingSlash(texturesBaseUrl || base),
    };

    this.loader = new GLTFLoader();
    this.loader.setMeshoptDecoder(MeshoptDecoder);

    this.worldGroup = new THREE.Group();
    this.worldGroup.name = 'NordicHangarWorld';
    this.worldGroup.visible = Boolean(active);
    scene.add(this.worldGroup);

    this.hangarRoot = new THREE.Group();
    this.hangarRoot.name = 'HangarRoot';
    this.worldGroup.add(this.hangarRoot);

    this.atmosphere = new AtmosphereSystem(renderer, scene, { active });
    this.volumetrics = new VolumetricSystem(this.worldGroup);
    this.materialSys = new CustomMaterialSystem(renderer);
    this.aaaEnv = new AAAEnvironment(this.worldGroup, renderer);
    this.wildlife = new WildlifeSystem(this.worldGroup, this.loader);
    this.audio = new AirfieldWindAudio();

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

      // Load hangar wildlife GLBs (cat, deer & cranes)
      await Promise.all([
        this.wildlife.loadCat(this.urls.cat),
        this.wildlife.loadDeer(this.urls.deer),
        this.wildlife.loadCranes(this.urls.cranes),
      ]);
      this._registerCatOccluders(this.wildlife.catGroup);

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
    } else if (this.audio?.active) {
      this.audio.setEnabled(false);
    }
  }

  setAudioEnabled(on) {
    return this.audio ? this.audio.setEnabled(Boolean(on)) : false;
  }

  setDustParams(params = {}) {
    this.volumetrics?.setDustParams(params);
    this.wildlife?.setDustParams(params);
  }

  toggleAudio() {
    return this.audio ? this.audio.toggle() : false;
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
    this.audio?.setSunPreset(preset.id);
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

  _attachDitherFade(mat, fadeUniform) {
    const cm = mat.clone();
    const prevCompile = cm.onBeforeCompile;
    const prevKey = cm.customProgramCacheKey ? cm.customProgramCacheKey.bind(cm) : null;
    cm.customProgramCacheKey = () => `${prevKey ? prevKey() : cm.type}+cam-bayer-dither-v1`;
    cm.onBeforeCompile = (shader, renderer) => {
      if (prevCompile) prevCompile.call(cm, shader, renderer);
      shader.uniforms.uCamFade = fadeUniform;
      shader.fragmentShader = `uniform float uCamFade;\n${shader.fragmentShader}`.replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
        if (uCamFade < 0.999) {
          int bx = int(mod(floor(gl_FragCoord.x), 4.0));
          int by = int(mod(floor(gl_FragCoord.y), 4.0));
          int bIdx = by * 4 + bx;
          float bayer = (
            bIdx == 0 ? 0.0 : bIdx == 1 ? 8.0 : bIdx == 2 ? 2.0 : bIdx == 3 ? 10.0 :
            bIdx == 4 ? 12.0 : bIdx == 5 ? 4.0 : bIdx == 6 ? 14.0 : bIdx == 7 ? 6.0 :
            bIdx == 8 ? 3.0 : bIdx == 9 ? 11.0 : bIdx == 10 ? 1.0 : bIdx == 11 ? 9.0 :
            bIdx == 12 ? 15.0 : bIdx == 13 ? 7.0 : bIdx == 14 ? 13.0 : 5.0
          ) / 16.0;
          if (uCamFade <= bayer) discard;
        }`
      );
    };
    cm.needsUpdate = true;
    return cm;
  }

  _attachStructuralProximityDither(mat, targetUniform) {
    const cm = mat.clone();
    const prevCompile = cm.onBeforeCompile;
    const prevKey = cm.customProgramCacheKey ? cm.customProgramCacheKey.bind(cm) : null;
    cm.customProgramCacheKey = () => `${prevKey ? prevKey() : cm.type}+struct-cam-dither-v1`;
    cm.onBeforeCompile = (shader, renderer) => {
      if (prevCompile) prevCompile.call(cm, shader, renderer);
      shader.uniforms.uCamTarget = targetUniform;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>\nvarying highp vec3 vStructWPos;`
        )
        .replace(
          '#include <worldpos_vertex>',
          `#include <worldpos_vertex>\nvStructWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>\nuniform vec3 uCamTarget;\nvarying highp vec3 vStructWPos;`
        )
        .replace(
          '#include <clipping_planes_fragment>',
          `#include <clipping_planes_fragment>
          {
            float dCam = distance(vStructWPos, cameraPosition);
            float proxFade = smoothstep(0.65, 1.85, dCam);

            vec3 seg = uCamTarget - cameraPosition;
            float segLen = max(length(seg), 0.001);
            vec3 segDir = seg / segLen;
            float along = dot(vStructWPos - cameraPosition, segDir);
            float t = along / segLen;
            float sightFade = 1.0;
            if (t > 0.0 && t < 0.88) {
              float perpDist = length((vStructWPos - cameraPosition) - segDir * along);
              float corrInner = 0.55 + 0.16 * along;
              float corrOuter = 1.25 + 0.24 * along;
              float corrFade = smoothstep(corrInner, corrOuter, perpDist);
              float tMask = smoothstep(0.0, 0.06, t) * (1.0 - smoothstep(0.76, 0.88, t));
              sightFade = mix(1.0, corrFade, tMask);
            }

            float structFade = min(proxFade, sightFade);
            if (structFade < 0.999) {
              int bx = int(mod(floor(gl_FragCoord.x), 4.0));
              int by = int(mod(floor(gl_FragCoord.y), 4.0));
              int bIdx = by * 4 + bx;
              float bayer = (
                bIdx == 0 ? 0.0 : bIdx == 1 ? 8.0 : bIdx == 2 ? 2.0 : bIdx == 3 ? 10.0 :
                bIdx == 4 ? 12.0 : bIdx == 5 ? 4.0 : bIdx == 6 ? 14.0 : bIdx == 7 ? 6.0 :
                bIdx == 8 ? 3.0 : bIdx == 9 ? 11.0 : bIdx == 10 ? 1.0 : bIdx == 11 ? 9.0 :
                bIdx == 12 ? 15.0 : bIdx == 13 ? 7.0 : bIdx == 14 ? 13.0 : 5.0
              ) / 16.0;
              if (structFade <= bayer) discard;
            }
          }`
        );
    };
    cm.needsUpdate = true;
    return cm;
  }

  _initOccluderProps(model) {
    this._occluderProps = [];
    this._lastUpdateSec = null;
    if (!this._camTargetUniform) this._camTargetUniform = { value: new THREE.Vector3(0, 1.15, 0) };
    const FADE_RE = /^Hangar_Props_(GliderRack|PackedGliders|Ladder|SwingStand|AluTubes|LeftRack|Chairs|RightDolly)/i;
    const STRUCT_RE = /^Hangar_(Steel_Portal|Steel_Haunches|Framing)/i;
    model.updateMatrixWorld(true);
    const origin = this.worldGroup.position;
    model.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      if (STRUCT_RE.test(o.name)) {
        const origMats = Array.isArray(o.material) ? o.material : [o.material];
        const cloned = origMats.map((m) => this._attachStructuralProximityDither(m, this._camTargetUniform));
        o.material = Array.isArray(o.material) ? cloned : cloned[0];
        return;
      }
      let matched = FADE_RE.test(o.name);
      let p = o.parent;
      while (!matched && p && p !== model) {
        if (FADE_RE.test(p.name)) matched = true;
        p = p.parent;
      }
      if (!matched) return;
      // Clone materials with 4x4 Bayer screen-door dither fade (keeps transparent=false, depthWrite=true ALWAYS!)
      const fadeUniform = { value: 1.0 };
      const origMats = Array.isArray(o.material) ? o.material : [o.material];
      const cloned = origMats.map((m) => this._attachDitherFade(m, fadeUniform));
      o.material = Array.isArray(o.material) ? cloned : cloned[0];
      const box = new THREE.Box3().setFromObject(o);
      box.min.sub(origin);
      box.max.sub(origin);
      const center = box.getCenter(new THREE.Vector3());
      const fullName = `${o.name} ${o.parent?.name || ''}`;
      this._occluderProps.push({
        name: o.name,
        mesh: o,
        mats: cloned,
        fadeUniform,
        localBox: box,
        center,
        opacity: 1.0,
        isRearProp: /GliderRack|PackedGliders|Ladder|SwingStand|AluTubes/i.test(fullName),
        isChair: /Chairs/i.test(fullName),
        isCat: false,
      });
    });
  }

  _registerCatOccluders(catGroup) {
    if (!catGroup) return;
    if (!this._occluderProps) this._occluderProps = [];
    this._occluderProps = this._occluderProps.filter((p) => !p.isCat);
    catGroup.updateMatrixWorld(true);
    const origin = this.worldGroup.position;
    catGroup.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const fadeUniform = { value: 1.0 };
      const origMats = Array.isArray(o.material) ? o.material : [o.material];
      const cloned = origMats.map((m) => this._attachDitherFade(m, fadeUniform));
      o.material = Array.isArray(o.material) ? cloned : cloned[0];
      const box = new THREE.Box3().setFromObject(o);
      box.min.sub(origin);
      box.max.sub(origin);
      const center = box.getCenter(new THREE.Vector3());
      this._occluderProps.push({
        name: o.name || 'HangarCatMesh',
        mesh: o,
        mats: cloned,
        fadeUniform,
        localBox: box,
        center,
        opacity: 1.0,
        isRearProp: false,
        isChair: false,
        isCat: true,
      });
    });
  }

  _segmentIntersectsBox(p0, p1, box, inflate = 0.45, maxT = 0.92, minT = 0.0) {
    let tMin = minT;
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
    return tMax >= minT && tMin <= maxT;
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
    if (this._camTargetUniform) {
      this._camTargetUniform.value.copy(tgtL).add(origin);
    }
    const sightDir = new THREE.Vector3().subVectors(tgtL, camL);
    const sightLen = sightDir.length();
    if (sightLen > 1e-5) sightDir.divideScalar(sightLen);

    const segVec = new THREE.Vector3().subVectors(tgtL, camL);
    const segLenSq = Math.max(segVec.lengthSq(), 1e-6);
    const segPt = new THREE.Vector3();
    const boxPt = new THREE.Vector3();
    let fadedCount = 0;
    let rearPropsTotal = 0;
    let rearPropsFaded = 0;
    let chairCatMinTarget = 1.0;

    // Smooth spatial ramp for rear-wall props: 1.0 at z >= -1.0, smoothly dissolving to 0.0 by z <= -2.4
    const rearRamp = THREE.MathUtils.smoothstep(camL.z, -2.4, -1.0);

    for (const prop of this._occluderProps) {
      let targetFade = 1.0;
      if (prop.isRearProp) {
        rearPropsTotal++;
        targetFade = rearRamp;
      } else {
        // Smooth spatial ramp for side/front props (Chairs + Cat, LeftRack, RightDolly):
        // Corridor 0.45m -> 0.95m strictly between camera & glider (t in [0.05, 0.92]), plus lens proximity 0.90m -> 1.40m
        const tProj = THREE.MathUtils.clamp(
          ((prop.center.x - camL.x) * segVec.x + (prop.center.y - camL.y) * segVec.y + (prop.center.z - camL.z) * segVec.z) / segLenSq,
          0.05,
          0.92
        );
        segPt.copy(camL).addScaledVector(segVec, tProj);
        prop.localBox.clampPoint(segPt, boxPt);
        const dSeg = boxPt.distanceTo(segPt);
        const segRamp = THREE.MathUtils.smoothstep(dSeg, 0.45, 0.95);

        prop.localBox.clampPoint(camL, boxPt);
        const dCam = boxPt.distanceTo(camL);
        const proxRamp = THREE.MathUtils.smoothstep(dCam, 0.90, 1.40);

        targetFade = Math.min(segRamp, proxRamp);
      }
      prop._targetFade = targetFade;
      if (prop.isChair || prop.isCat) {
        chairCatMinTarget = Math.min(chairCatMinTarget, targetFade);
      }
    }

    let catFaded = false;
    for (const prop of this._occluderProps) {
      const targetOp = (prop.isChair || prop.isCat) ? chairCatMinTarget : prop._targetFade;
      if (dt <= 0) {
        prop.opacity = targetOp;
      } else {
        prop.opacity += (targetOp - prop.opacity) * (1 - Math.exp(-7.0 * dt));
        if (Math.abs(prop.opacity - targetOp) < 0.004) prop.opacity = targetOp;
      }
      prop.fadeUniform.value = prop.opacity;
      prop.mesh.visible = prop.opacity > 0.01;
      if (prop.opacity < 0.98) {
        fadedCount++;
        if (prop.isCat) catFaded = true;
        if (prop.isRearProp) rearPropsFaded++;
      }
    }
    this.fadedPropCount = fadedCount;
    this.rearPropsTotal = rearPropsTotal;
    this.rearPropsFaded = rearPropsFaded;
    this.catFaded = catFaded;
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
