'use strict';
const store = require('./store');
const paths = require('./paths');

const engineUrl = () => store.ENGINES[store.get().searchEngine][1];

// Texto digitado -> endereço final
function toUrl(input) {
  const s = String(input).trim();
  if (!s) return paths.PAGES.newtab;
  if (/^https?:\/\//i.test(s)) return s;
  const d = s.match(/^(devoid|chrome):\/\/([\w-]+)/i);
  if (d) return paths.DEVOID[d[2].toLowerCase()] || paths.PAGES.newtab;
  if (/^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?([/?#]|$)/i.test(s)) return 'http://' + s;
  if (!/\s/.test(s) && /^[^/?#]+\.[a-z]{2,}([/?#:]|$)/i.test(s)) return 'https://' + s;
  return engineUrl() + encodeURIComponent(s);
}

const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

function suggest(text, profileId) {
  const q = String(text).trim().toLowerCase().slice(0, 200);
  if (!q) return [];
  const terms = q.split(/\s+/);
  const pool = new Map();

  const consider = (it, bonus) => {
    const title = (it.title || '').toLowerCase();
    const hay = title + ' ' + it.url.toLowerCase();
    if (!terms.every(t => hay.includes(t))) return;
    let score = bonus;
    if (hostOf(it.url).startsWith(q)) score += 3;
    if (title.includes(q)) score += 1;
    const old = pool.get(it.url);
    if (!old || old.score < score) pool.set(it.url, { score, type: bonus >= 2 ? 'bookmark' : 'history', title: it.title || it.url, url: it.url });
  };

  store.getBookmarks(profileId).forEach(b => consider(b, 2));
  store.getHistory(profileId).slice(0, 600).forEach((h, i) => consider(h, i < 50 ? 1 : 0));

  const found = [...pool.values()].sort((a, b) => b.score - a.score).slice(0, 5)
    .map(({ type, title, url }) => ({ type, title, url }));

  const target = toUrl(q);
  const isSearch = target.startsWith(engineUrl());
  return [{ type: isSearch ? 'search' : 'url', title: String(text).trim(), url: String(text).trim() }, ...found];
}

module.exports = { toUrl, suggest, hostOf };
