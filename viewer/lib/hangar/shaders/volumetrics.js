import * as THREE from 'three';

/**
 * Soft Fresnel-faded volumetric light shafts streaming into the open hangar bay,
 * through both translucent fiberglass side panels, along the rear-wall vertical slits,
 * plus subtle sunlit floating dust motes inside the hangar.
 */
export class VolumetricSystem {
  constructor(scene) {
    this.root = new THREE.Group();
    this.root.name = 'VolumetricLighting';
    scene.add(this.root);

    this.uniforms = {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(0xfff1d6) },
      uStrength: { value: 0.85 },
      uSunDir: { value: new THREE.Vector3(0.4, 0.45, 0.78).normalize() },
    };

    this.frontShaftGroup = new THREE.Group();
    this.frontShaftGroup.name = 'FrontBayShafts';
    this.root.add(this.frontShaftGroup);

    this._buildFrontBayShafts();
    this._buildSidePanelShafts();
    this._buildRearSlitSlivers();
    this._buildDustMotes();
  }

  _makeShaftMaterial({ opacity = 0.085, fresnelPower = 1.65, noiseScale = 1.2 } = {}) {
    return new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: this.uniforms.uTime,
        uColor: this.uniforms.uColor,
        uStrength: this.uniforms.uStrength,
        uOpacity: { value: opacity },
        uFresnelPow: { value: fresnelPower },
        uNoiseScale: { value: noiseScale },
      },
      vertexShader: `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        varying vec2 vUv;
        varying vec3 vWorldPos;
        varying vec3 vWorldNormal;
        void main() {
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          vWorldNormal = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * wp;
          #include <logdepthbuf_vertex>
        }
      `,
      fragmentShader: `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        uniform float uTime;
        uniform vec3 uColor;
        uniform float uStrength;
        uniform float uOpacity;
        uniform float uFresnelPow;
        uniform float uNoiseScale;
        varying vec2 vUv;
        varying vec3 vWorldPos;
        varying vec3 vWorldNormal;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }
        float vnoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
            mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
            u.y
          );
        }

        void main() {
          // Soft longitudinal fade (vUv.y = 1 at light source, 0 at far floor end)
          float along = smoothstep(0.0, 0.32, vUv.y) * smoothstep(1.0, 0.74, vUv.y);
          // Soft cross-beam edge fade + striated god-ray sub-beams
          float edge = smoothstep(0.0, 0.30, vUv.x) * smoothstep(1.0, 0.70, vUv.x);
          float rays = 0.62 + 0.38 * sin(vUv.x * 18.84 + uTime * 0.14);

          // Grazing-angle Fresnel fade prevents harsh card intersections from any orbit angle
          vec3 viewDir = normalize(cameraPosition - vWorldPos);
          float ndv = abs(dot(normalize(vWorldNormal), viewDir));
          float fresnel = pow(ndv, uFresnelPow);

          // Soft height fade near floor & roof ridge to avoid sharp clipping
          float floorFade = smoothstep(0.03, 0.42, vWorldPos.y) * smoothstep(3.85, 3.15, vWorldPos.y);

          // Animated scrolling dust-curtain turbulence inside each god ray
          vec2 nUv1 = vec2(vUv.x * 4.2 * uNoiseScale, vUv.y * 1.6 - uTime * 0.032);
          vec2 nUv2 = vec2(vUv.x * 8.5 * uNoiseScale + 2.7, vUv.y * 2.8 - uTime * 0.019);
          float haze = 0.58 + 0.28 * vnoise(nUv1) + 0.14 * vnoise(nUv2);

          float alpha = along * edge * rays * fresnel * floorFade * haze * uOpacity * uStrength;
          if (alpha < 0.001) discard;
          gl_FragColor = vec4(uColor * alpha * 1.15, alpha);
          #include <logdepthbuf_fragment>
        }
      `,
    });
  }

  _buildFrontBayShafts() {
    // Cinematic sun-aligned diagonal god-ray shafts raking from the open hangar front across the glider
    const mat = this._makeShaftMaterial({ opacity: 0.20, fresnelPower: 1.2, noiseScale: 1.1 });
    const configs = [
      { x: -3.2, w: 3.8, len: 5.8, y: 1.48, z: 1.55, rotY: 0.20 },
      { x: -0.6, w: 4.8, len: 6.2, y: 1.55, z: 1.35, rotY: 0.06 },
      { x:  1.9, w: 4.2, len: 5.8, y: 1.48, z: 1.45, rotY: -0.08 },
      { x:  0.2, w: 5.4, len: 5.2, y: 2.35, z: 1.95, rotY: 0.12 }, // upper gable rafter light shaft
    ];
    for (const c of configs) {
      const geo = new THREE.PlaneGeometry(c.w, c.len, 1, 1);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(c.x, c.y, c.z);
      mesh.rotation.set(THREE.MathUtils.degToRad(56), c.rotY, 0, 'YXZ');
      mesh.renderOrder = 5;
      this.frontShaftGroup.add(mesh);
    }
  }

  _buildSidePanelShafts() {
    // Distinct diagonal volumetric god rays pouring inward from both milky-white translucent side panels
    const mat = this._makeShaftMaterial({ opacity: 0.28, fresnelPower: 1.1, noiseScale: 1.3 });
    const panelZ = -1.945;
    for (const side of [-1, 1]) {
      for (const tilt of [-0.26, 0.0, 0.26]) {
        const geo = new THREE.PlaneGeometry(1.18, 5.2, 1, 1);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(side * 4.15, 1.32, panelZ + tilt * 0.42);
        mesh.rotation.set(0, side > 0 ? Math.PI / 2 + tilt : -Math.PI / 2 + tilt, side * THREE.MathUtils.degToRad(60), 'YXZ');
        mesh.renderOrder = 6;
        this.root.add(mesh);
      }
    }
  }

  _buildRearSlitSlivers() {
    // Subtle high-angle shafts slicing through upper rear-gable eaves & rafters
    const mat = this._makeShaftMaterial({ opacity: 0.11, fresnelPower: 1.15, noiseScale: 1.8 });
    const xs = [-4.2, -2.6, -1.1, 0.4, 2.0, 3.8];
    for (const x of xs) {
      const geo = new THREE.PlaneGeometry(0.45, 2.4, 1, 1);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, 1.35, -5.25);
      mesh.rotation.set(THREE.MathUtils.degToRad(14), 0, 0);
      mesh.renderOrder = 6;
      this.root.add(mesh);
    }
  }

  _buildDustMotes() {
    // 320 backlit dust motes concentrated directly inside the volumetric god-ray shafts
    // (left & right fiberglass side-panel shafts + open front sunbeam)
    const count = 320;
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count * 3);
    let s = 1337;
    const rnd = () => {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };

    for (let i = 0; i < count; i++) {
      if (i < 130) {
        // Directly inside left & right fiberglass side-panel diagonal god-ray shafts (z ~ -1.95)
        const side = i % 2 === 0 ? 1 : -1;
        const along = rnd(); // 0 at fiberglass panel, 1 deeper inside bay
        positions[i * 3 + 0] = side * (5.65 - along * 3.55 + (rnd() - 0.5) * 0.65);
        positions[i * 3 + 1] = 2.65 - along * 2.10 + (rnd() - 0.5) * 0.55;
        positions[i * 3 + 2] = -1.95 + (rnd() - 0.5) * 1.45;
      } else if (i < 250) {
        // Directly inside open front hangar diagonal sunbeam shafts
        const along = rnd();
        positions[i * 3 + 0] = (rnd() * 2 - 1) * 4.8;
        positions[i * 3 + 1] = 0.45 + (1.0 - along * 0.65) * 2.55 + (rnd() - 0.5) * 0.4;
        positions[i * 3 + 2] = 0.1 + along * 4.1;
      } else {
        // Ambient bay motes drifting through shaded rafters & interior
        positions[i * 3 + 0] = (rnd() * 2 - 1) * 5.6;
        positions[i * 3 + 1] = 0.35 + rnd() * 2.9;
        positions[i * 3 + 2] = -4.6 + Math.pow(rnd(), 0.72) * 8.6;
      }
      seeds[i * 3 + 0] = rnd() * 6.283;
      seeds[i * 3 + 1] = 0.55 + rnd() * 0.85;
      seeds[i * 3 + 2] = 0.65 + rnd() * 0.85;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: this.uniforms.uTime,
        uColor: this.uniforms.uColor,
        uStrength: this.uniforms.uStrength,
        uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
      },
      vertexShader: `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        attribute vec3 aSeed;
        uniform float uTime;
        uniform float uPixelRatio;
        varying float vAlpha;
        void main() {
          vec3 p = position;
          // Slow dreamy drift inside the volumetric shafts
          float t = uTime * 0.085 * aSeed.y + aSeed.x;
          p.x += sin(t * 0.9) * 0.16;
          p.y += cos(t * 0.65 + aSeed.z) * 0.09;
          p.z += sin(t * 0.50 + aSeed.x) * 0.14;

          // Brightest inside the sunlit front opening and diagonal side-panel god rays
          float frontLit = smoothstep(-1.2, 3.2, p.z);
          float sideLit = exp(-pow(p.z + 1.95, 2.0) * 0.75) * smoothstep(1.8, 5.4, abs(p.x));
          float inShaft = max(frontLit, sideLit);
          float twinkle = 0.62 + 0.38 * sin(t * 2.2 + aSeed.z * 4.0);
          vAlpha = (0.28 + 0.72 * inShaft) * twinkle;

          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          #include <logdepthbuf_vertex>
          gl_PointSize = clamp((30.0 * aSeed.z * uPixelRatio) / max(-mv.z, 1.0), 4.0 * uPixelRatio, 8.5 * uPixelRatio);
        }
      `,
      fragmentShader: `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        uniform vec3 uColor;
        uniform float uStrength;
        varying float vAlpha;
        void main() {
          float r = length(gl_PointCoord - vec2(0.5));
          // Crisp bright radial core + soft glowing backlit halo (readable without bloom)
          float core = smoothstep(0.24, 0.02, r);
          float halo = smoothstep(0.50, 0.08, r) * 0.48;
          float shape = clamp(core + halo, 0.0, 1.0);
          float a = shape * vAlpha * 0.88 * clamp(uStrength, 0.75, 1.45);
          if (a < 0.005) discard;
          vec3 col = mix(uColor, vec3(1.0, 0.98, 0.92), core * 0.55);
          gl_FragColor = vec4(col * a * 1.45, clamp(a, 0.0, 1.0));
          #include <logdepthbuf_fragment>
        }
      `,
    });

    this.motes = new THREE.Points(geo, mat);
    this.motes.name = 'SunlitDustMotes';
    this.motes.frustumCulled = false;
    this.motes.renderOrder = 7;
    this.root.add(this.motes);
  }

  syncSun(sunDir, preset) {
    this.uniforms.uSunDir.value.copy(sunDir);
    this.uniforms.uColor.value.setHex(preset.sunColor);
    this.uniforms.uStrength.value = preset.volumetricStrength;

    // Gently orient the front bay shafts toward the sun azimuth/elevation
    const azim = Math.atan2(sunDir.x, Math.max(sunDir.z, 0.25));
    this.frontShaftGroup.rotation.y = THREE.MathUtils.clamp(azim * 0.35, -0.42, 0.42);
  }

  setEnabled(on) {
    this.root.visible = on;
  }

  setStrength(val) {
    this.uniforms.uStrength.value = val;
  }

  update(seconds) {
    this.uniforms.uTime.value = seconds;
  }
}
