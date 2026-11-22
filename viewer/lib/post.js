// Post-processing for the main view: multisampled HDR render, ground-truth ambient
// occlusion (creases, the keel pocket, the glider on the floor), a faint bloom on bright
// highlights, then tone mapping and sRGB in the output pass.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/**
 * Occlusion from solid meshes only: see-through sail, depth-only twins, floor grids and
 * wires are left out, so they neither cast nor take it. The shadow catcher stays in, so the
 * glider gets a contact shadow on the floor.
 */
class SolidAOPass extends GTAOPass {
  constructor(...args) {
    super(...args);
    // The sail is double sided: drawn one-sided, its back faces would be missing from the
    // depth, and the frame inside would darken the cloth in front of it as if seen through.
    this.normalMaterial.side = THREE.DoubleSide;
    // The renderer writes a logarithmic depth buffer (for the long views in the hill scene);
    // the AO and denoise shaders expect plain depth, so they decode it first.
    this.logDepth = { uLogFar: { value: 0 }, uLogNear: { value: 0.1 }, uLogFarZ: { value: 100 } };
    for (const m of [this.gtaoMaterial, this.pdMaterial]) {
      Object.assign(m.uniforms, this.logDepth);
      m.fragmentShader = m.fragmentShader
        .replace('float getDepth(', `uniform float uLogFar; uniform float uLogNear; uniform float uLogFarZ;
          float unLog(float d) {
            if (uLogFar <= 0.0 || d >= 1.0) return d;
            return viewZToPerspectiveDepth(1.0 - exp2(d * uLogFar), uLogNear, uLogFarZ);
          }
          float rawDepth(`)
        .replace('float fetchDepth(', 'float rawFetchDepth(')
        .replace('vec3 computeNormalFromDepth(', `float getDepth(const vec2 uv) { return unLog(rawDepth(uv)); }
          float fetchDepth(const ivec2 uv) { return unLog(rawFetchDepth(uv)); }
          vec3 computeNormalFromDepth(`);
      m.needsUpdate = true;
    }
  }

  /** Call before rendering: the camera's depth range and whether its depth is logarithmic. */
  syncDepth(renderer) {
    const c = this.camera, log = renderer.capabilities.logarithmicDepthBuffer && c.isPerspectiveCamera;
    this.logDepth.uLogFar.value = log ? Math.log2(c.far + 1) : 0;
    this.logDepth.uLogNear.value = c.near;
    this.logDepth.uLogFarZ.value = c.far;
  }

  _overrideVisibility() {
    const cache = this._visibilityCache;
    this.scene.traverse((o) => {
      if (!o.visible) return;
      const m = o.material;
      const skip = o.isPoints || o.isLine || o.isLine2 || o.isSprite
        || (m && !m.isShadowMaterial && (m.transparent || m.colorWrite === false || m.depthWrite === false));
      if (skip) { o.visible = false; cache.push(o); }
    });
  }
}

/**
 * Materials tone-map as they draw, exactly as without post-processing, so plain background
 * colours stay as chosen (three's Neutral curve darkens dark greys). The output pass then only
 * converts to sRGB.
 */
class DisplayPass extends OutputPass {
  render(renderer, ...rest) {
    const t = renderer.toneMapping;
    renderer.toneMapping = THREE.NoToneMapping;
    super.render(renderer, ...rest);
    renderer.toneMapping = t;
  }
}

export class Post {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    const size = renderer.getSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.renderPass = new RenderPass(scene, camera);
    this.ao = new SolidAOPass(scene, camera, size.x, size.y);
    this.ao.blendIntensity = 0.85;
    this.ao.updateGtaoMaterial({ radius: 0.35, distanceExponent: 1.4, thickness: 1.2, scale: 1, samples: 16, distanceFallOff: 1, screenSpaceRadius: false });
    this.ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.12, 0.45, 0.9);
    this.output = new DisplayPass();
    // Three tone-maps materials only when they draw to the screen or an XR target.
    for (const t of [this.composer.renderTarget1, this.composer.renderTarget2]) { t.isXRRenderTarget = true; t.texture.colorSpace = THREE.LinearSRGBColorSpace; }
    for (const pass of [this.renderPass, this.ao, this.bloom, this.output]) this.composer.addPass(pass);
    this.camera = camera;
  }

  /** Follows the rig's camera, which changes between perspective and orthographic. */
  setCamera(camera) {
    if (camera === this.camera) return;
    this.camera = camera;
    this.renderPass.camera = camera;
    this.ao.camera = camera;
    const persp = camera.isPerspectiveCamera ? 1 : 0;
    for (const m of [this.ao.gtaoMaterial, this.ao.pdMaterial]) {
      if (m.defines.PERSPECTIVE_CAMERA !== undefined && m.defines.PERSPECTIVE_CAMERA !== persp) { m.defines.PERSPECTIVE_CAMERA = persp; m.needsUpdate = true; }
    }
  }

  setSize(w, h, pixelRatio) {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
  }

  /** Occlusion off while the projection morphs (its blended matrix isn't a real camera). */
  render(camera, { ao = true } = {}) {
    this.setCamera(camera);
    this.ao.enabled = ao;
    if (ao) this.ao.syncDepth(this.renderer);
    this.composer.render();
  }
}
