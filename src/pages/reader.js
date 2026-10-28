const $ = s => document.querySelector(s);
const token = location.hash.slice(1);
let prefs = { size: 19, theme: 'dark' };
let art = null;

const mk = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

function applyPrefs() {
  document.body.className = 'reader rt-' + prefs.theme;
  document.body.style.setProperty('--rs', prefs.size + 'px');
  document.querySelectorAll('[data-theme]').forEach(b => b.classList.toggle('on', b.dataset.theme === prefs.theme));
}

function savePrefs(patch) {
  prefs = { ...prefs, ...patch };
  prefs.size = Math.max(14, Math.min(34, prefs.size));
  applyPrefs();
  devoid.send('settings:set', { reader: prefs });
}

const img = (src, alt) => {
  const i = document.createElement('img');
  i.referrerPolicy = 'no-referrer'; // não conta ao site de origem que você abriu o artigo
  i.loading = 'lazy';
  i.alt = alt || '';
  i.src = src;
  i.onerror = () => i.remove();
  return i;
};

function fmtDate(s) {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(devoid.lang === 'pt' ? 'pt-BR' : devoid.lang, { year: 'numeric', month: 'long', day: 'numeric' });
}

function render() {
  const box = $('#article');
  box.replaceChildren();
  if (!art) {
    box.append(mk('p', 'empty', t('Este artigo expirou. Abra o modo leitura de novo na página original.')));
    return;
  }
  document.title = art.title;
  const firstImg = art.blocks.find(b => b.t === 'img');
  if (art.cover && (!firstImg || firstImg.src !== art.cover)) box.append(Object.assign(img(art.cover, ''), { className: 'cover' }));
  box.append(mk('h1', '', art.title));

  const minutes = Math.max(1, Math.round(art.words / 200)); // ~200 palavras por minuto
  const when = art.date ? fmtDate(art.date) : '';
  const meta = [art.site, art.byline, when].filter(Boolean).join(' · ');
  box.append(mk('div', 'meta', meta));
  $('#time').textContent = t('{n} min de leitura', { n: minutes });

  for (const b of art.blocks) {
    if (b.t === 'p') box.append(mk('p', '', b.x));
    else if (b.t === 'h2' || b.t === 'h3' || b.t === 'h4') box.append(mk(b.t, '', b.x));
    else if (b.t === 'q') box.append(mk('blockquote', '', b.x));
    else if (b.t === 'pre') box.append(mk('pre', '', b.x));
    else if (b.t === 'ul' || b.t === 'ol') {
      const list = mk(b.t);
      for (const it of b.items) list.append(mk('li', '', it));
      box.append(list);
    } else if (b.t === 'img' && /^https?:\/\//i.test(b.src)) {
      const fig = mk('figure');
      fig.append(img(b.src, b.alt));
      if (b.cap) fig.append(mk('figcaption', '', b.cap));
      box.append(fig);
    }
  }
}

$('#smaller').onclick = () => savePrefs({ size: prefs.size - 2 });
$('#bigger').onclick = () => savePrefs({ size: prefs.size + 2 });
document.querySelectorAll('[data-theme]').forEach(b => { b.onclick = () => savePrefs({ theme: b.dataset.theme }); });
$('#close').onclick = () => devoid.send('nav:go', art ? art.url : '');
$('#orig').onclick = e => { e.preventDefault(); devoid.send('nav:go', art ? art.url : ''); };
$('#orig').href = '#';

(async () => {
  const [res, data] = await Promise.all([devoid.invoke('settings:get'), devoid.invoke('reader:get', token)]);
  if (res && res.settings.reader) prefs = { ...res.settings.reader };
  art = data;
  applyPrefs();
  render();
})();
