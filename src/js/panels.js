import { player, togglePlay, next, prev, seek, setVolume, toggleMute, toggleShuffle, cycleRepeat } from './player.js';
import { state, navigate, artistKeyFor } from './store.js';
import { showPlaylistMenu, showNewPlaylistMenu, showAddToPlaylist, insertTracks, enqueueTracks } from './actions.js';
import { $, $$, esc, fmtTime, on, plural, storage } from './util.js';
import { icon, coverHtml, bindCoverFallback } from './visual.js';
import { queueList } from './queue.js';
import { registerDropTarget } from './dragdrop.js';
import { openEqualizer } from './eq-ui.js';
import { clearTrackSelection } from './tracklist.js';

function fillRange(input) {
  const max = Number(input.max) || 1;
  input.style.setProperty('--fill', `${(Number(input.value) / max) * 100}%`);
}

export function initPlayerBar() {
  const root = $('#player');
  root.innerHTML = `
    <div class="pb-track" id="pb-track"></div>
    <div class="pb-center">
      <div class="pb-buttons">
        <button class="icon-btn toggle" id="b-shuffle" title="Aleatorio">${icon('shuffle', 18)}</button>
        <button class="icon-btn" id="b-prev" title="Anterior">${icon('skip-back', 20)}</button>
        <button class="play-btn" id="b-play" title="Reproducir / Pausa"></button>
        <button class="icon-btn" id="b-next" title="Siguiente">${icon('skip-forward', 20)}</button>
        <button class="icon-btn toggle" id="b-repeat" title="Repetir"></button>
      </div>
      <div class="pb-seek">
        <span class="time" id="t-cur">0:00</span>
        <input type="range" class="range" id="seek" min="0" max="1000" value="0" step="1" aria-label="Posición">
        <span class="time" id="t-dur">0:00</span>
      </div>
    </div>
    <div class="pb-right">
      <button class="icon-btn" id="b-mute" title="Silenciar"></button>
      <input type="range" class="range vol" id="volume" min="0" max="100" value="80" aria-label="Volumen" title="Volumen (también con la rueda del ratón)">
      <button class="icon-btn" id="b-eq" title="Ecualizador">${icon('sliders', 18)}</button>
      <button class="icon-btn toggle" id="b-panel" title="Mostrar u ocultar panel">${icon('panel', 18)}</button>
    </div>`;

  const seekInput = $('#seek');
  const volume = $('#volume');
  let dragging = false;
  let lastDuration = 0;

  const drawTrack = () => {
    const track = player.current;
    const box = $('#pb-track');
    if (!track) {
      box.innerHTML = '<span class="pb-idle">Nada en reproducción</span>';
      return;
    }
    box.innerHTML = `
      ${coverHtml(track.coverUrl, track.albumName || track.title, 'md', 20)}
      <div class="titles">
        <button class="t link-plain" data-open-now>${esc(track.title)}</button>
        <span class="s">${esc(track.artistName)}</span>
      </div>`;
    bindCoverFallback(box);
  };

  const drawModes = () => {
    $('#b-shuffle').classList.toggle('on', player.shuffle);
    const repeat = $('#b-repeat');
    repeat.innerHTML = icon(player.repeat === 'one' ? 'repeat-one' : 'repeat', 18);
    repeat.classList.toggle('on', player.repeat !== 'off');
    repeat.title = { off: 'Repetir: desactivado', all: 'Repetir todo', one: 'Repetir canción' }[player.repeat];
    const level = player.muted || player.volume === 0 ? 'volume-x' : player.volume < 0.5 ? 'volume-1' : 'volume-2';
    $('#b-mute').innerHTML = icon(level, 18);
    volume.value = player.muted ? 0 : Math.round(player.volume * 100);
    fillRange(volume);
  };

  const drawPlay = () => {
    $('#b-play').innerHTML = icon(player.playing ? 'pause' : 'play', 22);
  };

  const drawTime = ({ current, duration }) => {
    lastDuration = duration;
    $('#t-dur').textContent = fmtTime(duration);
    if (dragging) return;
    $('#t-cur').textContent = fmtTime(current);
    seekInput.value = duration > 0 ? Math.round((current / duration) * 1000) : 0;
    fillRange(seekInput);
  };

  seekInput.addEventListener('pointerdown', () => (dragging = true));
  seekInput.addEventListener('input', () => {
    fillRange(seekInput);
    $('#t-cur').textContent = fmtTime((Number(seekInput.value) / 1000) * lastDuration);
  });
  seekInput.addEventListener('change', () => {
    seek((Number(seekInput.value) / 1000) * lastDuration);
    dragging = false;
  });
  seekInput.addEventListener('pointerup', () => (dragging = false));

  volume.addEventListener('input', () => setVolume(Number(volume.value) / 100));
  volume.addEventListener('wheel', (event) => {
    event.preventDefault();
    const direction = Math.sign(event.deltaY);
    if (!direction) return;
    setVolume(player.volume - direction * 0.05);
  }, { passive: false });
  $('#b-mute').addEventListener('click', toggleMute);
  $('#b-play').addEventListener('click', togglePlay);
  $('#b-next').addEventListener('click', next);
  $('#b-prev').addEventListener('click', prev);
  $('#b-shuffle').addEventListener('click', toggleShuffle);
  $('#b-repeat').addEventListener('click', cycleRepeat);
  $('#b-eq').addEventListener('click', openEqualizer);
  $('#b-panel').addEventListener('click', () => toggleNowPanel());
  $('#pb-track').addEventListener('click', (event) => {
    if (event.target.closest('[data-open-now]')) toggleNowPanel(true);
  });

  on('track', drawTrack);
  on('playstate', drawPlay);
  on('modes', drawModes);
  on('time', drawTime);
  drawTrack();
  drawPlay();
  drawModes();
  fillRange(seekInput);
}

const app = $('#app');
let panelOpen = storage.get('panel', true);

export function toggleNowPanel(force) {
  panelOpen = typeof force === 'boolean' ? force : !panelOpen;
  storage.set('panel', panelOpen);
  app.classList.toggle('panel-hidden', !panelOpen);
  $('#b-panel')?.classList.toggle('on', panelOpen);
}

function row(label, value) {
  return value ? `<div class="kv"><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>` : '';
}

function bitrateText(track) {
  return track.bitrate ? `${track.bitrate} kbps` : '';
}

function formatText(track) {
  const parts = [track.format];
  if (track.sampleRate) parts.push(`${(track.sampleRate / 1000).toFixed(track.sampleRate % 1000 ? 1 : 0)} kHz`);
  if (track.bitDepth) parts.push(`${track.bitDepth} bits`);
  if (track.channels) parts.push(track.channels === 1 ? 'Mono' : track.channels === 2 ? 'Estéreo' : `${track.channels} canales`);
  return parts.filter(Boolean).join(' · ');
}

function sizeText(bytes) {
  if (!bytes) return '';
  return bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

export function initNowPanel() {
  const root = $('#now-panel');
  let list = null;
  let tab = storage.get('nptab', 'queue');

  const detailsHtml = (track) => `
    <dl class="tags">
      ${row('Título', track.title)}
      ${row('Artista', track.artist)}
      ${row('Álbum', track.album)}
      ${row('Artista del álbum', track.albumArtist)}
      ${row('Género', track.genre)}
      ${row('Año', track.year ? String(track.year) : '')}
      ${row('Pista', track.trackNo ? String(track.trackNo) : '')}
      ${row('Disco', track.discNo ? String(track.discNo) : '')}
      ${row('Duración', fmtTime(track.durationMs / 1000))}
      ${row('Formato', formatText(track))}
      ${row('Bitrate', bitrateText(track))}
      ${row('Tamaño', sizeText(track.size))}
      ${row('Archivo', track.path.split(/[\\/]/).pop())}
    </dl>
    <button class="btn block" data-add-pl>${icon('plus', 16)}Agregar a playlist</button>`;

  const drawBar = () => {
    const bar = $('.np-qbar', root);
    if (!bar) return;
    bar.innerHTML = `<span>${plural(player.queue.length, 'canción', 'canciones')} en la fila</span><button class="link dim" data-open-queue>Ver fila completa</button>`;
  };

  function drawBody() {
    list?.destroy();
    list = null;
    const scroll = $('.np-scroll', root);
    const bar = $('.np-qbar', root);
    if (!scroll || !player.current) return;
    $$('.np-tab', root).forEach((button) => button.classList.toggle('active', button.dataset.tab === tab));
    scroll.scrollTop = 0;
    if (tab === 'queue') {
      bar.hidden = false;
      scroll.className = 'np-scroll queue';
      scroll.innerHTML = '';
      drawBar();
      list = queueList({ scroller: scroll, compact: true });
      scroll.append(list.el);
      list.reveal();
    } else {
      bar.hidden = true;
      scroll.className = 'np-scroll';
      scroll.innerHTML = detailsHtml(player.current);
    }
  }

  function draw() {
    list?.destroy();
    list = null;
    const track = player.current;
    if (!track) {
      root.innerHTML = `
        <div class="np-empty">
          <div class="np-art">${coverHtml(null, 'sonora', 'np', 56)}</div>
          <h3>Nada en reproducción</h3>
          <p>Elige una canción para ver su portada, su fila y sus etiquetas aquí.</p>
        </div>`;
      return;
    }
    const artistKey = artistKeyFor(track.artist);
    root.innerHTML = `
      <div class="np-top">
        <div class="np-art ${player.playing ? 'live' : ''}">${coverHtml(track.coverUrl, track.albumName || track.title, 'np', 56)}</div>
        <div class="np-head">
          <h3>${esc(track.title)}</h3>
          ${artistKey ? `<button class="link" data-go-artist="${esc(artistKey)}">${esc(track.artistName)}</button>` : `<span class="muted">${esc(track.artistName)}</span>`}
          ${track.albumKey && track.album ? `<button class="link dim" data-go-album="${esc(track.albumKey)}">${esc(track.albumName)}</button>` : ''}
        </div>
      </div>
      <div class="np-tabs" role="tablist">
        <button class="np-tab" role="tab" data-tab="queue">Fila</button>
        <button class="np-tab" role="tab" data-tab="details">Detalles</button>
      </div>
      <div class="np-qbar"></div>
      <div class="np-scroll"></div>`;
    bindCoverFallback(root);
    drawBody();
  }

  root.addEventListener('click', (event) => {
    const artist = event.target.closest('[data-go-artist]');
    if (artist) navigate('artist', artist.dataset.goArtist);
    const album = event.target.closest('[data-go-album]');
    if (album) navigate('album', album.dataset.goAlbum);
    const tabButton = event.target.closest('[data-tab]');
    if (tabButton && tabButton.dataset.tab !== tab) {
      tab = tabButton.dataset.tab;
      storage.set('nptab', tab);
      drawBody();
    }
    if (event.target.closest('[data-open-queue]')) navigate('queue');
    const add = event.target.closest('[data-add-pl]');
    if (add && player.current) {
      const rect = add.getBoundingClientRect();
      showAddToPlaylist(rect.left, rect.top - 8, [player.current.path]);
    }
  });

  registerDropTarget({
    el: root,
    accepts: () => !player.current || list !== null,
    over(x, y) {
      if (list) {
        root.classList.remove('drop-hint');
        list.dropOver(y);
      } else {
        root.classList.add('drop-hint');
      }
    },
    leave() {
      root.classList.remove('drop-hint');
      list?.dropLeave();
    },
    drop(x, y, tracks) {
      const index = list ? list.dropIndex() : -1;
      clearTrackSelection();
      if (index >= 0) insertTracks(tracks, index);
      else enqueueTracks(tracks);
    },
  });

  on('track', draw);
  on('library', draw);
  on('queue', drawBar);
  on('playstate', () => $('.np-art', root)?.classList.toggle('live', player.playing));
  draw();
  toggleNowPanel(panelOpen);
}

export function initSidebar() {
  const list = $('#playlist-list');

  const drawNav = () => {
    const active = state.query ? '' : state.nav.name;
    const section = { album: 'albums', artist: 'artists' }[active] ?? active;
    $$('[data-nav]').forEach((button) => button.classList.toggle('active', button.dataset.nav === section));
  };

  const drawPlaylists = () => {
    if (!state.playlists.length) {
      list.innerHTML = '<div class="side-empty">Crea tu primera playlist con el botón +</div>';
      return;
    }
    list.innerHTML = state.playlists
      .map((playlist) => {
        const active = !state.query && state.nav.name === 'playlist' && state.nav.param === playlist.name;
        return `
          <button class="pl-item${active ? ' active' : ''}" data-playlist="${esc(playlist.name)}">
            <span class="pl-ico">${icon('list', 16)}</span>
            <span class="pl-name">${esc(playlist.name)}</span>
            <span class="pl-count">${playlist.paths.length}</span>
          </button>`;
      })
      .join('');
  };

  document.addEventListener('click', (event) => {
    const nav = event.target.closest('[data-nav]');
    if (nav) navigate(nav.dataset.nav);
    const pl = event.target.closest('[data-playlist]');
    if (pl) navigate('playlist', pl.dataset.playlist);
    const newPlaylist = event.target.closest('[data-act="new-playlist"]');
    if (newPlaylist) {
      const rect = newPlaylist.getBoundingClientRect();
      showNewPlaylistMenu(rect.left, rect.bottom + 6);
    }
  });

  list.addEventListener('contextmenu', (event) => {
    const pl = event.target.closest('[data-playlist]');
    if (!pl) return;
    event.preventDefault();
    showPlaylistMenu(event.clientX, event.clientY, pl.dataset.playlist);
  });

  on('nav', () => {
    drawNav();
    drawPlaylists();
  });
  on('playlists', drawPlaylists);
  drawNav();
  drawPlaylists();
}
