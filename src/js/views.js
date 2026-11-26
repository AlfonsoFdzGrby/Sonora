import { player, playList, shuffleList, clearQueue } from './player.js';
import { queueList } from './queue.js';
import { trackList } from './tracklist.js';
import { state, navigate, search, sortTracks, resolvePlaylist, artistKeyFor } from './store.js';
import { chooseDirectory, promptRename, promptDelete, promptNewPlaylist, enqueueTracks, showAddToPlaylist } from './actions.js';
import { $, esc, fmtTotal, norm, plural, debounce, on } from './util.js';
import { icon, coverHtml, bindCoverFallback } from './visual.js';

const html = (markup) => {
  const el = document.createElement('div');
  el.className = 'page';
  el.innerHTML = markup;
  return el;
};

function emptyLibrary() {
  const el = html(`
    <div class="empty">
      <div class="empty-art">${icon('music', 40)}</div>
      <h2>Tu biblioteca está vacía</h2>
      <p>Agrega una carpeta con tu música y Sonora leerá sus etiquetas, portadas y álbumes.</p>
      <button class="btn primary lg" data-add>${icon('folder', 18)}Agregar carpeta de música</button>
    </div>`);
  $('[data-add]', el).addEventListener('click', chooseDirectory);
  return { el };
}

function emptyMessage(title, text) {
  return { el: html(`<div class="empty"><h2>${esc(title)}</h2><p>${esc(text)}</p></div>`) };
}

function pageHead({ kicker, title, meta, actions = '' }) {
  return `
    <div class="page-head">
      <div class="ph-text">
        <span class="kicker">${esc(kicker)}</span>
        <h1>${esc(title)}</h1>
        <span class="meta">${esc(meta)}</span>
      </div>
      <div class="ph-actions">${actions}</div>
    </div>`;
}

const playButtons = `
  <button class="btn primary" data-play>${icon('play', 16)}Reproducir</button>
  <button class="btn" data-shuffle>${icon('shuffle', 16)}Aleatorio</button>
  <button class="btn" data-enqueue>${icon('queue', 16)}A la fila</button>`;

const collectionButtons = `${playButtons}
  <button class="btn" data-add-pl>${icon('plus', 16)}A playlist</button>`;

function bindAddToPlaylist(el, tracks) {
  $('[data-add-pl]', el)?.addEventListener('click', (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    showAddToPlaylist(rect.left, rect.bottom + 6, tracks.map((track) => track.path));
  });
}

function bindPlay(el, tracks) {
  $('[data-play]', el)?.addEventListener('click', () => playList(tracks, 0));
  $('[data-shuffle]', el)?.addEventListener('click', () => shuffleList(tracks));
  $('[data-enqueue]', el)?.addEventListener('click', () => enqueueTracks(tracks));
}

function songsView(scroller) {
  if (!state.tracks.length) return state.scan.active ? emptyMessage('Escaneando…', 'Leyendo tu música.') : emptyLibrary();

  const el = html(`
    ${pageHead({
      kicker: 'Biblioteca',
      title: 'Canciones',
      meta: '',
      actions: playButtons,
    })}
    <label class="filter">
      <span>${icon('search', 15)}</span>
      <input type="search" placeholder="Filtrar canciones" value="${esc(state.filter)}" autocomplete="off" spellcheck="false">
    </label>
    <div class="list-host"></div>`);

  const host = $('.list-host', el);
  const meta = $('.meta', el);
  const input = $('.filter input', el);
  let list = null;
  let current = [];

  const draw = () => {
    list?.destroy();
    const tokens = norm(state.filter).split(/\s+/).filter(Boolean);
    const base = tokens.length ? state.tracks.filter((t) => tokens.every((token) => t.search.includes(token))) : state.tracks;
    current = sortTracks(base, state.sort.key, state.sort.dir);
    const total = current.reduce((sum, t) => sum + t.durationMs, 0);
    meta.textContent = tokens.length
      ? `${plural(current.length, 'resultado', 'resultados')} de ${state.tracks.length.toLocaleString('es')}`
      : `${plural(current.length, 'canción', 'canciones')} · ${fmtTotal(total)}`;
    host.innerHTML = '';
    if (!current.length) {
      host.innerHTML = '<div class="empty small"><p>Ninguna canción coincide con el filtro.</p></div>';
      return;
    }
    list = trackList({
      tracks: current,
      scroller,
      sortable: true,
      onSort: (key) => {
        state.sort = state.sort.key === key ? { key, dir: -state.sort.dir } : { key, dir: 1 };
        draw();
      },
    });
    host.append(list.el);
  };

  input.addEventListener('input', debounce(() => {
    state.filter = input.value;
    scroller.scrollTop = 0;
    draw();
  }, 120));
  $('[data-play]', el).addEventListener('click', () => playList(current, 0));
  $('[data-shuffle]', el).addEventListener('click', () => shuffleList(current));
  $('[data-enqueue]', el).addEventListener('click', () => enqueueTracks(current));

  draw();
  return { el, destroy: () => list?.destroy() };
}

function albumCard(album) {
  return `
    <button class="card" data-album="${esc(album.key)}">
      ${coverHtml(album.coverUrl, album.title, 'sq', 44)}
      <span class="card-title">${esc(album.title)}</span>
      <span class="card-sub">${esc(album.artist)}${album.year ? ` · ${album.year}` : ''}</span>
    </button>`;
}

function albumsView() {
  if (!state.albums.length) return emptyLibrary();
  const el = html(`
    ${pageHead({ kicker: 'Biblioteca', title: 'Álbumes', meta: plural(state.albums.length, 'álbum', 'álbumes') })}
    <div class="grid">${state.albums.map(albumCard).join('')}</div>`);
  bindCoverFallback(el);
  el.addEventListener('click', (event) => {
    const card = event.target.closest('[data-album]');
    if (card) navigate('album', card.dataset.album);
  });
  return { el };
}

function artistsView() {
  if (!state.artists.length) return emptyLibrary();
  const cards = state.artists
    .map(
      (artist) => `
      <button class="card artist" data-artist="${esc(artist.key)}">
        ${coverHtml(artist.coverUrl, artist.name, 'round', 44)}
        <span class="card-title">${esc(artist.name)}</span>
        <span class="card-sub">${plural(artist.albums.length, 'álbum', 'álbumes')} · ${plural(artist.tracks.length, 'canción', 'canciones')}</span>
      </button>`,
    )
    .join('');
  const el = html(`
    ${pageHead({ kicker: 'Biblioteca', title: 'Artistas', meta: plural(state.artists.length, 'artista', 'artistas') })}
    <div class="grid">${cards}</div>`);
  bindCoverFallback(el);
  el.addEventListener('click', (event) => {
    const card = event.target.closest('[data-artist]');
    if (card) navigate('artist', card.dataset.artist);
  });
  return { el };
}

function albumView(scroller, key) {
  const album = state.albumsByKey.get(key);
  if (!album) return emptyMessage('Álbum no encontrado', 'Es posible que ya no esté en tu biblioteca.');
  const artistKey = artistKeyFor(album.artist);
  const el = html(`
    <div class="detail-head">
      ${coverHtml(album.coverUrl, album.title, 'xl', 64)}
      <div class="dh-text">
        <span class="kicker">Álbum</span>
        <h1>${esc(album.title)}</h1>
        <span class="meta">${artistKey ? `<button class="link" data-artist="${esc(artistKey)}">${esc(album.artist)}</button>` : esc(album.artist)}${album.year ? ` · ${album.year}` : ''} · ${plural(album.tracks.length, 'canción', 'canciones')} · ${fmtTotal(album.durationMs)}</span>
        <div class="ph-actions">${collectionButtons}</div>
      </div>
    </div>
    <div class="list-host"></div>`);
  bindCoverFallback(el);
  bindPlay(el, album.tracks);
  bindAddToPlaylist(el, album.tracks);
  $('[data-artist]', el)?.addEventListener('click', (event) => navigate('artist', event.currentTarget.dataset.artist));
  const list = trackList({ tracks: album.tracks, scroller, columns: { album: false, artist: album.artist === 'Varios artistas', index: true, cover: false } });
  $('.list-host', el).append(list.el);
  return { el, destroy: list.destroy };
}

function artistView(scroller, key) {
  const artist = state.artistsByKey.get(key);
  if (!artist) return emptyMessage('Artista no encontrado', 'Es posible que ya no esté en tu biblioteca.');
  const el = html(`
    <div class="detail-head">
      ${coverHtml(artist.coverUrl, artist.name, 'xl round', 64)}
      <div class="dh-text">
        <span class="kicker">Artista</span>
        <h1>${esc(artist.name)}</h1>
        <span class="meta">${plural(artist.albums.length, 'álbum', 'álbumes')} · ${plural(artist.tracks.length, 'canción', 'canciones')} · ${fmtTotal(artist.durationMs)}</span>
        <div class="ph-actions">${collectionButtons}</div>
      </div>
    </div>
    <h3 class="section">Álbumes</h3>
    <div class="grid compact">${artist.albums.map(albumCard).join('')}</div>
    <h3 class="section">Canciones</h3>
    <div class="list-host"></div>`);
  bindCoverFallback(el);
  bindPlay(el, artist.tracks);
  bindAddToPlaylist(el, artist.tracks);
  el.addEventListener('click', (event) => {
    const card = event.target.closest('[data-album]');
    if (card) navigate('album', card.dataset.album);
  });
  const list = trackList({ tracks: artist.tracks, scroller });
  $('.list-host', el).append(list.el);
  return { el, destroy: list.destroy };
}

function playlistView(scroller, name) {
  const playlist = state.playlists.find((p) => p.name === name);
  if (!playlist) return emptyMessage('Playlist no encontrada', 'Es posible que haya sido eliminada.');
  const tracks = resolvePlaylist(playlist);
  const available = tracks.filter((t) => !t.missing);
  const total = available.reduce((sum, t) => sum + t.durationMs, 0);
  const missing = tracks.length - available.length;
  const el = html(`
    ${pageHead({
      kicker: 'Playlist',
      title: playlist.name,
      meta: `${plural(tracks.length, 'canción', 'canciones')}${tracks.length ? ` · ${fmtTotal(total)}` : ''}${missing ? ` · ${missing} no disponible${missing > 1 ? 's' : ''}` : ''}`,
      actions: `${tracks.length ? playButtons : ''}
        <button class="btn" data-rename>${icon('edit', 16)}Renombrar</button>
        <button class="btn danger-ghost" data-delete>${icon('trash', 16)}Eliminar</button>`,
    })}
    <div class="list-host"></div>`);
  bindPlay(el, tracks);
  $('[data-rename]', el).addEventListener('click', () => promptRename(name));
  $('[data-delete]', el).addEventListener('click', () => promptDelete(name));
  if (!tracks.length) {
    $('.list-host', el).innerHTML = `
      <div class="empty small">
        <p>Esta playlist está vacía. Usa el menú <b>⋯</b> de cualquier canción para agregarla aquí.</p>
      </div>`;
    return { el };
  }
  const list = trackList({ tracks, scroller, playlist: name, columns: { index: true } });
  $('.list-host', el).append(list.el);
  return { el, destroy: list.destroy };
}

function searchView(scroller, query) {
  const found = search(query);
  const total = found.artists.length + found.albums.length + found.tracks.length;
  if (!total) return emptyMessage('Sin resultados', `No encontramos nada para «${query}».`);

  const el = html(`
    ${pageHead({
      kicker: 'Búsqueda',
      title: `«${query}»`,
      meta: plural(found.tracks.length, 'canción', 'canciones'),
      actions: found.tracks.length ? playButtons : '',
    })}
    ${found.artists.length ? `<h3 class="section">Artistas</h3><div class="grid compact">${found.artists
      .map(
        (artist) => `
        <button class="card artist" data-artist="${esc(artist.key)}">
          ${coverHtml(artist.coverUrl, artist.name, 'round', 36)}
          <span class="card-title">${esc(artist.name)}</span>
          <span class="card-sub">${plural(artist.tracks.length, 'canción', 'canciones')}</span>
        </button>`,
      )
      .join('')}</div>` : ''}
    ${found.albums.length ? `<h3 class="section">Álbumes</h3><div class="grid compact">${found.albums.map(albumCard).join('')}</div>` : ''}
    ${found.tracks.length ? '<h3 class="section">Canciones</h3><div class="list-host"></div>' : ''}`);
  bindCoverFallback(el);
  bindPlay(el, found.tracks);
  el.addEventListener('click', (event) => {
    const artist = event.target.closest('[data-artist]');
    if (artist) navigate('artist', artist.dataset.artist);
    const album = event.target.closest('[data-album]');
    if (album) navigate('album', album.dataset.album);
  });
  if (!found.tracks.length) return { el };
  const list = trackList({ tracks: found.tracks, scroller });
  $('.list-host', el).append(list.el);
  return { el, destroy: list.destroy };
}

function queueView(scroller) {
  if (!player.queue.length) {
    return emptyMessage('La fila está vacía', 'Reproduce una canción o usa «Agregar a la fila» en el menú ⋯ de cualquier canción.');
  }
  const el = html(`
    ${pageHead({
      kicker: 'Reproducción',
      title: 'Fila de reproducción',
      meta: '',
      actions: `
        <button class="btn" data-save>${icon('plus', 16)}Guardar como playlist</button>
        <button class="btn danger-ghost" data-clear title="Quita todo excepto la canción actual">${icon('trash', 16)}Limpiar fila</button>`,
    })}
    <div class="list-host"></div>`);
  const meta = $('.meta', el);

  const drawMeta = () => {
    const total = player.queue.reduce((sum, entry) => sum + entry.track.durationMs, 0);
    meta.textContent = `${plural(player.queue.length, 'canción', 'canciones')} · ${fmtTotal(total)}${player.shuffle ? ' · Aleatorio activado' : ''}`;
  };

  const list = queueList({ scroller });
  $('.list-host', el).append(list.el);
  $('[data-clear]', el).addEventListener('click', clearQueue);
  $('[data-save]', el).addEventListener('click', () => promptNewPlaylist(player.queue.map((entry) => entry.track.path)));
  const offs = [on('queue', drawMeta), on('modes', drawMeta)];
  drawMeta();

  return {
    el,
    mounted: () => list.reveal(),
    destroy() {
      list.destroy();
      offs.forEach((off) => off());
    },
  };
}

export function buildView(scroller) {
  if (state.query.trim()) return searchView(scroller, state.query.trim());
  const { name, param } = state.nav;
  switch (name) {
    case 'albums':
      return albumsView();
    case 'artists':
      return artistsView();
    case 'album':
      return albumView(scroller, param);
    case 'artist':
      return artistView(scroller, param);
    case 'playlist':
      return playlistView(scroller, param);
    case 'queue':
      return queueView(scroller);
    default:
      return songsView(scroller);
  }
}
