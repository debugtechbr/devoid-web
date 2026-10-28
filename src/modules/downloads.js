'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, shell } = require('electron');
const store = require('./store');
const blocklist = require('./blocklist');

const HIGH = new Set(['.exe', '.bat', '.cmd', '.vbs', '.vbe', '.ps1', '.scr', '.iso', '.msi', '.com', '.hta', '.wsf', '.jar', '.lnk', '.reg', '.dll', '.msc', '.pif']);
const MEDIUM = new Set(['.zip', '.rar', '.7z', '.img', '.dmg', '.pkg', '.apk', '.sh', '.command', '.docm', '.xlsm', '.pptm', '.js', '.jse', '.appimage', '.deb', '.rpm']);
const RISKY_TLD = new Set(['zip', 'mov', 'top', 'xyz', 'click', 'country', 'gq', 'tk', 'ml', 'ga', 'cf', 'work', 'loan', 'download', 'stream', 'men', 'racing', 'win']);
const DOUBLE_EXT = /\.(pdf|docx?|xlsx?|pptx?|jpe?g|png|gif|txt|mp3|mp4|zip)\.(exe|scr|bat|cmd|js|vbs|ps1|com|msi|hta)$/i;

// Nota de 0 a 100. A partir de 50 o download é pausado e o usuário decide.
// Os textos são chaves de tradução; a interface troca as variáveis.
function analyze(name, url) {
  const reasons = [];
  let score = 0;
  const add = (n, key, vars) => { score += n; reasons.push([key, vars || {}]); };
  const ext = path.extname(String(name)).toLowerCase();

  if (HIGH.has(ext)) add(60, 'Arquivo executável ou de script ({ext})', { ext });
  else if (MEDIUM.has(ext)) add(15, 'Arquivo compactado ou instalador ({ext})', { ext });
  if (DOUBLE_EXT.test(name)) add(30, 'Extensão dupla, um truque comum para disfarçar programas');

  let u = null;
  try { u = new URL(url); } catch { /* blob, data ou inválida */ }
  if (u && /^https?:$/.test(u.protocol)) {
    const host = u.hostname.toLowerCase();
    if (u.protocol === 'http:') add(15, 'Download sem criptografia (HTTP)');
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')) add(25, 'A origem é um endereço IP, não um site');
    if (host.split('.').some(l => l.startsWith('xn--'))) add(20, 'Endereço com caracteres disfarçados (punycode)');
    if (RISKY_TLD.has(host.split('.').pop())) add(10, 'Domínio de um tipo muito usado em golpes (.{tld})', { tld: host.split('.').pop() });
    if (host.split('.').length >= 5) add(10, 'Endereço com subdomínios demais');
    if (blocklist.categoryOfHost(host)) add(30, 'Origem conhecida por anúncios ou rastreamento');
    if (u.username || u.password) add(20, 'Endereço com usuário embutido');
  }

  score = Math.min(100, score);
  return { score, level: score >= 70 ? 'high' : score >= 50 ? 'medium' : 'low', flag: score >= 50, reasons };
}

const entries = [];
let nextId = 1;
let unseen = false;
const done = new WeakSet();
const listeners = [];
const hooks = { onCrx: () => {}, onPending: () => {} };
let timer = null;

const setHooks = h => Object.assign(hooks, h);
const subscribe = fn => listeners.push(fn);
function notify() {
  if (timer) return;
  timer = setTimeout(() => { timer = null; listeners.forEach(fn => fn()); }, 200);
}

function uniquePath(dir, name) {
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  let p = path.join(dir, name);
  for (let i = 1; fs.existsSync(p); i++) p = path.join(dir, `${base} (${i})${ext}`);
  return p;
}

function attach(ses) {
  if (done.has(ses)) return;
  done.add(ses);

  ses.on('will-download', (_event, item, wc) => {
    const name = path.basename(item.getFilename() || 'download');
    const url = item.getURL();
    const ext = path.extname(name).toLowerCase();
    const s = store.get();
    const isCrx = ext === '.crx';
    const risk = isCrx ? { score: 0, level: 'low', flag: false, reasons: [] } : analyze(name, url);

    // Sempre definimos o destino aqui, para poder pausar antes de decidir
    const dir = s.downloadDir && fs.existsSync(s.downloadDir) ? s.downloadDir : app.getPath('downloads');
    if (isCrx) item.setSavePath(path.join(os.tmpdir(), `devoid-${Date.now()}.crx`));
    else if (!s.askDownload || risk.flag) item.setSavePath(uniquePath(dir, name));

    const e = {
      id: nextId++, name, url, path: item.getSavePath() || '', received: 0, total: item.getTotalBytes(),
      state: 'progressing', risk, pending: risk.flag, kind: isCrx ? 'extension' : 'file', wcId: wc ? wc.id : 0, item,
    };
    entries.unshift(e);
    if (entries.length > 100) entries.length = 100;
    unseen = true;

    if (risk.flag) { item.pause(); hooks.onPending(e); }

    item.on('updated', () => {
      e.received = item.getReceivedBytes();
      e.total = item.getTotalBytes();
      e.path = item.getSavePath() || e.path;
      if (!e.pending) e.state = item.isPaused() ? 'paused' : 'progressing';
      notify();
    });
    item.once('done', (_ev, state) => {
      e.state = state; // completed | cancelled | interrupted
      e.pending = false;
      e.path = item.getSavePath() || e.path;
      e.received = item.getReceivedBytes();
      unseen = true;
      if (state === 'completed' && isCrx) hooks.onCrx(e.path);
      notify();
    });
    notify();
  });
}

const find = id => entries.find(x => x.id === id);

// Usuário respondeu ao aviso
function decide(id, allow) {
  const e = find(id);
  if (!e || !e.pending) return;
  e.pending = false;
  if (allow) { e.item.resume(); e.state = 'progressing'; } else { e.item.cancel(); e.state = 'cancelled'; }
  notify();
}

function summary() {
  const act = entries.filter(e => e.state === 'progressing' && !e.pending);
  const pend = entries.find(e => e.pending);
  const total = act.reduce((n, e) => n + (e.total || 0), 0);
  const got = act.reduce((n, e) => n + (e.total ? e.received : 0), 0);
  return { active: act.length, progress: total ? Math.min(1, got / total) : null, pending: pend ? pend.id : 0, show: act.length > 0 || unseen || !!pend };
}

const list = () => entries.map(({ item, ...rest }) => rest);
const seen = () => { unseen = false; notify(); };
const show = id => { const e = find(id); if (e && e.path) shell.showItemInFolder(e.path); };
const open = id => {
  const e = find(id);
  if (e && e.state === 'completed' && e.path && !analyze(e.name, e.url).flag && e.kind === 'file') shell.openPath(e.path);
};
const cancel = id => { const e = find(id); if (e && (e.state === 'progressing' || e.pending)) { e.pending = false; e.item.cancel(); } };
const clear = () => { for (let i = entries.length - 1; i >= 0; i--) if (entries[i].state !== 'progressing' && !entries[i].pending) entries.splice(i, 1); notify(); };

module.exports = { analyze, attach, setHooks, subscribe, decide, summary, list, seen, show, open, cancel, clear };
