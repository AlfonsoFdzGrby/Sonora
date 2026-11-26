import { player, jumpTo, removeAt, moveQueue } from './player.js';
import { esc, fmtTime, on } from './util.js';
import { icon, coverHtml, bindCoverFallback } from './visual.js';

const OVERSCAN = 8;

export function queueList({ scroller, compact = false }) {
  const rowHeight = compact ? 52 : 56;
  const root = document.createElement('div');
  root.className = `qlist${compact ? ' compact' : ''}`;
  root.innerHTML = '<div class="tl-spacer"></div><div class="tl-rows"></div>';
  const spacer = root.querySelector('.tl-spacer');
  const rows = root.querySelector('.tl-rows');

  const indicator = document.createElement('div');
  indicator.className = 'q-drop';
  root.append(indicator);

  const drag = {
    pending: false,
    active: false,
    index: -1,
    target: -1,
    startX: 0,
    startY: 0,
    y: 0,
    offsetY: 0,
    left: 0,
    ghost: null,
    frame: 0,
  };
  let suppressClick = false;

  let first = -1;
  let last = -1;

  function rowHtml(entry, index) {
    const track = entry.track;
    const current = index === player.pos;
    const classes = ['row'];
    if (current) classes.push('current');
    if (current && player.playing) classes.push('playing');
    if (index < player.pos) classes.push('done');
    if (drag.active && index === drag.index) classes.push('dragging');
    const lead = compact
      ? ''
      : `<span class="c-num"><span class="num">${index + 1}</span><span class="eq" aria-hidden="true"><i></i><i></i><i></i></span><span class="pl">${icon('play', 14)}</span></span>`;
    const action = current
      ? '<span class="c-act"></span>'
      : `<span class="c-act"><button class="icon-btn sm" data-remove title="Quitar de la fila">${icon('x', 16)}</button></span>`;
    return `
      <div class="${classes.join(' ')}" data-index="${index}" style="top:${index * rowHeight}px;height:${rowHeight}px">
        ${lead}
        <span class="c-title">${coverHtml(track.coverUrl, track.albumName || track.title, 'sm', 16)}<span class="titles"><span class="t">${esc(track.title)}</span><span class="s">${esc(track.artistName)}</span></span></span>
        <span class="c-dur">${fmtTime(track.durationMs / 1000)}</span>
        ${action}
      </div>`;
  }

  function render(force = false) {
    const queue = player.queue;
    const top = Math.max(0, scroller.scrollTop - root.offsetTop);
    const height = scroller.clientHeight || 600;
    const from = Math.max(0, Math.floor(top / rowHeight) - OVERSCAN);
    const to = Math.min(queue.length - 1, Math.ceil((top + height) / rowHeight) + OVERSCAN);
    if (!force && from === first && to === last) return;
    first = from;
    last = to;
    let html = '';
    for (let i = from; i <= to; i++) html += rowHtml(queue[i], i);
    rows.innerHTML = html;
    bindCoverFallback(rows);
  }

  function refresh() {
    spacer.style.height = `${player.queue.length * rowHeight}px`;
    render(true);
  }

  function reveal() {
    if (player.pos < 0) return;
    const lead = compact ? 0 : 2;
    scroller.scrollTop = root.offsetTop + Math.max(0, player.pos - lead) * rowHeight;
    render(true);
  }

  function clearDragUi() {
    cancelAnimationFrame(drag.frame);
    drag.frame = 0;
    drag.ghost?.remove();
    drag.ghost = null;
    indicator.style.display = 'none';
    root.classList.remove('dragging');
    document.body.classList.remove('reordering');
    rows.querySelectorAll('.row.dragging').forEach((el) => el.classList.remove('dragging'));
  }

  function detach() {
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
    document.removeEventListener('pointercancel', onPointerCancel);
    document.removeEventListener('keydown', onDragKey, true);
    window.removeEventListener('blur', onPointerCancel);
  }

  function stopDrag(commit) {
    const wasActive = drag.active;
    const from = drag.index;
    const to = drag.target;
    detach();
    clearDragUi();
    drag.pending = false;
    drag.active = false;
    drag.index = -1;
    drag.target = -1;
    if (wasActive) {
      suppressClick = true;
      setTimeout(() => {
        suppressClick = false;
      }, 60);
    }
    if (commit && wasActive && from >= 0 && to >= 0 && from !== to) moveQueue(from, to);
  }

  function tick() {
    if (!drag.active) return;
    const bounds = scroller.getBoundingClientRect();
    const zone = Math.min(56, bounds.height / 4);
    let speed = 0;
    if (drag.y < bounds.top + zone) speed = -Math.ceil(((bounds.top + zone - drag.y) / zone) * 18);
    else if (drag.y > bounds.bottom - zone) speed = Math.ceil(((drag.y - (bounds.bottom - zone)) / zone) * 18);
    if (speed) scroller.scrollTop += speed;

    const minY = bounds.top;
    const maxY = Math.max(minY, bounds.bottom - rowHeight);
    const ghostY = Math.min(Math.max(drag.y - drag.offsetY, minY), maxY);
    drag.ghost.style.transform = `translate3d(${drag.left}px, ${ghostY}px, 0) scale(1.02)`;

    const count = player.queue.length;
    const top = root.getBoundingClientRect().top;
    const center = ghostY + rowHeight / 2;
    const target = Math.max(0, Math.min(count - 1, Math.floor((center - top) / rowHeight)));
    drag.target = target;
    if (target === drag.index) {
      indicator.style.display = 'none';
    } else {
      indicator.style.display = 'block';
      indicator.style.top = `${(target > drag.index ? target + 1 : target) * rowHeight}px`;
    }
    drag.frame = requestAnimationFrame(tick);
  }

  function startDrag() {
    const row = rows.querySelector(`.row[data-index="${drag.index}"]`);
    if (!row) {
      stopDrag(false);
      return;
    }
    const box = row.getBoundingClientRect();
    drag.active = true;
    drag.pending = false;
    drag.offsetY = drag.startY - box.top;
    drag.left = box.left;
    drag.target = drag.index;

    const ghost = document.createElement('div');
    ghost.className = `qlist q-ghost${compact ? ' compact' : ''}`;
    ghost.style.width = `${box.width}px`;
    ghost.style.height = `${rowHeight}px`;
    const clone = row.cloneNode(true);
    clone.classList.remove('done', 'dragging');
    ghost.append(clone);
    document.body.append(ghost);
    drag.ghost = ghost;

    row.classList.add('dragging');
    root.classList.add('dragging');
    document.body.classList.add('reordering');
    tick();
  }

  function onPointerMove(event) {
    drag.y = event.clientY;
    if (drag.pending && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) >= 5) startDrag();
    if (drag.active) event.preventDefault();
  }

  function onPointerUp() {
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

  root.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || drag.pending || drag.active) return;
    if (event.target.closest('button, a, input')) return;
    const row = event.target.closest('.row');
    if (!row || player.queue.length < 2) return;
    drag.pending = true;
    drag.index = Number(row.dataset.index);
    drag.startX = event.clientX;
    drag.startY = event.clientY;
    drag.y = event.clientY;
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointercancel', onPointerCancel);
    document.addEventListener('keydown', onDragKey, true);
    window.addEventListener('blur', onPointerCancel);
  });

  root.addEventListener('click', (event) => {
    if (suppressClick) return;
    const row = event.target.closest('.row');
    if (!row) return;
    const index = Number(row.dataset.index);
    if (event.target.closest('[data-remove]')) removeAt(index);
    else jumpTo(index);
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
  const offs = [
    on('queue', (detail) => {
      refresh();
      if (detail?.reveal) reveal();
    }),
    on('track', () => {
      render(true);
      if (compact) reveal();
    }),
    on('playstate', () => render(true)),
  ];

  refresh();

  return {
    el: root,
    refresh,
    reveal,
    destroy() {
      stopDrag(false);
      scroller.removeEventListener('scroll', onScroll);
      resizeObserver.disconnect();
      cancelAnimationFrame(frame);
      offs.forEach((off) => off());
    },
  };
}
