'use strict';
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { globalShortcut } = require('electron');

const EXT = new Set(['.mp3', '.flac', '.wav', '.ogg', '.aac', '.m4a']);
const MAX_FILES = 3000;
const MAX_DEPTH = 6;

const isAudio = p => EXT.has(path.extname(p).toLowerCase());
const item = p => ({ name: path.basename(p, path.extname(p)), url: pathToFileURL(p).href });

// Arquivos soltos escolhidos pelo usuário
function fromPaths(list) {
  return (Array.isArray(list) ? list : [])
    .filter(p => typeof p === 'string' && path.isAbsolute(p) && isAudio(p))
    .slice(0, MAX_FILES)
    .map(item);
}

// Pasta inteira: procura as músicas dentro dela e das subpastas
function scan(dir) {
  const out = [];
  const walk = (d, depth) => {
    if (out.length >= MAX_FILES || depth > MAX_DEPTH) return;
    let names;
    try { names = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    names.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    for (const n of names) {
      if (out.length >= MAX_FILES) return;
      const full = path.join(d, n.name);
      if (n.isDirectory()) walk(full, depth + 1);
      else if (n.isFile() && isAudio(full)) out.push(item(full));
    }
  };
  walk(dir, 0);
  return out;
}

// Teclas de mídia do teclado: só ficam registradas enquanto há uma lista de músicas aberta
let keysOn = false;
function mediaKeys(enabled, dispatch) {
  if (enabled === keysOn) return;
  keysOn = enabled;
  const map = { MediaPlayPause: 'toggle', MediaNextTrack: 'next', MediaPreviousTrack: 'prev', MediaStop: 'stop' };
  for (const [key, cmd] of Object.entries(map)) {
    try {
      if (enabled) globalShortcut.register(key, () => dispatch(cmd));
      else globalShortcut.unregister(key);
    } catch { /* tecla ocupada por outro app */ }
  }
}

module.exports = { EXT, isAudio, fromPaths, scan, mediaKeys };
