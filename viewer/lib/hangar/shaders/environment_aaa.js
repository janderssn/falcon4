import * as THREE from 'three';

/**
 * AAA Living Nordic Airfield Environment Layer:
 * 1. Extended 1000x1000m seamless airfield meadow that dissolves smoothly into the
 *    atmospheric sky horizon (zero hard horizon seam).
 * 2. Dense, short, mowed lush airfield turf (52,000 crossed 3-blade clumps = 156,000 blades,
 *    5-11 cm tall, 1 draw call) with Nordic green/clover/straw macro patches, root AO,
 *    sunlit subsurface translucency, dew specular sheen, and rolling wind-wave ripples.
 * 3. Full continuous distant Swedish conifer/birch treeline silhouette ring tinted by
 *    atmospheric aerial perspective haze.
 * 4. Animated orange-and-white airfield windsock reacting to the shared wind vector.
 * 5. Grounded contact AO shadows + subtle gravel/apron wheel-track decals.
 */
export class AAAEnvironment {
  constructor(scene, renderer = null) {
    this.root = new THREE.Group();
    this.root.name = 'AAAEnvironment';
    scene.add(this.root);
    this.renderer = renderer;

    this.windDir = new THREE.Vector2(0.82, 0.57).normalize();
    this.sharedUniforms = {
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0.4, 0.5, 0.7).normalize() },
      uSunColor: { value: new THREE.Color(0xfff5e4) },
      uFogColor: { value: new THREE.Color(0xc8d8e6) },
      uFogDensity: { value: 0.0042 },
      uWindDir: { value: this.windDir },
      uDetailEnabled: { value: 1.0 },
      uWetnessGain: { value: 1.0 },
      uGrassLushness: { value: 1.0 },
    };

    this.terrainMat = null;
    this.terrainShader = null;

    this._buildDenseLushTurf();
    this._buildTreelineHorizon();
    this._buildWindsock();
    this._buildContactAOAndDecals();
  }

  setDetailEnabled(on) {
    this.sharedUniforms.uDetailEnabled.value = on ? 1.0 : 0.0;
  }

  setTerrainLook({ wetness, grassLushness }) {
    if (wetness !== undefined) this.sharedUniforms.uWetnessGain.value = wetness;
    if (grassLushness !== undefined) this.sharedUniforms.uGrassLushness.value = grassLushness;
  }

  buildUnifiedGround(textures) {
    // ONE single continuous 1000x1000 m MeshStandardMaterial ground plane at Y = 0.000
    // covering BOTH the hangar interior AND the entire airfield meadow:
    // - Shares already-awaited textures from CustomMaterialSystem (zero duplicate network downloads!)
    // - Mathematically impossible to have rectangular floor seams or z-fighting!
    // - Receives full Three.js soft directional shadows, PMREM IBL, and GTAO seamlessly.
    const {
      dirtAlbedo, dirtNormal, dirtORM, dirtDetailN, dirtDetailR,
      grassAlbedo, grassNormal, grassRough,
    } = textures || {};
    if (!dirtAlbedo || !grassAlbedo) return;

    const existing = this.root.getObjectByName('UnifiedAirfieldGround');
    if (existing) this.root.remove(existing);

    // Non-uniformly concentrated 96x96 grid: ~0.25m vertex spacing inside & around the hangar
    // expanding smoothly to +-500m at the horizon (1 draw call, eliminates 1/w float32 texture
    // swimming/twitching when zoomed in <1m at grazing macro angles!).
    const geo = new THREE.PlaneGeometry(2, 2, 96, 96);
    const posAttr = geo.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
      const ux = posAttr.getX(i);
      const uy = posAttr.getY(i);
      const mapAxis = (u) => Math.sign(u) * (12.0 * Math.abs(u) + 488.0 * Math.pow(Math.abs(u), 4.0));
      posAttr.setXYZ(i, mapAxis(ux), mapAxis(uy), 0);
    }
    posAttr.needsUpdate = true;
    geo.rotateX(-Math.PI / 2);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();

    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.92,
      metalness: 0.0,
    });

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.sharedUniforms.uTime;
      shader.uniforms.uSunDir = this.sharedUniforms.uSunDir;
      shader.uniforms.uSunColor = this.sharedUniforms.uSunColor;
      shader.uniforms.uFogColor = this.sharedUniforms.uFogColor;
      shader.uniforms.uWindDir = this.sharedUniforms.uWindDir;
      shader.uniforms.uDetailEnabled = this.sharedUniforms.uDetailEnabled;
      shader.uniforms.uWetnessGain = this.sharedUniforms.uWetnessGain;
      shader.uniforms.uGrassLushness = this.sharedUniforms.uGrassLushness;

      shader.uniforms.uDirtA = { value: dirtAlbedo };
      shader.uniforms.uDirtN = { value: dirtNormal };
      shader.uniforms.uDirtORM = { value: dirtORM };
      shader.uniforms.uDirtDN = { value: dirtDetailN };
      shader.uniforms.uDirtDR = { value: dirtDetailR };

      shader.uniforms.uGrassA = { value: grassAlbedo };
      shader.uniforms.uGrassN = { value: grassNormal };
      shader.uniforms.uGrassR = { value: grassRough };

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          varying highp vec3 vTerrainWorldPos;
          varying highp vec3 vTerrainLocalPos;`
        )
        .replace(
          '#include <worldpos_vertex>',
          `#include <worldpos_vertex>
          vTerrainWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vTerrainLocalPos = transformed;`
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying highp vec3 vTerrainWorldPos;
          varying highp vec3 vTerrainLocalPos;
          uniform float uTime;
          uniform vec3 uSunDir;
          uniform vec3 uSunColor;
          uniform vec3 uFogColor;
          uniform vec2 uWindDir;
          uniform float uDetailEnabled;
          uniform float uWetnessGain;
          uniform float uGrassLushness;

          uniform sampler2D uDirtA;
          uniform sampler2D uDirtN;
          uniform sampler2D uDirtORM;
          uniform sampler2D uDirtDN;
          uniform sampler2D uDirtDR;

          uniform sampler2D uGrassA;
          uniform sampler2D uGrassN;
          uniform sampler2D uGrassR;

          float trHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
          float trNoise(vec2 p) {
            vec2 i = floor(p), f = fract(p);
            vec2 u = f * f * (3.0 - 2.0 * f);
            return mix(
              mix(trHash(i), trHash(i + vec2(1.0, 0.0)), u.x),
              mix(trHash(i + vec2(0.0, 1.0)), trHash(i + vec2(1.0, 1.0)), u.x),
              u.y
            );
          }
          float trFbm(vec2 p) {
            return trNoise(p) * 0.56 + trNoise(p * 2.07 + vec2(3.1, 1.7)) * 0.29 + trNoise(p * 4.29 + vec2(7.7, 5.3)) * 0.15;
          }

          const mat2 TR_ROT = mat2(0.80, -0.60, 0.60, 0.80);
          vec2 trDirtUvA(vec2 p) { return p / 1.5; }
          vec2 trDirtUvB(vec2 p) { return TR_ROT * p / 1.93 + vec2(0.37, 0.11); }
          float trDirtMix(vec2 p) { return smoothstep(0.38, 0.62, trFbm(p * 0.55 + vec2(7.3, 2.9))); }

          vec2 trGrassUvA(vec2 p) { return p / 2.0; }
          vec2 trGrassUvB(vec2 p) { return (TR_ROT * p) / 2.73 + vec2(0.37, 0.19); }
          float trGrassMix(vec2 p) { return smoothstep(0.35, 0.65, trFbm(p * 0.22 + vec2(4.1, 2.3))); }

          // Returns (splatGrassWeight, rutMask, wallAO) with ZERO straight lines or rectangular borders
          vec3 trComputeSplat(vec2 p, float dirtHeight) {
            // Multi-scale organic coordinate warp completely breaks up any straight hangar edge
            vec2 warp = vec2(
              trFbm(p * 0.34 + vec2(2.1, 7.4)) - 0.5,
              trFbm(p * 0.34 + vec2(8.3, 1.9)) - 0.5
            ) * 2.15 + vec2(
              trFbm(p * 1.12 + vec2(4.7, 3.1)) - 0.5,
              trFbm(p * 1.12 + vec2(1.2, 9.6)) - 0.5
            ) * 0.58;
            vec2 pw = p + warp;

            // Worn wheel ruts leading out the center bay onto the apron
            float rut = exp(-pow(abs(p.x - 1.15), 2.0) * 1.15) + exp(-pow(abs(p.x + 1.15), 2.0) * 1.15);
            float rutMask = clamp(rut * smoothstep(-3.8, 2.2, p.y) * (1.0 - smoothstep(4.5, 11.5, p.y)), 0.0, 1.0);

            // Hangar sheltered interior core (X in [-6.15, 6.15], Z in [-5.55, ~1.4])
            // Front open bay lets irregular patchy grass creep 2-3 m INSIDE (Z ~ 1.0 .. 4.1)
            float insideX = 1.0 - smoothstep(5.45, 6.65, abs(pw.x));
            float insideRear = smoothstep(-6.05, -5.15, pw.y);
            // Deeper dirt/gravel in center wheel-path, grass creeping deeper along sunlit front-left & front-right edges
            float centerPathBias = exp(-pow(p.x * 0.32, 2.0)) * 1.25;
            float frontCutoff = 2.05 + centerPathBias;
            float insideFront = 1.0 - smoothstep(frontCutoff - 1.35, frontCutoff + 2.35, pw.y);
            float shelteredDirt = insideX * insideRear * insideFront;

            // Subtle irregular drip-line / worn earth apron fringe outside walls (zero hard outline)
            vec2 wallBox = abs(p - vec2(0.0, -0.75)) - vec2(6.35, 4.90);
            float wallDist = length(max(wallBox, 0.0));
            float dripDirt = (1.0 - smoothstep(0.0, 1.15, wallDist + (trFbm(p * 0.85) - 0.5) * 0.85)) * 0.42;

            // Authentic thin, patchy Nordic airfield turf: sandy dirt peeks organically through thin grass patches across the field!
            float fieldPatchMacro = trFbm(p * 0.14 + vec2(3.7, 9.1));
            float fieldPatchMed = trFbm(p * 0.52 + vec2(6.2, 1.4));
            float fieldPatchFine = trFbm(p * 1.65 + vec2(2.8, 5.9));
            float thinBareSpots = smoothstep(0.56, 0.84, fieldPatchMacro * 0.52 + fieldPatchMed * 0.34 + fieldPatchFine * 0.14);
            // Extra worn thinness on the front apron (Z in 3..11) and along wheel ruts
            float apronZone = exp(-pow((p.y - 5.6) * 0.20, 2.0)) * exp(-pow(p.x * 0.14, 2.0));
            float baseGrass = 1.0 - max(shelteredDirt, dripDirt);
            baseGrass -= thinBareSpots * (0.34 + apronZone * 0.28);
            baseGrass -= rutMask * 0.32;

            // Patchy grass creeping under the sunlit daylight panels at Z ~ -1.95
            float panelLight = exp(-pow(p.y + 1.95, 2.0) * 0.9) * smoothstep(4.8, 6.2, abs(p.x)) * smoothstep(0.45, 0.78, fieldPatchMed) * 0.45;
            baseGrass = clamp(baseGrass + panelLight, 0.0, 1.0);

            // Height-blend using dirt/gravel pebble height (orm.b) so grass grows in low soil crevices first!
            float grassHeight = 0.42 + 0.36 * fieldPatchFine;
            float hDiff = (baseGrass + grassHeight * 0.34) - ((1.0 - baseGrass) + dirtHeight * 0.34);
            float splat = smoothstep(-0.24, 0.24, hDiff);

            // Keep deep shaded center/rear bay pure dirt/gravel (protects Basebar Corner macro!)
            float deepInterior = (1.0 - smoothstep(4.8, 5.8, abs(p.x))) * smoothstep(-5.5, -4.6, p.y) * (1.0 - smoothstep(0.35, 1.65, p.y));
            splat *= (1.0 - deepInterior);

            // Subtle interior wall/footing contact darkening
            float inHangar = step(abs(p.x), 6.32) * step(-5.65, p.y) * step(p.y, 4.15);
            float wallAO = 1.0 - inHangar * max(smoothstep(5.2, 6.25, abs(p.x)), smoothstep(-4.6, -5.65, p.y)) * 0.26;
            return vec3(clamp(splat, 0.0, 1.0), rutMask, wallAO);
          }

          // Physically-based after-rain / morning-dew wetness & micro-depression mask on dirt/gravel:
          // Smaller organic feathered damp patches; raised stones poke through bumpy & satin-damp,
          // while only tiny broken micro-depressions hold thin water (roof-occluded under overhang!).
          // Returns vec3(wetness, puddleMask, skyExposed)
          vec3 trComputeWetness(vec2 p, float dirtHeight, float rutMask) {
            float wPatch1 = trFbm(p * 0.62 + vec2(3.4, 8.2));
            float wPatch2 = trFbm(p * 1.85 + vec2(7.1, 1.6));
            float wNoise = wPatch1 * 0.62 + wPatch2 * 0.38;

            // Sky exposure: 0 under the hangar roof overhang, 1 out on the open sunlit apron & eaves
            float underRoofX = 1.0 - smoothstep(5.8, 6.65, abs(p.x));
            float underRoofZ = smoothstep(-5.8, -5.2, p.y) * (1.0 - smoothstep(3.5, 4.6, p.y));
            float skyExposed = clamp(1.0 - underRoofX * underRoofZ, 0.0, 1.0);

            // Organic dampness strongest at open front apron, eave drip-lines & wheel-rut hollows
            float frontExpo = smoothstep(0.6, 4.4, p.y);
            float eaveDrip = exp(-pow(abs(abs(p.x) - 6.35) * 1.4, 2.0)) * step(-5.8, p.y) * step(p.y, 4.4);
            float frontDrip = exp(-pow((p.y - 4.15) * 1.1, 2.0)) * step(abs(p.x), 6.8);

            float dampZone = clamp(frontExpo * 0.78 + eaveDrip * 0.72 + frontDrip * 0.60 + rutMask * 0.42, 0.0, 1.0);
            float wetness = smoothstep(0.42, 0.80, wNoise + (dampZone - 0.50) * 0.72);
            // Keep sheltered rear bay dry & dusty
            wetness *= smoothstep(-2.4, 1.2, p.y);
            wetness = clamp(wetness * uWetnessGain, 0.0, 1.0);

            // Height-broken thin micro-depressions: raised gravel pebbles (high dirtHeight) poke cleanly through!
            float crevice = 1.0 - smoothstep(0.14, 0.30, dirtHeight);
            float puddle = smoothstep(0.55, 0.88, wetness) * crevice * skyExposed * clamp(uWetnessGain, 0.0, 1.15);
            return vec3(wetness, clamp(puddle, 0.0, 1.0), skyExposed);
          }
          `
        )
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          {
            vec2 p = vTerrainLocalPos.xz;
            float camDist = length(cameraPosition - vTerrainWorldPos);

            // --- Layer 1: 2048px Packed Dirt & Gravel with PBR After-Rain Wetness ---
            float dMix = trDirtMix(p);
            vec3 dirtCol = mix(texture2D(uDirtA, trDirtUvA(p)).rgb, texture2D(uDirtA, trDirtUvB(p)).rgb, dMix);
            vec3 dirtORM = mix(texture2D(uDirtORM, trDirtUvA(p)).rgb, texture2D(uDirtORM, trDirtUvB(p)).rgb, dMix);
            float nMacro = trFbm(p * 0.34);
            float nMed = trFbm(p * 1.18);

            vec3 splatInfo = trComputeSplat(p, dirtORM.b);
            float grassWeight = splatInfo.x;
            float rutMask = splatInfo.y;
            float wallAO = splatInfo.z;
            vec3 wetInfo = trComputeWetness(p, dirtORM.b, rutMask);
            float wetness = wetInfo.x;
            float puddle = wetInfo.y;

            dirtCol *= mix(0.84, 1.14, nMacro * 0.65 + nMed * 0.35);
            dirtCol *= mix(1.0, 0.90, rutMask * 0.55);
            dirtCol *= mix(1.0, dirtORM.r, 0.55);
            // Gentle, natural porous darkening on damp gravel/earth (never muddy black)
            dirtCol *= mix(1.0, 0.72, wetness * 0.85 + puddle * 0.15);

            // --- Layer 2: Pure 2048x2048 Real-Blade Nordic Airfield Grass (no procedural micro-noise blotches!) ---
            float gMix = trGrassMix(p);
            vec3 gTex = mix(texture2D(uGrassA, trGrassUvA(p)).rgb, texture2D(uGrassA, trGrassUvB(p)).rgb, gMix);
            float mPatch1 = trFbm(p * 0.06);
            float mPatch2 = trFbm(p * 0.24 + vec2(9.1, 3.7));

            // Subtle natural macro lawn tone variation + Grass Lushness tuner
            vec3 grassCol = gTex * mix(0.86, 1.14, mPatch1);
            grassCol = mix(grassCol, grassCol * vec3(1.06, 1.01, 0.86), smoothstep(0.58, 0.88, mPatch2) * 0.26);
            float gLuma = dot(grassCol, vec3(0.2126, 0.7152, 0.0722));
            grassCol = mix(vec3(gLuma), grassCol * vec3(0.96, 1.05, 0.93), uGrassLushness);
            // Subtle morning-dew richness on damp grass patches + gentle animated wind-wave light shimmer
            grassCol *= mix(1.0, 0.88, wetness * 0.28);
            float windWave = sin(dot(p, uWindDir) * 0.42 - uTime * 1.10 + mPatch1 * 3.8);
            grassCol *= (1.0 + windWave * 0.035 * (1.0 - smoothstep(25.0, 140.0, camDist)));

            // Combine seamlessly via height-blended splat weight
            diffuseColor.rgb = mix(dirtCol, grassCol, grassWeight) * wallAO;
          }`
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
          {
            vec2 p = vTerrainLocalPos.xz;
            float camDist = length(cameraPosition - vTerrainWorldPos);
            float dMix = trDirtMix(p);
            vec3 dirtORM = mix(texture2D(uDirtORM, trDirtUvA(p)).rgb, texture2D(uDirtORM, trDirtUvB(p)).rgb, dMix);
            vec3 splatInfo = trComputeSplat(p, dirtORM.b);
            float grassWeight = splatInfo.x;
            vec3 wetInfo = trComputeWetness(p, dirtORM.b, splatInfo.y);
            float wetness = wetInfo.x;
            float puddle = wetInfo.y;
            float skyExposed = wetInfo.z;

            float detailFade = (1.0 - smoothstep(1.2, 6.5, camDist)) * uDetailEnabled;
            float dR = texture2D(uDirtDR, p / 0.20).r;
            float dryDirtRough = clamp(dirtORM.g + (dR - 0.75) * 0.20 * detailFade, 0.46, 0.98);
            // Raised stones stay satin-damp (0.34-0.48); roof-occluded bay avoids open-sky mirror reflection!
            float satinTarget = mix(0.46, 0.34, skyExposed) + (dR - 0.5) * 0.12;
            float wetDirtRough = mix(dryDirtRough, satinTarget, wetness);
            // Small broken micro-depressions hold thin water (0.14-0.18, never 0.05 chrome oil-slick)
            float dirtRough = mix(wetDirtRough, 0.15, puddle);

            float gMix = trGrassMix(p);
            float gR = mix(texture2D(uGrassR, trGrassUvA(p)).g, texture2D(uGrassR, trGrassUvB(p)).g, gMix);
            // Pure 2048px grass blade roughness + subtle morning dew sheen
            float grassRough = clamp(gR - wetness * 0.14, 0.44, 0.96);

            roughnessFactor = mix(dirtRough, grassRough, grassWeight);
          }`
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
          {
            vec2 p = vTerrainLocalPos.xz;
            float camDist = length(cameraPosition - vTerrainWorldPos);
            float dMix = trDirtMix(p);
            vec3 dirtORM = mix(texture2D(uDirtORM, trDirtUvA(p)).rgb, texture2D(uDirtORM, trDirtUvB(p)).rgb, dMix);
            vec3 splatInfo = trComputeSplat(p, dirtORM.b);
            float grassWeight = splatInfo.x;
            float puddle = trComputeWetness(p, dirtORM.b, splatInfo.y).y;

            // Dirt normal (2048px dual-tap + 0.20m micro-grit detail when Detail Shaders On; level water in puddles!)
            float dirtMacroFade = 1.0 - smoothstep(9.0, 34.0, camDist) * 0.75;
            float dirtDetailFade = (1.0 - smoothstep(1.2, 6.5, camDist)) * uDetailEnabled;
            vec3 dnA = texture2D(uDirtN, trDirtUvA(p)).xyz * 2.0 - 1.0;
            vec3 dnB = texture2D(uDirtN, trDirtUvB(p)).xyz * 2.0 - 1.0;
            dnB.xy = dnB.xy * TR_ROT;
            vec2 dnM = mix(dnA.xy, dnB.xy, dMix);
            vec2 dnD = texture2D(uDirtDN, p / 0.20).xy * 2.0 - 1.0;
            vec2 dirtXY = (dnM * 1.05 * dirtMacroFade + dnD * 0.36 * dirtDetailFade) * (1.0 - puddle * 0.68);

            // Grass normal: pure 2048x2048 real-blade normal map (zero procedural blotches!)
            float gMix = trGrassMix(p);
            float grassNormalFade = 1.0 - smoothstep(12.0, 48.0, camDist);
            vec3 gnA = texture2D(uGrassN, trGrassUvA(p)).xyz * 2.0 - 1.0;
            vec3 gnB = texture2D(uGrassN, trGrassUvB(p)).xyz * 2.0 - 1.0;
            gnB.xy = gnB.xy * TR_ROT;
            vec2 grassXY = mix(gnA.xy, gnB.xy, gMix) * 1.08 * grassNormalFade;

            vec2 finalXY = mix(dirtXY, grassXY, grassWeight);
            vec3 deltaW = vec3(finalXY.x, 0.0, finalXY.y);
            vec3 deltaV = (viewMatrix * vec4(deltaW, 0.0)).xyz;
            normal = normalize(normal + deltaV);
          }`
        )
        .replace(
          '#include <tonemapping_fragment>',
          `// Soft grazing-angle grass velvet sun sheen + seamless atmospheric horizon dissolve
          {
            vec2 p = vTerrainWorldPos.xz;
            float dist = length(cameraPosition.xz - p);
            vec3 V = normalize(cameraPosition - vTerrainWorldPos);
            float fresnel = pow(1.0 - max(V.y, 0.0), 3.0);
            float grassApprox = smoothstep(5.0, 9.5, length(p));
            gl_FragColor.rgb += uSunColor * fresnel * 0.045 * grassApprox * (1.0 - smoothstep(15.0, 120.0, dist));

            float horizonBlend = smoothstep(38.0, 190.0, dist);
            horizonBlend = pow(horizonBlend, 0.85);
            gl_FragColor.rgb = mix(gl_FragColor.rgb, uFogColor, clamp(horizonBlend, 0.0, 1.0));
          }
          #include <tonemapping_fragment>`
        );
    };
    mat.customProgramCacheKey = () => 'hangar-unified-terrain-splat-v1';
    mat.needsUpdate = true;

    const plane = new THREE.Mesh(geo, mat);
    plane.position.y = 0.0;
    plane.receiveShadow = true;
    plane.castShadow = false;
    plane.name = 'UnifiedAirfieldGround';
    this.root.add(plane);
  }

  _buildDenseLushTurf() {
    // Fast, lightweight thin wispy accent 3D tufts (~600 short 3-7 cm crossed 3-blade tufts, 1 draw call)
    // Clustered in small organic patches near footings, walls, barrel, chairs, leaned gate, and patchy apron spots.
    const positions = [];
    const uvs = [];
    const normals = [];
    const indices = [];

    const bladeAngles = [0, 1.57, 3.14, 4.71];
    const bladeOffsets = [[0.0, 0.0], [0.022, 0.015], [-0.019, 0.017], [0.008, -0.021]];
    const bladeHeights = [0.088, 0.072, 0.058, 0.048];
    const bladeW = 0.014;

    let vBase = 0;
    for (let b = 0; b < 4; b++) {
      const ang = bladeAngles[b];
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const ox = bladeOffsets[b][0], oz = bladeOffsets[b][1];
      const h = bladeHeights[b];
      const lean = 0.024;
      const pts = [
        [-bladeW * 0.5, 0.0, 0.0],
        [ bladeW * 0.5, 0.0, 0.0],
        [-bladeW * 0.30, h * 0.55, lean * 0.45],
        [ bladeW * 0.30, h * 0.55, lean * 0.45],
        [0.0, h, lean],
      ];
      const buvs = [[0, 0], [1, 0], [0, 0.55], [1, 0.55], [0.5, 1.0]];
      for (let i = 0; i < pts.length; i++) {
        positions.push(pts[i][0] * ca - pts[i][2] * sa + ox, pts[i][1], pts[i][0] * sa + pts[i][2] * ca + oz);
        uvs.push(buvs[i][0], buvs[i][1]);
        normals.push(-sa * 0.3, 0.94, ca * 0.3);
      }
      indices.push(vBase, vBase + 1, vBase + 2, vBase + 1, vBase + 3, vBase + 2, vBase + 2, vBase + 3, vBase + 4);
      vBase += 5;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setIndex(indices);

    const COUNT = 2600;
    const aTint = new Float32Array(COUNT);
    const aPhase = new Float32Array(COUNT);
    const matrices = new Float32Array(COUNT * 16);
    const dummy = new THREE.Object3D();

    let seed = 61231;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

    let placed = 0;
    const addTuft = (x, z, sXZ, sY) => {
      if (placed >= COUNT) return;
      dummy.position.set(x, -0.003, z);
      dummy.rotation.set((rnd() - 0.5) * 0.16, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.16);
      dummy.scale.set(sXZ, sY, sXZ);
      dummy.updateMatrix();
      dummy.matrix.toArray(matrices, placed * 16);
      aTint[placed] = rnd();
      aPhase[placed] = rnd() * 6.283;
      placed++;
    };

    // Organic patchy drifts of lush thin Nordic grass/clover across foreground, apron edges, footings, & walls
    const patchCenters = [
      // Front-left chairs, barrel & footing
      [-6.55, 3.85, 0.95], [-6.85, 2.85, 0.90], [-5.45, 3.70, 0.95], [-4.35, 3.85, 0.90], [-3.20, 4.15, 1.05],
      // Front-right corner, leaned gate & footing
      [6.45, 3.85, 1.00], [5.35, 3.75, 0.95], [4.10, 4.05, 1.05], [6.80, 1.40, 1.15], [6.75, -1.80, 1.15],
      // Side & rear wall footings
      [-6.75, 0.65, 1.10], [-6.75, -2.45, 1.10], [-6.60, -5.60, 1.15], [6.60, -5.55, 1.15],
      [-2.80, -6.05, 1.25], [2.40, -6.10, 1.25],
      // Foreground & sunny airfield meadow drifts (keeping worn gravel center apron patchy & natural)
      [-4.90, 2.55, 0.85], [4.65, 2.65, 0.85], [-2.30, 5.15, 1.25], [2.55, 5.25, 1.25],
      [-5.90, 5.90, 1.55], [5.70, 6.05, 1.55], [0.25, 6.75, 1.35], [-3.80, 7.60, 1.85],
      [3.90, 7.80, 1.85], [-8.20, 4.90, 1.75], [8.30, 5.10, 1.75],
      [-7.20, 8.80, 2.20], [-1.20, 9.40, 2.10], [4.80, 9.80, 2.20], [9.40, 8.60, 2.10],
      [-10.2, 7.20, 2.20], [-4.60, 11.4, 2.40], [1.80, 11.8, 2.40], [7.60, 11.5, 2.30],
    ];

    for (const [cx, cz, rad] of patchCenters) {
      const n = 58 + Math.floor(rnd() * 32);
      for (let i = 0; i < n; i++) {
        const ang = rnd() * Math.PI * 2;
        const r = Math.pow(rnd(), 0.62) * rad;
        const x = cx + Math.cos(ang) * r;
        const z = cz + Math.sin(ang) * r;
        // Keep deep interior center bay clear
        if (Math.abs(x) < 5.6 && z < 2.2) continue;
        addTuft(x, z, 0.78 + rnd() * 0.72, 0.65 + rnd() * 0.75);
      }
    }

    geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(aTint.subarray(0, placed), 1));
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(aPhase.subarray(0, placed), 1));

    const mat = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      uniforms: {
        uTime: this.sharedUniforms.uTime,
        uSunDir: this.sharedUniforms.uSunDir,
        uSunColor: this.sharedUniforms.uSunColor,
        uFogColor: this.sharedUniforms.uFogColor,
        uWindDir: this.sharedUniforms.uWindDir,
        uGrassLushness: this.sharedUniforms.uGrassLushness,
      },
      vertexShader: `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        attribute float aTint;
        attribute float aPhase;
        uniform float uTime;
        uniform vec2 uWindDir;
        varying float vH;
        varying float vTint;
        varying vec3 vWorldPos;
        void main() {
          vH = uv.y;
          vTint = aTint;
          vec4 instW = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          float gust = sin(dot(instW.xz, uWindDir) * 0.35 - uTime * 1.45 + aPhase) * 0.5 + 0.3;
          float bend = gust * 0.025 * (vH * vH);
          vec4 lp = instanceMatrix * vec4(position, 1.0);
          lp.x += uWindDir.x * bend;
          lp.z += uWindDir.y * bend;
          vec4 wp = modelMatrix * lp;
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
          #include <logdepthbuf_vertex>
        }
      `,
      fragmentShader: `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        uniform vec3 uFogColor;
        uniform float uGrassLushness;
        varying float vH;
        varying float vTint;
        varying vec3 vWorldPos;
        void main() {
          // Lush Nordic spring-summer grass palette with sunlit yellow-green tips & morning-dew sheen
          vec3 rootCol = vec3(0.055, 0.11, 0.032);
          vec3 greenTip = vec3(0.18, 0.34, 0.085);
          vec3 warmTip = vec3(0.32, 0.40, 0.11);
          vec3 strawTip = vec3(0.38, 0.34, 0.16);
          vec3 tipCol = mix(greenTip, warmTip, smoothstep(0.25, 0.72, vTint) * 0.60);
          tipCol = mix(tipCol, strawTip, smoothstep(0.76, 0.96, vTint) * 0.55);
          vec3 col = mix(rootCol, tipCol, pow(vH, 0.72)) * mix(0.48, 1.05, vH);
          float tLuma = dot(col, vec3(0.2126, 0.7152, 0.0722));
          col = mix(vec3(tLuma), col * vec3(0.96, 1.06, 0.92), uGrassLushness);

          vec3 sDir = normalize(uSunDir);
          vec3 vDir = normalize(cameraPosition - vWorldPos);
          float sss = pow(max(dot(-vDir, sDir), 0.0), 3.0) * vH * 0.32;
          float sunY = max(sDir.y, 0.1);
          vec3 lit = col * (vec3(0.28, 0.36, 0.42) + uSunColor * (0.55 + 0.85 * sunY)) + uSunColor * tipCol * sss;
          float dist = length(cameraPosition.xz - vWorldPos.xz);
          float fogBlend = smoothstep(42.0, 260.0, dist);
          gl_FragColor = vec4(mix(lit, uFogColor, clamp(pow(fogBlend, 0.78), 0.0, 1.0)), 1.0);
          #include <logdepthbuf_fragment>
        }
      `,
    });

    const mesh = new THREE.InstancedMesh(geo, mat, placed);
    mesh.instanceMatrix.array.set(matrices.subarray(0, placed * 16));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.name = 'AccentAirfieldTufts';
    this.root.add(mesh);
  }

  _buildTreelineHorizon() {
    // Full, continuous distant Swedish pine/birch forest canopy silhouette at R = 132 m
    // Eliminates sparse triangles and melts naturally into the atmospheric horizon mist.
    const segs = 240;
    const radius = 132;
    const positions = [];
    const uvs = [];
    const indices = [];

    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const ang = t * Math.PI * 2;
      const x = Math.cos(ang) * radius;
      const z = Math.sin(ang) * radius;
      // Continuous Swedish countryside treeline (slightly lower across front airfield approach, fuller behind)
      const approachDip = Math.exp(-Math.pow(Math.sin(ang - 1.35), 2) * 5.0) * 0.32;
      const h = (12.5 - approachDip * 4.0) + Math.sin(ang * 7.0) * 1.2 + Math.cos(ang * 17.0) * 0.7;

      positions.push(x, -2.5, z);
      positions.push(x, h, z);
      uvs.push(t * 140.0, 0.0);
      uvs.push(t * 140.0, 1.0);

      if (i < segs) {
        const b = i * 2;
        indices.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uSunDir: this.sharedUniforms.uSunDir,
        uSunColor: this.sharedUniforms.uSunColor,
        uFogColor: this.sharedUniforms.uFogColor,
      },
      vertexShader: `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        varying vec2 vUv;
        varying vec3 vWorldPos;
        void main() {
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
          #include <logdepthbuf_vertex>
        }
      `,
      fragmentShader: `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        uniform vec3 uFogColor;
        varying vec2 vUv;
        varying vec3 vWorldPos;

        float tHash(float n) { return fract(sin(n) * 43758.5453123); }
        float tNoise(float x) {
          float i = floor(x), f = fract(x);
          f = f * f * (3.0 - 2.0 * f);
          return mix(tHash(i), tHash(i + 1.0), f);
        }

        // Organic varied Swedish birch & pine forest canopy clusters (no uniform sawtooth triangles!)
        float canopyHeight(float x) {
          float ridge = 0.38 + 0.22 * tNoise(x * 0.16);
          float clusters = 0.20 * tNoise(x * 0.52 + 3.7) + 0.14 * tNoise(x * 1.15 + 9.2);
          float crowns = 0.09 * tNoise(x * 2.6 + 17.1) + 0.05 * tNoise(x * 5.8 + 4.3);
          return clamp(ridge + clusters + crowns, 0.26, 0.94);
        }

        void main() {
          float h = canopyHeight(vUv.x);
          float alpha = smoothstep(h + 0.045, h - 0.035, vUv.y);
          if (alpha < 0.02) discard;

          vec3 dir = normalize(vWorldPos);
          float sunSide = 0.5 + 0.5 * dot(dir.xz, normalize(uSunDir.xz));
          vec3 deepPine = vec3(0.035, 0.065, 0.04);
          vec3 litCrown = vec3(0.08, 0.13, 0.068) + uSunColor * 0.04 * sunSide;
          vec3 treeCol = mix(deepPine, litCrown, smoothstep(0.18, 0.88, vUv.y));

          // Soft atmospheric mist blending seamlessly into exact uFogColor (identical to ground & sky horizon)
          float mistBase = 1.0 - smoothstep(0.08, 0.42, vUv.y);
          vec3 finalCol = mix(treeCol, uFogColor, clamp(0.64 + mistBase * 0.36, 0.0, 1.0));
          gl_FragColor = vec4(finalCol, alpha * 0.94);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <logdepthbuf_fragment>
        }
      `,
    });

    const ring = new THREE.Mesh(geo, mat);
    ring.name = 'NordicTreelineRing';
    ring.renderOrder = 1;
    this.root.add(ring);
  }

  _buildWindsock() {
    const group = new THREE.Group();
    group.name = 'AirfieldWindsock';
    group.position.set(-14.5, 0.0, -7.5);

    const poleMat = new THREE.MeshStandardMaterial({ color: 0xc2c7cc, roughness: 0.45, metalness: 0.72 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.055, 6.2, 10), poleMat);
    pole.position.y = 3.1;
    pole.castShadow = true;
    group.add(pole);

    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.26, 0.25, 12),
      new THREE.MeshStandardMaterial({ color: 0x9c9a92, roughness: 0.9 })
    );
    base.position.y = 0.12;
    group.add(base);

    const sockLen = 2.45;
    const sockGeo = new THREE.CylinderGeometry(0.15, 0.34, sockLen, 16, 18, true);
    sockGeo.rotateZ(-Math.PI / 2);
    sockGeo.translate(sockLen * 0.5 + 0.12, 0, 0);

    const sockMat = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      uniforms: {
        uTime: this.sharedUniforms.uTime,
        uSunDir: this.sharedUniforms.uSunDir,
        uSunColor: this.sharedUniforms.uSunColor,
        uFogColor: this.sharedUniforms.uFogColor,
      },
      vertexShader: `
        #include <common>
        uniform float uTime;
        varying vec2 vUv;
        varying vec3 vWorldPos;
        varying vec3 vWorldNormal;
        #include <logdepthbuf_pars_vertex>
        void main() {
          vUv = uv;
          vec3 p = position;
          float t = clamp((p.x - 0.12) / 2.45, 0.0, 1.0);
          float gust = 0.72 + 0.28 * sin(uTime * 1.15);
          p.y -= (1.0 - gust * 0.65) * t * t * 0.52;
          p.y += sin(t * 7.5 - uTime * 6.8) * 0.065 * t;
          p.z += cos(t * 6.2 - uTime * 5.4) * 0.095 * t;

          vec4 wp = modelMatrix * vec4(p, 1.0);
          vWorldPos = wp.xyz;
          vWorldNormal = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * wp;
          #include <logdepthbuf_vertex>
        }
      `,
      fragmentShader: `
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        uniform vec3 uFogColor;
        varying vec2 vUv;
        varying vec3 vWorldPos;
        varying vec3 vWorldNormal;
        #include <logdepthbuf_pars_fragment>
        void main() {
          float stripe = step(0.5, fract(vUv.y * 2.5));
          vec3 col = mix(vec3(0.86, 0.24, 0.05), vec3(0.92, 0.92, 0.90), stripe);
          vec3 N = normalize(vWorldNormal);
          float ndl = max(dot(N, normalize(uSunDir)) * 0.55 + 0.45, 0.22);
          vec3 lit = col * (vec3(0.32, 0.35, 0.38) + uSunColor * ndl * 0.85);
          float dist = length(cameraPosition.xz - vWorldPos.xz);
          float fogBlend = smoothstep(42.0, 260.0, dist);
          gl_FragColor = vec4(mix(lit, uFogColor, clamp(pow(fogBlend, 0.78), 0.0, 1.0)), 1.0);
          #include <logdepthbuf_fragment>
        }
      `,
    });

    const sock = new THREE.Mesh(sockGeo, sockMat);
    sock.position.y = 6.05;
    sock.rotation.y = -Math.atan2(this.windDir.y, this.windDir.x);
    group.add(sock);
    this.root.add(group);
  }

  _buildContactAOAndDecals() {
    const aoGroup = new THREE.Group();
    aoGroup.name = 'GroundedContactAO';

    const makeRadialTex = (innerAlpha = 0.48) => {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const ctx = c.getContext('2d');
      const g = ctx.createRadialGradient(64, 64, 6, 64, 64, 62);
      g.addColorStop(0.0, `rgba(14, 16, 14, ${innerAlpha})`);
      g.addColorStop(0.55, `rgba(14, 16, 14, ${innerAlpha * 0.42})`);
      g.addColorStop(1.0, 'rgba(14, 16, 14, 0.0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };

    const radialAO = new THREE.MeshBasicMaterial({
      map: makeRadialTex(0.46),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });

    const addSpot = (x, y, z, rx, rz, opacity = 1.0) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(rx, rz),
        opacity < 1.0 ? Object.assign(radialAO.clone(), { opacity }) : radialAO
      );
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, y, z);
      m.renderOrder = 2;
      aoGroup.add(m);
      return m;
    };

    for (const sx of [-6.18, 6.18]) {
      for (const sz of [3.95, 0.78, -2.38, -5.50]) {
        addSpot(sx, 0.005, sz, 1.25, 1.25, 0.78);
      }
    }
    addSpot(-6.75, 0.005, 3.25, 1.35, 1.35, 0.84);
    addSpot(-6.75, 0.005, 3.95, 1.25, 1.25, 0.78);
    addSpot(-4.95, 0.005, 3.55, 1.1, 1.1, 0.58);
    addSpot(-4.25, 0.005, 3.55, 1.1, 1.1, 0.58);
    this.gliderAO = addSpot(0.0, 0.006, 0.05, 5.2, 2.8, 0.50);

    this.root.add(aoGroup);
  }

  setGliderAOVisible(visible) {
    if (this.gliderAO) this.gliderAO.visible = visible;
  }

  syncSun(sunDir, preset) {
    this.sharedUniforms.uSunDir.value.copy(sunDir);
    this.sharedUniforms.uSunColor.value.setHex(preset.sunColor);
    this.sharedUniforms.uFogColor.value.setHex(preset.fogColor);
    this.sharedUniforms.uFogDensity.value = preset.fogDensity;
  }

  update(seconds) {
    this.sharedUniforms.uTime.value = seconds;
  }
}
