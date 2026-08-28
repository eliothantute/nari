/**
 * WebGL Navier-Stokes Fluid Simulation Engine (Liquid Hover Effect)
 * Authentic recreation of the fluid distortion animation from fuel.framer.website
 * Adapted for NARI OS with custom cybernetic glow, responsive scaling and multi-target support.
 */

class LiquidHoverFluidSimulation {
  constructor(options = {}) {
    this.container = typeof options.container === 'string' 
      ? document.querySelector(options.container) 
      : options.container;
    
    if (!this.container) {
      console.warn('LiquidHoverFluidSimulation: Invalid container provided.');
      return;
    }

    this.imageSrc = options.imageSrc || null;
    this.resolution = options.resolution || 5;
    this.cursorSize = options.cursorSize !== undefined ? options.cursorSize : 0.6;
    this.cursorPower = options.cursorPower !== undefined ? options.cursorPower : 0.7;
    this.distortionPower = options.distortionPower !== undefined ? options.distortionPower : 0.55;
    this.interactiveTarget = options.interactiveTarget || window;

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'liquid-fluid-canvas';
    this.canvas.style.position = 'absolute';
    this.canvas.style.top = '-10%';
    this.canvas.style.left = '-10%';
    this.canvas.style.width = '120%';
    this.canvas.style.height = '120%';
    this.canvas.style.pointerEvents = 'none';
    this.canvas.style.overflow = 'hidden';
    this.canvas.style.zIndex = options.zIndex || '0';
    this.canvas.style.opacity = options.opacity !== undefined ? options.opacity : '1';
    
    this.container.style.position = this.container.style.position || 'relative';
    this.container.appendChild(this.canvas);

    this.gl = this.canvas.getContext('webgl', { alpha: true, antialias: false, depth: false });
    if (!this.gl) {
      console.warn('WebGL not supported for Liquid Hover.');
      return;
    }

    const gl = this.gl;
    this.extFloat = gl.getExtension('OES_texture_float');
    this.extLinear = gl.getExtension('OES_texture_float_linear');
    gl.clearColor(0, 0, 0, 0);

    this.config = {
      cursorSize: 0.5 + (this.cursorSize - 0.1) * 4.5 / 0.9,
      cursorPower: 5 + (this.cursorPower - 0.1) * 45 / 0.9,
      distortionPower: this.distortionPower,
      scaleFactor: 1.2
    };

    this.pointer = {
      x: 0.5 * this.container.clientWidth,
      y: 0.5 * this.container.clientHeight,
      dx: 0,
      dy: 0,
      moved: false,
      isHovered: false
    };

    this.simSize = { w: 0, h: 0 };
    this.imageRatio = 1;
    this.imageTexture = null;
    this.animationFrameId = null;

    this.initShaders();
    this.initBuffers();
    this.initEvents();

    if (this.imageSrc) {
      this.loadImage(this.imageSrc);
    } else {
      this.createProceduralTexture();
    }

    this.resize();
    this.start();
  }

  initShaders() {
    const gl = this.gl;
    const baseVertexShader = `
      precision highp float;
      attribute vec2 a_position;
      varying vec2 vUv;
      varying vec2 vL;
      varying vec2 vR;
      varying vec2 vT;
      varying vec2 vB;
      uniform vec2 u_texel;

      void main () {
        vUv = 0.5 * (a_position + 1.0);
        vL = vUv - vec2(u_texel.x, 0.0);
        vR = vUv + vec2(u_texel.x, 0.0);
        vT = vUv + vec2(0.0, u_texel.y);
        vB = vUv - vec2(0.0, u_texel.y);
        gl_Position = vec4(a_position, 0.0, 1.0);
      }
    `;

    const splatShader = `
      precision highp float;
      precision highp sampler2D;
      varying vec2 vUv;
      uniform sampler2D u_input_texture;
      uniform float u_ratio;
      uniform vec3 u_point_value;
      uniform vec2 u_point;
      uniform float u_point_size;

      void main () {
        vec2 p = vUv - u_point.xy;
        p.x *= u_ratio;
        vec3 splat = 0.6 * pow(2.0, -dot(p, p) / u_point_size) * u_point_value;
        vec3 base = texture2D(u_input_texture, vUv).xyz;
        gl_FragColor = vec4(base + splat, 1.0);
      }
    `;

    const divergenceShader = `
      precision highp float;
      precision highp sampler2D;
      varying highp vec2 vUv;
      varying highp vec2 vL;
      varying highp vec2 vR;
      varying highp vec2 vT;
      varying highp vec2 vB;
      uniform sampler2D u_velocity_texture;

      void main () {
        float L = texture2D(u_velocity_texture, vL).x;
        float R = texture2D(u_velocity_texture, vR).x;
        float T = texture2D(u_velocity_texture, vT).y;
        float B = texture2D(u_velocity_texture, vB).y;
        float div = 0.25 * (R - L + T - B);
        gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
      }
    `;

    const pressureShader = `
      precision highp float;
      precision highp sampler2D;
      varying highp vec2 vUv;
      varying highp vec2 vL;
      varying highp vec2 vR;
      varying highp vec2 vT;
      varying highp vec2 vB;
      uniform sampler2D u_pressure_texture;
      uniform sampler2D u_divergence_texture;

      void main () {
        float L = texture2D(u_pressure_texture, vL).x;
        float R = texture2D(u_pressure_texture, vR).x;
        float T = texture2D(u_pressure_texture, vT).x;
        float B = texture2D(u_pressure_texture, vB).x;
        float divergence = texture2D(u_divergence_texture, vUv).x;
        float pressure = (L + R + B + T - divergence) * 0.25;
        gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
      }
    `;

    const gradientSubtractShader = `
      precision highp float;
      precision highp sampler2D;
      varying highp vec2 vUv;
      varying highp vec2 vL;
      varying highp vec2 vR;
      varying highp vec2 vT;
      varying highp vec2 vB;
      uniform sampler2D u_pressure_texture;
      uniform sampler2D u_velocity_texture;

      void main () {
        float L = texture2D(u_pressure_texture, vL).x;
        float R = texture2D(u_pressure_texture, vR).x;
        float T = texture2D(u_pressure_texture, vT).x;
        float B = texture2D(u_pressure_texture, vB).x;
        vec2 velocity = texture2D(u_velocity_texture, vUv).xy;
        velocity.xy -= vec2(R - L, T - B);
        gl_FragColor = vec4(velocity, 0.0, 1.0);
      }
    `;

    const advectionShader = `
      precision highp float;
      precision highp sampler2D;
      varying vec2 vUv;
      uniform sampler2D u_velocity_texture;
      uniform sampler2D u_input_texture;
      uniform vec2 u_texel;
      uniform vec2 u_output_textel;
      uniform float u_dt;
      uniform float u_dissipation;

      vec4 bilerp (sampler2D sam, vec2 uv, vec2 tsize) {
        vec2 st = uv / tsize - 0.5;
        vec2 iuv = floor(st);
        vec2 fuv = fract(st);
        vec4 a = texture2D(sam, (iuv + vec2(0.5, 0.5)) * tsize);
        vec4 b = texture2D(sam, (iuv + vec2(1.5, 0.5)) * tsize);
        vec4 c = texture2D(sam, (iuv + vec2(0.5, 1.5)) * tsize);
        vec4 d = texture2D(sam, (iuv + vec2(1.5, 1.5)) * tsize);
        return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);
      }

      void main () {
        vec2 coord = vUv - u_dt * bilerp(u_velocity_texture, vUv, u_texel).xy * u_texel;
        vec4 velocity = bilerp(u_input_texture, coord, u_output_textel);
        gl_FragColor = u_dissipation * velocity;
      }
    `;

    const outputShader = `
      precision highp float;
      precision highp sampler2D;
      varying vec2 vUv;
      uniform float u_ratio;
      uniform float u_img_ratio;
      uniform float u_disturb_power;
      uniform sampler2D u_output_texture;
      uniform sampler2D u_velocity_texture;
      uniform sampler2D u_text_texture;
      uniform vec2 u_point;
      uniform float u_canvas_scale;
      uniform float u_inner_scale;

      vec2 get_img_uv() {
        vec2 uv = vUv - 0.5;
        uv *= u_canvas_scale;
        uv /= u_inner_scale;

        float containerAspect = u_ratio;
        float imageAspect = u_img_ratio;
        vec2 scale = vec2(1.0);
        if (containerAspect > imageAspect) {
          scale.y = imageAspect / containerAspect;
        } else {
          scale.x = containerAspect / imageAspect;
        }
        uv *= scale;
        return uv + 0.5;
      }

      vec2 get_frame_uv() {
        vec2 uv = vUv - 0.5;
        uv *= u_canvas_scale;
        uv /= u_inner_scale;
        return uv + 0.5;
      }

      float get_img_frame_alpha(vec2 uv, float img_frame_width) {
        float img_frame_alpha = smoothstep(0.0, img_frame_width, uv.x) * smoothstep(1.0, 1.0 - img_frame_width, uv.x);
        img_frame_alpha *= smoothstep(0.0, img_frame_width, uv.y) * smoothstep(1.0, 1.0 - img_frame_width, uv.y);
        return img_frame_alpha;
      }

      vec3 sample_image_smooth(vec2 uv) {
        vec2 uvc = clamp(uv, 0.0, 1.0);
        vec3 base = texture2D(u_text_texture, vec2(uvc.x, 1.0 - uvc.y)).rgb;

        float yBelow = step(uv.y, 0.0);
        float yAbove = step(1.0, uv.y);
        float xLeft = step(uv.x, 0.0);
        float xRight = step(1.0, uv.x);
        float outOfBounds = max(max(yBelow, yAbove), max(xLeft, xRight));

        if (outOfBounds > 0.0) {
          float d = 0.002;
          vec3 sum = vec3(0.0);
          sum += texture2D(u_text_texture, vec2(clamp(uvc.x - d, 0.0, 1.0), 1.0 - clamp(uvc.y - d, 0.0, 1.0))).rgb;
          sum += texture2D(u_text_texture, vec2(clamp(uvc.x, 0.0, 1.0), 1.0 - clamp(uvc.y - d, 0.0, 1.0))).rgb;
          sum += texture2D(u_text_texture, vec2(clamp(uvc.x + d, 0.0, 1.0), 1.0 - clamp(uvc.y - d, 0.0, 1.0))).rgb;
          sum += texture2D(u_text_texture, vec2(clamp(uvc.x - d, 0.0, 1.0), 1.0 - clamp(uvc.y, 0.0, 1.0))).rgb;
          sum += texture2D(u_text_texture, vec2(clamp(uvc.x, 0.0, 1.0), 1.0 - clamp(uvc.y, 0.0, 1.0))).rgb;
          sum += texture2D(u_text_texture, vec2(clamp(uvc.x + d, 0.0, 1.0), 1.0 - clamp(uvc.y, 0.0, 1.0))).rgb;
          sum += texture2D(u_text_texture, vec2(clamp(uvc.x - d, 0.0, 1.0), 1.0 - clamp(uvc.y + d, 0.0, 1.0))).rgb;
          sum += texture2D(u_text_texture, vec2(clamp(uvc.x, 0.0, 1.0), 1.0 - clamp(uvc.y + d, 0.0, 1.0))).rgb;
          sum += texture2D(u_text_texture, vec2(clamp(uvc.x + d, 0.0, 1.0), 1.0 - clamp(uvc.y + d, 0.0, 1.0))).rgb;
          base = sum / 9.0;
        }
        return base;
      }

      void main () {
        float offset = texture2D(u_output_texture, vUv).r;
        vec2 velocity = texture2D(u_velocity_texture, vUv).xy;
        velocity += 0.001;

        vec2 img_uv = get_img_uv();
        img_uv -= u_disturb_power * normalize(velocity) * offset;
        img_uv -= u_disturb_power * normalize(velocity) * offset;

        vec2 frame_uv = get_frame_uv();
        frame_uv -= u_disturb_power * normalize(velocity) * offset;

        vec3 img = sample_image_smooth(img_uv);
        float opacity = get_img_frame_alpha(frame_uv, 0.002);
        gl_FragColor = vec4(img * opacity, opacity);
      }
    `;

    this.programs = {
      splat: this.createProgram(baseVertexShader, splatShader),
      divergence: this.createProgram(baseVertexShader, divergenceShader),
      pressure: this.createProgram(baseVertexShader, pressureShader),
      gradientSubtract: this.createProgram(baseVertexShader, gradientSubtractShader),
      advection: this.createProgram(baseVertexShader, advectionShader),
      output: this.createProgram(baseVertexShader, outputShader)
    };
  }

  createShader(source, type) {
    const gl = this.gl;
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(shader) || 'Shader compile error';
      gl.deleteShader(shader);
      throw new Error(info);
    }
    return shader;
  }

  createProgram(vertexSrc, fragmentSrc) {
    const gl = this.gl;
    const program = gl.createProgram();
    const vs = this.createShader(vertexSrc, gl.VERTEX_SHADER);
    const fs = this.createShader(fragmentSrc, gl.FRAGMENT_SHADER);
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.bindAttribLocation(program, 0, 'a_position');
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(program) || 'Program link error';
      throw new Error(info);
    }

    const uniforms = {};
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i++) {
      const uniform = gl.getActiveUniform(program, i);
      if (uniform) {
        uniforms[uniform.name] = gl.getUniformLocation(program, uniform.name);
      }
    }
    return { program, uniforms };
  }

  createFBO(w, h) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, w, h, 0, gl.RGB, gl.FLOAT, null);

    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.viewport(0, 0, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT);

    return {
      fbo,
      width: w,
      height: h,
      attach(unit) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        return unit;
      }
    };
  }

  createDoubleFBO(w, h) {
    let fboA = this.createFBO(w, h);
    let fboB = this.createFBO(w, h);
    return {
      width: w,
      height: h,
      texelSizeX: 1 / w,
      texelSizeY: 1 / h,
      read: () => fboA,
      write: () => fboB,
      swap: () => {
        const temp = fboA;
        fboA = fboB;
        fboB = temp;
      }
    };
  }

  initBuffers() {
    const gl = this.gl;
    this.quadPosBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadPosBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);

    this.quadElemBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.quadElemBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
  }

  renderQuad(targetFbo = null) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadPosBuffer);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.quadElemBuffer);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(0);

    if (targetFbo === null) {
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    } else {
      gl.viewport(0, 0, targetFbo.width, targetFbo.height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, targetFbo.fbo);
    }

    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
  }

  initFBOs() {
    const { w, h } = this.simSize;
    if (w <= 0 || h <= 0) return;
    this.density = this.createDoubleFBO(w, h);
    this.velocity = this.createDoubleFBO(w, h);
    this.divergence = this.createFBO(w, h);
    this.pressure = this.createDoubleFBO(w, h);
  }

  resize() {
    const gl = this.gl;
    const cw = this.container.clientWidth || window.innerWidth;
    const ch = this.container.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const h = this.config.scaleFactor;

    this.canvas.width = Math.max(2, Math.round(cw * h * dpr));
    this.canvas.height = Math.max(2, Math.round(ch * h * dpr));
    this.canvas.style.width = `${cw * h}px`;
    this.canvas.style.height = `${ch * h}px`;

    const aspect = (cw * h) / Math.max(1, (ch * h));
    const baseRes = 128 + (this.resolution - 1) * 384 / 9;
    this.simSize.w = Math.round(baseRes * aspect);
    this.simSize.h = Math.round(baseRes);

    this.initFBOs();
    if (this.imageTexture) {
      gl.bindTexture(gl.TEXTURE_2D, this.imageTexture);
    }
  }

  loadImage(url) {
    const gl = this.gl;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = url;
    img.onload = () => {
      this.imageRatio = img.naturalWidth / Math.max(1, img.naturalHeight);
      this.imageTexture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.imageTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.activeTexture(gl.TEXTURE0);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    };
  }

  createProceduralTexture() {
    const gl = this.gl;
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    
    // Create modern dark ambient cybernetic gradient
    const grad = ctx.createRadialGradient(256, 256, 10, 256, 256, 256);
    grad.addColorStop(0, '#ff571a');
    grad.addColorStop(0.3, '#8b5cf6');
    grad.addColorStop(0.7, '#00FFA3');
    grad.addColorStop(1, '#050508');
    
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 512);

    this.imageRatio = 1;
    this.imageTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.imageTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.activeTexture(gl.TEXTURE0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  }

  getPointerUV() {
    const cw = this.container.clientWidth * this.config.scaleFactor;
    const ch = this.container.clientHeight * this.config.scaleFactor;
    const offsetX = 0.5 * (cw - this.container.clientWidth);
    const offsetY = 0.5 * (ch - this.container.clientHeight);
    return {
      u: (this.pointer.x + offsetX) / Math.max(1, cw),
      v: 1.0 - (this.pointer.y + offsetY) / Math.max(1, ch)
    };
  }

  updatePointer(clientX, clientY) {
    const rect = this.container.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    this.pointer.moved = true;
    this.pointer.dx = 6 * (x - this.pointer.x);
    this.pointer.dy = 6 * (y - this.pointer.y);
    this.pointer.x = x;
    this.pointer.y = y;
  }

  initEvents() {
    this.onMouseEnter = () => { this.pointer.isHovered = true; };
    this.onMouseLeave = () => { this.pointer.isHovered = false; this.pointer.moved = false; };
    this.onMouseMove = (e) => {
      this.pointer.isHovered = true;
      this.updatePointer(e.clientX, e.clientY);
    };
    this.onTouchStart = (e) => {
      this.pointer.isHovered = true;
      if (e.touches && e.touches[0]) {
        this.updatePointer(e.touches[0].clientX, e.touches[0].clientY);
      }
    };
    this.onTouchMove = (e) => {
      this.pointer.isHovered = true;
      if (e.touches && e.touches[0]) {
        this.updatePointer(e.touches[0].clientX, e.touches[0].clientY);
      }
    };
    this.onTouchEnd = () => {
      this.pointer.isHovered = false;
      this.pointer.moved = false;
    };

    const target = this.interactiveTarget || window;
    target.addEventListener('mouseenter', this.onMouseEnter);
    target.addEventListener('mouseleave', this.onMouseLeave);
    target.addEventListener('mousemove', this.onMouseMove);
    target.addEventListener('touchstart', this.onTouchStart, { passive: true });
    target.addEventListener('touchmove', this.onTouchMove, { passive: true });
    target.addEventListener('touchend', this.onTouchEnd, { passive: true });

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    window.addEventListener('resize', () => this.resize());
  }

  step() {
    if (!this.gl || !this.density || !this.velocity) return;
    const gl = this.gl;
    const dt = 1.0 / 60.0;
    const cw = this.container.clientWidth;
    const ch = Math.max(1, this.container.clientHeight);
    const aspect = cw / ch;

    // 1. Splat force / velocity when moved
    if (this.pointer.moved) {
      this.pointer.moved = false;
      const splatProg = this.programs.splat;
      gl.useProgram(splatProg.program);
      gl.uniform1i(splatProg.uniforms.u_input_texture, this.velocity.read().attach(1));
      gl.uniform1f(splatProg.uniforms.u_ratio, aspect);
      const uv = this.getPointerUV();
      gl.uniform2f(splatProg.uniforms.u_point, uv.u, uv.v);
      gl.uniform3f(splatProg.uniforms.u_point_value, this.pointer.dx, -this.pointer.dy, 0.0);
      gl.uniform1f(splatProg.uniforms.u_point_size, this.config.cursorSize * 0.001);
      this.renderQuad(this.velocity.write());
      this.velocity.swap();

      gl.uniform1i(splatProg.uniforms.u_input_texture, this.density.read().attach(1));
      gl.uniform3f(splatProg.uniforms.u_point_value, this.config.cursorPower * 0.001, 0.0, 0.0);
      this.renderQuad(this.density.write());
      this.density.swap();
    }

    // 2. Divergence
    const divProg = this.programs.divergence;
    gl.useProgram(divProg.program);
    gl.uniform2f(divProg.uniforms.u_texel, this.velocity.texelSizeX, this.velocity.texelSizeY);
    gl.uniform1i(divProg.uniforms.u_velocity_texture, this.velocity.read().attach(1));
    this.renderQuad(this.divergence);

    // 3. Pressure solve (16 Jacobi iterations)
    const pressProg = this.programs.pressure;
    gl.useProgram(pressProg.program);
    gl.uniform2f(pressProg.uniforms.u_texel, this.velocity.texelSizeX, this.velocity.texelSizeY);
    gl.uniform1i(pressProg.uniforms.u_divergence_texture, this.divergence.attach(1));
    for (let i = 0; i < 16; i++) {
      gl.uniform1i(pressProg.uniforms.u_pressure_texture, this.pressure.read().attach(2));
      this.renderQuad(this.pressure.write());
      this.pressure.swap();
    }

    // 4. Gradient subtraction (velocity update)
    const gradProg = this.programs.gradientSubtract;
    gl.useProgram(gradProg.program);
    gl.uniform2f(gradProg.uniforms.u_texel, this.velocity.texelSizeX, this.velocity.texelSizeY);
    gl.uniform1i(gradProg.uniforms.u_pressure_texture, this.pressure.read().attach(1));
    gl.uniform1i(gradProg.uniforms.u_velocity_texture, this.velocity.read().attach(2));
    this.renderQuad(this.velocity.write());
    this.velocity.swap();

    // 5. Advection (velocity)
    const advProg = this.programs.advection;
    gl.useProgram(advProg.program);
    gl.uniform2f(advProg.uniforms.u_texel, this.velocity.texelSizeX, this.velocity.texelSizeY);
    gl.uniform2f(advProg.uniforms.u_output_textel, this.velocity.texelSizeX, this.velocity.texelSizeY);
    gl.uniform1i(advProg.uniforms.u_velocity_texture, this.velocity.read().attach(1));
    gl.uniform1i(advProg.uniforms.u_input_texture, this.velocity.read().attach(1));
    gl.uniform1f(advProg.uniforms.u_dt, dt);
    gl.uniform1f(advProg.uniforms.u_dissipation, 0.97);
    this.renderQuad(this.velocity.write());
    this.velocity.swap();

    // 6. Advection (density / disturbance)
    gl.uniform2f(advProg.uniforms.u_output_textel, this.density.texelSizeX, this.density.texelSizeY);
    gl.uniform1i(advProg.uniforms.u_input_texture, this.density.read().attach(2));
    gl.uniform1f(advProg.uniforms.u_dt, 8.0 * dt);
    gl.uniform1f(advProg.uniforms.u_dissipation, 0.98);
    this.renderQuad(this.density.write());
    this.density.swap();

    // 7. Final Render to Canvas with Image / Plasma Distortion
    const outProg = this.programs.output;
    gl.useProgram(outProg.program);
    const uv = this.getPointerUV();
    gl.uniform2f(outProg.uniforms.u_point, uv.u, uv.v);
    gl.uniform1i(outProg.uniforms.u_velocity_texture, this.velocity.read().attach(2));
    gl.uniform1f(outProg.uniforms.u_ratio, aspect);
    gl.uniform1f(outProg.uniforms.u_img_ratio, this.imageRatio);
    gl.uniform1f(outProg.uniforms.u_disturb_power, this.config.distortionPower);
    gl.uniform1i(outProg.uniforms.u_output_texture, this.density.read().attach(1));
    gl.uniform1f(outProg.uniforms.u_canvas_scale, 1.0);
    gl.uniform1f(outProg.uniforms.u_inner_scale, 0.8333333333333334);

    if (this.imageTexture) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.imageTexture);
      gl.uniform1i(outProg.uniforms.u_text_texture, 0);
    }

    this.renderQuad(null);
  }

  start() {
    const loop = () => {
      this.step();
      this.animationFrameId = requestAnimationFrame(loop);
    };
    this.animationFrameId = requestAnimationFrame(loop);
  }

  destroy() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
  }
}

window.LiquidHoverFluidSimulation = LiquidHoverFluidSimulation;
