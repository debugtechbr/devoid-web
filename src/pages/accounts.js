const $ = s => document.querySelector(s);
document.title = t('Contas e perfis');

const SERVICES = [
  ['Google', 'accounts.google.com', 'https://accounts.google.com/'],
  ['Microsoft / Outlook', 'login.live.com', 'https://login.live.com/'],
  ['Proton', 'account.proton.me', 'https://account.proton.me/login'],
  ['Yahoo', 'login.yahoo.com', 'https://login.yahoo.com/'],
  ['Apple / iCloud', 'icloud.com', 'https://www.icloud.com/'],
  ['GitHub', 'github.com', 'https://github.com/login'],
];

let data = { profiles: [], current: 'main', icons: ['user'] };
let iconName = 'user';
let confirming = '';
let editing = '';

const mk = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const btn = (text, onclick, cls = '') => { const b = mk('button', 'btn ' + cls, text); b.onclick = onclick; return b; };
const say = text => { $('#pmsg').textContent = text; };

async function load() {
  data = await devoid.invoke('profile:list');
  render();
}

function render() {
  const all = [...data.profiles.map(p => ({ ...p, name: p.id === 'main' && p.name === 'Principal' ? t('Principal') : p.name })), { id: 'guest', name: t('Convidado'), color: '#9aa0a6', guest: true }];

  $('#profiles').replaceChildren(...all.map(p => {
    const row = mk('div', 'profile');
    const dot = mk('i', 'dot');
    if (p.color) dot.style.setProperty('--pc', p.color);
    const nm0 = p.guest ? t('Nada é salvo. Tudo é apagado ao fechar a janela.') : '';
    const nm = mk('div', 'nm');

    if (editing === p.id) {
      const input = mk('input');
      input.type = 'text'; input.maxLength = 30; input.value = p.name;
      input.onkeydown = async e => {
        if (e.key === 'Enter') { data.profiles = await devoid.invoke('profile:rename', p.id, input.value, p.color, p.icon); editing = ''; render(); }
        if (e.key === 'Escape') { editing = ''; render(); }
      };
      nm.append(input);
      setTimeout(() => input.focus(), 0);
    } else {
      nm.append(mk('b', '', p.name), mk('small', '', p.id === data.current ? t('Perfil desta janela') : nm0));
    }

    const acts = mk('div', 'acts');
    acts.append(btn(t('Abrir janela'), () => devoid.send('profile:open', p.id), 'primary'));
    if (!p.guest) {
      acts.append(btn(t('Renomear'), () => { editing = p.id; render(); }));
      if (data.profiles.length > 1) { // sempre sobra pelo menos um perfil
        acts.append(confirming === p.id
          ? btn(t('Confirmar exclusão'), async () => { data.profiles = await devoid.invoke('profile:delete', p.id); confirming = ''; load(); }, 'danger')
          : btn(t('Excluir'), () => { confirming = p.id; render(); setTimeout(() => { if (confirming === p.id) { confirming = ''; render(); } }, 4000); }));
      }
    }
    row.append(dot, nm, acts);
    return row;
  }));

  const sel = $('#target');
  const keep = sel.value || data.current;
  sel.replaceChildren(...all.map(p => { const o = mk('option', '', p.name); o.value = p.id; return o; }));
  sel.value = all.some(p => p.id === keep) ? keep : 'main';

  $('#services').replaceChildren(...SERVICES.map(([name, host, url]) => {
    const b = mk('button');
    b.append(mk('b', '', name), mk('small', '', host));
    b.onclick = () => devoid.send('profile:open', $('#target').value, url);
    return b;
  }));
}

$('#pcreate').onclick = async () => {
  const name = $('#pname').value.trim();
  if (!name) { say(t('Dê um nome ao perfil.')); return; }
  const r = await devoid.invoke('profile:create', name, $('#pcolor').value, iconName);
  if (r && r.ok) { $('#pname').value = ''; say(t('Perfil criado.')); data.profiles = r.profiles; render(); } else say(t('Não foi possível criar o perfil.'));
};
$('#pname').addEventListener('keydown', e => { if (e.key === 'Enter') $('#pcreate').click(); });

$('#startdirect').addEventListener('change', e => devoid.send('profile:remember', e.target.checked)); // desmarcar volta a perguntar o perfil ao abrir
devoid.invoke('profile:config').then(c => { $('#startdirect').checked = !!(c && c.remember); });

load();
