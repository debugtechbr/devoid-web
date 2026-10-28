(() => {
  if (!window.devoid) return;
  if (window.I18N) { I18N.setLang(devoid.lang); I18N.apply(); }

  const lum = h => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };

  const apply = ({ settings, vars }) => {
    if (window.I18N && settings.lang !== devoid.lang) { location.reload(); return; } // trocou o idioma
    const root = document.documentElement;
    for (const k of Object.keys(vars)) root.style.setProperty(k, vars[k]);
    root.dataset.tabs = settings.tabStyle;
    const light = settings.theme === 'light' || (settings.theme === 'custom' && lum(settings.customBg) > 0.5);
    root.dataset.light = light ? '1' : '0';
    window.dispatchEvent(new CustomEvent('devoid-settings', { detail: settings }));
  };

  devoid.invoke('settings:get').then(apply);
  devoid.on('settings:changed', apply);
})();
