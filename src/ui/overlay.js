const root = document.getElementById('root');
const send = (ch, ...a) => devoid.send(ch, ...a);

// criador de elementos (sempre com textContent, nunca innerHTML)
const h = (tag, props = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'value') e.value = v;
    else if (k === 'style') { for (const [p, val] of Object.entries(v)) e.style.setProperty(p, val); }
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  e.append(...kids.flat().filter(x => x != null));
  return e;
};
const ic = (name, cls = 'em') => h('span', { class: cls }, icon(name));
const sw = (checked, onchange) => h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked, onchange: e => onchange(e.target.checked) }), h('span'));
const mb = n => (n / 1048576).toFixed(1) + ' MB';
const locale = () => (devoid.lang === 'pt' ? 'pt-BR' : devoid.lang);

devoid.on('overlay:render', r => { draw(r); });
devoid.on('overlay:status', s => {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = s.text;
  el.classList.toggle('err', !!s.error);
  reportSize();
});
window.addEventListener('blur', () => send('overlay:blur'));
window.addEventListener('keydown', e => { if (e.key === 'Escape') send('overlay:hide'); });

function reportSize() {
  requestAnimationFrame(() => {
    const p = root.firstElementChild;
    if (p) send('overlay:size', p.getBoundingClientRect().height + 12);
  });
}

function draw(r) {
  const view = VIEWS[r.type];
  root.replaceChildren(view ? view(r.data || {}) : '');
  reportSize();
  const first = root.querySelector('[data-autofocus]');
  if (first) first.focus();
}

// ---------- menu ☰ ----------
function menu(d) {
  const mod = d.mac ? '⌘' : 'Ctrl+';
  const shift = d.mac ? '⌘⇧' : 'Ctrl+Shift+';
  const row = (name, label, key, act) => h('button', { class: 'row', role: 'menuitem', onclick: () => send('menu:action', act) },
    ic(name), h('span', { class: 'lb', text: t(label) }), h('span', { class: 'kb', text: key || '' }));
  return h('div', { class: 'panel', role: 'menu' },
    row('plus', 'Nova aba', mod + 'T', 'newtab'),
    row('newwindow', 'Nova janela', mod + 'N', 'newwindow'),
    row('incognito', 'Nova janela anônima', shift + 'N', 'incognito'),
    h('div', { class: 'sep' }),
    row('history', 'Histórico', mod + 'H', 'history'),
    row('download', 'Downloads', mod + 'J', 'downloads'),
    row('star', 'Favoritos', shift + 'O', 'bookmarks'),
    row('user', 'Contas e perfis', '', 'accounts'),
    row('puzzle', 'Extensões', '', 'extensions'),
    row('translate', 'Traduzir página (Google)', '', 'translate'),
    h('div', { class: 'sep' }),
    h('div', { class: 'row' },
      ic('zoom'), h('span', { class: 'lb', text: t('Zoom') }),
      h('span', { class: 'zoomctl' },
        h('button', { title: t('Diminuir'), onclick: () => send('menu:action', 'zoomOut'), text: '−' }),
        h('button', { title: t('Zoom padrão'), onclick: () => send('menu:action', 'zoomReset'), text: d.zoom + '%' }),
        h('button', { title: t('Aumentar'), onclick: () => send('menu:action', 'zoomIn'), text: '+' }),
        h('button', { title: t('Tela cheia (F11)'), onclick: () => send('menu:action', 'fullscreen'), text: '⛶' }))),
    row('code', 'Ferramentas do desenvolvedor', 'F12', 'devtools'),
    h('div', { class: 'sep' }),
    audioWidget(d.audio),
    h('div', { class: 'sep' }),
    row('sliders', 'Configurações', '', 'settings'),
    row('logout', 'Sair do Devoid Web', '', 'quit'));
}


// ---------- player de áudio do menu ☰ (a música toca na janela principal; aqui só ficam os controles) ----------
let au = null; // referências dos elementos do widget, atualizadas por overlay:audio
let dragging = false;
const fmt = n => { const s = Math.max(0, Math.floor(n || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const acmd = (cmd, value) => send('audio:cmd', { cmd, value });

function audioWidget(a) {
  const btn = (name, title, fn) => h('button', { class: 'abtn', title, 'aria-label': title, onclick: fn }, icon(name));
  au = {
    title: h('div', { class: 'a-title' }),
    play: btn('play', t('Tocar ou pausar'), () => acmd('toggle')),
    shuffle: btn('shuffle', t('Aleatório'), () => acmd('shuffle')),
    loop: btn('repeat', t('Repetir'), () => acmd('loop')),
    cur: h('span', { text: '0:00' }),
    dur: h('span', { text: '0:00' }),
    seek: h('input', { type: 'range', min: '0', max: '1000', value: '0', 'aria-label': t('Linha do tempo') }),
    vol: h('input', { type: 'range', min: '0', max: '100', value: '80', 'aria-label': t('Volume') }),
    list: h('div', { class: 'a-list' }),
    key: '',
  };
  au.seek.addEventListener('input', () => { dragging = true; acmd('seek', Number(au.seek.value) / 1000); });
  au.seek.addEventListener('change', () => { dragging = false; });
  au.vol.addEventListener('input', () => acmd('volume', Number(au.vol.value) / 100));
  const box = h('div', { class: 'audio' },
    h('div', { class: 'a-head' }, icon('music'), au.title),
    h('div', { class: 'a-ctrl' },
      au.shuffle, btn('prev', t('Faixa anterior'), () => acmd('prev')), au.play, btn('next', t('Próxima faixa'), () => acmd('next')), au.loop),
    h('div', { class: 'a-time' }, au.cur, au.seek, au.dur),
    h('div', { class: 'a-vol' }, icon('vol'), au.vol),
    h('div', { class: 'actions' },
      h('button', { class: 'btn', text: t('Arquivos…'), onclick: () => devoid.invoke('select-audio-files') }),
      h('button', { class: 'btn', text: t('Pasta…'), onclick: () => devoid.invoke('select-audio-folder') }),
      h('button', { class: 'btn', text: t('Limpar'), onclick: () => acmd('clear') })),
    au.list);
  updateAudio(a || { title: '', playing: false, time: 0, duration: 0, volume: 0.8, index: -1, loop: false, shuffle: false, names: [] });
  return box;
}

function updateAudio(s) {
  if (!au || !s) return;
  au.title.textContent = s.title || t('Nenhuma faixa');
  au.play.replaceChildren(icon(s.playing ? 'pause' : 'play'));
  au.shuffle.classList.toggle('on', !!s.shuffle);
  au.loop.classList.toggle('on', !!s.loop);
  au.cur.textContent = fmt(s.time);
  au.dur.textContent = fmt(s.duration);
  if (!dragging && s.duration) au.seek.value = String(Math.round(s.time / s.duration * 1000));
  if (document.activeElement !== au.vol) au.vol.value = String(Math.round((s.volume || 0) * 100));
  const names = s.names || [];
  const key = names.length + ':' + names.slice(0, 5).join('|');
  if (au.key !== key) { // a lista mudou: refaz as linhas
    au.key = key;
    au.list.replaceChildren(...names.map((n, i) => h('button', { class: 'a-item', text: n, title: n, onclick: () => acmd('jump', i) })));
    reportSize();
  }
  Array.from(au.list.children).forEach((c, i) => c.classList.toggle('cur', i === s.index));
}

devoid.on('overlay:audio', updateAudio);

// ---------- Google Tradutor ----------
function translatePanel(d) {
  const sel = h('select', { id: 'lang', 'aria-label': t('Idioma de destino'), onchange: e => send('settings:set', { translateTarget: e.target.value }) },
    Object.entries(d.langs).map(([code, name]) => h('option', { value: code, text: name, selected: code === d.target })));
  const body = [h('h3', { text: t('Google Tradutor') })];
  if (!d.canTranslate) body.push(h('div', { class: 'muted', text: t('Abra uma página da internet para traduzir.') }));
  else {
    body.push(
      h('div', { class: 'field' }, h('label', { for: 'lang', text: t('Traduzir para') }), sel),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', text: t('Traduzir esta página'), onclick: () => send('translate:page', document.getElementById('lang').value) }),
        d.translated ? h('button', { class: 'btn', text: t('Ver texto original'), onclick: () => send('translate:restore') }) : null),
      h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: d.auto, onchange: e => send('settings:set', { translateAuto: e.target.checked }) }),
        h('span', { text: t('Traduzir páginas automaticamente') })),
      h('div', { class: 'muted', text: d.hasKey ? t('Usando a API oficial do Google com a sua chave.') : t('Sem chave de API: usa o serviço web gratuito do Google.') }));
  }
  body.push(h('div', { id: 'status', class: 'status' }));
  return h('div', { class: 'panel' }, body);
}

function translation(d) {
  const body = [h('h3', { text: t('Tradução da seleção (Google)') })];
  if (d.loading) body.push(h('div', { class: 'muted', text: t('Traduzindo…') }));
  else if (d.error) body.push(h('div', { class: 'status err', text: d.error }));
  else if (d.text) {
    body.push(
      h('div', { class: 'muted', text: (d.from ? d.from + ' → ' : '') + d.target }),
      h('div', { class: 'result', text: d.text }),
      h('div', { class: 'actions' }, h('button', { class: 'btn', text: t('Copiar'), onclick: () => navigator.clipboard.writeText(d.text).catch(() => {}) })));
  }
  return h('div', { class: 'panel' }, body);
}

// ---------- extensões ----------
function extensionsPanel(d) {
  const body = [h('h3', { text: t('Extensões') })];
  if (d.incognito) body.push(h('div', { class: 'muted', text: t('Extensões ficam desativadas em janelas anônimas.') }));
  else {
    if (!d.list.length) body.push(h('div', { class: 'muted', text: t('Nenhuma extensão instalada ainda.') }));
    for (const x of d.list) {
      body.push(h('div', { class: 'ext' },
        x.icon ? h('img', { src: x.icon, alt: '' }) : h('span', { class: 'ph', text: (x.name || '?').charAt(0).toUpperCase() }),
        h('button', { class: 'name', title: x.hasPopup ? t('Abrir') : t('Sem janela própria'), onclick: () => x.hasPopup && send('ext:popup', x.id) },
          h('b', { text: x.name }), h('small', { text: 'v' + x.version })),
        h('button', { class: 'ico-btn' + (x.pinned ? ' on' : ''), title: x.pinned ? t('Desafixar da barra') : t('Fixar na barra'), onclick: () => send('ext:pin', x.id) }, icon('pin')),
        h('button', { class: 'ico-btn', title: t('Remover'), onclick: () => send('ext:remove', x.id) }, icon('trash'))));
    }
    body.push(
      h('div', { class: 'sep' }),
      h('div', { class: 'field' },
        h('label', { for: 'store', text: t('Chrome Web Store: cole o link ou o ID') }),
        h('input', { id: 'store', type: 'text', placeholder: 'https://chromewebstore.google.com/detail/…', spellcheck: 'false',
          onkeydown: e => { if (e.key === 'Enter' && e.target.value.trim()) send('ext:installStore', e.target.value.trim()); } })),
      h('div', { class: 'actions' },
        h('button', { class: 'btn', text: t('Instalar'), onclick: () => { const v = document.getElementById('store').value.trim(); if (v) send('ext:installStore', v); } }),
        h('button', { class: 'btn', text: t('Arquivo .crx…'), onclick: () => send('ext:installFile') }),
        h('button', { class: 'btn', text: t('Pasta…'), onclick: () => send('ext:installFolder') })),
      h('button', { class: 'row', onclick: () => send('page:open', 'extensions') }, ic('puzzle'), h('span', { class: 'lb', text: t('Gerenciar extensões') })),
      h('button', { class: 'row', onclick: () => send('page:open', 'extension-guide') }, ic('info'), h('span', { class: 'lb', text: t('Como instalar extensões') })));
  }
  return h('div', { class: 'panel' }, body);
}

// ---------- sugestões do omnibox ----------
const SUGG_ICON = { bookmark: 'star', history: 'history', search: 'search', url: 'globe' };
function suggest(d) {
  return h('div', { class: 'panel', role: 'listbox' }, d.items.map((it, i) => h('button', {
    class: 'row' + (i === d.sel ? ' sel' : ''),
    role: 'option',
    // mousedown: age antes de a barra de endereço perder o foco
    onmousedown: e => { e.preventDefault(); send('nav:go', it.url); },
  },
  ic(SUGG_ICON[it.type] || 'globe'),
  h('span', { class: 'lb' }, it.type === 'search' || it.type === 'url' ? it.title : [it.title, h('span', { class: 'sub', text: it.url })]))));
}

// ---------- informações do site (cadeado) ----------
const PERM_LABEL = { camera: 'Câmera', microphone: 'Microfone', geolocation: 'Localização', notifications: 'Notificações', popups: 'Pop-ups', autoplay: 'Áudio automático', javascript: 'JavaScript', sensors: 'Sensores de movimento' };
const VAL_LABEL = { ask: 'Perguntar', allow: 'Permitir', block: 'Bloquear', auto: 'Automático' };
const RELOAD_KEYS = ['javascript', 'autoplay', 'sensors'];
const kv = (k, v) => h('div', { class: 'kv' }, h('span', { class: 'k', text: k }), h('span', { class: 'v', text: v }));
const day = s => new Date(s * 1000).toLocaleDateString(locale());

function site(d) {
  let state = 'warn';
  let title = t('Conexão não segura');
  if (d.internal) { state = 'ok'; title = t('Página interna do Devoid Web'); }
  else if (d.protocol === 'https') { state = d.cert && !d.cert.ok ? 'bad' : 'ok'; title = d.cert && !d.cert.ok ? t('Problema com o certificado') : t('Conexão segura (HTTPS)'); }
  else if (!d.web) title = t('Sem informações de conexão');
  const body = [
    h('div', { class: 'hd ' + (state === 'ok' ? 'ok' : 'bad') }, icon(state === 'ok' ? 'lock' : 'warn'),
      h('div', {}, h('b', { text: d.host || t('Página') }), h('small', { text: title }))),
  ];
  if (d.protocol === 'https' && d.cert) {
    body.push(
      h('h3', { text: t('Certificado SSL/TLS') }),
      kv(t('Status'), d.cert.ok ? t('Válido e confiável') : t('Não confiável ({r})', { r: d.cert.result })),
      kv(t('Emitido para'), d.cert.subject || '—'),
      kv(t('Emitido por'), d.cert.issuer || '—'),
      kv(t('Válido de'), day(d.cert.validStart)),
      kv(t('Válido até'), day(d.cert.validExpiry)),
      kv(t('Impressão digital'), String(d.cert.fingerprint).replace('sha256/', '').slice(0, 24) + '…'));
  } else if (d.protocol === 'http') {
    body.push(h('div', { class: 'muted', text: t('Os dados enviados a este site podem ser lidos por terceiros. Evite digitar senhas ou dados pessoais.') }));
  }
  if (d.web) {
    body.push(
      h('h3', { text: t('Sobre o site') }),
      kv(t('Domínio'), d.host), kv(t('Protocolo'), d.protocol.toUpperCase()), kv(t('Porta'), d.port),
      h('div', { class: 'line' }, h('span', { text: t('Cookies deste site: {n}', { n: d.cookies }) }),
        h('button', { class: 'btn', text: t('Apagar'), onclick: () => send('site:clearCookies') })),
      h('h3', { text: t('Permissões deste site') }));
    for (const k of Object.keys(PERM_LABEL)) {
      const cur = d.perms[k];
      body.push(h('div', { class: 'perm' },
        h('label', { for: 'p-' + k, text: t(PERM_LABEL[k]) }),
        h('select', { id: 'p-' + k, class: cur.saved ? 'set' : '', onchange: e => send('site:setPerm', k, e.target.value) },
          d.options[k].map(v => h('option', { value: v, text: t(VAL_LABEL[v]), selected: v === cur.value })))));
    }
    body.push(h('div', { class: 'muted', text: t('Mudanças em JavaScript, áudio automático e sensores recarregam a página.') }));
  }
  return h('div', { class: 'panel' }, body);
}

// ---------- downloads ----------
function downloadsPanel(d) {
  const body = [h('h3', { text: t('Downloads') })];
  const pend = d.list.find(x => x.pending);
  if (pend) {
    body.push(h('div', { class: 'warncard' },
      h('b', { text: t('Este download pode ser perigoso') }),
      h('div', { text: pend.name }),
      h('ul', {}, pend.risk.reasons.map(([k, v]) => h('li', { text: t(k, v) }))),
      h('div', { class: 'muted', text: t('Nível de risco: {n}/100', { n: pend.risk.score }) }),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', text: t('Cancelar download'), onclick: () => send('dl:decide', pend.id, false) }),
        h('button', { class: 'btn danger', text: t('Baixar mesmo assim'), onclick: () => send('dl:decide', pend.id, true) }))));
  }
  const rest = d.list.filter(x => !x.pending);
  if (!rest.length && !pend) body.push(h('div', { class: 'muted', text: t('Nenhum download nesta sessão.') }));
  const STATE = { completed: 'Concluído', cancelled: 'Cancelado', interrupted: 'Interrompido', paused: 'Pausado' };
  for (const x of rest) {
    const prog = x.state === 'progressing';
    body.push(h('div', { class: 'dlrow' },
      h('div', { class: 'nm', text: x.name }),
      prog && x.total ? h('div', { class: 'bar2' }, h('i', { style: { width: Math.min(100, Math.round(x.received / x.total * 100)) + '%' } })) : null,
      h('div', { class: 'meta' },
        h('span', { text: prog ? (x.total ? `${mb(x.received)} / ${mb(x.total)}` : t('Baixando…')) : t(STATE[x.state] || x.state) }),
        h('span', {},
          prog ? h('button', { class: 'btn', text: t('Cancelar'), onclick: () => send('dl:cancel', x.id) }) : null,
          x.state === 'completed' ? h('button', { class: 'btn', text: t('Mostrar na pasta'), onclick: () => send('dl:show', x.id) }) : null))));
  }
  body.push(h('div', { class: 'sep' }), h('button', { class: 'row', onclick: () => send('page:open', 'downloads') }, ic('download'), h('span', { class: 'lb', text: t('Ver todos os downloads') })));
  return h('div', { class: 'panel' }, body);
}

// ---------- grupos de abas ----------
function groupPanel(d) {
  let color = d.color;
  const input = h('input', { type: 'text', id: 'gname', maxlength: '30', value: d.name, placeholder: t('Nome do grupo'), 'data-autofocus': true, spellcheck: 'false' });
  const sw2 = h('div', { class: 'swatches' }, d.colors.map(c => h('button', {
    style: { '--c': c }, class: c === color ? 'on' : '', 'aria-label': c,
    onclick: e => { color = c; sw2.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === e.currentTarget)); },
  })));
  const save = () => send('group:save', { name: input.value, color });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
  return h('div', { class: 'panel' },
    h('h3', { text: d.editing ? t('Editar grupo') : t('Novo grupo de abas') }),
    h('div', { class: 'field' }, h('label', { for: 'gname', text: t('Nome') }), input),
    sw2,
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary', text: t('Salvar'), onclick: save }),
      h('button', { class: 'btn', text: t('Cancelar'), onclick: () => send('overlay:hide') })));
}

// ---------- divisão de tela ----------
function splitPanel(d) {
  const body = [h('h3', { text: t('Dividir a tela') })];
  if (d.active) body.push(h('button', { class: 'row', onclick: () => send('split:close') }, ic('split'), h('span', { class: 'lb', text: t('Sair da divisão de tela') })));
  else {
    body.push(h('div', { class: 'muted', text: t('Escolha a aba que ficará ao lado da aba atual:') }),
      h('button', { class: 'row', onclick: () => send('split:open', 0) }, ic('plus'), h('span', { class: 'lb', text: t('Nova aba ao lado') })));
    for (const x of d.tabs) {
      body.push(h('button', { class: 'row', onclick: () => send('split:open', x.id) },
        h('span', { class: 'em' }, x.favicon ? h('img', { src: x.favicon, alt: '' }) : icon('globe')),
        h('span', { class: 'lb', text: x.title || t('Nova aba') })));
    }
  }
  return h('div', { class: 'panel' }, body);
}

const VIEWS = { menu, translate: translatePanel, translation, extensions: extensionsPanel, suggest, site, downloads: downloadsPanel, group: groupPanel, split: splitPanel };
