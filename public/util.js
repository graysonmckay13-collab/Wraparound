'use strict';
/* Small helpers shared by the other scripts. Everything hangs off window.W. */
(function () {
  const W = (window.W = {});

  /* Build DOM without innerHTML, so user text can never be treated as markup. */
  const PROPS = new Set(['value', 'checked', 'disabled', 'hidden', 'selected', 'indeterminate']);
  W.h = function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const k in props || {}) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (PROPS.has(k)) el[k] = v;
      else el.setAttribute(k === 'htmlFor' ? 'for' : k, v === true ? '' : String(v));
    }
    const add = (kid) => {
      if (kid == null || kid === false) return;
      if (Array.isArray(kid)) kid.forEach(add);
      else el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    };
    kids.forEach(add);
    return el;
  };
  const h = W.h;

  W.api = async function api(method, url, body) {
    const opt = { method, credentials: 'same-origin', headers: {} };
    if (method !== 'GET') { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body || {}); }
    let r;
    try { r = await fetch(url, opt); } catch (e) { const err = new Error('Could not reach the server. Check your connection.'); err.status = 0; throw err; }
    let data = null;
    try { data = await r.json(); } catch (e) { /* not JSON */ }
    if (!r.ok) {
      const err = new Error((data && data.error) || 'Something went wrong.');
      err.status = r.status; err.code = data && data.error;
      if (r.status === 403 && (err.code === 'pending' || err.code === 'banned')) { location.reload(); }
      throw err;
    }
    return data;
  };
  W.get = (u) => W.api('GET', u);
  W.post = (u, b) => W.api('POST', u, b);
  W.del = (u) => W.api('DELETE', u);

  /* XHR so we get upload progress, which fetch() still can't give us. */
  W.upload = function upload(file, onProgress, url) {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open('POST', url || '/api/upload');
      x.setRequestHeader('X-Requested-With', 'wraparound');
      x.setRequestHeader('Content-Type', 'application/octet-stream');
      x.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
      x.onload = () => {
        let data = null; try { data = JSON.parse(x.responseText); } catch (e) { /* ignore */ }
        if (x.status === 200 && data) resolve(data);
        else reject(new Error((data && data.error) || 'Upload failed. Try again.'));
      };
      x.onerror = () => reject(new Error('Upload failed. Check your connection and try again.'));
      x.send(file);
    });
  };

  W.ago = function ago(ts) {
    const s = Math.max(0, (Date.now() - ts) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    if (s < 86400 * 14) return Math.floor(s / 86400) + ' d ago';
    return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  };
  W.date = (ts) => new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  W.bytes = (n) => n >= 1073741824 ? (n / 1073741824).toFixed(1) + ' GB' : n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
  W.clock = (s) => { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

  /* Square avatar: the uploaded photo, or the first letter on a colour picked from the user id. */
  const SWATCH = ['#1750E6', '#0B1F4B', '#2F6FED', '#123A9C', '#3B5FC0', '#0E2F7A', '#4A7DF0', '#1B3A8A'];
  W.avatar = function avatar(u, size) {
    const s = size || 36;
    const box = h('span', { class: 'avatar', 'aria-hidden': 'true' });
    box.style.setProperty('--s', s + 'px');
    if (u.avatar) box.append(h('img', { src: u.avatar, alt: '', loading: 'lazy' }));
    else { box.classList.add('mono'); box.style.setProperty('--c', SWATCH[Math.abs(u.id | 0) % SWATCH.length]); box.append((u.name || u.handle || '?').trim().charAt(0).toUpperCase()); }
    return box;
  };

  let toastTimer;
  W.toast = function toast(msg, isError) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.classList.toggle('error', !!isError); t.classList.add('on');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), isError ? 5000 : 3000);
  };
  W.errorText = (e) => (e && e.message) || 'Something went wrong.';

  /* ---------- sound: made with the browser's own synth, so there are no audio files to load ---------- */
  W.sound = (function () {
    let ctx = null, on = true;
    try { on = localStorage.getItem('w-sound') !== 'off'; } catch (e) { /* storage blocked */ }
    function context() {
      if (!ctx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; try { ctx = new C(); } catch (e) { return null; } }
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return ctx;
    }
    ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => window.addEventListener(ev, context, { passive: true }));
    function tone(freq, at, dur, gain, type) {
      const c = context(); if (!c || c.state !== 'running') return;
      const o = c.createOscillator(), g = c.createGain(), t0 = c.currentTime + at;
      o.type = type || 'sine'; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(gain || 0.14, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(c.destination); o.start(t0); o.stop(t0 + dur + 0.05);
    }
    const patterns = {
      ring() { [0, 0.55].forEach((t) => { tone(440, t, 0.4, 0.12); tone(480, t, 0.4, 0.12); }); },
      ringback() { tone(440, 0, 1.6, 0.08); tone(480, 0, 1.6, 0.08); },
      message() { tone(660, 0, 0.14, 0.12); tone(880, 0.12, 0.2, 0.12); },
      join() { tone(523, 0, 0.14, 0.12); tone(784, 0.13, 0.22, 0.12); },
      leave() { tone(784, 0, 0.14, 0.12); tone(523, 0.13, 0.22, 0.12); },
      end() { tone(480, 0, 0.18, 0.1); tone(380, 0.18, 0.3, 0.1); },
      test() { tone(523, 0, 0.25, 0.16); tone(659, 0.25, 0.25, 0.16); tone(784, 0.5, 0.4, 0.16); }
    };
    const periods = { ring: 3000, ringback: 5000 };
    return {
      get enabled() { return on; },
      set enabled(v) { on = !!v; try { localStorage.setItem('w-sound', on ? 'on' : 'off'); } catch (e) { /* ignore */ } },
      ready: () => !!(ctx && ctx.state === 'running'),
      play(name, force) { if ((on || force) && patterns[name]) patterns[name](); },
      loop(name) {
        if (!on || !patterns[name]) return () => {};
        patterns[name]();
        const id = setInterval(() => patterns[name](), periods[name] || 3000);
        return () => clearInterval(id);
      }
    };
  })();

  /* Calls back with how loud a stream is (0 to about 1), about 12 times a second. Returns a stop function. */
  W.level = function level(stream, cb) {
    if (!stream || !stream.getAudioTracks().length) return () => {};
    const C = window.AudioContext || window.webkitAudioContext; if (!C) return () => {};
    let c; try { c = new C(); } catch (e) { return () => {}; }
    if (c.state === 'suspended') c.resume().catch(() => {});
    const src = c.createMediaStreamSource(stream), an = c.createAnalyser(); an.fftSize = 512; src.connect(an);
    const data = new Uint8Array(an.fftSize); let raf = 0, last = 0, dead = false;
    const tick = (t) => {
      if (dead) return; raf = requestAnimationFrame(tick); if (t - last < 80) return; last = t;
      an.getByteTimeDomainData(data); let sum = 0; for (let i = 0; i < data.length; i++) { const x = (data[i] - 128) / 128; sum += x * x; }
      cb(Math.sqrt(sum / data.length));
    };
    raf = requestAnimationFrame(tick);
    return () => { dead = true; cancelAnimationFrame(raf); try { src.disconnect(); c.close(); } catch (e) { /* ignore */ } };
  };

})();
