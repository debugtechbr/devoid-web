'use strict';

const WORLD = 998; // mundo isolado, separado do da tradução

// ---- roda DENTRO da página: a página parece um artigo? (leve, roda depois de carregar) ----
function detectInPage() {
  let words = 0;
  for (const p of document.querySelectorAll('p')) {
    const s = (p.textContent || '').trim();
    if (s.length > 60) words += s.split(/\s+/).length;
    if (words > 400) break;
  }
  const og = document.querySelector('meta[property="og:type"]');
  const isArticleType = !!og && /article/i.test(og.getAttribute('content') || '');
  const hasArticle = !!document.querySelector('article, [itemprop="articleBody"]');
  return words >= 300 || (isArticleType && words >= 150) || (hasArticle && words >= 200);
}

// ---- roda DENTRO da página: extrai o artigo e devolve só dados (texto, endereços http/https), nunca HTML ----
function extractInPage() {
  const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
  const meta = name => {
    const e = document.querySelector(`meta[property="${name}"], meta[name="${name}"]`);
    return e ? clean(e.getAttribute('content')) : '';
  };
  const abs = u => {
    try { const x = new URL(u, document.baseURI); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch { return ''; }
  };
  const BAD_TAG = new Set(['NAV', 'ASIDE', 'FOOTER', 'HEADER', 'FORM', 'SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'BUTTON', 'SELECT', 'TEXTAREA', 'DIALOG']);
  const BAD_CLS = /(comment|disqus|footer|menu|nav|related|share|social|sidebar|sponsor|promo|advert|cookie|popup|modal|newsletter|subscribe|breadcrumb|pagination|widget|banner|outbrain|taboola)/i;
  const bad = el => {
    const cls = (el.id || '') + ' ' + (typeof el.className === 'string' ? el.className : '');
    return BAD_TAG.has(el.tagName) || BAD_CLS.test(cls) || el.getAttribute('aria-hidden') === 'true' || el.hidden;
  };
  const linkDensity = el => {
    const total = clean(el.textContent).length || 1;
    let links = 0;
    el.querySelectorAll('a').forEach(a => { links += clean(a.textContent).length; });
    return links / total;
  };

  // 1) escolhe o contêiner do texto principal
  let root = document.querySelector('[itemprop="articleBody"]') || null;
  if (!root) {
    const scores = new Map();
    for (const p of document.querySelectorAll('p')) {
      const len = clean(p.textContent).length;
      if (len < 40 || bad(p)) continue;
      const base = 1 + (clean(p.textContent).split(',').length - 1) + Math.min(len / 100, 3);
      let el = p.parentElement;
      for (let depth = 0; el && depth < 3 && el !== document.body; depth++, el = el.parentElement) {
        if (bad(el)) break;
        scores.set(el, (scores.get(el) || 0) + base / (depth + 1));
      }
    }
    let best = 0;
    for (const [el, sc] of scores) {
      const adj = sc * (1 - Math.min(linkDensity(el), 0.9));
      if (adj > best) { best = adj; root = el; }
    }
    const art = document.querySelector('article');
    if (art && clean(art.textContent).length > 600 && (!root || art.contains(root) || root.contains(art))) root = art;
  }
  if (!root) root = document.querySelector('main') || document.body;

  // 2) percorre o contêiner e monta blocos simples
  const blocks = [];
  const seenImg = new Set();
  let chars = 0;
  const underBad = el => {
    for (let n = el; n && n !== root; n = n.parentElement) if (bad(n)) return true;
    return false;
  };
  for (const el of root.querySelectorAll('h1,h2,h3,h4,p,ul,ol,blockquote,pre,img')) {
    if (blocks.length >= 700 || chars > 250000) break;
    if (underBad(el)) continue;
    const tag = el.tagName;
    if (tag === 'P') {
      if (el.closest('blockquote, li')) continue;
      const x = clean(el.textContent);
      if (x.length >= 20) { blocks.push({ t: 'p', x }); chars += x.length; }
    } else if (/^H[1-4]$/.test(tag)) {
      const x = clean(el.textContent);
      if (x.length >= 3 && x.length <= 160) blocks.push({ t: tag === 'H1' ? 'h2' : tag.toLowerCase(), x });
    } else if (tag === 'UL' || tag === 'OL') {
      if (el.parentElement && el.parentElement.closest('ul, ol')) continue;
      const items = Array.from(el.children).filter(c => c.tagName === 'LI').map(li => clean(li.textContent)).filter(Boolean).slice(0, 60);
      if (items.length && items.join(' ').length < 6000) { blocks.push({ t: tag.toLowerCase(), items }); chars += items.join(' ').length; }
    } else if (tag === 'BLOCKQUOTE') {
      const x = clean(el.textContent);
      if (x.length >= 20 && x.length < 3000) { blocks.push({ t: 'q', x }); chars += x.length; }
    } else if (tag === 'PRE') {
      blocks.push({ t: 'pre', x: String(el.textContent || '').slice(0, 6000) });
    } else if (tag === 'IMG') {
      const src = abs(el.currentSrc || el.getAttribute('src') || el.getAttribute('data-src') || '');
      const w = el.naturalWidth || Number(el.getAttribute('width')) || 0;
      if (!src || seenImg.has(src) || (w && w < 200)) continue;
      seenImg.add(src);
      const fig = el.closest('figure');
      const cap = fig && fig.querySelector('figcaption') ? clean(fig.querySelector('figcaption').textContent).slice(0, 300) : '';
      blocks.push({ t: 'img', src, alt: clean(el.getAttribute('alt')).slice(0, 200), cap });
    }
  }

  // 3) título, autor, data e capa
  const h1 = document.querySelector('h1');
  let title = (h1 && clean(h1.textContent).length > 5 ? clean(h1.textContent) : '') || meta('og:title') || clean(document.title);
  title = title.slice(0, 220);
  let byline = meta('author') || meta('article:author') || meta('og:article:author');
  if (!byline || /^https?:/i.test(byline)) {
    const a = document.querySelector('[rel="author"], [itemprop="author"], .byline, .author, [class*="byline"]');
    byline = a ? clean(a.textContent) : '';
  }
  if (byline.length > 90) byline = '';
  const timeEl = document.querySelector('time[datetime]');
  const date = meta('article:published_time') || (timeEl ? timeEl.getAttribute('datetime') : '') || '';
  const cover = abs(meta('og:image') || meta('twitter:image') || '');
  const site = meta('og:site_name') || location.hostname.replace(/^www\./, '');

  const words = blocks.reduce((n, b) => n + (b.x ? b.x.split(/\s+/).length : b.items ? b.items.join(' ').split(/\s+/).length : 0), 0);
  return { ok: words >= 80, title, byline, date: date.slice(0, 40), cover, site, url: location.href, lang: document.documentElement.lang || '', blocks, words };
}

const run = (wc, fn) => wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code: `(${fn})()` }]);
const detect = wc => run(wc, detectInPage);
const extract = wc => run(wc, extractInPage);

module.exports = { detect, extract, _inPage: { detectInPage, extractInPage } }; // _inPage: só para teste
