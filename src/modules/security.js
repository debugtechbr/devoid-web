'use strict';
const { app, dialog, shell, BrowserWindow } = require('electron');
const store = require('./store');
const paths = require('./paths');
const downloads = require('./downloads');
const blocklist = require('./blocklist');
const { t } = require('../ui/i18n.js');

// Preferências de TODA janela e aba. Nada de Node dentro de página.
const prefs = (extra = {}) => ({
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
  webSecurity: true,
  nodeIntegrationInWorker: false,
  nodeIntegrationInSubFrames: false,
  allowRunningInsecureContent: false,
  webviewTag: false,
  experimentalFeatures: false,
  spellcheck: false, // o corretor baixa dicionários de servidores do Google
  ...extra,
});

const hostOf = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };

// Ligações com o gerenciador de abas (definidas pelo browser.js)
const hooks = { tabInfo: () => null, blocked: () => {}, passed: () => {}, blockers: () => [] };
const setHooks = h => Object.assign(hooks, h);

// Quais endereços uma aba pode abrir. file://, cmd://, powershell:// e afins ficam de fora.
function allowedUrl(url, isMainFrame = true) {
  let u;
  try { u = new URL(url); } catch { return false; }
  switch (u.protocol) {
    case 'http:': case 'https:': case 'chrome-extension:': case 'blob:': case 'devtools:':
      return true;
    case 'file:': return paths.isInternal(url); // só as páginas do próprio navegador
    case 'about:': return url === 'about:blank' || url === 'about:srcdoc';
    case 'data:': return !isMainFrame;
    case 'chrome:': return u.hostname === 'gpu';
    default: return false;
  }
}

// Links que o sistema deve tratar (e-mail e telefone). O resto é descartado.
function external(url) {
  if (/^(mailto|tel):/i.test(url)) shell.openExternal(url).catch(() => {});
}

function installGlobalGuards() {
  app.on('web-contents-created', (_e, wc) => {
    wc.on('will-attach-webview', e => e.preventDefault());
    const guard = e => {
      const url = e.url;
      if (!allowedUrl(url, e.isMainFrame !== false)) { e.preventDefault(); external(url); }
    };
    wc.on('will-navigate', guard);
    wc.on('will-redirect', guard);
    wc.on('will-frame-navigate', guard);
  });
}

// ---------- certificados (para o painel do cadeado) ----------
const certs = new Map();
function certFor(host) {
  return certs.get(host) || null;
}
function recordCert(req) {
  const c = req.certificate;
  if (!c) return;
  if (certs.size > 300) certs.delete(certs.keys().next().value);
  certs.set(req.hostname.replace(/^www\./, ''), {
    ok: req.verificationResult === 'net::OK',
    result: req.verificationResult,
    subject: (c.subject && c.subject.commonName) || c.subjectName || '',
    issuer: (c.issuer && (c.issuer.organizations || [])[0]) || (c.issuer && c.issuer.commonName) || c.issuerName || '',
    validStart: c.validStart,
    validExpiry: c.validExpiry,
    fingerprint: c.fingerprint || '',
  });
}

// ---------- permissões ----------
const SAFE = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock']);
const LABELS = { camera: 'Câmera', microphone: 'Microfone', geolocation: 'Localização', notifications: 'Notificações' };

function permKeys(perm, details) {
  if (perm === 'geolocation' || perm === 'notifications') return [perm];
  if (perm === 'media') {
    const types = (details && (details.mediaTypes || (details.mediaType ? [details.mediaType] : []))) || [];
    const keys = [];
    if (!types.length || types.includes('video')) keys.push('camera');
    if (!types.length || types.includes('audio')) keys.push('microphone');
    return keys;
  }
  return null;
}

const configured = new WeakSet();

function setupSession(ses) {
  if (configured.has(ses)) return;
  configured.add(ses);

  downloads.attach(ses);
  ses.setSpellCheckerEnabled(false);
  // Sem "Electron" no user agent, em todas as sessões (principal, perfis e convidado)
  ses.setUserAgent(ses.getUserAgent().replace(/\s(Electron|devoid-web)\/\S+/gi, ''));

  // Certificado de cada site visitado (a decisão de aceitar continua sendo do Chromium)
  ses.setCertificateVerifyProc((req, cb) => { try { recordCert(req); } catch { /* ok */ } cb(-3); });

  // ----- bloqueio de anúncios, rastreadores, gravação de sessão e telemetria -----
  ses.webRequest.onBeforeRequest((d, cb) => {
    if (d.resourceType === 'mainFrame' || !/^https?:/.test(d.url)) return cb({});
    // Bloqueio nativo desligado, ou uBlock/AdGuard/etc. instalado neste perfil: o tráfego fica com a extensão
    if (!store.get().nativeAdblock || hooks.blockers(ses).length) return cb({});
    const m = blocklist.match(d.url);
    if (!m || !store.protection().cats.has(m.cat)) return cb({});
    const info = hooks.tabInfo(d.webContentsId);
    const rec = { host: m.host, cat: m.cat, type: d.resourceType };
    if (info && store.isAdblockOff(info.host)) { hooks.passed(d.webContentsId, rec); return cb({}); } // site com bloqueio desativado
    hooks.blocked(d.webContentsId, rec);
    cb({ cancel: true });
  });

  ses.webRequest.onBeforeSendHeaders((d, cb) => {
    if (store.protection().dnt) { d.requestHeaders.DNT = '1'; d.requestHeaders['Sec-GPC'] = '1'; }
    cb({ requestHeaders: d.requestHeaders });
  });

  // ----- cabeçalhos dos documentos: políticas por site (JavaScript, áudio automático, sensores) e reforço de segurança -----
  ses.webRequest.onHeadersReceived((d, cb) => {
    if (d.resourceType !== 'mainFrame' && d.resourceType !== 'subFrame') return cb({});
    const own = hostOf(d.url);
    const site = d.resourceType === 'mainFrame' ? own : ((hooks.tabInfo(d.webContentsId) || {}).host || own);
    if (!site) return cb({});
    const s = store.get();
    const resp = d.responseHeaders || {};
    const keys = Object.keys(resp);
    const find = n => keys.find(k => k.toLowerCase() === n.toLowerCase());
    const append = []; // soma ao que o site mandou (o nosso vem por último e vale)
    const fill = []; // só entra se o site não mandou

    if (store.effectivePerm(site, 'javascript') === 'block') append.push(['Content-Security-Policy', "script-src 'none'"]);
    const policy = [];
    if (store.effectivePerm(site, 'autoplay') === 'block') policy.push('autoplay=()');
    if (store.effectivePerm(site, 'sensors') === 'block') policy.push('accelerometer=()', 'gyroscope=()', 'magnetometer=()');
    if (policy.length) append.push(['Permissions-Policy', policy.join(', ')]);

    if (s.hardenHeaders) {
      fill.push(['X-Content-Type-Options', 'nosniff'], ['Referrer-Policy', 'strict-origin-when-cross-origin']);
      // Opcional (pode quebrar vídeos e logins embutidos): exige que iframes de outros sites se declarem embutíveis
      const csp = find('content-security-policy') ? String(resp[find('content-security-policy')]).toLowerCase() : '';
      if (s.blockCrossFrames && d.resourceType === 'subFrame' && !csp.includes('frame-ancestors')) fill.push(['X-Frame-Options', 'SAMEORIGIN']);
    }

    const todo = fill.filter(([n]) => !find(n));
    if (!append.length && !todo.length) return cb({});
    const headers = { ...resp };
    for (const [name, value] of append) {
      const key = find(name) || name;
      headers[key] = [...(headers[key] || []), value];
    }
    for (const [name, value] of todo) headers[name] = [value];
    cb({ responseHeaders: headers });
  });

  // ----- câmera, microfone, localização e notificações -----
  ses.setPermissionCheckHandler((_wc, perm, origin, details) => {
    if (SAFE.has(perm)) return true;
    const keys = permKeys(perm, details);
    return !!keys && keys.length > 0 && keys.every(k => store.effectivePerm(hostOf(origin), k) === 'allow');
  });

  ses.setPermissionRequestHandler(async (_wc, perm, callback, details) => {
    if (SAFE.has(perm)) return callback(true);
    const keys = permKeys(perm, details);
    if (!keys || !keys.length) return callback(false);
    const host = hostOf(details.requestingUrl) || '?';
    const states = keys.map(k => store.effectivePerm(host, k));
    if (states.includes('block')) return callback(false);
    if (states.every(s => s === 'allow')) return callback(true);

    const what = keys.map(k => t(LABELS[k])).join(' + ');
    const { response, checkboxChecked } = await dialog.showMessageBox(BrowserWindow.getFocusedWindow() || undefined, {
      type: 'question',
      buttons: [t('Permitir'), t('Bloquear')],
      defaultId: 1,
      cancelId: 1,
      title: 'Devoid Web',
      message: t('{host} quer acessar: {what}.', { host, what }),
      checkboxLabel: t('Lembrar minha escolha para este site'),
    });
    const allow = response === 0;
    if (checkboxChecked && host !== '?') keys.forEach(k => store.setSitePerm(host, k, allow ? 'allow' : 'block'));
    callback(allow);
  });
}

module.exports = { prefs, hostOf, allowedUrl, external, installGlobalGuards, setupSession, setHooks, certFor };
