import './overlays.js';
import * as store from './store.js';
import { player, togglePlay, next, prev, seek, setVolume, toggleMute } from './player.js';
import { buildView } from './views.js';
import { initPlayerBar, initNowPanel, initSidebar } from './panels.js';
import { openSettings } from './actions.js';
import { toast } from './overlays.js';
import { $, debounce, on } from './util.js';
import { mountIcons, icon } from './visual.js';
import { currentTheme, initTheme, toggleTheme } from './theme.js';
import { initEq } from './eq.js';

mountIcons();

const scroller = $('#view');
const searchInput = $('#search');
let current = null;

function renderView() {
  current?.destroy?.();
  scroller.innerHTML = '';
  scroller.scrollTop = 0;
  current = buildView(scroller);
  scroller.append(current.el);
  current.mounted?.();
  $('#back').disabled = !store.state.back.length && !store.state.query;
  searchInput.value = store.state.query;
}

function renderScan() {
  const { active, done, total } = store.state.scan;
  const status = $('#scan-status');
  const line = $('#scan-line');
  status.hidden = !active;
  line.classList.toggle('active', active);
  if (!active) {
    line.style.removeProperty('--progress');
    return;
  }
  status.textContent = total ? `Escaneando ${done.toLocaleString('es')} / ${total.toLocaleString('es')}` : 'Buscando música…';
  line.style.setProperty('--progress', total ? `${(done / total) * 100}%` : '15%');
}

on('nav', renderView);
on('library', renderView);
on('playlists', () => {
  if (store.state.nav.name === 'playlist' && !store.state.query) renderView();
});
on('scan', renderScan);

searchInput.addEventListener(
  'input',
  debounce(() => store.setQuery(searchInput.value), 140),
);
searchInput.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    searchInput.value = '';
    store.setQuery('');
    searchInput.blur();
  }
});

$('#back').addEventListener('click', store.goBack);
document.addEventListener('click', (event) => {
  if (event.target.closest('[data-act="open-settings"]')) openSettings();
});

// Botones laterales del ratón: 3 = atrás, 4 = adelante.
// Se capturan en fase de captura para que ningún control (pestañas, tarjetas,
// playlists...) los trate como un clic y reinicie el historial.
const isSideButton = (event) => event.button === 3 || event.button === 4;
let sideHandled = false;
let lastStep = 0;

// Algunos controladores emiten además Alt+←/→ al pulsar el botón lateral.
function stepHistory(back) {
  const now = Date.now();
  if (now - lastStep < 80) return;
  lastStep = now;
  if (back) store.goBack();
  else store.goForward();
}

function onSideButtonDown(event) {
  if (!isSideButton(event)) return;
  event.preventDefault();
  event.stopPropagation();
  if (sideHandled) return;
  sideHandled = true;
  if (document.querySelector('.overlay')) return;
  stepHistory(event.button === 3);
}

function swallowSideButton(event) {
  if (!isSideButton(event)) return;
  event.preventDefault();
  event.stopPropagation();
}

function resetSideButton() {
  sideHandled = false;
}

// `pointerdown` cancela también la navegación nativa del WebView; `mousedown`
// queda como respaldo para motores que no exponen Pointer Events.
window.addEventListener('pointerdown', onSideButtonDown, true);
window.addEventListener('mousedown', onSideButtonDown, true);
window.addEventListener('mouseup', swallowSideButton, true);
window.addEventListener('auxclick', swallowSideButton, true);
window.addEventListener('click', swallowSideButton, true);
window.addEventListener('pointerup', resetSideButton, true);
window.addEventListener('mouseup', resetSideButton, true);

const typing = () => {
  const el = document.activeElement;
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && el.type !== 'range';
};

document.addEventListener('keydown', (event) => {
  const meta = event.ctrlKey || event.metaKey;
  if (meta && event.key.toLowerCase() === 'f') {
    event.preventDefault();
    searchInput.focus();
    searchInput.select();
    return;
  }
  if (event.altKey && !meta) {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      stepHistory(true);
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      stepHistory(false);
      return;
    }
  }
  if (typing() || event.altKey) return;
  if (document.querySelector('.overlay')) return;

  switch (event.key) {
    case ' ':
      if (document.activeElement?.tagName === 'BUTTON') return;
      event.preventDefault();
      togglePlay();
      break;
    case 'ArrowRight':
      if (meta) next();
      else if (document.activeElement?.type !== 'range') seek(Math.min((document.getElementById('audio').currentTime || 0) + 5, document.getElementById('audio').duration || 0));
      break;
    case 'ArrowLeft':
      if (meta) prev();
      else if (document.activeElement?.type !== 'range') seek(Math.max((document.getElementById('audio').currentTime || 0) - 5, 0));
      break;
    case 'ArrowUp':
      if (meta) {
        event.preventDefault();
        setVolume(player.volume + 0.05);
      }
      break;
    case 'ArrowDown':
      if (meta) {
        event.preventDefault();
        setVolume(player.volume - 0.05);
      }
      break;
    case 'm':
    case 'M':
      toggleMute();
      break;
    default:
  }
});

document.addEventListener('contextmenu', (event) => {
  if (!event.target.closest('input, textarea')) event.preventDefault();
});

on('track', (track) => {
  document.title = `${track.title} · ${track.artistName}`;
});

const themeButton = $('#theme-toggle');
const drawTheme = () => {
  const light = currentTheme() === 'light';
  themeButton.innerHTML = icon(light ? 'sun' : 'moon', 18);
  themeButton.title = light ? 'Cambiar a tema oscuro' : 'Cambiar a tema claro';
  themeButton.setAttribute('aria-label', themeButton.title);
};
themeButton.addEventListener('click', toggleTheme);
on('theme', drawTheme);
initTheme();
drawTheme();
initEq(document.getElementById('audio'));

initSidebar();
initPlayerBar();
initNowPanel();
renderView();
renderScan();

async function start() {
  try {
    await store.init();
  } catch (error) {
    toast(`No se pudo cargar la biblioteca: ${error?.message ?? error}`, 'error');
    return;
  }
  if (store.state.directories.length && !store.state.tracks.length) {
    store.scan().catch((error) => toast(String(error?.message ?? error), 'error'));
  }
}

start();
