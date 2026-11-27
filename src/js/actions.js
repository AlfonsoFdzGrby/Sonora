import * as api from './api.js';
import { playNext, enqueue, insertAt } from './player.js';
import {
  state,
  scan,
  addDirectory,
  removeDirectory,
  createPlaylist,
  importPlaylist,
  navigate,
  renamePlaylist,
  deletePlaylist,
  addToPlaylist,
  removeFromPlaylist,
} from './store.js';
import { askText, confirmDialog, modal, showMenu, toast } from './overlays.js';
import { esc, on, plural } from './util.js';
import { icon } from './visual.js';

const report = (error) => toast(String(error?.message ?? error), 'error');

export async function chooseDirectory() {
  let path;
  try {
    path = await api.pickDirectory();
  } catch (error) {
    report(error);
    return;
  }
  if (!path) return;
  try {
    await addDirectory(path);
    toast(`Biblioteca actualizada · ${plural(state.tracks.length, 'canción', 'canciones')}`, 'success');
  } catch (error) {
    report(error);
  }
}

export async function rescan() {
  try {
    await scan();
    toast(`Biblioteca actualizada · ${plural(state.tracks.length, 'canción', 'canciones')}`, 'success');
  } catch (error) {
    report(error);
  }
}

export async function importM3U() {
  let path;
  try {
    path = await api.pickPlaylistFile();
  } catch (error) {
    report(error);
    return;
  }
  if (!path) return;
  try {
    const result = await importPlaylist(path);
    const skipped = result.skipped ? ` · ${result.skipped} sin encontrar` : '';
    toast(
      `«${result.name}» importada · ${plural(result.imported, 'canción', 'canciones')}${skipped}`,
      result.imported ? 'success' : 'info',
    );
    navigate('playlist', result.name);
  } catch (error) {
    report(error);
  }
}

export function showNewPlaylistMenu(x, y) {
  showMenu(x, y, [
    { header: 'Playlists' },
    {
      label: 'Nueva playlist…',
      icon: 'plus',
      onSelect: () => promptNewPlaylist().then((playlist) => playlist && navigate('playlist', playlist.name)),
    },
    { label: 'Importar .m3u…', icon: 'upload', onSelect: importM3U },
  ]);
}

export async function promptNewPlaylist(paths = []) {
  const name = await askText({
    title: 'Nueva playlist',
    label: 'Nombre',
    placeholder: 'Mi playlist',
    confirmText: 'Crear',
  });
  if (name === null) return null;
  try {
    const playlist = await createPlaylist(name, paths);
    toast(
      paths.length
        ? `Playlist «${playlist.name}» creada con ${plural(paths.length, 'canción', 'canciones')}`
        : `Playlist «${playlist.name}» creada`,
      'success',
    );
    return playlist;
  } catch (error) {
    report(error);
    return null;
  }
}

export async function promptRename(name) {
  const next = await askText({
    title: 'Renombrar playlist',
    label: 'Nuevo nombre',
    value: name,
    confirmText: 'Guardar',
  });
  if (next === null || next === name) return;
  try {
    await renamePlaylist(name, next);
    toast('Playlist renombrada', 'success');
  } catch (error) {
    report(error);
  }
}

export async function promptDelete(name) {
  const confirmed = await confirmDialog({
    title: 'Eliminar playlist',
    message: `¿Eliminar la playlist «${name}»? Tus canciones no se borrarán, solo la lista.`,
    confirmText: 'Eliminar',
    danger: true,
  });
  if (!confirmed) return;
  try {
    await deletePlaylist(name);
    toast('Playlist eliminada', 'success');
  } catch (error) {
    report(error);
  }
}

export async function addTracksTo(name, paths) {
  try {
    const added = await addToPlaylist(name, paths);
    if (!added) toast(`Ya estaba en «${name}»`);
    else if (added === 1) toast(`Agregada a «${name}»`, 'success');
    else toast(`${added} canciones agregadas a «${name}»`, 'success');
  } catch (error) {
    report(error);
  }
}

export async function removeTrackAt(name, index) {
  try {
    await removeFromPlaylist(name, index);
  } catch (error) {
    report(error);
  }
}

export function enqueueTracks(tracks) {
  const { added, started } = enqueue(tracks);
  if (started || !added) return;
  toast(added === 1 ? 'Agregada a la fila' : `${added} canciones agregadas a la fila`, 'success');
}

export function insertTracks(tracks, index) {
  const { added, started } = insertAt(tracks, index);
  if (started || !added) return;
  toast(added === 1 ? 'Agregada a la fila' : `${added} canciones agregadas a la fila`, 'success');
}

export function playNextTracks(tracks) {
  const { added, started } = playNext(tracks);
  if (started || !added) return;
  toast(added === 1 ? 'Se reproducirá a continuación' : `${added} canciones se reproducirán a continuación`, 'success');
}

export function showAddToPlaylist(x, y, paths) {
  const items = [{ header: 'Agregar a playlist' }];
  for (const playlist of state.playlists) {
    items.push({ label: playlist.name, icon: 'list', onSelect: () => addTracksTo(playlist.name, paths) });
  }
  if (state.playlists.length) items.push({ separator: true });
  items.push({ label: 'Nueva playlist…', icon: 'plus', onSelect: () => promptNewPlaylist(paths) });
  showMenu(x, y, items);
}

export function showPlaylistMenu(x, y, name) {
  showMenu(x, y, [
    { label: 'Renombrar', icon: 'edit', onSelect: () => promptRename(name) },
    { label: 'Eliminar', icon: 'trash', danger: true, onSelect: () => promptDelete(name) },
  ]);
}

export function openSettings() {
  const body = document.createElement('div');
  const unsubscribe = [];
  const dialog = modal({
    title: 'Biblioteca',
    content: body,
    wide: true,
    onClose: () => unsubscribe.forEach((off) => off()),
  });

  const draw = () => {
    const directories = state.directories
      .map(
        (dir) => `
        <div class="dir-row">
          <span class="dir-ico">${icon('folder', 18)}</span>
          <span class="dir-path" title="${esc(dir)}">${esc(dir)}</span>
          <button class="icon-btn sm" data-remove="${esc(dir)}" title="Quitar de la biblioteca">${icon('x', 16)}</button>
        </div>`,
      )
      .join('');
    const scanning = state.scan.active;
    const summary = scanning
      ? state.scan.total
        ? `Escaneando ${state.scan.done.toLocaleString('es')} de ${state.scan.total.toLocaleString('es')}…`
        : 'Buscando música…'
      : `${plural(state.tracks.length, 'canción', 'canciones')} · ${plural(state.albums.length, 'álbum', 'álbumes')} · ${plural(state.artists.length, 'artista', 'artistas')}`;
    body.innerHTML = `
      <p class="hint">Sonora busca música (mp3, flac, wav, ogg, opus, m4a y aac) dentro de estas carpetas y de sus subcarpetas.</p>
      <div class="dir-list">${directories || '<div class="empty-inline">Aún no agregaste ninguna carpeta.</div>'}</div>
      <div class="modal-actions split">
        <span class="scan-info">${esc(summary)}</span>
        <div class="btn-row">
          <button class="btn primary" data-add ${scanning ? 'disabled' : ''}>${icon('plus', 16)}Agregar carpeta</button>
          <button class="btn" data-rescan ${scanning ? 'disabled' : ''}>${icon('refresh', 16)}Volver a escanear</button>
          <button class="btn" data-import>${icon('upload', 16)}Importar .m3u</button>
        </div>
      </div>
      <p class="hint small">Un .m3u externo se adapta a las canciones de tu biblioteca: se buscan por ruta y nombre de archivo.</p>
      <p class="hint small">Las playlists se guardan como archivos .m3u en:<br><code>${esc(state.playlistsDir)}</code></p>`;
  };

  body.addEventListener('click', async (event) => {
    const remove = event.target.closest('[data-remove]');
    if (remove) {
      try {
        await removeDirectory(remove.dataset.remove);
      } catch (error) {
        report(error);
      }
      return;
    }
    if (event.target.closest('[data-import]')) {
      dialog.close();
      importM3U();
    }
    if (event.target.closest('[data-add]')) chooseDirectory();
    if (event.target.closest('[data-rescan]')) rescan();
  });

  for (const name of ['directories', 'scan', 'library']) {
    unsubscribe.push(on(name, draw));
  }
  draw();
  return dialog;
}
