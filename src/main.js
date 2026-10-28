'use strict';
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, Menu, session, globalShortcut } = require('electron');
const store = require('./modules/store');

// ---------- Flags do Chromium (precisam vir ANTES do app ficar pronto) ----------
if (store.get().hardwareAccel === false) {
  app.disableHardwareAcceleration();
} else {
  app.commandLine.appendSwitch('enable-gpu-rasterization');
  app.commandLine.appendSwitch('enable-zero-copy');
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
  app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecoder'); // decodificação de vídeo por hardware no Linux
}
// Menos serviços em segundo plano e nada de telemetria do Chromium
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('disable-breakpad');
app.commandLine.appendSwitch('no-pings');
app.commandLine.appendSwitch('disable-features', 'AutofillServerCommunication,OptimizationHints,MediaRouter');

const i18n = require('./ui/i18n.js');
i18n.setLang(store.language());
const tr = i18n.t;

const paths = require('./modules/paths');
const profiles = require('./modules/profiles');
const security = require('./modules/security');
const extensions = require('./modules/extensions');
const blocklist = require('./modules/blocklist');
const chooser = require('./modules/chooser');
const ipc = require('./modules/ipc');
const { Browser, registry, all } = require('./modules/browser');

const isMac = process.platform === 'darwin';

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
app.on('second-instance', () => {
  const b = [...all][0];
  if (!b) return;
  if (b.win.isMinimized()) b.win.restore();
  b.win.focus();
});

// Qual janela recebe o atalho
const cur = () => {
  const w = BrowserWindow.getFocusedWindow();
  return (w && registry.get(w.webContents.id)) || [...all][0];
};
const run = fn => () => { const b = cur(); if (b) fn(b); };
const reload = b => { const t = b.active(); if (t && t.view) t.view.webContents.reload(); };
const nav = (b, dir) => { const t = b.active(); if (t && t.view) t.view.webContents.navigationHistory[dir](); };

function buildMenu() {
  const item = (label, accelerator, fn) => ({ label: tr(label), accelerator, click: run(fn) });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{ role: 'appMenu' }, { role: 'editMenu' }] : []),
    {
      label: 'Devoid Web',
      submenu: [
        item('Nova aba', 'CmdOrCtrl+T', b => b.newTab()),
        item('Nova janela', 'CmdOrCtrl+N', b => b.menuAction('newwindow')),
        item('Nova janela anônima', 'CmdOrCtrl+Shift+N', b => b.menuAction('incognito')),
        item('Fechar aba', 'CmdOrCtrl+W', b => b.closeTab(b.activeId)),
        item('Reabrir aba fechada', 'CmdOrCtrl+Shift+T', b => b.reopen()),
        item('Próxima aba', 'Ctrl+Tab', b => b.cycle(1)),
        item('Aba anterior', 'Ctrl+Shift+Tab', b => b.cycle(-1)),
        { type: 'separator' },
        item('Barra de endereço', 'CmdOrCtrl+L', b => b.send('focus-address')),
        item('Voltar', isMac ? 'Cmd+[' : 'Alt+Left', b => nav(b, 'goBack')),
        item('Avançar', isMac ? 'Cmd+]' : 'Alt+Right', b => nav(b, 'goForward')),
        item('Recarregar', 'CmdOrCtrl+R', reload),
        item('Recarregar', 'F5', reload),
        { type: 'separator' },
        item('Adicionar aos favoritos', 'CmdOrCtrl+D', b => b.toggleBookmark()),
        item('Favoritos', 'CmdOrCtrl+Shift+O', b => b.menuAction('bookmarks')),
        item('Histórico', 'CmdOrCtrl+H', b => b.menuAction('history')),
        item('Downloads', 'CmdOrCtrl+J', b => b.menuAction('downloads')),
        { type: 'separator' },
        item('Modo leitura', 'CmdOrCtrl+Alt+R', b => b.openReader()),
        item('Picture-in-Picture', 'CmdOrCtrl+Shift+P', b => b.pip()),
        item('Tocar ou pausar o áudio', 'CmdOrCtrl+Alt+Space', b => b.audioCmd({ cmd: 'toggle' })),
        item('Próxima faixa', 'CmdOrCtrl+Alt+Right', b => b.audioCmd({ cmd: 'next' })),
        item('Faixa anterior', 'CmdOrCtrl+Alt+Left', b => b.audioCmd({ cmd: 'prev' })),
        { type: 'separator' },
        item('Aumentar zoom', 'CmdOrCtrl+Plus', b => b.zoom(0.5)),
        item('Diminuir zoom', 'CmdOrCtrl+-', b => b.zoom(-0.5)),
        item('Zoom padrão', 'CmdOrCtrl+0', b => b.zoom(0)),
        item('Tela cheia', 'F11', b => b.menuAction('fullscreen')),
        item('Ferramentas do desenvolvedor', 'F12', b => b.toggleDevTools()),
        item('Ferramentas do desenvolvedor', 'CmdOrCtrl+Shift+I', b => b.toggleDevTools()),
        ...(isMac ? [] : [{ type: 'separator' }, { role: 'quit', label: tr('Sair do Devoid Web') }]),
      ],
    },
  ]));
}

// DNS seguro (DoH): usa o servidor escolhido em Configurações, ou o DNS do sistema
function applyDns() {
  const d = store.dnsServers();
  try {
    if (d) app.configureHostResolver({ enableBuiltInResolver: true, secureDnsMode: d.strict ? 'secure' : 'automatic', secureDnsServers: d.servers });
    else app.configureHostResolver({ secureDnsMode: 'off' });
  } catch { /* versão sem suporte */ }
}

// Abas que abrem junto com o perfil
function startupUrls(profileId) {
  const s = store.get();
  if (profiles.isGuest(profileId)) return [paths.PAGES.newtab];
  if (store.isFirstRun()) { store.set({ welcomed: true }); return [paths.PAGES.welcome]; } // primeira abertura: boas-vindas
  if (s.startup === 'restore') { const saved = store.loadSession(profileId); if (saved.length) return saved; }
  if (s.startup === 'pages' && s.startupPages.length) return s.startupPages;
  return [paths.PAGES.newtab];
}

const launch = profileId => Browser.open({ profileId, urls: startupUrls(profileId) });

// Antes de qualquer janela do navegador: pergunta o perfil (a menos que o usuário tenha pedido para lembrar a escolha)
function begin() {
  const cfg = profiles.config();
  if (cfg.remember && (profiles.isGuest(cfg.last) || profiles.get(cfg.last))) { launch(cfg.last); return; }
  chooser.show(launch, () => { if (![...all].length) app.quit(); });
}

app.whenReady().then(async () => {
  if (!gotLock) return;
  security.installGlobalGuards();
  security.setupSession(session.defaultSession); // a sessão padrão só serve às janelas internas; as abas usam a do perfil
  blocklist.loadExtra(app.getPath('userData'));
  blocklist.setCustom(store.get().customBlocklist);
  applyDns();
  fs.rmSync(path.join(app.getPath('userData'), 'wallpaper'), { recursive: true, force: true }); // sobra da função removida

  await extensions.init(session.defaultSession);
  ipc.register();
  ipc.onSettings.fn = () => { buildMenu(); applyDns(); };
  buildMenu();
  begin();
});

app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) begin(); });
app.on('window-all-closed', () => { if (!isMac) app.quit(); });
app.on('will-quit', () => globalShortcut.unregisterAll());

// Limpeza de dados ao fechar (se o usuário ligou em Configurações > Privacidade)
let cleaned = false;
app.on('before-quit', e => {
  const c = store.get().clearOnExit;
  if (cleaned || !(c.cookies || c.cache || c.history || c.siteData)) return;
  e.preventDefault();
  cleaned = true;
  ipc.clearData(c).finally(() => { store.flush(); app.quit(); });
});
