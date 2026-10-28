const $ = s => document.querySelector(s);
document.title = t('Nova aba');

$('#f').addEventListener('submit', e => {
  e.preventDefault();
  const text = $('#q').value.trim();
  if (text) devoid.send('nav:go', text);
});

devoid.invoke('bm:list').then(list => {
  const grid = $('#grid');
  list.slice(0, 16).forEach(b => {
    const a = document.createElement('a');
    a.className = 'card';
    a.href = b.url;

    let icon;
    if (b.favicon) { icon = document.createElement('img'); icon.src = b.favicon; icon.alt = ''; }
    else {
      icon = document.createElement('b');
      icon.textContent = (b.title || b.url).replace(/^https?:\/\/(www\.)?/, '').charAt(0).toUpperCase();
    }

    const name = document.createElement('span');
    try { name.textContent = b.title || new URL(b.url).hostname; } catch { name.textContent = b.url; }
    a.title = b.title || b.url;
    a.append(icon, name);
    grid.append(a);
  });
});
