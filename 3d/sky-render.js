/* A real sun or moon over the 3D map -- whichever is actually up right now,
 * at its real position, computed from 3d/sky.js's astronomy for HCMC. The
 * sun is rendered hazy (soft, warm, glowing -- how it actually looks through
 * this city's humidity), the moon crisp (a hard-edged disc with its real
 * current phase), matching what they asked for directly: "the sun should be
 * properly hazy, but moon clear". A shimmering glint is also cast onto every
 * mapped water surface, in the same direction, so a low sun or moon trails a
 * reflection down the river the way it actually would. Sprites use
 * THREE.DataTexture (procedural pixel buffers, see lightning.js's
 * dataTexture()) rather than a 2D canvas, so this stays DOM-free and
 * testable the same way. */
import * as THREE from 'three';
import { getSunPosition, getMoonPosition, getMoonIllumination } from './sky.js';

// Distance from the scene origin to hang the sky dome at -- far past the
// camera's maxDistance (220000) and city span (~200000), safely inside its
// far clipping plane (500000), so it always reads as "the sky", never as a
// flyable object and never clipped while orbiting anywhere in the city.
const SKY_RADIUS = 320000;
// Below this altitude a body is considered "set": haze/horizon murk hides it
// before it would visually clip the ground plane, matching ordinary dusk.
const RISE_SET_ALTITUDE = -3 * Math.PI / 180;
// The default camera presets look somewhat down at street level, not level
// with the true horizon, so the literal astronomical altitude often placed
// the disc above the frame or uncomfortably high once found. Capping the
// *displayed* position (never the physics: day/night switching and the
// scene's directional light below both still use the real altitude) keeps
// it near the skyline, which also happens to be what a river reflection
// needs -- a grazing, near-horizon light casts the dramatic long one.
const DISPLAY_ALTITUDE_CAP = 12 * Math.PI / 180;
// Re-render the moon's phase texture only when the illuminated fraction has
// moved enough to actually look different -- it changes over days, not
// frames, so redrawing every update() would be pure waste.
const MOON_TEXTURE_STEP = 0.01;

function dataTexture(width, height, fill) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const [r, g, b, a] = fill(x / (width - 1 || 1), y / (height - 1 || 1)), i = (y * width + x) * 4;
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
  }
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace; texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

// Warm white core through gold to transparent, soft-edged throughout --
// atmospheric haze around the disc rather than a sharp rim, brightest near
// the centre but with no hard boundary anywhere.
function sunTexture() {
  return dataTexture(128, 128, (u, v) => {
    const r = Math.hypot(u - 0.5, v - 0.5) * 2; // 0 centre .. 1 edge .. beyond, haze
    const core = Math.exp(-Math.pow(r / 0.22, 2));
    const corona = Math.exp(-Math.pow(r / 0.62, 2)) * 0.55;
    const white = [255, 250, 235], gold = [255, 196, 92];
    const t = Math.min(1, core);
    const rgb = white.map((c, i) => Math.round(c * t + gold[i] * (1 - t)));
    const alpha = Math.round(255 * Math.min(1, core + corona));
    return [...rgb, alpha];
  });
}

// A hard-edged disc (no haze) with subtle procedural maria-like shading, and
// the real current phase cut in: lit(x,y) = x >= -(2*fraction-1)*sqrt(1-y^2)
// for a unit disc with +x toward the illuminated limb -- the standard
// terminator-ellipse construction (degenerates to the vertical diameter at
// a quarter moon, to the whole disc at full, to nothing at new). Orientation
// is applied at render time via sprite.material.rotation, not baked in here,
// so this texture only needs regenerating when the phase itself changes.
function moonTexture(fraction) {
  const c = 2 * fraction - 1;
  return dataTexture(160, 160, (u, v) => {
    const x = (u - 0.5) * 2, y = (v - 0.5) * 2, r2 = x * x + y * y;
    if (r2 > 1) return [0, 0, 0, 0]; // hard edge -- no haze, unlike the sun
    const lit = x >= -c * Math.sqrt(Math.max(0, 1 - y * y));
    if (!lit) return [0, 0, 0, 0]; // the unlit portion is simply absent, not a grey disc
    // Deterministic, subtle mottling standing in for maria -- not real crater
    // positions, just enough texture that it doesn't read as a flat sticker.
    const mottle = 1 - 0.10 * (0.5 + 0.5 * Math.sin(x * 7.3 + y * 3.1)) * (0.5 + 0.5 * Math.sin(x * 2.6 - y * 8.4 + 1.7));
    const limb = 1 - 0.35 * Math.pow(Math.hypot(x, y), 6); // gentle darkening toward the rim
    const base = [232, 232, 226];
    const shade = mottle * limb;
    return [...base.map(v2 => Math.round(v2 * shade)), 255];
  });
}

// sky.js returns azimuth the suncalc way: 0 = SOUTH, positive toward WEST
// (so -90 deg is east, +90 deg west) -- not a compass bearing. Converted here.
function compassBearing(azimuth) {
  return (azimuth * 180 / Math.PI + 180 + 360) % 360;
}

function directionFromAltAz(altitude, azimuth) {
  // World axes here: +X east, +Z south (see 3d/tools/build.py's manifest
  // note), +Y up. Measured from south toward west, south is +Z and west -X.
  const cosAlt = Math.cos(altitude);
  return new THREE.Vector3(-Math.sin(azimuth) * cosAlt, Math.sin(altitude), Math.cos(azimuth) * cosAlt);
}

// Shared uniform *objects*, mutated in place once per update() -- every
// water material's compiled shader keeps a reference to these same objects
// (see applyWaterGlint), so nothing needs to be re-applied or iterated over
// per frame, and nothing needs unregistering when a tile is evicted: an
// evicted mesh's disposed material simply stops being drawn, its shader
// uniforms untouched but also unread.
function makeGlintUniforms() {
  return {
    uGlintDir: { value: new THREE.Vector3(0, 1, 0) },
    uGlintColor: { value: new THREE.Color('#fff3da') },
    uGlintTime: { value: 0 },
    uGlintIntensity: { value: 0 },
    uFacadeGlintIntensity: { value: 0 },
  };
}

// Injects a shimmering specular term into a water mesh's existing PBR
// shader via onBeforeCompile, rather than replacing its material -- the
// normal diffuse water colour and scene lighting are untouched, this only
// adds a glint on top. The wobbled normal (a couple of animated sine waves
// in world x/z) breaks a single Phong highlight into a jittery scatter of
// glints along the reflection line, the way real small ripples do, instead
// of one static blob.
function applyWaterGlint(material, uniforms) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGlintDir = uniforms.uGlintDir;
    shader.uniforms.uGlintColor = uniforms.uGlintColor;
    shader.uniforms.uGlintTime = uniforms.uGlintTime;
    shader.uniforms.uGlintIntensity = uniforms.uGlintIntensity;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGlintWorldPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlintWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vGlintWorldPos;
        uniform vec3 uGlintDir;
        uniform vec3 uGlintColor;
        uniform float uGlintTime;
        uniform float uGlintIntensity;`)
      .replace('#include <dithering_fragment>', `
        if (uGlintIntensity > 0.0) {
          // Widely separated frequencies, not four close ones: near-equal
          // sine periods beat against each other into a long, regular
          // envelope that reads as a repeating tile across a multi-km
          // river. A slow broad term plus a fast fine one doesn't.
          vec2 wobble = (vec2(
            sin(vGlintWorldPos.x * 0.0021 + uGlintTime * 1.3), sin(vGlintWorldPos.z * 0.0026 - uGlintTime * 0.9)
          ) * 0.5 + vec2(
            sin(vGlintWorldPos.x * 0.041 - uGlintTime * 0.7), sin(vGlintWorldPos.z * 0.053 + uGlintTime * 1.1)
          ) * 0.5) * 0.16;
          vec3 rippled = normalize(vec3(wobble.x, 1.0, wobble.y));
          vec3 toEye = normalize(cameraPosition - vGlintWorldPos);
          vec3 halfVec = normalize(normalize(uGlintDir) + toEye);
          // Two lobes, not one: a broad soft sheen anchors a visible path
          // along the reflection line from most angles a river is actually
          // seen at, while a second, tighter lobe riding the rippled normal
          // breaks it into moving glints rather than a flat glow. A single
          // narrow lobe alone is only ever visible from near-mirror angles,
          // which a real river's bends rarely deliver.
          float sheen = pow(max(dot(vec3(0.0, 1.0, 0.0), halfVec), 0.0), 9.0);
          float sparkle = pow(max(dot(rippled, halfVec), 0.0), 38.0);
          float spec = sheen * 0.6 + sparkle * 2.2;
          gl_FragColor.rgb += uGlintColor * spec * uGlintIntensity;
        }
        #include <dithering_fragment>`);
  };
  material.needsUpdate = true;
}

// Procedural windows on every building wall, glinting in the same sun/moon
// direction as the water -- drawn entirely in the fragment shader from world
// position and normal, since the extruded OSM buildings carry no UVs (see
// build.py's building()) and baking some in would grow 451 MB of tiles for
// what a few dozen shader instructions can draw. Walls are merged per tile,
// so there is no building id; each flat wall's plane offset dot(N.xz, P.xz)
// is constant across that wall and stands in as its random seed instead
// (window width, curtain wall vs punched windows, how reflective).
//
// Stylised on purpose: a vertical mirror reflects the sun *downward*, so from
// these aerial viewpoints a physically exact facade glint would essentially
// never be seen. Here the reflection's vertical component is folded upward
// (as if the panes tilted toward the sky, which many do slightly) and only
// its horizontal alignment is held tight -- a facade flashes when the camera
// swings round to its mirror azimuth, which is the part that reads as real.
// Color converts these sRGB swatches to the renderer's linear working space.
const FACADE_PALETTE = ['#e4d8bd', '#e9dfc9', '#d5c19f', '#dcb8a5', '#bac8b1'].map(c => new THREE.Color(c));
const GLASS_PALETTE = ['#86b9c9', '#79b3ac', '#b6c8d2'].map(c => new THREE.Color(c));

function applyBuildingGlass(material, uniforms, glassBias, nightUniform) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGlintDir = uniforms.uGlintDir;
    shader.uniforms.uGlintColor = uniforms.uGlintColor;
    shader.uniforms.uGlintIntensity = uniforms.uFacadeGlintIntensity;
    shader.uniforms.uGlassBias = { value: glassBias };
    shader.uniforms.uCityNight = nightUniform;
    shader.uniforms.uFacadePalette = { value: FACADE_PALETTE };
    shader.uniforms.uGlassPalette = { value: GLASS_PALETTE };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGlassWorldPos;\nvarying vec3 vGlassWorldNormal;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vGlassWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vGlassWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vGlassWorldPos;
        varying vec3 vGlassWorldNormal;
        uniform vec3 uGlintDir;
        uniform vec3 uGlintColor;
        uniform float uGlintIntensity;
        uniform float uGlassBias;
        uniform float uCityNight;
        uniform vec3 uFacadePalette[5];
        uniform vec3 uGlassPalette[3];
        float glassHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        // Use the original wall normal, never the view-facing normal: the
        // palette and window layout must stay fixed as the camera moves.
        float facadeSeed(vec3 N, vec3 P) {
          float plane = dot(N.xz, P.xz);
          float orientation = floor(atan(N.z, N.x) * 32.0 + 0.5);
          return glassHash(vec2(floor(plane * 0.5 + 0.5), orientation));
        }
        vec3 facadeColor(float seed) {
          if (seed < 0.35) return uFacadePalette[0]; // ivory
          if (seed < 0.65) return uFacadePalette[1]; // cream
          if (seed < 0.85) return uFacadePalette[2]; // sandstone
          if (seed < 0.94) return uFacadePalette[3]; // occasional peach
          return uFacadePalette[4];                // occasional sage
        }
        // Anti-aliased 1-D pulse: 1 inside the central 'open' fraction of each
        // cell, 0 on the frame, edges softened by the cell's screen footprint.
        float glassPulse(float x, float open, float fw) {
          float d = abs(fract(x) - 0.5) - open * 0.5;
          return 1.0 - smoothstep(-fw, fw, d);
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        // Change albedo before lighting so sun, shade and night still work.
        vec3 facadeN = normalize(vGlassWorldNormal);
        if (abs(facadeN.y) < 0.5) {
          float paletteSeed = facadeSeed(facadeN, vGlassWorldPos);
          diffuseColor.rgb = facadeColor(glassHash(vec2(paletteSeed * 73.0, 19.0)));
        } else {
          diffuseColor.rgb = mix(diffuseColor.rgb, uFacadePalette[2] * 0.65, 0.65);
        }`)
      // Reflections are added in linear space, before tone mapping, color
      // conversion and fog, so distant glass blends into the city haze.
      .replace('#include <tonemapping_fragment>', `
        {
          vec3 N = normalize(vGlassWorldNormal);
          vec3 V = normalize(cameraPosition - vGlassWorldPos);
          if (abs(N.y) < 0.5) { // walls only; roofs keep their plain finish
            N = normalize(vec3(N.x, 0.0, N.z));
            vec3 T = vec3(-N.z, 0.0, N.x);
            float plane = dot(N.xz, vGlassWorldPos.xz);
            float seed = facadeSeed(N, vGlassWorldPos);
            if (dot(N, V) < 0.0) N = -N; // double-sided lighting only
            float seed2 = glassHash(vec2(seed * 91.0, 3.0));
            bool curtain = seed < uGlassBias;
            float width = curtain ? 1.5 : 1.6 + seed2 * 1.2;
            vec2 cell = vec2(dot(vGlassWorldPos, T) / width, vGlassWorldPos.y / 3.2);
            vec2 fw = fwidth(cell);
            // Past ~half a cell per pixel the grid would only shimmer and
            // moire; fade it into its own average coverage instead.
            float resolve = 1.0 - smoothstep(0.25, 0.6, max(fw.x, fw.y));
            vec2 open = curtain ? vec2(0.93, 0.88) : vec2(0.35 + seed2 * 0.3, 0.45);
            float sharp = glassPulse(cell.x, open.x, fw.x) * glassPulse(cell.y, open.y, fw.y);
            float coverage = open.x * open.y;
            float glass = mix(coverage, sharp, resolve) * step(1.0, cell.y); // no windows at street level
            float reflectivity = curtain ? 1.0 : 0.55;

            // Glass reads darker and slightly sky-tinted, more so at grazing
            // angles (Fresnel), before any glint.
            float fresnel = 0.04 + 0.96 * pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 5.0);
            float tintSeed = glassHash(vec2(seed * 57.0, 11.0));
            vec3 glassTint = tintSeed < 0.4 ? uGlassPalette[0] :
                             tintSeed < 0.75 ? uGlassPalette[1] : uGlassPalette[2];
            // An inexpensive sky reflection approximation, with no HDR map.
            float skyHeight = clamp(reflect(-V, N).y * 0.5 + 0.5, 0.0, 1.0);
            vec3 skyTint = mix(glassTint, vec3(0.42, 0.64, 0.82), skyHeight * 0.45);
            float lightLevel = clamp(dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.5);
            vec3 tinted = gl_FragColor.rgb * 0.35 + skyTint * lightLevel * (0.65 + 0.8 * fresnel);
            gl_FragColor.rgb = mix(gl_FragColor.rgb, tinted, glass * 0.88);

            if (uCityNight > 0.0) {
              // Stable room occupancy: no frame-dependent random flicker.
              // Unresolved windows converge to their mean lit coverage.
              float occupancy = mix(0.28, 0.62, seed2);
              float room = glassHash(floor(cell) + vec2(seed * 127.0, 31.0));
              float occupied = mix(occupancy, step(1.0 - occupancy, room), resolve);
              float warmth = glassHash(floor(cell) + vec2(17.0, seed * 83.0));
              vec3 roomColor = mix(vec3(1.0, 0.48, 0.16), vec3(1.0, 0.78, 0.43), warmth);
              roomColor = mix(vec3(1.0, 0.63, 0.295), roomColor, resolve);
              gl_FragColor.rgb += roomColor * glass * occupied * uCityNight * 1.25;

              // Sparse amber vertical accents on tall facades, using the same
              // filtered grid. No extra geometry or light objects are needed.
              float accentCell = cell.x / 8.0;
              float accentResolve = 1.0 - smoothstep(0.25, 0.6, fw.x / 8.0);
              float accent = mix(0.055, glassPulse(accentCell, 0.055, fw.x / 8.0), accentResolve);
              float tower = smoothstep(60.0, 140.0, vGlassWorldPos.y) * step(0.78, seed2);
              gl_FragColor.rgb += vec3(1.0, 0.40, 0.08) * accent * tower * uCityNight * 0.8;
            }

            vec3 L = normalize(uGlintDir);
            if (uGlintIntensity > 0.0 && dot(L.xz, N.xz) > 0.0) {
              // Each pane is set a couple of degrees off true, like real
              // glazing, so neighbouring panes catch the light at slightly
              // different camera angles: a scatter of flashes, not one sheet.
              vec2 pane = floor(cell);
              vec2 jitter = (vec2(glassHash(pane + plane), glassHash(pane.yx - plane)) - 0.5) * 0.08;
              vec3 Np = normalize(N + T * jitter.x + vec3(0.0, jitter.y, 0.0));
              vec3 R = reflect(-L, Np);
              R.y = abs(R.y); // folded upward -- see the note above
              float along = max(dot(normalize(R.xz), normalize(V.xz)), 0.0);
              float along0 = max(dot(normalize(reflect(-L, N).xz), normalize(V.xz)), 0.0);
              float lift = asin(clamp(V.y, -1.0, 1.0)) - asin(clamp(R.y, -1.0, 1.0));
              float vertical = exp(-lift * lift / 0.12); // ~20 degrees of tolerance
              float sparkle = pow(along, 1200.0) * resolve + pow(along, 60.0) * 0.15 * (1.0 - resolve);
              float sheen = pow(along0, 40.0) * 0.25;
              float spec = (sparkle * 3.0 + sheen) * vertical * (0.35 + fresnel);
              gl_FragColor.rgb += uGlintColor * spec * glass * reflectivity * uGlintIntensity;
            }
          }
        }
        #include <tonemapping_fragment>`);
  };
  material.needsUpdate = true;
}

export function createSky({ scene, manifest, directionalLight, hemisphereLight, now }) {
  const lat = manifest?.originLonLat?.[1] ?? 10.7769;
  const lon = manifest?.originLonLat?.[0] ?? 106.7009;

  const sun = new THREE.Sprite(new THREE.SpriteMaterial({
    map: sunTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0,
  }));
  const moon = new THREE.Sprite(new THREE.SpriteMaterial({
    map: moonTexture(1), transparent: true, depthWrite: false, opacity: 0,
  }));
  sun.renderOrder = -1; moon.renderOrder = -1; // draw behind everything else in the sky
  scene.add(sun, moon);

  const glintUniforms = makeGlintUniforms();
  const nightUniform = { value: 0 };
  const state = { body: 'none', altitudeDeg: null, azimuthDeg: null, moonFraction: null, moonPhase: null };
  let lastMoonFraction = null;

  // Call for the overview group and for each tile as it loads (mirrors how
  // updateLayer()/updateSkyline() are applied to newly-loaded content in
  // viewer.js) -- idempotent, so calling it again on the same group is safe.
  function registerWater(root) {
    if (!root) return;
    root.traverse((o) => {
      if (o.isMesh && o.name === 'water' && !o.userData.glintApplied) {
        applyWaterGlint(o.material, glintUniforms);
        o.userData.glintApplied = true;
      }
    });
  }

  // Same contract as registerWater(). The skyline layer holds only the tall
  // towers (skyline.py keeps their upper walls), so it leans toward curtain
  // walls; tagged buildings (mapped levels, usually the larger ones) lean
  // that way somewhat more than the untagged, mostly low-rise default.
  function registerBuildings(root) {
    if (!root) return;
    root.traverse((o) => {
      if (!o.isMesh || !o.name.startsWith('building') || o.userData.glassApplied) return;
      const bias = o.name.startsWith('building-skyline') ? 0.7 : o.name === 'building-tagged' ? 0.35 : 0.12;
      applyBuildingGlass(o.material, glintUniforms, bias, nightUniform);
      o.userData.glassApplied = true;
    });
  }

  // Reuse the overview lines and detailed road ribbons. Shared uniforms
  // avoid retaining tile/material references after the viewer evicts them.
  function registerRoads(root) {
    if (!root) return;
    root.traverse(o => {
      const strength = {major: 0.85, bridge: 0.85, street: 0.22}[o.name];
      if (!(o.isMesh || o.isLineSegments) || !strength || o.userData.roadGlowApplied) return;
      for (const material of Array.isArray(o.material) ? o.material : [o.material]) {
        material.onBeforeCompile = shader => {
          shader.uniforms.uCityNight = nightUniform;
          shader.uniforms.uRoadGlow = {value: strength};
          shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>
              uniform float uCityNight;
              uniform float uRoadGlow;`)
            .replace('#include <tonemapping_fragment>', `
              // Amber emission replaces the pale daytime guide color at
              // night; distant streets stay subtler than arterial roads.
              gl_FragColor.rgb = mix(gl_FragColor.rgb,
                vec3(1.0, 0.46, 0.10) * uRoadGlow + gl_FragColor.rgb * 0.5, uCityNight);
              #include <tonemapping_fragment>`);
        };
        material.needsUpdate = true;
      }
      o.userData.roadGlowApplied = true;
    });
  }

  function update(atTime) {
    const date = atTime instanceof Date ? atTime : new Date(atTime ?? Date.now());
    const s = getSunPosition(date, lat, lon);
    const m = getMoonPosition(date, lat, lon);
    const illum = getMoonIllumination(date);

    // Fade in from +4° to -6° solar altitude, regardless of moon phase.
    const dusk = THREE.MathUtils.clamp((4 - s.altitude * 180 / Math.PI) / 10, 0, 1);
    nightUniform.value = dusk * dusk * (3 - 2 * dusk);
    state.cityLights = nightUniform.value;
    const sunUp = s.altitude > RISE_SET_ALTITUDE;
    const moonUp = !sunUp && m.altitude > RISE_SET_ALTITUDE;
    const displayAlt = (alt) => Math.min(alt, DISPLAY_ALTITUDE_CAP);

    if (sunUp) {
      const dir = directionFromAltAz(displayAlt(s.altitude), s.azimuth);
      sun.position.copy(dir).multiplyScalar(SKY_RADIUS);
      // Lower sun = more atmosphere traversed = hazier, dimmer, more amber --
      // real extinction, not just a fade for its own sake. Driven by the
      // true altitude (extinction is a real-sky fact), not the display cap.
      const climb = Math.max(0, Math.sin(s.altitude));
      sun.material.opacity = 0.55 + 0.4 * climb;
      sun.material.color.setRGB(1, 0.75 + 0.2 * climb, 0.55 + 0.35 * climb);
      const scale = SKY_RADIUS * (0.24 - 0.07 * climb); // visibly bigger and softer near the horizon, like real haze
      sun.scale.set(scale, scale, 1);
      moon.material.opacity = 0;
      state.body = 'sun'; state.altitudeDeg = s.altitude * 180 / Math.PI; state.azimuthDeg = compassBearing(s.azimuth);

      glintUniforms.uGlintDir.value.copy(dir);
      glintUniforms.uGlintColor.value.setRGB(1, 0.82 + 0.15 * climb, 0.62 + 0.3 * climb);
      // Grazing (near-horizon) light throws the longest, brightest path --
      // real Fresnel behaviour on water, and also just the better-looking case.
      glintUniforms.uGlintIntensity.value = 1.1 - 0.55 * Math.min(1, s.altitude / DISPLAY_ALTITUDE_CAP);
    } else if (moonUp) {
      if (lastMoonFraction === null || Math.abs(illum.fraction - lastMoonFraction) > MOON_TEXTURE_STEP) {
        moon.material.map.dispose();
        moon.material.map = moonTexture(illum.fraction);
        lastMoonFraction = illum.fraction;
      }
      const dir = directionFromAltAz(displayAlt(m.altitude), m.azimuth);
      moon.position.copy(dir).multiplyScalar(SKY_RADIUS);
      moon.material.rotation = -illum.brightLimbAngle;
      moon.material.opacity = 0.9;
      const scale = SKY_RADIUS * 0.1; // smaller and sharp -- "clear", not hazy
      moon.scale.set(scale, scale, 1);
      sun.material.opacity = 0;
      state.body = 'moon'; state.altitudeDeg = m.altitude * 180 / Math.PI; state.azimuthDeg = compassBearing(m.azimuth);

      glintUniforms.uGlintDir.value.copy(dir);
      glintUniforms.uGlintColor.value.set('#d7e2ff');
      // Keep the lunar glint on the river.
      glintUniforms.uGlintIntensity.value = (0.55 - 0.25 * Math.min(1, m.altitude / DISPLAY_ALTITUDE_CAP)) * illum.fraction;
    } else {
      sun.material.opacity = 0; moon.material.opacity = 0;
      state.body = 'none'; state.altitudeDeg = Math.max(s.altitude, m.altitude) * 180 / Math.PI; state.azimuthDeg = null;
      glintUniforms.uGlintIntensity.value = 0;
    }
    // The stylized facade glint has no occlusion test; keep its lunar
    // contribution off while retaining the glint on water.
    glintUniforms.uFacadeGlintIntensity.value = sunUp ? glintUniforms.uGlintIntensity.value : 0;
    state.moonFraction = illum.fraction; state.moonPhase = illum.phase;
    glintUniforms.uGlintTime.value = date.getTime() / 1000;

    if (directionalLight) {
      if (sunUp) {
        const dir = directionFromAltAz(s.altitude, s.azimuth);
        directionalLight.position.copy(dir).multiplyScalar(10000);
        const climb = Math.max(0.08, Math.sin(s.altitude));
        directionalLight.intensity = 1.2 + 1.7 * climb;
        directionalLight.color.setRGB(1, 0.86 + 0.14 * climb, 0.72 + 0.28 * climb);
        if (hemisphereLight) hemisphereLight.intensity = 1.25 + 0.8 * climb;
      } else {
        const dir = directionFromAltAz(moonUp ? m.altitude : 0.3, moonUp ? m.azimuth : s.azimuth);
        directionalLight.position.copy(dir).multiplyScalar(10000);
        // Keep ambient visibility and local city lights, but no
        // unshadowed lunar directional light leaking through the skyline.
        directionalLight.intensity = 0;
        directionalLight.color.set('#aebfe6');
        if (hemisphereLight) hemisphereLight.intensity = 0.55;
      }
    }
  }

  update(now);
  return { state, update, registerWater, registerBuildings, registerRoads };
}
