import { player, playList } from './player.js';
import { showAddToPlaylist, removeTrackAt, enqueueTracks, playNextTracks } from './actions.js';
import { showMenu } from './overlays.js';
import { state } from './store.js';
import { esc, fmtTime, on } from './util.js';
import { icon, coverHtml, bindCoverFallback } from './visual.js';

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
      <span class="c-num">${showIndex ? '#' : ''}</span>
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

  function rowHtml(track, index) {
    const current = player.current && player.current.path === track.path;
    const classes = ['row'];
    if (current) classes.push('current');
    if (current && player.playing) classes.push('playing');
    if (track.missing) classes.push('missing');
    const lead = showIndex
      ? `<span class="c-num"><span class="num">${index + 1}</span><span class="eq" aria-hidden="true"><i></i><i></i><i></i></span><span class="pl">${icon('play', 14)}</span></span>`
      : `<span class="c-num"><span class="eq" aria-hidden="true"><i></i><i></i><i></i></span><span class="pl">${icon('play', 14)}</span></span>`;
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
    const track = tracks[index];
    if (!track || track.missing) {
      if (playlist && track) {
        showMenu(x, y, [{ label: 'Quitar de la playlist', icon: 'trash', danger: true, onSelect: () => removeTrackAt(playlist, index) }]);
      }
      return;
    }
    const items = [
      { label: 'Reproducir', icon: 'play', onSelect: () => playList(tracks, index) },
      { label: 'Reproducir a continuación', icon: 'queue', onSelect: () => playNextTracks([track]) },
      { label: 'Agregar a la fila', icon: 'plus', onSelect: () => enqueueTracks([track]) },
      { label: 'Agregar a playlist…', icon: 'plus', onSelect: () => showAddToPlaylist(x, y, [track.path]) },
    ];
    if (playlist) {
      items.push({ separator: true });
      items.push({ label: 'Quitar de la playlist', icon: 'trash', danger: true, onSelect: () => removeTrackAt(playlist, index) });
    }
    showMenu(x, y, items);
  }

  root.addEventListener('click', (event) => {
    const sort = event.target.closest('[data-sort]');
    if (sort && onSort) {
      onSort(sort.dataset.sort);
      return;
    }
    const index = indexOfEvent(event);
    if (index < 0) return;
    if (event.target.closest('[data-more]')) {
      const rect = event.target.closest('[data-more]').getBoundingClientRect();
      openMenu(rect.left - 160, rect.bottom + 4, index);
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
  const offs = [on('track', paintCurrent), on('playstate', paintCurrent)];

  render(true);

  return {
    el: root,
    destroy() {
      scroller.removeEventListener('scroll', onScroll);
      resizeObserver.disconnect();
      offs.forEach((off) => off());
    },
  };
}
