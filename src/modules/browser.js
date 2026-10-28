'use strict';
const path = require('path');
const crypto = require('crypto');
const { app, BrowserWindow, WebContentsView, Menu, clipboard, session } = require('electron');
const store = require('./store');
const paths = require('./paths');
const security = require('./security');
const translate = require('./translate');
const extensions = require('./extensions');
const downloads = require('./downloads');
const audio = require('./audio');
const reader = require('./reader');
const profiles = require('./profiles');
const { toUrl } = require('./omnibox');
const { t: tr } = require('../ui/i18n.js');

const registry = new Map(); // id do webContents (interface, painel ou aba) -> Browser
const all = new Set();

const STRIP_H = 40; // faixa de abas / botões da janela
const CHROME_H = 88; // faixa de abas + barra de ferramentas
const SIDEBAR_W = 220; // largura das abas verticais
const PRELOAD = path.join(paths.SRC, 'preload.js');
const ICON_URL = paths.fileUrl(path.join(paths.SRC, 'assets', 'icon.png'));
const OVERLAYS = new Set(['menu', 'translate', 'extensions', 'translation', 'suggest', 'site', 'downloads', 'group', 'split']);
const POPUP_PATH = path.join(paths.SRC, 'ui', 'adblock-popup.html'); // caminho absoluto do pop-up do bloqueador
const readerStore = new Map(); // token -> { art, at }: artigos extraídos para o modo leitura
const GROUP_COLORS = ['#9aa0a6', '#4c8bf5', '#e8584f', '#faca11', '#34a853', '#f06292', '#a47bf0', '#26c6da', '#ff9f1c'];
const RELOAD_KEYS = new Set(['javascript', 'autoplay', 'sensors']); // políticas que só valem ao recarregar a página
const TR_ERRORS = {
  GOOGLE_KEY: 'Chave de API do Google inválida ou sem permissão.',
  GOOGLE_LIMIT: 'O Google Tradutor limitou os pedidos. Tente de novo em instantes ou use uma chave de API.',
  GOOGLE_FAIL: 'Não foi possível falar com o Google Tradutor. Verifique a internet.',
};

const web = u => /^https?:/i.test(u || '');
const siteOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const newShield = () => ({ blocked: 0, cats: {}, recent: [], passed: new Map() });
const errText = e => tr(TR_ERRORS[e && e.message] || TR_ERRORS.GOOGLE_FAIL);

// Roda dentro da página (e dos iframes) com "gesto do usuário" simulado: força o Picture-in-Picture em qualquer vídeo
function pipInPage(pt) {
  if (document.pictureInPictureElement) { document.exitPictureInPicture().catch(() => {}); return 'exit'; }
  const vids = Array.from(document.querySelectorAll('video')).filter(v => v.readyState > 0 && v.videoWidth > 0);
  if (!vids.length) return 'none';
  let v = null;
  if (pt) v = document.elementsFromPoint(pt.x, pt.y).find(e => e.tagName === 'VIDEO') || null;
  if (!v) v = vids.find(x => !x.paused && !x.ended) || vids.sort((a, b) => b.videoWidth * b.videoHeight - a.videoWidth * a.videoHeight)[0];
  v.removeAttribute('disablePictureInPicture'); // ignora o bloqueio do site
  v.disablePictureInPicture = false;
  return v.requestPictureInPicture().then(() => 'ok').catch(() => 'fail');
}

// Ligações com o bloqueador (que roda fora do gerenciador de abas)
const tabByWc = id => { const b = registry.get(id); return b ? b.tabByWc(id) : null; };
security.setHooks({
  tabInfo: id => { const x = tabByWc(id); return x ? { host: siteOf(x.url) } : null; },
  blocked: (id, r) => {
    const b = registry.get(id);
    const x = b && b.tabByWc(id);
    if (!x) return;
    x.shield.blocked++;
    x.shield.cats[r.cat] = (x.shield.cats[r.cat] || 0) + 1;
    x.shield.recent.push({ host: r.host, cat: r.cat });
    if (x.shield.recent.length > 80) x.shield.recent.shift();
    b.pushSoon();
  },
  passed: (id, r) => {
    const b = registry.get(id);
    const x = b && b.tabByWc(id);
    if (!x) return;
    const k = r.host + '|' + r.cat;
    const cur = x.shield.passed.get(k);
    if (cur) cur.n++; else if (x.shield.passed.size < 300) x.shield.passed.set(k, { host: r.host, cat: r.cat, n: 1 });
    b.pushSoon();
  },
});

// Downloads: o ícone da barra e os avisos de risco acompanham todas as janelas
downloads.subscribe(() => { for (const b of all) b.pushSoon(); });
downloads.setHooks({
  onPending: e => {
    const b = registry.get(e.wcId) || [...all][0];
    if (b) b.showOverlay({ type: 'downloads', rect: b.topRight() });
  },
});

function wipeGuest(ses) {
  ses.clearStorageData().catch(() => {});
  ses.clearCache().catch(() => {});
  ses.clearAuthCache().catch(() => {});
  ses.clearHostResolverCache().catch(() => {});
  ses.clearCodeCaches({}).catch(() => {});
  store.wipeGuest();
}

function readerArticle(token) {
  const r = readerStore.get(token);
  return r && Date.now() - r.at < 30 * 60000 ? r.art : null;
}

class Browser {
  static open(opts) { return new Browser(opts); }

  // Abre (ou reaproveita) a janela de um perfil
  static forProfile(profileId, url) {
    const b = profileId === profiles.GUEST ? null : [...all].find(x => x.profileId === profileId);
    if (b) { if (b.win.isMinimized()) b.win.restore(); b.win.focus(); if (url) b.newTab(url); return b; }
    return new Browser({ profileId, urls: [url || paths.PAGES.newtab] });
  }

  constructor({ urls = [], profileId = profiles.MAIN } = {}) {
    const guest = profiles.isGuest(profileId);
    if (!guest && !profiles.get(profileId)) profileId = profiles.MAIN;
    this.profileId = profileId;
    this.guest = guest; // convidado: partição em memória, sem histórico, sem extensões, apaga tudo ao fechar
    this.incognito = guest;
    this.audio = null;
    this.shieldOpen = false;
    this.shieldBase = null;
    this.tabs = [];
    this.groups = [];
    this.nextGroup = 1;
    this.groupDraft = null;
    this.split = null; // { a, b }: ids das duas abas lado a lado
    this.mounted = new Set(); // abas que estão dentro da janela agora
    this.activeId = null;
    this.nextId = 1;
    this.closedStack = [];
    this.overlayType = null;
    this.overlayBase = null;
    this.dead = false;
    this.unfocusedSince = 0;
    this.lastFocus = Date.now();

    // Cada perfil: partição própria (persist:profile_<id>). Convidado: partição "guest", só em memória.
    this.ses = profiles.sessionOf(profileId);
    security.setupSession(this.ses);
    if (!guest) extensions.attach(this.ses);

    const bar = store.titleBar();
    const prof = this.profileInfo();
    this.win = new BrowserWindow({
      width: 1280, height: 800, minWidth: 720, minHeight: 460,
      title: this.profileId === profiles.MAIN ? 'Devoid Web' : `Devoid Web — ${prof.name}`,
      backgroundColor: bar.color,
      icon: path.join(paths.SRC, 'assets', 'icon.png'),
      titleBarStyle: 'hidden',
      titleBarOverlay: { ...bar, height: STRIP_H },
      trafficLightPosition: { x: 14, y: 12 },
      webPreferences: security.prefs({ preload: PRELOAD }),
    });
    this.win.setMenuBarVisibility(false);

    this.ui = this.win.webContents;
    this.uiId = this.ui.id;
    registry.set(this.uiId, this);
    this.ui.setWindowOpenHandler(() => ({ action: 'deny' }));

    // Painel flutuante (menu, tradutor, extensões, sugestões...). Fica por cima das abas.
    this.overlay = new WebContentsView({ webPreferences: security.prefs({ preload: PRELOAD }) });
    this.overlay.setBackgroundColor('#00000000');
    this.overlayId = this.overlay.webContents.id;
    registry.set(this.overlayId, this);
    this.overlay.webContents.loadFile(path.join(paths.SRC, 'ui', 'overlay.html'));

    // Pop-up do bloqueador de anúncios: página própria (ui/adblock-popup.html), com caminho absoluto
    this.shieldView = new WebContentsView({ webPreferences: security.prefs({ preload: PRELOAD }) });
    this.shieldView.setBackgroundColor('#00000000');
    this.shieldId = this.shieldView.webContents.id;
    registry.set(this.shieldId, this);
    this.shieldView.webContents.on('did-fail-load', (_e, code, desc, url) => console.error('adblock-popup não carregou:', code, desc, url));
    this.shieldView.webContents.loadFile(POPUP_PATH);

    this.win.on('resize', () => { this.layout(); this.hideOverlay(); });
    this.win.on('focus', () => { this.lastFocus = Date.now(); });
    this.win.on('close', () => this.saveSession());
    this.win.on('closed', () => this.destroy());
    all.add(this);
    startSweeper();

    const first = urls.length ? urls : [paths.PAGES.newtab];
    this.win.loadFile(path.join(paths.SRC, 'ui', 'index.html')).then(() => {
      for (const u of first) this.newTab(typeof u === 'string' ? u : u.url, { pinned: !!u.pinned });
    });
  }

  // ---------- básico ----------
  active() { return this.tabs.find(x => x.id === this.activeId); }
  tabByWc(id) { return this.tabs.find(x => x.view && x.view.webContents.id === id) || null; }
  send(ch, payload) { if (!this.dead && !this.ui.isDestroyed()) this.ui.send(ch, payload); }

  profileInfo() {
    if (this.guest) return { id: profiles.GUEST, name: tr('Convidado'), color: '#9aa0a6', icon: 'user' };
    const p = profiles.get(this.profileId);
    if (!p) return { id: this.profileId, name: '?', color: '', icon: 'user' };
    return { id: p.id, name: p.id === profiles.MAIN && p.name === 'Principal' ? tr('Principal') : p.name, color: p.color, icon: p.icon };
  }

  destroy() {
    this.dead = true;
    for (const x of this.tabs) {
      if (x.view) { registry.delete(x.view.webContents.id); try { x.view.webContents.close(); } catch { /* ok */ } }
    }
    registry.delete(this.uiId);
    registry.delete(this.overlayId);
    registry.delete(this.shieldId);
    try { this.overlay.webContents.close(); } catch { /* ok */ }
    try { this.shieldView.webContents.close(); } catch { /* ok */ }
    all.delete(this);
    if (this.guest && ![...all].some(b => b.guest)) wipeGuest(this.ses); // última janela de convidado: apaga tudo
  }

  partner(a) {
    if (!this.split || !a) return null;
    const id = this.split.a === a.id ? this.split.b : this.split.b === a.id ? this.split.a : 0;
    return this.tabs.find(x => x.id === id) || null;
  }

  // Só as abas visíveis (a ativa e, na divisão de tela, a parceira) ficam dentro da janela
  mount() {
    if (this.dead) return;
    const want = new Set();
    const a = this.active();
    if (a && a.view) want.add(a);
    const p = this.partner(a);
    if (p && p.view) want.add(p);
    for (const x of [...this.mounted]) {
      if (!want.has(x)) { try { this.win.contentView.removeChildView(x.view); } catch { /* ok */ } this.mounted.delete(x); }
    }
    for (const x of want) { this.win.contentView.addChildView(x.view); this.mounted.add(x); }
  }

  unmount(tab) {
    if (tab.view && this.mounted.has(tab)) {
      try { this.win.contentView.removeChildView(tab.view); } catch { /* ok */ }
      this.mounted.delete(tab);
    }
  }

  layout() {
    if (this.dead) return;
    const a = this.active();
    if (!a || !a.view) return;
    const [w, h] = this.win.getContentSize();
    const side = store.get().tabStyle === 'vertical' && !a.full ? SIDEBAR_W : 0;
    const top = a.full ? 0 : CHROME_H;
    const width = Math.max(0, w - side);
    const height = Math.max(0, h - top);
    const p = this.partner(a);
    if (p && p.view && !a.full) {
      const L = this.tabs.find(x => x.id === this.split.a);
      const R = this.tabs.find(x => x.id === this.split.b);
      const lw = Math.floor((width - 4) / 2);
      L.view.setBounds({ x: side, y: top, width: lw, height });
      R.view.setBounds({ x: side + lw + 4, y: top, width: width - lw - 4, height });
    } else a.view.setBounds({ x: side, y: top, width, height });
  }

  pushSoon() {
    if (this._ps || this.dead) return;
    this._ps = setTimeout(() => { this._ps = null; this.push(); this.rerenderOverlay(); }, 250);
  }

  push() {
    if (this.dead) return;
    const a = this.active();
    const url = a ? a.url : '';
    const sec = /^https:/i.test(url) ? 'https' : /^http:/i.test(url) ? 'http' : paths.isInternal(url) ? 'internal' : '';
    this.send('state', {
      activeId: this.activeId,
      incognito: this.incognito,
      profile: this.profileInfo(),
      tabs: this.tabs.map(x => ({
        id: x.id, title: x.title, favicon: x.favicon, loading: x.loading, pinned: x.pinned, audible: x.audible,
        muted: x.view ? x.view.webContents.isAudioMuted() : false, snoozed: x.snoozed, crashed: x.crashed, group: x.group,
      })),
      groups: this.groups,
      split: this.split,
      active: a && {
        url: paths.friendly(url), sec,
        canBack: !!a.canBack, canFwd: !!a.canFwd, loading: a.loading,
        bookmarked: store.isBookmarked(this.profileId, url),
        readable: !!a.readable && !paths.isInternal(url),
        canTranslate: web(url) && !a.snoozed, translated: a.translated,
        shield: web(url) ? { on: !store.isAdblockOff(siteOf(url)), count: a.shield.blocked } : null,
      },
      downloads: downloads.summary(),
      pinnedExt: this.incognito ? [] : extensions.pinned(),
    });
  }

  toast(text) { this.send('toast', text); }

  // ---------- abas ----------
  makeView(tab) {
    // Cada aba é um WebContents separado; o Chromium cuida do processo de cada site
    const view = new WebContentsView({ webPreferences: security.prefs({ preload: PRELOAD, session: this.ses }) });
    tab.view = view;
    registry.set(view.webContents.id, this);
    this.wire(tab);
  }

  newTab(url = paths.PAGES.newtab, o = {}) {
    if (this.dead) return null;
    const tab = {
      id: this.nextId++, view: null, title: tr('Nova aba'), url, favicon: '', loading: false, canBack: false, canFwd: false,
      pinned: !!o.pinned, audible: false, snoozed: false, crashed: false, full: false, translated: false, group: 0, readable: false,
      lastActive: Date.now(), navAt: 0, lastPopup: 0, scrollY: 0, autoUrl: '', shield: newShield(),
    };
    const after = o.after ? this.tabs.findIndex(x => x.id === o.after) : -1;
    this.tabs.splice(after >= 0 ? after + 1 : this.tabs.length, 0, tab);
    this.tabs.sort((a, b) => Number(b.pinned) - Number(a.pinned)); // fixadas primeiro (ordenação estável)
    this.makeView(tab);
    tab.view.webContents.loadURL(url).catch(() => {});
    if (o.activate === false) this.push(); else this.switchTab(tab.id);
    return tab;
  }

  switchTab(id) {
    const tab = this.tabs.find(x => x.id === id);
    if (!tab || this.dead) return;
    const cur = this.active();
    if (cur) cur.lastActive = Date.now();
    this.hideOverlay();
    this.activeId = id;
    tab.lastActive = Date.now();
    if (this.split && this.split.a !== id && this.split.b !== id) this.split = null;
    const g = tab.group && this.groups.find(x => x.id === tab.group);
    if (g) g.collapsed = false;
    if (tab.snoozed) this.wake(tab);
    else if (tab.crashed) { tab.crashed = false; tab.view.webContents.reload(); }
    this.mount();
    this.layout();
    tab.view.webContents.focus();
    this.push();
  }

  closeTab(id) {
    const i = this.tabs.findIndex(x => x.id === id);
    if (i < 0) return;
    const tab = this.tabs[i];
    if (web(tab.url)) {
      this.closedStack.push({ url: tab.url, pinned: tab.pinned });
      if (this.closedStack.length > 20) this.closedStack.shift();
    }
    const wasActive = tab.id === this.activeId;
    if (this.split && (this.split.a === id || this.split.b === id)) this.split = null;
    this.unmount(tab);
    this.tabs.splice(i, 1);
    if (tab.view) { registry.delete(tab.view.webContents.id); tab.view.webContents.close(); tab.view = null; }
    if (wasActive) this.activeId = null;
    this.cleanGroups();
    if (!this.tabs.length) { this.win.close(); return; }
    if (wasActive) this.switchTab(this.tabs[Math.min(i, this.tabs.length - 1)].id);
    else { this.mount(); this.layout(); this.push(); }
  }

  reopen() {
    const c = this.closedStack.pop();
    if (c) this.newTab(c.url, { pinned: c.pinned });
  }

  cycle(step) {
    const vis = this.tabs.filter(x => !x.group || !(this.groups.find(g => g.id === x.group) || {}).collapsed || x.id === this.activeId);
    if (vis.length < 2) return;
    const i = vis.findIndex(x => x.id === this.activeId);
    this.switchTab(vis[(i + step + vis.length) % vis.length].id);
  }

  togglePin(id) {
    const x = this.tabs.find(y => y.id === id);
    if (!x) return;
    x.pinned = !x.pinned;
    if (x.pinned && x.group) { x.group = 0; this.cleanGroups(); }
    this.tabs.sort((a, b) => Number(b.pinned) - Number(a.pinned));
    this.push();
  }

  toggleMute(id) {
    const x = this.tabs.find(y => y.id === id);
    if (x && x.view) { x.view.webContents.setAudioMuted(!x.view.webContents.isAudioMuted()); this.push(); }
  }

  closeOthers(id) {
    this.switchTab(id);
    this.tabs.filter(x => x.id !== id && !x.pinned).forEach(x => this.closeTab(x.id));
  }

  closeRight(id) {
    const i = this.tabs.findIndex(x => x.id === id);
    if (i < 0) return;
    this.switchTab(id);
    this.tabs.slice(i + 1).filter(x => !x.pinned).forEach(x => this.closeTab(x.id));
  }

  // ---------- grupos de abas ----------
  cleanGroups() {
    this.groups = this.groups.filter(g => this.tabs.some(x => x.group === g.id));
  }

  assignGroup(ids, gid) {
    const g = this.groups.find(x => x.id === gid);
    const sel = this.tabs.filter(x => ids.includes(x.id) && !x.pinned);
    if (!g || !sel.length) return;
    const first = this.tabs.findIndex(x => sel.includes(x));
    this.tabs = this.tabs.filter(x => !sel.includes(x));
    let last = -1;
    this.tabs.forEach((x, i) => { if (x.group === gid) last = i; });
    sel.forEach(x => { x.group = gid; });
    this.tabs.splice(last >= 0 ? last + 1 : Math.min(first, this.tabs.length), 0, ...sel);
    this.cleanGroups();
    this.push();
  }

  removeFromGroup(ids) {
    for (const id of ids) {
      const x = this.tabs.find(y => y.id === id);
      if (!x || !x.group) continue;
      const old = x.group;
      this.tabs = this.tabs.filter(y => y !== x);
      x.group = 0;
      let last = -1;
      this.tabs.forEach((y, i) => { if (y.group === old) last = i; });
      this.tabs.splice(last >= 0 ? last + 1 : this.tabs.length, 0, x); // sai do grupo e fica logo depois dele
    }
    this.cleanGroups();
    this.push();
  }

  openGroupEditor(gid, ids) {
    this.groupDraft = { gid, ids };
    this.showOverlay({ type: 'group', rect: { left: 80, right: 420, bottom: STRIP_H - 2, width: 340 } });
  }

  saveGroup({ name, color }) {
    const d = this.groupDraft;
    if (!d) return;
    const nm = String(name || '').trim().slice(0, 30);
    const col = GROUP_COLORS.includes(color) ? color : GROUP_COLORS[1];
    if (d.gid) {
      const g = this.groups.find(x => x.id === d.gid);
      if (g) { g.name = nm; g.color = col; }
    } else {
      const g = { id: this.nextGroup++, name: nm, color: col, collapsed: false };
      this.groups.push(g);
      this.assignGroup(d.ids, g.id);
    }
    this.groupDraft = null;
    this.hideOverlay();
    this.push();
  }

  toggleGroup(gid) {
    const g = this.groups.find(x => x.id === gid);
    if (!g) return;
    g.collapsed = !g.collapsed;
    const a = this.active();
    if (g.collapsed && a && a.group === gid) { // a aba ativa ficou escondida: vai para a vizinha visível
      const other = this.tabs.find(x => x.group !== gid && !x.snoozed) || this.tabs.find(x => x.group !== gid);
      if (other) { this.switchTab(other.id); return; }
      g.collapsed = false;
    }
    this.push();
  }

  tabMenu(ids) {
    const first = this.tabs.find(x => x.id === ids[0]);
    if (!first) return;
    const muted = first.view ? first.view.webContents.isAudioMuted() : false;
    const grouped = ids.some(id => (this.tabs.find(x => x.id === id) || {}).group);
    const items = [
      { label: tr('Duplicar Aba'), click: () => ids.forEach(id => { const x = this.tabs.find(y => y.id === id); if (x) this.newTab(x.url, { after: id }); }) },
      { label: first.pinned ? tr('Desafixar Aba') : tr('Fixar Aba (Pin)'), click: () => ids.forEach(id => this.togglePin(id)) },
      { label: muted ? tr('Reativar Som da Aba') : tr('Mutar Aba'), enabled: !!first.view, click: () => ids.forEach(id => this.toggleMute(id)) },
      { type: 'separator' },
      { label: tr('Adicionar a um novo grupo…'), enabled: !first.pinned, click: () => this.openGroupEditor(0, ids) },
    ];
    if (this.groups.length) {
      items.push({ label: tr('Adicionar ao grupo'), submenu: this.groups.map(g => ({ label: g.name || tr('Grupo sem nome'), click: () => this.assignGroup(ids, g.id) })) });
    }
    if (grouped) items.push({ label: tr('Remover do grupo'), click: () => this.removeFromGroup(ids) });
    items.push(
      { type: 'separator' },
      { label: tr('Abrir lado a lado com a aba ativa'), enabled: ids.length === 1 && ids[0] !== this.activeId, click: () => this.openSplit(ids[0]) },
      { type: 'separator' },
      { label: tr('Fechar Outras Abas'), enabled: this.tabs.length > 1, click: () => this.closeOthers(ids[0]) },
      { label: tr('Fechar Abas à Direita'), enabled: this.tabs.indexOf(first) < this.tabs.length - 1, click: () => this.closeRight(ids[0]) },
      { type: 'separator' },
      { label: tr('Restaurar Aba'), enabled: this.closedStack.length > 0, click: () => this.reopen() },
    );
    Menu.buildFromTemplate(items).popup({ window: this.win });
  }

  groupMenu(gid) {
    const g = this.groups.find(x => x.id === gid);
    if (!g) return;
    Menu.buildFromTemplate([
      { label: tr('Editar nome e cor…'), click: () => this.openGroupEditor(gid, []) },
      { label: tr('Nova aba no grupo'), click: () => { const t0 = this.newTab(paths.PAGES.newtab); if (t0) this.assignGroup([t0.id], gid); } },
      { type: 'separator' },
      { label: tr('Desagrupar'), click: () => this.removeFromGroup(this.tabs.filter(x => x.group === gid).map(x => x.id)) },
      { label: tr('Fechar grupo'), click: () => this.tabs.filter(x => x.group === gid).forEach(x => this.closeTab(x.id)) },
    ]).popup({ window: this.win });
  }

  // ---------- divisão de tela ----------
  openSplit(otherId) {
    const cur = this.active();
    if (!cur) return;
    let other = otherId ? this.tabs.find(x => x.id === otherId) : this.newTab(paths.PAGES.newtab, { after: cur.id, activate: false });
    if (!other || other === cur) return;
    if (other.snoozed) this.wake(other);
    this.split = { a: cur.id, b: other.id };
    this.hideOverlay();
    this.mount();
    this.layout();
    this.push();
  }

  closeSplit() {
    if (!this.split) return;
    this.split = null;
    this.hideOverlay();
    this.mount();
    this.layout();
    this.push();
  }

  // Clique dentro de uma das duas páginas: ela passa a ser a ativa (barra de endereço e atalhos)
  onTabFocus(wcId) {
    const x = this.tabByWc(wcId);
    if (x && this.split && (this.split.a === x.id || this.split.b === x.id) && this.activeId !== x.id) {
      this.activeId = x.id;
      x.lastActive = Date.now();
      this.push();
    }
  }

  // ---------- Picture-in-Picture ----------
  async pip(pt) {
    const a = this.active();
    if (!a || !a.view || !web(a.url)) return this.toast(tr('Abra uma página com vídeo.'));
    const wc = a.view.webContents;
    let result = 'none';
    for (const frame of wc.mainFrame.framesInSubtree) {
      try {
        const code = `(${pipInPage})(${frame === wc.mainFrame ? JSON.stringify(pt || null) : 'null'})`;
        const r = await frame.executeJavaScript(code, true); // true = simula um gesto do usuário
        if (r === 'ok' || r === 'exit') return;
        if (r === 'fail') result = 'fail';
      } catch { /* iframe sem acesso */ }
    }
    this.toast(result === 'fail' ? tr('Este vídeo não aceita Picture-in-Picture.') : tr('Nenhum vídeo encontrado nesta página.'));
  }

  // ---------- bloqueador de anúncios ----------
  toggleShield() {
    const a = this.active();
    if (!a || !web(a.url)) return;
    const host = siteOf(a.url);
    store.setAdblockOff(host, !store.isAdblockOff(host));
    a.shield = newShield();
    if (a.view) a.view.webContents.reload();
    this.push();
    this.rerenderOverlay();
  }

  // Dados do pop-up do bloqueador (a página ui/adblock-popup.html pede por get-adblock-stats)
  adblockStats() {
    const a = this.active();
    const url = a ? a.url : '';
    const host = siteOf(url);
    const sh = a ? a.shield : newShield();
    const passed = [...sh.passed.values()].sort((x, y) => y.n - x.n);
    return {
      supported: web(url), host,
      enabled: !store.isAdblockOff(host),
      global: store.get().nativeAdblock,
      conflict: extensions.blockersOf(this.ses), // extensão bloqueadora detectada: o bloqueio nativo fica em pausa
      blockedCount: sh.blocked, cats: sh.cats, blockedRequests: sh.recent.slice(-50).reverse(),
      passed: passed.slice(0, 60), passedTotal: passed.reduce((n, x) => n + x.n, 0),
    };
  }

  showShield(rect) {
    if (this.dead || !rect) return;
    this.hideOverlay();
    const [w, h] = this.win.getContentSize();
    const width = 360;
    const x = Math.max(4, Math.min(Math.round(rect.right - width), w - width - 4));
    const y = Math.round(rect.bottom) + 4;
    this.shieldBase = { x, y, width, maxH: Math.max(160, h - y - 8) };
    this.shieldView.setBounds({ x, y, width, height: Math.min(380, this.shieldBase.maxH) });
    this.win.contentView.addChildView(this.shieldView);
    this.shieldOpen = true;
    this.shieldView.webContents.send('adblock:show');
    this.shieldView.webContents.focus();
  }

  hideShield() {
    if (!this.shieldOpen) return;
    this.shieldOpen = false;
    try { this.win.contentView.removeChildView(this.shieldView); } catch { /* já removido */ }
    if (!this.shieldView.webContents.isDestroyed()) this.shieldView.webContents.send('adblock:hide');
  }

  setShieldHeight(hgt) {
    const b = this.shieldBase;
    if (!this.shieldOpen || !b || !Number.isFinite(hgt)) return;
    this.shieldView.setBounds({ x: b.x, y: b.y, width: b.width, height: Math.min(Math.max(120, Math.ceil(hgt)), b.maxH) });
  }

  // ---------- modo leitura ----------
  async checkReadable(tab) {
    if (!web(tab.url) || !tab.view || tab.snoozed) return;
    const wc = tab.view.webContents;
    try {
      const ok = !!(await reader.detect(wc));
      if (!wc.isDestroyed() && ok !== tab.readable) { tab.readable = ok; this.push(); }
    } catch { /* página trocou durante a checagem */ }
  }

  async openReader() {
    const a = this.active();
    if (!a || !a.view || !web(a.url)) return;
    try {
      const art = await reader.extract(a.view.webContents);
      if (!art || !art.ok) return this.toast(tr('Não encontrei um artigo para o modo leitura nesta página.'));
      const token = crypto.randomBytes(6).toString('hex');
      readerStore.set(token, { art, at: Date.now() });
      while (readerStore.size > 20) readerStore.delete(readerStore.keys().next().value);
      this.newTab(paths.PAGES.reader + '#' + token, { after: a.id });
    } catch {
      this.toast(tr('Não foi possível abrir o modo leitura.'));
    }
  }

  // ---------- player de áudio (a tag <audio> mora na janela principal; o painel só manda comandos) ----------
  setAudioState(s) {
    if (!s || typeof s !== 'object') return;
    const clean = {
      playing: !!s.playing, title: String(s.title || '').slice(0, 200), index: Number.isInteger(s.index) ? s.index : -1,
      count: Math.max(0, Math.min(5000, Number(s.count) || 0)), time: Number(s.time) || 0, duration: Number(s.duration) || 0,
      volume: Math.max(0, Math.min(1, Number(s.volume) || 0)), loop: !!s.loop, shuffle: !!s.shuffle,
    };
    if (Array.isArray(s.names)) clean.names = s.names.slice(0, 500).map(x => String(x).slice(0, 120));
    this.audio = { names: [], ...(this.audio || {}), ...clean };
    const playing = () => [...all].find(x => x.audio && x.audio.count > 0);
    audio.mediaKeys(!!playing(), cmd => { const b = playing(); if (b) b.audioCmd({ cmd }); });
    if (this.overlayType === 'menu' && !this.overlay.webContents.isDestroyed()) this.overlay.webContents.send('overlay:audio', this.audio);
  }

  audioCmd(c) {
    const cmd = String((c && c.cmd) || '');
    if (!['toggle', 'play', 'pause', 'next', 'prev', 'stop', 'seek', 'volume', 'loop', 'shuffle', 'clear', 'jump'].includes(cmd)) return;
    this.send('audio:cmd', { cmd, value: Number(c.value) || 0 });
  }

  // ---------- informações do site (cadeado) ----------
  async siteData() {
    const a = this.active();
    const url = a ? a.url : '';
    const host = siteOf(url);
    let u = null;
    try { u = new URL(url); } catch { /* ok */ }
    const perms = {};
    for (const k of Object.keys(store.SITE_PERMS)) perms[k] = { value: store.effectivePerm(host, k), saved: !!store.sitePerm(host, k) };
    let cookies = 0;
    if (web(url)) { try { cookies = (await this.ses.cookies.get({ url })).length; } catch { /* ok */ } }
    return {
      url, host, title: a ? a.title : '', web: web(url), internal: paths.isInternal(url),
      protocol: u ? u.protocol.replace(':', '') : '', port: u ? (u.port || (u.protocol === 'https:' ? '443' : '80')) : '',
      cert: u && u.protocol === 'https:' ? security.certFor(host) : null,
      cookies, perms, options: store.SITE_PERMS,
    };
  }

  setSitePerm(key, value) {
    const a = this.active();
    if (!a || !web(a.url) || !store.SITE_PERMS[key]) return;
    const host = siteOf(a.url);
    store.setSitePerm(host, key, value);
    if (RELOAD_KEYS.has(key) && a.view) a.view.webContents.reload(); // essas políticas vêm nos cabeçalhos da página
    if (this.overlayType === 'site') this.siteData().then(d => { if (this.overlayType === 'site') this.overlay.webContents.send('overlay:render', { type: 'site', data: d }); });
  }

  async clearSiteCookies() {
    const a = this.active();
    if (!a || !web(a.url)) return;
    try {
      for (const c of await this.ses.cookies.get({ url: a.url })) await this.ses.cookies.remove(a.url, c.name);
    } catch { /* ok */ }
    if (a.view) a.view.webContents.reload();
    if (this.overlayType === 'site') this.siteData().then(d => this.overlay.webContents.send('overlay:render', { type: 'site', data: d }));
  }

  // ---------- suspensão de abas (economia de RAM) ----------
  async snooze(tab) {
    const wc = tab.view.webContents;
    let info = { y: 0, pip: false };
    try { info = await wc.executeJavaScript('({ y: window.scrollY, pip: !!document.pictureInPictureElement })'); } catch { /* ok */ }
    if (tab.id === this.activeId || !tab.view || wc.isDestroyed() || info.pip) return; // voltou a ser usada, ou tem vídeo em PiP
    tab.scrollY = Number(info.y) || 0;
    tab.url = wc.getURL() || tab.url;
    tab.title = wc.getTitle() || tab.title; // só o título e o favicon ficam guardados
    this.unmount(tab);
    registry.delete(wc.id);
    wc.close();
    tab.view = null;
    tab.snoozed = true;
    tab.loading = false;
    tab.audible = false;
    this.push();
  }

  wake(tab) {
    tab.snoozed = false;
    this.makeView(tab);
    const wc = tab.view.webContents;
    wc.once('did-finish-load', () => { wc.executeJavaScript(`window.scrollTo(0, ${Number(tab.scrollY) || 0})`).catch(() => {}); });
    wc.loadURL(tab.url).catch(() => {});
  }

  sweep() {
    if (this.dead) return;
    const s = store.get();
    const now = Date.now();
    if (s.tabSnooze) {
      for (const x of this.tabs) {
        if (x.id === this.activeId || x.snoozed || !x.view || x.crashed || x.loading || x.audible) continue;
        if (paths.isInternal(x.url) || !web(x.url) || this.partner(this.active()) === x) continue;
        if (now - x.lastActive > s.snoozeMinutes * 60000) this.snooze(x);
      }
    }
    // Janela principal sem foco por 10 min: libera caches de código e DNS
    if (this.ses === session.defaultSession) {
      if (!this.win.isFocused()) {
        this.unfocusedSince ||= now;
        if (now - this.unfocusedSince > 600000) {
          this.unfocusedSince = now;
          this.ses.clearCodeCaches({}).catch(() => {});
          this.ses.clearHostResolverCache().catch(() => {});
        }
      } else this.unfocusedSince = 0;
    }
  }

  // ---------- eventos de cada aba ----------
  wire(tab) {
    const wc = tab.view.webContents;
    const refresh = () => {
      if (wc.isDestroyed()) return;
      tab.url = wc.getURL() || tab.url;
      tab.canBack = wc.navigationHistory.canGoBack();
      tab.canFwd = wc.navigationHistory.canGoForward();
      if (paths.isInternal(tab.url)) tab.favicon = ICON_URL;
      this.push();
    };

    wc.setWindowOpenHandler(d => this.onWindowOpen(tab, d));
    wc.on('page-title-updated', (_e, title) => { tab.title = title; this.push(); });
    wc.on('page-favicon-updated', (_e, icons) => { if (!paths.isInternal(tab.url)) { tab.favicon = icons[0] || ''; this.push(); } });
    wc.on('did-start-loading', () => { tab.loading = true; this.push(); });
    wc.on('did-stop-loading', () => { tab.loading = false; refresh(); this.afterLoad(tab); });
    wc.on('did-navigate', () => { tab.favicon = ''; tab.translated = false; tab.readable = false; tab.navAt = Date.now(); tab.shield = newShield(); refresh(); });
    wc.on('did-navigate-in-page', refresh);
    wc.on('audio-state-changed', e => { tab.audible = !!e.audible; this.push(); });
    // Se o processo de uma aba cair, só essa aba é afetada. Ao clicar nela, recarrega.
    wc.on('render-process-gone', () => { tab.crashed = true; tab.loading = false; this.push(); });
    wc.on('enter-html-full-screen', () => { tab.full = true; this.win.setFullScreen(true); this.layout(); });
    wc.on('leave-html-full-screen', () => { tab.full = false; this.win.setFullScreen(false); this.layout(); });
    wc.on('context-menu', (_e, p) => this.pageMenu(tab, p));
  }

  // Pop-ups: respeita a regra do site; senão barra os que abrem logo ao carregar; pop-ups de login (com tamanho) viram janela própria
  onWindowOpen(tab, d) {
    const url = d.url;
    if (url !== 'about:blank' && !security.allowedUrl(url)) { security.external(url); return { action: 'deny' }; }
    const rule = store.effectivePerm(siteOf(tab.url), 'popups');
    if (rule === 'block') return { action: 'deny' };
    if (rule !== 'allow' && Date.now() - tab.navAt < 1200) return { action: 'deny' };
    if (/(^|,)\s*(width|height|popup)/i.test(d.features || '')) {
      if (rule !== 'allow' && Date.now() - tab.lastPopup < 2000) return { action: 'deny' };
      tab.lastPopup = Date.now();
      return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, webPreferences: security.prefs({ session: this.ses }) } };
    }
    this.newTab(url, { after: tab.id });
    return { action: 'deny' };
  }

  afterLoad(tab) {
    if (!web(tab.url) || tab.snoozed) return;
    if (!this.guest) store.addHistory(this.profileId, { url: tab.url, title: tab.title, t: Date.now() });
    this.checkReadable(tab);
    setTimeout(() => this.checkReadable(tab), 2000); // páginas que montam o texto depois
    if (store.get().translateAuto && tab.autoUrl !== tab.url) { tab.autoUrl = tab.url; this.autoTranslate(tab); }
  }

  async autoTranslate(tab) {
    try {
      const lang = String(await tab.view.webContents.executeJavaScript('document.documentElement.lang || ""')).toLowerCase();
      const base = store.get().translateTarget.split('-')[0].toLowerCase();
      if (lang && !lang.startsWith(base)) await this.translate({ tab, silent: true });
    } catch { /* página fechou ou sem idioma declarado */ }
  }

  pageMenu(tab, p) {
    const wc = tab.view.webContents;
    const items = [];
    if (p.linkURL && security.allowedUrl(p.linkURL)) {
      items.push(
        { label: tr('Abrir link em nova aba'), click: () => this.newTab(p.linkURL, { after: tab.id }) },
        { label: tr('Copiar endereço do link'), click: () => clipboard.writeText(p.linkURL) },
        { type: 'separator' },
      );
    }
    if (p.mediaType === 'video') items.push({ label: tr('Picture-in-Picture'), click: () => this.pip({ x: p.x, y: p.y }) }, { type: 'separator' });
    if (p.selectionText) {
      items.push(
        { label: tr('Copiar'), click: () => wc.copy() },
        { label: tr('Traduzir seleção (Google)'), click: () => this.translateSelection(p.selectionText) },
      );
    }
    if (p.isEditable) items.push({ label: tr('Colar'), click: () => wc.paste() });
    if (items.length && items[items.length - 1].type !== 'separator') items.push({ type: 'separator' });
    items.push(
      { label: tr('Voltar'), enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
      { label: tr('Recarregar'), click: () => wc.reload() },
    );
    if (web(tab.url)) items.push({ label: tr('Traduzir esta página (Google)'), click: () => this.translate() });
    items.push({ type: 'separator' }, { label: tr('Inspecionar'), click: () => wc.inspectElement(p.x, p.y) });
    Menu.buildFromTemplate(items).popup({ window: this.win });
  }

  openInternal(url) {
    if (!url) return;
    const base = url.split('#')[0];
    const x = this.tabs.find(y => y.view && y.url.split('#')[0] === base);
    if (x) { x.view.webContents.loadURL(url).catch(() => {}); this.switchTab(x.id); } else this.newTab(url);
  }

  go(text, sender) {
    const x = this.tabs.find(y => y.view && y.view.webContents === sender) || this.active();
    if (!x || !x.view) return;
    this.hideOverlay();
    x.view.webContents.loadURL(toUrl(text)).catch(() => {});
    x.view.webContents.focus();
  }

  // ---------- tradução (Google Tradutor) ----------
  status(text, error = false) {
    if (!this.dead && !this.overlay.webContents.isDestroyed()) this.overlay.webContents.send('overlay:status', { text, error });
  }

  async translate(o = {}) {
    const a = o.tab || this.active();
    if (!a || !a.view || !web(a.url)) return;
    const target = o.target || store.get().translateTarget;
    if (!o.silent) this.status(tr('Traduzindo…'));
    try {
      const n = await translate.translatePage(a.view.webContents, target, store.getGoogleKey());
      a.translated = n > 0 || a.translated;
      if (!o.silent) this.status(n ? tr('Página traduzida ({n} trechos).', { n }) : tr('Não há texto novo para traduzir.'));
    } catch (err) {
      if (!o.silent) this.status(errText(err), true);
    }
    this.push();
  }

  async restoreOriginal() {
    const a = this.active();
    if (!a || !a.view) return;
    try { await translate.restorePage(a.view.webContents); } catch { /* ok */ }
    a.translated = false;
    this.status(tr('Texto original restaurado.'));
    this.push();
  }

  async translateSelection(text) {
    this.showOverlay({ type: 'translation', rect: this.topRight() });
    const send = data => { if (!this.overlay.webContents.isDestroyed()) this.overlay.webContents.send('overlay:render', { type: 'translation', data }); };
    send({ loading: true });
    const target = store.get().translateTarget;
    try {
      const r = await translate.translateTexts([String(text).slice(0, 4000)], target, store.getGoogleKey());
      send({ text: r.texts[0], from: r.from, target });
    } catch (err) {
      send({ error: errText(err) });
    }
  }

  // ---------- painel flutuante ----------
  overlayData(type) {
    const s = store.get();
    const a = this.active();
    switch (type) {
      case 'menu': return { zoom: this.zoomPercent(), incognito: this.incognito, mac: process.platform === 'darwin', audio: this.audio };
      case 'translate': return { canTranslate: !!a && web(a.url), translated: !!(a && a.translated), target: s.translateTarget, auto: s.translateAuto, langs: translate.LANGS, hasKey: store.hasGoogleKey() };
      case 'extensions': return { list: this.incognito ? [] : extensions.list(), incognito: this.incognito };
      case 'downloads': return { list: downloads.list().slice(0, 8).map(e => ({ id: e.id, name: e.name, url: e.url, state: e.state, received: e.received, total: e.total, pending: e.pending, kind: e.kind, risk: e.risk })), summary: downloads.summary() };
      case 'group': {
        const g = this.groupDraft && this.groupDraft.gid ? this.groups.find(x => x.id === this.groupDraft.gid) : null;
        return { editing: !!g, name: g ? g.name : '', color: g ? g.color : GROUP_COLORS[1], colors: GROUP_COLORS };
      }
      case 'split': return { active: !!this.split, tabs: this.tabs.filter(x => x.id !== this.activeId).map(x => ({ id: x.id, title: x.title, favicon: x.favicon })) };
      default: return {};
    }
  }

  showOverlay(p) {
    if (!p || !OVERLAYS.has(p.type) || this.dead) return;
    this.hideShield();
    if (p.type === 'site') { this.siteData().then(d => this.paintOverlay(p, d)); return; }
    this.paintOverlay(p, null);
  }

  paintOverlay({ type, rect, data }, pre) {
    if (this.dead) return;
    const r = { left: 0, right: 0, bottom: CHROME_H - 8, width: 0, ...rect };
    const [w, h] = this.win.getContentSize();
    const width = type === 'suggest' ? Math.max(260, Math.round(r.width)) : type === 'menu' ? 300 : (type === 'site' || type === 'downloads') ? 360 : 340;
    const x = Math.max(4, Math.min(Math.round(type === 'suggest' ? r.left : r.right - width), w - width - 4));
    const y = Math.round(r.bottom) + 4;
    this.overlayBase = { x, y, width, maxH: Math.max(120, h - y - 8) };
    this.overlayType = type;

    let payload = pre || {};
    let guess = 380;
    if (type === 'suggest') {
      const items = (data && Array.isArray(data.items) ? data.items : []).slice(0, 6).map(i => ({ type: String(i.type), title: String(i.title).slice(0, 200), url: String(i.url).slice(0, 500) }));
      payload = { items, sel: Number.isInteger(data && data.sel) ? data.sel : -1 };
      guess = 12 + 44 * items.length;
    } else if (!pre && type !== 'translation') payload = this.overlayData(type);
    if (type === 'downloads') downloads.seen();

    this.overlayShownAt = Date.now();
    this.overlay.setBounds({ x, y, width, height: Math.min(guess, this.overlayBase.maxH) });
    this.win.contentView.addChildView(this.overlay); // volta para o topo
    this.overlay.webContents.send('overlay:render', { type, data: payload });
    if (type !== 'suggest') this.overlay.webContents.focus();
  }

  hideOverlay(type) {
    if (!type) this.hideShield();
    if (!this.overlayType || (type && this.overlayType !== type)) return;
    this.overlayType = null;
    try { this.win.contentView.removeChildView(this.overlay); } catch { /* já removido */ }
  }

  // O painel anterior (ex.: o menu ☰) perde o foco para o novo e avisa tarde demais. Sem este filtro, o painel novo fecharia sozinho.
  overlayBlur() {
    const t = this.overlayType;
    if (!t || t === 'suggest') return;
    if (Date.now() - (this.overlayShownAt || 0) < 300) {
      setTimeout(() => { if (this.overlayType === t && !this.overlay.webContents.isFocused()) this.hideOverlay(); }, 400);
      return;
    }
    this.hideOverlay();
  }

  rerenderOverlay() {
    const ty = this.overlayType;
    if (ty && ['menu', 'translate', 'extensions', 'downloads', 'split'].includes(ty) && !this.overlay.webContents.isDestroyed()) {
      this.overlay.webContents.send('overlay:render', { type: ty, data: this.overlayData(ty) });
    }
  }

  setOverlayHeight(hgt) {
    const b = this.overlayBase;
    if (!this.overlayType || !b || !Number.isFinite(hgt)) return;
    this.overlay.setBounds({ x: b.x, y: b.y, width: b.width, height: Math.min(Math.max(40, Math.ceil(hgt)), b.maxH) });
  }

  topRight() {
    const [w] = this.win.getContentSize();
    return { left: w - 372, right: w - 12, bottom: CHROME_H - 8, width: 360 };
  }

  // ---------- ações do menu ☰ ----------
  zoomPercent() {
    const a = this.active();
    return a && a.view ? Math.round(a.view.webContents.getZoomFactor() * 100) : 100;
  }

  zoom(delta) {
    const a = this.active();
    if (!a || !a.view) return;
    const wc = a.view.webContents;
    wc.setZoomLevel(delta === 0 ? 0 : Math.max(-4, Math.min(5, wc.getZoomLevel() + delta)));
    this.rerenderOverlay();
  }

  toggleDevTools() {
    const a = this.active();
    if (!a || !a.view) return;
    const wc = a.view.webContents;
    if (wc.isDevToolsOpened()) wc.closeDevTools(); else wc.openDevTools({ mode: 'detach' });
  }

  toggleBookmark() {
    const a = this.active();
    if (!a || !web(a.url)) return;
    store.toggleBookmark(this.profileId, { url: a.url, title: a.title, favicon: a.favicon });
    this.push();
  }

  menuAction(name) {
    if (name === 'zoomIn') return this.zoom(0.5);
    if (name === 'zoomOut') return this.zoom(-0.5);
    if (name === 'zoomReset') return this.zoom(0);
    this.hideOverlay();
    const actions = {
      newtab: () => this.newTab(),
      newwindow: () => Browser.open({ urls: [paths.PAGES.newtab], profileId: this.profileId }),
      incognito: () => Browser.open({ profileId: profiles.GUEST }),
      history: () => this.openInternal(paths.DEVOID.historico),
      downloads: () => this.openInternal(paths.DEVOID.downloads),
      bookmarks: () => this.openInternal(paths.DEVOID.favoritos),
      accounts: () => this.openInternal(paths.DEVOID.accounts),
      extensions: () => this.openInternal(paths.DEVOID.extensions), // página de gerenciamento (devoid://extensions)
      translate: () => this.showOverlay({ type: 'translate', rect: this.topRight() }),
      settings: () => this.openInternal(paths.DEVOID.settings),
      devtools: () => this.toggleDevTools(),
      fullscreen: () => this.win.setFullScreen(!this.win.isFullScreen()),
      quit: () => app.quit(),
    };
    if (actions[name]) actions[name]();
  }

  // ---------- configurações e sessão ----------
  applySettings() {
    if (this.dead) return;
    try { this.win.setTitleBarOverlay({ ...store.titleBar(), height: STRIP_H }); } catch { /* não suportado */ }
    this.layout();
    this.push();
  }

  broadcastSettings() {
    if (this.dead) return;
    const payload = { settings: store.publicSettings(), vars: store.cssVars() };
    const targets = [this.ui, this.overlay.webContents];
    for (const x of this.tabs) if (x.view && paths.isInternal(x.url)) targets.push(x.view.webContents);
    for (const wc of targets) if (!wc.isDestroyed()) wc.send('settings:changed', payload);
  }

  saveSession() {
    if (this.guest || !this.tabs.length) return;
    store.saveSession(this.profileId, this.tabs.filter(x => web(x.url)).map(x => ({ url: x.url, pinned: x.pinned })));
  }

  processes() {
    return this.tabs.map(x => ({ title: x.title, snoozed: x.snoozed, pid: x.view ? x.view.webContents.getOSProcessId() : 0 }));
  }
}

// Um único relógio para todas as janelas; para sozinho quando não há janela aberta
let sweeper = null;
function startSweeper() {
  if (sweeper) return;
  sweeper = setInterval(() => {
    for (const b of all) b.sweep();
    gcSecondary();
    if (!all.size) { clearInterval(sweeper); sweeper = null; }
  }, 60000);
}

// Coleta de lixo passiva nas sessões secundárias (anônima e perfis) quando a janela fica parada
function gcSecondary() {
  const now = Date.now();
  const seen = new Set();
  for (const b of all) {
    if (b.ses === session.defaultSession || seen.has(b.ses)) continue;
    seen.add(b.ses);
    if (!b.win.isFocused() && now - b.lastFocus > 300000) {
      b.ses.clearCodeCaches({}).catch(() => {});
      b.ses.clearHostResolverCache().catch(() => {});
      b.ses.closeAllConnections().catch(() => {});
    }
  }
}

module.exports = { Browser, registry, all, GROUP_COLORS, readerArticle };
