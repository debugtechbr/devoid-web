const $ = s => document.querySelector(s);
document.title = t('Extensões');

const mk = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const btn = (text, onclick, cls = '') => { const b = mk('button', 'btn ' + cls, text); b.onclick = onclick; return b; };

let busy = false;

async function load() {
  if (busy) return;
  busy = true;
  try {
    const [list, prof, stats] = await Promise.all([
      devoid.invoke('ext:list'),
      devoid.invoke('profile:list'),
      devoid.invoke('get-adblock-stats').catch(() => null),
    ]);

    const guest = prof && prof.current === 'guest';
    $('#guest').hidden = !guest;
    $('#install').hidden = guest; // convidado não tem extensões
    const names = stats && stats.conflict ? stats.conflict : [];
    $('#blocker').hidden = !names.length;
    $('#blockerNames').textContent = names.join(', ');

    $('#list').replaceChildren(...(guest ? [] : list.length ? list.map(x => {
      const row = mk('div', 'profile');
      let icon;
      if (x.icon) { icon = mk('img', 'extico'); icon.src = x.icon; icon.alt = ''; icon.onerror = () => icon.replaceWith(mk('i', 'dot')); } else icon = mk('i', 'dot');
      const nm = mk('div', 'nm');
      nm.append(mk('b', '', x.name), mk('small', '', t('versão {v}', { v: x.version })));
      const acts = mk('div', 'acts');
      acts.append(
        btn(x.pinned ? t('Desafixar') : t('Fixar na barra'), () => { devoid.send('ext:pin', x.id); setTimeout(load, 300); }),
        btn(t('Remover'), () => { devoid.send('ext:remove', x.id); setTimeout(load, 500); }));
      row.append(icon, nm, acts);
      return row;
    }) : [mk('p', 'msg', t('Nenhuma extensão instalada.'))]));
  } finally { busy = false; }
}

const install = () => {
  const v = $('#link').value.trim();
  if (v) devoid.send('ext:installStore', v);
};
$('#go').onclick = install;
$('#link').addEventListener('keydown', e => { if (e.key === 'Enter') install(); });
$('#file').onclick = () => devoid.send('ext:installFile');
$('#folder').onclick = () => devoid.send('ext:installFolder');
$('#guide').onclick = () => devoid.send('page:open', 'extension-guide');

load();
setInterval(load, 2500); // acompanha instalações e remoções
