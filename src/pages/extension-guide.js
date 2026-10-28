const $ = s => document.querySelector(s);
document.title = t('Como instalar extensões');

const done = n => {
  const li = document.querySelector(`[data-step="${n}"]`);
  if (li) li.classList.add('done');
};

function banner() { $('#banner').hidden = location.hash !== '#installing'; }
banner();
window.addEventListener('hashchange', banner);

$('#openStore').onclick = () => { window.open('https://chromewebstore.google.com/', '_blank'); done(1); };
$('#copied').onclick = () => { done(2); $('#link').focus(); };
$('#install').onclick = () => {
  const v = $('#link').value.trim();
  if (!v) { $('#msg').textContent = t('Cole o link da extensão na Chrome Web Store ou o ID (32 letras).'); return; }
  $('#msg').textContent = t('Baixando a extensão… confirme na janela que vai abrir.');
  devoid.send('ext:installStore', v);
  done(2); done(3);
};
$('#link').addEventListener('keydown', e => { if (e.key === 'Enter') $('#install').click(); });
$('#seeExt').onclick = () => { devoid.send('page:open', 'extensions'); done(4); };
