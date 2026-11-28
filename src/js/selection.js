// Selección global de canciones.
//
// La selección vive fuera de las listas: se indexa por ruta de archivo (no por
// posición) y sobrevive a filtros, búsquedas, ordenamientos y cambios de vista
// (Canciones, Álbumes, Artistas, Playlists...). Así se pueden juntar canciones
// de distintos menús y actuar sobre todas a la vez.

import { playList } from './player.js';
import { showAddToPlaylist, enqueueTracks } from './actions.js';
import { state } from './store.js';
import { emit, on, plural } from './util.js';
import { icon } from './visual.js';

// ruta -> canción. Un Map conserva el orden en que se fueron seleccionando.
const picked = new Map();

let bar = null;

const selectable = (track) => !!track && !track.missing;

export const selectionSize = () => picked.size;
export const isSelected = (track) => !!track && picked.has(track.path);
export const selectedTracks = () => [...picked.values()];

function notify() {
  paintBar();
  emit('selection', picked.size);
}

export function selectTracks(tracks) {
  let changed = false;
  for (const track of tracks) {
    if (!selectable(track) || picked.has(track.path)) continue;
    picked.set(track.path, track);
    changed = true;
  }
  if (changed) notify();
}

export function deselectTracks(tracks) {
  let changed = false;
  for (const track of tracks) {
    if (track && picked.delete(track.path)) changed = true;
  }
  if (changed) notify();
}

export function toggleTrack(track) {
  if (!selectable(track)) return;
  if (picked.has(track.path)) picked.delete(track.path);
  else picked.set(track.path, track);
  notify();
}

export function clearSelection() {
  if (!picked.size) return;
  picked.clear();
  notify();
}

// Útil tras soltar un arrastre: si lo arrastrado era la selección, se limpia.
export function clearSelectionIfIncludes(tracks) {
  if (tracks.length && tracks.every((track) => picked.has(track.path))) clearSelection();
}

// Si la biblioteca se vuelve a leer, los objetos de canción cambian: se
// reenlazan por ruta y se descartan los archivos que ya no existen.
function syncWithLibrary() {
  if (!picked.size) return;
  let changed = false;
  for (const [path] of [...picked]) {
    const fresh = state.byPath.get(path);
    if (fresh) picked.set(path, fresh);
    else {
      picked.delete(path);
      changed = true;
    }
  }
  if (changed) notify();
}

function ensureBar() {
  if (bar) return bar;
  bar = document.createElement('div');
  bar.className = 'selection-bar';
  bar.setAttribute('role', 'toolbar');
  bar.innerHTML = `
    <span class="sb-count"></span>
    <button class="btn sm" data-bar-play>${icon('play', 15)}Reproducir</button>
    <button class="btn sm" data-bar-queue>${icon('queue', 15)}A la fila</button>
    <button class="btn sm primary" data-bar-pl>${icon('plus', 15)}A playlist…</button>
    <button class="icon-btn sm" data-bar-clear title="Cancelar selección" aria-label="Cancelar selección">${icon('x', 16)}</button>`;
  document.body.append(bar);

  bar.addEventListener('click', (event) => {
    const chosen = selectedTracks();
    if (event.target.closest('[data-bar-clear]')) {
      clearSelection();
      return;
    }
    if (!chosen.length) return;
    if (event.target.closest('[data-bar-play]')) {
      clearSelection();
      playList(chosen, 0);
      return;
    }
    if (event.target.closest('[data-bar-queue]')) {
      clearSelection();
      enqueueTracks(chosen);
      return;
    }
    const toPlaylist = event.target.closest('[data-bar-pl]');
    if (toPlaylist) {
      const rect = toPlaylist.getBoundingClientRect();
      showAddToPlaylist(rect.left, rect.top - 8, chosen.map((track) => track.path), clearSelection);
    }
  });
  return bar;
}

function paintBar() {
  const active = picked.size > 0;
  if (!active && !bar) return;
  const el = ensureBar();
  el.classList.toggle('show', active);
  document.body.style.setProperty('--toast-offset', active ? `${el.offsetHeight + 8}px` : '0px');
  el.querySelector('.sb-count').textContent = plural(picked.size, 'canción', 'canciones');
}

export function initSelection() {
  on('library', syncWithLibrary);
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !picked.size) return;
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
    if (document.querySelector('.overlay')) return;
    clearSelection();
  });
}
