'use strict';
(function () {
  const { h, get, post, del, upload, ago, date, bytes, avatar, toast, errorText } = window.W;
  const $ = (s) => document.querySelector(s);
  const app = $('#app');
  const S = { config: null, me: null, unread: new Map(), requests: 0, cleanup: null, es: null, feedTab: 'all', listeners: new Set(), activeRoom: null };

  /* ---------- small shared pieces ---------- */
  const SVG = 'http://www.w3.org/2000/svg';
  function mark() {
    const s = document.createElementNS(SVG, 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', '26'); s.setAttribute('height', '26'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('class', 'mark');
    const c = document.createElementNS(SVG, 'circle'); c.setAttribute('cx', '12'); c.setAttribute('cy', '12'); c.setAttribute('r', '9.5'); c.setAttribute('fill', 'none'); c.setAttribute('stroke', 'currentColor'); c.setAttribute('stroke-width', '2.4');
    const p = document.createElementNS(SVG, 'path'); p.setAttribute('d', 'M2.5 12h19'); p.setAttribute('stroke', 'currentColor'); p.setAttribute('stroke-width', '2.4');
    const g = document.createElementNS(SVG, 'rect'); g.setAttribute('x', '9'); g.setAttribute('y', '9'); g.setAttribute('width', '6'); g.setAttribute('height', '6'); g.setAttribute('fill', 'currentColor');
    s.append(c, p, g); return s;
  }
  const link = (href, kids, cls) => h('a', { href, class: cls }, kids);
  const empty = (title, text, action) => h('div', { class: 'empty' }, h('h2', { class: 'serif' }, title), text && h('p', null, text), action);
  const spinner = () => h('p', { class: 'mono muted loading' }, 'Loading');
  const field = (label, input, hint) => h('label', { class: 'field' }, h('span', { class: 'mono label' }, label), input, hint && h('span', { class: 'hint' }, hint));

  const dlg = () => $('#dlg');
  function openDialog(content) { const d = dlg(); d.replaceChildren(content); if (!d.open) d.showModal(); return d; }
  function closeDialog() { const d = dlg(); if (d.open) d.close(); }
  function confirmBox(title, text, label) {
    return new Promise((resolve) => {
      const d = dlg(); let done = false;
      const finish = (v) => { if (done) return; done = true; d.removeEventListener('close', onClose); if (d.open) d.close(); resolve(v); };
      const onClose = () => finish(false);
      d.addEventListener('close', onClose);
      openDialog(h('div', { class: 'dlg' }, h('h2', { class: 'serif' }, title), text && h('p', null, text),
        h('div', { class: 'dlg-actions' }, h('button', { class: 'btn', type: 'button', onclick: () => finish(false) }, 'Cancel'), h('button', { class: 'btn danger', type: 'button', onclick: () => finish(true) }, label))));
    });
  }
  function formDialog(title, fields, submitLabel, onSubmit, intro) {
    const err = h('p', { class: 'form-error', role: 'alert' });
    const btn = h('button', { class: 'btn primary', type: 'submit' }, submitLabel);
    const form = h('form', { class: 'dlg', novalidate: '' }, h('h2', { class: 'serif' }, title), intro && h('p', null, intro), fields, err,
      h('div', { class: 'dlg-actions' }, h('button', { class: 'btn', type: 'button', onclick: closeDialog }, 'Cancel'), btn));
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); err.textContent = ''; btn.disabled = true;
      try { await onSubmit(); } catch (x) { err.textContent = errorText(x); btn.disabled = false; }
    });
    openDialog(form);
    const first = form.querySelector('input,textarea'); if (first) first.focus();
    return form;
  }

  /* ---------- media ---------- */
  const flatObserver = new IntersectionObserver((es) => es.forEach((e) => { if (!e.isIntersecting) e.target.pause(); }), { threshold: 0.1 });
  document.addEventListener('play', (e) => {
    document.querySelectorAll('video').forEach((v) => { if (v !== e.target && !v.paused) v.pause(); });
  }, true);
  function flatVideo(src) {
    const v = h('video', { controls: '', playsinline: '', preload: 'metadata', src });
    const frame = h('div', { class: 'frame' }, v);
    v.addEventListener('error', () => frame.replaceChildren(h('p', { class: 'v360-note' }, 'This video is unavailable.')));
    flatObserver.observe(v);
    return frame;
  }
  function mediaFor(post, players) {
    if (!post.media) return null;
    if (post.is360) { const p = window.W.player360(post.media); players.push(p); return p.el; }
    return flatVideo(post.media);
  }

  /* ---------- posts ---------- */
  function reportDialog(post) {
    const why = h('textarea', { rows: '3', maxlength: '200', required: '' });
    formDialog('Report this post', field('What is wrong with it?', why), 'Send report', async () => {
      if (!why.value.trim()) throw new Error('Say what is wrong.');
      await post_('/api/posts/' + post.id + '/report', { reason: why.value }); closeDialog(); toast('Reported. The admin will take a look.');
    });
  }
  const post_ = post; // post() is shadowed by parameter names below
  function postCard(p, ctx) {
    const mine = p.user.id === S.me.id, isAdmin = S.me.role === 'admin';
    const card = h('article', { class: 'entry' });
    const likeBtn = h('button', { class: 'lnk', type: 'button', 'aria-pressed': String(p.liked) });
    const setLike = () => { likeBtn.textContent = (p.liked ? 'Liked ' : 'Like ') + p.likes; likeBtn.setAttribute('aria-pressed', String(p.liked)); };
    setLike();
    likeBtn.addEventListener('click', async () => {
      try { const r = await post_('/api/posts/' + p.id + '/like'); p.liked = r.liked; p.likes = r.likes; setLike(); } catch (e) { toast(errorText(e), true); }
    });
    const comments = h('div', { class: 'comments', hidden: true });
    const cBtn = h('button', { class: 'lnk', type: 'button', 'aria-expanded': 'false' }, 'Comments ' + p.comments);
    let loaded = false;
    cBtn.addEventListener('click', async () => {
      comments.hidden = !comments.hidden; cBtn.setAttribute('aria-expanded', String(!comments.hidden));
      if (comments.hidden || loaded) return;
      loaded = true; comments.replaceChildren(spinner());
      try {
        const r = await get('/api/posts/' + p.id + '/comments');
        const list = h('div', { class: 'comment-list' });
        const add = (c) => list.append(h('p', { class: 'comment' }, link('#/u/' + c.user.handle, c.user.name, 'who'), ' ', c.text));
        r.comments.forEach(add);
        const input = h('input', { type: 'text', maxlength: '300', placeholder: 'Add a comment', 'aria-label': 'Add a comment' });
        const form = h('form', { class: 'inline-form' }, input, h('button', { class: 'btn sm', type: 'submit' }, 'Post'));
        form.addEventListener('submit', async (e) => {
          e.preventDefault(); const text = input.value.trim(); if (!text) return;
          try { const r2 = await post_('/api/posts/' + p.id + '/comments', { text }); add(r2.comment); input.value = ''; p.comments++; cBtn.textContent = 'Comments ' + p.comments; } catch (x) { toast(errorText(x), true); }
        });
        comments.replaceChildren(list, form);
      } catch (e) { loaded = false; comments.replaceChildren(h('p', { class: 'form-error' }, errorText(e))); }
    });
    const actions = h('div', { class: 'entry-actions' }, likeBtn, cBtn);
    if (mine || isAdmin) {
      actions.append(h('button', { class: 'lnk danger-text', type: 'button', onclick: async () => {
        if (!(await confirmBox('Delete this post?', mine ? 'The post and its video will be removed for good.' : 'You are removing this as an admin. The video is deleted too.', 'Delete'))) return;
        try { await del('/api/posts/' + p.id); card.remove(); if (ctx && ctx.onRemove) ctx.onRemove(); toast('Post deleted'); } catch (e) { toast(errorText(e), true); }
      } }, 'Delete'));
    }
    if (!mine) actions.append(h('button', { class: 'lnk', type: 'button', onclick: () => reportDialog(p) }, 'Report'));
    card.append(
      h('header', { class: 'entry-head' }, link('#/u/' + p.user.handle, avatar(p.user, 38), 'avatar-link'),
        h('div', { class: 'entry-who' }, link('#/u/' + p.user.handle, p.user.name, 'name'), h('span', { class: 'mono muted' }, '@' + p.user.handle)),
        h('time', { class: 'mono muted', datetime: new Date(p.created_at).toISOString() }, ago(p.created_at))),
      mediaFor(p, ctx.players),
      (p.game || p.is360) && h('p', { class: 'tags' }, p.game && h('span', { class: 'tag plain' }, p.game), p.is360 && h('span', { class: 'tag' }, '360°')),
      p.text && h('p', { class: 'caption' }, p.text),
      actions, comments);
    return card;
  }

  function composeDialog(onPosted) {
    const maxMb = S.config.maxUploadMb;
    const text = h('textarea', { rows: '3', maxlength: '500', placeholder: 'What happened in this clip?' });
    const game = h('input', { type: 'text', maxlength: '60', placeholder: 'Game or app (optional)' });
    const file = h('input', { type: 'file', accept: 'video/mp4,video/webm,.mp4,.webm', class: 'vh' });
    const picked = h('span', { class: 'muted' }, 'No video chosen');
    const preview = h('video', { class: 'preview', controls: '', muted: '', playsinline: '', hidden: true });
    const is360 = h('input', { type: 'checkbox' });
    const bar = h('progress', { max: '100', value: '0', hidden: true });
    let chosen = null;
    file.addEventListener('change', () => {
      const f = file.files[0]; if (!f) return;
      if (f.size > maxMb * 1048576) { toast('That file is ' + bytes(f.size) + '. The limit here is ' + maxMb + ' MB, so trim or compress it first.', true); file.value = ''; return; }
      chosen = f; picked.textContent = f.name + ' (' + bytes(f.size) + ')';
      preview.src = URL.createObjectURL(f); preview.hidden = false;
    });
    const form = formDialog('Post a clip', [
      field('Caption', text),
      field('Game', game),
      h('div', { class: 'field' }, h('span', { class: 'mono label' }, 'Video'),
        h('label', { class: 'btn file-btn' }, 'Choose MP4 or WebM', file), picked, preview,
        h('span', { class: 'hint' }, 'Up to ' + maxMb + ' MB. Videos stay private to members of this site.')),
      h('label', { class: 'check' }, is360, h('span', null, 'This is a 360° video (equirectangular, 2:1). Viewers can look around.')),
      bar
    ], 'Post', async () => {
      if (!text.value.trim() && !chosen) throw new Error('Add a caption or choose a video.');
      let media = null;
      if (chosen) { bar.hidden = false; media = (await upload(chosen, (f) => { bar.value = f * 100; })).id; }
      await post_('/api/posts', { text: text.value, game: game.value, media, is360: is360.checked });
      closeDialog(); toast('Posted'); onPosted();
    });
    return form;
  }

  /* ---------- people ---------- */
  function relControls(u, onChange) {
    const wrap = h('span', { class: 'rel' });
    const paint = () => {
      wrap.replaceChildren();
      if (u.self) return;
      wrap.append(h('button', { class: 'btn sm' + (u.following ? '' : ' primary'), type: 'button', 'aria-pressed': String(!!u.following), onclick: async () => {
        try { u.following = (await post_('/api/follow/' + u.id)).following; paint(); onChange && onChange(); } catch (e) { toast(errorText(e), true); }
      } }, u.following ? 'Following' : 'Follow'));
      const label = { none: 'Add friend', pending_out: 'Requested', pending_in: 'Accept request', friends: 'Friends' }[u.friend];
      wrap.append(h('button', { class: 'btn sm', type: 'button', onclick: async () => {
        try {
          if (u.friend === 'none' || u.friend === 'pending_in') u.friend = (await post_('/api/friends/' + u.id)).friend;
          else if (u.friend === 'pending_out') { await del('/api/friends/' + u.id); u.friend = 'none'; }
          else if (await confirmBox('Remove ' + u.name + ' as a friend?', 'You will not be able to message or call each other until you are friends again.', 'Remove')) { await del('/api/friends/' + u.id); u.friend = 'none'; }
          paint(); refreshBadges(); onChange && onChange();
        } catch (e) { toast(errorText(e), true); }
      }, title: u.friend === 'pending_out' ? 'Click to cancel the request' : null }, label));
    };
    paint(); return wrap;
  }
  const personRow = (u, extra) => h('li', { class: 'row' }, link('#/u/' + u.handle, avatar(u, 44), 'avatar-link'),
    h('div', { class: 'grow' }, link('#/u/' + u.handle, u.name, 'name'), h('div', { class: 'mono muted' }, '@' + u.handle), u.bio && h('div', { class: 'bio' }, u.bio)), extra);

  async function peopleView(view) {
    const results = h('ul', { class: 'rows' }), q = h('input', { type: 'search', placeholder: 'Search by name or username', 'aria-label': 'Search people' });
    view.replaceChildren(h('h1', { class: 'serif' }, 'People'), h('div', { class: 'search' }, q), results);
    let timer, seq = 0;
    const load = async () => {
      const mine = ++seq;
      try {
        const r = await get('/api/users?q=' + encodeURIComponent(q.value.trim()));
        if (mine !== seq) return;
        results.replaceChildren(...(r.users.length ? r.users.map((u) => personRow(u, relControls(u))) : [h('li', { class: 'empty-row' }, q.value ? 'Nobody matches that.' : 'Nobody else has joined yet. Invite some friends.')]));
      } catch (e) { results.replaceChildren(h('li', { class: 'form-error' }, errorText(e))); }
    };
    q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 250); });
    results.append(spinner()); load();
  }

  async function friendsView(view) {
    view.replaceChildren(h('h1', { class: 'serif' }, 'Friends'), spinner());
    const r = await get('/api/friends');
    const reload = () => friendsView(view).catch((e) => view.replaceChildren(h('p', { class: 'form-error' }, errorText(e))));
    const sections = [];
    if (r.incoming.length) sections.push(h('section', null, h('h2', { class: 'mono sect' }, 'Requests'), h('ul', { class: 'rows' }, r.incoming.map((u) => personRow(u, h('span', { class: 'rel' },
      h('button', { class: 'btn sm primary', type: 'button', onclick: async () => { try { await post_('/api/friends/' + u.id); toast('You and ' + u.name + ' are friends'); refreshBadges(); reload(); } catch (e) { toast(errorText(e), true); } } }, 'Accept'),
      h('button', { class: 'btn sm', type: 'button', onclick: async () => { try { await del('/api/friends/' + u.id); refreshBadges(); reload(); } catch (e) { toast(errorText(e), true); } } }, 'Decline')))))));
    sections.push(h('section', null, h('h2', { class: 'mono sect' }, 'Your friends'),
      r.friends.length ? h('ul', { class: 'rows' }, r.friends.map((u) => {
        const n = S.unread.get(u.room) || 0;
        return personRow(u, h('span', { class: 'rel' },
          link('#/chat/' + u.room, ['Message', n ? h('span', { class: 'count' }, n) : null], 'btn sm primary'),
          h('button', { class: 'btn sm', type: 'button', onclick: () => startCall('/api/calls', { to: u.id }, 'Call with ' + u.name) }, 'Call')));
      })) : empty('No friends yet', 'Find people you know and send a request. Friends can message and call each other.', link('#/people', 'Find people', 'btn primary'))));
    if (r.outgoing.length) sections.push(h('section', null, h('h2', { class: 'mono sect' }, 'Waiting for a reply'), h('ul', { class: 'rows' }, r.outgoing.map((u) => personRow(u, h('button', { class: 'btn sm', type: 'button', onclick: async () => { try { await del('/api/friends/' + u.id); reload(); } catch (e) { toast(errorText(e), true); } } }, 'Cancel request'))))));
    view.replaceChildren(h('div', { class: 'page-head' }, h('h1', { class: 'serif tight grow' }, 'Friends'), h('button', { class: 'btn sm', type: 'button', onclick: () => window.W.call.test() }, 'Test camera and mic')), sections);
    S.requests = r.incoming.length; paintBadges();
  }

  async function startCall(url, body, title) {
    if (window.W.call.active()) return toast('You are already in a call.', true);
    try { const r = await post_(url, body); window.W.call.open(r.room, title, S.me, { caller: true }); } catch (e) { toast(errorText(e), true); }
  }

  /* ---------- chat (direct messages and groups) ---------- */
  async function chatPanel(room, opts) {
    const wrap = h('section', { class: 'chat' });
    const list = h('div', { class: 'msgs', role: 'log', 'aria-live': 'polite', tabindex: '0', 'aria-label': 'Messages' });
    const seen = new Set();
    let oldest = 0;
    const render = (m) => {
      const mine = m.user.id === S.me.id;
      return h('div', { class: 'msg' + (mine ? ' mine' : '') }, avatar(m.user, 32),
        h('div', { class: 'msg-body' }, h('div', { class: 'msg-head' }, h('span', { class: 'name' }, mine ? 'You' : m.user.name), h('time', { class: 'mono muted' }, ago(m.created_at))),
          m.text && h('p', null, m.text), m.media && flatVideo(m.media)));
    };
    const add = (m, atTop) => {
      if (seen.has(m.id)) return; seen.add(m.id);
      const el = render(m);
      if (atTop) list.insertBefore(el, earlier.isConnected ? earlier.nextSibling : list.firstChild); else list.append(el);
      if (!oldest || m.id < oldest) oldest = m.id;
    };
    const stick = () => { list.scrollTop = list.scrollHeight; };
    const first = await get('/api/chat/' + encodeURIComponent(room));
    first.messages.forEach((m) => add(m));
    const earlier = h('button', { class: 'btn sm', type: 'button', onclick: async () => {
      try {
        const r = await get('/api/chat/' + encodeURIComponent(room) + '?before=' + oldest);
        const prev = list.scrollHeight; [...r.messages].reverse().forEach((m) => add(m, true)); list.scrollTop = list.scrollHeight - prev;
        if (r.messages.length < 60) earlier.remove();
      } catch (e) { toast(errorText(e), true); }
    } }, 'Show earlier messages');
    if (first.messages.length >= 60) list.prepend(earlier);
    if (!first.messages.length) list.append(h('p', { class: 'muted empty-row', id: 'no-msgs' }, 'No messages yet. Say hello.'));

    const input = h('input', { type: 'text', maxlength: '1000', placeholder: 'Write a message', 'aria-label': 'Message', autocomplete: 'off' });
    const file = h('input', { type: 'file', accept: 'video/mp4,video/webm,.mp4,.webm', class: 'vh' });
    const status = h('span', { class: 'mono muted' });
    const send = async (media) => {
      const text = input.value.trim(); if (!text && !media) return;
      try { const r = await post_('/api/chat/' + encodeURIComponent(room), { text, media }); input.value = ''; const n = $('#no-msgs'); if (n) n.remove(); add(r.message); stick(); } catch (e) { toast(errorText(e), true); }
    };
    file.addEventListener('change', async () => {
      const f = file.files[0]; file.value = ''; if (!f) return;
      if (f.size > S.config.maxUploadMb * 1048576) return toast('That video is over the ' + S.config.maxUploadMb + ' MB limit.', true);
      try { const up = await upload(f, (p) => { status.textContent = 'Uploading ' + Math.round(p * 100) + '%'; }); status.textContent = ''; await send(up.id); } catch (e) { status.textContent = ''; toast(errorText(e), true); }
    });
    const form = h('form', { class: 'composer' }, input, h('label', { class: 'btn file-btn', title: 'Send a video' }, 'Video', file), h('button', { class: 'btn primary', type: 'submit' }, 'Send'), status);
    form.addEventListener('submit', (e) => { e.preventDefault(); send(null); });
    wrap.append(list, form);
    const listener = (ev) => { if (ev.message.room === room) { const n = $('#no-msgs'); if (n) n.remove(); const nearEnd = list.scrollHeight - list.scrollTop - list.clientHeight < 120; add(ev.message); if (nearEnd) stick(); } };
    S.listeners.add(listener);
    S.activeRoom = room; S.unread.delete(room); paintBadges();
    setTimeout(stick, 0);
    return { el: wrap, destroy() { S.listeners.delete(listener); if (S.activeRoom === room) S.activeRoom = null; } };
  }

  async function dmView(view, room) {
    const fr = await get('/api/friends'), other = fr.friends.find((f) => f.room === room);
    if (!other) { view.replaceChildren(h('h1', { class: 'serif' }, 'Messages'), empty('You are not friends yet', 'Messages and calls work between friends.', link('#/people', 'Find people', 'btn primary'))); return; }
    const panel = await chatPanel(room);
    view.replaceChildren(link('#/friends', 'Back to friends', 'back mono'),
      h('div', { class: 'page-head' }, link('#/u/' + other.handle, avatar(other, 48), 'avatar-link'), h('div', { class: 'grow' }, h('h1', { class: 'serif tight' }, other.name), h('span', { class: 'mono muted' }, '@' + other.handle)),
        h('button', { class: 'btn', type: 'button', onclick: () => startCall('/api/calls', { to: other.id }, 'Call with ' + other.name) }, 'Call')), panel.el);
    return panel.destroy;
  }

  /* ---------- groups ---------- */
  async function groupsView(view) {
    view.replaceChildren(h('h1', { class: 'serif' }, 'Groups'), spinner());
    const r = await get('/api/groups');
    const reload = () => groupsView(view);
    const make = h('button', { class: 'btn primary', type: 'button', onclick: () => {
      const name = h('input', { type: 'text', maxlength: '60', required: '' }), desc = h('textarea', { rows: '2', maxlength: '200' });
      formDialog('New group', [field('Name', name), field('What is it for?', desc)], 'Create group', async () => {
        if (!name.value.trim()) throw new Error('Give the group a name.');
        const g = await post_('/api/groups', { name: name.value, description: desc.value }); closeDialog(); location.hash = '#/group/' + g.id;
      });
    } }, 'New group');
    view.replaceChildren(h('div', { class: 'page-head' }, h('h1', { class: 'serif tight grow' }, 'Groups'), make),
      r.groups.length ? h('ul', { class: 'rows' }, r.groups.map((g) => h('li', { class: 'row' },
        h('div', { class: 'grow' }, link('#/group/' + g.id, g.name, 'name'), h('div', { class: 'mono muted' }, g.members + (g.members === 1 ? ' member' : ' members')), g.description && h('div', { class: 'bio' }, g.description)),
        h('span', { class: 'rel' }, link('#/group/' + g.id, g.member ? 'Open' : 'Look', 'btn sm'),
          !g.member && h('button', { class: 'btn sm primary', type: 'button', onclick: async () => { try { await post_('/api/groups/' + g.id + '/join'); reload(); } catch (e) { toast(errorText(e), true); } } }, 'Join')))))
        : empty('No groups yet', 'Start one for a game, a headset, or just your friends.'));
  }
  async function groupView(view, id) {
    const r = await get('/api/groups/' + id), g = r.group;
    let panel = null;
    const reload = () => { if (panel) panel.destroy(); route(); };
    const head = h('div', { class: 'page-head' }, h('div', { class: 'grow' }, h('h1', { class: 'serif tight' }, g.name), g.description && h('p', { class: 'bio' }, g.description), h('span', { class: 'mono muted' }, r.members.length + (r.members.length === 1 ? ' member' : ' members'))));
    const acts = h('div', { class: 'rel' });
    if (g.member) {
      acts.append(h('button', { class: 'btn', type: 'button', onclick: () => startCall('/api/calls/group/' + g.id, {}, g.name) }, 'Group call'),
        h('button', { class: 'btn', type: 'button', onclick: async () => { try { await post_('/api/groups/' + g.id + '/leave'); reload(); } catch (e) { toast(errorText(e), true); } } }, 'Leave'));
    } else acts.append(h('button', { class: 'btn primary', type: 'button', onclick: async () => { try { await post_('/api/groups/' + g.id + '/join'); reload(); } catch (e) { toast(errorText(e), true); } } }, 'Join group'));
    if (g.mine || S.me.role === 'admin') acts.append(h('button', { class: 'btn danger', type: 'button', onclick: async () => {
      if (!(await confirmBox('Delete this group?', 'The group and all its messages go away for everyone.', 'Delete group'))) return;
      try { await del('/api/groups/' + g.id); location.hash = '#/groups'; } catch (e) { toast(errorText(e), true); }
    } }, 'Delete'));
    head.append(acts);
    const members = h('details', { class: 'members' }, h('summary', { class: 'mono' }, 'Members'), h('ul', { class: 'chips' }, r.members.map((m) => h('li', null, link('#/u/' + m.handle, [avatar(m, 22), m.name], 'chip')))));
    view.replaceChildren(link('#/groups', 'All groups', 'back mono'), head, members);
    if (g.member) { panel = await chatPanel(g.room); view.append(panel.el); return panel.destroy; }
    view.append(empty('Join to read and write', 'Group messages are only visible to members.'));
  }

  /* ---------- profiles ---------- */
  async function profileView(view, handle) {
    const r = await get('/api/users/' + encodeURIComponent(handle)), u = r.user, mine = u.id === S.me.id;
    const players = [], list = h('div', { class: 'entries' }), more = h('div', { class: 'more' });
    let next = r.next;
    const addPosts = (posts) => posts.forEach((p) => list.append(postCard(p, { players })));
    const paintMore = () => more.replaceChildren(next ? h('button', { class: 'btn', type: 'button', onclick: async () => {
      try { const x = await get('/api/users/' + encodeURIComponent(handle) + '?before=' + next); addPosts(x.posts); next = x.next; paintMore(); } catch (e) { toast(errorText(e), true); }
    } }, 'Older posts') : null);
    view.replaceChildren(
      h('div', { class: 'profile' }, avatar(u, 84), h('div', { class: 'grow' }, h('h1', { class: 'serif tight' }, u.name), h('div', { class: 'mono muted' }, '@' + u.handle + ' · joined ' + date(u.created_at)), u.bio && h('p', { class: 'bio' }, u.bio),
        h('p', { class: 'mono counts' }, r.counts.posts + ' posts · ' + r.counts.followers + ' followers · ' + r.counts.following + ' following'),
        mine ? link('#/me', 'Edit profile', 'btn sm') : h('div', { class: 'rel' }, relControls(u), u.friend === 'friends' && link('#/chat/d:' + Math.min(u.id, S.me.id) + '-' + Math.max(u.id, S.me.id), 'Message', 'btn sm'), u.friend === 'friends' && h('button', { class: 'btn sm', type: 'button', onclick: () => startCall('/api/calls', { to: u.id }, 'Call with ' + u.name) }, 'Call')))),
      h('h2', { class: 'mono sect' }, 'Posts'), list, more);
    if (!r.posts.length) list.append(empty(mine ? 'You have not posted yet' : 'No posts yet', mine ? 'Share your first clip.' : null, mine ? h('button', { class: 'btn primary', type: 'button', onclick: () => composeDialog(route) }, 'Post a clip') : null));
    addPosts(r.posts); paintMore();
    return () => players.forEach((p) => p.destroy());
  }

  function callsBox() {
    const on = h('input', { type: 'checkbox', checked: window.W.sound.enabled });
    on.addEventListener('change', () => { window.W.sound.enabled = on.checked; if (on.checked) window.W.sound.play('message'); });
    return h('div', { class: 'stack' }, h('label', { class: 'check' }, on, h('span', null, 'Play sounds for calls, messages and friend requests')),
      h('div', null, h('button', { class: 'btn', type: 'button', onclick: () => window.W.call.test() }, 'Test camera, microphone and sound')));
  }
  async function settingsView(view) {
    const me = (await get('/api/me')).user;
    const name = h('input', { type: 'text', maxlength: '40', value: me.name, required: '' }), bio = h('textarea', { rows: '3', maxlength: '200' }, me.bio || '');
    const handle = h('input', { type: 'text', maxlength: '20', value: me.handle, pattern: '[A-Za-z0-9_]{3,20}', required: '' });
    let avatarId, avatarUrl = me.avatar;
    const pic = h('div', { class: 'pic' });
    const paintPic = () => pic.replaceChildren(avatar({ id: me.id, name: name.value || me.name, avatar: avatarUrl }, 72));
    const file = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', class: 'vh' });
    file.addEventListener('change', async () => {
      const f = file.files[0]; file.value = ''; if (!f) return;
      try { const up = await upload(f); avatarId = up.id; avatarUrl = up.url; paintPic(); } catch (e) { toast(errorText(e), true); }
    });
    paintPic();
    const err = h('p', { class: 'form-error', role: 'alert' });
    const form = h('form', { class: 'stack' }, h('div', { class: 'row-flex' }, pic, h('label', { class: 'btn file-btn' }, 'Change photo', file),
      h('button', { class: 'btn', type: 'button', onclick: () => { avatarId = null; avatarUrl = null; paintPic(); } }, 'Remove photo')),
      field('Name', name), field('Username', handle, 'Letters, numbers and underscores. This is what others search for.'), field('Bio', bio, 'A line or two about what you play.'), err, h('div', null, h('button', { class: 'btn primary', type: 'submit' }, 'Save')));
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); err.textContent = '';
      try {
        const body = { name: name.value, bio: bio.value, handle: handle.value }; if (avatarId !== undefined) body.avatar = avatarId;
        await post_('/api/me', body); S.me = (await get('/api/me')).user; toast('Saved'); paintHeader();
      } catch (x) { err.textContent = errorText(x); }
    });

    const providers = S.config.providers || {}, linked = new Map(me.identities.map((i) => [i.provider, i]));
    const methods = ['google', 'apple'].filter((p) => providers[p] || linked.has(p)).map((p) => {
      const label = p === 'google' ? 'Google' : 'Apple', on = linked.get(p);
      return h('li', { class: 'row' }, h('div', { class: 'grow' }, h('strong', null, label), h('div', { class: 'mono muted' }, on ? 'Connected' + (on.email ? ' as ' + on.email : '') : 'Not connected')),
        on ? h('button', { class: 'btn sm', type: 'button', onclick: async () => { try { await post_('/api/me/identities/' + p + '/disconnect'); toast(label + ' disconnected'); route(); } catch (x) { toast(errorText(x), true); } } }, 'Disconnect')
          : h('button', { class: 'btn sm primary', type: 'button', onclick: () => { location.href = '/auth/' + p + '/start?link=1'; } }, 'Connect'));
    });

    const cur = me.hasPassword ? h('input', { type: 'password', autocomplete: 'current-password' }) : null;
    const nw = h('input', { type: 'password', autocomplete: 'new-password', minlength: '8' }), perr = h('p', { class: 'form-error', role: 'alert' });
    const pw = h('form', { class: 'stack' }, cur && field('Current password', cur), field(me.hasPassword ? 'New password' : 'Password', nw, 'At least 8 characters.' + (me.hasPassword ? '' : ' You can then also sign in with your email address (' + me.email + ').')), perr,
      h('div', null, h('button', { class: 'btn', type: 'submit' }, me.hasPassword ? 'Change password' : 'Add a password')));
    pw.addEventListener('submit', async (e) => {
      e.preventDefault(); perr.textContent = '';
      try { await post_('/api/me/password', { current: cur ? cur.value : undefined, next: nw.value }); toast(me.hasPassword ? 'Password changed' : 'Password added'); route(); } catch (x) { perr.textContent = errorText(x); }
    });
    view.replaceChildren(h('h1', { class: 'serif' }, 'Your profile'), form,
      methods.length ? [h('h2', { class: 'mono sect' }, 'Sign-in methods'), h('ul', { class: 'rows' }, methods)] : null,
      h('h2', { class: 'mono sect' }, 'Calls and sound'), callsBox(),
      h('h2', { class: 'mono sect' }, 'Password'), pw,
      h('h2', { class: 'mono sect' }, 'Your data'), dataBox(me),
      h('h2', { class: 'mono sect' }, 'Session'), h('button', { class: 'btn', type: 'button', onclick: signOut }, 'Sign out'));
  }

  /* ---------- feed ---------- */
  async function feedView(view) {
    const players = [], list = h('div', { class: 'entries' }), more = h('div', { class: 'more' });
    let next = null, seq = 0;
    const tabBtn = (id, label) => h('button', { class: 'tab', type: 'button', 'aria-pressed': String(S.feedTab === id), onclick: () => { S.feedTab = id; route(); } }, label);
    view.replaceChildren(h('div', { class: 'page-head' }, h('h1', { class: 'serif tight grow' }, 'Clips'), h('button', { class: 'btn primary', type: 'button', onclick: () => composeDialog(route) }, 'Post a clip')),
      h('div', { class: 'tabs-inline', role: 'group', 'aria-label': 'Feed' }, tabBtn('all', 'Everyone'), tabBtn('following', 'Following')), list, more);
    const load = async (before) => {
      const mine = ++seq;
      const r = await get('/api/feed?tab=' + (S.feedTab === 'following' ? 'following' : 'all') + (before ? '&before=' + before : ''));
      if (mine !== seq) return;
      r.posts.forEach((p) => list.append(postCard(p, { players })));
      next = r.next;
      more.replaceChildren(next ? h('button', { class: 'btn', type: 'button', onclick: async (e) => { e.target.disabled = true; try { await load(next); } catch (x) { toast(errorText(x), true); e.target.disabled = false; } } }, 'Older posts') : null);
      if (!list.children.length) list.append(S.feedTab === 'following'
        ? empty('Nothing from people you follow yet', 'Follow a few people and their clips will show up here.', link('#/people', 'Find people', 'btn primary'))
        : empty('No clips yet', 'Be the first. Post a short clip of something you played.', h('button', { class: 'btn primary', type: 'button', onclick: () => composeDialog(route) }, 'Post a clip')));
    };
    await load();
    return () => { seq++; players.forEach((p) => p.destroy()); };
  }

  /* ---------- admin ---------- */
  /* ---------- policy links, launch checklist, your data, restart wait ---------- */
  const legalLinks = () => h('nav', { class: 'foot-links', 'aria-label': 'Policies' }, [['Rules', '/rules'], ['Terms', '/terms'], ['Privacy', '/privacy'], ['Contact', '/contact']].map(([l, href]) => h('a', { href }, l)));
  function launchBox(l) {
    return h('section', { class: 'launch' }, h('h2', { class: 'mono sect first' }, l.ready ? 'Ready to publish' : 'Before you publish'),
      l.ready ? h('p', { class: 'muted' }, 'The must-do items are done. The optional ones below are worth a look.') : h('p', { class: 'muted' }, 'Finish the "To do" items, then your site is ready to open to the public.'),
      h('ul', { class: 'checks' }, l.items.map((i) => h('li', { class: 'check-item ' + (i.ok ? 'done' : i.required ? 'todo' : 'opt') },
        h('span', { class: 'mono state' }, i.ok ? 'Done' : i.required ? 'To do' : 'Optional'), h('div', null, h('strong', null, i.label), !i.ok && h('div', { class: 'hint' }, i.hint))))));
  }
  function deleteDialog(me) {
    const input = h('input', { type: me.hasPassword ? 'password' : 'text', autocomplete: me.hasPassword ? 'current-password' : 'off' });
    formDialog('Delete your account?', field(me.hasPassword ? 'Your password' : 'Type your username (' + me.handle + ')', input, 'This removes your profile, posts, videos, messages and any groups you started. It cannot be undone.'), 'Delete my account', async () => {
      await post_('/api/me/delete', { confirm: input.value }); closeDialog(); location.hash = '#/'; location.reload();
    });
  }
  function dataBox(me) {
    return h('div', { class: 'stack' }, h('p', { class: 'muted' }, 'You can download a copy of what the site holds about you, or delete your account and everything you posted. Deleting is permanent.'),
      h('div', { class: 'row-flex' }, h('a', { class: 'btn', href: '/api/me/export', download: 'my-data.json' }, 'Download my data'),
        me.role === 'admin' ? h('span', { class: 'muted' }, "The owner account can't be deleted from here.") : h('button', { class: 'btn danger', type: 'button', onclick: () => deleteDialog(me) }, 'Delete my account')));
  }
  function waitForRestart(message) {
    const old = S.config.startedAt, t0 = Date.now();
    document.body.append(h('div', { class: 'overlay', role: 'alert' }, h('div', null, h('h2', { class: 'serif' }, message), h('p', { class: 'muted' }, 'The site restarts for a few seconds. This page reloads by itself.'))));
    (async function poll() {
      await new Promise((r) => setTimeout(r, 1200));
      try { const c = await (await fetch('/api/config', { cache: 'no-store' })).json(); if (c.startedAt && c.startedAt !== old) { location.reload(); return; } } catch (e) { /* still restarting */ }
      if (Date.now() - t0 > 90000) { document.querySelector('.overlay p').textContent = 'This is taking longer than expected. Wait a minute, then refresh the page. If the site does not come back, check the launcher window or the server logs.'; return; }
      poll();
    })();
  }

  async function adminView(view) {
    if (S.me.role !== 'admin') { view.replaceChildren(empty('Admins only')); return; }
    const tabs = ['Overview', 'People', 'Reports', 'Posts', 'Invites', 'Settings', 'Policies', 'Site', 'Update'];
    let current = S.adminTab || 'Overview';
    const body = h('div', { class: 'admin-body' });
    const nav = h('div', { class: 'tabs-inline', role: 'group', 'aria-label': 'Admin sections' });
    const paintNav = () => nav.replaceChildren(...tabs.map((t) => h('button', { class: 'tab', type: 'button', 'aria-pressed': String(t === current), onclick: () => { current = t; S.adminTab = t; paintNav(); show(); } }, t)));
    const show = async () => {
      body.replaceChildren(spinner());
      try { body.replaceChildren(await panels[current]()); } catch (e) { body.replaceChildren(h('p', { class: 'form-error' }, errorText(e))); }
    };
    const act = (fn) => async () => { try { await fn(); show(); } catch (e) { toast(errorText(e), true); } };
    const panels = {
      async Overview() {
        const s = await get('/api/admin/stats'), launch = await get('/api/admin/launch');
        const item = (k, v) => h('div', { class: 'stat' }, h('dt', { class: 'mono' }, k), h('dd', { class: 'serif' }, String(v)));
        return h('div', null, launchBox(launch), h('h2', { class: 'mono sect' }, 'The site right now'), h('dl', { class: 'stats' }, item('Members', s.users), item('Waiting for approval', s.pending), item('Banned', s.banned), item('Online now', s.online), item('Posts', s.posts), item('Videos', s.videos),
          item('Comments', s.comments), item('Chat messages', s.messages), item('Groups', s.groups), item('Open reports', s.reports), item('Files stored', s.files), item('Storage used', bytes(s.storage))),
          h('p', { class: 'muted' }, 'Sign-ups are currently: ' + { open: 'open to anyone', approval: 'open, but you approve each person', invite: 'invite only', closed: 'closed' }[s.signup] + '.'));
      },
      async People() {
        const r = await get('/api/admin/users');
        return h('div', { class: 'table-wrap' }, h('table', null, h('thead', null, h('tr', null, ['Person', 'Email', 'Status', 'Posts', 'Joined', ''].map((c) => h('th', { scope: 'col' }, c)))),
          h('tbody', null, r.users.map((u) => {
            const self = u.id === S.me.id;
            return h('tr', null, h('td', null, link('#/u/' + u.handle, u.name, 'name'), h('div', { class: 'mono muted' }, '@' + u.handle + (u.role === 'admin' ? ' · owner' : ''))), h('td', null, u.email),
              h('td', null, u.status), h('td', null, String(u.posts)), h('td', null, date(u.created_at)),
              h('td', { class: 'cell-actions' }, self ? h('span', { class: 'muted' }, 'You') : [
                u.status === 'pending' && h('button', { class: 'btn sm primary', type: 'button', onclick: act(() => post_('/api/admin/users/' + u.id, { status: 'active' })) }, 'Approve'),
                u.status === 'banned' ? h('button', { class: 'btn sm', type: 'button', onclick: act(() => post_('/api/admin/users/' + u.id, { status: 'active' })) }, 'Unban')
                  : u.status === 'active' && h('button', { class: 'btn sm', type: 'button', onclick: async () => { if (await confirmBox('Ban ' + u.name + '?', 'They are signed out and cannot sign back in. Their posts are hidden.', 'Ban')) act(() => post_('/api/admin/users/' + u.id, { status: 'banned' }))(); } }, 'Ban'),
                h('button', { class: 'btn sm', type: 'button', onclick: () => {
                  const np = h('input', { type: 'text', minlength: '8', autocomplete: 'off' });
                  formDialog('Set a new password for ' + u.name, field('New password', np, 'They are signed out everywhere. Tell them the password privately.'), 'Set password', async () => { await post_('/api/admin/users/' + u.id, { password: np.value }); closeDialog(); toast('Password changed'); });
                } }, 'Reset password'),
                h('button', { class: 'btn sm danger', type: 'button', onclick: async () => { if (await confirmBox('Delete ' + u.name + '?', 'Their account, posts, messages and videos are removed for good.', 'Delete account')) act(() => del('/api/admin/users/' + u.id))(); } }, 'Delete')]));
          }))));
      },
      async Reports() {
        const r = await get('/api/admin/reports');
        if (!r.reports.length) return empty('Nothing reported', 'Reports from members show up here.');
        return h('ul', { class: 'rows' }, r.reports.map((x) => h('li', { class: 'row start' }, h('div', { class: 'grow' }, h('div', null, h('strong', null, '@' + x.author), ': ', x.text || '(video only)'), h('div', { class: 'mono muted' }, 'Reported by @' + x.reporter + ' ' + ago(x.created_at)), h('p', null, '“' + x.reason + '”')),
          h('span', { class: 'rel' }, h('button', { class: 'btn sm danger', type: 'button', onclick: async () => { if (await confirmBox('Remove this post?', 'The post and its video are deleted.', 'Remove')) act(async () => { await del('/api/posts/' + x.post_id); })(); } }, 'Remove post'),
            h('button', { class: 'btn sm', type: 'button', onclick: act(() => post_('/api/admin/reports/' + x.id + '/resolve')) }, 'Dismiss')))));
      },
      async Posts() {
        const r = await get('/api/admin/posts');
        if (!r.posts.length) return empty('No posts yet');
        return h('ul', { class: 'rows' }, r.posts.map((p) => h('li', { class: 'row start' }, h('div', { class: 'grow' }, h('div', null, h('strong', null, '@' + p.user.handle), p.media ? ' · video' : '', p.is360 ? ' · 360°' : ''), h('div', null, p.text || '(no caption)'), h('div', { class: 'mono muted' }, ago(p.created_at))),
          h('button', { class: 'btn sm danger', type: 'button', onclick: async () => { if (await confirmBox('Remove this post?', 'The post and its video are deleted.', 'Remove')) act(() => del('/api/posts/' + p.id))(); } }, 'Remove'))));
      },
      async Invites() {
        const r = await get('/api/admin/invites');
        const count = h('input', { type: 'number', min: '1', max: '20', value: '1' }), note = h('input', { type: 'text', maxlength: '80', placeholder: 'Who is it for? (optional)' });
        const mk = h('form', { class: 'inline-form wrap' }, field('How many', count), field('Note', note), h('button', { class: 'btn primary', type: 'submit' }, 'Create invites'));
        mk.addEventListener('submit', async (e) => { e.preventDefault(); try { await post_('/api/admin/invites', { count: +count.value, note: note.value }); show(); } catch (x) { toast(errorText(x), true); } });
        const url = (c) => location.origin + '/#/join/' + c;
        return h('div', null, h('p', { class: 'muted' }, 'Send someone an invite link. Each one works once. Invites are only needed while sign-ups are set to “invite only”.'), mk,
          r.invites.length ? h('ul', { class: 'rows' }, r.invites.map((i) => h('li', { class: 'row' }, h('div', { class: 'grow' }, h('code', null, i.code), h('div', { class: 'mono muted' }, i.used_by ? 'Used by @' + (i.used_by_handle || 'deleted account') : 'Not used yet' + (i.note ? ' · ' + i.note : ''))),
            !i.used_by && h('span', { class: 'rel' }, h('button', { class: 'btn sm', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(url(i.code)); toast('Invite link copied'); } catch (e) { toast(url(i.code)); } } }, 'Copy link'),
              h('button', { class: 'btn sm', type: 'button', onclick: act(() => del('/api/admin/invites/' + i.code)) }, 'Delete'))))) : empty('No invites yet'));
      },
      async Policies() {
        const r = await get('/api/admin/policies');
        const contact = h('input', { type: 'email', maxlength: '120', value: r.contactEmail, placeholder: 'you@yourdomain.com', autocomplete: 'off' });
        const operator = h('input', { type: 'text', maxlength: '120', value: r.operator, placeholder: 'Your name or your company name' });
        const age = h('input', { type: 'number', min: '13', max: '21', value: String(r.minAge) });
        const areas = {};
        const block = (key, label) => {
          areas[key] = h('textarea', { rows: '16', class: 'policy-text', spellcheck: 'true' }, r[key]);
          return h('div', { class: 'field' }, h('span', { class: 'mono label' }, label), areas[key],
            h('div', { class: 'row-flex' }, h('a', { class: 'btn sm', href: '/' + key, target: '_blank', rel: 'noopener' }, 'View the page'),
              h('button', { class: 'btn sm', type: 'button', onclick: async () => {
                if (!(await confirmBox('Reset this page?', 'Your edits to it are replaced with the starting text.', 'Reset'))) return;
                try { const x = await post_('/api/admin/policies/reset', { which: key }); areas[key].value = x.text; toast('Reset to the starting text'); } catch (e) { toast(errorText(e), true); }
              } }, 'Reset to starting text')));
        };
        const err = h('p', { class: 'form-error', role: 'alert' });
        const form = h('form', { class: 'stack' },
          h('p', { class: 'note' }, 'These pages are a plain-language starting point, not legal advice. Read them, make them yours, and ideally have a lawyer look them over before you open the site to the public.'),
          field('Contact email', contact, 'Shown on the Contact page and in the policies. People use it to report problems and ask for takedowns.'),
          field('Your name or company name', operator, 'Who is running the site. Shown in the Terms and Privacy pages.'),
          field('Minimum age', age, 'Between 13 and 21. 16 is a cautious choice. This appears in the sign-up box and the policies.'),
          block('rules', 'Community rules  (/rules)'), block('terms', 'Terms of use  (/terms)'), block('privacy', 'Privacy policy  (/privacy)'),
          h('p', { class: 'hint' }, 'Formatting: "## Heading", "- bullet", a blank line between paragraphs, **bold**. {{site}}, {{operator}}, {{contact}}, {{domain}} and {{min_age}} fill themselves in. Anything written [[like this]] is highlighted on the page and flagged in the launch checklist until you replace it.'),
          err, h('div', null, h('button', { class: 'btn primary', type: 'submit' }, 'Save')));
        form.addEventListener('submit', async (e) => {
          e.preventDefault(); err.textContent = '';
          try { await post_('/api/admin/policies', { contactEmail: contact.value, operator: operator.value, minAge: +age.value, rules: areas.rules.value, terms: areas.terms.value, privacy: areas.privacy.value }); toast('Saved. The pages are updated.'); S.config = await get('/api/config'); } catch (x) { err.textContent = errorText(x); }
        });
        return form;
      },
      async Update() {
        const r = await get('/api/admin/update');
        const needConfirm = (what) => new Promise((resolve) => {
          const box = h('input', { type: S.me.hasPassword ? 'password' : 'text', autocomplete: S.me.hasPassword ? 'current-password' : 'off' });
          formDialog(what, field(S.me.hasPassword ? 'Your password' : 'Type your username (' + S.me.handle + ')', box, 'Only the owner can do this, so the site asks you to confirm.'), 'Continue', async () => { const v = box.value; if (!v) throw new Error('Enter it to continue.'); closeDialog(); resolve(v); });
          dlg().addEventListener('close', () => resolve(null), { once: true });
        });
        const result = h('div');
        const status = h('p', { class: 'muted', role: 'status' });
        const file = h('input', { type: 'file', accept: '.zip,application/zip', class: 'vh' });
        const picked = h('span', { class: 'muted' }, 'No file chosen');
        const checkBtn = h('button', { class: 'btn primary', type: 'button', disabled: true }, 'Check the update');
        let chosen = null;
        file.addEventListener('change', () => { chosen = file.files[0] || null; picked.textContent = chosen ? chosen.name + ' (' + bytes(chosen.size) + ')' : 'No file chosen'; checkBtn.disabled = !chosen; result.replaceChildren(); });
        checkBtn.addEventListener('click', async () => {
          checkBtn.disabled = true; result.replaceChildren(); status.textContent = 'Uploading...';
          try {
            const info = await upload(chosen, (f) => { status.textContent = f < 1 ? 'Uploading ' + Math.round(f * 100) + '%' : 'Checking it and test-starting it. This takes a few seconds...'; }, '/api/admin/update/upload');
            status.textContent = '';
            const list = (label, arr) => arr.length ? h('details', null, h('summary', null, label + ' (' + arr.length + ')'), h('ul', { class: 'file-list mono' }, arr.slice(0, 80).map((f) => h('li', null, f)))) : null;
            result.replaceChildren(h('div', { class: 'upd-card' },
              h('h3', { class: 'serif' }, 'Version ' + info.version + ' is ready to install'), info.notes && h('p', null, info.notes),
              h('ul', { class: 'checks' }, info.checks.map((c) => h('li', { class: 'check-item done' }, h('span', { class: 'mono state' }, 'Passed'), h('div', null, c)))),
              h('p', { class: 'muted' }, info.files.changed.length + ' files changed, ' + info.files.added.length + ' added, ' + info.files.removed.length + ' removed.'),
              list('Changed', info.files.changed), list('Added', info.files.added), list('Removed', info.files.removed),
              h('p', { class: 'hint' }, 'Installing takes a backup of your database, switches to the new version and restarts the site for a few seconds. Your posts, members and videos are not touched, and you can go back afterwards.'),
              h('div', null, h('button', { class: 'btn primary', type: 'button', onclick: async () => {
                const c = await needConfirm('Install version ' + info.version + '?'); if (!c) return;
                try { await post_('/api/admin/update/apply', { id: info.id, confirm: c }); waitForRestart('Installing version ' + info.version); } catch (e) { toast(errorText(e), true); }
              } }, 'Install and restart'))));
          } catch (e) { status.textContent = ''; result.replaceChildren(h('p', { class: 'form-error', role: 'alert' }, errorText(e))); }
          checkBtn.disabled = !chosen;
        });
        const parts = [
          h('p', null, ['You are running version ', h('strong', null, r.running.version), '.', r.running.notes ? ' ' + r.running.notes : '']),
          !r.supervised && h('p', { class: 'note' }, 'Updates are switched off because the site was not started with its launcher. Start it with node server.js, the Start file, or Docker.'),
          r.failed && h('p', { class: 'note' }, 'The last update (' + (r.failed.version || r.failed.id) + ') crashed as it started, so the site went back to the previous version by itself. Nothing was lost.'),
          h('h2', { class: 'mono sect' }, 'Install an update'),
          h('p', { class: 'muted' }, 'Choose the update zip you were given. It is checked and test-started before anything changes. Only install updates from someone you trust: an update is program code that runs on your server.'),
          h('div', { class: 'row-flex' }, h('label', { class: 'btn file-btn' }, 'Choose update zip', file), picked, checkBtn), status, result,
          h('h2', { class: 'mono sect' }, 'Go back'),
          r.previous ? h('div', { class: 'stack' }, h('p', { class: 'muted' }, 'The version before this one (' + r.previous.version + ') is still on the server.'),
            h('div', null, h('button', { class: 'btn', type: 'button', disabled: !r.supervised, onclick: async () => {
              const c = await needConfirm('Go back to version ' + r.previous.version + '?'); if (!c) return;
              try { await post_('/api/admin/update/rollback', { confirm: c }); waitForRestart('Going back to version ' + r.previous.version); } catch (e) { toast(errorText(e), true); }
            } }, 'Go back to version ' + r.previous.version))) : h('p', { class: 'muted' }, 'There is no earlier version to go back to yet.'),
          h('h2', { class: 'mono sect' }, 'Restart and backup'),
          h('div', { class: 'row-flex' },
            h('button', { class: 'btn', type: 'button', disabled: !r.supervised, onclick: async () => { const c = await needConfirm('Restart the site?'); if (!c) return; try { await post_('/api/admin/restart', { confirm: c }); waitForRestart('Restarting'); } catch (e) { toast(errorText(e), true); } } }, 'Restart the site'),
            h('a', { class: 'btn', href: '/api/admin/backup', download: '' }, 'Download a database backup')),
          h('p', { class: 'hint' }, 'The backup holds members, posts, messages and settings. Uploaded videos are in the uploads folder inside your data folder, and are not part of this file. Copy that folder as well to keep everything.'),
          r.history.length ? [h('h2', { class: 'mono sect' }, 'History'), h('ul', { class: 'rows' }, r.history.map((x) => h('li', { class: 'row' }, h('div', { class: 'grow' }, h('strong', null, { update: 'Updated', rollback: 'Went back', 'auto-rollback': 'Went back automatically' }[x.event] || x.event), x.version ? ' to ' + x.version : ''), h('span', { class: 'mono muted' }, ago(x.at))))) ] : null
        ];
        return h('div', { class: 'stack' }, parts);
      },
      async Site() {
        const r = await get('/api/admin/site');
        const name = h('input', { type: 'text', maxlength: '40', value: r.siteName, required: '' }), head = h('input', { type: 'text', maxlength: '120', value: r.headline, placeholder: 'VR clips from people you actually know.' });
        const intro = h('textarea', { rows: '3', maxlength: '400', placeholder: 'Post what you played. Look around inside 360° videos. Follow people, make friends, start groups, and hop on a call.' }, r.intro);
        const err = h('p', { class: 'form-error', role: 'alert' });
        const form = h('form', { class: 'stack' }, field('Site name', name, 'Shown in the header and on the sign-in page.'), field('Headline on the sign-in page', head), field('Short intro under it', intro), err, h('div', null, h('button', { class: 'btn primary', type: 'submit' }, 'Save')));
        form.addEventListener('submit', async (e) => {
          e.preventDefault(); err.textContent = '';
          try { await post_('/api/admin/site', { siteName: name.value, headline: head.value, intro: intro.value }); toast('Saved. Everyone sees it now.'); setTimeout(() => location.reload(), 700); } catch (x) { err.textContent = errorText(x); }
        });
        return h('div', null, h('p', { class: 'muted' }, 'Only you can change this. Edits go live for everyone straight away; there is nothing to republish.'), form,
          h('h2', { class: 'mono sect' }, 'Web address'), h('p', null, r.domain ? ['Your site is set up to run at ', h('code', null, r.domain), '.'] : 'No public address is set yet. The README ("Your web address") shows how to point your domain at the site.'));
      },
      async Settings() {
        const s = await get('/api/admin/stats');
        const opts = [['invite', 'Invite only', 'Only people with an invite link can join. Best way to keep it to real people you know.'], ['approval', 'Approve each person', 'Anyone can ask to join. They wait until you approve them.'], ['open', 'Open', 'Anyone can join straight away.'], ['closed', 'Closed', 'Nobody new can join.']];
        return h('form', { class: 'stack' }, h('h2', { class: 'mono sect' }, 'Who can sign up'), opts.map(([v, t, d]) => h('label', { class: 'check big' }, h('input', { type: 'radio', name: 'mode', value: v, checked: s.signup === v, onchange: async () => { try { await post_('/api/admin/settings', { signup: v }); toast('Saved'); } catch (e) { toast(errorText(e), true); } } }), h('span', null, h('strong', null, t), h('br'), h('span', { class: 'muted' }, d)))));
      }
    };
    view.replaceChildren(h('h1', { class: 'serif' }, 'Admin'), nav, body);
    paintNav(); await show();
  }

  /* ---------- auth screens ---------- */
  function authScreen() {
    const fromHash = /^#\/join\/([a-z0-9]+)$/i.exec(location.hash), first = S.config.firstRun, prov = S.config.providers || {};
    let mode = fromHash || first ? 'join' : 'login';
    const root = h('div', { class: 'auth' });
    const paint = () => {
      const err = h('p', { class: 'form-error', role: 'alert' }, S.authError || ''); S.authError = null;
      const email = h('input', { type: 'email', autocomplete: 'email', required: '' }), pw = h('input', { type: 'password', autocomplete: mode === 'join' ? 'new-password' : 'current-password', required: '', minlength: mode === 'join' ? '8' : null });
      const handle = h('input', { type: 'text', autocomplete: 'username', maxlength: '20', pattern: '[A-Za-z0-9_]{3,20}' }), name = h('input', { type: 'text', autocomplete: 'name', maxlength: '40' });
      const invite = h('input', { type: 'text', autocomplete: 'off', value: fromHash ? fromHash[1] : '' });
      const joinOnly = mode === 'join';
      const needInvite = joinOnly && !first && S.config.signup === 'invite';
      const closed = joinOnly && !first && S.config.signup === 'closed';
      const link2 = (href, text) => h('a', { href, target: '_blank', rel: 'noopener' }, text);
      const agree = h('input', { type: 'checkbox' });
      const agreeBox = h('label', { class: 'check' }, agree, h('span', null, 'I am at least ' + (S.config.minAge || 16) + ' years old and I agree to the ', link2('/rules', 'Rules'), ', ', link2('/terms', 'Terms'), ' and ', link2('/privacy', 'Privacy Policy'), '.'));
      const go = (p) => {
        if (joinOnly && !agree.checked) { err.textContent = 'Tick the box to agree to the Rules, Terms and Privacy Policy first.'; return; }
        const q = new URLSearchParams(); const code = invite.value.trim(); if (code) q.set('invite', code); if (joinOnly) q.set('agree', '1');
        location.href = '/auth/' + p + '/start' + (q.toString() ? '?' + q : '');
      };
      const social = [prov.google && h('button', { class: 'btn wide social', type: 'button', onclick: () => go('google') }, 'Continue with Google'),
        prov.apple && h('button', { class: 'btn wide social', type: 'button', onclick: () => go('apple') }, 'Continue with Apple')].filter(Boolean);
      const btn = h('button', { class: 'btn primary wide', type: 'submit' }, joinOnly ? (first ? 'Create the owner account' : 'Join') : 'Sign in');
      const form = h('form', { class: 'stack', novalidate: '' },
        joinOnly && field('Your name', name), joinOnly && field('Username', handle, 'Letters, numbers and underscores. Others see this.'),
        field('Email', email), field('Password', pw, joinOnly ? 'At least 8 characters.' : null), btn);
      form.addEventListener('submit', async (e) => {
        e.preventDefault(); err.textContent = ''; btn.disabled = true;
        try {
          if (joinOnly && !agree.checked) throw new Error('Tick the box to agree to the Rules, Terms and Privacy Policy first.');
          if (joinOnly) await post_('/api/register', { name: name.value, handle: handle.value, email: email.value, password: pw.value, invite: invite.value, agree: agree.checked });
          else await post_('/api/login', { email: email.value, password: pw.value });
          location.hash = '#/'; location.reload();
        } catch (x) { err.textContent = errorText(x); btn.disabled = false; }
      });
      const info = first ? 'This site has no accounts yet. The first account you create becomes the owner and gets the admin panel.'
        : joinOnly ? ({ invite: 'Joining is by invite. Use the link or code someone sent you.', approval: 'New accounts are approved by the site owner before they can post.', open: 'Anyone can join.', closed: 'Sign-ups are closed right now.' }[S.config.signup]) : null;
      root.replaceChildren(
        h('div', { class: 'auth-copy' }, h('div', { class: 'brand big' }, mark(), h('span', { class: 'serif' }, S.config.siteName)),
          h('h1', { class: 'serif' }, S.config.headline || 'VR clips from people you actually know.'),
          h('p', null, S.config.intro || 'Post what you played. Look around inside 360° videos. Follow people, make friends, start groups, and hop on a call.')),
        h('div', { class: 'auth-card' },
          first ? h('h2', { class: 'serif' }, 'Set up your site') : h('div', { class: 'tabs-inline', role: 'group', 'aria-label': 'Sign in or join' },
            h('button', { class: 'tab', type: 'button', 'aria-pressed': String(!joinOnly), onclick: () => { mode = 'login'; paint(); } }, 'Sign in'),
            h('button', { class: 'tab', type: 'button', 'aria-pressed': String(joinOnly), onclick: () => { mode = 'join'; paint(); } }, 'Join')),
          info && h('p', { class: 'note' }, info), err,
          closed ? null : [needInvite && field('Invite code', invite), joinOnly && agreeBox, social.length ? h('div', { class: 'stack social-stack' }, social) : null,
            social.length ? h('p', { class: 'divider mono' }, 'or with your email') : null, form]),
        h('div', { class: 'auth-foot' }, legalLinks()));
    };
    paint();
    app.replaceChildren(root);
  }
  function holdScreen(kind) {
    app.replaceChildren(h('div', { class: 'auth' }, h('div', { class: 'auth-card solo' }, h('h2', { class: 'serif' }, kind === 'pending' ? 'Waiting for approval' : 'Account turned off'),
      h('p', null, kind === 'pending' ? 'Your account is made. The site owner needs to approve it before you can get in. Check back soon.' : 'The site owner has turned off this account.'),
      h('button', { class: 'btn', type: 'button', onclick: signOut }, 'Sign out'))));
  }
  async function signOut() { try { await post_('/api/logout'); } catch (e) { /* ignore */ } location.hash = '#/'; location.reload(); }

  /* ---------- shell and routing ---------- */
  const NAV = [['feed', '#/', 'Clips'], ['people', '#/people', 'People'], ['friends', '#/friends', 'Friends'], ['groups', '#/groups', 'Groups']];
  function navItems(cls) {
    const items = NAV.map(([key, href, label]) => link(href, [label, key === 'friends' ? h('span', { class: 'count', hidden: true, 'data-badge': '' }) : null], cls + ' nav-link'));
    items.forEach((a, i) => { a.dataset.key = NAV[i][0]; });
    if (S.me.role === 'admin') { const a = link('#/admin', 'Admin', cls + ' nav-link'); a.dataset.key = 'admin'; items.push(a); }
    return items;
  }
  function paintHeader() {
    const who = $('#who'); if (!who) return;
    who.replaceChildren(link('#/me', [avatar(S.me, 28), h('span', { class: 'who-name' }, S.me.name)], 'who-link'));
  }
  function buildShell() {
    app.replaceChildren(
      h('header', { class: 'top' }, link('#/', [mark(), h('span', { class: 'serif' }, S.config.siteName)], 'brand'),
        h('nav', { class: 'nav', 'aria-label': 'Main' }, navItems('top-link')), h('div', { id: 'who', class: 'who' })),
      h('main', { id: 'view', tabindex: '-1' }), h('footer', { class: 'foot' }, legalLinks(), h('span', { class: 'mono muted' }, S.config.siteName)),
      h('nav', { class: 'tabbar', 'aria-label': 'Main' }, navItems('tab-link').concat([link('#/me', 'Me', 'tab-link nav-link')].map((a) => { a.dataset.key = 'me'; return a; }))));
    paintHeader();
  }
  const ROUTES = [
    [/^#\/?$/, 'feed', feedView], [/^#\/people$/, 'people', peopleView], [/^#\/friends$/, 'friends', friendsView], [/^#\/groups$/, 'groups', groupsView],
    [/^#\/group\/(\d+)$/, 'groups', groupView], [/^#\/chat\/(d:\d+-\d+)$/, 'friends', dmView], [/^#\/u\/([A-Za-z0-9_]+)$/, 'people', profileView],
    [/^#\/me$/, 'me', settingsView], [/^#\/admin$/, 'admin', adminView]
  ];
  async function route() {
    const view = $('#view'); if (!view) return;
    if (S.cleanup) { try { S.cleanup(); } catch (e) { /* ignore */ } S.cleanup = null; }
    document.querySelectorAll('video').forEach((v) => v.pause());
    const hash = location.hash || '#/';
    const hit = ROUTES.find((r) => r[0].test(hash));
    document.querySelectorAll('.nav-link').forEach((a) => { if (hit && a.dataset.key === hit[1]) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    if (!hit) { view.replaceChildren(empty('Page not found', null, link('#/', 'Back to the clips', 'btn primary'))); return; }
    const args = hit[0].exec(hash).slice(1).map(decodeURIComponent);
    const mine = ++route.seq;
    view.replaceChildren(spinner());
    try {
      const out = await hit[2](view, ...args);
      if (mine !== route.seq) { if (typeof out === 'function') out(); return; }
      S.cleanup = typeof out === 'function' ? out : null;
    } catch (e) {
      if (mine !== route.seq) return;
      view.replaceChildren(h('div', { class: 'empty' }, h('h2', { class: 'serif' }, e.status === 404 ? 'Not found' : 'That did not load'), h('p', null, errorText(e)), h('button', { class: 'btn', type: 'button', onclick: route }, 'Try again')));
    }
  }
  route.seq = 0;
  window.addEventListener('hashchange', () => { window.scrollTo(0, 0); route(); });

  /* badges and live events */
  function paintBadges() {
    let n = S.requests; S.unread.forEach((v) => { n += v; });
    document.querySelectorAll('[data-badge]').forEach((b) => { b.hidden = !n; b.textContent = n; });
    document.title = (n ? '(' + n + ') ' : '') + S.config.siteName;
  }
  async function refreshBadges() { try { S.requests = (await get('/api/friends')).incoming.length; paintBadges(); } catch (e) { /* ignore */ } }
  function connectEvents() {
    const es = new EventSource('/api/events'); S.es = es;
    es.onmessage = (e) => {
      let ev; try { ev = JSON.parse(e.data); } catch (x) { return; }
      if (ev.type === 'chat') {
        S.listeners.forEach((fn) => fn(ev));
        const m = ev.message;
        if (m.user.id !== S.me.id && S.activeRoom !== m.room) { S.unread.set(m.room, (S.unread.get(m.room) || 0) + 1); paintBadges(); toast('New message from ' + m.user.name); window.W.sound.play('message'); }
        else if (m.user.id !== S.me.id && document.hidden) window.W.sound.play('message');
      } else if (ev.type === 'friend') { refreshBadges(); window.W.sound.play('message'); }
      else if (ev.type === 'call-invite') window.W.call.invite(ev, S.me);
      else if (ev.type && ev.type.startsWith('rtc')) window.W.call.onEvent(ev);
    };
  }

  async function boot() {
    try { S.config = await get('/api/config'); } catch (e) { app.replaceChildren(h('p', { class: 'form-error pad' }, errorText(e))); return; }
    try { S.me = (await get('/api/me')).user; } catch (e) { S.me = null; }
    const qs = new URLSearchParams(location.search);
    if (qs.get('auth_error')) { S.authError = qs.get('auth_error'); history.replaceState(null, '', location.pathname + location.hash); }
    if (!S.me) { authScreen(); return; }
    if (S.me.status !== 'active') { holdScreen(S.me.status); return; }
    buildShell(); connectEvents(); refreshBadges();
    if (S.authError) { toast(S.authError, true); S.authError = null; }
    if (/^#\/join\//.test(location.hash)) location.hash = '#/';
    route();
  }
  boot();
})();
