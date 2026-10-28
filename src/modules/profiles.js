'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { app, session } = require('electron');
const store = require('./store');

const COLORS = ['#faca11', '#4cc9f0', '#f72585', '#7ae582', '#b388ff', '#ff9f1c'];
const ICONS = ['user', 'briefcase', 'home', 'gamepad', 'book', 'heart', 'bolt', 'globe'];
const GUEST = 'guest';
const MAIN = 'main';

let cfg = null; // { list: [{ id, name, color, icon }], remember: bool, last: id }

const rootDir = () => path.join(app.getPath('userData'), 'profiles');
const dirOf = id => path.join(rootDir(), id);
const save = () => store.writeJSON('profiles', cfg);

function load() {
  if (cfg) return cfg;
  const saved = store.readJSON('profiles', null);
  const valid = saved && Array.isArray(saved.list) ? saved.list.filter(p => p && /^[a-z0-9]{1,16}$/.test(p.id) && typeof p.name === 'string') : [];
  cfg = {
    list: valid.map(p => ({ id: p.id, name: p.name.slice(0, 30), color: /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : COLORS[0], icon: ICONS.includes(p.icon) ? p.icon : 'user' })),
    remember: !!(saved && saved.remember),
    last: saved && typeof saved.last === 'string' ? saved.last : '',
  };
  if (!cfg.list.length) { // primeira execução: nasce o perfil principal
    cfg.list.push({ id: MAIN, name: 'Principal', color: COLORS[0], icon: 'user' });
    save();
  }
  for (const p of cfg.list) fs.mkdirSync(dirOf(p.id), { recursive: true });
  return cfg;
}

const all = () => load().list;
const isGuest = id => id === GUEST;
const get = id => (isGuest(id) ? { id: GUEST, name: 'Convidado', color: '#9aa0a6', icon: 'user', guest: true } : load().list.find(p => p.id === id) || null);

// Perfil persistente: partição com "persist:" (cookies e sessão em disco, separados).
// Convidado: partição sem "persist:", só em memória.
const partition = id => (isGuest(id) ? GUEST : 'persist:profile_' + id);
const sessionOf = id => session.fromPartition(partition(id));

function create(name, color, icon) {
  const n = String(name || '').trim().slice(0, 30);
  if (!n) throw new Error('NAME');
  const p = {
    id: crypto.randomBytes(4).toString('hex'),
    name: n,
    color: /^#[0-9a-f]{6}$/i.test(color) ? color : COLORS[load().list.length % COLORS.length],
    icon: ICONS.includes(icon) ? icon : 'user',
  };
  load().list.push(p);
  fs.mkdirSync(dirOf(p.id), { recursive: true });
  save();
  return p;
}

function rename(id, name, color, icon) {
  const p = load().list.find(x => x.id === id);
  if (!p) return;
  const n = String(name || '').trim().slice(0, 30);
  if (n) p.name = n;
  if (/^#[0-9a-f]{6}$/i.test(color)) p.color = color;
  if (ICONS.includes(icon)) p.icon = icon;
  save();
}

// Apaga o perfil, os cookies e todos os dados dele. Sempre sobra pelo menos um perfil.
async function remove(id) {
  const c = load();
  if (c.list.length < 2) return false;
  const i = c.list.findIndex(p => p.id === id);
  if (i < 0) return false;
  c.list.splice(i, 1);
  if (c.last === id) { c.last = ''; c.remember = false; }
  save();
  const ses = sessionOf(id);
  await ses.clearStorageData().catch(() => {});
  await ses.clearCache().catch(() => {});
  fs.rmSync(dirOf(id), { recursive: true, force: true });
  store.forgetProfile(id);
  return true;
}

const config = () => ({ remember: load().remember, last: load().last });
function setConfig({ remember, last }) {
  const c = load();
  c.remember = !!remember;
  c.last = remember && (isGuest(last) || c.list.some(p => p.id === last)) ? last : '';
  save();
}

module.exports = { COLORS, ICONS, GUEST, MAIN, all, get, isGuest, create, rename, remove, config, setConfig, sessionOf, partition, dirOf };
