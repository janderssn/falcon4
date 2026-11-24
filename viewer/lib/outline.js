// Experimental outline: a line of the chosen colour and thickness around the glider's
// silhouette. The glider is drawn flat white into a mask (multisampled, so its edge is
// smooth); a full-screen pass then paints, over the finished picture, the pixels outside the
// mask that lie within the thickness of it. Inner lines come from the same pass's depth: where
// the depth (as 1/distance, which is flat across a plane in perspective) bends sharply between
// a pixel and its neighbours, one part stands in front of another, or a surface creases.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

export const OUTLINE_LAYER = 3;
const TAPS = 24;   // directions around each pixel

export class Outline {
  constructor() {
    this.target = new THREE.WebGLRenderTarget(1, 1, { samples: 4, depthTexture: new THREE.DepthTexture(1, 1, THREE.FloatType) });
    this.flat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    this.quad = new FullScreenQuad(new THREE.ShaderMaterial({
      transparent: true, depthTest: false, depthWrite: false,
      uniforms: {
        uMask: { value: this.target.texture }, uDepth: { value: this.target.depthTexture }, uTexel: { value: new THREE.Vector2() },
        uWidth: { value: 2 }, uColor: { value: new THREE.Color(0) },
        uInner: { value: 0 }, uInnerWidth: { value: 1 }, uThreshold: { value: 0.03 },
        uLogFar: { value: 0 }, uNear: { value: 0.1 }, uFar: { value: 100 }, uPersp: { value: 1 },
      },
      vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMask; uniform sampler2D uDepth; uniform vec2 uTexel; uniform float uWidth; uniform vec3 uColor;
        uniform float uInner; uniform float uInnerWidth; uniform float uThreshold;
        uniform float uLogFar; uniform float uNear; uniform float uFar; uniform float uPersp;
        varying vec2 vUv;
        // A value that changes linearly across a flat surface on screen: 1/distance in
        // perspective (the depth buffer is logarithmic), the depth itself in plan views.
        float flat_(vec2 uv) {
          float d = texture2D(uDepth, uv).r;
          if (uPersp < 0.5) return uNear + d * (uFar - uNear);
          float z = uLogFar > 0.0 ? exp2(d * uLogFar) - 1.0 : uNear * uFar / (uFar - (uFar - uNear) * d);
          return 1.0 / max(z, 1e-4);
        }
        float inner() {
          vec2 o = uTexel * uInnerWidth;
          float c = flat_(vUv);
          float e = 0.0;
          vec2 dirs[4];
          dirs[0] = vec2(o.x, 0.0); dirs[1] = vec2(0.0, o.y); dirs[2] = vec2(o.x, o.y) * 0.7071; dirs[3] = vec2(o.x, -o.y) * 0.7071;
          for (int i = 0; i < 4; i++) {
            vec2 a = vUv + dirs[i], b = vUv - dirs[i];
            if (texture2D(uMask, a).r < 0.5 || texture2D(uMask, b).r < 0.5) continue;   // the silhouette's job
            e = max(e, abs(flat_(a) + flat_(b) - 2.0 * c) / max(abs(c), 1e-6));
          }
          return smoothstep(uThreshold, uThreshold * 2.0, e);
        }
        void main() {
          float here = texture2D(uMask, vUv).r;
          float near = here;
          // Rings at the full width and inside it, so thin parts (tubes seen end on) still count.
          for (int i = 0; i < ${TAPS}; i++) {
            float a = 6.2831853 * (float(i) + 0.5) / ${TAPS}.0;
            vec2 d = vec2(cos(a), sin(a)) * uTexel;
            near = max(near, texture2D(uMask, vUv + d * uWidth).r);
            near = max(near, texture2D(uMask, vUv + d * uWidth * 0.5).r);
          }
          near = max(near, max(max(texture2D(uMask, vUv + vec2(uTexel.x, 0.0)).r, texture2D(uMask, vUv - vec2(uTexel.x, 0.0)).r),
                               max(texture2D(uMask, vUv + vec2(0.0, uTexel.y)).r, texture2D(uMask, vUv - vec2(0.0, uTexel.y)).r)));
          float a = clamp(near - here, 0.0, 1.0);
          if (uInner > 0.5 && here > 0.5) a = max(a, inner());
          if (a < 0.002) discard;
          gl_FragColor = vec4(uColor, a);
          #include <colorspace_fragment>
        }`,
    }));
  }

  /** Marks which meshes make the silhouette (wires optional). */
  setMeshes(meshes, wires) {
    for (const m of meshes) {
      const g = m.userData.part?.group;
      if (wires || !['04', '05'].includes(g)) m.layers.enable(OUTLINE_LAYER); else m.layers.disable(OUTLINE_LAYER);
    }
  }

  /** Paints the outline over what the renderer has just drawn with this camera. */
  render(renderer, scene, camera, width, color, inner = 0) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    if (this.target.width !== size.x || this.target.height !== size.y) this.target.setSize(size.x, size.y);
    const layers = camera.layers.mask, bg = scene.background, ov = scene.overrideMaterial, fog = scene.fog;
    const autoShadow = renderer.shadowMap.autoUpdate, clear = renderer.getClearColor(new THREE.Color()), alpha = renderer.getClearAlpha();
    const autoClear = renderer.autoClear;
    camera.layers.set(OUTLINE_LAYER);
    scene.background = null; scene.overrideMaterial = this.flat; scene.fog = null;
    renderer.shadowMap.autoUpdate = false;
    renderer.setClearColor(0x000000, 1);
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.setClearColor(clear, alpha);
    renderer.shadowMap.autoUpdate = autoShadow;
    camera.layers.mask = layers; scene.background = bg; scene.overrideMaterial = ov; scene.fog = fog;
    const u = this.quad.material.uniforms;
    u.uTexel.value.set(1 / size.x, 1 / size.y);
    u.uWidth.value = width * renderer.getPixelRatio();
    u.uColor.value.set(color);
    // inner: 0 off, else 0..1 sensitivity; inner lines are half the outline's thickness
    u.uInner.value = inner > 0 ? 1 : 0;
    u.uInnerWidth.value = Math.max(1, width * 0.5 * renderer.getPixelRatio());
    u.uThreshold.value = 0.25 * Math.pow(0.02, inner);   // 0.25 at the low end, 0.005 at the high
    u.uDepth.value = this.target.depthTexture;
    u.uPersp.value = camera.isPerspectiveCamera ? 1 : 0;
    u.uLogFar.value = camera.isPerspectiveCamera && renderer.capabilities.logarithmicDepthBuffer ? Math.log2(camera.far + 1) : 0;
    u.uNear.value = camera.near; u.uFar.value = camera.far;
    renderer.autoClear = false;
    this.quad.render(renderer);
    renderer.autoClear = autoClear;
  }
}
