'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// Lista fechada de canais. Qualquer outro nome é ignorado.
const SEND = new Set([
  'ui:ready', 'tab:new', 'tab:close', 'tab:switch', 'tab:context', 'tab:mute', 'group:context', 'group:toggle', 'group:save',
  'split:open', 'split:close', 'pip:toggle',
  'nav:go', 'nav:back', 'nav:forward', 'nav:reload', 'bm:toggle', 'bm:remove', 'hist:clear', 'page:open',
  'overlay:show', 'overlay:hide', 'overlay:size', 'overlay:blur', 'menu:action',
  'shield:toggle', 'site:setPerm', 'site:clearCookies',
  'translate:page', 'translate:restore',
  'ext:pin', 'ext:popup', 'ext:remove', 'ext:installFile', 'ext:installFolder', 'ext:installStore',
  'dl:open', 'dl:show', 'dl:cancel', 'dl:clear', 'dl:decide',
  'settings:set', 'perm:remove', 'welcome:done', 'profile:open',
  'shield:open', 'shield:blur', 'shield:size', 'toggle-adblock-site', 'set-adblock-global',
  'audio:state', 'audio:cmd', 'reader:open', 'chooser:select', 'profile:remember',
]);
const INVOKE = new Set([
  'bm:list', 'hist:list', 'omni:suggest', 'settings:get', 'dl:list', 'ext:list', 'diag:get',
  'translate:setKey', 'settings:pickDir', 'data:clear', 'perm:list',
  'blocklist:info', 'blocklist:file', 'blocklist:url',
  'profile:list', 'profile:create', 'profile:rename', 'profile:delete',
  'get-adblock-stats', 'select-audio-files', 'select-audio-folder', 'reader:get',
  'chooser:list', 'chooser:create', 'chooser:delete', 'profile:config',
]);
const EVENTS = new Set([
  'state', 'focus-address', 'settings:changed', 'overlay:render', 'overlay:status', 'toast',
  'adblock:show', 'adblock:hide', 'audio:cmd', 'audio:add', 'overlay:audio',
]);

if (location.protocol === 'file:') {
  // Páginas locais do navegador: recebem a ponte. O processo principal ainda confere a origem de cada mensagem.
  contextBridge.exposeInMainWorld('devoid', {
    platform: process.platform,
    lang: ipcRenderer.sendSync('app:lang'),
    send: (channel, ...args) => { if (SEND.has(channel)) ipcRenderer.send(channel, ...args); },
    invoke: (channel, ...args) => (INVOKE.has(channel)
      ? ipcRenderer.invoke(channel, ...args)
      : Promise.reject(new Error('Canal bloqueado'))),
    on: (channel, cb) => {
      if (EVENTS.has(channel) && typeof cb === 'function') ipcRenderer.on(channel, (_e, ...a) => cb(...a));
    },
  });
}

// Sites da internet não recebem nenhuma API. Só avisamos "esta página ganhou foco",
// para a divisão de tela saber qual lado está ativo. Nada do que é digitado passa por aqui.
window.addEventListener('focus', () => ipcRenderer.send('split:focus'));
