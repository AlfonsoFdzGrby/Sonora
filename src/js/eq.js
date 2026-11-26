import { emit, storage } from './util.js';

export const BANDS = [
  { id: 'bass', label: 'Graves', type: 'lowshelf', freq: 120, min: 60, max: 300, q: 0.7 },
  { id: 'lowmid', label: 'Medios bajos', type: 'peaking', freq: 350, min: 200, max: 800, q: 1 },
  { id: 'mid', label: 'Medios', type: 'peaking', freq: 1000, min: 600, max: 2500, q: 1 },
  { id: 'highmid', label: 'Medios altos', type: 'peaking', freq: 3500, min: 2000, max: 6000, q: 1 },
  { id: 'treble', label: 'Agudos', type: 'highshelf', freq: 8000, min: 5000, max: 16000, q: 0.7 },
];

export const GAIN_MIN = -12;
export const GAIN_MAX = 12;

const flat = (values = [0, 0, 0, 0, 0]) =>
  BANDS.map((band, index) => ({ id: band.id, freq: band.freq, gain: values[index] ?? 0, q: band.q }));

export const FACTORY_PRESETS = [
  { name: 'Plano', bands: flat() },
  { name: 'Boost de bajo', bands: flat([8, 3, 0, 0, 1]) },
  { name: 'Boost de agudos', bands: flat([1, 0, 0, 3, 7]) },
  { name: 'Voz', bands: flat([-2, 1, 4, 3, 1]) },
  { name: 'Rock', bands: flat([5, 2, -2, 3, 4]) },
  { name: 'Jazz', bands: flat([3, 1, 1, 2, 4]) },
  { name: 'Clásica', bands: flat([2, 1, 0, 2, 3]) },
  { name: 'Noche', bands: flat([3, 1, 0, -2, -5]) },
  { name: 'Escenario', bands: flat([6, 3, 2, 4, 6]) },
];

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function normalizeBands(input) {
  const saved = Array.isArray(input) ? input : [];
  return BANDS.map((band) => {
    const found = saved.find((item) => item && item.id === band.id) ?? {};
    return {
      id: band.id,
      freq: clamp(Number(found.freq) || band.freq, band.min, band.max),
      gain: clamp(Number(found.gain) || 0, GAIN_MIN, GAIN_MAX),
      q: clamp(Number(found.q) || band.q, 0.1, 10),
    };
  });
}

let audioEl = null;
let ctx = null;
let source = null;
let nodes = [];
let available = true;
let enabled = storage.get('eqEnabled', false) === true;
let bands = normalizeBands(storage.get('eqBands', null));
let presets = (Array.isArray(storage.get('eqPresets', [])) ? storage.get('eqPresets', []) : [])
  .filter((preset) => preset && typeof preset.name === 'string')
  .map((preset) => ({ name: preset.name, bands: normalizeBands(preset.bands) }));
let activePreset = storage.get('eqPreset', '') || '';

function save() {
  storage.set('eqEnabled', enabled);
  storage.set('eqBands', bands);
  storage.set('eqPresets', presets);
  storage.set('eqPreset', activePreset);
}

function resume() {
  if (ctx?.state === 'suspended') ctx.resume().catch(() => {});
}

// El audio NO se desvía hacia Web Audio hasta que el ecualizador se activa.
// Así, si no se usa (o el WebView no lo admite), la reproducción sigue normal.
function ensureContext() {
  if (ctx || !audioEl || !available) return !!ctx;
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('Web Audio no disponible');
    ctx = new AudioContextClass();
    // asset.localhost responde con Access-Control-Allow-Origin; el elemento de
    // audio lleva crossorigin para que el grafo reciba las muestras y no silencio.
    source = ctx.createMediaElementSource(audioEl);
    let last = source;
    nodes = BANDS.map((band) => {
      const node = ctx.createBiquadFilter();
      node.type = band.type;
      last.connect(node);
      last = node;
      return node;
    });
    last.connect(ctx.destination);
    document.addEventListener('pointerdown', resume);
    document.addEventListener('keydown', resume);
    audioEl.addEventListener('play', resume);
    resume();
    return true;
  } catch {
    available = false;
    ctx = null;
    source = null;
    nodes = [];
    return false;
  }
}

function apply() {
  save();
  if (enabled) ensureContext();
  if (ctx && nodes.length === BANDS.length) {
    const now = ctx.currentTime;
    BANDS.forEach((band, index) => {
      const node = nodes[index];
      const value = bands[index];
      node.frequency.setTargetAtTime(value.freq, now, 0.01);
      node.Q.setTargetAtTime(value.q, now, 0.01);
      node.gain.setTargetAtTime(enabled ? value.gain : 0, now, 0.01);
    });
    resume();
  }
  emit('eq');
}

export function initEq(audio) {
  audioEl = audio;
  return !!audio;
}

// Se llama al abrir el modal, dentro de un gesto del usuario.
export function prepare() {
  if (enabled) {
    ensureContext();
    apply();
  }
  return available;
}

export const supported = () => !!(window.AudioContext || window.webkitAudioContext);
export const isAvailable = () => available;
export const isEnabled = () => enabled;
export const getBands = () => bands.map((band) => ({ ...band }));
export const userPresets = () => presets.map((preset) => ({ ...preset }));
export const activePresetName = () => activePreset;

export const getGlobalQ = () => {
  const peaking = bands.filter((band, index) => BANDS[index].type === 'peaking');
  return peaking.length ? peaking[0].q : 1;
};

export function setGlobalQ(value) {
  const parsed = Number(value);
  const q = clamp(Number.isFinite(parsed) ? parsed : 1, 0.1, 10);
  bands.forEach((band, index) => {
    if (BANDS[index].type === 'peaking') band.q = q;
  });
  activePreset = '';
  apply();
}

export function findPreset(key) {
  const separator = key.indexOf(':');
  if (separator < 0) return null;
  const list = key.slice(0, separator) === 'user' ? presets : FACTORY_PRESETS;
  const name = key.slice(separator + 1);
  const found = list.find((preset) => preset.name === name);
  return found ? { name: found.name, bands: found.bands, kind: key.slice(0, separator) } : null;
}

export function setEnabled(value) {
  enabled = value === true;
  apply();
}

export function setBand(id, patch) {
  const band = bands.find((item) => item.id === id);
  if (!band) return;
  const definition = BANDS.find((item) => item.id === id);
  if (patch.gain !== undefined) band.gain = clamp(Number(patch.gain) || 0, GAIN_MIN, GAIN_MAX);
  if (patch.freq !== undefined) band.freq = clamp(Number(patch.freq) || definition.freq, definition.min, definition.max);
  if (patch.q !== undefined) band.q = clamp(Number(patch.q) || definition.q, 0.1, 10);
  activePreset = '';
  apply();
}

export function applyPreset(preset) {
  if (!preset) return;
  bands = normalizeBands(preset.bands);
  activePreset = preset.name;
  enabled = true;
  apply();
}

export function resetBands() {
  bands = flat();
  activePreset = 'Plano';
  enabled = true;
  apply();
}

export function savePreset(name) {
  const clean = String(name ?? '').trim().slice(0, 40);
  if (!clean) return null;
  const preset = { name: clean, bands: bands.map((band) => ({ ...band })) };
  const index = presets.findIndex((item) => item.name.toLowerCase() === clean.toLowerCase());
  if (index >= 0) presets[index] = preset;
  else presets.push(preset);
  activePreset = clean;
  apply();
  return preset;
}

export function deletePreset(name) {
  const before = presets.length;
  presets = presets.filter((preset) => preset.name !== name);
  if (presets.length === before) return false;
  if (activePreset === name) activePreset = '';
  apply();
  return true;
}
