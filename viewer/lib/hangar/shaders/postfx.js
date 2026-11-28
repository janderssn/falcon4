import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';

/**
 * Grounded Nordic AAA Cinematic Post-Processing Pipeline:
 * 4x MSAA HalfFloat RenderTarget -> RenderPass -> GTAOPass (SSAO) -> UnrealBloomPass
 * -> BokehPass (dynamic focus DoF) -> FilmicGrade -> OutputPass -> SMAAPass (anti-aliasing).
 */
const FilmicGradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: 0.22 },
    uContrast: { value: 1.03 },
    uSaturation: { value: 1.05 },
    uWarmth: { value: 0.0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uVignette;
    uniform float uContrast;
    uniform float uSaturation;
    uniform float uWarmth;
    varying vec2 vUv;

    void main() {
      vec4 tex = texture2D(tDiffuse, vUv);
      vec3 c = tex.rgb;
      // Crisp linear-space contrast around photographic 18% grey without crushing shadows
      c = max((c - 0.18) * uContrast + 0.18, vec3(0.0));
      float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(luma), c, uSaturation);
      c *= vec3(1.0 + uWarmth * 0.055, 1.0 + uWarmth * 0.015, 1.0 - uWarmth * 0.05);
      vec2 q = vUv - 0.5;
      float vig = 1.0 - dot(q, q) * uVignette * 2.0;
      c *= clamp(vig, 0.78, 1.0);
      gl_FragColor = vec4(c, tex.a);
    }
  `,
};

export class CinematicPostFX {
  constructor(renderer, scene, camera, gtaoExclude = []) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.gtaoExclude = gtaoExclude;
    this.enabled = true;
    this.aoEnabled = true;
    this.dofEnabled = true;

    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    // Use UnsignedByteType + 4x hardware MSAA render target (universally supported on desktop
    // Linux/Windows/macOS WebGL2 drivers, unlike HalfFloatType+MSAA which can black-screen).
    // Combined with SMAAPass, this gives razor-sharp antialiasing on wood planks & thin glider wires.
    const maxSamples = renderer.capabilities.maxSamples || 0;
    const msaaSamples = Math.min(4, maxSamples);
    const rt = new THREE.WebGLRenderTarget(Math.floor(w * dpr), Math.floor(h * dpr), {
      type: THREE.UnsignedByteType,
      samples: msaaSamples,
    });
    this.composer = new EffectComposer(renderer, rt);

    this.renderPass = new RenderPass(scene, camera);

    // Ground-Truth Screen-Space Ambient Occlusion (tuned for clear, natural interior crevice & contact grounding)
    this.gtaoPass = new GTAOPass(scene, camera, w, h);
    this.gtaoPass.output = GTAOPass.OUTPUT.Default;
    this.gtaoPass.normalMaterial.side = THREE.DoubleSide;
    // A surface seen from its back side (the underside of a single-layer sail) must still hand the AO a normal that faces
    // the camera; with the mesh's own normal the AO there came out as noise. Flip any normal that points away from the eye.
    this.gtaoPass.normalMaterial.onBeforeCompile = (shader) => {
      shader.vertexShader = 'varying vec3 vAoEye;\n' + shader.vertexShader
        .replace('#include <project_vertex>', '#include <project_vertex>\nvAoEye = -mvPosition.xyz;');
      shader.fragmentShader = 'varying vec3 vAoEye;\n' + shader.fragmentShader
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nif (dot(normal, vAoEye) < 0.0) normal = -normal;');
    };
    this.gtaoPass.blendIntensity = 0.90;
    this.gtaoPass.updateGtaoMaterial({
      radius: 0.46,
      distanceExponent: 1.35,
      thickness: 0.34,
      scale: 1.25,
      samples: 24,
      distanceFallOff: 1.0,
    });
    // Strong bilateral Poisson denoise: silky-smooth on the glider sail underside while keeping crisp hangar crevices
    this.gtaoPass.updatePdMaterial({
      lumaPhi: 10,
      depthPhi: 2.2,
      normalPhi: 3.5,
      radius: 11,
      radiusExponent: 1.6,
      rings: 3,
      samples: 16,
    });

    // Subtle bloom tuned for UnsignedByteType (only bright backlit panels & sky glints softly bloom)
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.12, 0.35, 0.92);

    // Macro-Only Photographic Depth of Field: stays OFF on wide hangar views (>= 3.4m)
    // and smoothly ramps into creamy macro bokeh when zoomed in close (< 3.4m) on glider hardware.
    this.bokehPass = new BokehPass(scene, camera, {
      focus: 1.5,
      aperture: 0.0,
      maxblur: 0.0,
    });
    this.bokehPass.enabled = false;
    if (this.bokehPass._materialDepth) this.bokehPass._materialDepth.side = THREE.DoubleSide;

    this.gradePass = new ShaderPass(FilmicGradeShader);
    this.outputPass = new OutputPass();
    // Post-tonemap SMAA edge antialiasing for vertical wood planks & thin diagonal glider cables
    this.smaaPass = new SMAAPass();

    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.gtaoPass);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(this.bokehPass);
    this.composer.addPass(this.gradePass);
    this.composer.addPass(this.outputPass);
    this.composer.addPass(this.smaaPass);

    // IMPORTANT: size composer AFTER adding all passes so BokehPass._renderTargetDepth,
    // GTAOPass, UnrealBloomPass, and SMAAPass all initialize to the true viewport & DPR.
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);

    // Capture true scene triangle/draw stats right after RenderPass (before post-FX quads overwrite renderer.info)
    this.sceneStats = { triangles: 0, calls: 0 };
    const origRender = this.renderPass.render.bind(this.renderPass);
    this.renderPass.render = (...args) => {
      origRender(...args);
      this.sceneStats.triangles = this.renderer.info.render.triangles;
      this.sceneStats.calls = this.renderer.info.render.calls;
    };

    // Hide transparent volumetric shafts, contact AO decals & treeline during depth/normal passes
    // (GTAOPass & BokehPass) so transparent cards never bleed into AO or DoF depth!
    const wrapExclude = (pass) => {
      const orig = pass.render.bind(pass);
      pass.render = (...args) => {
        const saved = this.gtaoExclude.map((o) => [o, o.visible]);
        for (const [o] of saved) o.visible = false;
        try {
          orig(...args);
        } finally {
          for (const [o, vis] of saved) o.visible = vis;
        }
      };
    };
    wrapExclude(this.gtaoPass);
    wrapExclude(this.bokehPass);
    this._smoothFocus = 1.5;
  }

  syncPreset(presetId) {
    if (presetId === 'golden_hour') {
      this.bloomPass.strength = 0.14;
      this.bloomPass.threshold = 0.90;
      this.gradePass.uniforms.uWarmth.value = 0.48;
    } else if (presetId === 'overcast') {
      this.bloomPass.strength = 0.08;
      this.bloomPass.threshold = 0.95;
      this.gradePass.uniforms.uWarmth.value = -0.12;
    } else {
      this.bloomPass.strength = 0.12;
      this.bloomPass.threshold = 0.92;
      this.gradePass.uniforms.uWarmth.value = 0.10;
    }
  }

  setEnabled(on) {
    // Cinematic FX controls bloom + filmic color grade/vignette independently of AO and DoF
    this.enabled = on;
    this.bloomPass.enabled = on;
    this.gradePass.enabled = on;
  }

  setAO(on) {
    this.aoEnabled = on;
    this.gtaoPass.enabled = on;
  }

  setDoF(on) {
    this.dofEnabled = on;
    if (!on) this.bokehPass.enabled = false;
  }

  setLookParams({ contrast, saturation, aoStrength, bloom }) {
    if (contrast !== undefined) this.gradePass.uniforms.uContrast.value = contrast;
    if (saturation !== undefined) this.gradePass.uniforms.uSaturation.value = saturation;
    if (aoStrength !== undefined) this.gtaoPass.blendIntensity = aoStrength;
    if (bloom !== undefined) this.bloomPass.strength = bloom;
  }

  updateFocus(distance) {
    if (!this.bokehPass?.uniforms?.focus) return;
    const clamped = THREE.MathUtils.clamp(distance, 0.35, 45.0);
    // Snap immediately on camera jumps (>0.4m), deadband tiny <4mm damping micro-changes so macro Bokeh never twitches
    const delta = Math.abs(clamped - this._smoothFocus);
    if (delta > 0.4) {
      this._smoothFocus = clamped;
    } else if (delta > 0.004) {
      this._smoothFocus += (clamped - this._smoothFocus) * 0.35;
    }
    const f = this._smoothFocus;
    this.bokehPass.uniforms.focus.value = f;
    // Macro-Only Auto DoF: 0 blur on wide hangar shots (>= 3.4m), smooth photographic bokeh when zoomed in (< 3.4m)
    const t = THREE.MathUtils.clamp((3.4 - f) / (3.4 - 1.25), 0.0, 1.0);
    const macroK = t * t * (3.0 - 2.0 * t);
    this.bokehPass.uniforms.aperture.value = 0.00115 * macroK;
    this.bokehPass.uniforms.maxblur.value = 0.015 * macroK;
    this.bokehPass.enabled = this.dofEnabled && macroK > 0.01;
  }

  resize(w, h) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    this.bloomPass.resolution.set(w, h);
    if (this.bokehPass?.uniforms?.aspect) {
      this.bokehPass.uniforms.aspect.value = w / Math.max(h, 1);
    }
  }

  render() {
    // Run EffectComposer whenever ANY post-FX pass (Cinematic FX, AO, or DoF) is enabled!
    if (this.enabled || this.aoEnabled || this.dofEnabled) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
      this.sceneStats.triangles = this.renderer.info.render.triangles;
      this.sceneStats.calls = this.renderer.info.render.calls;
    }
  }
}

/**
 * Optional muted-by-default procedural Web Audio Swedish summer bird & animal ambience (NO wind roar!):
 * - Gentle distant swallow / skylark chirps
 * - Occasional melodic willow warbler / blackbird (koltrast) flute-like phrases
 * - Distant Swedish pheasant ("fasan") morning/evening calls ("kork-kok!" + muffled wing thrum)
 * - Very faint warm meadow cricket shimmer
 */
export class AirfieldWindAudio {
  constructor() {
    this.ctx = null;
    this.active = false;
    this.sunPreset = 'nordic_day';
    this._pheasantTimer = null;
    this._birdTimer = null;
    this._cricketTimer = null;
    this._gestureHandler = null;
  }

  _armGestureResume() {
    if (this._gestureHandler || typeof window === 'undefined') return;
    this._gestureHandler = () => {
      this._disarmGestureResume();
      if (!this.active || !this.ctx) return;
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().then(() => {
          if (this.active) this._playBirdPhrase();
        }).catch(() => {});
      }
    };
    window.addEventListener('pointerdown', this._gestureHandler, { passive: true, capture: true });
    window.addEventListener('keydown', this._gestureHandler, { passive: true, capture: true });
  }

  _disarmGestureResume() {
    if (!this._gestureHandler || typeof window === 'undefined') return;
    window.removeEventListener('pointerdown', this._gestureHandler, { capture: true });
    window.removeEventListener('keydown', this._gestureHandler, { capture: true });
    this._gestureHandler = null;
  }

  setSunPreset(presetId) {
    this.sunPreset = presetId;
    if (this.active) this._schedulePheasant();
  }

  _makeDistantBus(gainVal, lpfFreq = 2800) {
    const ctx = this.ctx;
    const master = ctx.createGain();
    master.gain.value = gainVal;

    const lpf = ctx.createBiquadFilter();
    lpf.type = 'lowpass';
    lpf.frequency.value = lpfFreq;

    const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (panner) panner.pan.value = (Math.random() * 2 - 1) * 0.78;

    const delay = ctx.createDelay(0.5);
    delay.delayTime.value = 0.18 + Math.random() * 0.09;
    const echoGain = ctx.createGain();
    echoGain.gain.value = 0.24;

    lpf.connect(master);
    lpf.connect(delay).connect(echoGain).connect(master);
    if (panner) master.connect(panner).connect(ctx.destination);
    else master.connect(ctx.destination);
    return lpf;
  }

  _playDistantPheasant() {
    if (!this.active || !this.ctx || this.ctx.state !== 'running') return;
    const ctx = this.ctx;
    const now = ctx.currentTime + 0.05;
    const bus = this._makeDistantBus(this.sunPreset === 'golden_hour' ? 0.07 : 0.032, 1580);

    const syllables = [
      { t0: now, dur: 0.17, fStart: 920, fEnd: 540, peak: 0.95 },
      { t0: now + 0.22, dur: 0.14, fStart: 790, fEnd: 470, peak: 0.78 },
    ];
    for (const s of syllables) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(s.fStart, s.t0);
      osc.frequency.exponentialRampToValueAtTime(s.fEnd, s.t0 + s.dur);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime((s.fStart + s.fEnd) * 0.55, s.t0);
      bp.Q.value = 3.2;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, s.t0);
      env.gain.linearRampToValueAtTime(s.peak, s.t0 + 0.025);
      env.gain.exponentialRampToValueAtTime(0.0001, s.t0 + s.dur);
      osc.connect(bp).connect(env).connect(bus);
      osc.start(s.t0);
      osc.stop(s.t0 + s.dur + 0.03);
    }

    for (let i = 0; i < 4; i++) {
      const t = now + 0.42 + i * 0.068;
      const thrum = ctx.createOscillator();
      thrum.type = 'triangle';
      thrum.frequency.setValueAtTime(115 - i * 8, t);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.linearRampToValueAtTime(0.24 * (1 - i * 0.16), t + 0.018);
      env.gain.exponentialRampToValueAtTime(0.0001, t + 0.058);
      thrum.connect(env).connect(bus);
      thrum.start(t);
      thrum.stop(t + 0.07);
    }
  }

  _playBirdPhrase() {
    if (!this.active || !this.ctx || this.ctx.state !== 'running') return;
    const ctx = this.ctx;
    const now = ctx.currentTime + 0.04;
    const isWarbler = Math.random() < 0.45;

    if (isWarbler) {
      // Melodic Swedish blackbird / willow warbler flute-like phrase (3-5 gentle sine notes)
      const bus = this._makeDistantBus(0.042, 3400);
      const baseF = 2050 + Math.random() * 650;
      const steps = [1.0, 1.12, 0.94, 0.84, 0.78];
      const count = 3 + Math.floor(Math.random() * 3);
      for (let i = 0; i < count; i++) {
        const t0 = now + i * (0.16 + Math.random() * 0.06);
        const dur = 0.14 + Math.random() * 0.08;
        const f = baseF * steps[i];
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(f, t0);
        osc.frequency.exponentialRampToValueAtTime(f * (0.92 + Math.random() * 0.14), t0 + dur);
        const env = ctx.createGain();
        env.gain.setValueAtTime(0.0001, t0);
        env.gain.linearRampToValueAtTime(0.65, t0 + 0.03);
        env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(env).connect(bus);
        osc.start(t0);
        osc.stop(t0 + dur + 0.02);
      }
    } else {
      // Quick distant swallow / skylark twin chirp
      const bus = this._makeDistantBus(0.036, 4600);
      const count = 2 + Math.floor(Math.random() * 2);
      for (let i = 0; i < count; i++) {
        const t0 = now + i * 0.11;
        const dur = 0.065;
        const f0 = 3100 + Math.random() * 1100;
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(f0, t0);
        osc.frequency.exponentialRampToValueAtTime(f0 * 1.28, t0 + dur * 0.45);
        osc.frequency.exponentialRampToValueAtTime(f0 * 0.85, t0 + dur);
        const env = ctx.createGain();
        env.gain.setValueAtTime(0.0001, t0);
        env.gain.linearRampToValueAtTime(0.55, t0 + 0.015);
        env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(env).connect(bus);
        osc.start(t0);
        osc.stop(t0 + dur + 0.02);
      }
    }
  }

  _playCricketPulse() {
    if (!this.active || !this.ctx || this.ctx.state !== 'running') return;
    const ctx = this.ctx;
    const now = ctx.currentTime + 0.02;
    const bus = this._makeDistantBus(0.014, 5200);
    // Faint warm 3-chirp meadow cricket pulse
    for (let i = 0; i < 3; i++) {
      const t0 = now + i * 0.048;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(4250 + Math.random() * 120, t0);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t0);
      env.gain.linearRampToValueAtTime(0.45, t0 + 0.008);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.032);
      osc.connect(env).connect(bus);
      osc.start(t0);
      osc.stop(t0 + 0.04);
    }
  }

  _schedulePheasant() {
    if (this._pheasantTimer) { clearTimeout(this._pheasantTimer); this._pheasantTimer = null; }
    if (!this.active) return;
    const minMs = this.sunPreset === 'golden_hour' ? 14000 : 34000;
    const spanMs = this.sunPreset === 'golden_hour' ? 14000 : 24000;
    this._pheasantTimer = setTimeout(() => {
      this._playDistantPheasant();
      this._schedulePheasant();
    }, minMs + Math.random() * spanMs);
  }

  _scheduleBirds() {
    if (this._birdTimer) { clearTimeout(this._birdTimer); this._birdTimer = null; }
    if (!this.active) return;
    this._birdTimer = setTimeout(() => {
      this._playBirdPhrase();
      this._scheduleBirds();
    }, 3200 + Math.random() * 5500);
  }

  _scheduleCrickets() {
    if (this._cricketTimer) { clearTimeout(this._cricketTimer); this._cricketTimer = null; }
    if (!this.active) return;
    this._cricketTimer = setTimeout(() => {
      this._playCricketPulse();
      this._scheduleCrickets();
    }, 1400 + Math.random() * 2200);
  }

  setEnabled(on) {
    const want = Boolean(on);
    if (want === this.active) {
      if (want && this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
        this._armGestureResume();
      }
      return this.active;
    }
    return this.toggle();
  }

  toggle() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return false;
      this.ctx = new AudioCtx();
    }
    this.active = !this.active;
    if (this.active) {
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
        this._armGestureResume();
      } else {
        this._playBirdPhrase();
      }
      this._scheduleBirds();
      this._scheduleCrickets();
      this._schedulePheasant();
    } else {
      this._disarmGestureResume();
      for (const t of [this._pheasantTimer, this._birdTimer, this._cricketTimer]) {
        if (t) clearTimeout(t);
      }
      this._pheasantTimer = this._birdTimer = this._cricketTimer = null;
    }
    return this.active;
  }

  dispose() {
    this.active = false;
    this._disarmGestureResume();
    for (const t of [this._pheasantTimer, this._birdTimer, this._cricketTimer]) {
      if (t) clearTimeout(t);
    }
    this._pheasantTimer = this._birdTimer = this._cricketTimer = null;
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }
}
