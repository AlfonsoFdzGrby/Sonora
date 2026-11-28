import { player, playList } from './player.js';
import { showAddToPlaylist, removeTrackAt, enqueueTracks, playNextTracks } from './actions.js';
import { showMenu } from './overlays.js';
import { state } from './store.js';
import { esc, fmtTime, on, plural } from './util.js';
import { icon, coverHtml, bindCoverFallback } from './visual.js';
import { enableDrag } from './dragdrop.js';
import { isSelected, selectionSize, selectedTracks, selectTracks, deselectTracks, toggleTrack, clearSelection } from './selection.js';

const ROW_HEIGHT = 56;
const OVERSCAN = 8;

export function trackList({ tracks, scroller, columns = {}, playlist = null, sortable = false, onSort = null }) {
  const root = document.createElement('div');
  root.className = 'tracklist';
  const showAlbum = columns.album !== false;
  const showArtist = columns.artist !== false;
  const showIndex = columns.index === true;
  const showCover = columns.cover !== false;
  root.classList.toggle('no-album', !showAlbum);

  const sortHeader = (key, label) => {
    const active = state.sort.key === key;
    const arrow = active ? (state.sort.dir > 0 ? '↑' : '↓') : '';
    return sortable
      ? `<button class="th${active ? ' active' : ''}" data-sort="${key}">${label}<span class="arrow">${arrow}</span></button>`
      : `<span class="th">${label}</span>`;
  };

  root.innerHTML = `
    <div class="tl-head">
      <span class="c-num">${showIndex ? '<span class="th-num">#</span>' : ''}<button class="icon-btn sm tl-pick" data-select-all title="Seleccionar todas" aria-label="Seleccionar todas">${icon('square', 16)}</button></span>
      ${sortHeader('title', 'Título')}
      ${showAlbum ? sortHeader('album', 'Álbum') : ''}
      ${sortHeader('duration', icon('clock', 14))}
      <span class="c-act"></span>
    </div>
    <div class="tl-body"><div class="tl-spacer"></div><div class="tl-rows"></div></div>`;

  const spacer = root.querySelector('.tl-spacer');
  const rows = root.querySelector('.tl-rows');
  spacer.style.height = `${tracks.length * ROW_HEIGHT}px`;

  let first = -1;
  let last = -1;

  const selectable = tracks.map((track, index) => (track.missing ? -1 : index)).filter((index) => index >= 0);
  let anchor = -1;

  function rowHtml(track, index) {
    const current = player.current && player.current.path === track.path;
    const classes = ['row'];
    if (current) classes.push('current');
    if (current && player.playing) classes.push('playing');
    if (track.missing) classes.push('missing');
    const check = `<button class="row-check" data-select${track.missing ? ' disabled' : ''} title="Seleccionar canción" aria-pressed="false">${icon('check', 13)}</button>`;
    const lead = showIndex
      ? `<span class="c-num"><span class="num">${index + 1}</span><span class="eq" aria-hidden="true"><i></i><i></i><i></i></span><span class="pl">${icon('play', 14)}</span>${check}</span>`
      : `<span class="c-num"><span class="eq" aria-hidden="true"><i></i><i></i><i></i></span><span class="pl">${icon('play', 14)}</span>${check}</span>`;
    const art = showCover ? coverHtml(track.coverUrl, track.albumName || track.title, 'sm', 16) : '';
    const sub = showArtist ? esc(track.artistName) : '';
    return `
      <div class="${classes.join(' ')}" data-index="${index}" style="top:${index * ROW_HEIGHT}px">
        ${lead}
        <span class="c-title">${art}<span class="titles"><span class="t">${esc(track.title)}</span><span class="s">${sub}</span></span></span>
        ${showAlbum ? `<span class="c-album">${esc(track.albumName)}</span>` : ''}
        <span class="c-dur">${track.missing ? '—' : fmtTime(track.durationMs / 1000)}</span>
        <span class="c-act"><button class="icon-btn sm" data-more title="Más opciones">${icon('more', 18)}</button></span>
      </div>`;
  }

  const selectableTracks = () => selectable.map((index) => tracks[index]);

  // Pinta el estado de selección de esta lista. La selección en sí es global
  // (ver selection.js) y no se pierde al filtrar o cambiar de vista.
  function paintSelection() {
    const all = selectable.length > 0 && selectable.every((index) => isSelected(tracks[index]));
    const pick = root.querySelector('[data-select-all]');
    pick.innerHTML = icon(all ? 'check-square' : 'square', 16);
    pick.title = all ? 'Quitar selección' : 'Seleccionar todas';
    pick.setAttribute('aria-label', pick.title);
    root.classList.toggle('selecting', selectionSize() > 0);
    rows.querySelectorAll('.row').forEach((row) => {
      const on = isSelected(tracks[Number(row.dataset.index)]);
      row.classList.toggle('selected', on);
      row.querySelector('[data-select]')?.setAttribute('aria-pressed', String(on));
    });
  }

  function toggleSelect(index) {
    if (index < 0 || tracks[index]?.missing) return;
    anchor = index;
    toggleTrack(tracks[index]);
  }

  function rangeSelect(index) {
    if (index < 0 || tracks[index]?.missing) return;
    if (anchor < 0) anchor = index;
    const from = Math.min(anchor, index);
    const to = Math.max(anchor, index);
    selectTracks(tracks.slice(from, to + 1));
  }

  // Marca (o desmarca) todas las canciones visibles en esta lista sin tocar
  // lo que ya estaba seleccionado en otras vistas o antes de filtrar.
  function toggleAll() {
    const all = selectable.length > 0 && selectable.every((index) => isSelected(tracks[index]));
    if (all) deselectTracks(selectableTracks());
    else selectTracks(selectableTracks());
    anchor = -1;
  }

  // Acciones sobre una sola canción: no deben vaciar la selección global.
  const single = (action) => () => action();

  function render(force = false) {
    const top = Math.max(0, scroller.scrollTop - root.offsetTop);
    const height = scroller.clientHeight || 600;
    const from = Math.max(0, Math.floor(top / ROW_HEIGHT) - OVERSCAN);
    const to = Math.min(tracks.length - 1, Math.ceil((top + height) / ROW_HEIGHT) + OVERSCAN);
    if (!force && from === first && to === last) return;
    first = from;
    last = to;
    let html = '';
    for (let i = from; i <= to; i++) html += rowHtml(tracks[i], i);
    rows.innerHTML = html;
    bindCoverFallback(rows);
    paintSelection();
  }

  function paintCurrent() {
    rows.querySelectorAll('.row').forEach((row) => {
      const track = tracks[Number(row.dataset.index)];
      const current = !!track && !!player.current && player.current.path === track.path;
      row.classList.toggle('current', current);
      row.classList.toggle('playing', current && player.playing);
    });
  }

  const indexOfEvent = (event) => {
    const row = event.target.closest('.row');
    return row ? Number(row.dataset.index) : -1;
  };

  function openMenu(x, y, index) {
    const chosen = isSelected(tracks[index]) && selectionSize() > 1 ? selectedTracks() : [];
    if (chosen.length) {
      showMenu(x, y, [
        { header: `${plural(chosen.length, 'canción', 'canciones')} seleccionadas` },
        { label: 'Reproducir', icon: 'play', onSelect: () => { clearSelection(); playList(chosen, 0); } },
        { label: 'Agregar a la fila', icon: 'plus', onSelect: () => { clearSelection(); enqueueTracks(chosen); } },
        {
          label: 'Agregar a playlist…',
          icon: 'plus',
          onSelect: () => showAddToPlaylist(x, y, chosen.map((track) => track.path), clearSelection),
        },
        { separator: true },
        { label: 'Cancelar selección', icon: 'x', onSelect: clearSelection },
      ]);
      return;
    }
    const track = tracks[index];
    if (!track || track.missing) {
      if (playlist && track) {
        showMenu(x, y, [
          { label: 'Quitar de la playlist', icon: 'trash', danger: true, onSelect: single(() => removeTrackAt(playlist, index)) },
        ]);
      }
      return;
    }
    const items = [
      {
        label: isSelected(track) ? 'Deseleccionar' : 'Seleccionar',
        icon: 'check-square',
        onSelect: () => toggleSelect(index),
      },
      { separator: true },
      { label: 'Reproducir', icon: 'play', onSelect: single(() => playList(tracks, index)) },
      { label: 'Reproducir a continuación', icon: 'queue', onSelect: single(() => playNextTracks([track])) },
      { label: 'Agregar a la fila', icon: 'plus', onSelect: single(() => enqueueTracks([track])) },
      {
        label: 'Agregar a playlist…',
        icon: 'plus',
        onSelect: () => showAddToPlaylist(x, y, [track.path]),
      },
    ];
    if (playlist) {
      items.push({ separator: true });
      items.push({
        label: 'Quitar de la playlist',
        icon: 'trash',
        danger: true,
        onSelect: single(() => removeTrackAt(playlist, index)),
      });
    }
    showMenu(x, y, items);
  }

  enableDrag(root, (target) => {
    const row = target.closest('.row');
    const track = row ? tracks[Number(row.dataset.index)] : null;
    if (!track || track.missing) return null;
    const dragging = isSelected(track) && selectionSize() > 1 ? selectedTracks() : [track];
    return {
      tracks: dragging,
      mark: row,
      label: {
        title: dragging.length > 1 ? `${plural(dragging.length, 'canción', 'canciones')} seleccionadas` : track.title,
        subtitle: dragging.length > 1 ? 'Arrastrando selección' : track.artistName,
        meta: dragging.length > 1 ? '' : fmtTime(track.durationMs / 1000),
        coverUrl: track.coverUrl,
        seed: track.albumName || track.title,
      },
    };
  });

  root.addEventListener('click', (event) => {
    const sort = event.target.closest('[data-sort]');
    if (sort && onSort) {
      onSort(sort.dataset.sort);
      return;
    }
    if (event.target.closest('[data-select-all]')) {
      toggleAll();
      return;
    }
    const check = event.target.closest('[data-select]');
    if (check) {
      const row = check.closest('.row');
      if (row) toggleSelect(Number(row.dataset.index));
      return;
    }
    const index = indexOfEvent(event);
    if (index < 0) return;
    if (event.target.closest('[data-more]')) {
      const rect = event.target.closest('[data-more]').getBoundingClientRect();
      openMenu(rect.left - 160, rect.bottom + 4, index);
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      toggleSelect(index);
      return;
    }
    if (event.shiftKey) {
      rangeSelect(index);
      return;
    }
    if (root.classList.contains('selecting')) {
      toggleSelect(index);
      return;
    }
    if (!tracks[index].missing) playList(tracks, index);
  });

  root.addEventListener('contextmenu', (event) => {
    const index = indexOfEvent(event);
    if (index < 0) return;
    event.preventDefault();
    openMenu(event.clientX, event.clientY, index);
  });

  let frame = 0;
  const onScroll = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      render();
    });
  };
  scroller.addEventListener('scroll', onScroll, { passive: true });
  const resizeObserver = new ResizeObserver(() => render(true));
  resizeObserver.observe(scroller);
  const offs = [on('track', paintCurrent), on('playstate', paintCurrent), on('selection', paintSelection)];

  const onKey = (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'a') return;
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
    if (document.querySelector('.overlay')) return;
    event.preventDefault();
    toggleAll();
  };
  document.addEventListener('keydown', onKey);

  render(true);

  return {
    el: root,
    destroy() {
      document.removeEventListener('keydown', onKey);
      scroller.removeEventListener('scroll', onScroll);
      resizeObserver.disconnect();
      offs.forEach((off) => off());
    },
  };
}
