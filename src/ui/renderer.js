const $ = s => document.querySelector(s);
const tablist = $('#tablist');
const addr = $('#addr');
const els = new Map(); // elementos reaproveitados a cada atualização (abas e rótulos de grupo)
const selected = new Set(); // abas marcadas com Ctrl/Cmd + clique
let state = null;
let lastActive = null;
let lastPinned = '';
let sugg = { items: [], sel: -1 };
let suggTimer = null;
let toastTimer = null;

document.body.classList.add(devoid.platform);
const send = (ch, ...a) => devoid.send(ch, ...a);
const rectOf = sel => {
  const r = $(sel).getBoundingClientRect();
  return { left: Math.round(r.left), right: Math.round(r.right), bottom: Math.round(r.bottom), width: Math.round(r.width) };
};
const open = (type, sel) => send('overlay:show', { type, rect: rectOf(sel) });

// ---- ícones dos botões ----
const fill = { back: '#back', fwd: '#fwd', reload: '#reload', plus: '#newtab', star: '#star', translate: '#translate', pip: '#pip', puzzle: '#ext', menu: '#menu', left: '#tl', right: '#tr', split: '#split', download: '#dl', book: '#reader' };
for (const [name, sel] of Object.entries(fill)) $(sel).prepend(icon(name));

// ---- abas ----
function iconFor(key) {
  if (key === 'spin') { const i = document.createElement('i'); i.className = 'spin'; return i; }
  if (key === 'crash') { const b = document.createElement('b'); b.className = 'bang'; b.textContent = '!'; return b; }
  if (key === 'dot') { const i = document.createElement('i'); i.className = 'dot'; return i; }
  const img = document.createElement('img');
  img.src = key;
  img.alt = '';
  img.onerror = () => img.replaceWith(iconFor('dot'));
  return img;
}

function makeTab(id) {
  const el = document.createElement('div');
  el.className = 'tab';
  el.dataset.id = id;
  el.setAttribute('role', 'tab');
  const ico = document.createElement('span'); ico.className = 'ico';
  const title = document.createElement('span'); title.className = 't';
  const snd = document.createElement('button'); snd.className = 'snd'; snd.dataset.act = 'mute'; snd.hidden = true;
  const x = document.createElement('button'); x.className = 'x'; x.dataset.act = 'close'; x.title = t('Fechar aba'); x.setAttribute('aria-label', t('Fechar aba'));
  x.append(icon('close'));
  el.append(ico, title, snd, x);
  return el;
}

function updateTab(el, tab, s) {
  const g = tab.group ? s.groups.find(x => x.id === tab.group) : null;
  el.classList.toggle('on', tab.id === s.activeId);
  el.classList.toggle('pinned', tab.pinned);
  el.classList.toggle('snoozed', tab.snoozed);
  el.classList.toggle('sel', selected.has(tab.id));
  el.classList.toggle('split', !!s.split && (s.split.a === tab.id || s.split.b === tab.id));
  el.classList.toggle('gcollapsed', !!(g && g.collapsed && tab.id !== s.activeId));
  if (g) { el.dataset.g = g.id; el.style.setProperty('--gc', g.color); } else { delete el.dataset.g; el.style.removeProperty('--gc'); }
  el.setAttribute('aria-selected', String(tab.id === s.activeId));
  el.title = tab.title || '';
  el.querySelector('.t').textContent = tab.title || t('Nova aba');
  const key = tab.loading ? 'spin' : tab.crashed ? 'crash' : (tab.favicon || 'dot');
  const ico = el.querySelector('.ico');
  if (ico.dataset.k !== key) { ico.dataset.k = key; ico.replaceChildren(iconFor(key)); }
  const snd = el.querySelector('.snd');
  snd.hidden = !(tab.audible || tab.muted);
  if (!snd.hidden) {
    const k = tab.muted ? 'mute' : 'vol';
    if (snd.dataset.k !== k) { snd.dataset.k = k; snd.replaceChildren(icon(k)); }
    snd.title = tab.muted ? t('Reativar som da aba') : t('Mutar aba');
  }
}

function makeChip(gid) {
  const b = document.createElement('button');
  b.className = 'gchip';
  b.dataset.gid = gid;
  return b;
}

function renderTabs(s) {
  const seen = new Set();
  const nodes = [];
  let prev = 0;
  for (const tab of s.tabs) {
    if (tab.group && tab.group !== prev) {
      const g = s.groups.find(x => x.id === tab.group);
      if (g) {
        const key = 'g' + g.id;
        let chip = els.get(key);
        if (!chip) { chip = makeChip(g.id); els.set(key, chip); }
        chip.textContent = g.name || t('Grupo');
        chip.style.setProperty('--gc', g.color);
        chip.classList.toggle('collapsed', g.collapsed);
        chip.title = g.collapsed ? t('Mostrar o grupo') : t('Recolher o grupo');
        seen.add(key);
        nodes.push(chip);
      }
    }
    prev = tab.group;
    const key = 't' + tab.id;
    seen.add(key);
    let el = els.get(key);
    if (!el) { el = makeTab(tab.id); els.set(key, el); }
    updateTab(el, tab, s);
    nodes.push(el);
  }
  for (const [key, el] of els) if (!seen.has(key)) { el.remove(); els.delete(key); }
  const same = nodes.length === tablist.children.length && nodes.every((el, i) => tablist.children[i] === el);
  if (!same) tablist.replaceChildren(...nodes);
  if (s.activeId !== lastActive) {
    const a = els.get('t' + s.activeId);
    if (a) a.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  updateArrows();
}

function updateArrows() {
  const over = tablist.scrollWidth > tablist.clientWidth + 1 && document.documentElement.dataset.tabs !== 'vertical';
  $('#tl').hidden = !over || tablist.scrollLeft <= 0;
  $('#tr').hidden = !over || tablist.scrollLeft + tablist.clientWidth >= tablist.scrollWidth - 1;
}

tablist.addEventListener('mousedown', e => {
  if (e.button === 1) e.preventDefault(); // evita o autoscroll do botão do meio
  const el = e.target.closest('.tab');
  if (!el || e.button !== 0 || e.target.closest('[data-act]')) return;
  const id = Number(el.dataset.id);
  if (e.ctrlKey || e.metaKey) { // Ctrl/Cmd + clique: marca várias abas para agrupar
    if (selected.has(id)) selected.delete(id); else selected.add(id);
    if (state) renderTabs(state);
    return;
  }
  if (selected.size) { selected.clear(); if (state) renderTabs(state); }
  send('tab:switch', id);
});
tablist.addEventListener('click', e => {
  const chip = e.target.closest('.gchip');
  if (chip) { send('group:toggle', Number(chip.dataset.gid)); return; }
  const el = e.target.closest('.tab');
  const act = e.target.closest('[data-act]');
  if (!el || !act) return;
  const id = Number(el.dataset.id);
  if (act.dataset.act === 'close') send('tab:close', id); else send('tab:mute', id);
});
tablist.addEventListener('auxclick', e => {
  const el = e.target.closest('.tab');
  if (el && e.button === 1) send('tab:close', Number(el.dataset.id)); // clique com o botão do meio fecha
});
tablist.addEventListener('contextmenu', e => {
  e.preventDefault();
  const chip = e.target.closest('.gchip');
  if (chip) { send('group:context', Number(chip.dataset.gid)); return; }
  const el = e.target.closest('.tab');
  if (!el) return;
  const id = Number(el.dataset.id);
  send('tab:context', selected.has(id) ? [...selected] : [id]); // com várias marcadas, o menu vale para todas
});
tablist.addEventListener('wheel', e => {
  if (document.documentElement.dataset.tabs === 'vertical') return;
  if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { tablist.scrollLeft += e.deltaY; e.preventDefault(); }
}, { passive: false });
tablist.addEventListener('scroll', updateArrows);
new ResizeObserver(updateArrows).observe(tablist);
window.addEventListener('devoid-settings', () => setTimeout(updateArrows, 50));
$('#tl').onclick = () => tablist.scrollBy({ left: -240, behavior: 'smooth' });
$('#tr').onclick = () => tablist.scrollBy({ left: 240, behavior: 'smooth' });

// ---- barra de ferramentas ----
$('#newtab').onclick = () => send('tab:new');
$('#back').onclick = () => send('nav:back');
$('#fwd').onclick = () => send('nav:forward');
$('#reload').onclick = () => send('nav:reload');
$('#star').onclick = () => send('bm:toggle');
$('#pip').onclick = () => send('pip:toggle');
$('#sec').onclick = () => open('site', '#sec');
$('#shield').onclick = () => send('shield:open', rectOf('#shield')); // pop-up próprio (ui/adblock-popup.html)
$('#reader').onclick = () => send('reader:open');
$('#translate').onclick = () => open('translate', '#translate');
$('#ext').onclick = () => open('extensions', '#ext');
$('#menu').onclick = () => open('menu', '#menu');
$('#dl').onclick = () => open('downloads', '#dl');
$('#split').onclick = () => { if (state && state.split) send('split:close'); else open('split', '#split'); };

const SEC = {
  https: ['lock', 'Conexão segura (HTTPS)'],
  http: ['warn', 'Conexão não segura (HTTP)'],
  internal: ['shield', 'Página do Devoid Web'],
};

function renderPinnedExt(list) {
  const key = JSON.stringify(list.map(x => x.id + x.icon));
  if (key === lastPinned) return;
  lastPinned = key;
  $('#pinned').replaceChildren(...list.map(x => {
    const b = document.createElement('button');
    b.className = 'ib';
    b.title = x.name;
    b.setAttribute('aria-label', x.name);
    if (x.icon) { const img = document.createElement('img'); img.src = x.icon; img.alt = ''; b.append(img); } else { const l = document.createElement('b'); l.textContent = (x.name || '?').charAt(0).toUpperCase(); b.append(l); }
    b.onclick = () => send('ext:popup', x.id, rectOf('#pinned'));
    return b;
  }));
}

function renderDownloads(d) {
  const b = $('#dl');
  b.hidden = !d.show; // aparece sozinho quando um download começa
  b.classList.toggle('active', d.active > 0);
  b.classList.toggle('indet', d.active > 0 && d.progress == null);
  b.classList.toggle('warn', !!d.pending);
  if (d.progress != null) $('#ring').style.setProperty('--p', d.progress.toFixed(3));
}

function render() {
  const s = state;
  const badge = $('#badge');
  badge.hidden = !(s.incognito || s.profile.id !== 'main');
  if (!badge.hidden) {
    badge.textContent = s.profile.name;
    badge.style.background = s.profile.color || '';
    badge.style.color = s.profile.color ? '#000' : '';
  }
  for (const id of [...selected]) if (!s.tabs.some(x => x.id === id)) selected.delete(id);
  renderTabs(s);

  const a = s.active || { url: '', sec: '', canBack: false, canFwd: false, loading: false, bookmarked: false, canTranslate: false, translated: false, shield: null, readable: false };
  if (document.activeElement !== addr || lastActive !== s.activeId) addr.value = a.url;
  lastActive = s.activeId;

  $('#back').disabled = !a.canBack;
  $('#fwd').disabled = !a.canFwd;
  const rl = $('#reload');
  if (rl.dataset.k !== String(a.loading)) { rl.dataset.k = String(a.loading); rl.replaceChildren(icon(a.loading ? 'stop' : 'reload')); rl.title = a.loading ? t('Parar') : t('Recarregar'); }
  $('#progress').classList.toggle('on', a.loading);
  $('#star').classList.toggle('on', a.bookmarked);
  $('#reader').hidden = !a.readable; // só aparece em páginas com artigo
  $('#translate').hidden = !a.canTranslate;
  $('#translate').classList.toggle('on', a.translated);
  $('#split').classList.toggle('on', !!s.split);
  $('#split').title = s.split ? t('Sair da divisão de tela') : t('Dividir a tela');

  const sh = $('#shield');
  sh.hidden = !a.shield;
  if (a.shield) {
    const k = a.shield.on ? 'shieldcheck' : 'shieldoff';
    if (sh.dataset.k !== k) { sh.dataset.k = k; sh.replaceChildren(icon(k), $('#shieldn')); }
    sh.classList.toggle('on', a.shield.on);
    sh.classList.toggle('off', !a.shield.on);
    $('#shieldn').textContent = a.shield.on && a.shield.count ? (a.shield.count > 99 ? '99+' : String(a.shield.count)) : '';
  }

  const sec = $('#sec');
  sec.dataset.k = a.sec || '';
  const def = SEC[a.sec];
  sec.replaceChildren(def ? icon(def[0]) : '');
  sec.title = def ? t(def[1]) : '';

  renderPinnedExt(s.pinnedExt || []);
  renderDownloads(s.downloads);
}

devoid.on('state', s => { state = s; render(); });
devoid.on('focus-address', () => addr.focus());
devoid.on('toast', text => {
  const el = $('#toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
});
send('ui:ready');

// ---- omnibox ----
function showSugg() {
  if (!sugg.items.length) return hideSugg();
  send('overlay:show', { type: 'suggest', rect: rectOf('#omni'), data: { items: sugg.items, sel: sugg.sel } });
}
function hideSugg() {
  sugg = { items: [], sel: -1 };
  send('overlay:hide', 'suggest');
}
async function suggest() {
  const text = addr.value.trim();
  if (!text || document.activeElement !== addr) return hideSugg();
  sugg = { items: await devoid.invoke('omni:suggest', text), sel: -1 };
  showSugg();
}

addr.addEventListener('focus', () => addr.select());
addr.addEventListener('input', () => { clearTimeout(suggTimer); suggTimer = setTimeout(suggest, 70); });
addr.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== addr) hideSugg(); }, 200));
addr.addEventListener('keydown', e => {
  const n = sugg.items.length;
  if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && n) {
    e.preventDefault();
    if (e.key === 'ArrowDown') sugg.sel = sugg.sel + 1 >= n ? -1 : sugg.sel + 1;
    else sugg.sel = sugg.sel - 1 < -1 ? n - 1 : sugg.sel - 1;
    showSugg();
  } else if (e.key === 'Enter') {
    const pick = sugg.items[sugg.sel];
    const text = pick ? pick.url : addr.value;
    hideSugg();
    send('nav:go', text);
    addr.blur();
  } else if (e.key === 'Escape') {
    hideSugg();
    if (state && state.active) addr.value = state.active.url;
    addr.blur();
  }
});

// ---- player de áudio ----
// A tag <audio> mora aqui, na janela principal. O widget do menu ☰ só manda comandos, então a música continua tocando com o menu fechado.
const player = $('#player');
const pl = { list: [], i: -1, loop: false, shuffle: false };
let lastReport = 0;
let audioErrors = 0;
player.volume = 0.8;

function report(withNames) {
  const cur = pl.list[pl.i];
  const st = {
    playing: !player.paused && !player.ended, title: cur ? cur.name : '', index: pl.i, count: pl.list.length,
    time: player.currentTime || 0, duration: Number.isFinite(player.duration) ? player.duration : 0,
    volume: player.volume, loop: pl.loop, shuffle: pl.shuffle,
  };
  if (withNames) st.names = pl.list.map(x => x.name);
  send('audio:state', st);
}

function playAt(i) {
  if (i < 0 || i >= pl.list.length) return;
  pl.i = i;
  player.src = pl.list[i].url;
  player.play().catch(() => {});
  report();
}

function nextIndex(dir) {
  const n = pl.list.length;
  if (!n) return -1;
  if (pl.shuffle && dir > 0 && n > 1) { let k; do { k = Math.floor(Math.random() * n); } while (k === pl.i); return k; }
  const k = pl.i + dir;
  if (k >= n) return pl.loop ? 0 : -1;
  if (k < 0) return pl.loop ? n - 1 : 0;
  return k;
}

function step(dir) {
  const k = nextIndex(dir);
  if (k >= 0) playAt(k); else { player.pause(); report(); }
}

const audioCmds = {
  toggle() { if (!pl.list.length) return; if (pl.i < 0) playAt(0); else if (player.paused) player.play().catch(() => {}); else player.pause(); },
  play() { if (pl.i < 0 && pl.list.length) playAt(0); else player.play().catch(() => {}); },
  pause() { player.pause(); },
  stop() { player.pause(); player.currentTime = 0; },
  next() { step(1); },
  prev() { if (player.currentTime > 3) player.currentTime = 0; else step(-1); },
  seek(v) { if (Number.isFinite(player.duration)) player.currentTime = Math.max(0, Math.min(1, v)) * player.duration; },
  volume(v) { player.volume = Math.max(0, Math.min(1, v)); },
  loop() { pl.loop = !pl.loop; player.loop = pl.loop && pl.list.length === 1; },
  shuffle() { pl.shuffle = !pl.shuffle; },
  jump(v) { playAt(Math.round(v)); },
  clear() { player.pause(); player.removeAttribute('src'); player.load(); pl.list = []; pl.i = -1; },
};

devoid.on('audio:cmd', c => {
  if (audioCmds[c.cmd]) { audioCmds[c.cmd](c.value); report(c.cmd === 'clear'); }
});
devoid.on('audio:add', items => {
  const start = pl.list.length;
  pl.list.push(...items.filter(x => x && typeof x.url === 'string' && typeof x.name === 'string'));
  report(true);
  if (pl.i < 0 && pl.list.length > start) playAt(start);
});

player.addEventListener('timeupdate', () => {
  const now = Date.now();
  if (now - lastReport > 250) { lastReport = now; report(); }
});
for (const ev of ['play', 'pause', 'loadedmetadata', 'volumechange']) player.addEventListener(ev, () => report());
player.addEventListener('playing', () => { audioErrors = 0; });
player.addEventListener('ended', () => { report(); step(1); });
player.addEventListener('error', () => { if (++audioErrors < pl.list.length) step(1); else report(); }); // arquivo ilegível: pula
