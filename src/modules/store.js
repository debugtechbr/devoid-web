'use strict';
const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const { LANGS } = require('./translate');

const ENGINES = {
  google: ['Google', 'https://www.google.com/search?q='],
  duckduckgo: ['DuckDuckGo', 'https://duckduckgo.com/?q='],
  bing: ['Bing', 'https://www.bing.com/search?q='],
  brave: ['Brave Search', 'https://search.brave.com/search?q='],
  yahoo: ['Yahoo', 'https://search.yahoo.com/search?p='],
};

const FONTS = {
  Sistema: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  'Segoe UI': '"Segoe UI", system-ui, sans-serif',
  Arial: 'Arial, Helvetica, sans-serif',
  Verdana: 'Verdana, Geneva, sans-serif',
  Georgia: 'Georgia, "Times New Roman", serif',
  Consolas: 'Consolas, "Courier New", monospace',
};

const THEMES = {
  devoid: { bg: '#000000', bar: '#111111', card: '#141414', line: '#2b2b2b', text: '#f4f4f4', dim: '#8a8a8a', hover: '#262626' },
  dark: { bg: '#1c1c1e', bar: '#2b2b2e', card: '#26262a', line: '#3d3d42', text: '#ececec', dim: '#9d9da3', hover: '#38383d' },
  light: { bg: '#dee1e6', bar: '#ffffff', card: '#f3f4f6', line: '#cfd3d9', text: '#1d1d1f', dim: '#5f6368', hover: '#e6e8ec' },
  oled: { bg: '#000000', bar: '#000000', card: '#0b0b0b', line: '#1c1c1c', text: '#f0f0f0', dim: '#7d7d7d', hover: '#1a1a1a' },
};

const DNS_PROVIDERS = {
  cloudflare: 'https://cloudflare-dns.com/dns-query',
  google: 'https://dns.google/dns-query',
  adguard: 'https://dns.adguard-dns.com/dns-query',
  quad9: 'https://dns.quad9.net/dns-query',
};

// Permissões rápidas de cada site: valores aceitos
const SITE_PERMS = {
  camera: ['ask', 'allow', 'block'],
  microphone: ['ask', 'allow', 'block'],
  geolocation: ['ask', 'allow', 'block'],
  notifications: ['ask', 'allow', 'block'],
  popups: ['auto', 'allow', 'block'],
  autoplay: ['allow', 'block'],
  javascript: ['allow', 'block'],
  sensors: ['allow', 'block'],
};

const DEFAULTS = {
  theme: 'devoid', accent: '#faca11', customBg: '#101014', customText: '#f0f0f0',
  tabStyle: 'rounded', uiFont: 'Sistema', uiFontSize: 13,
  language: 'auto',
  searchEngine: 'google', startup: 'newtab', startupPages: [],
  protection: 'strict',
  blockCats: { ads: true, analytics: true, social: true, recording: true, telemetry: true },
  doNotTrack: true, customBlocklist: '', adblockOff: [],
  clearOnExit: { cookies: false, cache: false, history: false, siteData: false },
  siteDefaults: { camera: 'ask', microphone: 'ask', geolocation: 'ask', notifications: 'ask', popups: 'auto', autoplay: 'allow', javascript: 'allow', sensors: 'block' },
  sitePermissions: {},
  hardwareAccel: true, tabSnooze: true, snoozeMinutes: 10,
  downloadDir: '', askDownload: false,
  dns: { provider: 'system', custom: '', strict: false },
  translateTarget: 'pt', translateAuto: false,
  welcomed: false,
  nativeAdblock: true, hardenHeaders: true, blockCrossFrames: false,
  reader: { size: 19, theme: 'dark' },
};

const bool = v => typeof v === 'boolean';
const oneOf = list => v => list.includes(v);
const int = (a, b) => v => Number.isInteger(v) && v >= a && v <= b;
const str = max => v => typeof v === 'string' && v.length <= max;
const hex = v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
const flags = keys => v => !!v && typeof v === 'object' && keys.every(k => bool(v[k]));

// Só entra no arquivo o que passar por aqui
const SCHEMA = {
  theme: oneOf(['devoid', 'dark', 'light', 'oled', 'custom']),
  accent: hex, customBg: hex, customText: hex,
  tabStyle: oneOf(['rounded', 'square', 'vertical']),
  uiFont: v => typeof v === 'string' && Object.hasOwn(FONTS, v),
  uiFontSize: int(11, 20),
  language: oneOf(['auto', 'pt', 'en', 'es']),
  searchEngine: v => typeof v === 'string' && Object.hasOwn(ENGINES, v),
  startup: oneOf(['newtab', 'restore', 'pages']),
  startupPages: v => Array.isArray(v) && v.length <= 10 && v.every(x => str(500)(x) && /^https?:\/\//i.test(x)),
  protection: oneOf(['standard', 'strict', 'custom']),
  blockCats: flags(['ads', 'analytics', 'social', 'recording', 'telemetry']),
  doNotTrack: bool, customBlocklist: str(5000),
  adblockOff: v => Array.isArray(v) && v.length <= 300 && v.every(x => str(200)(x)),
  clearOnExit: flags(['cookies', 'cache', 'history', 'siteData']),
  siteDefaults: v => !!v && Object.keys(SITE_PERMS).every(k => SITE_PERMS[k].includes(v[k])),
  hardwareAccel: bool, tabSnooze: bool, snoozeMinutes: int(1, 240),
  downloadDir: str(500), askDownload: bool,
  dns: v => !!v && ['system', 'cloudflare', 'google', 'adguard', 'quad9', 'custom'].includes(v.provider)
    && str(200)(v.custom) && (v.custom === '' || /^https:\/\//i.test(v.custom)) && bool(v.strict),
  translateTarget: v => typeof v === 'string' && Object.hasOwn(LANGS, v),
  translateAuto: bool,
  welcomed: bool,
  nativeAdblock: bool, hardenHeaders: bool, blockCrossFrames: bool,
  reader: v => !!v && int(14, 34)(v.size) && ['dark', 'sepia', 'light'].includes(v.theme),
};

// ---------- arquivos ----------
const file = n => path.join(app.getPath('userData'), n + '.json');
function readJSON(n, d) {
  try { return JSON.parse(fs.readFileSync(file(n), 'utf8')); } catch { return d; }
}
function writeJSON(n, v) {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(file(n), JSON.stringify(v), { mode: 0o600 });
  } catch { /* sem espaço ou sem permissão: segue sem salvar */ }
}
const pending = new Map();
function writeSoon(n, get, saver) {
  const old = pending.get(n);
  if (old) clearTimeout(old.t);
  pending.set(n, { get, saver, t: setTimeout(() => flushOne(n), 1000) });
}
function flushOne(n) {
  const p = pending.get(n);
  if (!p) return;
  clearTimeout(p.t);
  pending.delete(n);
  if (p.saver) p.saver(p.get()); else writeJSON(n, p.get());
}
const flush = () => { for (const n of [...pending.keys()]) flushOne(n); };

// ---------- configurações ----------
let settings = null;
let firstRun = false;
function get() {
  if (settings) return settings;
  firstRun = !fs.existsSync(file('settings'));
  const saved = readJSON('settings', {});
  settings = structuredClone(DEFAULTS);
  for (const k of Object.keys(SCHEMA)) if (k in saved && SCHEMA[k](saved[k])) settings[k] = saved[k];
  if (saved.sitePermissions && typeof saved.sitePermissions === 'object') settings.sitePermissions = saved.sitePermissions;
  return settings;
}
const isFirstRun = () => { get(); return firstRun && !settings.welcomed; };

function set(patch) {
  get();
  let n = 0;
  for (const [k, v] of Object.entries(patch || {})) {
    if (SCHEMA[k] && SCHEMA[k](v)) { settings[k] = v; n++; }
  }
  if (n) writeJSON('settings', settings);
  return n;
}

// Idioma da interface: o escolhido, ou o do sistema operacional (pt, en ou es)
function language() {
  const s = get().language;
  if (s !== 'auto') return s;
  const sys = String(app.getLocale() || 'en').slice(0, 2).toLowerCase();
  return ['pt', 'en', 'es'].includes(sys) ? sys : 'en';
}

function protection() {
  const s = get();
  const all = ['ads', 'analytics', 'social', 'recording', 'telemetry'];
  const cats = s.protection === 'strict' ? all : s.protection === 'standard' ? ['ads', 'recording', 'telemetry'] : all.filter(c => s.blockCats[c]);
  return { cats: new Set([...cats, 'custom']), dnt: s.protection === 'strict' || (s.protection === 'custom' && s.doNotTrack) };
}

const isAdblockOff = host => get().adblockOff.includes(host);
function setAdblockOff(host, off) {
  const l = get().adblockOff.filter(h => h !== host);
  if (off) l.push(host);
  set({ adblockOff: l.slice(-300) });
}

// DNS seguro (DoH): lista de servidores ou null para usar o DNS do sistema
function dnsServers() {
  const d = get().dns;
  if (d.provider === 'system') return null;
  const url = d.provider === 'custom' ? d.custom : DNS_PROVIDERS[d.provider];
  return url ? { servers: [url], strict: d.strict } : null;
}

// Permissões por site
const sitePerm = (host, key) => (get().sitePermissions[host] || {})[key];
const effectivePerm = (host, key) => sitePerm(host, key) || get().siteDefaults[key];
function setSitePerm(host, key, value) {
  if (!SITE_PERMS[key]) return;
  if (!SITE_PERMS[key].includes(value)) { removeSitePerm(host, key); return; }
  const m = (get().sitePermissions[host] ||= {});
  m[key] = value;
  writeJSON('settings', settings);
}
function removeSitePerm(host, key) {
  const m = get().sitePermissions[host];
  if (!m) return;
  delete m[key];
  if (!Object.keys(m).length) delete settings.sitePermissions[host];
  writeJSON('settings', settings);
}

// ---------- chave opcional do Google Cloud Translation (criptografada quando o sistema permite) ----------
function getGoogleKey() {
  const v = readJSON('secrets', {}).google || '';
  try {
    if (v.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(v.slice(4), 'base64'));
    if (v.startsWith('plain:')) return v.slice(6);
  } catch { /* cofre indisponível */ }
  return '';
}
function setGoogleKey(key) {
  const k = String(key || '').trim();
  if (k.length > 200 || /\s/.test(k)) throw new Error('Chave inválida.');
  const v = !k ? '' : safeStorage.isEncryptionAvailable() ? 'enc:' + safeStorage.encryptString(k).toString('base64') : 'plain:' + k;
  writeJSON('secrets', { google: v });
}
const hasGoogleKey = () => !!getGoogleKey();

// ---------- tema ----------
function luminance(h) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function palette(s) {
  if (s.theme !== 'custom') return THEMES[s.theme];
  const mix = p => `color-mix(in srgb, ${s.customText} ${p}%, ${s.customBg})`;
  return { bg: s.customBg, text: s.customText, bar: mix(8), card: mix(5), line: mix(20), dim: mix(60), hover: mix(15) };
}
function cssVars() {
  const s = get();
  const p = palette(s);
  return {
    '--bg': p.bg, '--bar': p.bar, '--card': p.card, '--line': p.line, '--text': p.text, '--dim': p.dim, '--hover': p.hover,
    '--accent': s.accent, '--on-accent': luminance(s.accent) > 0.45 ? '#000000' : '#ffffff',
    '--font': FONTS[s.uiFont], '--fs': s.uiFontSize + 'px',
  };
}
function titleBar() {
  const p = palette(get());
  return { color: p.bg, symbolColor: p.text };
}

// Tudo que a interface e as páginas internas precisam saber
function publicSettings() {
  return { ...get(), lang: language(), hasGoogleKey: hasGoogleKey() };
}
function meta() {
  return {
    engines: Object.fromEntries(Object.entries(ENGINES).map(([k, v]) => [k, v[0]])),
    fonts: Object.keys(FONTS),
    langs: LANGS,
    sitePerms: SITE_PERMS,
    version: app.getVersion(),
    systemLang: String(app.getLocale() || ''),
  };
}

// ---------- favoritos, histórico e sessão: cada perfil tem os seus (userData/profiles/<id>/) ----------
const pdata = new Map(); // id do perfil -> { bms, hist }
const pfile = (id, n) => path.join(app.getPath('userData'), 'profiles', id, n + '.json');
function readP(id, n, legacy) {
  try { return JSON.parse(fs.readFileSync(pfile(id, n), 'utf8')); } catch { /* ainda não existe */ }
  const old = legacy ? readJSON(legacy, null) : null; // traz os dados da versão anterior para o perfil principal
  return old || [];
}
function writeP(id, n, v) {
  if (id === 'guest') return; // convidado nunca grava nada em disco
  try {
    fs.mkdirSync(path.dirname(pfile(id, n)), { recursive: true });
    fs.writeFileSync(pfile(id, n), JSON.stringify(v), { mode: 0o600 });
  } catch { /* sem espaço ou sem permissão */ }
}
function pd(id) {
  let d = pdata.get(id);
  if (!d) {
    const guest = id === 'guest';
    const main = id === 'main';
    d = { bms: guest ? [] : readP(id, 'bookmarks', main ? 'bookmarks' : ''), hist: guest ? [] : readP(id, 'history', main ? 'history' : '') };
    pdata.set(id, d);
  }
  return d;
}
const later = (id, n, list) => { if (id !== 'guest') writeSoon(id + '/' + n, () => list, v => writeP(id, n, v)); };

const getBookmarks = id => pd(id).bms;
const getHistory = id => pd(id).hist;
const isBookmarked = (id, url) => pd(id).bms.some(b => b.url === url);
function toggleBookmark(id, b) {
  const l = pd(id).bms;
  const i = l.findIndex(x => x.url === b.url);
  if (i >= 0) l.splice(i, 1);
  else l.push({ url: b.url, title: String(b.title || '').slice(0, 200), favicon: String(b.favicon || '').slice(0, 500) });
  later(id, 'bookmarks', l);
}
function removeBookmark(id, url) {
  const l = pd(id).bms;
  const i = l.findIndex(x => x.url === url);
  if (i >= 0) { l.splice(i, 1); later(id, 'bookmarks', l); }
}
function addHistory(id, e) {
  const l = pd(id).hist;
  if (l[0] && l[0].url === e.url) { l[0].title = e.title; return; }
  l.unshift(e);
  if (l.length > 2000) l.length = 2000;
  later(id, 'history', l);
}
function clearHistory(id) {
  pd(id).hist.length = 0;
  later(id, 'history', pd(id).hist);
}
const saveSession = (id, list) => writeP(id, 'session', list);
function loadSession(id) {
  const v = id === 'guest' ? [] : readP(id, 'session', '');
  return Array.isArray(v) ? v : [];
}
const forgetProfile = id => { pdata.delete(id); };
const wipeGuest = () => { pdata.set('guest', { bms: [], hist: [] }); };

app.on('before-quit', flush);

module.exports = {
  ENGINES, DEFAULTS, SITE_PERMS, DNS_PROVIDERS, get, set, isFirstRun, language, protection, isAdblockOff, setAdblockOff, dnsServers,
  sitePerm, effectivePerm, setSitePerm, removeSitePerm, getGoogleKey, setGoogleKey, hasGoogleKey,
  cssVars, titleBar, publicSettings, meta,
  getBookmarks, getHistory, isBookmarked, toggleBookmark, removeBookmark, addHistory, clearHistory,
  saveSession, loadSession, forgetProfile, wipeGuest, readJSON, writeJSON, flush,
};
