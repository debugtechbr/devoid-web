'use strict';
const path = require('path');
const { BrowserWindow, ipcMain } = require('electron');
const profiles = require('./profiles');
const security = require('./security');
const paths = require('./paths');

let win = null;
let winId = 0;
let registered = false;
let onSelect = () => {};
let chosen = false;

// Só a própria janela de escolha (e só a página profiles.html) pode falar com estes canais
const isChooser = e => !!win && !win.isDestroyed() && e.sender.id === winId
  && !!e.senderFrame && e.senderFrame.url.startsWith(paths.PAGES.profiles);

function register() {
  if (registered) return;
  registered = true;
  const handle = (ch, fn) => ipcMain.handle(ch, (e, ...a) => (isChooser(e) ? fn(e, ...a) : null));

  handle('chooser:list', () => ({
    profiles: profiles.all(), guest: profiles.get(profiles.GUEST), config: profiles.config(),
    colors: profiles.COLORS, icons: profiles.ICONS,
  }));
  handle('chooser:create', (e, name, color, icon) => {
    try { profiles.create(name, color, icon); return { ok: true, profiles: profiles.all() }; } catch { return { ok: false }; }
  });
  handle('chooser:delete', async (e, id) => {
    if (typeof id === 'string') await profiles.remove(id);
    return profiles.all();
  });

  ipcMain.on('chooser:select', (e, id, remember) => {
    if (!isChooser(e) || typeof id !== 'string' || !profiles.get(id)) return;
    profiles.setConfig({ remember: !!remember, last: id });
    chosen = true;
    onSelect(id); // abre a janela do perfil primeiro, para o app não fechar entre as duas
    win.close();
  });
}

// Abre a janela de escolha. onPick(id) roda quando o usuário escolhe; onCancel roda se ele fechar sem escolher.
function show(onPick, onCancel) {
  onSelect = onPick;
  chosen = false;
  register();
  win = new BrowserWindow({
    width: 880, height: 640, minWidth: 640, minHeight: 520, center: true, show: false,
    maximizable: false, minimizable: false, fullscreenable: false,
    title: 'Devoid Web', backgroundColor: '#000000', autoHideMenuBar: true,
    icon: path.join(paths.SRC, 'assets', 'icon.png'),
    webPreferences: security.prefs({ preload: path.join(paths.SRC, 'preload.js') }),
  });
  win.setMenuBarVisibility(false);
  winId = win.webContents.id;
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { win = null; if (!chosen) onCancel(); });
  win.loadFile(path.join(paths.SRC, 'ui', 'profiles.html'));
  return win;
}

module.exports = { show, isChooser };
