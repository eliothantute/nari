/**
 * FluidImage WebGL Engine
 * Exact 1:1 Implementation from Framer FluidImage (noble-follow-885614.framer.app)
 * Interactive WebGL with cursor fluid gradients, curl noise, 12-point smudge trail & FBM domain warp
 */

(function(global) {
  const TRAIL_LENGTH = 12;
  const NOISE_SIZE = 256;

  const PRESETS = {
    tropical: ['#0D9488', '#A78BFA', '#F472B6', '#FBBF24'],
    ocean: ['#0EA5E9', '#6366F1', '#14B8A6', '#818CF8'],
    sunset: ['#F97316', '#EF4444', '#A855F7', '#FBBF24'],
    neon: ['#22D3EE', '#A3E635', '#F472B6', '#FACC15'],
    forest: ['#16A34A', '#065F46', '#A3E635', '#D9F99D'],
    monochrome: ['#E5E5E5', '#A3A3A3', '#525252', '#171717']
  };

  function generateNoiseTexture() {
    const size = NOISE_SIZE;
    const data = new Uint8Array(size * size * 4);
    let seed = 48271;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = (y * size + x) * 4;
        const angle = rand() * Math.PI * 2;
        data[idx] = (((Math.cos(angle) * 0.5 + 0.5) * 255) | 0);
        data[idx + 1] = (((Math.sin(angle) * 0.5 + 0.5) * 255) | 0);
        data[idx + 2] = ((rand() * 255) | 0);
        data[idx + 3] = 255;
      }
    }
    return data;
  }

  const NOISE_DATA = generateNoiseTexture();

  const VERTEX_SHADER = `
attribute vec2 aPosition;
varying vec2 vUv;
void main() {
    vUv = aPosition * 0.5 + 0.5;
    gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

  const FRAGMENT_SHADER = `
precision highp float;

varying vec2 vUv;
uniform vec2 uResolution;
uniform vec2 uPointer;
uniform float uPointerActive;
uniform float uTime;
uniform sampler2D uTexture;
uniform sampler2D uNoiseTex;
uniform vec2 uImageSize;
uniform vec3 uEffectColor1;
uniform vec3 uEffectColor2;
uniform vec3 uEffectColor3;
uniform vec3 uEffectColor4;
uniform float uRadius;
uniform float uStrength;
uniform float uSpeed;
uniform float uDistortion;
uniform float uHueShift;
uniform float uColorCycle;
uniform float uShowGradient;
uniform vec2 uTrail[${TRAIL_LENGTH}];
uniform vec2 uTrailVelocities[${TRAIL_LENGTH}];
uniform float uTrailStrengths[${TRAIL_LENGTH}];
uniform float uBurst;
uniform vec2 uBurstPos;
uniform float uObjectFit;

vec2 computeImageUv(vec2 uv, vec2 containerSize, vec2 imageSize, float fitMode) {
    return uv;
}

vec4 sampleImageTexture(vec2 uv) {
    vec2 clampedUv = clamp(uv, 0.0, 1.0);
    vec4 sampleColor = texture2D(uTexture, clampedUv);
    float inBounds =
        step(0.0, uv.x) *
        step(uv.x, 1.0) *
        step(0.0, uv.y) *
        step(uv.y, 1.0);
    float alpha = sampleColor.a * inBounds;
    vec3 rgb = alpha > 0.0001
        ? sampleColor.rgb / max(sampleColor.a, 0.0001)
        : vec3(0.0);
    return vec4(rgb, alpha);
}

vec2 noiseTexCoord(vec2 i) {
    return (floor(mod(i, 256.0)) + 0.5) / 256.0;
}

float gnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    vec2 g00 = texture2D(uNoiseTex, noiseTexCoord(i)).rg * 2.0 - 1.0;
    vec2 g10 = texture2D(uNoiseTex, noiseTexCoord(i + vec2(1.0, 0.0))).rg * 2.0 - 1.0;
    vec2 g01 = texture2D(uNoiseTex, noiseTexCoord(i + vec2(0.0, 1.0))).rg * 2.0 - 1.0;
    vec2 g11 = texture2D(uNoiseTex, noiseTexCoord(i + vec2(1.0, 1.0))).rg * 2.0 - 1.0;
    return mix(mix(dot(g00, f - vec2(0.0, 0.0)),
                   dot(g10, f - vec2(1.0, 0.0)), u.x),
               mix(dot(g01, f - vec2(0.0, 1.0)),
                   dot(g11, f - vec2(1.0, 1.0)), u.x), u.y);
}

mat2 rot(float a) {
    float c = cos(a); float s = sin(a);
    return mat2(c, -s, s, c);
}

float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    mat2 r = rot(0.37);
    for (int i = 0; i < 4; i++) {
        v += a * gnoise(p);
        p = r * p * 2.0 + vec2(13.7, 31.5);
        a *= 0.5;
    }
    return v;
}

vec2 curlNoise(vec2 p) {
    float eps = 0.1;
    float n1 = gnoise(p + vec2(0.0, eps));
    float n2 = gnoise(p - vec2(0.0, eps));
    float n3 = gnoise(p + vec2(eps, 0.0));
    float n4 = gnoise(p - vec2(eps, 0.0));
    float dFdy = (n1 - n2) / (2.0 * eps);
    float dFdx = (n3 - n4) / (2.0 * eps);
    return vec2(dFdy, -dFdx);
}

vec3 rgb2hsl(vec3 c) {
    float mx = max(max(c.r, c.g), c.b);
    float mn = min(min(c.r, c.g), c.b);
    float l = (mx + mn) * 0.5;
    if (mx == mn) return vec3(0.0, 0.0, l);
    float d = mx - mn;
    float s = l > 0.5 ? d / (2.0 - mx - mn) : d / (mx + mn);
    float h;
    if (mx == c.r) {
        h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
    } else if (mx == c.g) {
        h = (c.b - c.r) / d + 2.0;
    } else {
        h = (c.r - c.g) / d + 4.0;
    }
    h /= 6.0;
    return vec3(h, s, l);
}

float hue2rgb(float p, float q, float t) {
    if (t < 0.0) t += 1.0;
    if (t > 1.0) t -= 1.0;
    if (t < 1.0/6.0) return p + (q - p) * 6.0 * t;
    if (t < 1.0/2.0) return q;
    if (t < 2.0/3.0) return p + (q - p) * (2.0/3.0 - t) * 6.0;
    return p;
}

vec3 hsl2rgb(vec3 hsl) {
    if (hsl.y == 0.0) return vec3(hsl.z);
    float q = hsl.z < 0.5 ? hsl.z * (1.0 + hsl.y) : hsl.z + hsl.y - hsl.z * hsl.y;
    float p = 2.0 * hsl.z - q;
    return vec3(
        hue2rgb(p, q, hsl.x + 1.0/3.0),
        hue2rgb(p, q, hsl.x),
        hue2rgb(p, q, hsl.x - 1.0/3.0)
    );
}

void main() {
    float aspect = uResolution.x / uResolution.y;
    vec2 uv = vUv;
    vec2 pAspect = vec2(uv.x * aspect, uv.y);
    vec2 pointerAspect = vec2(uPointer.x * aspect, uPointer.y);

    float t = uTime * uSpeed * 0.8;
    vec2 flow = curlNoise(pAspect * 2.5 + vec2(t * 0.3, t * 0.2)) * 0.08 * uDistortion;

    vec2 totalSmudge = vec2(0.0);
    vec2 totalSwirl = vec2(0.0);
    float totalWeight = 0.0;
    float pointerRadius = uRadius * 1.6;

    for (int i = 0; i < ${TRAIL_LENGTH}; i++) {
        vec2 trailAspect = vec2(uTrail[i].x * aspect, uTrail[i].y);
        vec2 toTrail = pAspect - trailAspect;
        float d = length(toTrail);
        float radius = uRadius * (1.0 + float(i) * 0.06);
        float w = smoothstep(radius, 0.0, d) * uTrailStrengths[i];
        if (w > 0.001) {
            vec2 vel = uTrailVelocities[i];
            float velSpeed = length(vel);
            vec2 velDir = velSpeed > 0.001 ? vel / velSpeed : vec2(0.0);
            float alongVel = dot(toTrail, velDir);
            float velAsymm = 1.0 + clamp(alongVel * 2.0, -0.5, 1.0);
            totalSmudge += vel * w * velAsymm * 3.0;
            vec2 tangent = vec2(-toTrail.y, toTrail.x);
            float distWeight = exp(-d * 4.0 / radius);
            totalSwirl += tangent * w * distWeight * 2.0;
            totalWeight += w;
        }
    }

    vec2 mouseOffset = pAspect - pointerAspect;
    float mouseDistance = length(mouseOffset);
    vec2 mouseDirection = mouseDistance > 0.0001 ? mouseOffset / mouseDistance : vec2(0.0);

    float cursorFactor = smoothstep(pointerRadius, 0.0, mouseDistance);
    float cursorPeak = exp(-mouseDistance * mouseDistance / (2.0 * pointerRadius * pointerRadius * 0.25));
    float cursorPulse = sin(uTime * 4.0) * 0.04;
    float cursorCombined = clamp(cursorFactor * 0.7 + cursorPeak * 0.3 + cursorPulse * cursorFactor, 0.0, 1.0);
    vec2 cursorForce = mouseDirection * cursorCombined * 0.08 * uStrength;

    vec2 burstAspect = vec2(uBurstPos.x * aspect, uBurstPos.y);
    vec2 toBurst = pAspect - burstAspect;
    float burstDist = length(toBurst);
    float burstRadius = uBurst * uRadius * 3.0;
    float burstRing = smoothstep(0.08, 0.0, abs(burstDist - burstRadius)) * uBurst;
    vec2 burstDir = burstDist > 0.0001 ? toBurst / burstDist : vec2(0.0);
    vec2 burstForce = burstDir * burstRing * 0.25 * uStrength;
    vec2 burstSwirl = vec2(-toBurst.y, toBurst.x) * burstRing * 0.15;

    vec2 totalDisplacement = (totalSmudge * 0.8 + totalSwirl * 0.4) * uStrength * uPointerActive
                           + cursorForce * uPointerActive
                           + flow
                           + burstForce + burstSwirl;

    float primaryWeight = uTrailStrengths[0];
    float orbHalo = smoothstep(pointerRadius * 1.5, 0.0, mouseDistance) * uPointerActive * primaryWeight;
    float orbCore = exp(-mouseDistance * mouseDistance / (2.0 * pointerRadius * pointerRadius * 0.18)) * uPointerActive * primaryWeight;
    float orbRing = smoothstep(0.06, 0.0, abs(mouseDistance - pointerRadius * 0.6)) * uPointerActive * primaryWeight;
    float orbPulse = sin(uTime * 5.0 - mouseDistance * 10.0) * 0.5 + 0.5;

    vec2 imageUv = computeImageUv(uv, uResolution, uImageSize, uObjectFit);
    vec4 origSample = sampleImageTexture(imageUv);
    float inImage = origSample.a > 0.01 ? 1.0 : 0.0;

    vec2 smudgedImageUv = computeImageUv(uv - totalDisplacement * 0.6, uResolution, uImageSize, uObjectFit);
    vec4 smudgedColor = sampleImageTexture(smudgedImageUv);

    vec2 domainWarp = vec2(
        fbm(pAspect * 3.0 + totalDisplacement * 2.0 + vec2(t * 0.2, 0.0)),
        fbm(pAspect * 3.0 + totalDisplacement * 2.0 + vec2(0.0, t * 0.2))
    );

    float primaryMotion = clamp(totalWeight * 0.5 + cursorCombined * 0.6 + uBurst * 0.8, 0.0, 1.0);
    float ambientNoise = fbm(pAspect * 2.0 + domainWarp * 1.5 + vec2(t * 0.15));
    float activeNoise = fbm(pAspect * 4.0 + domainWarp * 2.5 + vec2(t * 0.4));
    float combinedNoise = mix(ambientNoise, activeNoise, primaryMotion);

    float trailInfluence = clamp(totalWeight * 0.6, 0.0, 1.0);
    float burstInfluence = uBurst * smoothstep(burstRadius + 0.2, 0.0, burstDist);
    float influence = clamp(trailInfluence + cursorCombined * 0.4 + burstInfluence, 0.0, 1.0);
    float combined = mix(combinedNoise * 0.3, combinedNoise * 1.2, influence);

    vec3 hsl = rgb2hsl(smudgedColor.rgb);
    hsl.x = fract(hsl.x + uHueShift * combined * 0.5 + uTime * uColorCycle * 0.05);
    vec3 hueShifted = hsl2rgb(hsl);

    float colorProgress = fract(combined * 1.2 + uTime * uColorCycle);
    float colorT = colorProgress * 3.0;

    vec3 c1 = uEffectColor1;
    vec3 c2 = uEffectColor2;
    vec3 c3 = uEffectColor3;
    vec3 c4 = uEffectColor4;

    float tCycle = uTime * uColorCycle;
    vec3 cycledColor1 = mix(c1, c2, sin(tCycle) * 0.5 + 0.5);
    vec3 cycledColor2 = mix(c2, c3, sin(tCycle + 1.57) * 0.5 + 0.5);
    vec3 cycledColor3 = mix(c3, c4, sin(tCycle + 3.14) * 0.5 + 0.5);
    vec3 cycledColor4 = mix(c4, c1, sin(tCycle + 4.71) * 0.5 + 0.5);

    vec3 gradientColor;
    float seg = clamp(colorT, 0.0, 3.0);
    if (seg < 1.0) {
        gradientColor = mix(cycledColor1, cycledColor2, seg);
    } else if (seg < 2.0) {
        gradientColor = mix(cycledColor2, cycledColor3, seg - 1.0);
    } else {
        gradientColor = mix(cycledColor3, cycledColor4, seg - 2.0);
    }

    float swirlMag = length(totalSwirl * uPointerActive + burstSwirl);
    float distortionBand = clamp(orbRing * 1.15 + burstInfluence * 0.5 + trailInfluence * 0.35, 0.0, 1.0);
    float gradientMix = smoothstep(0.02, 0.72, combined * 0.28 + orbHalo * 0.3 + swirlMag * 1.4) * uShowGradient;
    vec3 premiumGradientColor = mix(gradientColor, vec3(1.0), 0.18 * orbCore + 0.06 * orbPulse);
    vec3 premiumHueShifted = mix(hueShifted, smudgedColor.rgb, 0.18 * (1.0 - orbHalo));
    vec3 effectColor = mix(premiumHueShifted, premiumGradientColor, gradientMix * (0.78 + 0.22 * orbHalo));

    float imageMix = clamp(combined * 0.55 + orbCore * 0.2 + orbHalo * 0.15, 0.0, 1.0);
    vec3 imageBlend = mix(smudgedColor.rgb, effectColor, imageMix);
    vec3 finalColor = mix(effectColor, imageBlend, inImage);
    float glow = clamp(orbHalo * 0.55 + orbCore * orbCore * 0.45 + distortionBand * 0.18, 0.0, 1.0);
    vec3 outerGlowColor = mix(gradientColor, premiumGradientColor, 0.5);
    finalColor += outerGlowColor * glow * (0.16 + 0.08 * orbPulse) * uShowGradient;
    finalColor += vec3(1.0) * orbCore * 0.045 * uShowGradient;
    finalColor = clamp(finalColor, 0.0, 1.0);

    float alpha = inImage * smudgedColor.a;
    gl_FragColor = vec4(finalColor, clamp(alpha, 0.0, 1.0));
}
`;

  function compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(info);
    }
    return shader;
  }

  function createProgram(gl, vertexSource, fragmentSource) {
    const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
    const program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program));
    }
    return program;
  }

  function hexToRgb01(hex) {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const num = parseInt(hex, 16);
    return [(num >> 16 & 255) / 255, (num >> 8 & 255) / 255, (num & 255) / 255];
  }

  class FluidImageEffect {
    constructor(options = {}) {
      this.container = typeof options.container === 'string' 
        ? document.querySelector(options.container) 
        : options.container;

      if (!this.container) return;

      this.textLines = options.textLines || ['RESTEZ CONCENTRÉ.', 'LAISSEZ VOTRE VOIX AGIR.'];
      const presetColors = PRESETS[options.preset || 'tropical'] || PRESETS.tropical;
      this.colors = options.customColors && options.customColors.length ? options.customColors : (options.colors || presetColors);
      
      this.showGradient = options.showGradient !== undefined ? options.showGradient : true;
      this.radius = options.radius !== undefined ? options.radius : 0.14;
      this.strength = options.strength !== undefined ? options.strength : 0.88;
      this.speed = options.speed !== undefined ? options.speed : 0.65;
      this.distortion = options.distortion !== undefined ? options.distortion : 0.22;
      this.hueShift = options.hueShift !== undefined ? options.hueShift : 0.08;
      this.colorCycle = options.colorCycle !== undefined ? options.colorCycle : 0.05;
      this.persistence = options.persistence !== undefined ? options.persistence : 0.97;
      this.pointerSmooth = options.pointerSmooth !== undefined ? options.pointerSmooth : 0.22;

      this.trail = [];
      this.trailVel = [];
      this.trailStr = [];
      for (let i = 0; i < TRAIL_LENGTH; i++) {
        this.trail.push({ x: 0.5, y: 0.5 });
        this.trailVel.push({ x: 0, y: 0 });
        this.trailStr.push(0);
      }

      this.pointer = { x: 0.5, y: 0.5 };
      this.targetPointer = { x: 0.5, y: 0.5 };
      this.pointerActive = 0;
      this.targetPointerActive = 0;
      this.burst = 0;
      this.burstPos = { x: 0.5, y: 0.5 };
      this.time = 0;
      this.imageSize = { w: 1, h: 1 };

      this.init();
    }

    init() {
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'fluid-image-canvas';
      this.canvas.style.position = 'absolute';
      this.canvas.style.top = '0';
      this.canvas.style.left = '0';
      this.canvas.style.width = '100%';
      this.canvas.style.height = '100%';
      this.canvas.style.display = 'block';
      this.canvas.style.pointerEvents = 'auto';
      this.container.style.position = this.container.style.position || 'relative';
      this.container.appendChild(this.canvas);

      this.gl = this.canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: false });
      if (!this.gl) return;

      const gl = this.gl;
      this.program = createProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER);
      gl.useProgram(this.program);

      const vertices = new Float32Array([-1, -1, 3, -1, -1, 3]);
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

      const posLoc = gl.getAttribLocation(this.program, 'aPosition');
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

      this.uniforms = {
        uResolution: gl.getUniformLocation(this.program, 'uResolution'),
        uPointer: gl.getUniformLocation(this.program, 'uPointer'),
        uPointerActive: gl.getUniformLocation(this.program, 'uPointerActive'),
        uTime: gl.getUniformLocation(this.program, 'uTime'),
        uTexture: gl.getUniformLocation(this.program, 'uTexture'),
        uNoiseTex: gl.getUniformLocation(this.program, 'uNoiseTex'),
        uImageSize: gl.getUniformLocation(this.program, 'uImageSize'),
        uEffectColor1: gl.getUniformLocation(this.program, 'uEffectColor1'),
        uEffectColor2: gl.getUniformLocation(this.program, 'uEffectColor2'),
        uEffectColor3: gl.getUniformLocation(this.program, 'uEffectColor3'),
        uEffectColor4: gl.getUniformLocation(this.program, 'uEffectColor4'),
        uRadius: gl.getUniformLocation(this.program, 'uRadius'),
        uStrength: gl.getUniformLocation(this.program, 'uStrength'),
        uSpeed: gl.getUniformLocation(this.program, 'uSpeed'),
        uDistortion: gl.getUniformLocation(this.program, 'uDistortion'),
        uHueShift: gl.getUniformLocation(this.program, 'uHueShift'),
        uColorCycle: gl.getUniformLocation(this.program, 'uColorCycle'),
        uShowGradient: gl.getUniformLocation(this.program, 'uShowGradient'),
        uTrail: gl.getUniformLocation(this.program, 'uTrail'),
        uTrailVelocities: gl.getUniformLocation(this.program, 'uTrailVelocities'),
        uTrailStrengths: gl.getUniformLocation(this.program, 'uTrailStrengths'),
        uBurst: gl.getUniformLocation(this.program, 'uBurst'),
        uBurstPos: gl.getUniformLocation(this.program, 'uBurstPos'),
        uObjectFit: gl.getUniformLocation(this.program, 'uObjectFit'),
      };

      // Texture setup
      this.texture = gl.createTexture();
      this.updateTextTexture();

      if (document.fonts) {
        document.fonts.ready.then(() => this.updateTextTexture());
      }

      // Noise texture
      this.noiseTex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.noiseTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, NOISE_SIZE, NOISE_SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, NOISE_DATA);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

      this.setupEvents();
      this.resize();
      this.animate();
    }

    updateTextTexture() {
      const gl = this.gl;
      if (!gl) return;

      const w = Math.max(800, (this.canvas.width || 1200));
      const h = Math.max(260, (this.canvas.height || 400));

      const offscreen = document.createElement('canvas');
      offscreen.width = w;
      offscreen.height = h;
      const ctx = offscreen.getContext('2d');
      ctx.clearRect(0, 0, w, h);

      // Massive, grand, ultra-bold typography (EN GROS!)
      const fontSize = Math.floor(h * 0.40);
      ctx.font = `900 ${fontSize}px 'Anybody', 'Space Grotesk', -apple-system, sans-serif`;
      ctx.fillStyle = '#000000';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';

      const line1 = this.textLines[0] || 'RESTEZ CONCENTRÉ.';
      const line2 = this.textLines[1] || 'LAISSEZ VOTRE VOIX AGIR.';

      const y1 = h * 0.28;
      const y2 = h * 0.74;

      ctx.fillText(line1, 4, y1);
      ctx.fillText(line2, 4, y2);

      this.imageSize = { w, h };

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, offscreen);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    }

    setupEvents() {
      const target = this.canvas;
      const updatePointer = (clientX, clientY) => {
        const rect = target.getBoundingClientRect();
        const x = (clientX - rect.left) / rect.width;
        const y = 1.0 - ((clientY - rect.top) / rect.height);
        this.targetPointer = { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
        this.targetPointerActive = 1;
      };

      target.addEventListener('mousemove', (e) => updatePointer(e.clientX, e.clientY));
      target.addEventListener('mouseenter', () => { this.targetPointerActive = 1; });
      target.addEventListener('mouseleave', () => { this.targetPointerActive = 0; });
      
      target.addEventListener('touchmove', (e) => {
        if (e.touches.length > 0) updatePointer(e.touches[0].clientX, e.touches[0].clientY);
      });
      target.addEventListener('click', (e) => {
        const rect = target.getBoundingClientRect();
        this.burst = 1.0;
        this.burstPos = {
          x: (e.clientX - rect.left) / rect.width,
          y: 1.0 - ((e.clientY - rect.top) / rect.height)
        };
      });

      window.addEventListener('resize', () => this.resize());
    }

    resize() {
      if (!this.container || !this.canvas) return;
      const w = this.container.clientWidth || 640;
      const h = this.container.clientHeight || 190;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = w * dpr;
      this.canvas.height = h * dpr;
      this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      this.updateTextTexture();
    }

    animate() {
      const gl = this.gl;
      if (!gl) return;

      this.time += 0.016;

      this.pointer.x += (this.targetPointer.x - this.pointer.x) * this.pointerSmooth;
      this.pointer.y += (this.targetPointer.y - this.pointer.y) * this.pointerSmooth;
      this.pointerActive += (this.targetPointerActive - this.pointerActive) * 0.1;

      const p0 = this.trail[0];
      const vx = (this.pointer.x - p0.x) * 12.0;
      const vy = (this.pointer.y - p0.y) * 12.0;
      this.trail[0] = { x: this.pointer.x, y: this.pointer.y };
      this.trailVel[0] = { x: vx, y: vy };
      this.trailStr[0] = this.pointerActive;

      for (let i = 1; i < TRAIL_LENGTH; i++) {
        const prev = this.trail[i - 1];
        const curr = this.trail[i];
        const decay = Math.pow(this.persistence, i);
        const smooth = 0.28 / (1.0 + i * 0.12);
        curr.x += (prev.x - curr.x) * smooth;
        curr.y += (prev.y - curr.y) * smooth;
        this.trailVel[i].x = (prev.x - curr.x) * 8.0 * decay;
        this.trailVel[i].y = (prev.y - curr.y) * 8.0 * decay;
        this.trailStr[i] = this.trailStr[i - 1] * this.persistence;
      }

      if (this.burst > 0) this.burst = Math.max(0, this.burst - 0.025);

      gl.useProgram(this.program);

      gl.uniform2f(this.uniforms.uResolution, this.canvas.width, this.canvas.height);
      gl.uniform2f(this.uniforms.uPointer, this.pointer.x, this.pointer.y);
      gl.uniform1f(this.uniforms.uPointerActive, this.pointerActive);
      gl.uniform1f(this.uniforms.uTime, this.time);
      gl.uniform1i(this.uniforms.uTexture, 0);
      gl.uniform1i(this.uniforms.uNoiseTex, 1);
      gl.uniform2f(this.uniforms.uImageSize, this.imageSize.w, this.imageSize.h);

      const c1 = hexToRgb01(this.colors[0] || '#0D9488');
      const c2 = hexToRgb01(this.colors[1] || '#A78BFA');
      const c3 = hexToRgb01(this.colors[2] || '#F472B6');
      const c4 = hexToRgb01(this.colors[3] || '#FBBF24');
      gl.uniform3f(this.uniforms.uEffectColor1, c1[0], c1[1], c1[2]);
      gl.uniform3f(this.uniforms.uEffectColor2, c2[0], c2[1], c2[2]);
      gl.uniform3f(this.uniforms.uEffectColor3, c3[0], c3[1], c3[2]);
      gl.uniform3f(this.uniforms.uEffectColor4, c4[0], c4[1], c4[2]);

      gl.uniform1f(this.uniforms.uRadius, this.radius);
      gl.uniform1f(this.uniforms.uStrength, this.strength);
      gl.uniform1f(this.uniforms.uSpeed, this.speed);
      gl.uniform1f(this.uniforms.uDistortion, this.distortion);
      gl.uniform1f(this.uniforms.uHueShift, this.hueShift);
      gl.uniform1f(this.uniforms.uColorCycle, this.colorCycle);
      gl.uniform1f(this.uniforms.uShowGradient, this.showGradient ? 1.0 : 0.0);
      gl.uniform1f(this.uniforms.uBurst, this.burst);
      gl.uniform2f(this.uniforms.uBurstPos, this.burstPos.x, this.burstPos.y);
      gl.uniform1f(this.uniforms.uObjectFit, 0.0);

      const trailFlat = [];
      const trailVelFlat = [];
      const trailStrFlat = [];
      for (let i = 0; i < TRAIL_LENGTH; i++) {
        trailFlat.push(this.trail[i].x, this.trail[i].y);
        trailVelFlat.push(this.trailVel[i].x, this.trailVel[i].y);
        trailStrFlat.push(this.trailStr[i]);
      }
      gl.uniform2fv(this.uniforms.uTrail, new Float32Array(trailFlat));
      gl.uniform2fv(this.uniforms.uTrailVelocities, new Float32Array(trailVelFlat));
      gl.uniform1fv(this.uniforms.uTrailStrengths, new Float32Array(trailStrFlat));

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      requestAnimationFrame(() => this.animate());
    }
  }

  global.FluidImageEffect = FluidImageEffect;
})(window);
