import { emit, storage } from './util.js';

export function currentTheme() {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

export function applyTheme(theme) {
  const value = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = value;
  emit('theme', value);
  return value;
}

export function initTheme() {
  const saved = storage.get('theme', null);
  const system = window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  return applyTheme(saved === 'light' || saved === 'dark' ? saved : system);
}

export function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  storage.set('theme', next);
  return applyTheme(next);
}
