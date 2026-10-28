'use strict';
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, dialog, net } = require('electron');
const store = require('./store');
const paths = require('./paths');
const security = require('./security');
const { t } = require('../ui/i18n.js');

let AdmZip = null;
try { AdmZip = require('adm-zip'); } catch { /* sem npm install: .crx e Web Store ficam desativados */ }

let ses = null; // sessão principal
const sessions = new Set(); // sessões principal e de perfis (as anônimas ficam sem extensões)
let entries = []; // { path, managed, pinned, id, name, version, error }
let cache = null;
const hooks = { onStart: () => {} }; // abre a aba-tutorial quando uma instalação começa
const setHooks = h => Object.assign(hooks, h);

// Bloqueadores de anúncios de terceiros (uBlock, AdGuard...). Se houver um no perfil, o bloqueio nativo sai da frente.
const BLOCKER_IDS = new Set([
  'cjpalhdlnbpafiamejdnhcphjbkeiagm', // uBlock Origin
  'ddkjiahejlhfcafbddmgiahcphecmpfh', // uBlock Origin Lite
  'bgnkhhnnamicmpeenaelnjfhikgbkllg', // AdGuard
  'gighmmpiobklfepjocnamgkkbiglidom', // AdBlock
  'cfhdojbkjhnklbpkdaibdccddilifddb', // Adblock Plus
  'mlomiejdfkolichcflejclcbmpeaniij', // Ghostery
  'pkehgijcmpdhfbdbbnkijodmdjhbjlgp', // Privacy Badger
]);
const BLOCKER_RE = /ublock|adguard|adblock|ad[ -]?blocker|ghostery|privacy badger/i;
let blkVersion = 0;
const blkCache = new WeakMap(); // sessão -> { v, list }

function blockersOf(session) {
  const c = blkCache.get(session);
  if (c && c.v === blkVersion) return c.list;
  let list = [];
  try {
    list = session.getAllExtensions()
      .filter(x => BLOCKER_IDS.has(x.id) || BLOCKER_RE.test(x.name || '') || BLOCKER_RE.test((x.manifest && x.manifest.name) || ''))
      .map(x => x.name || x.id);
  } catch { /* sessão sem suporte */ }
  blkCache.set(session, { v: blkVersion, list });
  return list;
}
security.setHooks({ blockers: blockersOf });

const manifestOf = dir => {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8').replace(/^\uFEFF/, '')); } catch { return null; }
};
const parentWin = () => BrowserWindow.getFocusedWindow() || undefined;
const save = () => {
  blkVersion++;
  store.writeJSON('extensions', entries.map(e => ({ path: e.path, managed: e.managed, pinned: e.pinned })));
  cache = null;
};

async function load(e) {
  if (!fs.existsSync(path.join(e.path, 'manifest.json'))) return;
  try {
    const x = await ses.loadExtension(e.path, { allowFileAccess: false });
    e.id = x.id; e.name = x.name; e.version = x.version; e.error = '';
    for (const s of sessions) if (s !== ses) await s.loadExtension(e.path, { allowFileAccess: false }).catch(() => {});
  } catch (err) {
    e.error = String((err && err.message) || err);
  }
}

async function init(session) {
  blkVersion++;
  ses = session;
  sessions.add(session);
  entries = store.readJSON('extensions', []);
  for (const e of entries) await load(e);
  blkVersion++;
}

// Perfis com sessão própria também recebem as extensões
async function attach(session) {
  if (sessions.has(session)) return;
  sessions.add(session);
  blkVersion++;
  for (const e of entries) if (e.id) await session.loadExtension(e.path, { allowFileAccess: false }).catch(() => {});
}

// Mostra as permissões pedidas e só instala se o usuário confirmar
async function confirm(dir) {
  const m = manifestOf(dir);
  if (!m) throw new Error(t('Não encontrei um manifest.json válido nessa extensão.'));
  const perms = [...(m.permissions || []), ...(m.host_permissions || [])].map(String).slice(0, 12);
  const { response } = await dialog.showMessageBox(parentWin(), {
    type: 'question',
    buttons: [t('Cancelar'), t('Instalar')],
    defaultId: 0,
    cancelId: 0,
    title: t('Instalar extensão'),
    message: t('Instalar "{name}"?', { name: m.name || t('extensão') }),
    detail: perms.length ? t('Permissões solicitadas:') + '\n• ' + perms.join('\n• ') : t('A extensão não pede permissões especiais.'),
  });
  return response === 1;
}

async function addDir(dir, managed) {
  if (entries.some(e => e.path === dir)) throw new Error(t('Essa extensão já está instalada.'));
  const drop = () => { if (managed) fs.rmSync(dir, { recursive: true, force: true }); };
  if (!(await confirm(dir).catch(err => { drop(); throw err; }))) { drop(); return null; }
  const e = { path: dir, managed, pinned: false };
  await load(e);
  if (e.error || !e.id) { drop(); throw new Error(e.error || t('O Electron não conseguiu carregar essa extensão.')); }
  entries.push(e);
  save();
  return e;
}

// .crx = cabeçalho + zip. Aqui tiramos o cabeçalho (versões 2 e 3) e extraímos o zip.
function crxToZip(buf) {
  if (buf.toString('latin1', 0, 4) !== 'Cr24') return buf; // já é zip
  const version = buf.readUInt32LE(4);
  if (version === 2) return buf.subarray(16 + buf.readUInt32LE(8) + buf.readUInt32LE(12));
  if (version === 3) return buf.subarray(12 + buf.readUInt32LE(8));
  throw new Error(t('Versão de .crx não suportada.'));
}

function extract(buf) {
  if (!AdmZip) throw new Error(t('Falta a dependência adm-zip. Rode "npm install" de novo.'));
  if (buf.length > 100 * 1024 * 1024) throw new Error(t('Pacote grande demais.'));
  const dir = path.join(app.getPath('userData'), 'extensions', 'ext-' + Date.now());
  fs.mkdirSync(dir, { recursive: true });
  try {
    new AdmZip(crxToZip(buf)).extractAllTo(dir, true);
  } catch {
    fs.rmSync(dir, { recursive: true, force: true });
    throw new Error(t('Não consegui abrir o pacote da extensão.'));
  }
  if (!fs.existsSync(path.join(dir, 'manifest.json'))) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw new Error(t('O pacote não tem manifest.json.'));
  }
  return dir;
}

async function installFolder() {
  const r = await dialog.showOpenDialog(parentWin(), { title: t('Escolha a pasta da extensão descompactada'), properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  hooks.onStart();
  return addDir(r.filePaths[0], false);
}

async function installFile() {
  const r = await dialog.showOpenDialog(parentWin(), {
    title: t('Escolha o arquivo da extensão'),
    properties: ['openFile'],
    filters: [{ name: t('Extensão do Chrome (.crx ou .zip)'), extensions: ['crx', 'zip'] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  hooks.onStart();
  return addDir(extract(fs.readFileSync(r.filePaths[0])), true);
}

// .crx que o próprio usuário baixou pelo navegador
async function installFromPath(file) {
  hooks.onStart();
  try { return await addDir(extract(fs.readFileSync(file)), true); } finally { fs.rmSync(file, { force: true }); }
}

async function installStore(input) {
  const id = (String(input).match(/[a-p]{32}/) || [])[0];
  if (!id) throw new Error(t('Cole o link da extensão na Chrome Web Store ou o ID (32 letras).'));
  hooks.onStart();
  const url = 'https://clients2.google.com/service/update2/crx?response=redirect'
    + `&prodversion=${process.versions.chrome}&acceptformat=crx2,crx3&x=${encodeURIComponent(`id=${id}&uc`)}`;
  const res = await net.fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(t('A Chrome Web Store não entregou o pacote (erro {code}).', { code: res.status }));
  return addDir(extract(Buffer.from(await res.arrayBuffer())), true);
}

// ---------- lista usada pelos painéis ----------
function build() {
  return entries.filter(e => e.id).map(e => {
    const m = manifestOf(e.path) || {};
    const icons = m.icons || {};
    const best = Object.keys(icons).map(Number).sort((a, b) => b - a)[0];
    let icon = '';
    if (best) {
      const p = path.resolve(e.path, String(icons[best]));
      if (p.startsWith(path.resolve(e.path) + path.sep) && fs.existsSync(p)) icon = paths.fileUrl(p);
    }
    const action = m.action || m.browser_action || {};
    return { id: e.id, name: e.name, version: e.version, pinned: !!e.pinned, icon, hasPopup: !!action.default_popup };
  });
}
const list = () => (cache ||= build());
const pinned = () => list().filter(x => x.pinned);

function pin(id) {
  const e = entries.find(x => x.id === id);
  if (e) { e.pinned = !e.pinned; save(); }
}

function remove(id) {
  const i = entries.findIndex(x => x.id === id);
  if (i < 0) return;
  const [e] = entries.splice(i, 1);
  for (const s of sessions) { try { s.removeExtension(id); } catch { /* já removida */ } }
  if (e.managed) fs.rmSync(e.path, { recursive: true, force: true });
  save();
}

// Popup da extensão: janela pequena colada na barra. Extensões que dependem de chrome.tabs podem funcionar só em parte.
function popup(parent, id, rect, session) {
  const e = entries.find(x => x.id === id);
  const m = e && manifestOf(e.path);
  const page = m && ((m.action || m.browser_action || {}).default_popup);
  if (!page || !parent) return;
  const b = parent.getContentBounds();
  const w = 360;
  const h = 520;
  const x = Math.round(b.x + (rect ? rect.right : b.width - 12) - w);
  const y = Math.round(b.y + (rect ? rect.bottom : 84) + 4);
  const win = new BrowserWindow({
    parent, x, y, width: w, height: h, frame: false, resizable: false, skipTaskbar: true, show: false,
    webPreferences: security.prefs({ session: session || ses }),
  });
  win.loadURL(`chrome-extension://${id}/${String(page).replace(/^\/+/, '')}`).catch(() => win.close());
  win.once('ready-to-show', () => win.show());
  win.on('blur', () => { if (!win.isDestroyed()) win.close(); });
}

module.exports = { init, attach, setHooks, blockersOf, list, pinned, pin, remove, popup, installFolder, installFile, installFromPath, installStore, crxToZip };
