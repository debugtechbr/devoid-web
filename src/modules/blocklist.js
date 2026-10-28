'use strict';
const fs = require('fs');
const path = require('path');

// Lista inicial embutida. Cada domínio vale também para os subdomínios.
// Para uma cobertura "de verdade" (100 mil+ domínios), importe uma lista no formato hosts em
// Configurações > Privacidade e segurança. Ela é somada a esta.
const LISTS = {
  ads: [
    'doubleclick.net', 'googlesyndication.com', 'googleadservices.com', 'adservice.google.com', '2mdn.net', 'adnxs.com',
    'taboola.com', 'outbrain.com', 'criteo.com', 'criteo.net', 'rubiconproject.com', 'pubmatic.com', 'openx.net',
    'casalemedia.com', 'adsrvr.org', 'amazon-adsystem.com', 'moatads.com', 'advertising.com', 'serving-sys.com',
    'smartadserver.com', 'adform.net', 'teads.tv', 'mgid.com', 'revcontent.com', 'exoclick.com', 'popads.net',
    'propellerads.com', 'yieldmo.com', 'media.net', 'zedo.com', 'adcolony.com', 'adsafeprotected.com', 'adtechus.com',
    'bidswitch.net', 'contextweb.com', 'lijit.com', 'sharethrough.com', 'triplelift.com', 'indexww.com', 'adroll.com',
    'bluekai.com', 'everesttech.net', 'mathtag.com', 'ads.tiktok.com', 'business-api.tiktok.com', 'ads-api.twitter.com',
    'ads.linkedin.com', 'ads.pinterest.com', 'ads.yahoo.com', 'gemini.yahoo.com', 'adition.com', 'adscale.de',
  ],
  analytics: [
    'google-analytics.com', 'analytics.google.com', 'googletagmanager.com', 'googletagservices.com', 'app-measurement.com',
    'scorecardresearch.com', 'quantserve.com', 'chartbeat.com', 'nr-data.net', 'segment.io', 'segment.com', 'amplitude.com',
    'mixpanel.com', 'heapanalytics.com', 'kissmetrics.com', 'adobedtm.com', 'omtrdc.net', '2o7.net', 'demdex.net',
    'stats.wp.com', 'pixel.wp.com', 'cloudflareinsights.com', 'optimizely.com', 'abtasty.com', 'bat.bing.com',
    'hs-analytics.net', 'hsadspixel.net', 'mktoresp.com', 'pardot.com',
  ],
  social: [
    'analytics.tiktok.com', 'static.ads-twitter.com', 'px.ads.linkedin.com', 'snap.licdn.com', 'sc-static.net',
    'tr.snapchat.com', 'ct.pinterest.com', 'log.pinterest.com', 'events.redditmedia.com', 'alb.reddit.com',
    'pixel.facebook.com', 'an.facebook.com',
  ],
  recording: [
    'hotjar.com', 'hotjar.io', 'mouseflow.com', 'fullstory.com', 'logrocket.com', 'lr-ingest.io', 'smartlook.com',
    'crazyegg.com', 'luckyorange.com', 'inspectlet.com', 'clarity.ms', 'sessioncam.com', 'contentsquare.net',
    'decibelinsight.com', 'userreplay.net', 'ptengine.com', 'heatmap.com',
  ],
  telemetry: [
    // Microsoft
    'vortex.data.microsoft.com', 'vortex-win.data.microsoft.com', 'settings-win.data.microsoft.com', 'watson.telemetry.microsoft.com',
    'telemetry.microsoft.com', 'browser.events.data.microsoft.com', 'self.events.data.microsoft.com', 'events.data.microsoft.com',
    'mobile.pipe.aria.microsoft.com', 'browser.pipe.aria.microsoft.com', 'telemetry.urs.microsoft.com',
    // Google, Apple e Amazon
    'firebaselogging-pa.googleapis.com', 'crashlyticsreports-pa.googleapis.com', 'metrics.apple.com', 'xp.apple.com',
    'iadsdk.apple.com', 'books-analytics-events.apple.com', 'device-metrics-us.amazon.com', 'device-metrics-us-2.amazon.com',
    // Samsung, Xiaomi, Huawei, LG, OnePlus
    'samsungads.com', 'samsungacr.com', 'smetrics.samsung.com', 'analytics.samsungknox.com', 'data.mistat.xiaomi.com',
    'tracking.miui.com', 'api.ad.xiaomi.com', 'sdkconfig.ad.xiaomi.com', 'metrics.data.hicloud.com', 'logservice.hicloud.com',
    'ngfts.lge.com', 'snu.lge.com', 'lgtvsdp.com', 'open.oneplus.net',
    // Relatório de erros e monitoramento
    'sentry.io', 'bugsnag.com', 'crashlytics.com', 'browser-intake-datadoghq.com',
  ],
};

// Domínios que também servem conteúdo legítimo: bloqueados só em caminhos de rastreamento
const PATHS = [
  { host: 'connect.facebook.net', re: /\/(fbevents|signals\/config|fbds)/i, cat: 'social' }, // Facebook Pixel
  { host: 'facebook.com', re: /^\/tr\/?(\?|$)/i, cat: 'social' },
  { host: 'google.com', re: /^\/(pagead|adsense|ads\/)/i, cat: 'ads' },
  { host: 'twitter.com', re: /^\/i\/(adsct|jot)/i, cat: 'social' },
  { host: 'linkedin.com', re: /^\/(px|li)\/track/i, cat: 'social' },
];

const MAP = new Map();
for (const [cat, list] of Object.entries(LISTS)) for (const d of list) MAP.set(d, cat);

let extra = new Set(); // lista de hosts importada pelo usuário
let custom = new Set(); // domínios digitados em Configurações

const labels = host => {
  const out = [];
  for (let h = host; h.includes('.'); h = h.slice(h.indexOf('.') + 1)) out.push(h);
  return out;
};

// Devolve { cat, host } se a URL deve ser tratada como anúncio/rastreador
function match(urlStr) {
  let u;
  try { u = new URL(urlStr); } catch { return null; }
  const host = u.hostname.toLowerCase();
  const hs = labels(host);
  for (const h of hs) {
    const c = MAP.get(h);
    if (c) return { cat: c, host };
    if (custom.has(h)) return { cat: 'custom', host };
    if (extra.has(h)) return { cat: 'ads', host };
  }
  const rest = u.pathname + u.search;
  for (const r of PATHS) if (hs.includes(r.host) && r.re.test(rest)) return { cat: r.cat, host };
  return null;
}

const categoryOfHost = host => (match('https://' + host + '/') || {}).cat || null;

function setCustom(text) {
  custom = new Set(String(text || '').split(/\s+/).map(s => s.trim().toLowerCase().replace(/^\*?\./, '')).filter(Boolean));
}

// Lê formato hosts ("0.0.0.0 dominio") ou uma lista simples de domínios
function parseHosts(text) {
  const out = new Set();
  const re = /^(?:[0-9a-f.:]+\s+)?((?:[a-z0-9-]+\.)+[a-z]{2,})$/i;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = re.exec(line);
    if (m && m[1] !== 'localhost') out.add(m[1].toLowerCase());
    if (out.size >= 400000) break;
  }
  return out;
}

const FILE = dir => path.join(dir, 'blocklist-extra.txt');

function loadExtra(dir) {
  try { extra = parseHosts(fs.readFileSync(FILE(dir), 'utf8')); } catch { extra = new Set(); }
  return extra.size;
}

function importExtra(dir, text) {
  const set = parseHosts(text);
  if (!set.size) throw new Error('empty');
  fs.writeFileSync(FILE(dir), [...set].join('\n'));
  extra = set;
  return set.size;
}

const extraCount = () => extra.size;
const builtinCount = () => MAP.size;

module.exports = { LISTS, match, categoryOfHost, setCustom, parseHosts, loadExtra, importExtra, extraCount, builtinCount };
