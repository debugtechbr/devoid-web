'use strict';
const fs = require('fs');
const { app, ipcMain, dialog, session, net, BrowserWindow } = require('electron');
const store = require('./store');
const paths = require('./paths');
const downloads = require('./downloads');
const extensions = require('./extensions');
const blocklist = require('./blocklist');
const profiles = require('./profiles');
const audio = require('./audio');
const chooser = require('./chooser');
const i18n = require('../ui/i18n.js');
const { suggest } = require('./omnibox');
const { Browser, registry, all, readerArticle } = require('./browser');

const tr = i18n.t;
const isStr = (v, n = 2000) => typeof v === 'string' && v.length <= n;
const isId = v => Number.isInteger(v) && v > 0;
const isRect = r => !!r && ['left', 'right', 'bottom', 'width'].every(k => Number.isFinite(r[k]));
const onSettings = { fn: () => {} }; // o main.js registra aqui o que refazer quando algo muda (menu, DNS)

// Só aceita mensagens da interface, dos painéis e das páginas internas do próprio navegador
const ctx = e => {
  const b = registry.get(e.sender.id);
  return b && e.senderFrame && paths.isInternal(e.senderFrame.url) ? b : null;
};
const on = (ch, fn) => ipcMain.on(ch, (e, ...a) => { const b = ctx(e); if (b) { try { fn(b, e, ...a); } catch (err) { console.error(ch, err); } } });
const handle = (ch, fn) => ipcMain.handle(ch, (e, ...a) => { const b = ctx(e); return b ? fn(b, e, ...a) : null; });

const focused = () => {
  const w = BrowserWindow.getFocusedWindow();
  return (w && registry.get(w.webContents.id)) || [...all][0];
};

function applyAll() {
  i18n.setLang(store.language());
  blocklist.setCustom(store.get().customBlocklist);
  onSettings.fn();
  for (const b of all) { b.broadcastSettings(); b.applySettings(); }
}

// Limpa as sessões indicadas (a do perfil da janela, ou todas ao fechar o navegador)
async function clearData(what = {}, sessions) {
  const list = sessions && sessions.length ? sessions : [...new Set([session.defaultSession, ...profiles.all().map(p => profiles.sessionOf(p.id))])];
  const jobs = [];
  for (const ses of list) {
    if (what.cookies) jobs.push(ses.clearStorageData({ storages: ['cookies'] }));
    if (what.cache) jobs.push(ses.clearCache());
    if (what.siteData) {
      jobs.push(ses.clearStorageData({ storages: ['localstorage', 'indexdb', 'websql', 'serviceworkers', 'cachestorage', 'filesystem'] }));
    }
  }
  if (what.history) for (const p of profiles.all()) store.clearHistory(p.id);
  await Promise.allSettled(jobs);
}

// Mostra o resultado de uma instalação de extensão
async function install(b, job) {
  try {
    const e = await job();
    if (e) await dialog.showMessageBox(b.win, { type: 'info', message: tr('Extensão instalada: {name}', { name: e.name }), buttons: ['OK'] });
  } catch (err) {
    dialog.showErrorBox(tr('Não foi possível instalar a extensão'), err.message);
  }
  b.rerenderOverlay();
  for (const x of all) x.push();
}

const errCode = err => String((err && err.message) || 'FAIL').slice(0, 12);

function register() {
  extensions.setHooks({ onStart: () => { const b = focused(); if (b) b.openInternal(paths.PAGES.guide + '#installing'); } });
  downloads.setHooks({ onCrx: file => { const b = focused(); if (b) install(b, () => extensions.installFromPath(file)); } });

  // ----- mensagens que vêm de páginas da internet (só tocam em coisas inofensivas) -----
  ipcMain.on('split:focus', e => { const b = registry.get(e.sender.id); if (b) b.onTabFocus(e.sender.id); });
  ipcMain.on('app:lang', e => { e.returnValue = e.senderFrame && paths.isInternal(e.senderFrame.url) ? store.language() : 'pt'; });

  // ----- abas, grupos e divisão -----
  on('ui:ready', b => b.push());
  on('tab:new', b => b.newTab());
  on('tab:close', (b, e, id) => isId(id) && b.closeTab(id));
  on('tab:switch', (b, e, id) => isId(id) && b.switchTab(id));
  on('tab:context', (b, e, ids) => { if (Array.isArray(ids) && ids.length && ids.length <= 60 && ids.every(isId)) b.tabMenu(ids); });
  on('tab:mute', (b, e, id) => isId(id) && b.toggleMute(id));
  on('group:context', (b, e, id) => isId(id) && b.groupMenu(id));
  on('group:toggle', (b, e, id) => isId(id) && b.toggleGroup(id));
  on('group:save', (b, e, p) => { if (p && typeof p === 'object') b.saveGroup({ name: p.name, color: p.color }); });
  on('split:open', (b, e, id) => Number.isInteger(id) && id >= 0 && b.openSplit(id));
  on('split:close', b => b.closeSplit());
  on('pip:toggle', (b, e, pt) => b.pip(pt && Number.isFinite(pt.x) && Number.isFinite(pt.y) ? { x: pt.x, y: pt.y } : null));

  // ----- navegação -----
  on('nav:go', (b, e, text) => isStr(text) && b.go(text, e.sender));
  on('nav:back', b => { const x = b.active(); if (x && x.view) x.view.webContents.navigationHistory.goBack(); });
  on('nav:forward', b => { const x = b.active(); if (x && x.view) x.view.webContents.navigationHistory.goForward(); });
  on('nav:reload', b => {
    const x = b.active();
    if (!x || !x.view) return;
    const wc = x.view.webContents;
    if (wc.isLoading()) wc.stop(); else wc.reload();
  });
  on('page:open', (b, e, name) => { if (isStr(name, 24) && Object.hasOwn(paths.DEVOID, name)) b.openInternal(paths.DEVOID[name]); });

  // ----- favoritos e histórico -----
  on('bm:toggle', b => b.toggleBookmark());
  on('bm:remove', (b, e, url) => { if (isStr(url, 600)) { store.removeBookmark(b.profileId, url); b.push(); } });
  on('hist:clear', b => store.clearHistory(b.profileId));
  handle('bm:list', b => store.getBookmarks(b.profileId));
  handle('hist:list', b => store.getHistory(b.profileId).slice(0, 300));
  handle('omni:suggest', (b, e, text) => (isStr(text, 300) ? suggest(text, b.profileId) : []));

  // ----- painel flutuante e menu -----
  on('overlay:show', (b, e, p) => { if (p && isStr(p.type, 20) && isRect(p.rect)) b.showOverlay(p); });
  on('overlay:hide', (b, e, type) => b.hideOverlay(typeof type === 'string' ? type : undefined));
  on('overlay:size', (b, e, h) => b.setOverlayHeight(h));
  on('overlay:blur', b => b.overlayBlur());
  on('menu:action', (b, e, name) => isStr(name, 20) && b.menuAction(name));

  // ----- bloqueador e permissões do site -----
  on('shield:toggle', b => b.toggleShield());
  on('site:setPerm', (b, e, key, value) => { if (isStr(key, 20) && isStr(value, 10)) b.setSitePerm(key, value); });
  on('site:clearCookies', b => b.clearSiteCookies());
  handle('blocklist:info', () => ({ builtin: blocklist.builtinCount(), extra: blocklist.extraCount() }));
  handle('blocklist:file', async b => {
    const r = await dialog.showOpenDialog(b.win, { title: tr('Importar lista de bloqueio'), properties: ['openFile'], filters: [{ name: 'hosts / txt', extensions: ['txt', 'hosts', 'list', '*'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    try { return { ok: true, count: blocklist.importExtra(app.getPath('userData'), fs.readFileSync(r.filePaths[0], 'utf8')) }; } catch (err) { return { ok: false, error: errCode(err) }; }
  });
  handle('blocklist:url', async (b, e, url) => {
    if (!isStr(url, 500) || !/^https:\/\//i.test(url)) return { ok: false, error: 'URL' };
    try {
      const res = await net.fetch(url, { signal: AbortSignal.timeout(45000) });
      if (!res.ok) return { ok: false, error: 'HTTP' };
      const text = await res.text();
      if (text.length > 20 * 1024 * 1024) return { ok: false, error: 'SIZE' };
      return { ok: true, count: blocklist.importExtra(app.getPath('userData'), text) };
    } catch (err) { return { ok: false, error: errCode(err) }; }
  });

  // ----- tradução -----
  on('translate:page', (b, e, target) => b.translate({ target: isStr(target, 8) ? target : undefined }));
  on('translate:restore', b => b.restoreOriginal());
  handle('translate:setKey', (b, e, key) => {
    try { store.setGoogleKey(key); return { ok: true, hasKey: store.hasGoogleKey() }; } catch (err) { return { ok: false, error: err.message }; }
  });

  // ----- extensões -----
  handle('ext:list', () => extensions.list());
  on('ext:pin', (b, e, id) => { if (isStr(id, 40)) { extensions.pin(id); b.rerenderOverlay(); for (const x of all) x.push(); } });
  on('ext:remove', (b, e, id) => { if (isStr(id, 40)) { extensions.remove(id); b.rerenderOverlay(); for (const x of all) x.push(); } });
  on('ext:popup', (b, e, id, rect) => { if (isStr(id, 40)) { b.hideOverlay(); extensions.popup(b.win, id, isRect(rect) ? rect : null, b.ses); } });
  on('ext:installFolder', b => install(b, () => extensions.installFolder()));
  on('ext:installFile', b => install(b, () => extensions.installFile()));
  on('ext:installStore', (b, e, text) => isStr(text, 300) && install(b, () => extensions.installStore(text)));

  // ----- downloads -----
  handle('dl:list', () => downloads.list());
  on('dl:open', (b, e, id) => isId(id) && downloads.open(id));
  on('dl:show', (b, e, id) => isId(id) && downloads.show(id));
  on('dl:cancel', (b, e, id) => isId(id) && downloads.cancel(id));
  on('dl:clear', () => downloads.clear());
  on('dl:decide', (b, e, id, allow) => { if (isId(id) && typeof allow === 'boolean') { downloads.decide(id, allow); b.hideOverlay('downloads'); } });

  // ----- configurações -----
  ipcMain.handle('settings:get', e => {
    const ok = e.senderFrame && paths.isInternal(e.senderFrame.url) && (registry.has(e.sender.id) || chooser.isChooser(e));
    return ok ? { settings: store.publicSettings(), vars: store.cssVars(), meta: store.meta() } : null;
  });
  on('settings:set', (b, e, patch) => { if (patch && typeof patch === 'object' && store.set(patch)) applyAll(); });
  on('welcome:done', () => { store.set({ welcomed: true }); });
  handle('settings:pickDir', async b => {
    const r = await dialog.showOpenDialog(b.win, { title: tr('Pasta de downloads'), properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    store.set({ downloadDir: r.filePaths[0] });
    applyAll();
    return r.filePaths[0];
  });
  handle('data:clear', async (b, e, what) => { await clearData(what && typeof what === 'object' ? what : {}, [b.ses]); return true; });
  handle('perm:list', () => store.get().sitePermissions);
  on('perm:remove', (b, e, host, key) => { if (isStr(host, 200) && isStr(key, 30)) { store.removeSitePerm(host, key); applyAll(); } });

  // ----- contas e perfis (cookies, sessão, histórico e favoritos isolados) -----
  handle('profile:list', b => ({ profiles: profiles.all(), current: b.profileId, colors: profiles.COLORS, icons: profiles.ICONS }));
  handle('profile:create', (b, e, name, color, icon) => {
    try { profiles.create(name, color, icon); return { ok: true, profiles: profiles.all() }; } catch (err) { return { ok: false, error: errCode(err) }; }
  });
  handle('profile:rename', (b, e, id, name, color, icon) => { if (isStr(id, 20)) profiles.rename(id, name, color, icon); return profiles.all(); });
  handle('profile:delete', async (b, e, id) => {
    if (!isStr(id, 20)) return profiles.all();
    if (profiles.all().length < 2) return profiles.all();
    for (const x of [...all]) if (x.profileId === id) x.win.close();
    await profiles.remove(id);
    return profiles.all();
  });
  handle('profile:config', () => profiles.config());
  on('profile:remember', (b, e, flag) => { if (typeof flag === 'boolean') profiles.setConfig({ remember: flag, last: b.profileId }); });
  on('profile:open', (b, e, id, url) => {
    const target = id === profiles.GUEST || profiles.get(id) ? id : profiles.MAIN;
    Browser.forProfile(target, isStr(url, 600) && /^https?:\/\//i.test(url) ? url : undefined);
  });

  // ----- pop-up do bloqueador de anúncios -----
  on('shield:open', (b, e, rect) => { if (isRect(rect)) b.showShield(rect); });
  on('shield:blur', b => b.hideShield());
  on('shield:size', (b, e, h) => b.setShieldHeight(h));
  handle('get-adblock-stats', b => b.adblockStats());
  on('toggle-adblock-site', b => b.toggleShield());
  on('set-adblock-global', (b, e, on_) => { if (typeof on_ === 'boolean' && store.set({ nativeAdblock: on_ })) applyAll(); });

  // ----- player de áudio -----
  on('audio:state', (b, e, st) => { if (e.sender === b.ui) b.setAudioState(st); }); // só a janela principal informa o estado
  on('audio:cmd', (b, e, c) => { if (c && typeof c === 'object') b.audioCmd(c); });
  handle('select-audio-files', async b => {
    const r = await dialog.showOpenDialog(b.win, {
      title: tr('Escolher músicas'), properties: ['openFile', 'multiSelections'],
      filters: [{ name: tr('Áudio'), extensions: ['mp3', 'flac', 'wav', 'ogg', 'aac', 'm4a'] }],
    });
    if (r.canceled) return 0;
    const items = audio.fromPaths(r.filePaths);
    if (items.length) b.send('audio:add', items);
    return items.length;
  });
  handle('select-audio-folder', async b => {
    const r = await dialog.showOpenDialog(b.win, { title: tr('Escolher uma pasta de músicas'), properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return 0;
    const items = audio.scan(r.filePaths[0]);
    if (items.length) b.send('audio:add', items);
    return items.length;
  });

  // ----- modo leitura -----
  on('reader:open', b => b.openReader());
  handle('reader:get', (b, e, token) => (isStr(token, 20) ? readerArticle(token) : null));

  // ----- diagnóstico de desempenho -----
  handle('diag:get', async () => {
    let renderer = '';
    try { renderer = (await app.getGPUInfo('basic')).auxAttributes.glRenderer || ''; } catch { /* sem info */ }
    return {
      gpu: app.getGPUFeatureStatus(),
      renderer,
      versions: { electron: process.versions.electron, chrome: process.versions.chrome },
      processes: app.getAppMetrics().map(m => ({
        pid: m.pid, type: m.type, cpu: Number(m.cpu.percentCPUUsage.toFixed(1)), mem: Math.round((m.memory.workingSetSize || 0) / 1024),
      })),
      tabs: [...all].flatMap(b => b.processes()),
    };
  });
}

module.exports = { register, clearData, onSettings, applyAll };
