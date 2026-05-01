// gl-renderer.js — WebGL2 renderer for StreamBro scene
// Replaces Canvas 2D drawImage + blur with GPU-accelerated textured quads + shader effects.
// Falls back to Canvas 2D if WebGL2 is unavailable.

const GLRenderer = {
  gl: null,
  canvas: null,
  ready: false,

  // Programs — each is { prog: WebGLProgram, u: {name: loc}, a: {name: loc} }
  _texProgram: null,
  _blurHProgram: null,
  _blurVProgram: null,
  _vignetteProgram: null,
  _glowProgram: null,

  // Geometry
  _quadVBO: null,
  _quadVerts: new Float32Array([
    -1, -1, 0, 0,
     1, -1, 1, 0,
    -1,  1, 0, 1,
     1,  1, 1, 1,
  ]),

  // FBOs for blur
  _fboA: null, _fboTexA: null,
  _fboB: null, _fboTexB: null,
  _fboW: 0, _fboH: 0,

  // Video texture cache
  _texCache: new Map(),

  init(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      antialias: false,
      depth: false,
      stencil: true,
    });

    if (!gl) {
      console.warn('[GLRenderer] WebGL2 not available, falling back to Canvas 2D');
      this.ready = false;
      return false;
    }

    this.gl = gl;

    try {
      this._texProgram = this._createProgram(TEX_VS, TEX_FS);
      this._blurHProgram = this._createProgram(BLUR_VS, BLUR_H_FS);
      this._blurVProgram = this._createProgram(BLUR_VS, BLUR_V_FS);
      this._vignetteProgram = this._createProgram(FULLSCREEN_VS, VIGNETTE_FS);
      this._glowProgram = this._createProgram(FULLSCREEN_VS, GLOW_FS);

      const vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, this._quadVerts, gl.STATIC_DRAW);
      this._quadVBO = vbo;

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      this.ready = true;
      if (window.__sbDev) console.log('[GLRenderer] WebGL2 initialized');
      return true;
    } catch (e) {
      console.warn('[GLRenderer] Shader compilation failed, falling back:', e);
      this.ready = false;
      return false;
    }
  },

  resize(w, h) {
    const gl = this.gl;
    if (!gl) return;
    this.canvas.width = w;
    this.canvas.height = h;
    gl.viewport(0, 0, w, h);
    this._ensureFBOs(w, h);
  },

  _ensureFBOs(w, h) {
    const gl = this.gl;
    if (this._fboW === w && this._fboH === h) return;
    if (this._fboA) { gl.deleteFramebuffer(this._fboA); gl.deleteTexture(this._fboTexA); }
    if (this._fboB) { gl.deleteFramebuffer(this._fboB); gl.deleteTexture(this._fboTexB); }
    this._fboTexA = this._createTexture(w, h);
    this._fboA = this._createFBO(this._fboTexA);
    this._fboTexB = this._createTexture(w, h);
    this._fboB = this._createFBO(this._fboTexB);
    this._fboW = w;
    this._fboH = h;
  },

  _createTexture(w, h) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  },

  _createFBO(tex) {
    const gl = this.gl;
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return fbo;
  },

  beginFrame() {
    const gl = this.gl;
    if (!gl) return;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  },

  drawSource(srcId, videoEl, it, crop) {
    const gl = this.gl;
    if (!gl || !videoEl || videoEl.readyState < 2) return;

    let entry = this._texCache.get(srcId);
    if (!entry) {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      entry = { tex };
      this._texCache.set(srcId, entry);
    }

    gl.bindTexture(gl.TEXTURE_2D, entry.tex);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, videoEl);
    } catch(e) {
      return;
    }

    const p = this._texProgram;
    gl.useProgram(p.prog);

    const cw = this.canvas.width, ch = this.canvas.height;
    gl.uniform2f(p.u.resolution, cw, ch);

    const cx = it.cx, cy = it.cy, rot = (it.rot || 0) * Math.PI / 180;
    const sw = it.w, sh = it.h;
    const flipX = it.flipH ? -1 : 1, flipY = it.flipV ? -1 : 1;
    gl.uniform2f(p.u.translate, cx, cy);
    gl.uniform1f(p.u.rotation, rot);
    gl.uniform2f(p.u.scale, sw * flipX, sh * flipY);

    const cr = crop || { l: 0, t: 0, r: 0, b: 0 };
    const vw = videoEl.videoWidth || 1920, vh = videoEl.videoHeight || 1080;
    gl.uniform4f(p.u.uvRect, cr.l / vw, cr.t / vh, 1 - cr.r / vw, 1 - cr.b / vh);

    const cs = srcId && window.S && S.srcs ? S.srcs.find(s => s.id === srcId) : null;
    const cam = cs && cs.camSettings;
    gl.uniform1f(p.u.brightness, cam ? 1 + (cam.brightness || 0) / 100 : 1);
    gl.uniform1f(p.u.contrast, cam ? 1 + (cam.contrast || 0) / 100 : 1);
    gl.uniform1f(p.u.saturation, cam ? 1 + (cam.saturation || 0) / 100 : 1);
    gl.uniform1f(p.u.hueRotate, cam ? (cam.hue || 0) * Math.PI / 180 : 0);
    gl.uniform1f(p.u.sepia, cam ? (cam.sepia || 0) / 100 : 0);

    const maskType = it.cropMask || 'none';
    gl.uniform1i(p.u.maskMode, maskType === 'circle' ? 1 : maskType === 'rounded' ? 2 : 0);
    if (maskType === 'rounded') gl.uniform1f(p.u.maskRadius, Math.min(it.w, it.h) * 0.15);
    gl.uniform2f(p.u.scale, sw * flipX, sh * flipY); // also used by FS for SDF

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, entry.tex);
    gl.uniform1i(p.u.tex, 0);

    this._drawQuad(p);
  },

  blur(srcTex, radius, passes) {
    const gl = this.gl;
    if (!gl || radius <= 0) return srcTex;
    passes = passes || 1;
    for (let i = 0; i < passes; i++) {
      this._blurPass(this._blurHProgram, srcTex, this._fboB, this._fboTexB, radius);
      this._blurPass(this._blurVProgram, this._fboTexB, this._fboA, this._fboTexA, radius);
      srcTex = this._fboTexA;
    }
    return srcTex;
  },

  _blurPass(p, srcTex, dstFBO, dstTex, radius) {
    const gl = this.gl;
    const w = this._fboW, h = this._fboH;
    gl.bindFramebuffer(gl.FRAMEBUFFER, dstFBO);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(p.prog);
    gl.uniform2f(p.u.resolution, w, h);
    gl.uniform1f(p.u.radius, radius);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, srcTex);
    gl.uniform1i(p.u.tex, 0);
    this._drawQuad(p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  },

  drawGlowOut(it, fs, glowColor, glowSize, opacity) {
    const gl = this.gl;
    if (!gl) return;

    gl.bindFramebuffer(gl.FRAMEBUFFER, this._fboA);
    gl.viewport(0, 0, this._fboW, this._fboH);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const p = this._glowProgram;
    gl.useProgram(p.prog);
    gl.uniform2f(p.u.resolution, this.canvas.width, this.canvas.height);
    gl.uniform2f(p.u.translate, it.cx, it.cy);
    gl.uniform1f(p.u.rotation, (it.rot || 0) * Math.PI / 180);
    gl.uniform2f(p.u.scale, it.w, it.h);
    gl.uniform4f(p.u.color, ...this._hexToGL(glowColor), opacity);
    gl.uniform1f(p.u.expand, glowSize);

    const maskType = it.cropMask || 'none';
    gl.uniform1i(p.u.maskMode, maskType === 'circle' ? 1 : maskType === 'rounded' ? 2 : 0);
    if (maskType === 'rounded') gl.uniform1f(p.u.maskRadius, Math.min(it.w, it.h) * 0.15);

    this._drawQuad(p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    const blurRadius = Math.max(2, glowSize * 0.8);
    const blurredTex = this.blur(this._fboTexA, blurRadius, window.S && S.reducedMotion ? 2 : 4);

    // Composite onto main canvas with additive blend
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE); // additive
    this._compositeTexture(blurredTex, this.canvas.width, this.canvas.height);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  },

  drawVignette(it, vignetteColor, strength, size) {
    const gl = this.gl;
    if (!gl) return;

    gl.bindFramebuffer(gl.FRAMEBUFFER, this._fboA);
    gl.viewport(0, 0, this._fboW, this._fboH);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const p = this._vignetteProgram;
    gl.useProgram(p.prog);
    gl.uniform2f(p.u.resolution, this.canvas.width, this.canvas.height);
    gl.uniform2f(p.u.translate, it.cx, it.cy);
    gl.uniform1f(p.u.rotation, (it.rot || 0) * Math.PI / 180);
    gl.uniform2f(p.u.scale, it.w, it.h);
    gl.uniform4f(p.u.color, ...this._hexToGL(vignetteColor || '#000000'), strength);
    gl.uniform1f(p.u.vignetteSize, size / 100);

    const maskType = it.cropMask || 'none';
    gl.uniform1i(p.u.maskMode, maskType === 'circle' ? 1 : maskType === 'rounded' ? 2 : 0);
    if (maskType === 'rounded') gl.uniform1f(p.u.maskRadius, Math.min(it.w, it.h) * 0.15);

    this._drawQuad(p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this._compositeTexture(this._fboTexA, this.canvas.width, this.canvas.height);
  },

  drawBorderStroke(it, color, thickness, opacity, style) {
    const gl = this.gl;
    if (!gl) return;

    gl.bindFramebuffer(gl.FRAMEBUFFER, this._fboA);
    gl.viewport(0, 0, this._fboW, this._fboH);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const p = this._glowProgram;
    gl.useProgram(p.prog);
    gl.uniform2f(p.u.resolution, this.canvas.width, this.canvas.height);
    gl.uniform2f(p.u.translate, it.cx, it.cy);
    gl.uniform1f(p.u.rotation, (it.rot || 0) * Math.PI / 180);
    gl.uniform2f(p.u.scale, it.w, it.h);
    gl.uniform4f(p.u.color, ...this._hexToGL(color), opacity);
    gl.uniform1f(p.u.expand, thickness);

    const maskType = it.cropMask || 'none';
    gl.uniform1i(p.u.maskMode, maskType === 'circle' ? 1 : maskType === 'rounded' ? 2 : 0);
    if (maskType === 'rounded') gl.uniform1f(p.u.maskRadius, Math.min(it.w, it.h) * 0.15);

    this._drawQuad(p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this._compositeTexture(this._fboTexA, this.canvas.width, this.canvas.height);
  },

  // Helper: draw an FBO texture onto the main canvas (fullscreen)
  _compositeTexture(tex, w, h) {
    const gl = this.gl;
    const p = this._texProgram;
    gl.useProgram(p.prog);
    gl.uniform2f(p.u.resolution, w, h);
    gl.uniform2f(p.u.translate, w / 2, h / 2);
    gl.uniform1f(p.u.rotation, 0);
    gl.uniform2f(p.u.scale, w, h);
    gl.uniform4f(p.u.uvRect, 0, 0, 1, 1);
    gl.uniform1i(p.u.maskMode, 0);
    gl.uniform2f(p.u.scale, w, h);
    gl.uniform1f(p.u.brightness, 1);
    gl.uniform1f(p.u.contrast, 1);
    gl.uniform1f(p.u.saturation, 1);
    gl.uniform1f(p.u.hueRotate, 0);
    gl.uniform1f(p.u.sepia, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(p.u.tex, 0);
    this._drawQuad(p);
  },

  removeSource(srcId) {
    const entry = this._texCache.get(srcId);
    if (entry && this.gl) this.gl.deleteTexture(entry.tex);
    this._texCache.delete(srcId);
  },

  destroy() {
    const gl = this.gl;
    if (!gl) return;
    [this._texProgram, this._blurHProgram, this._blurVProgram,
     this._vignetteProgram, this._glowProgram].forEach(p => {
      if (p) gl.deleteProgram(p.prog);
    });
    if (this._quadVBO) gl.deleteBuffer(this._quadVBO);
    if (this._fboA) gl.deleteFramebuffer(this._fboA);
    if (this._fboB) gl.deleteFramebuffer(this._fboB);
    if (this._fboTexA) gl.deleteTexture(this._fboTexA);
    if (this._fboTexB) gl.deleteTexture(this._fboTexB);
    for (const [, entry] of this._texCache) gl.deleteTexture(entry.tex);
    this._texCache.clear();
    this.ready = false;
    this.gl = null;
  },

  _drawQuad(p) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this._quadVBO);
    gl.enableVertexAttribArray(p.a.position);
    gl.vertexAttribPointer(p.a.position, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(p.a.texCoord);
    gl.vertexAttribPointer(p.a.texCoord, 2, gl.FLOAT, false, 16, 8);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  },

  _createProgram(vsSource, fsSource) {
    const gl = this.gl;
    const vs = this._compileShader(gl.VERTEX_SHADER, vsSource);
    const fs = this._compileShader(gl.FRAGMENT_SHADER, fsSource);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error('Program link failed: ' + gl.getProgramInfoLog(prog));
    }
    // Return object with .prog = WebGLProgram, .u = { name: uniformLoc }, .a = { name: attribLoc }
    const result = { prog, u: {}, a: {} };
    const nu = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < nu; i++) {
      const info = gl.getActiveUniform(prog, i);
      const name = info.name.replace(/\[0\]$/, ''); // strip array suffix
      result.u[name] = gl.getUniformLocation(prog, name);
    }
    const na = gl.getProgramParameter(prog, gl.ACTIVE_ATTRIBUTES);
    for (let i = 0; i < na; i++) {
      const info = gl.getActiveAttrib(prog, i);
      result.a[info.name] = gl.getAttribLocation(prog, info.name);
    }
    return result;
  },

  _compileShader(type, source) {
    const gl = this.gl;
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error('Shader compile failed: ' + log);
    }
    return shader;
  },

  _hexToGL(hex) {
    return [
      parseInt(hex.slice(1, 3), 16) / 255,
      parseInt(hex.slice(3, 5), 16) / 255,
      parseInt(hex.slice(5, 7), 16) / 255,
    ];
  },
};

// ─── Shader Sources ───

const TEX_VS = `#version 300 es
layout(location=0) in vec2 a_position;
layout(location=1) in vec2 a_texCoord;
uniform vec2 u_resolution;
uniform vec2 u_translate;
uniform float u_rotation;
uniform vec2 u_scale;
out vec2 v_uv;
void main() {
  vec2 pos = a_position * u_scale * 0.5;
  float c = cos(u_rotation), s = sin(u_rotation);
  pos = vec2(pos.x * c - pos.y * s, pos.x * s + pos.y * c);
  pos += u_translate;
  gl_Position = vec4(pos / u_resolution * 2.0 - 1.0, 0.0, 1.0);
  v_uv = vec2(a_texCoord.x, 1.0 - a_texCoord.y);
}`;

const TEX_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec4 u_uvRect;
uniform int u_maskMode;
uniform float u_maskRadius;
uniform vec2 u_scale;
uniform float u_brightness;
uniform float u_contrast;
uniform float u_saturation;
uniform float u_hueRotate;
uniform float u_sepia;
out vec4 fragColor;

void main() {
  vec2 uv = mix(u_uvRect.xy, u_uvRect.zw, v_uv);
  vec4 col = texture(u_tex, uv);
  col.rgb *= u_brightness;
  col.rgb = (col.rgb - 0.5) * u_contrast + 0.5;
  float gray = dot(col.rgb, vec3(0.2126, 0.7152, 0.0722));
  col.rgb = mix(vec3(gray), col.rgb, u_saturation);
  if (u_hueRotate != 0.0) {
    float a = u_hueRotate;
    float cs = cos(a), sn = sin(a);
    mat3 hr = mat3(
      0.2126+0.7874*cs-0.2126*sn, 0.7152-0.7152*cs-0.7152*sn, 0.0722-0.0722*cs+0.9278*sn,
      0.2126-0.2126*cs+0.1431*sn, 0.7152+0.2848*cs+0.1400*sn, 0.0722-0.0722*cs-0.2831*sn,
      0.2126-0.2126*cs-0.7874*sn, 0.7152-0.7152*cs+0.7152*sn, 0.0722+0.9278*cs+0.0722*sn
    );
    col.rgb = hr * col.rgb;
  }
  if (u_sepia > 0.0) {
    vec3 sc = vec3(dot(col.rgb,vec3(0.393,0.769,0.189)),dot(col.rgb,vec3(0.349,0.686,0.168)),dot(col.rgb,vec3(0.272,0.534,0.131)));
    col.rgb = mix(col.rgb, sc, u_sepia);
  }
  vec2 pos = v_uv * 2.0 - 1.0;
  if (u_maskMode == 1) {
    float d = length(pos);
    if (d > 1.0) discard;
    col.a *= 1.0 - smoothstep(0.97, 1.0, d);
  } else if (u_maskMode == 2) {
    float r = u_maskRadius / max(abs(u_scale.x), abs(u_scale.y)) * 2.0;
    vec2 d = abs(pos) - 1.0 + r;
    float dist = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r;
    if (dist > 0.02) discard;
    col.a *= 1.0 - smoothstep(-0.02, 0.02, dist);
  }
  fragColor = col;
}`;

const BLUR_VS = `#version 300 es
layout(location=0) in vec2 a_position;
layout(location=1) in vec2 a_texCoord;
out vec2 v_uv;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_uv = a_texCoord;
}`;

const BLUR_H_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_resolution;
uniform float u_radius;
out vec4 fragColor;
void main() {
  vec2 ts = 1.0 / u_resolution;
  float r = max(u_radius, 0.001);
  vec4 sum = vec4(0.0);
  float tw = 0.0;
  for (int i = -4; i <= 4; i++) {
    float w = exp(-float(i*i) / (2.0 * r * r));
    sum += texture(u_tex, v_uv + vec2(float(i) * ts.x * r * 0.25, 0.0)) * w;
    tw += w;
  }
  fragColor = sum / tw;
}`;

const BLUR_V_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_resolution;
uniform float u_radius;
out vec4 fragColor;
void main() {
  vec2 ts = 1.0 / u_resolution;
  float r = max(u_radius, 0.001);
  vec4 sum = vec4(0.0);
  float tw = 0.0;
  for (int i = -4; i <= 4; i++) {
    float w = exp(-float(i*i) / (2.0 * r * r));
    sum += texture(u_tex, v_uv + vec2(0.0, float(i) * ts.y * r * 0.25)) * w;
    tw += w;
  }
  fragColor = sum / tw;
}`;

const FULLSCREEN_VS = `#version 300 es
layout(location=0) in vec2 a_position;
layout(location=1) in vec2 a_texCoord;
uniform vec2 u_resolution;
uniform vec2 u_translate;
uniform float u_rotation;
uniform vec2 u_scale;
out vec2 v_uv;
void main() {
  vec2 pos = a_position * u_scale * 0.5;
  float c = cos(u_rotation), s = sin(u_rotation);
  pos = vec2(pos.x * c - pos.y * s, pos.x * s + pos.y * c);
  pos += u_translate;
  gl_Position = vec4(pos / u_resolution * 2.0 - 1.0, 0.0, 1.0);
  v_uv = a_texCoord;
}`;

const VIGNETTE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform vec4 u_color;
uniform float u_vignetteSize;
uniform int u_maskMode;
uniform float u_maskRadius;
uniform vec2 u_scale;
out vec4 fragColor;
void main() {
  vec2 pos = v_uv * 2.0 - 1.0;
  float d;
  if (u_maskMode == 1) d = length(pos);
  else d = max(abs(pos.x), abs(pos.y));
  float inner = 1.0 - u_vignetteSize;
  float alpha = smoothstep(inner, 1.0, d);
  fragColor = vec4(u_color.rgb, u_color.a * alpha);
}`;

const GLOW_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform vec4 u_color;
uniform float u_expand;
uniform int u_maskMode;
uniform float u_maskRadius;
uniform vec2 u_scale;
out vec4 fragColor;
void main() {
  vec2 pos = v_uv * 2.0 - 1.0;
  float d;
  if (u_maskMode == 1) {
    d = length(pos);
  } else if (u_maskMode == 2) {
    float r = u_maskRadius / max(abs(u_scale.x), abs(u_scale.y)) * 2.0;
    vec2 dd = abs(pos) - 1.0 + r;
    d = length(max(dd, 0.0)) + min(max(dd.x, dd.y), 0.0) - r;
    d = max(d, 0.0);
  } else {
    vec2 dd = abs(pos) - 1.0;
    d = length(max(dd, 0.0));
  }
  float reach = u_expand / max(abs(u_scale.x), abs(u_scale.y)) * 2.0;
  float alpha = 1.0 - smoothstep(0.0, max(reach, 0.01), d);
  if (d < 0.001) alpha = 0.0;
  fragColor = vec4(u_color.rgb, u_color.a * alpha);
}`;

window.GLRenderer = GLRenderer;
