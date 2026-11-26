// Se ejecuta antes que el stylesheet para aplicar el tema guardado sin parpadeo.
(function () {
  var saved = null;
  try {
    saved = JSON.parse(localStorage.getItem('sonora:theme'));
  } catch (error) {
    saved = null;
  }
  var theme = saved === 'light' || saved === 'dark'
    ? saved
    : window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
})();
