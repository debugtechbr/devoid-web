const $ = s => document.querySelector(s);
document.title = 'Devoid Web';

let data = null;
let confirming = '';
let color = '';
let iconName = 'user';

const mk = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

const label = p => (p.id === 'main' && p.name === 'Principal' ? t('Principal') : p.name);

function avatar(p) {
  const a = mk('span', 'pavatar');
  if (p.color) a.style.setProperty('--pc', p.color);
  a.append(icon(p.icon || 'user'));
  return a;
}

const choose = id => devoid.send('chooser:select', id, $('#remember').checked);

function card(p, guest) {
  const el = mk('button', 'pcard');
  el.type = 'button';
  el.append(avatar(p), mk('b', '', guest ? t('Convidado') : label(p)),
    mk('small', '', guest ? t('Nada é salvo. Tudo é apagado ao fechar a janela.') : t('Perfil persistente: guarda logins e sessões.')));
  el.onclick = () => choose(p.id);

  if (!guest && data.profiles.length > 1) { // sempre sobra pelo menos um perfil
    const del = mk('span', 'pdel', confirming === p.id ? t('Confirmar') : t('Excluir'));
    del.setAttribute('role', 'button');
    del.tabIndex = 0;
    const act = async e => {
      e.stopPropagation();
      e.preventDefault();
      if (confirming !== p.id) { confirming = p.id; render(); setTimeout(() => { if (confirming === p.id) { confirming = ''; render(); } }, 4000); return; }
      confirming = '';
      data.profiles = await devoid.invoke('chooser:delete', p.id);
      render();
    };
    del.onclick = act;
    del.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') act(e); };
    el.append(del);
  }
  return el;
}

function render() {
  const cards = data.profiles.map(p => card(p, false));
  cards.push(card(data.guest, true));

  const add = mk('button', 'pcard new');
  add.type = 'button';
  const av = mk('span', 'pavatar');
  av.append(icon('plus'));
  add.append(av, mk('b', '', t('+ Criar Novo Perfil')), mk('small', ''));
  add.onclick = () => { $('#newform').hidden = false; $('#pname').focus(); };
  cards.push(add);

  $('#cards').replaceChildren(...cards);
  if (!$('#newform').hidden) return;
  const first = $('#cards .pcard');
  if (first && !document.activeElement.classList.contains('pcard')) first.focus();
}

function buildForm() {
  $('#colors').replaceChildren(...data.colors.map(c => {
    const b = mk('button', 'sw' + (c === color ? ' on' : ''));
    b.type = 'button';
    b.style.setProperty('--c', c);
    b.setAttribute('aria-label', c);
    b.onclick = () => { color = c; buildForm(); };
    return b;
  }));
  $('#icons').replaceChildren(...data.icons.map(n => {
    const b = mk('button', 'ic' + (n === iconName ? ' on' : ''));
    b.type = 'button';
    b.setAttribute('aria-label', n);
    b.append(icon(n));
    b.onclick = () => { iconName = n; buildForm(); };
    return b;
  }));
}

$('#newform').addEventListener('submit', async e => {
  e.preventDefault();
  const name = $('#pname').value.trim();
  if (!name) { $('#pname').focus(); return; }
  const r = await devoid.invoke('chooser:create', name, color, iconName);
  if (r && r.ok) { data.profiles = r.profiles; $('#pname').value = ''; $('#newform').hidden = true; render(); }
});
$('#cancel').onclick = () => { $('#newform').hidden = true; render(); };

(async () => {
  data = await devoid.invoke('chooser:list');
  color = data.colors[1];
  $('#remember').checked = !!data.config.remember;
  buildForm();
  render();
})();
