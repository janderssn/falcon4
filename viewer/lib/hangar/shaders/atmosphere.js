import * as THREE from 'three';

/**
 * Physically-based Rayleigh + Mie atmospheric scattering sky dome,
 * PMREM IBL generator, aerial perspective fog, and Nordic sun presets.
 */
export const SUN_PRESETS = {
  nordic_day: {
    id: 'nordic_day',
    label: 'Nordic Day',
    elevationDeg: 26,
    azimuthDeg: 38, // warm raking summer sun from front-right (+X, +Z) carving crisp shadows
    rayleigh: 2.05,
    mieCoeff: 0.0048,
    mieDirectionalG: 0.82,
    turbidity: 1.75,
    sunColor: 0xffecd0,
    sunIntensity: 3.15,
    hemiSky: 0xa4c8ee,
    hemiGround: 0x4f5c44,
    hemiIntensity: 0.95,
    fillColor: 0x9ac0e8,
    fillIntensity: 0.34,
    bounceIntensity: 0.95,
    interiorFillIntensity: 0.48,
    envIntensity: 0.98,
    fogColor: 0xbcd2e6,
    fogDensity: 0.0038,
    exposure: 1.04,
    volumetricStrength: 1.0,
  },
  golden_hour: {
    id: 'golden_hour',
    label: 'Golden Hour',
    elevationDeg: 11.5,
    azimuthDeg: 42,
    rayleigh: 2.65,
    mieCoeff: 0.011,
    mieDirectionalG: 0.86,
    turbidity: 3.8,
    sunColor: 0xffad58,
    sunIntensity: 3.65,
    hemiSky: 0x82a0cf,
    hemiGround: 0x524534,
    hemiIntensity: 0.78,
    fillColor: 0x7e9ed0,
    fillIntensity: 0.30,
    bounceIntensity: 0.92,
    interiorFillIntensity: 0.42,
    envIntensity: 0.88,
    fogColor: 0xd6b292,
    fogDensity: 0.0052,
    exposure: 1.05,
    volumetricStrength: 1.35,
  },
  overcast: {
    id: 'overcast',
    label: 'Overcast',
    elevationDeg: 40,
    azimuthDeg: 22,
    rayleigh: 0.85,
    mieCoeff: 0.022,
    mieDirectionalG: 0.62,
    turbidity: 6.5,
    sunColor: 0xf4f6fa,
    sunIntensity: 1.35,
    hemiSky: 0xd8e2ec,
    hemiGround: 0x626956,
    hemiIntensity: 1.20,
    fillColor: 0xcfdbe6,
    fillIntensity: 0.50,
    bounceIntensity: 1.05,
    interiorFillIntensity: 0.45,
    envIntensity: 0.96,
    fogColor: 0xd3dde6,
    fogDensity: 0.0050,
    exposure: 1.02,
    volumetricStrength: 0.42,
  },
};

function sunDirFromAngles(elevDeg, azimDeg) {
  const phi = THREE.MathUtils.degToRad(90 - elevDeg);
  const theta = THREE.MathUtils.degToRad(azimDeg);
  return new THREE.Vector3(
    Math.sin(phi) * Math.sin(theta),
    Math.cos(phi),
    Math.sin(phi) * Math.cos(theta)
  ).normalize();
}

export class AtmosphereSystem {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.scene = scene;
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = null;
    this.active = true;
    this.centerOffset = new THREE.Vector3();
    this._fog = null;
    this._envIntensity = 0.98;
    this._exposure = 1.04;

    this.sunDir = new THREE.Vector3(0.4, 0.5, 0.7).normalize();
    this.currentPreset = SUN_PRESETS.nordic_day;

    this.uniforms = {
      uSunDir: { value: this.sunDir.clone() },
      uRayleigh: { value: 1.65 },
      uMieCoeff: { value: 0.0055 },
      uMieG: { value: 0.80 },
      uTurbidity: { value: 2.2 },
      uTime: { value: 0.0 },
      uCloudCover: { value: 0.42 },
      uGroundColor: { value: new THREE.Color(0x6c7559) },
      uHorizonTint: { value: new THREE.Color(0xd5e2ec) },
    };

    // Sky dome radius extended to 600 m so 1000 m airfield meadow blends seamlessly into horizon
    const skyGeo = new THREE.SphereGeometry(600, 48, 32);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: this.uniforms,
      vertexShader: `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        varying vec3 vWorldDir;
        void main() {
          vWorldDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          #include <logdepthbuf_vertex>
        }
      `,
      fragmentShader: `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        uniform vec3 uSunDir;
        uniform float uRayleigh;
        uniform float uMieCoeff;
        uniform float uMieG;
        uniform float uTurbidity;
        uniform float uTime;
        uniform float uCloudCover;
        uniform vec3 uGroundColor;
        uniform vec3 uHorizonTint;
        varying vec3 vWorldDir;

        // Wavelength-dependent Rayleigh scattering coefficients (scaled for visual sky)
        const vec3 BETA_R = vec3(5.5e-6, 13.0e-6, 22.4e-6) * 2.2e4;

        float skyHash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }
        float skyNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(skyHash(i), skyHash(i + vec2(1.0, 0.0)), u.x),
            mix(skyHash(i + vec2(0.0, 1.0)), skyHash(i + vec2(1.0, 1.0)), u.x),
            u.y
          );
        }
        float skyFbm(vec2 p) {
          float v = 0.0, a = 0.5;
          mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
          for (int i = 0; i < 4; i++) {
            v += a * skyNoise(p);
            p = rot * p * 2.04 + vec2(1.7, 9.2);
            a *= 0.5;
          }
          return v;
        }

        float rayleighPhase(float cosTheta) {
          return (3.0 / (16.0 * PI)) * (1.0 + cosTheta * cosTheta);
        }

        float miePhase(float cosTheta, float g) {
          float g2 = g * g;
          float denom = pow(max(1.0 + g2 - 2.0 * g * cosTheta, 0.0005), 1.5);
          return (1.0 / (4.0 * PI)) * ((1.0 - g2) / denom);
        }

        void main() {
          vec3 dir = normalize(vWorldDir);
          vec3 sunDir = normalize(uSunDir);
          float y = dir.y;
          float sunY = max(sunDir.y, 0.02);
          float cosTheta = dot(dir, sunDir);

          // Optical depth approximation (Kasten & Young air mass)
          float zenithCos = max(y, 0.0);
          float airMass = 1.0 / (zenithCos + 0.15 * pow(max(zenithCos * 90.0 + 3.885, 0.5), -1.253));
          float sunAirMass = 1.0 / (sunY + 0.15 * pow(max(sunY * 90.0 + 3.885, 0.5), -1.253));

          vec3 betaR = BETA_R * uRayleigh;
          vec3 betaM = vec3(0.021) * uMieCoeff * 40.0 * uTurbidity;

          // Transmittance along sun path & view path
          vec3 sunTrans = exp(-(betaR * 0.28 + betaM * 0.12) * sunAirMass);
          vec3 viewExt = exp(-(betaR * 0.18 + betaM * 0.14) * min(airMass, 14.0));

          float rPhase = rayleighPhase(cosTheta);
          float mPhase = miePhase(cosTheta, uMieG);

          vec3 scatterR = betaR * rPhase;
          vec3 scatterM = betaM * mPhase * 0.65;
          vec3 totalBeta = max(betaR + betaM, vec3(1e-4));

          vec3 sky = sunTrans * (scatterR + scatterM) / totalBeta * (1.0 - viewExt) * 3.4;

          // Soft Nordic cloud-deck / horizon haze blend — converges seamlessly to exact uHorizonTint (= uFogColor)
          float overcastMix = smoothstep(3.0, 6.8, uTurbidity) * 0.58;
          float horizonBand = exp(-max(y, 0.0) * 6.2);
          vec3 overcastSky = mix(uHorizonTint * 0.88, uHorizonTint * 1.02, 1.0 - smoothstep(0.0, 0.75, max(y, 0.0)));
          sky = mix(sky, overcastSky, overcastMix);
          sky = mix(sky, uHorizonTint, clamp(horizonBand, 0.0, 1.0));

          // Crisp solar disc + warm Mie aureole
          float sunDisc = smoothstep(0.99935, 0.99985, cosTheta) * (1.0 - overcastMix * 0.85);
          float aureole = pow(max(cosTheta, 0.0), 28.0) * 0.35 * (1.0 - overcastMix * 0.6);
          sky += sunTrans * (sunDisc * 4.5 + aureole);

          // Drifting multi-layer Nordic cumulus/stratus cloud deck above horizon
          if (y > 0.025) {
            vec2 cloudUV = dir.xz / (y + 0.14);
            vec2 drift1 = vec2(uTime * 0.0085, uTime * 0.0032);
            vec2 drift2 = vec2(uTime * 0.0042, -uTime * 0.0021);
            float c1 = skyFbm(cloudUV * 0.55 + drift1);
            float c2 = skyFbm(cloudUV * 1.15 - drift2);
            float cloudDensity = smoothstep(1.0 - uCloudCover, 1.0 - uCloudCover + 0.42, c1 * 0.72 + c2 * 0.38);
            float horizonFade = smoothstep(0.025, 0.24, y);
            cloudDensity *= horizonFade * 0.78;

            // Sunlit cloud top & silver-lining forward scattering vs soft shadowed base
            float silverLining = pow(max(cosTheta, 0.0), 6.0) * 0.45;
            vec3 cloudLit = mix(uHorizonTint * 1.06, sunTrans * 1.15 + vec3(0.24), 0.45 + silverLining);
            vec3 cloudBase = uHorizonTint * 0.72;
            vec3 cloudCol = mix(cloudBase, cloudLit, clamp(0.45 + c2 * 0.55, 0.0, 1.0));
            sky = mix(sky, cloudCol, cloudDensity);
          }

          // Exact horizon lock (y <= 0.02) + below-horizon hemisphere match uHorizonTint (= scene.fog.color) identically
          float exactHorizon = 1.0 - smoothstep(0.012, 0.06, y);
          sky = mix(sky, uHorizonTint, exactHorizon);

          gl_FragColor = vec4(max(sky, vec3(0.0)), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <logdepthbuf_fragment>
        }
      `,
    });

    this.skyMesh = new THREE.Mesh(skyGeo, skyMat);
    this.skyMesh.name = 'AtmosphericSkyDome';
    this.skyMesh.renderOrder = -1000;
    this.skyMesh.frustumCulled = false;
    scene.add(this.skyMesh);

    // Offscreen scene for PMREM environment map baking
    this.envScene = new THREE.Scene();
    this.envDome = new THREE.Mesh(skyGeo, skyMat);
    this.envScene.add(this.envDome);

    // Primary lighting rig
    this.sunLight = new THREE.DirectionalLight(0xfff5e4, 2.25);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.left = -17;
    this.sunLight.shadow.camera.right = 17;
    this.sunLight.shadow.camera.top = 17;
    this.sunLight.shadow.camera.bottom = -17;
    this.sunLight.shadow.camera.near = 1;
    this.sunLight.shadow.camera.far = 80;
    this.sunLight.shadow.bias = -0.0004;
    this.sunLight.shadow.normalBias = 0.022;
    this.sunLight.shadow.radius = 2.6;

    this.hemiLight = new THREE.HemisphereLight(0xdbe8f7, 0x8b927c, 1.15);
    this.fillLight = new THREE.DirectionalLight(0xcbe0f5, 0.55);
    this.fillLight.position.set(-14, 7, -12);

    // Broad shadow-free upward bounce light so steel rafters, purlins & roof underside are evenly lit (no floor hotspot)
    this.bounceLight = new THREE.DirectionalLight(0xe6e1d5, 1.25);
    this.bounceLight.position.set(1.5, -10.0, 5.5);
    this.bounceLight.target.position.set(0.0, 3.2, -1.5);

    // Broad soft sky-portal fill entering horizontally from the open +Z front bay (no point-light specular dot)
    this.interiorFill = new THREE.DirectionalLight(0xe8eff7, 0.42);
    this.interiorFill.position.set(0.0, 2.2, 18.0);
    this.interiorFill.target.position.set(0.0, 2.0, -5.0);

    scene.add(
      this.sunLight,
      this.sunLight.target,
      this.hemiLight,
      this.fillLight,
      this.bounceLight,
      this.bounceLight.target,
      this.interiorFill,
      this.interiorFill.target
    );
  }

  applyPreset(id) {
    const p = SUN_PRESETS[id] || SUN_PRESETS.nordic_day;
    this.currentPreset = p;
    this.sunDir.copy(sunDirFromAngles(p.elevationDeg, p.azimuthDeg));

    this.uniforms.uSunDir.value.copy(this.sunDir);
    this.uniforms.uRayleigh.value = p.rayleigh;
    this.uniforms.uMieCoeff.value = p.mieCoeff;
    this.uniforms.uMieG.value = p.mieDirectionalG;
    this.uniforms.uTurbidity.value = p.turbidity;
    this.uniforms.uCloudCover.value = id === 'overcast' ? 0.78 : id === 'golden_hour' ? 0.48 : 0.44;
    this.uniforms.uHorizonTint.value.setHex(p.fogColor);
    this.uniforms.uGroundColor.value.setHex(p.hemiGround);

    this.sunLight.position.copy(this.centerOffset).addScaledVector(this.sunDir, 32);
    this.sunLight.target.position.copy(this.centerOffset);
    this.sunLight.target.updateMatrixWorld();
    this.sunLight.color.setHex(p.sunColor);
    this.sunLight.intensity = p.sunIntensity;

    this.hemiLight.color.setHex(p.hemiSky);
    this.hemiLight.groundColor.setHex(p.hemiGround);
    this.hemiLight.intensity = p.hemiIntensity;

    this.fillLight.color.setHex(p.fillColor);
    this.fillLight.intensity = p.fillIntensity;

    this.baseSunIntensity = p.sunIntensity;
    this.baseHemiIntensity = p.hemiIntensity;

    // Scale upward gravel bounce & open-front sky-portal fill so rear interior reads cleanly
    this.bounceLight.color.setHex(id === 'golden_hour' ? 0xe8be90 : 0xd6dde3);
    this.bounceLight.intensity = p.bounceIntensity ?? 0.95;
    this.interiorFill.color.setHex(id === 'golden_hour' ? 0xf5cfa5 : 0xc6dcf4);
    this.interiorFill.intensity = p.interiorFillIntensity ?? 0.48;

    this._fog = new THREE.FogExp2(p.fogColor, p.fogDensity);
    this._exposure = p.exposure;
    this._envIntensity = p.envIntensity;

    this.rebakeIBL(p.envIntensity);
    if (this.active) this._applySceneGlobals();
    return p;
  }

  _applySceneGlobals() {
    this.scene.background = null;
    if (this.envRT) this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = this._envIntensity;
    this.scene.fog = this._fog;
    this.renderer.toneMappingExposure = this._exposure;
  }

  setActive(on) {
    this.active = Boolean(on);
    this.skyMesh.visible = this.active;
    this.sunLight.visible = this.active;
    this.hemiLight.visible = this.active;
    this.fillLight.visible = this.active;
    this.bounceLight.visible = this.active;
    this.interiorFill.visible = this.active;
    if (this.active) {
      this._applySceneGlobals();
    }
  }

  setCenter(center) {
    this.centerOffset.copy(center);
    this.skyMesh.position.set(center.x, center.y, center.z);
    this.sunLight.target.position.copy(this.centerOffset);
    this.sunLight.position.copy(this.centerOffset).addScaledVector(this.sunDir, 32);
    this.sunLight.target.updateMatrixWorld();
    this.bounceLight.target.position.set(center.x, center.y + 3.2, center.z - 1.5);
    this.bounceLight.position.set(center.x + 1.5, center.y - 10.0, center.z + 5.5);
    this.bounceLight.target.updateMatrixWorld();
    this.interiorFill.target.position.set(center.x, center.y + 2.0, center.z - 5.0);
    this.interiorFill.position.set(center.x, center.y + 2.2, center.z + 18.0);
    this.interiorFill.target.updateMatrixWorld();
  }

  rebakeIBL(envIntensity = this._envIntensity) {
    if (this.envRT) this.envRT.dispose();
    this.envRT = this.pmrem.fromScene(this.envScene, 0.035);
    if (envIntensity !== undefined) this._envIntensity = envIntensity;
    if (this.active) {
      this.scene.environment = this.envRT.texture;
      this.scene.environmentIntensity = this._envIntensity;
    }
  }

  setSunAngles(elevDeg, azimDeg, { rebake = false } = {}) {
    this.sunDir.copy(sunDirFromAngles(elevDeg, azimDeg));
    this.uniforms.uSunDir.value.copy(this.sunDir);
    this.sunLight.position.copy(this.centerOffset).addScaledVector(this.sunDir, 32);
    if (rebake) this.rebakeIBL();
  }

  setLightParams({ sunIntensity, hemiIntensity, bounceIntensity, envIntensity, exposure }) {
    if (sunIntensity !== undefined) {
      this.baseSunIntensity = sunIntensity;
      this.sunLight.intensity = sunIntensity;
    }
    if (hemiIntensity !== undefined) {
      this.baseHemiIntensity = hemiIntensity;
      this.hemiLight.intensity = hemiIntensity;
      this.fillLight.intensity = hemiIntensity * 0.36;
    }
    if (bounceIntensity !== undefined) {
      this.bounceLight.intensity = bounceIntensity;
      this.interiorFill.intensity = bounceIntensity * 0.50;
    }
    if (envIntensity !== undefined) {
      this._envIntensity = envIntensity;
      if (this.active) this.scene.environmentIntensity = envIntensity;
    }
    if (exposure !== undefined) {
      this._exposure = exposure;
      if (this.active) this.renderer.toneMappingExposure = exposure;
    }
  }

  dispose() {
    if (this.envRT) { this.envRT.dispose(); this.envRT = null; }
    this.pmrem.dispose();
    this.skyMesh.geometry.dispose();
    this.skyMesh.material.dispose();
    this.scene.remove(
      this.skyMesh,
      this.sunLight,
      this.sunLight.target,
      this.hemiLight,
      this.fillLight,
      this.bounceLight,
      this.bounceLight.target,
      this.interiorFill,
      this.interiorFill.target
    );
  }

  setShadows(enabled) {
    this.sunLight.castShadow = enabled;
    this.renderer.shadowMap.needsUpdate = true;
  }

  update(seconds) {
    this.uniforms.uTime.value = seconds;
    // Living cloud-light breathing: gentle ±7% breeze-driven sun & ambient shimmer
    const breathe = 1.0 + Math.sin(seconds * 0.27) * 0.045 + Math.sin(seconds * 0.61 + 1.4) * 0.028;
    if (this.baseSunIntensity !== undefined) {
      this.sunLight.intensity = this.baseSunIntensity * breathe;
      this.hemiLight.intensity = this.baseHemiIntensity * (0.98 + 0.02 * breathe);
    }
  }
}
