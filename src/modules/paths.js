'use strict';
const path = require('path');
const { pathToFileURL } = require('url');

const SRC = path.join(__dirname, '..');
const SRC_URL = pathToFileURL(SRC).href + '/';
const url = rel => SRC_URL + rel;

const PAGES = {
  newtab: url('pages/newtab.html'),
  library: url('pages/library.html'),
  settings: url('ui/settings.html'),
  extensions: url('ui/extensions.html'),
  accounts: url('pages/accounts.html'),
  welcome: url('ui/welcome.html'),
  guide: url('pages/extension-guide.html'),
  reader: url('pages/reader.html'),
  profiles: url('ui/profiles.html'),
  adblock: url('ui/adblock-popup.html'),
};

// devoid://nome -> página interna
const DEVOID = {
  newtab: PAGES.newtab,
  settings: PAGES.settings,
  favoritos: PAGES.library + '#fav',
  historico: PAGES.library + '#hist',
  downloads: PAGES.library + '#dl',
  extensions: PAGES.extensions,
  accounts: PAGES.accounts,
  welcome: PAGES.welcome,
  'extension-guide': PAGES.guide,
  reader: PAGES.reader,
  gpu: 'chrome://gpu',
};

const isInternal = u => typeof u === 'string' && u.startsWith(SRC_URL);
const fileUrl = p => pathToFileURL(p).href;

// Como o endereço aparece na barra
function friendly(u) {
  if (!isInternal(u)) return u;
  if (u.startsWith(PAGES.newtab)) return '';
  if (u.startsWith(PAGES.library)) {
    return u.endsWith('#hist') ? 'devoid://historico' : u.endsWith('#dl') ? 'devoid://downloads' : 'devoid://favoritos';
  }
  if (u.startsWith(PAGES.extensions)) return 'devoid://extensions';
  if (u.startsWith(PAGES.settings)) return 'devoid://settings';
  if (u.startsWith(PAGES.accounts)) return 'devoid://accounts';
  if (u.startsWith(PAGES.welcome)) return 'devoid://welcome';
  if (u.startsWith(PAGES.guide)) return 'devoid://extension-guide';
  if (u.startsWith(PAGES.reader)) return 'devoid://reader';
  return '';
}

module.exports = { SRC, SRC_URL, PAGES, DEVOID, isInternal, fileUrl, friendly };
