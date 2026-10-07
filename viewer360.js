'use strict';
/*
 * 360 degree video player. Draws an equirectangular video through a WebGL shader.
 * Drag (or use the arrow keys) to look around, scroll or pinch to zoom.
 */
(function () {
  const { h, clock } = window.W;

  const VERT = 'attribute vec2 p; varying vec2 v; void main(){ v=p; gl_Position=vec4(p,0.,1.); }';
  const FRAG = [
    '#ifdef GL_FRAGMENT_PRECISION_HIGH', 'precision highp float;', '#else', 'precision mediump float;', '#endif',
    'varying vec2 v; uniform sampler2D t; uniform vec2 rot; uniform float fov; uniform float aspect;',
    'void main(){',
    '  float k = tan(fov * 0.5);',
    '  vec3 d = normalize(vec3(v.x * aspect * k, v.y * k, -1.0));',
    '  float cp = cos(rot.y), sp = sin(rot.y), cy = cos(rot.x), sy = sin(rot.x);',
    '  d = vec3(d.x, d.y * cp - d.z * sp, d.y * sp + d.z * cp);',
    '  d = vec3(d.x * cy + d.z * sy, d.y, -d.x * sy + d.z * cy);',
    '  float lon = atan(d.x, -d.z);',
    '  float lat = asin(clamp(d.y, -1.0, 1.0));',
    '  gl_FragColor = texture2D(t, vec2(lon / 6.2831853 + 0.5, 0.5 - lat / 3.14159265));',
    '}'
  ].join('\n');

  function compile(gl, type, src) {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }

  /* Returns { el, video, destroy }. Falls back to a flat player if WebGL is unavailable. */
  window.W.player360 = function player360(src) {
    const video = h('video', { playsinline: '', preload: 'metadata', src, 'aria-hidden': 'true', class: 'v360-src' });
    const canvas = h('canvas', { class: 'v360-canvas', tabindex: '0', role: 'img', 'aria-label': '360 degree video. Drag to look around, or use the arrow keys.' });
    let gl = null;
    try { gl = canvas.getContext('webgl', { antialias: false, alpha: false, preserveDrawingBuffer: false }); } catch (e) { gl = null; }
    if (!gl) {
      const flat = h('video', { controls: '', playsinline: '', preload: 'metadata', src });
      return { el: h('div', { class: 'frame' }, flat, h('p', { class: 'v360-note' }, "This browser can't show 360 video, so it's playing flat.")), video: flat, destroy() { flat.pause(); } };
    }

    let prog;
    try {
      prog = gl.createProgram();
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT)); gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('link');
    } catch (e) {
      const flat = h('video', { controls: '', playsinline: '', preload: 'metadata', src });
      return { el: h('div', { class: 'frame' }, flat), video: flat, destroy() { flat.pause(); } };
    }
    gl.useProgram(prog);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const uRot = gl.getUniformLocation(prog, 'rot'), uFov = gl.getUniformLocation(prog, 'fov'), uAspect = gl.getUniformLocation(prog, 'aspect');
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([10, 10, 8, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    let yaw = 0, pitch = 0, fov = 1.5, dirty = true, texDirty = false, visible = false, raf = 0, dead = false, drag = null;

    function size() {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5), w = Math.max(2, Math.round(canvas.clientWidth * dpr)), hh = Math.max(2, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== hh) { canvas.width = w; canvas.height = hh; gl.viewport(0, 0, w, hh); dirty = true; }
    }
    function frame() {
      raf = 0; if (dead) return;
      size();
      const playing = !video.paused && !video.ended;
      if (video.readyState >= 2 && (playing || texDirty)) {
        try { gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video); } catch (e) { /* frame not ready */ }
        texDirty = false; dirty = true;
      }
      if (dirty) {
        gl.uniform2f(uRot, yaw, pitch); gl.uniform1f(uFov, fov); gl.uniform1f(uAspect, canvas.width / canvas.height);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); dirty = false;
      }
      if (visible && (playing || dirty)) raf = requestAnimationFrame(frame);
    }
    const kick = () => { if (!raf && !dead && visible) raf = requestAnimationFrame(frame); };
    const io = new IntersectionObserver((es) => { visible = es[es.length - 1].isIntersecting; if (visible) { dirty = true; kick(); } else video.pause(); }, { threshold: 0.2 });
    io.observe(canvas);
    const ro = new ResizeObserver(() => { dirty = true; kick(); }); ro.observe(canvas);

    ['loadeddata', 'seeked', 'canplay'].forEach((n) => video.addEventListener(n, () => { texDirty = true; kick(); }));
    video.addEventListener('loadedmetadata', () => { try { if (video.currentTime === 0) video.currentTime = 0.05; } catch (e) { /* ignore */ } });

    const look = (dx, dy) => {
      const k = fov / Math.max(200, canvas.clientHeight);
      yaw -= dx * k; pitch = Math.max(-1.5, Math.min(1.5, pitch + dy * k)); dirty = true; kick();
    };
    canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); canvas.classList.add('grabbing'); });
    canvas.addEventListener('pointermove', (e) => { if (!drag) return; look(e.clientX - drag.x, e.clientY - drag.y); drag.x = e.clientX; drag.y = e.clientY; });
    const end = () => { drag = null; canvas.classList.remove('grabbing'); };
    canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); fov = Math.max(0.7, Math.min(2.0, fov + e.deltaY * 0.001)); dirty = true; kick(); }, { passive: false });
    canvas.addEventListener('keydown', (e) => {
      const m = { ArrowLeft: [-40, 0], ArrowRight: [40, 0], ArrowUp: [0, -40], ArrowDown: [0, 40] }[e.key];
      if (m) { e.preventDefault(); look(m[0], m[1]); }
      else if (e.key === ' ') { e.preventDefault(); toggle(); }
    });

    /* controls */
    const playBtn = h('button', { class: 'v360-btn', type: 'button', 'aria-label': 'Play' }, 'Play');
    const seek = h('input', { type: 'range', min: '0', max: '1000', value: '0', 'aria-label': 'Seek', class: 'v360-seek' });
    const time = h('span', { class: 'mono v360-time' }, '0:00');
    const fsBtn = h('button', { class: 'v360-btn', type: 'button', 'aria-label': 'Full screen' }, 'Full');
    const wrap = h('div', { class: 'frame v360' }, canvas, video, h('span', { class: 'tag v360-tag' }, '360°'),
      h('div', { class: 'v360-bar' }, playBtn, seek, time, fsBtn));
    function toggle() { if (video.paused) video.play().catch(() => {}); else video.pause(); }
    playBtn.addEventListener('click', toggle);
    canvas.addEventListener('click', () => { if (!drag && !moved) toggle(); });
    let moved = false; canvas.addEventListener('pointerdown', () => { moved = false; }); canvas.addEventListener('pointermove', () => { if (drag) moved = true; });
    video.addEventListener('play', () => { playBtn.textContent = 'Pause'; playBtn.setAttribute('aria-label', 'Pause'); kick(); });
    video.addEventListener('pause', () => { playBtn.textContent = 'Play'; playBtn.setAttribute('aria-label', 'Play'); });
    video.addEventListener('timeupdate', () => { if (video.duration) { seek.value = String(Math.round(video.currentTime / video.duration * 1000)); time.textContent = clock(video.currentTime) + ' / ' + clock(video.duration); } });
    seek.addEventListener('input', () => { if (video.duration) { video.currentTime = video.duration * seek.value / 1000; texDirty = true; kick(); } });
    fsBtn.addEventListener('click', () => { if (document.fullscreenElement) document.exitFullscreen(); else if (wrap.requestFullscreen) wrap.requestFullscreen().catch(() => {}); });
    document.addEventListener('fullscreenchange', () => { dirty = true; kick(); });
    video.addEventListener('error', () => { wrap.replaceChildren(h('p', { class: 'v360-note' }, 'This video is unavailable.')); });

    return { el: wrap, video, destroy() { dead = true; io.disconnect(); ro.disconnect(); video.pause(); if (raf) cancelAnimationFrame(raf); } };
  };
})();
