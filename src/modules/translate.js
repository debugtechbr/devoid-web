'use strict';
const { net } = require('electron');

const LANGS = {
  pt: 'Português', en: 'English', es: 'Español', fr: 'Français', de: 'Deutsch', it: 'Italiano',
  ja: '日本語', ko: '한국어', 'zh-CN': '中文 (简体)', ru: 'Русский', nl: 'Nederlands', pl: 'Polski', tr: 'Türkçe', uk: 'Українська',
};

const WORLD = 999; // mundo isolado: scripts da página não enxergam nem alteram nada daqui

// ---- funções que rodam DENTRO da página (viram texto e vão para o mundo isolado) ----
function extractInPage() {
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'CODE', 'PRE', 'TEXTAREA', 'SVG', 'IFRAME', 'KBD', 'SAMP']);
  const out = [];
  const nodes = [];
  let chars = 0;
  const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n && nodes.length < 1500 && chars < 60000; n = walker.nextNode()) {
    if (n.__dvOrig !== undefined) continue;
    const text = n.nodeValue.replace(/\s+/g, ' ').trim();
    const p = n.parentElement;
    if (text.length < 2 || !/\p{L}/u.test(text) || !p || SKIP.has(p.tagName.toUpperCase()) || p.isContentEditable) continue;
    nodes.push(n);
    out.push(text);
    chars += text.length;
  }
  window.__dvBatch = nodes;
  return out;
}

function applyInPage(translations) {
  const nodes = window.__dvBatch || [];
  nodes.forEach((n, i) => {
    if (typeof translations[i] !== 'string') return;
    const m = n.nodeValue.match(/^(\s*)[\s\S]*?(\s*)$/);
    n.__dvOrig = n.nodeValue;
    n.nodeValue = m[1] + translations[i] + m[2];
  });
  window.__dvAll = (window.__dvAll || []).concat(nodes);
  window.__dvBatch = [];
  return nodes.length;
}

function restoreInPage() {
  let count = 0;
  for (const n of window.__dvAll || []) {
    if (n.__dvOrig !== undefined) { n.nodeValue = n.__dvOrig; delete n.__dvOrig; count++; }
  }
  window.__dvAll = [];
  return count;
}

// ---- Google ----
const fail = () => new Error('GOOGLE_FAIL');

// API oficial (Cloud Translation v2): usada quando o usuário informa uma chave
async function officialCall(key, texts, target) {
  const res = await net.fetch('https://translation.googleapis.com/language/translate/v2?key=' + encodeURIComponent(key), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: texts, target, format: 'text' }),
  });
  if (res.status === 400 || res.status === 403) throw new Error('GOOGLE_KEY');
  if (!res.ok) throw fail();
  const j = await res.json();
  return { texts: j.data.translations.map(x => x.translatedText), from: (j.data.translations[0] || {}).detectedSourceLanguage || '' };
}

// Texto -> traduzido, juntando as frases devolvidas pelo Google
function joinSentences(data) {
  if (Array.isArray(data)) return (data[0] || []).map(s => s[0] || '').join('');
  return (data.sentences || []).map(s => s.trans || '').join('');
}

// Endpoint web gratuito do Google Tradutor (não oficial): uma linha por trecho
async function freeRaw(text, target) {
  const res = await net.fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(target)}&dt=t&dj=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ q: text }).toString(),
  });
  if (res.status === 429) throw new Error('GOOGLE_LIMIT');
  if (!res.ok) throw fail();
  const j = await res.json();
  return { text: joinSentences(j), from: Array.isArray(j) ? j[2] || '' : j.src || '' };
}

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

async function freeChunk(lines, target) {
  const r = await freeRaw(lines.join('\n'), target);
  const parts = r.text.split('\n');
  if (parts.length === lines.length) return { texts: parts.map(s => s.trim()), from: r.from };
  // o Google juntou ou dividiu linhas: traduz uma por uma neste lote
  const single = await pool(lines, 5, l => freeRaw(l, target));
  return { texts: single.map(x => x.text.trim()), from: r.from };
}

function chunk(texts) {
  const chunks = [];
  let cur = [];
  let size = 0;
  for (const t of texts) {
    if (cur.length >= 40 || size + t.length > 4000) { chunks.push(cur); cur = []; size = 0; }
    cur.push(t);
    size += t.length;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

async function translateTexts(texts, target, key) {
  const clean = texts.map(t => String(t).replace(/\s+/g, ' ').trim());
  const chunks = chunk(clean);
  const parts = await pool(chunks, 4, c => (key ? officialCall(key, c, target) : freeChunk(c, target)));
  return { texts: parts.flatMap(p => p.texts), from: (parts[0] && parts[0].from) || '' };
}

async function translatePage(wc, target, key) {
  const run = code => wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code }]);
  const texts = await run(`(${extractInPage})()`);
  if (!texts.length) return 0;
  const unique = [...new Set(texts)];
  const { texts: done } = await translateTexts(unique, target, key);
  const map = new Map(unique.map((u, i) => [u, done[i]]));
  await run(`(${applyInPage})(${JSON.stringify(texts.map(t => map.get(t)))})`);
  return texts.length;
}

const restorePage = wc => wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code: `(${restoreInPage})()` }]);

module.exports = { LANGS, chunk, joinSentences, translateTexts, translatePage, restorePage };
