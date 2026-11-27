import * as THREE from 'three';

/**
 * Subtle, Natural Swedish Summer Airfield Wildlife & Ambience System:
 * 1. ~95 fine pinpoint sunlit dust motes with smooth show-and-fade lifecycles.
 * 2. ~12 tiny delicate dandelion spores (maskrosfron) drifting gently on the breeze.
 * 3. Max 2 Nordic butterflies with a realistic Approach -> Settle/Rest -> Fly-Off -> Away/Return state machine.
 * 4. 3 occasional high-arcing barn swallows (ladusvala) sweeping wide across the airfield sky.
 * 5. Curled-up sleeping white hangar cat resting on the front-left folding chair (gentle breathing + rare ear/tail twitch).
 * 6. Swedish roe deer doe & spotted fawn peacefully grazing on the distant sunny meadow.
 */
export class WildlifeSystem {
  constructor(scene, loader) {
    this.scene = scene;
    this.loader = loader;
    this.root = new THREE.Group();
    this.root.name = 'AirfieldWildlife';
    scene.add(this.root);

    this.windDir = new THREE.Vector2(0.82, 0.57).normalize();
    this.uniforms = {
      uTime: { value: 0 },
      uSunColor: { value: new THREE.Color(0xfff5e4) },
      uSunGain: { value: 1.0 },
      uDustOpacity: { value: 1.0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
    };

    this.butterflies = [];
    this.swallows = [];
    this.swallowNests = [];
    this._raycaster = new THREE.Raycaster();
    this._perchTargets = { gliderRoot: null, hangarRoot: null };

    // Sleeping white cat curled up snugly on the right/inner front-left folding chair slats (Chair 2)
    this.catGroup = new THREE.Group();
    this.catGroup.name = 'HangarCatAnchor';
    this.catGroup.position.set(-4.28, 0.383, 3.55);
    this.catGroup.rotation.y = -0.105;
    this.root.add(this.catGroup);

    this.catNodes = { body: null, head: null, earL: null, earR: null, tail: null };
    this.catBaseRot = { head: null, earL: null, earR: null, tail: null };

    // Roe deer doe + spotted fawn peacefully grazing ~21 m out on the sunny airfield meadow
    this.deerGroup = new THREE.Group();
    this.deerGroup.name = 'AirfieldDeerAnchor';
    this.deerGroup.position.set(8.5, 0.0, 19.5);
    this.deerGroup.rotation.y = THREE.MathUtils.degToRad(-125);
    this.root.add(this.deerGroup);

    this.deerNodes = { doeNeck: null, doeEarL: null, doeEarR: null, doeTail: null, fawnNeck: null, fawnTail: null };
    this.deerBaseRot = {};

    this._lastSec = 0;

    this._buildSunlitDust();
    this._buildDandelionSpores();
    this._buildButterflies();
    this._buildSwallowNests();
    this._buildSwallows();
  }

  _buildSunlitDust() {
    // 350 fine ambient dust motes evenly across the whole hangar volume (900 total with volumetric shaft motes)
    const count = 350;
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count * 3);
    let s = 9001;
    const rnd = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };

    for (let i = 0; i < count; i++) {
      // Spread evenly across the entire 3D hangar interior volume (rear, around/above glider, sides, front)
      const x = (rnd() * 2 - 1) * 5.6;
      const maxY = Math.min(3.55, 3.65 - Math.abs(x) * Math.tan(THREE.MathUtils.degToRad(12.66)));
      positions[i * 3 + 0] = x;
      positions[i * 3 + 1] = 0.25 + rnd() * (maxY - 0.25);
      positions[i * 3 + 2] = -5.2 + rnd() * 9.4;
      seeds[i * 3 + 0] = rnd() * 6.283;
      seeds[i * 3 + 1] = 0.45 + rnd() * 0.85;
      seeds[i * 3 + 2] = rnd();
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
        uSunColor: this.uniforms.uSunColor,
        uSunGain: this.uniforms.uSunGain,
        uDustOpacity: this.uniforms.uDustOpacity,
        uPixelRatio: this.uniforms.uPixelRatio,
      },
      vertexShader: `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        attribute vec3 aSeed;
        uniform float uTime;
        uniform float uPixelRatio;
        varying float vGlow;
        void main() {
          vec3 p = position;
          // Short staggered random lifespan (~3.0-5.5s visible, ~2.5-4.5s quiet off-interval -> ~55% duty cycle)
          float cycleDur = 5.6 + aSeed.y * 4.4;
          float rawCycle = (uTime + aSeed.x * 2.3) / cycleDur;
          float cycleIdx = floor(rawCycle);
          float phase = fract(rawCycle);
          float visFrac = 0.55;
          float showFade = smoothstep(0.0, visFrac * 0.24, phase) * (1.0 - smoothstep(visFrac * 0.72, visFrac, phase));

          // Fresh pseudo-random spawn jitter each cycle + gentle dreamy summer drift & curl
          p += vec3(
            sin(cycleIdx * 17.31 + aSeed.x * 6.3) * 0.50,
            cos(cycleIdx * 54.17 + aSeed.z * 4.9) * 0.28,
            sin(cycleIdx * 29.83 + aSeed.y * 8.5) * 0.50
          );
          float t = uTime * 0.125 * aSeed.y + aSeed.x;
          p.x += sin(t * 0.85 + p.z * 0.45) * 0.34;
          p.y += cos(t * 0.60 + p.x * 0.5) * 0.18;
          p.z += sin(t * 0.48 + p.y * 0.65) * 0.28;

          float frontZone = smoothstep(-2.2, 3.2, p.z);
          float sideShaft = exp(-pow(p.z + 1.95, 2.0) * 0.65) * smoothstep(1.6, 5.4, abs(p.x));
          float sunZone = max(frontZone, sideShaft);
          float sparkle = 0.78 + 0.22 * sin(t * 2.4 + aSeed.z * 5.0);
          vGlow = mix(0.58, 0.92, sunZone) * showFade * sparkle;

          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          #include <logdepthbuf_vertex>
          float depthScale = clamp(5.5 / max(-mv.z, 1.5), 0.72, 1.30);
          gl_PointSize = clamp((3.2 + aSeed.z * 2.8) * uPixelRatio * depthScale, 3.0 * uPixelRatio, 8.0 * uPixelRatio);
        }
      `,
      fragmentShader: `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        uniform vec3 uSunColor;
        uniform float uSunGain;
        uniform float uDustOpacity;
        varying float vGlow;
        void main() {
          if (vGlow < 0.01) discard;
          float r = length(gl_PointCoord - vec2(0.5));
          float disc = smoothstep(0.5, 0.12, r);
          float a = disc * vGlow * clamp(uSunGain, 0.85, 1.25) * uDustOpacity;
          if (a < 0.01) discard;
          // AdditiveBlending multiplies rgb by a; do NOT pre-multiply rgb by a!
          vec3 col = mix(uSunColor, vec3(1.0, 0.97, 0.90), 0.35) * 1.40;
          gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
          #include <logdepthbuf_fragment>
        }
      `,
    });

    const pts = new THREE.Points(geo, mat);
    pts.name = 'FloatingSunlitDust';
    pts.frustumCulled = false;
    pts.renderOrder = 8;
    this.root.add(pts);
  }

  _buildDandelionSpores() {
    // 7 delicate occasional maskrosfron drifting very slowly on a calm summer breeze
    const count = 7;
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count * 3);
    let s = 44219;
    const rnd = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };

    for (let i = 0; i < count; i++) {
      positions[i * 3 + 0] = (rnd() * 2 - 1) * 9.0;
      positions[i * 3 + 1] = 0.65 + rnd() * 2.1;
      positions[i * 3 + 2] = 1.8 + rnd() * 9.5;
      seeds[i * 3 + 0] = rnd() * 6.283;
      seeds[i * 3 + 1] = 0.45 + rnd() * 0.55;
      seeds[i * 3 + 2] = 0.72 + rnd() * 0.40;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: this.uniforms.uTime,
        uSunColor: this.uniforms.uSunColor,
        uPixelRatio: this.uniforms.uPixelRatio,
        uWindDir: { value: this.windDir },
      },
      vertexShader: `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        attribute vec3 aSeed;
        uniform float uTime;
        uniform float uPixelRatio;
        uniform vec2 uWindDir;
        varying float vAlpha;
        varying float vRot;
        void main() {
          vec3 p = position;
          // 3.5x slower gentle drift
          float speed = 0.095 * aSeed.y;
          vec2 drifted = p.xz + uWindDir * (uTime * speed);
          p.x = mod(drifted.x + 9.5, 19.0) - 9.5;
          p.z = mod(drifted.y - 1.5, 10.5) + 1.5;
          p.y += sin(uTime * 0.18 * aSeed.y + aSeed.x) * 0.24 + cos(uTime * 0.35 + aSeed.x) * 0.05;

          vRot = uTime * 0.10 * aSeed.y + aSeed.x;
          float life = fract(uTime * 0.016 * aSeed.y + aSeed.x * 0.15915);
          float showFade = smoothstep(0.06, 0.26, life) * smoothstep(0.92, 0.68, life);
          float edgeFade = smoothstep(9.5, 7.2, abs(p.x)) * smoothstep(1.5, 3.0, p.z) * smoothstep(12.0, 9.8, p.z);
          vAlpha = 0.78 * edgeFade * showFade;

          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          #include <logdepthbuf_vertex>
          gl_PointSize = clamp((40.0 * aSeed.z * uPixelRatio) / max(-mv.z, 1.2), 3.2 * uPixelRatio, 8.0 * uPixelRatio);
        }
      `,
      fragmentShader: `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        uniform vec3 uSunColor;
        varying float vAlpha;
        varying float vRot;
        void main() {
          if (vAlpha < 0.01) discard;
          vec2 uv = gl_PointCoord - vec2(0.5);
          float c = cos(vRot), s = sin(vRot);
          uv = mat2(c, -s, s, c) * uv;

          vec2 crownUv = uv - vec2(0.0, -0.08);
          float r = length(crownUv);
          float ang = atan(crownUv.y, crownUv.x);
          float spokes = 0.55 + 0.45 * pow(abs(cos(ang * 5.0)), 2.5);
          float puff = smoothstep(0.36, 0.04, r) * spokes;
          float stem = smoothstep(0.032, 0.008, abs(uv.x)) * smoothstep(0.30, 0.0, uv.y) * step(-0.06, uv.y);

          float mask = clamp(puff + stem * 0.6, 0.0, 1.0);
          float a = mask * vAlpha;
          if (a < 0.02) discard;
          vec3 col = mix(vec3(0.95, 0.96, 0.92), uSunColor * 1.08, 0.28);
          gl_FragColor = vec4(col, a);
          #include <logdepthbuf_fragment>
        }
      `,
    });

    const pts = new THREE.Points(geo, mat);
    pts.name = 'DandelionSpores';
    pts.frustumCulled = false;
    pts.renderOrder = 9;
    this.root.add(pts);
  }

  setPerchTargets({ gliderRoot = null, hangarRoot = null } = {}) {
    this._perchTargets.gliderRoot = gliderRoot;
    this._perchTargets.hangarRoot = hangarRoot;
    // Re-snap any butterfly currently approaching or resting so it lands on real geometry immediately
    for (const b of this.butterflies) {
      if (b.mode === 'APPROACH' || b.mode === 'REST') {
        const res = this._resolvePerch(b, b.perchIdx);
        b.toPos.copy(res.pos);
        b.onGlider = res.onGlider;
        if (b.mode === 'REST') b.group.position.copy(res.pos);
      }
    }
  }

  startleGliderButterflies() {
    for (const b of this.butterflies) {
      if (b.onGlider && (b.mode === 'REST' || b.mode === 'APPROACH')) {
        b.mode = 'DEPART';
        b.t = 0;
        b.dur = 3.2 + this._nextRnd(b) * 1.8;
        b.onGlider = false;
        b.fromPos.copy(b.group.position);
        const angle = (this._nextRnd(b) - 0.5) * 1.8;
        b.toPos.set(Math.sin(angle) * 9.5, 1.5 + this._nextRnd(b) * 1.4, 9.5 + this._nextRnd(b) * 3.5);
      }
    }
  }

  _raycastDown(root, x, z, maxY = 4.2) {
    if (!root || !root.visible) return null;
    root.updateMatrixWorld(true);
    this._raycaster.set(new THREE.Vector3(x, maxY, z), new THREE.Vector3(0, -1, 0));
    this._raycaster.near = 0.01;
    this._raycaster.far = maxY + 0.5;
    const hits = this._raycaster.intersectObject(root, true);
    for (const h of hits) {
      if (!h.object.visible || !h.face) continue;
      const n = h.face.normal.clone().transformDirection(h.object.matrixWorld).normalize();
      if (n.y < 0.25) continue; // only land on top/upward-facing surfaces
      return {
        point: h.point.clone().addScaledVector(n, 0.005),
        normal: n,
      };
    }
    return null;
  }

  _resolvePerch(b, idx) {
    const spec = this.perchSpecs[idx % this.perchSpecs.length];
    if (spec.kind === 'glider' && this._perchTargets.gliderRoot?.visible) {
      // Try exact candidate XZ plus small jitter offsets to reliably hit basebar/wing in current world pose
      const offsets = [[0, 0], [0.06, 0], [-0.06, 0], [0, 0.06], [0, -0.06]];
      for (const [ox, oz] of offsets) {
        const hit = this._raycastDown(this._perchTargets.gliderRoot, spec.x + ox, spec.z + oz, 4.2);
        if (hit) return { pos: hit.point, onGlider: true, surface: 'glider' };
      }
    } else if (spec.kind === 'prop' && this._perchTargets.hangarRoot) {
      const hit = this._raycastDown(this._perchTargets.hangarRoot, spec.x, spec.z, 2.5);
      if (hit && hit.point.y > 0.05) {
        return { pos: hit.point, onGlider: false, surface: 'prop' };
      }
    }
    // Guaranteed flush floor perch at Y = 0.006 m (never floating in mid-air!)
    const fx = spec.floorX ?? spec.x;
    const fz = spec.floorZ ?? spec.z;
    return { pos: new THREE.Vector3(fx, 0.006, fz), onGlider: false, surface: 'floor' };
  }

  _buildButterflies() {
    // Strictly 2 Nordic butterflies max with natural Settle -> Rest -> Fly-Off -> Away -> Return state machine.
    // Every perch is either snapped strictly to Y=0.006m on the floor OR raycasted onto real glider/prop geometry!
    this.perchSpecs = [
      { kind: 'glider', x:  0.42, z:  0.38, floorX:  0.85, floorZ: 1.65 }, // glider basebar / wing above
      { kind: 'glider', x: -1.45, z:  0.15, floorX: -1.65, floorZ: 2.35 }, // glider left wing leading edge/sail
      { kind: 'glider', x:  1.85, z: -0.10, floorX:  2.05, floorZ: 2.85 }, // glider right wing sail
      { kind: 'floor',  x: -1.85, z:  4.35 },                              // sunny front-left gravel/grass floor
      { kind: 'floor',  x:  2.45, z:  4.40 },                              // sunny front-right floor
      { kind: 'floor',  x: -0.35, z:  2.55 },                              // sunlit front-bay gravel floor
      { kind: 'prop',   x: -4.95, z:  3.55, floorX: -3.45, floorZ: 3.95 }, // front-left folding chair (raycasted)
    ];

    const species = [
      {
        col: 0xf2dc4b, accent: 0xd1b322, seed: 101,
        initState: 'APPROACH', initPerch: 0, initTimer: 0.4,
      },
      {
        col: 0xd66424, accent: 0x2a180e, seed: 207,
        initState: 'AWAY', initPerch: 3, initTimer: 6.5, // starts away, flies in naturally after a few seconds
      },
    ];

    const wingShape = new THREE.Shape();
    wingShape.moveTo(0, 0);
    wingShape.quadraticCurveTo(0.030, 0.034, 0.042, 0.015);
    wingShape.quadraticCurveTo(0.040, -0.002, 0.020, -0.008);
    wingShape.quadraticCurveTo(0.030, -0.022, 0.013, -0.030);
    wingShape.quadraticCurveTo(0.002, -0.024, 0, -0.005);
    const wingGeo = new THREE.ShapeGeometry(wingShape, 6);
    wingGeo.rotateX(-Math.PI / 2);

    const bodyGeo = new THREE.CapsuleGeometry(0.0032, 0.020, 4, 6);
    bodyGeo.rotateX(Math.PI / 2);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x24201c, roughness: 0.8 });

    for (const sp of species) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(bodyGeo, bodyMat));

      const wingMat = new THREE.MeshStandardMaterial({
        color: sp.col,
        emissive: sp.accent,
        emissiveIntensity: 0.12,
        roughness: 0.55,
        side: THREE.DoubleSide,
      });
      const wingR = new THREE.Mesh(wingGeo, wingMat);
      const wingL = new THREE.Mesh(wingGeo, wingMat);
      wingL.scale.x = -1;
      g.add(wingR, wingL);
      g.scale.setScalar(1.22);

      this.root.add(g);
      const startFar = new THREE.Vector3(-5.5 + sp.seed * 0.02, 1.35, 9.5);
      const resolved = this._resolvePerch({ rngState: sp.seed }, sp.initPerch);
      g.position.copy(sp.initState === 'AWAY' ? startFar : startFar.clone().lerp(resolved.pos, 0.55));

      this.butterflies.push({
        group: g,
        wingL,
        wingR,
        rngState: sp.seed,
        mode: sp.initState, // 'APPROACH' | 'REST' | 'DEPART' | 'AWAY'
        t: 0,
        dur: sp.initState === 'AWAY' ? sp.initTimer : 4.2,
        fromPos: startFar.clone(),
        toPos: resolved.pos.clone(),
        perchIdx: sp.initPerch,
        onGlider: resolved.onGlider,
        phase: sp.seed * 0.13,
      });
    }
  }

  _nextRnd(b) {
    b.rngState = (b.rngState * 16807) % 2147483647;
    return (b.rngState - 1) / 2147483646;
  }

  _buildSwallowNests() {
    // Two organic half-cup Barn Swallow mud-and-straw nests (ladusvalebo)
    // tucked high in the rear-left and rear-right interior wall/rafter corners
    const nestGroup = new THREE.Group();
    nestGroup.name = 'SwallowMudNests';
    this.root.add(nestGroup);

    const mudMat = new THREE.MeshStandardMaterial({
      color: 0x6b5642,
      roughness: 0.96,
      metalness: 0.0,
    });
    const innerMat = new THREE.MeshStandardMaterial({
      color: 0x3b2d21,
      roughness: 0.98,
      metalness: 0.0,
    });
    const strawMat = new THREE.MeshStandardMaterial({
      color: 0xb69c62,
      roughness: 0.9,
      metalness: 0.0,
    });

    const placements = [
      { id: 'rear_left',  pos: new THREE.Vector3(-5.70, 2.46, -5.34), yaw:  0.55, perch: new THREE.Vector3(-5.61, 2.54, -5.23) },
      { id: 'rear_right', pos: new THREE.Vector3( 5.70, 2.46, -5.34), yaw: -0.55, perch: new THREE.Vector3( 5.61, 2.54, -5.23) },
    ];

    for (let nIdx = 0; nIdx < placements.length; nIdx++) {
      const pl = placements[nIdx];
      const g = new THREE.Group();
      g.name = `SwallowNest_${pl.id}`;
      g.position.copy(pl.pos);
      g.rotation.y = pl.yaw;

      // Sculpted organic half-cup mud bowl (bumpy hand-built mud pellets)
      const bowlGeo = new THREE.SphereGeometry(0.115, 16, 12, 0, Math.PI * 2, Math.PI * 0.46, Math.PI * 0.54);
      const posAttr = bowlGeo.attributes.position;
      for (let i = 0; i < posAttr.count; i++) {
        let x = posAttr.getX(i);
        let y = posAttr.getY(i);
        let z = posAttr.getZ(i);
        // Flatten back face so nest hugs rear corner wall/beam cleanly
        if (z < -0.025) z = -0.025 + (z + 0.025) * 0.25;
        // Organic mud-pellet lumps
        const bump = 1.0 + 0.11 * Math.sin(x * 46.0 + nIdx * 2.1) * Math.cos(y * 52.0 + z * 38.0);
        posAttr.setXYZ(i, x * 1.12 * bump, y * 0.96 * bump, z * 1.05 * bump);
      }
      bowlGeo.computeVertexNormals();
      const bowl = new THREE.Mesh(bowlGeo, mudMat);
      bowl.castShadow = true;
      bowl.receiveShadow = true;
      g.add(bowl);

      // Hollow dark cup interior
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.088, 0.068, 0.024, 14), innerMat);
      cup.position.set(0, -0.005, 0.015);
      g.add(cup);

      // Ring of small mud-pellet nodules & wispy golden straw stems around rim
      let s = 3100 + nIdx * 733;
      const rnd = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
      const pelletGeo = new THREE.DodecahedronGeometry(0.017, 0);
      for (let i = 0; i < 11; i++) {
        const a = -0.35 + (i / 10) * (Math.PI + 0.7);
        const pMesh = new THREE.Mesh(pelletGeo, mudMat);
        pMesh.position.set(Math.cos(a) * 0.108, -0.012 - rnd() * 0.045, Math.sin(a) * 0.092 + 0.01);
        pMesh.scale.set(0.8 + rnd() * 0.6, 0.6 + rnd() * 0.5, 0.8 + rnd() * 0.5);
        g.add(pMesh);
      }
      const strawGeo = new THREE.CylinderGeometry(0.0022, 0.0014, 0.085, 4);
      for (let i = 0; i < 9; i++) {
        const a = -0.1 + rnd() * (Math.PI + 0.2);
        const st = new THREE.Mesh(strawGeo, strawMat);
        st.position.set(Math.cos(a) * 0.085, 0.008 + rnd() * 0.018, Math.sin(a) * 0.075 + 0.012);
        st.rotation.set(0.7 + rnd() * 0.9, a + (rnd() - 0.5) * 0.8, (rnd() - 0.5) * 1.1);
        g.add(st);
      }

      nestGroup.add(g);
      this.swallowNests.push({
        id: pl.id,
        group: g,
        pos: pl.pos.clone(),
        perch: pl.perch.clone(),
        yaw: pl.yaw,
        sideSign: pl.pos.x < 0 ? -1 : 1,
      });
    }
  }

  _buildSwallows() {
    // 3 barn swallows (ladusvala) with staggered CRUISE -> ENTER_HANGAR -> PERCH_AT_NEST -> EXIT_HANGAR cycles
    const configs = [
      { cx: 0,  cz: 15, rx: 22, rz: 12, y: 7.8, speed: 0.30, phase: 0.4, nestIdx: 0, initMode: 'ENTER_HANGAR', initT: 0.35, seed: 501 },
      { cx: -4, cz: 18, rx: 25, rz: 14, y: 9.8, speed: 0.26, phase: 2.5, nestIdx: 0, initMode: 'CRUISE',       initT: 4.5,  seed: 607 },
      { cx: 4,  cz: 13, rx: 19, rz: 11, y: 6.9, speed: 0.33, phase: 4.6, nestIdx: 1, initMode: 'PERCH_AT_NEST',initT: 1.2,  seed: 719 },
    ];

    const wingShape = new THREE.Shape();
    wingShape.moveTo(0, 0.04);
    wingShape.quadraticCurveTo(0.14, 0.07, 0.28, -0.05);
    wingShape.quadraticCurveTo(0.16, -0.07, 0, -0.03);
    const wingGeo = new THREE.ShapeGeometry(wingShape, 5);
    wingGeo.rotateX(-Math.PI / 2);

    const tailShape = new THREE.Shape();
    tailShape.moveTo(0, 0);
    tailShape.lineTo(0.055, -0.14);
    tailShape.lineTo(0.015, -0.06);
    tailShape.lineTo(-0.015, -0.06);
    tailShape.lineTo(-0.055, -0.14);
    tailShape.closePath();
    const tailGeo = new THREE.ShapeGeometry(tailShape, 2);
    tailGeo.rotateX(-Math.PI / 2);

    const bodyGeo = new THREE.ConeGeometry(0.028, 0.22, 6);
    bodyGeo.rotateX(Math.PI / 2);

    const backMat = new THREE.MeshStandardMaterial({
      color: 0x1a2638,
      roughness: 0.45,
      metalness: 0.15,
      side: THREE.DoubleSide,
    });
    const throatMat = new THREE.MeshStandardMaterial({
      color: 0x7a2b1c,
      roughness: 0.65,
    });

    for (const cfg of configs) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(bodyGeo, backMat));
      // Subtle rusty-red barn swallow throat accent
      const throat = new THREE.Mesh(new THREE.SphereGeometry(0.020, 6, 5), throatMat);
      throat.position.set(0, -0.008, 0.055);
      g.add(throat);

      const tail = new THREE.Mesh(tailGeo, backMat);
      tail.position.z = -0.09;
      g.add(tail);
      const wingR = new THREE.Mesh(wingGeo, backMat);
      const wingL = new THREE.Mesh(wingGeo, backMat);
      wingL.scale.x = -1;
      g.add(wingR, wingL);
      // True-to-life barn swallow scale (~32 cm wingspan, ~15 cm body)
      g.scale.setScalar(0.62);
      this.root.add(g);

      const sw = {
        group: g,
        wingL,
        wingR,
        ...cfg,
        rngState: cfg.seed,
        mode: cfg.initMode,
        t: cfg.initT,
        dur: cfg.initMode === 'CRUISE' ? 11.0 : cfg.initMode === 'ENTER_HANGAR' ? 3.4 : 4.2,
        cruiseTime: cfg.phase,
        p0: new THREE.Vector3(),
        p1: new THREE.Vector3(),
        p2: new THREE.Vector3(),
        p3: new THREE.Vector3(),
      };
      this._setupSwallowSpline(sw, cfg.initMode);
      this.swallows.push(sw);
    }
  }

  _evalCruisePos(sw, ct, out) {
    out.set(
      sw.cx + Math.cos(ct) * sw.rx,
      sw.y + Math.sin(ct * 1.6 + sw.phase) * 1.25,
      sw.cz + Math.sin(ct) * sw.rz + Math.sin(ct * 2.0) * 2.2
    );
    return out;
  }

  _setupSwallowSpline(sw, mode) {
    const nest = this.swallowNests[sw.nestIdx];
    const side = nest.sideSign; // -1 left, +1 right
    if (mode === 'ENTER_HANGAR') {
      // Swoop down outside the open front bay so the bird enters cleanly below the front fascia
      // (roof at X=±2.0 is Y=3.53 m, at X=±4.3 is Y=3.01 m, at nest X=±5.61 is Y=2.72 m)
      const start = this._evalCruisePos(sw, sw.cruiseTime, new THREE.Vector3());
      start.x = THREE.MathUtils.clamp(start.x, -9.0, 9.0);
      start.z = Math.max(start.z, 11.5);
      start.y = THREE.MathUtils.clamp(start.y, 2.8, 3.9);
      sw.p0.copy(start);
      sw.p1.set(side * 1.95, 2.15, 5.80);
      sw.p2.set(side * 4.25, 2.38, -1.65);
      sw.p3.copy(nest.perch);
    } else if (mode === 'EXIT_HANGAR') {
      // Drop slightly off nest rim, skim cleanly below the rafters & front fascia, then climb into the sky
      const resume = this._evalCruisePos(sw, sw.cruiseTime + 1.1, new THREE.Vector3());
      resume.x = THREE.MathUtils.clamp(resume.x, -9.0, 9.0);
      resume.z = Math.max(resume.z, 12.0);
      resume.y = THREE.MathUtils.clamp(resume.y, 3.0, 4.2);
      sw.p0.copy(nest.perch);
      sw.p1.set(side * 4.25, 2.18, -2.05);
      sw.p2.set(side * 1.95, 2.15, 5.60);
      sw.p3.copy(resume);
    }
  }

  _evalCubicBezier(p0, p1, p2, p3, u, out) {
    const inv = 1 - u;
    const b0 = inv * inv * inv;
    const b1 = 3 * inv * inv * u;
    const b2 = 3 * inv * u * u;
    const b3 = u * u * u;
    out.set(
      b0 * p0.x + b1 * p1.x + b2 * p2.x + b3 * p3.x,
      b0 * p0.y + b1 * p1.y + b2 * p2.y + b3 * p3.y,
      b0 * p0.z + b1 * p1.z + b2 * p2.z + b3 * p3.z
    );
    return out;
  }

  _updateSwallow(sw, dt, sec) {
    sw.t += dt;
    const nest = this.swallowNests[sw.nestIdx];

    if (sw.t >= sw.dur) {
      sw.t = 0;
      if (sw.mode === 'CRUISE') {
        // Pick either left or right mud nest and swoop in through open front bay
        sw.nestIdx = this._nextRnd(sw) < 0.5 ? 0 : 1;
        sw.mode = 'ENTER_HANGAR';
        sw.dur = 3.2 + this._nextRnd(sw) * 0.8;
        this._setupSwallowSpline(sw, 'ENTER_HANGAR');
      } else if (sw.mode === 'ENTER_HANGAR') {
        sw.mode = 'PERCH_AT_NEST';
        sw.dur = 3.4 + this._nextRnd(sw) * 2.6; // tend nest 3.4-6.0 s
      } else if (sw.mode === 'PERCH_AT_NEST') {
        sw.mode = 'EXIT_HANGAR';
        sw.dur = 2.8 + this._nextRnd(sw) * 0.7;
        this._setupSwallowSpline(sw, 'EXIT_HANGAR');
      } else {
        sw.mode = 'CRUISE';
        sw.dur = 9.0 + this._nextRnd(sw) * 8.0;
        sw.cruiseTime += 1.1;
      }
    }

    if (sw.mode === 'CRUISE') {
      sw.cruiseTime += dt * sw.speed;
      const pos = this._evalCruisePos(sw, sw.cruiseTime, new THREE.Vector3());
      const nextPos = this._evalCruisePos(sw, sw.cruiseTime + 0.04, new THREE.Vector3());
      const dir = nextPos.sub(pos);
      sw.group.position.copy(pos);
      sw.group.rotation.y = Math.atan2(dir.x, dir.z);
      sw.group.rotation.x = THREE.MathUtils.clamp(-dir.y * 0.8, -0.35, 0.35);
      sw.group.rotation.z = THREE.MathUtils.clamp(-Math.sin(sw.cruiseTime) * 0.42, -0.48, 0.48);

      const burst = smoothstep01(Math.sin(sec * 1.3 + sw.phase * 3.0));
      const flap = Math.sin(sec * 18.0 + sw.phase * 4.0) * 0.62 * burst - 0.12 * (1.0 - burst);
      sw.wingR.scale.set(1, 1, 1);
      sw.wingL.scale.set(-1, 1, 1);
      sw.wingR.rotation.set(0, 0, flap);
      sw.wingL.rotation.set(0, 0, -flap);
      return;
    }

    if (sw.mode === 'PERCH_AT_NEST') {
      // Gently perched on the mud nest rim, wings folded sleekly along back, subtle lively head/body bob
      const bob = Math.sin(sec * 3.8 + sw.phase) * 0.008;
      const peck = Math.pow(Math.max(0, Math.sin(sec * 1.9 + sw.phase * 2.0)), 6.0) * 0.24;
      sw.group.position.set(nest.perch.x, nest.perch.y + bob, nest.perch.z);
      sw.group.rotation.set(0.14 + peck, nest.yaw + Math.sin(sec * 1.4 + sw.phase) * 0.22, 0);
      // Sleek folded wings tucked neatly along the swallow's back
      sw.wingR.scale.set(0.32, 1.0, 0.72);
      sw.wingL.scale.set(-0.32, 1.0, 0.72);
      sw.wingR.rotation.set(0.06, -1.18, -0.14);
      sw.wingL.rotation.set(0.06,  1.18,  0.14);
      return;
    }

    // ENTER_HANGAR or EXIT_HANGAR along smooth cubic Bezier spline
    const uRaw = Math.min(sw.t / Math.max(sw.dur, 0.01), 1.0);
    // Ease-out into nest landing, ease-in out of nest takeoff
    const u = sw.mode === 'ENTER_HANGAR'
      ? 1.0 - Math.pow(1.0 - uRaw, 1.45)
      : Math.pow(uRaw, 1.35);
    const pos = this._evalCubicBezier(sw.p0, sw.p1, sw.p2, sw.p3, u, new THREE.Vector3());
    const ahead = this._evalCubicBezier(sw.p0, sw.p1, sw.p2, sw.p3, Math.min(u + 0.025, 1.0), new THREE.Vector3());
    const dir = ahead.sub(pos);
    if (dir.lengthSq() > 1e-7) {
      sw.group.rotation.y = Math.atan2(dir.x, dir.z);
      const horiz = Math.max(Math.hypot(dir.x, dir.z), 1e-4);
      sw.group.rotation.x = THREE.MathUtils.clamp(-Math.atan2(dir.y, horiz) * 0.7, -0.45, 0.45);
      sw.group.rotation.z = THREE.MathUtils.clamp(-dir.x * 1.6, -0.52, 0.52);
    }
    sw.group.position.copy(pos);

    // Rapid braking flutter right before landing on the nest rim, brisk dart-out flaps on exit
    const flapFreq = sw.mode === 'ENTER_HANGAR' && uRaw > 0.72 ? 26.0 : 19.0;
    const flapAmp = sw.mode === 'ENTER_HANGAR' && uRaw > 0.85 ? 0.82 : 0.65;
    const flap = Math.sin(sec * flapFreq + sw.phase * 4.0) * flapAmp;
    sw.wingR.scale.set(1, 1, 1);
    sw.wingL.scale.set(-1, 1, 1);
    sw.wingR.rotation.set(0, 0, flap);
    sw.wingL.rotation.set(0, 0, -flap);
  }

  setCatPlacement(x, y, z, yawDeg = 24) {
    this.catGroup.position.set(x, y, z);
    this.catGroup.rotation.y = THREE.MathUtils.degToRad(yawDeg);
  }

  async loadCat(url = '../dist/cat.glb') {
    this.catGroup.clear();
    let catModel = null;
    try {
      const gltf = await this.loader.loadAsync(url);
      catModel = gltf.scene;
      catModel.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      // Rest curled-up sleeping cat cleanly on chair seat top (local Y = 0)
      catModel.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(catModel);
      if (Number.isFinite(box.min.y)) {
        catModel.position.y -= box.min.y;
      }
      console.info('[wildlife] Loaded sleeping white hangar cat from', url);
    } catch (err) {
      console.warn('[wildlife] cat.glb unavailable:', err?.message || err);
      return;
    }

    this.catGroup.add(catModel);
    this.catNodes = {
      body: catModel.getObjectByName('Cat_Body') || catModel,
      head: catModel.getObjectByName('Cat_Head'),
      earL: catModel.getObjectByName('Cat_Ear_L'),
      earR: catModel.getObjectByName('Cat_Ear_R'),
      tail: catModel.getObjectByName('Cat_Tail'),
    };
    this.catBaseRot = {
      head: this.catNodes.head ? this.catNodes.head.rotation.clone() : null,
      earL: this.catNodes.earL ? this.catNodes.earL.rotation.clone() : null,
      earR: this.catNodes.earR ? this.catNodes.earR.rotation.clone() : null,
      tail: this.catNodes.tail ? this.catNodes.tail.rotation.clone() : null,
    };
  }

  async loadDeer(url = '../dist/deer.glb') {
    this.deerGroup.clear();
    let deerModel = null;
    try {
      const gltf = await this.loader.loadAsync(url);
      deerModel = gltf.scene;
      deerModel.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      deerModel.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(deerModel);
      if (Number.isFinite(box.min.y)) {
        deerModel.position.y -= box.min.y + 0.015;
      }
      console.info('[wildlife] Loaded roe deer doe & fawn from', url);
    } catch (err) {
      console.warn('[wildlife] deer.glb unavailable:', err?.message || err);
      return;
    }

    this.deerGroup.add(deerModel);
    this.deerNodes = {
      doeNeck: deerModel.getObjectByName('Doe_NeckHead'),
      doeEarL: deerModel.getObjectByName('Doe_Ear_L'),
      doeEarR: deerModel.getObjectByName('Doe_Ear_R'),
      doeTail: deerModel.getObjectByName('Doe_Tail'),
      fawnNeck: deerModel.getObjectByName('Fawn_NeckHead'),
      fawnTail: deerModel.getObjectByName('Fawn_Tail'),
    };
    this.deerBaseRot = {};
    for (const [k, node] of Object.entries(this.deerNodes)) {
      if (node) this.deerBaseRot[k] = node.rotation.clone();
    }
  }

  syncSun(preset) {
    this.uniforms.uSunColor.value.setHex(preset.sunColor);
    this.uniforms.uSunGain.value = preset.id === 'golden_hour' ? 1.35 : preset.id === 'overcast' ? 0.55 : 0.95;
  }

  setEnabled(on) {
    this.root.visible = on;
  }

  setDustOpacity(val) {
    this.uniforms.uDustOpacity.value = val;
  }

  _updateButterfly(b, dt, sec) {
    b.t += dt;
    if (b.t >= b.dur) {
      b.t = 0;
      if (b.mode === 'APPROACH') {
        b.mode = 'REST';
        b.dur = 6.0 + this._nextRnd(b) * 7.0; // rest peacefully 6-13s
      } else if (b.mode === 'REST') {
        b.mode = 'DEPART';
        b.onGlider = false;
        b.dur = 3.8 + this._nextRnd(b) * 2.2;
        b.fromPos.copy(b.toPos);
        const angle = (this._nextRnd(b) - 0.5) * 1.8;
        b.toPos.set(Math.sin(angle) * 11.0, 1.4 + this._nextRnd(b) * 1.4, 9.5 + this._nextRnd(b) * 4.0);
      } else if (b.mode === 'DEPART') {
        b.mode = 'AWAY';
        b.onGlider = false;
        b.dur = 9.0 + this._nextRnd(b) * 11.0; // away over meadow 9-20s
      } else {
        // AWAY -> return randomly to a different real surface perch (floor, glider, or prop)
        b.mode = 'APPROACH';
        b.dur = 4.0 + this._nextRnd(b) * 2.2;
        b.fromPos.copy(b.toPos);
        let nextIdx = Math.floor(this._nextRnd(b) * this.perchSpecs.length);
        if (nextIdx === b.perchIdx) nextIdx = (nextIdx + 1) % this.perchSpecs.length;
        b.perchIdx = nextIdx;
        const resolved = this._resolvePerch(b, nextIdx);
        b.toPos.copy(resolved.pos);
        b.onGlider = resolved.onGlider;
      }
    }

    if (b.mode === 'AWAY') {
      b.group.visible = false;
      return;
    }
    b.group.visible = true;

    if (b.mode === 'REST') {
      b.group.position.copy(b.toPos);
      // Slowly breathing folded wings while sunning on the perch
      const restFlap = 1.05 + Math.sin(sec * 1.45 + b.phase) * 0.22;
      b.wingR.rotation.z = restFlap;
      b.wingL.rotation.z = -restFlap;
      return;
    }

    // Smooth wandering flight along curved arc (APPROACH or DEPART)
    const u = Math.min(b.t / Math.max(b.dur, 0.01), 1.0);
    const e = u * u * (3 - 2 * u);
    const pos = b.fromPos.clone().lerp(b.toPos, e);
    const arc = Math.sin(u * Math.PI);
    pos.x += Math.sin(sec * 2.3 + b.phase) * 0.45 * arc;
    pos.y += (0.55 + Math.sin(sec * 4.1 + b.phase) * 0.16) * arc;
    pos.z += Math.cos(sec * 1.9 + b.phase) * 0.35 * arc;

    const dir = pos.clone().sub(b.group.position);
    if (dir.lengthSq() > 1e-6) {
      b.group.rotation.y = Math.atan2(dir.x, dir.z);
    }
    b.group.position.copy(pos);

    const flap = Math.sin(sec * 16.0 + b.phase * 4.0) * 0.85 + 0.15;
    b.wingR.rotation.z = flap;
    b.wingL.rotation.z = -flap;
  }

  update(sec) {
    const dt = Math.min(Math.max(sec - this._lastSec, 0), 0.1);
    this._lastSec = sec;
    this.uniforms.uTime.value = sec;
    if (!this.root.visible) return;

    // 1. 1-2 Butterflies with Settle / Rest / Fly-Off / Return
    for (const b of this.butterflies) {
      this._updateButterfly(b, dt, sec);
    }

    // 2. Barn swallows swooping in/out of the hangar to their rear-corner mud nests
    for (const sw of this.swallows) {
      this._updateSwallow(sw, dt, sec);
    }

    // 3. Curled-up sleeping white cat on the folding chair (slow peaceful breathing + rare sleepy ear/tail twitch)
    const { body, earL, earR, tail } = this.catNodes;
    if (body) {
      const breath = Math.sin(sec * 1.15) * 0.022;
      body.scale.set(1.0 + breath * 0.7, 1.0 + breath * 1.25, 1.0 + breath * 0.7);
    }
    if (tail && this.catBaseRot.tail) {
      // Subtle slow tail-tip curl while sleeping
      const curl = Math.pow(Math.max(0, Math.sin(sec * 0.35 + 1.0)), 6.0) * 0.14;
      tail.rotation.y = this.catBaseRot.tail.y + curl;
    }
    if (earL && this.catBaseRot.earL) {
      const twitchL = Math.pow(Math.max(0, Math.sin(sec * 0.42 + 0.5)), 48.0) * 0.24;
      earL.rotation.z = this.catBaseRot.earL.z + twitchL;
    }
    if (earR && this.catBaseRot.earR) {
      const twitchR = Math.pow(Math.max(0, Math.sin(sec * 0.37 + 3.1)), 52.0) * 0.24;
      earR.rotation.z = this.catBaseRot.earR.z - twitchR;
    }

    // 4. Grazing roe deer doe & spotted fawn
    const { doeNeck, doeEarL, doeEarR, doeTail, fawnNeck, fawnTail } = this.deerNodes;
    if (doeNeck && this.deerBaseRot.doeNeck) {
      const cycle = Math.sin(sec * 0.26);
      const graze = smoothstep01(cycle * 1.4 + 0.35);
      const chew = Math.sin(sec * 4.2) * 0.035 * graze;
      doeNeck.rotation.x = this.deerBaseRot.doeNeck.x + graze * 0.52 + chew;
      doeNeck.rotation.y = this.deerBaseRot.doeNeck.y + (1.0 - graze) * Math.sin(sec * 0.55) * 0.32;
    }
    if (doeEarL && this.deerBaseRot.doeEarL) {
      doeEarL.rotation.z = this.deerBaseRot.doeEarL.z + Math.pow(Math.max(0, Math.sin(sec * 0.8 + 1.1)), 22.0) * 0.25;
    }
    if (doeEarR && this.deerBaseRot.doeEarR) {
      doeEarR.rotation.z = this.deerBaseRot.doeEarR.z - Math.pow(Math.max(0, Math.sin(sec * 0.65 + 3.4)), 24.0) * 0.25;
    }
    if (doeTail && this.deerBaseRot.doeTail) {
      doeTail.rotation.z = this.deerBaseRot.doeTail.z + Math.sin(sec * 2.4) * 0.14;
    }
    if (fawnNeck && this.deerBaseRot.fawnNeck) {
      const fCycle = Math.sin(sec * 0.34 + 1.9);
      const fGraze = smoothstep01(fCycle * 1.3 + 0.25);
      fawnNeck.rotation.x = this.deerBaseRot.fawnNeck.x + fGraze * 0.48 + Math.sin(sec * 5.0) * 0.04 * fGraze;
      fawnNeck.rotation.y = this.deerBaseRot.fawnNeck.y + (1.0 - fGraze) * Math.sin(sec * 0.8) * 0.38;
    }
    if (fawnTail && this.deerBaseRot.fawnTail) {
      fawnTail.rotation.z = this.deerBaseRot.fawnTail.z + Math.sin(sec * 3.1 + 0.7) * 0.18;
    }
  }
}

function smoothstep01(x) {
  const t = Math.max(0, Math.min(1, x * 0.5 + 0.5));
  return t * t * (3 - 2 * t);
}
