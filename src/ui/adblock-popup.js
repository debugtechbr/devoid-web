const root = document.getElementById('root');
const send = (ch, ...a) => devoid.send(ch, ...a);
let timer = null;

const h = (tag, props = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  e.append(...kids.flat().filter(x => x != null));
  return e;
};
const sw = (checked, disabled, onchange) => h('label', { class: 'switch' },
  h('input', { type: 'checkbox', checked, disabled, onchange: e => onchange(e.target.checked) }), h('span'));

const CATS = { ads: 'Anúncios', analytics: 'Análise de uso', social: 'Redes sociais', recording: 'Gravação de sessão', telemetry: 'Telemetria', custom: 'Lista personalizada' };
const catName = c => t(CATS[c] || c);

function build(d) {
  if (!d) return h('div', { class: 'panel' }, h('div', { class: 'muted', text: t('Não foi possível ler as estatísticas. Feche e abra de novo.') }));

  const paused = !d.global || d.conflict.length > 0; // desligado nas configurações, ou extensão bloqueadora no perfil
  const on = d.enabled && !paused;
  const body = [
    h('div', { class: 'hd ' + (on ? 'ok' : 'bad') }, icon(on ? 'shieldcheck' : 'shieldoff'),
      h('div', {}, h('b', { text: t('Bloqueador de anúncios e rastreadores') }), h('small', { text: d.host || '' }))),
  ];

  if (d.conflict.length) {
    body.push(h('div', { class: 'warncard' },
      h('b', { text: t('Extensão bloqueadora detectada') }),
      h('div', { class: 'muted', text: d.conflict.join(', ') }),
      h('div', { class: 'muted', text: t('O bloqueio nativo fica em pausa neste perfil para não competir com a extensão.') })));
  }

  body.push(
    h('div', { class: 'line' }, h('span', { text: t('Bloqueador nativo') }), sw(d.global, false, v => { send('set-adblock-global', v); setTimeout(refresh, 150); })));

  if (!d.supported) {
    body.push(h('div', { class: 'muted', text: t('Abra uma página da internet para ver as estatísticas.') }));
    return h('div', { class: 'panel' }, body);
  }

  body.push(h('div', { class: 'line' }, h('span', { text: t('Bloquear neste site') }),
    sw(d.enabled, paused, () => { send('toggle-adblock-site'); setTimeout(refresh, 300); })));

  if (paused) return h('div', { class: 'panel' }, body);

  if (d.enabled) {
    body.push(h('div', { class: 'big' }, h('b', { text: String(d.blockedCount) }), h('span', { text: t('bloqueados nesta página') })));
    const cats = Object.entries(d.cats).sort((a, b) => b[1] - a[1]);
    if (cats.length) body.push(h('div', { class: 'list' }, cats.map(([c, n]) => h('div', { class: 'it' }, h('span', { text: catName(c) }), h('span', { text: String(n) })))));
    if (d.blockedRequests.length) {
      body.push(h('h3', { text: t('Últimos bloqueados') }),
        h('div', { class: 'list' }, d.blockedRequests.map(x => h('div', { class: 'it' }, h('span', { text: x.host }), h('span', { text: catName(x.cat) })))));
    }
  } else {
    body.push(
      h('div', { class: 'muted', text: t('O bloqueio está desativado neste site. A página será recarregada ao mudar.') }),
      h('h3', { text: t('Requisições que deixaram de ser bloqueadas ({n})', { n: d.passedTotal }) }),
      d.passed.length
        ? h('div', { class: 'list' }, d.passed.map(x => h('div', { class: 'it' }, h('span', { text: x.host }), h('span', { text: `${catName(x.cat)} ×${x.n}` }))))
        : h('div', { class: 'muted', text: t('Nada que seria bloqueado foi carregado até agora.') }));
  }
  return h('div', { class: 'panel' }, body);
}

function render(d) {
  const keep = root.querySelector('.panel');
  const scroll = keep ? keep.scrollTop : 0;
  const el = build(d);
  root.replaceChildren(el);
  el.scrollTop = scroll;
  send('shield:size', el.getBoundingClientRect().height + 12);
}

async function refresh() {
  let d = null;
  try { d = await devoid.invoke('get-adblock-stats'); } catch { /* tenta de novo no próximo ciclo */ }
  render(d);
}

devoid.on('adblock:show', () => { refresh(); clearInterval(timer); timer = setInterval(refresh, 1000); }); // atualiza em tempo real
devoid.on('adblock:hide', () => clearInterval(timer));
window.addEventListener('blur', () => send('shield:blur'));
window.addEventListener('keydown', e => { if (e.key === 'Escape') send('shield:blur'); });
refresh(); // primeira pintura logo ao carregar
