const $ = s => document.querySelector(s);
const ul = $('#list');
let timer = null;

const mk = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const btn = (text, onclick) => { const b = mk('button', '', text); b.onclick = onclick; return b; };
const mb = n => (n / 1048576).toFixed(1) + ' MB';
const STATES = { completed: 'Concluído', cancelled: 'Cancelado', interrupted: 'Interrompido', paused: 'Pausado' };
const locale = () => (devoid.lang === 'pt' ? 'pt-BR' : devoid.lang);

const empty = text => ul.replaceChildren(mk('li', 'empty', text));

async function listLinks(hist) {
  const items = (hist ? await devoid.invoke('hist:list') : await devoid.invoke('bm:list')) || [];
  if (!items.length) return empty(hist ? t('Nenhuma página visitada ainda.') : t('Nenhum favorito ainda. Clique na estrela da barra de endereço para salvar uma página.'));
  ul.replaceChildren(...items.slice(0, 300).map(it => {
    const li = mk('li');
    const a = mk('a', '', it.title || it.url);
    if (/^https?:/i.test(it.url)) a.href = it.url;
    li.append(a, mk('span', 'meta', it.url));
    if (hist) li.append(mk('span', 'when', new Date(it.t).toLocaleString(locale())));
    else {
      const acts = mk('div', 'acts');
      acts.append(btn(t('Remover'), () => { devoid.send('bm:remove', it.url); li.remove(); }));
      li.append(acts);
    }
    return li;
  }));
}

async function listDownloads() {
  const items = (await devoid.invoke('dl:list')) || [];
  if (!items.length) return empty(t('Nenhum download nesta sessão.'));
  ul.replaceChildren(...items.map(d => {
    const risky = !!(d.risk && d.risk.flag);
    const li = mk('li');
    li.append(mk('span', risky ? 'warn' : '', d.name));
    let info;
    if (d.pending) info = t('Aguardando a sua decisão (arquivo de risco)');
    else if (d.state === 'progressing' && d.total) info = `${mb(d.received)} / ${mb(d.total)}`;
    else info = t(STATES[d.state] || 'Baixando…') + (risky ? ' · ' + t('risco {n}/100', { n: d.risk.score }) : '');
    li.append(mk('span', 'meta', info + ' · ' + d.url));
    const acts = mk('div', 'acts');
    if (d.state === 'progressing' || d.pending) acts.append(btn(t('Cancelar'), () => { devoid.send('dl:cancel', d.id); listDownloads(); }));
    if (d.state === 'completed') {
      if (!risky && d.kind === 'file') acts.append(btn(t('Abrir'), () => devoid.send('dl:open', d.id)));
      acts.append(btn(t('Mostrar na pasta'), () => devoid.send('dl:show', d.id)));
    }
    li.append(acts);
    if (d.state === 'progressing' && d.total) {
      const bar = mk('div', 'bar');
      const fill = mk('i');
      fill.style.width = Math.min(100, Math.round(d.received / d.total * 100)) + '%';
      bar.append(fill);
      li.append(bar);
    }
    return li;
  }));
}

async function show() {
  clearInterval(timer);
  const mode = location.hash === '#hist' ? 'hist' : location.hash === '#dl' ? 'dl' : 'fav';
  document.title = t({ hist: 'Histórico', dl: 'Downloads', fav: 'Favoritos' }[mode]);
  document.querySelectorAll('nav a').forEach(a => a.classList.toggle('on', a.hash === '#' + mode));
  const clear = $('#clear');
  clear.hidden = mode === 'fav';
  clear.textContent = mode === 'hist' ? t('Limpar histórico') : t('Limpar lista');
  clear.onclick = () => { devoid.send(mode === 'hist' ? 'hist:clear' : 'dl:clear'); setTimeout(show, 100); };

  if (mode === 'dl') { await listDownloads(); timer = setInterval(listDownloads, 1000); } // acompanha o progresso
  else await listLinks(mode === 'hist');
}

window.addEventListener('hashchange', show);
show();
