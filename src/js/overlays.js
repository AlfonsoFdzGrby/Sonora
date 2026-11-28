import { $, esc, on } from './util.js';
import { icon } from './visual.js';

export function toast(message, kind = 'info') {
  const root = $('#toast-root');
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  root.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 250);
  }, 3600);
}

on('toast', ({ message, kind }) => toast(message, kind));

export function modal({ title, content, wide = false, className = '', onClose }) {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `
    <div class="modal${wide ? ' wide' : ''}${className ? ` ${className}` : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <header class="modal-head">
        <h2>${esc(title)}</h2>
        <button class="icon-btn sm" data-close title="Cerrar">${icon('x', 18)}</button>
      </header>
      <div class="modal-body"></div>
    </div>`;
  const body = $('.modal-body', overlay);
  if (typeof content === 'string') body.innerHTML = content;
  else body.append(content);

  let closed = false;
  const onKey = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
    }
  };
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    overlay.classList.remove('show');
    setTimeout(() => overlay.remove(), 160);
    onClose?.();
  }

  overlay.addEventListener('pointerdown', (event) => {
    if (event.target === overlay) close();
  });
  $('[data-close]', overlay).addEventListener('click', close);
  document.addEventListener('keydown', onKey, true);
  $('#modal-root').append(overlay);
  requestAnimationFrame(() => overlay.classList.add('show'));
  return { close, body, el: overlay };
}

export function askText({ title, label, value = '', placeholder = '', confirmText = 'Aceptar' }) {
  return new Promise((resolve) => {
    const form = document.createElement('form');
    form.innerHTML = `
      <label class="field">
        <span>${esc(label)}</span>
        <input type="text" maxlength="80" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off" spellcheck="false">
      </label>
      <div class="modal-actions">
        <button type="button" class="btn ghost" data-cancel>Cancelar</button>
        <button type="submit" class="btn primary">${esc(confirmText)}</button>
      </div>`;
    const input = $('input', form);
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
      dialog.close();
    };
    const dialog = modal({ title, content: form, onClose: () => finish(null) });
    $('[data-cancel]', form).addEventListener('click', () => finish(null));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const text = input.value.trim();
      if (text) finish(text);
    });
    setTimeout(() => {
      input.focus();
      input.select();
    }, 30);
  });
}

export function confirmDialog({ title, message, confirmText = 'Aceptar', danger = false }) {
  return new Promise((resolve) => {
    const box = document.createElement('div');
    box.innerHTML = `
      <p class="confirm-text">${esc(message)}</p>
      <div class="modal-actions">
        <button type="button" class="btn ghost" data-cancel>Cancelar</button>
        <button type="button" class="btn ${danger ? 'danger' : 'primary'}" data-ok>${esc(confirmText)}</button>
      </div>`;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
      dialog.close();
    };
    const dialog = modal({ title, content: box, onClose: () => finish(false) });
    $('[data-cancel]', box).addEventListener('click', () => finish(false));
    $('[data-ok]', box).addEventListener('click', () => finish(true));
    setTimeout(() => $('[data-ok]', box).focus(), 30);
  });
}

let activeMenu = null;

function onMenuPointer(event) {
  if (activeMenu && !activeMenu.contains(event.target)) closeMenu();
}

function onMenuKey(event) {
  if (event.key === 'Escape') {
    event.stopPropagation();
    closeMenu();
    return;
  }
  if (event.key === 'Tab') {
    closeMenu();
    return;
  }
  if (!activeMenu) return;
  const items = [...activeMenu.querySelectorAll('.menu-item')];
  if (!items.length) return;
  const at = items.indexOf(document.activeElement);
  let target = null;
  if (event.key === 'ArrowDown') target = items[(at + 1) % items.length];
  else if (event.key === 'ArrowUp') target = items[at <= 0 ? items.length - 1 : at - 1];
  else if (event.key === 'Home') target = items[0];
  else if (event.key === 'End') target = items[items.length - 1];
  if (!target) return;
  event.preventDefault();
  event.stopPropagation();
  target.focus();
}

export function closeMenu() {
  if (!activeMenu) return;
  activeMenu.remove();
  activeMenu = null;
  document.removeEventListener('pointerdown', onMenuPointer, true);
  document.removeEventListener('keydown', onMenuKey, true);
  window.removeEventListener('blur', closeMenu);
}

export function showMenu(x, y, items) {
  closeMenu();
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.setAttribute('role', 'menu');
  menu.tabIndex = -1;

  for (const item of items) {
    if (item.separator) {
      const line = document.createElement('div');
      line.className = 'menu-sep';
      menu.append(line);
    } else if (item.header) {
      const head = document.createElement('div');
      head.className = 'menu-head';
      head.textContent = item.header;
      menu.append(head);
    } else {
      const button = document.createElement('button');
      button.className = `menu-item${item.danger ? ' danger' : ''}`;
      button.setAttribute('role', 'menuitem');
      button.innerHTML = `${item.icon ? icon(item.icon, 16) : '<span class="pad"></span>'}<span class="menu-label"></span>`;
      $('.menu-label', button).textContent = item.label;
      button.addEventListener('click', () => {
        closeMenu();
        item.onSelect?.();
      });
      menu.append(button);
    }
  }

  document.body.append(menu);
  const box = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - box.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - box.height - 8))}px`;
  activeMenu = menu;
  menu.focus({ preventScroll: true });

  setTimeout(() => {
    if (activeMenu !== menu) return;
    document.addEventListener('pointerdown', onMenuPointer, true);
    document.addEventListener('keydown', onMenuKey, true);
    window.addEventListener('blur', closeMenu);
  }, 0);
}
