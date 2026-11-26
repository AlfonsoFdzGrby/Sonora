import { norm, compare, emit } from './util.js';
import * as api from './api.js';

export const state = {
  tracks: [],
  byPath: new Map(),
  albums: [],
  albumsByKey: new Map(),
  artists: [],
  artistsByKey: new Map(),
  playlists: [],
  directories: [],
  playlistsDir: '',
  scan: { active: false, done: 0, total: 0 },
  nav: { name: 'songs', param: null },
  back: [],
  forward: [],
  query: '',
  filter: '',
  sort: { key: 'artist', dir: 1 },
};

const FEATURE_SPLIT = /\s+(?:feat\.?|ft\.?|featuring)\s+|\s*;\s*|\s+\/\s+/i;

export function primaryArtist(name) {
  return (name || '').split(FEATURE_SPLIT)[0].trim();
}

const dirOf = (path) => path.replace(/[\\/][^\\/]*$/, '');

const byDiscTrack = (a, b) =>
  (a.discNo ?? 0) - (b.discNo ?? 0) || (a.trackNo ?? 0) - (b.trackNo ?? 0) || compare(a.title, b.title);

const byDefault = (a, b) =>
  compare(a.artistName, b.artistName) || compare(a.albumName, b.albumName) || byDiscTrack(a, b);

const COMPARATORS = {
  artist: byDefault,
  title: (a, b) => compare(a.title, b.title) || byDefault(a, b),
  album: (a, b) => compare(a.albumName, b.albumName) || byDiscTrack(a, b),
  duration: (a, b) => a.durationMs - b.durationMs || byDefault(a, b),
};

export function sortTracks(list, key = 'artist', dir = 1) {
  const comparator = COMPARATORS[key] ?? byDefault;
  return [...list].sort((a, b) => comparator(a, b) * dir);
}

function prepare(track) {
  track.coverUrl = track.coverPath ? api.fileUrl(track.coverPath) : null;
  track.artistName = track.artist || 'Artista desconocido';
  track.albumName = track.album || 'Álbum desconocido';
  track.search = norm(`${track.title} ${track.artist} ${track.album} ${track.albumArtist} ${track.genre}`);
  return track;
}

function buildAlbums() {
  const groups = new Map();
  for (const track of state.tracks) {
    const key = track.album
      ? `${norm(track.album)}::${track.albumArtist ? norm(track.albumArtist) : dirOf(track.path)}`
      : `unknown::${norm(track.albumArtist || track.artist)}`;
    let album = groups.get(key);
    if (!album) {
      album = { key, title: track.albumName, albumArtist: track.albumArtist, tracks: [] };
      groups.set(key, album);
    }
    album.tracks.push(track);
    track.albumKey = key;
  }

  const albums = [...groups.values()];
  for (const album of albums) {
    album.tracks.sort(byDiscTrack);
    const artists = new Set(album.tracks.map((t) => norm(primaryArtist(t.artist))));
    album.artist = album.albumArtist || (artists.size === 1 ? primaryArtist(album.tracks[0].artistName) : 'Varios artistas');
    album.year = album.tracks.map((t) => t.year).find(Boolean) ?? null;
    album.coverUrl = album.tracks.find((t) => t.coverUrl)?.coverUrl ?? null;
    album.durationMs = album.tracks.reduce((sum, t) => sum + t.durationMs, 0);
    album.norm = norm(`${album.title} ${album.artist}`);
  }
  albums.sort((a, b) => compare(a.title, b.title) || compare(a.artist, b.artist));
  state.albums = albums;
  state.albumsByKey = new Map(albums.map((a) => [a.key, a]));
}

function buildArtists() {
  const groups = new Map();
  for (const track of state.tracks) {
    const name = primaryArtist(track.artist) || 'Artista desconocido';
    const key = norm(name) || 'unknown';
    let artist = groups.get(key);
    if (!artist) {
      artist = { key, name, tracks: [] };
      groups.set(key, artist);
    }
    artist.tracks.push(track);
    track.artistKey = key;
  }

  const artists = [...groups.values()];
  for (const artist of artists) {
    artist.tracks.sort(byDefault);
    const albumKeys = [...new Set(artist.tracks.map((t) => t.albumKey))];
    artist.albums = albumKeys
      .map((key) => state.albumsByKey.get(key))
      .filter(Boolean)
      .sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999) || compare(a.title, b.title));
    artist.coverUrl = artist.albums.find((a) => a.coverUrl)?.coverUrl ?? null;
    artist.durationMs = artist.tracks.reduce((sum, t) => sum + t.durationMs, 0);
    artist.norm = norm(artist.name);
  }
  artists.sort((a, b) => compare(a.name, b.name));
  state.artists = artists;
  state.artistsByKey = new Map(artists.map((a) => [a.key, a]));
}

export function artistKeyFor(name) {
  const key = norm(primaryArtist(name));
  return state.artistsByKey.has(key) ? key : null;
}

function setTracks(raw) {
  state.tracks = raw.map(prepare);
  state.byPath = new Map(state.tracks.map((t) => [t.path, t]));
  buildAlbums();
  buildArtists();
  emit('library');
}

export function search(query) {
  const tokens = norm(query).split(/\s+/).filter(Boolean);
  if (!tokens.length) return { artists: [], albums: [], tracks: [] };
  const hit = (text) => tokens.every((token) => text.includes(token));
  const phrase = norm(query);
  const tracks = state.tracks
    .filter((t) => hit(t.search))
    .sort((a, b) => Number(!norm(a.title).includes(phrase)) - Number(!norm(b.title).includes(phrase)) || byDefault(a, b));
  return {
    artists: state.artists.filter((a) => hit(a.norm)).slice(0, 12),
    albums: state.albums.filter((a) => hit(a.norm)).slice(0, 12),
    tracks,
  };
}

export function navigate(name, param = null) {
  // Pulsar la vista actual no debe descartar el historial "adelante",
  // aunque haya un filtro de búsqueda activo.
  const same = state.nav.name === name && state.nav.param === param;
  if (!same) {
    state.back.push({ ...state.nav, query: state.query });
    if (state.back.length > 50) state.back.shift();
    state.forward = [];
  }
  state.nav = { name, param };
  state.query = '';
  emit('nav');
}

function rememberCurrent() {
  state.forward.push({ ...state.nav, query: state.query });
  if (state.forward.length > 50) state.forward.shift();
}

export function goBack() {
  if (state.query) {
    rememberCurrent();
    state.query = '';
    emit('nav');
    return;
  }
  const previous = state.back.pop();
  if (!previous) return;
  rememberCurrent();
  state.nav = { name: previous.name, param: previous.param ?? null };
  state.query = previous.query ?? '';
  emit('nav');
}

export function goForward() {
  const next = state.forward.pop();
  if (!next) return;
  state.back.push({ ...state.nav, query: state.query });
  if (state.back.length > 50) state.back.shift();
  state.nav = { name: next.name, param: next.param ?? null };
  state.query = next.query ?? '';
  emit('nav');
}

export function setQuery(query) {
  if (state.query === query) return;
  state.query = query;
  emit('nav');
}

function missingTrack(path) {
  const file = path.split(/[\\/]/).pop() || path;
  return {
    path,
    title: file.replace(/\.[^.]+$/, ''),
    artist: '',
    album: '',
    artistName: 'Archivo no disponible',
    albumName: '',
    durationMs: 0,
    coverUrl: null,
    missing: true,
    search: '',
  };
}

export function resolvePlaylist(playlist) {
  return playlist.paths.map((path) => state.byPath.get(path) ?? missingTrack(path));
}

function sortPlaylists() {
  state.playlists.sort((a, b) => compare(a.name, b.name));
}

function replacePlaylist(oldName, playlist) {
  const index = state.playlists.findIndex((p) => p.name === oldName);
  if (index >= 0) state.playlists[index] = playlist;
  else state.playlists.push(playlist);
  sortPlaylists();
  emit('playlists');
}

export async function loadPlaylists() {
  state.playlists = await api.invoke('list_playlists');
  sortPlaylists();
  emit('playlists');
}

export async function importPlaylist(path) {
  const result = await api.invoke('import_playlist', { path });
  await loadPlaylists();
  return result;
}

export async function createPlaylist(name, paths = []) {
  const playlist = await api.invoke('create_playlist', { name, paths });
  replacePlaylist(playlist.name, playlist);
  return playlist;
}

export async function renamePlaylist(oldName, newName) {
  const playlist = await api.invoke('rename_playlist', { oldName, newName });
  if (state.nav.name === 'playlist' && state.nav.param === oldName) {
    state.nav = { name: 'playlist', param: playlist.name };
  }
  const renameEntry = (entry) =>
    entry.name === 'playlist' && entry.param === oldName ? { ...entry, param: playlist.name } : entry;
  state.back = state.back.map(renameEntry);
  state.forward = state.forward.map(renameEntry);
  replacePlaylist(oldName, playlist);
  return playlist;
}

export async function deletePlaylist(name) {
  await api.invoke('delete_playlist', { name });
  state.playlists = state.playlists.filter((p) => p.name !== name);
  const keepEntry = (entry) => !(entry.name === 'playlist' && entry.param === name);
  state.back = state.back.filter(keepEntry);
  state.forward = state.forward.filter(keepEntry);
  if (state.nav.name === 'playlist' && state.nav.param === name) {
    state.nav = state.back.pop() ?? { name: 'songs', param: null };
    state.forward = [];
    emit('nav');
  }
  emit('playlists');
}

export async function addToPlaylist(name, paths) {
  const playlist = state.playlists.find((p) => p.name === name);
  if (!playlist) throw new Error('La playlist no existe');
  const existing = new Set(playlist.paths);
  const fresh = [...new Set(paths)].filter((path) => !existing.has(path));
  if (!fresh.length) return 0;
  const saved = await api.invoke('save_playlist', { name, paths: [...playlist.paths, ...fresh] });
  replacePlaylist(name, saved);
  return fresh.length;
}

export async function removeFromPlaylist(name, index) {
  const playlist = state.playlists.find((p) => p.name === name);
  if (!playlist) return;
  const paths = playlist.paths.filter((_, i) => i !== index);
  const saved = await api.invoke('save_playlist', { name, paths });
  replacePlaylist(name, saved);
}

export async function scan() {
  if (state.scan.active) return;
  state.scan = { active: true, done: 0, total: 0 };
  emit('scan');
  try {
    setTracks(await api.invoke('scan_library'));
  } finally {
    state.scan = { active: false, done: 0, total: 0 };
    emit('scan');
  }
}

export async function addDirectory(path) {
  state.directories = await api.invoke('add_directory', { path });
  emit('directories');
  await scan();
}

export async function removeDirectory(path) {
  state.directories = await api.invoke('remove_directory', { path });
  emit('directories');
  await scan();
}

export async function init() {
  api.listen('scan-progress', ({ done, total }) => {
    state.scan.done = done;
    state.scan.total = total;
    emit('scan');
  });
  const snapshot = await api.invoke('get_snapshot');
  state.directories = snapshot.directories;
  state.playlistsDir = snapshot.playlistsDir;
  setTracks(snapshot.tracks);
  emit('directories');
  await loadPlaylists();
}
