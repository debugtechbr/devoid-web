const $ = s => document.querySelector(s);
document.title = t('Bem-vindo ao Devoid Web');

const LANGS = [['auto', t('Automático')], ['pt', 'Português'], ['en', 'English'], ['es', 'Español']];

devoid.invoke('settings:get').then(({ settings }) => {
  $('#langs').replaceChildren(...LANGS.map(([code, label]) => {
    const b = document.createElement('button');
    b.className = 'btn' + (settings.language === code ? ' on' : '');
    b.textContent = label;
    b.onclick = () => devoid.send('settings:set', { language: code }); // a tela recarrega no novo idioma
    return b;
  }));
});

$('#start').onclick = () => { devoid.send('welcome:done'); devoid.send('nav:go', ''); };
$('#settings').onclick = () => { devoid.send('welcome:done'); devoid.send('page:open', 'settings'); };
