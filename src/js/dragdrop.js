import { esc } from './util.js';
import { coverHtml, bindCoverFallback } from './visual.js';

const THRESHOLD = 5;
const GHOST_WIDTH = 300;
const GHOST_HEIGHT = 52;
const IGNORED = '[data-more], [data-remove], [data-sort], input, a';

const targets = new Set();

export function registerDropTarget(target) {
  targets.add(target);
  return () => targets.delete(target);
}

function locate(x, y) {
  for (const target of targets) {
    const box = target.el.getBoundingClientRect();
    if (box.width > 0 && box.height > 0 && x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) {
      return target.accepts && !target.accepts() ? { refused: true } : { target };
    }
  }
  return {};
}

function buildGhost(label) {
  const ghost = document.createElement('div');
  ghost.className = 'qlist q-ghost compact';
  ghost.style.width = `${GHOST_WIDTH}px`;
  ghost.style.height = `${GHOST_HEIGHT}px`;
  ghost.style.setProperty('--cols', 'minmax(0, 1fr) auto 8px');
  ghost.innerHTML = `
    <div class="row" style="height:${GHOST_HEIGHT}px">
      <span class="c-title">${coverHtml(label.coverUrl, label.seed, 'sm', 16)}<span class="titles"><span class="t">${esc(label.title)}</span><span class="s">${esc(label.subtitle)}</span></span></span>
      <span class="c-dur">${esc(label.meta)}</span>
      <span class="c-act"></span>
    </div>`;
  bindCoverFallback(ghost);
  return ghost;
}

export function enableDrag(host, pick) {
  const drag = {
    pending: false,
    active: false,
    item: null,
    startX: 0,
    startY: 0,
    x: 0,
    y: 0,
    ghost: null,
    target: null,
    frame: 0,
  };
  let suppressClick = false;

  function resolveTarget() {
    const { target = null, refused = false } = locate(drag.x, drag.y);
    document.body.classList.toggle('drop-refused', refused);
    if (target !== drag.target) {
      drag.target?.leave();
      drag.target = target;
    }
    target?.over(drag.x, drag.y, drag.item.tracks);
  }

  function tick() {
    if (!drag.active) return;
    const fitsRight = drag.x + 16 + GHOST_WIDTH <= window.innerWidth - 8;
    const left = Math.max(8, fitsRight ? drag.x + 16 : drag.x - 16 - GHOST_WIDTH);
    drag.ghost.style.transform = `translate3d(${left}px, ${drag.y - GHOST_HEIGHT / 2}px, 0) scale(1.02)`;
    resolveTarget();
    drag.frame = requestAnimationFrame(tick);
  }

  function detach() {
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
    document.removeEventListener('pointercancel', onPointerCancel);
    document.removeEventListener('keydown', onDragKey, true);
    window.removeEventListener('blur', onPointerCancel);
  }

  function stopDrag(commit) {
    const { active, item, target } = drag;
    detach();
    cancelAnimationFrame(drag.frame);
    drag.frame = 0;
    drag.ghost?.remove();
    drag.ghost = null;
    document.body.classList.remove('reordering', 'drop-refused');
    item?.mark?.classList.remove('dragging');
    drag.pending = false;
    drag.active = false;
    drag.item = null;
    drag.target = null;
    if (active) {
      suppressClick = true;
      setTimeout(() => {
        suppressClick = false;
      }, 60);
    }
    if (commit && active && target) target.drop(drag.x, drag.y, item.tracks);
    target?.leave();
  }

  function startDrag() {
    drag.active = true;
    drag.pending = false;
    drag.ghost = buildGhost(drag.item.label);
    document.body.append(drag.ghost);
    drag.item.mark?.classList.add('dragging');
    document.body.classList.add('reordering');
    tick();
  }

  function onPointerMove(event) {
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (drag.pending && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) >= THRESHOLD) startDrag();
    if (drag.active) event.preventDefault();
  }

  function onPointerUp(event) {
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (drag.active) resolveTarget();
    stopDrag(true);
  }

  function onPointerCancel() {
    stopDrag(false);
  }

  function onDragKey(event) {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    stopDrag(false);
  }

  host.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || drag.pending || drag.active) return;
    if (event.target.closest(IGNORED)) return;
    const item = pick(event.target);
    if (!item || !item.tracks.length) return;
    drag.pending = true;
    drag.item = item;
    drag.startX = drag.x = event.clientX;
    drag.startY = drag.y = event.clientY;
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointercancel', onPointerCancel);
    document.addEventListener('keydown', onDragKey, true);
    window.addEventListener('blur', onPointerCancel);
  });

  host.addEventListener(
    'click',
    (event) => {
      if (!suppressClick) return;
      event.stopPropagation();
      event.preventDefault();
    },
    true,
  );
}
