const content = document.getElementById('content');
const nav = document.getElementById('nav');

const h = (tag, props = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'value') e.value = v;
    else if (k === 'checked') e.checked = !!v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  e.append(...kids.flat().filter(x => x != null));
  return e;
};

let S = null; // configurações
let M = null; // listas (buscadores, fontes, idiomas, permissões)
let timer = null;
let current = (location.hash.slice(1) || 'appearance');

document.title = t('Configurações');

const set = (patch, redraw = false) => {
  Object.assign(S, patch);
  devoid.send('settings:set', patch);
  if (redraw) draw();
};
window.addEventListener('devoid-settings', e => { S = { ...S, ...e.detail }; });

const ERR = {
  SIZE: 'Arquivo grande demais.', URL: 'Endereço inválido.',
  HTTP: 'Não foi possível baixar o arquivo.', empty: 'A lista está vazia ou em formato inválido.',
};
const errText = code => t(ERR[code] || 'Não foi possível concluir. Tente de novo.');

// ---------- componentes ----------
const row = (label, control, hint) => h('div', { class: 'srow' },
  h('div', { class: 'stxt' }, h('b', { text: label }), hint ? h('small', { text: hint }) : null),
  h('div', { class: 'sctl' }, control));

const select = (value, options, onchange) => h('select', { onchange: e => onchange(e.target.value) },
  options.map(([v, l]) => h('option', { value: v, text: l, selected: v === value })));

const toggle = (value, onchange) => h('label', { class: 'switch' },
  h('input', { type: 'checkbox', checked: value, onchange: e => onchange(e.target.checked) }), h('span'));

const color = (value, onchange) => h('input', { type: 'color', value, onchange: e => onchange(e.target.value) });
const number = (value, min, max, onchange) => h('input', { type: 'number', min, max, value, onchange: e => {
  const n = Math.round(Number(e.target.value));
  if (n >= min && n <= max) onchange(n); else e.target.value = value;
} });
const button = (text, onclick, cls = '') => h('button', { class: 'btn ' + cls, text, onclick });
const group = (title, ...rows) => h('section', { class: 'group' }, h('h2', { text: title }), ...rows);
const field = (type, placeholder, value = '') => h('input', { type, placeholder, value, spellcheck: 'false', autocomplete: 'off' });
const note = text => h('small', { class: 'note', text });

const PERM_LABEL = { camera: 'Câmera', microphone: 'Microfone', geolocation: 'Localização', notifications: 'Notificações', popups: 'Pop-ups', autoplay: 'Áudio automático', javascript: 'JavaScript', sensors: 'Sensores de movimento' };
const VAL_LABEL = { ask: 'Perguntar', allow: 'Permitir', block: 'Bloquear', auto: 'Automático' };

// ---------- seções ----------
function appearance() {
  const themes = [['devoid', t('Devoid Neon (preto, branco e amarelo)')], ['dark', t('Escuro')], ['light', t('Claro')], ['oled', t('OLED (preto total)')], ['custom', t('Personalizado')]];
  const langs = [['auto', t('Automático (idioma do sistema)')], ['pt', 'Português'], ['en', 'English'], ['es', 'Español']];
  return [
    group(t('Idioma'), row(t('Idioma do navegador'), select(S.language, langs, v => set({ language: v })), t('Na primeira abertura, o idioma do sistema é detectado sozinho.'))),
    group(t('Tema'),
      row(t('Tema do navegador'), select(S.theme, themes, v => set({ theme: v }, true))),
      S.theme === 'custom' ? row(t('Cor de fundo'), color(S.customBg, v => set({ customBg: v }))) : null,
      S.theme === 'custom' ? row(t('Cor do texto'), color(S.customText, v => set({ customText: v }))) : null,
      row(t('Cor de destaque'), color(S.accent, v => set({ accent: v })), t('Botões, bordas, aba ativa e detalhes.'))),
    group(t('Abas'),
      row(t('Estilo das abas'), select(S.tabStyle, [['rounded', t('Arredondadas (estilo Chrome/Edge)')], ['square', t('Quadradas minimalistas')], ['vertical', t('Verticais (barra lateral)')]], v => set({ tabStyle: v })))),
    group(t('Fonte da interface'),
      row(t('Família'), select(S.uiFont, M.fonts.map(f => [f, f]), v => set({ uiFont: v }))),
      row(t('Tamanho'), number(S.uiFontSize, 11, 20, v => set({ uiFontSize: v })), t('Entre 11 e 20 px.'))),
  ];
}

function search() {
  return [
    group(t('Mecanismo de busca'),
      row(t('Buscador padrão'), select(S.searchEngine, Object.entries(M.engines), v => set({ searchEngine: v })), t('Usado pela barra de endereços.'))),
    group(t('Ao iniciar'),
      row(t('Abrir'), select(S.startup, [['newtab', t('Página de nova aba')], ['restore', t('Continuar de onde parei')], ['pages', t('Páginas específicas')]], v => set({ startup: v }, true))),
      S.startup === 'pages' ? row(t('Páginas'), h('textarea', {
        rows: 4, placeholder: 'https://exemplo.com\nhttps://outro.com', value: S.startupPages.join('\n'),
        onchange: e => set({ startupPages: e.target.value.split('\n').map(x => x.trim()).filter(x => /^https?:\/\//i.test(x)).slice(0, 10) }),
      }), t('Uma por linha, até 10 (somente http e https).')) : null),
  ];
}

function adblockGroup() {
  const status = h('small', { class: 'note' });
  devoid.invoke('get-adblock-stats').then(d => {
    status.textContent = d && d.conflict.length
      ? t('Extensão bloqueadora detectada: {names}. O bloqueio nativo está em pausa neste perfil.', { names: d.conflict.join(', ') })
      : t('Nenhuma extensão bloqueadora detectada neste perfil.');
  }).catch(() => {});
  return group(t('Bloqueador de anúncios nativo'),
    row(t('Bloqueador nativo'), toggle(S.nativeAdblock, v => set({ nativeAdblock: v })),
      t('Se uBlock, AdGuard ou similar estiver instalado, o bloqueio nativo pausa sozinho naquele perfil.')),
    status);
}

function hardeningGroup() {
  return group(t('Reforço de segurança'),
    row(t('Cabeçalhos de segurança reforçados'), toggle(S.hardenHeaders, v => set({ hardenHeaders: v })),
      t('Adiciona X-Content-Type-Options e Referrer-Policy às páginas que não os enviam.')),
    row(t('Exigir que iframes de outros sites se declarem embutíveis'), toggle(S.blockCrossFrames, v => set({ blockCrossFrames: v })),
      t('Adiciona X-Frame-Options: SAMEORIGIN. Pode quebrar vídeos e logins embutidos.')));
}

function blocklistGroup() {
  const info = h('small', { class: 'note', text: t('Carregando…') });
  const msg = h('small', { class: 'note' });
  const refresh = () => devoid.invoke('blocklist:info').then(i => { info.textContent = t('Lista embutida: {a} domínios · lista importada: {b} domínios', { a: i.builtin, b: i.extra }); });
  refresh();
  const url = field('text', 'https://…/hosts', 'https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts');
  const done = r => {
    if (!r) return;
    msg.textContent = r.ok ? t('Lista importada: {n} domínios.', { n: r.count }) : errText(r.error);
    refresh();
  };
  return group(t('Listas de bloqueio'),
    row(t('Lista de hosts'), h('div', { class: 'seg' }, button(t('Importar arquivo…'), async () => done(await devoid.invoke('blocklist:file')))),
      t('Aceita o formato hosts (0.0.0.0 dominio) ou uma lista simples de domínios.')),
    row(t('Baixar de um endereço'), h('div', { class: 'seg' }, url, button(t('Baixar e importar'), async () => { msg.textContent = t('Baixando…'); done(await devoid.invoke('blocklist:url', url.value)); })),
      t('Sugestão: a lista unificada do StevenBlack (já preenchida).')),
    row(t('Domínios extras'), h('textarea', { rows: 3, placeholder: 'ads.exemplo.com', value: S.customBlocklist, onchange: e => set({ customBlocklist: e.target.value.slice(0, 5000) }) }),
      t('Um por linha. Vale para o domínio e seus subdomínios.')),
    info, msg);
}

function privacy() {
  const clear = what => async e => {
    e.target.disabled = true;
    await devoid.invoke('data:clear', what);
    e.target.textContent = t('Pronto');
    setTimeout(() => draw(), 900);
  };
  const exitRow = (k, label) => row(label, toggle(S.clearOnExit[k], v => set({ clearOnExit: { ...S.clearOnExit, [k]: v } })));
  const catRow = (k, label) => row(label, toggle(S.blockCats[k], v => set({ blockCats: { ...S.blockCats, [k]: v } })));
  const defRow = k => row(t(PERM_LABEL[k]), select(S.siteDefaults[k], M.sitePerms[k].map(v => [v, t(VAL_LABEL[v])]), v => set({ siteDefaults: { ...S.siteDefaults, [k]: v } })));

  const sites = h('div', { class: 'sites' }, h('small', { text: t('Carregando…') }));
  devoid.invoke('perm:list').then(all => {
    const items = Object.entries(all).flatMap(([host, perms]) => Object.entries(perms).map(([p, v]) => [host, p, v]));
    sites.replaceChildren(...(items.length ? items.map(([host, p, v]) => h('div', { class: 'site' },
      h('span', { text: `${host} — ${t(PERM_LABEL[p] || p)}: ${t(VAL_LABEL[v] || v)}` }),
      button(t('Remover'), () => { devoid.send('perm:remove', host, p); setTimeout(draw, 150); }))) : [h('small', { text: t('Nenhuma decisão salva ainda.') })]));
  });

  return [
    group(t('Proteção contra rastreamento'),
      row(t('Nível de proteção'), select(S.protection, [['standard', t('Padrão: anúncios, gravação de sessão e telemetria')], ['strict', t('Estrita: tudo, mais o sinal "Não me rastreie"')], ['custom', t('Personalizada')]], v => set({ protection: v }, true)),
        t('Por padrão o Devoid Web não tem preenchimento automático e não grava o que você digita.')),
      S.protection === 'custom' ? catRow('ads', t('Anúncios')) : null,
      S.protection === 'custom' ? catRow('analytics', t('Análise de uso')) : null,
      S.protection === 'custom' ? catRow('social', t('Redes sociais')) : null,
      S.protection === 'custom' ? catRow('recording', t('Gravação de sessão')) : null,
      S.protection === 'custom' ? catRow('telemetry', t('Telemetria')) : null,
      S.protection === 'custom' ? row(t('Enviar "Não me rastreie"'), toggle(S.doNotTrack, v => set({ doNotTrack: v })), t('Cabeçalhos DNT e Sec-GPC.')) : null),
    adblockGroup(),
    blocklistGroup(),
    hardeningGroup(),
    group(t('Limpar dados ao fechar o navegador'),
      exitRow('cookies', t('Cookies')), exitRow('cache', t('Cache')), exitRow('history', t('Histórico')), exitRow('siteData', t('Dados de sites (armazenamento local)'))),
    group(t('Limpar agora'),
      h('div', { class: 'seg' },
        button(t('Cookies'), clear({ cookies: true })), button(t('Cache'), clear({ cache: true })),
        button(t('Histórico'), clear({ history: true })), button(t('Dados de sites'), clear({ siteData: true })))),
    group(t('Permissões padrão dos sites'), ...Object.keys(PERM_LABEL).map(defRow), note(t('Cada site pode ter regras próprias no cadeado da barra de endereços.'))),
    group(t('Decisões salvas por site'), sites),
  ];
}

function diagBox() {
  const box = h('div', { class: 'diag' });
  const load = async () => {
    const d = await devoid.invoke('diag:get');
    const table = (head, rows) => h('table', {}, h('thead', {}, h('tr', {}, head.map(x => h('th', { text: x })))),
      h('tbody', {}, rows.map(r => h('tr', {}, r.map(c => h('td', { text: String(c) }))))));
    box.replaceChildren(
      h('small', { text: `Electron ${d.versions.electron} · Chromium ${d.versions.chrome}${d.renderer ? ' · ' + d.renderer : ''}` }),
      h('h3', { text: t('Recursos de GPU') }),
      table([t('Recurso'), t('Estado')], Object.entries(d.gpu)),
      h('h3', { text: t('Processos (CPU e memória)') }),
      table(['PID', t('Tipo'), 'CPU %', t('Memória (MB)')], d.processes.map(p => [p.pid, p.type, p.cpu, Math.round(p.mem / 1024)])),
      h('h3', { text: t('Abas') }),
      table([t('Aba'), 'PID', t('Estado')], d.tabs.map(x => [x.title || t('(sem título)'), x.pid || '—', x.snoozed ? t('suspensa') : t('ativa')])));
  };
  load();
  timer = setInterval(load, 3000);
  return box;
}

function dnsGroup() {
  const providers = [['system', t('DNS do sistema (padrão)')], ['cloudflare', 'Cloudflare (1.1.1.1)'], ['google', 'Google (8.8.8.8)'], ['adguard', 'AdGuard DNS'], ['quad9', 'Quad9 (9.9.9.9)'], ['custom', t('Personalizado (DoH)')]];
  const msg = h('small', { class: 'note' });
  return group(t('DNS seguro (DNS sobre HTTPS)'),
    row(t('Servidor de DNS'), select(S.dns.provider, providers, v => set({ dns: { ...S.dns, provider: v } }, true)), t('Criptografa as consultas de DNS para que o provedor de internet não veja os sites que você acessa.')),
    S.dns.provider === 'custom' ? row(t('Endereço DoH'), h('input', {
      type: 'text', value: S.dns.custom, placeholder: 'https://dns.exemplo.com/dns-query', spellcheck: 'false',
      onchange: e => {
        const v = e.target.value.trim();
        if (v === '' || /^https:\/\//i.test(v)) { msg.textContent = ''; set({ dns: { ...S.dns, custom: v } }); } else msg.textContent = t('O endereço precisa começar com https://');
      },
    }), t('Use o endereço do modelo DoH do seu provedor.')) : null,
    S.dns.provider !== 'system' ? row(t('Exigir DNS seguro'), toggle(S.dns.strict, v => set({ dns: { ...S.dns, strict: v } })), t('Ligado: sem plano B. Se o servidor falhar, os sites não abrem.')) : null,
    msg);
}

function performance() {
  return [
    group(t('Aceleração por hardware'),
      row(t('Usar a placa de vídeo'), toggle(S.hardwareAccel, v => set({ hardwareAccel: v })), t('Reinicie o navegador para aplicar.')),
      note(t('Ligada: rasterização na GPU, zero-copy e decodificação de vídeo por hardware. Desligue só se tiver travamentos.'))),
    group(t('Economia de memória'),
      row(t('Suspender abas inativas'), toggle(S.tabSnooze, v => set({ tabSnooze: v })), t('Abas sem uso e sem áudio liberam a memória e recarregam ao clicar.')),
      row(t('Suspender após (minutos)'), number(S.snoozeMinutes, 1, 240, v => set({ snoozeMinutes: v })))),
    dnsGroup(),
    group(t('Downloads'),
      row(t('Pasta de destino'), h('div', { class: 'seg' }, h('code', { text: S.downloadDir || t('Padrão do sistema') }),
        button(t('Escolher…'), async () => { await devoid.invoke('settings:pickDir'); S = (await devoid.invoke('settings:get')).settings; draw(); }),
        S.downloadDir ? button(t('Usar padrão'), () => set({ downloadDir: '' }, true)) : null)),
      row(t('Sempre perguntar onde salvar'), toggle(S.askDownload, v => set({ askDownload: v })))),
    group(t('Diagnóstico'), diagBox()),
  ];
}

function translator() {
  const input = h('input', { type: 'password', placeholder: S.hasGoogleKey ? t('•••••••• (chave salva)') : t('Cole sua chave de API (opcional)'), autocomplete: 'off', spellcheck: 'false' });
  const msg = h('small', { class: 'note' });
  const save = async key => {
    const r = await devoid.invoke('translate:setKey', key);
    msg.textContent = r.ok ? (r.hasKey ? t('Chave salva com segurança.') : t('Chave removida.')) : r.error;
    if (r.ok) { S.hasGoogleKey = r.hasKey; input.value = ''; input.placeholder = r.hasKey ? t('•••••••• (chave salva)') : t('Cole sua chave de API (opcional)'); }
  };
  return [
    group(t('Google Tradutor'),
      row(t('Idioma padrão'), select(S.translateTarget, Object.entries(M.langs), v => set({ translateTarget: v }))),
      row(t('Traduzir páginas automaticamente'), toggle(S.translateAuto, v => set({ translateAuto: v })), t('Traduz quando o idioma da página for diferente do padrão.'))),
    group(t('Chave de API do Google (opcional)'),
      row(t('Chave do Cloud Translation'), h('div', { class: 'seg' }, input, button(t('Salvar'), () => input.value.trim() && save(input.value.trim()), 'primary'), button(t('Remover'), () => save(''))),
        t('Sem chave, o navegador usa o serviço web gratuito do Google, que não é oficial e pode limitar pedidos. Com chave, usa a API oficial. A chave fica criptografada neste computador.')),
      msg),
  ];
}

function accounts() {
  const box = h('div', { class: 'exts' });
  const load = async () => {
    const r = await devoid.invoke('profile:list');
    const all = [...r.profiles.map(p => ({ id: p.id, name: p.id === 'main' && p.name === 'Principal' ? t('Principal') : p.name })), { id: 'guest', name: t('Convidado') }];
    box.replaceChildren(...all.map(p => h('div', { class: 'srow' },
      h('div', { class: 'stxt' }, h('b', { text: p.name }), h('small', { text: p.id === r.current ? t('Perfil desta janela') : '' })),
      h('div', { class: 'sctl seg' }, button(t('Abrir'), () => devoid.send('profile:open', p.id))))));
  };
  load();
  return [
    group(t('Perfis'), box),
    group(t('Central de contas'),
      row(t('Entrar em contas e alternar entre elas'), button(t('Abrir devoid://accounts'), () => devoid.send('page:open', 'accounts'), 'primary'),
        t('Cada perfil guarda cookies, sessão, histórico e favoritos separados.'))),
  ];
}

function extensionsSection() {
  return [
    group(t('Extensões'),
      row(t('Gerenciar extensões'), button(t('Abrir'), () => devoid.send('page:open', 'extensions'), 'primary'), t('Instale, fixe e remova extensões do Chrome.'))),
  ];
}

function about() {
  return [
    group('Devoid Web',
      h('div', { class: 'about' },
        h('img', { src: '../assets/devoid-web-white.png', alt: 'Devoid Web' }),
        h('p', { text: t('Versão {v}', { v: M.version }) }),
        h('p', { class: 'warnline', text: t('O Devoid Web está em fase ativa de desenvolvimento.') }),
        h('div', { class: 'chain' }, h('span', { text: t('um produto') }), h('img', { src: '../assets/devoid-white.png', alt: 'Devoid' }), h('span', { text: t('da') }), h('img', { class: 'debug', src: '../assets/debug.png', alt: 'DEBUG' })),
        h('div', { class: 'seg' }, button(t('Rever as boas-vindas'), () => devoid.send('page:open', 'welcome'))))),
  ];
}

const SECTIONS = [
  ['appearance', 'Aparência e personalização', appearance],
  ['search', 'Busca e inicialização', search],
  ['privacy', 'Privacidade e segurança', privacy],
  ['performance', 'Desempenho e sistema', performance],
  ['translator', 'Tradutor (Google)', translator],
  ['accounts', 'Contas e perfis', accounts],
  ['extensions', 'Extensões', extensionsSection],
  ['about', 'Sobre', about],
];

function draw() {
  clearInterval(timer);
  const sec = SECTIONS.find(x => x[0] === current) || SECTIONS[0];
  nav.replaceChildren(...SECTIONS.map(([id, title]) => h('button', {
    class: 'navbtn' + (id === sec[0] ? ' on' : ''), text: t(title), onclick: () => { current = id; location.hash = id; draw(); },
  })));
  const y = content.scrollTop;
  content.replaceChildren(h('h1', { text: t(sec[1]) }), ...sec[2]().filter(Boolean));
  content.scrollTop = y;
}

window.addEventListener('hashchange', () => { current = location.hash.slice(1) || 'appearance'; draw(); });

devoid.invoke('settings:get').then(r => { S = r.settings; M = r.meta; draw(); });
