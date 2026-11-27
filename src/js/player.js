import { fileUrl } from './api.js';
import { emit, storage } from './util.js';

const audio = document.getElementById('audio');

export const player = {
  queue: [],
  original: [],
  pos: -1,
  current: null,
  playing: false,
  shuffle: storage.get('shuffle', false),
  repeat: storage.get('repeat', 'off'),
  volume: storage.get('volume', 0.8),
  muted: storage.get('muted', false),
};

let failures = 0;
let nextUid = 0;

audio.volume = player.volume;
audio.muted = player.muted;

const wrap = (track) => ({ uid: ++nextUid, track });

const playable = (list) => list.filter((track) => !track.missing);

function duration() {
  return Number.isFinite(audio.duration) && audio.duration > 0
    ? audio.duration
    : (player.current?.durationMs ?? 0) / 1000;
}

function shuffled(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function shuffleQueue() {
  const current = player.queue[player.pos];
  const rest = player.queue.filter((_, index) => index !== player.pos);
  player.queue = current ? [current, ...shuffled(rest)] : shuffled(rest);
  player.pos = current ? 0 : -1;
}

function restoreQueue() {
  const current = player.queue[player.pos];
  player.queue = [...player.original];
  player.pos = current ? player.queue.indexOf(current) : -1;
}

function insertAfter(list, anchor, entries) {
  const at = list.indexOf(anchor) + 1;
  return [...list.slice(0, at), ...entries, ...list.slice(at)];
}

function setPlaying(flag) {
  player.playing = flag;
  document.body.classList.toggle('is-playing', flag);
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = flag ? 'playing' : 'paused';
  emit('playstate');
}

function updateMediaSession(track) {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artistName,
      album: track.albumName,
      artwork: track.coverUrl ? [{ src: track.coverUrl }] : [],
    });
  } catch {
    return;
  }
}

function load(track) {
  player.current = track;
  audio.src = fileUrl(track.path);
  emit('track', track);
  emit('time', { current: 0, duration: duration() });
  updateMediaSession(track);
  audio.play().catch(() => {});
}

function goTo(pos) {
  player.pos = pos;
  load(player.queue[pos].track);
}

function hasNext() {
  return player.pos < player.queue.length - 1 || player.repeat === 'all';
}

export function next() {
  if (!player.queue.length) return false;
  let pos = player.pos + 1;
  if (pos >= player.queue.length) {
    if (player.repeat !== 'all') return false;
    pos = 0;
  }
  goTo(pos);
  return true;
}

export function prev() {
  if (!player.queue.length) return;
  if (audio.currentTime > 3) {
    audio.currentTime = 0;
    return;
  }
  let pos = player.pos - 1;
  if (pos < 0) pos = player.repeat === 'all' ? player.queue.length - 1 : 0;
  goTo(pos);
}

export function playList(list, index = 0) {
  const tracks = playable(list);
  if (!tracks.length) return;
  const start = Math.min(tracks.length - 1, list.slice(0, index).filter((track) => !track.missing).length);
  player.original = tracks.map(wrap);
  player.queue = [...player.original];
  player.pos = start;
  if (player.shuffle) shuffleQueue();
  emit('queue');
  goTo(player.pos);
}

export function shuffleList(list) {
  const tracks = playable(list);
  if (!tracks.length) return;
  if (!player.shuffle) {
    player.shuffle = true;
    storage.set('shuffle', true);
    emit('modes');
  }
  playList(tracks, Math.floor(Math.random() * tracks.length));
}

export function jumpTo(pos) {
  if (pos >= 0 && pos < player.queue.length) goTo(pos);
}

export function playNext(list) {
  const tracks = playable(list);
  if (!tracks.length) return { added: 0, started: false };
  if (!player.queue.length) {
    playList(tracks, 0);
    return { added: tracks.length, started: true };
  }
  const entries = tracks.map(wrap);
  const anchor = player.queue[player.pos];
  player.queue = insertAfter(player.queue, anchor, entries);
  player.original = insertAfter(player.original, anchor, entries);
  emit('queue');
  return { added: entries.length, started: false };
}

export function enqueue(list) {
  const tracks = playable(list);
  if (!tracks.length) return { added: 0, started: false };
  if (!player.queue.length) {
    playList(tracks, 0);
    return { added: tracks.length, started: true };
  }
  const entries = tracks.map(wrap);
  player.queue = player.queue.concat(entries);
  player.original = player.original.concat(entries);
  emit('queue');
  return { added: entries.length, started: false };
}

export function insertAt(list, index) {
  const tracks = playable(list);
  if (!tracks.length) return { added: 0, started: false };
  if (!player.queue.length) {
    playList(tracks, 0);
    return { added: tracks.length, started: true };
  }
  const at = Math.max(0, Math.min(index, player.queue.length));
  const entries = tracks.map(wrap);
  const before = at > 0 ? player.queue[at - 1] : null;
  const originalAt = before ? player.original.indexOf(before) + 1 : 0;
  player.queue = [...player.queue.slice(0, at), ...entries, ...player.queue.slice(at)];
  player.original = [...player.original.slice(0, originalAt), ...entries, ...player.original.slice(originalAt)];
  if (at <= player.pos) player.pos += entries.length;
  emit('queue');
  return { added: entries.length, started: false };
}

export function removeAt(index) {
  if (index === player.pos || index < 0 || index >= player.queue.length) return;
  const entry = player.queue[index];
  player.queue = player.queue.filter((_, i) => i !== index);
  player.original = player.original.filter((item) => item !== entry);
  if (index < player.pos) player.pos -= 1;
  emit('queue');
}

export function clearQueue() {
  const current = player.queue[player.pos];
  player.queue = current ? [current] : [];
  player.original = [...player.queue];
  player.pos = current ? 0 : -1;
  emit('queue');
}

export function moveQueue(from, to) {
  if (from === to) return;
  if (from < 0 || from >= player.queue.length) return;
  if (to < 0 || to >= player.queue.length) return;
  const [entry] = player.queue.splice(from, 1);
  player.queue.splice(to, 0, entry);
  if (player.pos === from) player.pos = to;
  else if (from < player.pos && to >= player.pos) player.pos -= 1;
  else if (from > player.pos && to <= player.pos) player.pos += 1;

  const oFrom = player.original.indexOf(entry);
  if (oFrom >= 0) {
    player.original.splice(oFrom, 1);
    let oTo;
    if (to === 0) {
      oTo = 0;
    } else {
      const before = player.queue[to - 1];
      const beforeIdx = player.original.indexOf(before);
      oTo = beforeIdx >= 0 ? beforeIdx + 1 : Math.min(to, player.original.length);
    }
    player.original.splice(oTo, 0, entry);
  }

  emit('queue');
}

export function togglePlay() {
  if (!player.current) return false;
  if (audio.paused) audio.play().catch(() => {});
  else audio.pause();
  return true;
}

export function seek(seconds) {
  if (player.current) audio.currentTime = seconds;
}

export function setVolume(value) {
  player.volume = Math.min(1, Math.max(0, value));
  audio.volume = player.volume;
  player.muted = player.volume === 0;
  audio.muted = player.muted;
  storage.set('volume', player.volume);
  storage.set('muted', player.muted);
  emit('modes');
}

export function toggleMute() {
  player.muted = !player.muted;
  if (!player.muted && player.volume === 0) player.volume = 0.5;
  audio.volume = player.volume;
  audio.muted = player.muted;
  storage.set('muted', player.muted);
  emit('modes');
}

export function toggleShuffle() {
  player.shuffle = !player.shuffle;
  storage.set('shuffle', player.shuffle);
  if (player.queue.length && player.pos >= 0) {
    if (player.shuffle) shuffleQueue();
    else restoreQueue();
    emit('queue', { reveal: true });
  }
  emit('modes');
}

export function cycleRepeat() {
  player.repeat = { off: 'all', all: 'one', one: 'off' }[player.repeat] ?? 'off';
  storage.set('repeat', player.repeat);
  emit('modes');
}

audio.addEventListener('playing', () => {
  failures = 0;
  setPlaying(true);
});

audio.addEventListener('pause', () => setPlaying(false));

audio.addEventListener('timeupdate', () => emit('time', { current: audio.currentTime, duration: duration() }));

audio.addEventListener('loadedmetadata', () => emit('time', { current: audio.currentTime, duration: duration() }));

audio.addEventListener('ended', () => {
  if (player.repeat === 'one') {
    audio.currentTime = 0;
    audio.play().catch(() => {});
    return;
  }
  if (!next()) {
    audio.currentTime = 0;
    setPlaying(false);
    emit('time', { current: 0, duration: duration() });
  }
});

audio.addEventListener('error', () => {
  if (!player.current) return;
  failures += 1;
  emit('toast', {
    message: `No se puede reproducir «${player.current.title}» en este sistema`,
    kind: 'error',
  });
  if (failures < player.queue.length && hasNext()) next();
  else setPlaying(false);
});

if ('mediaSession' in navigator) {
  const handlers = {
    play: () => togglePlay(),
    pause: () => togglePlay(),
    previoustrack: () => prev(),
    nexttrack: () => next(),
    seekto: (details) => seek(details.seekTime ?? 0),
  };
  for (const [action, handler] of Object.entries(handlers)) {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch {
      continue;
    }
  }
}
