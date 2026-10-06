'use strict';
/*
 * Calls. Audio and video go straight between browsers (WebRTC). The server only relays the
 * small signalling messages. Everyone in a call connects to everyone else, so calls stay small.
 * Sounds: ringtone for the person being called, ringback for the caller, chimes when people join or leave,
 * a level bar on every tile, and a "Turn on sound" button for browsers that block autoplay audio.
 */
(function () {
  const { h, get, post, toast, avatar, errorText, sound, level } = window.W;
  let state = null;
  let inviteTimer = null, stopRing = null;

  const root = () => document.getElementById('call-root');

  async function getMedia() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('Calls need a secure (https) connection and a browser with camera access.');
    try { return await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: { width: { ideal: 1280 }, height: { ideal: 720 } } }); }
    catch (e) {
      try { const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); toast('Joined with audio only. The camera was not available.'); return s; }
      catch (e2) { throw new Error('Allow microphone access in your browser to join the call.'); }
    }
  }

  function makeTile(user, local) {
    const video = h('video', { autoplay: '', playsinline: '' });
    if (local) video.muted = true;
    const status = h('span', { class: 'tile-status mono' }, local ? 'You' : 'Connecting');
    const bar = h('i');
    const tile = h('div', { class: 'tile' + (local ? ' local' : '') }, h('div', { class: 'tile-avatar' }, avatar(user, 64)), video,
      h('div', { class: 'tile-cap' }, h('span', { class: 'tile-name' }, local ? 'You' : user.name), status), h('span', { class: 'meter', 'aria-hidden': 'true' }, bar));
    state.grid.append(tile);
    return { tile, video, status, bar };
  }
  function watchLevel(stream, ui, isLocal) {
    state.stops.push(level(stream, (v) => {
      const lvl = isLocal && state.muted ? 0 : v;
      ui.bar.style.width = Math.min(100, Math.round(lvl * 450)) + '%';
      ui.tile.classList.toggle('speaking', lvl > 0.05);
    }));
  }

  function signal(to, data) { post('/api/rtc', { room: state.room, to, data }).catch(() => {}); }

  function needSound() {
    if (!state || state.soundBtn) return;
    state.soundBtn = h('button', { class: 'btn primary', type: 'button', onclick: () => { state.peers.forEach((p) => p.video.play().catch(() => {})); state.soundBtn.remove(); state.soundBtn = null; } }, 'Turn on sound');
    state.bar.prepend(state.soundBtn);
  }

  function ensurePeer(user) {
    let p = state.peers.get(user.id);
    if (p) return p;
    const pc = new RTCPeerConnection({ iceServers: state.ice });
    const ui = makeTile(user, false);
    p = { user, pc, queue: [], hasLevel: false, ...ui };
    state.peers.set(user.id, p);
    state.local.getTracks().forEach((t) => pc.addTrack(t, state.local));
    pc.onicecandidate = (e) => { if (e.candidate) signal(user.id, { candidate: e.candidate }); };
    pc.ontrack = (e) => {
      const stream = e.streams[0]; if (!stream) return;
      p.video.srcObject = stream;
      p.tile.classList.toggle('has-media', stream.getVideoTracks().length > 0);
      stream.getVideoTracks().forEach((t) => { t.onunmute = () => p.tile.classList.add('has-media'); });
      const play = p.video.play(); if (play && play.catch) play.catch(needSound);
      if (!p.hasLevel && stream.getAudioTracks().length) { p.hasLevel = true; watchLevel(stream, p, false); }
    };
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      p.status.textContent = s === 'connected' ? '' : s === 'failed' ? 'Connection lost' : s === 'disconnected' ? 'Reconnecting' : 'Connecting';
      if (s === 'connected' && !p.joinedSound) { p.joinedSound = true; stopRingback(); sound.play('join'); }
      if (s === 'failed') { try { pc.restartIce(); } catch (e) { /* ignore */ } toast('The connection to ' + user.name + ' dropped. Trying to reconnect.', true); }
    };
    count();
    return p;
  }
  function dropPeer(id) {
    const p = state && state.peers.get(id); if (!p) return;
    p.pc.close(); p.tile.remove(); state.peers.delete(id); count(); sound.play('leave');
  }
  function count() { if (state) state.counter.textContent = state.peers.size + 1 + (state.peers.size ? ' in this call' : ' in this call, waiting for others'); }

  async function offerTo(user) {
    const p = ensurePeer(user);
    await p.pc.setLocalDescription(await p.pc.createOffer());
    signal(user.id, { description: p.pc.localDescription });
  }
  async function onSignal(from, data) {
    if (!state) return;
    const p = ensurePeer(state.known.get(from) || { id: from, name: 'Someone' });
    try {
      if (data.description) {
        await p.pc.setRemoteDescription(data.description);
        for (const c of p.queue.splice(0)) await p.pc.addIceCandidate(c).catch(() => {});
        if (data.description.type === 'offer') {
          await p.pc.setLocalDescription(await p.pc.createAnswer());
          signal(from, { description: p.pc.localDescription });
        }
      } else if (data.candidate) {
        if (p.pc.remoteDescription) await p.pc.addIceCandidate(data.candidate).catch(() => {});
        else p.queue.push(data.candidate);
      }
    } catch (e) { console.error('signalling error', e); }
  }

  function stopRingback() { if (state && state.stopRingback) { state.stopRingback(); state.stopRingback = null; } if (state) clearTimeout(state.noAnswer); }

  function buildUI(title) {
    const grid = h('div', { class: 'call-grid' });
    const counter = h('span', { class: 'mono call-count' }, '');
    const mic = h('button', { class: 'btn', type: 'button' }, 'Mute');
    const cam = h('button', { class: 'btn', type: 'button' }, 'Camera off');
    const leave = h('button', { class: 'btn danger', type: 'button' }, 'Leave');
    const bar = h('div', { class: 'call-bar' }, mic, cam, leave);
    const el = h('div', { class: 'call', role: 'dialog', 'aria-label': title },
      h('div', { class: 'call-top' }, h('strong', { class: 'serif' }, title), counter), grid, bar);
    root().replaceChildren(el);
    mic.addEventListener('click', () => {
      state.muted = !state.muted; state.local.getAudioTracks().forEach((t) => { t.enabled = !state.muted; }); mic.textContent = state.muted ? 'Unmute' : 'Mute';
    });
    cam.addEventListener('click', () => {
      const tracks = state.local.getVideoTracks(); if (!tracks.length) return toast('No camera in this call.');
      state.camOff = !state.camOff; tracks.forEach((t) => { t.enabled = !state.camOff; }); cam.textContent = state.camOff ? 'Camera on' : 'Camera off';
    });
    leave.addEventListener('click', hangup);
    return { el, grid, counter, bar };
  }

  async function open(room, title, me, opts) {
    if (state) { toast('You are already in a call.', true); return; }
    clearInvite();
    state = { room, peers: new Map(), known: new Map(), local: null, ice: null, muted: false, camOff: false, stops: [], stopRingback: null, noAnswer: 0, soundBtn: null };
    const ui = buildUI(title || 'Call');
    state.grid = ui.grid; state.counter = ui.counter; state.bar = ui.bar;
    try { state.local = await getMedia(); }
    catch (e) { cleanup(); toast(errorText(e), true); return; }
    const mine = makeTile(me, true); mine.video.srcObject = state.local; mine.status.textContent = '';
    if (state.local.getVideoTracks().length) mine.tile.classList.add('has-media');
    watchLevel(state.local, mine, true);
    try {
      state.ice = (await get('/api/ice')).iceServers;
      const r = await post('/api/calls/' + encodeURIComponent(room) + '/join');
      count();
      for (const u of r.peers) { state.known.set(u.id, u); await offerTo(u); }
      if (opts && opts.caller && !r.peers.length) {
        state.stopRingback = sound.loop('ringback');
        state.noAnswer = setTimeout(() => { stopRingback(); toast('No answer yet. You can keep waiting, or leave and try again later.'); }, 45000);
      }
    } catch (e) { cleanup(); toast(errorText(e), true); }
  }
  function cleanup() {
    if (!state) return;
    stopRingback();
    state.stops.forEach((s) => { try { s(); } catch (e) { /* ignore */ } });
    state.peers.forEach((p) => p.pc.close());
    if (state.local) state.local.getTracks().forEach((t) => t.stop());
    root().replaceChildren(); state = null;
  }
  function hangup() {
    if (!state) return;
    const room = state.room; cleanup(); sound.play('end');
    post('/api/calls/' + encodeURIComponent(room) + '/leave').catch(() => {});
  }
  function clearInvite() {
    clearTimeout(inviteTimer); if (stopRing) { stopRing(); stopRing = null; }
    const b = document.getElementById('invite-root'); if (b) b.replaceChildren();
  }

  /* A quick check you can run alone: shows your camera, moves a bar when you talk, and plays a test sound. */
  async function test() {
    const d = document.getElementById('dlg');
    const video = h('video', { autoplay: '', playsinline: '' }); video.muted = true;
    const bar = h('i'), meter = h('span', { class: 'meter big', 'aria-hidden': 'true' }, bar);
    const msg = h('p', { class: 'muted' }, 'Asking your browser for the camera and microphone...');
    let stream = null, stop = null;
    const done = () => { if (stop) stop(); if (stream) stream.getTracks().forEach((t) => t.stop()); stop = null; stream = null; };
    const close = () => { done(); if (d.open) d.close(); };
    d.replaceChildren(h('div', { class: 'dlg' }, h('h2', { class: 'serif' }, 'Test camera, microphone and sound'), msg, h('div', { class: 'frame' }, video),
      h('div', { class: 'field' }, h('span', { class: 'mono label' }, 'Microphone level'), meter),
      h('p', { class: 'hint' }, 'Speak and the bar should move. Press the button and you should hear three rising notes. If you hear nothing, check your volume and which speakers your computer is using.'),
      h('div', { class: 'dlg-actions' }, h('button', { class: 'btn', type: 'button', onclick: () => { sound.play('test', true); if (!sound.ready()) toast('Your browser has not allowed sound yet. Click anywhere on the page and try again.', true); } }, 'Play test sound'), h('button', { class: 'btn primary', type: 'button', onclick: close }, 'Done'))));
    d.addEventListener('close', done, { once: true });
    if (!d.open) d.showModal();
    try {
      stream = await getMedia(); video.srcObject = stream;
      msg.textContent = stream.getVideoTracks().length ? 'If you can see yourself and the bar moves when you talk, calls will work on this device.' : 'The microphone works if the bar moves when you talk. No camera was found, so calls from here will be audio only.';
      stop = level(stream, (v) => { bar.style.width = Math.min(100, Math.round(v * 450)) + '%'; });
    } catch (e) { msg.textContent = errorText(e); }
  }

  window.W.call = {
    open, test,
    active: () => !!state,
    /* A friend (or a group member) started a call. */
    invite(ev, me) {
      if (state) return;
      clearInvite();
      const who = ev.title ? ev.from.name + ' started a call in ' + ev.title : ev.from.name + ' is calling';
      const box = h('div', { class: 'invite', role: 'alert' }, h('span', null, who),
        h('button', { class: 'btn primary sm', type: 'button', onclick: () => open(ev.room, ev.title || 'Call with ' + ev.from.name, me) }, 'Join'),
        h('button', { class: 'btn sm', type: 'button', onclick: clearInvite }, 'Not now'));
      document.getElementById('invite-root').replaceChildren(box);
      stopRing = sound.loop('ring');
      if (navigator.vibrate) { try { navigator.vibrate([300, 150, 300]); } catch (e) { /* ignore */ } }
      inviteTimer = setTimeout(clearInvite, 45000);
    },
    onEvent(ev) {
      if (!state || ev.room !== state.room) return;
      if (ev.type === 'rtc-join') { state.known.set(ev.user.id, ev.user); stopRingback(); } // they will send us an offer
      else if (ev.type === 'rtc') onSignal(ev.from, ev.data || {});
      else if (ev.type === 'rtc-leave') dropPeer(ev.user);
    }
  };
  window.addEventListener('pagehide', () => {
    if (state) navigator.sendBeacon('/api/calls/' + encodeURIComponent(state.room) + '/leave', new Blob(['{}'], { type: 'application/json' }));
  });
})();
