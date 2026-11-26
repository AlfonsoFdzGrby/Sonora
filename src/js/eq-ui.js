import { askText, confirmDialog, modal } from './overlays.js';
import { $, esc } from './util.js';
import { icon } from './visual.js';
import * as eq from './eq.js';

const W = 640;
const H = 240;
const AXIS = 22;
const VH = H + AXIS;
const MIN_F = 20;
const MAX_F = 20000;
const MAX_DB = 15;
const F_TICKS = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
const DB_TICKS = [12, 6, 0, -6, -12];

const freqs = new Float32Array(180);
for (let i = 0; i < freqs.length; i += 1) {
  freqs[i] = MIN_F * (MAX_F / MIN_F) ** (i / (freqs.length - 1));
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const xOf = (freq) => (Math.log(clamp(freq, MIN_F, MAX_F) / MIN_F) / Math.log(MAX_F / MIN_F)) * W;
const yOf = (db) => clamp(H / 2 - (db / MAX_DB) * (H / 2), 0, H);
const freqOf = (x) => MIN_F * (MAX_F / MIN_F) ** (clamp(x, 0, W) / W);
const dbOf = (y) => clamp(((H / 2 - y) / (H / 2)) * MAX_DB, eq.GAIN_MIN, eq.GAIN_MAX);

const dbLabel = (value) => `${value > 0.049 ? '+' : ''}${Number(value).toFixed(1).replace(/\.0$/, '').replace(/^-0$/, '0')} dB`;
const hzLabel = (value) => (value >= 1000 ? `${(value / 1000).toFixed(1).replace(/\.0$/, '')} kHz` : `${Math.round(value)} Hz`);
const tickLabel = (value) => (value >= 1000 ? `${value / 1000}k` : `${value}`);

const alerts = [];
const activeAlerts = () => alerts.filter((entry) => !entry.fading);
function dismissAlert(entry) {
  clearTimeout(entry.fade);
  clearTimeout(entry.remove);
  entry.el.remove();
  const index = alerts.indexOf(entry);
  if (index >= 0) alerts.splice(index, 1);
}
function fadeAlert(entry, leaving = false) {
  if (entry.fading) return;
  entry.fading = true;
  clearTimeout(entry.fade);
  clearTimeout(entry.remove);
  entry.el.classList.remove('show');
  if (leaving) entry.el.classList.add('leaving');
  entry.remove = setTimeout(() => dismissAlert(entry), 250);
}
function alertEq(message, kind = 'info') {
  const root = $('#toast-root');
  if (!root) return;
  while (activeAlerts().length >= 3) fadeAlert(activeAlerts()[0], true);
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  root.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  const entry = { el, fading: false };
  alerts.push(entry);
  entry.fade = setTimeout(() => fadeAlert(entry), 3600);
}

let analysis = null;
function response(bands) {
  if (!analysis) {
    const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!Offline) return null;
    const context = new Offline(1, 1, 44100);
    const filters = eq.BANDS.map(() => context.createBiquadFilter());
    analysis = {
      filters,
      mag: filters.map(() => new Float32Array(freqs.length)),
      phase: filters.map(() => new Float32Array(freqs.length)),
    };
  }
  const total = new Float32Array(freqs.length).fill(1);
  analysis.filters.forEach((node, index) => {
    const definition = eq.BANDS[index];
    const band = bands[index];
    node.type = definition.type;
    node.frequency.value = band.freq;
    node.Q.value = band.q;
    node.gain.value = band.gain;
    node.getFrequencyResponse(freqs, analysis.mag[index], analysis.phase[index]);
    for (let i = 0; i < total.length; i += 1) total[i] *= analysis.mag[index][i];
  });
  return Array.from(total, (value) => 20 * Math.log10(Math.max(value, 1e-6)));
}

const gridMarkup = `
  ${DB_TICKS.map((db) => `<line class="eq-grid-line${db === 0 ? ' eq-zero' : ''}" x1="0" y1="${yOf(db)}" x2="${W}" y2="${yOf(db)}"/><text class="eq-grid-label" x="6" y="${yOf(db) - 4}">${db > 0 ? '+' : ''}${db}</text>`).join('')}
  ${F_TICKS.map((f) => `<line class="eq-grid-line" x1="${xOf(f)}" y1="0" x2="${xOf(f)}" y2="${H}"/><text class="eq-axis-label" x="${xOf(f)}" y="${H + 15}" text-anchor="${f === MIN_F ? 'start' : f === MAX_F ? 'end' : 'middle'}">${tickLabel(f)}</text>`).join('')}`;

const nodesMarkup = eq.BANDS.map((band) => `
  <g class="eq-node" data-band="${band.id}">
    <line class="eq-guide"/>
    <circle class="eq-halo" r="16"/>
    <circle class="eq-point" r="7" tabindex="0" role="slider" aria-label="${esc(band.label)}" aria-valuemin="${eq.GAIN_MIN}" aria-valuemax="${eq.GAIN_MAX}"/>
  </g>`).join('');

const bandCardsMarkup = eq.BANDS.map((band) => `
  <div class="eq-band" data-card="${band.id}">
    <span class="eq-band-name">${esc(band.label)}</span>
    <strong class="eq-band-gain" data-gain></strong>
    <div class="eq-meter"><i></i></div>
    <div class="eq-band-meta"><span data-freq></span><span data-extra></span></div>
  </div>`).join('');

const presetChip = (kind, preset) => `<button class="eq-chip" data-preset="${kind}:${esc(preset.name)}">${esc(preset.name)}</button>`;

const userChipsMarkup = () => {
  const active = eq.activePresetName();
  const removable = eq.userPresets().some((preset) => preset.name === active);
  return `${eq.userPresets().map((preset) => presetChip('user', preset)).join('')}
    <button class="eq-chip add" data-save>${icon('plus', 14)}Guardar actual</button>
    <button class="eq-chip remove" data-delete ${removable ? '' : 'disabled'}>${icon('trash', 14)}Eliminar</button>`;
};

export function openEqualizer() {
  eq.prepare();

  const body = document.createElement('div');
  if (!eq.supported()) {
    body.innerHTML = '<p class="hint">Este WebView no admite Web Audio, así que el ecualizador no está disponible.</p>';
    modal({ title: 'Ecualizador', content: body, className: 'eq-modal' });
    return;
  }

  body.className = 'eq-shell';
  body.innerHTML = `
    <section class="eq-card eq-hero">
      <span class="eq-hero-ico">${icon('sliders', 20)}</span>
      <div class="eq-hero-text">
        <strong>Ecualizador de 5 bandas</strong>
        <span data-status></span>
      </div>
      <label class="eq-switch">
        <input type="checkbox" id="eq-enabled" aria-label="Activar ecualizador">
        <span class="eq-switch-track"><span class="eq-switch-thumb"></span></span>
      </label>
    </section>

    <section class="eq-card eq-chart-card">
      <div class="eq-stage">
        <svg class="eq-chart" viewBox="0 0 ${W} ${VH}" role="img" aria-label="Curva de respuesta del ecualizador">
          <defs>
            <linearGradient id="eq-stroke" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${W}" y2="0">
              <stop offset="0" style="stop-color: var(--accent)"/>
              <stop offset="1" style="stop-color: var(--accent-2)"/>
            </linearGradient>
          </defs>
          <g class="eq-grid">${gridMarkup}</g>
          <path class="eq-area"></path>
          <path class="eq-curve"></path>
          <g class="eq-points">${nodesMarkup}</g>
        </svg>
        <div class="eq-tip" role="status"></div>
      </div>
      <button class="btn sm ghost eq-chart-reset" data-reset title="Volver a la curva plana">${icon('refresh', 15)}Restablecer curva</button>
      <p class="eq-chart-hint">Arrastra los puntos para ajustar frecuencia y ganancia. Doble clic para reiniciar una banda.</p>
    </section>

    <section class="eq-card eq-q-card">
      <div class="eq-q-head">
        <div class="eq-q-title">
          <strong>Ancho de las bandas medias</strong>
          <span>Factor Q de medios bajos, medios y medios altos</span>
        </div>
        <output class="eq-q-value" data-global-qvalue></output>
      </div>
      <div class="eq-q-row">
        <span>Amplio</span>
        <input type="range" class="range eq-q" id="eq-global-q" min="0.1" max="10" step="0.1" aria-label="Q de las bandas medias">
        <span>Estrecho</span>
      </div>
    </section>

    <div class="eq-bands">${bandCardsMarkup}</div>

    <section class="eq-presets">
      <div class="eq-preset-group">
        <div class="eq-group-head"><span class="eq-group-label">Incluidos</span></div>
        <div class="eq-chips">${eq.FACTORY_PRESETS.map((preset) => presetChip('factory', preset)).join('')}</div>
      </div>
      <div class="eq-preset-group">
        <div class="eq-group-head">
          <span class="eq-group-label">Tus presets</span>
          <span class="eq-group-note">Se guardan en este equipo</span>
        </div>
        <div class="eq-chips" data-user-chips>${userChipsMarkup()}</div>
      </div>
    </section>`;

  const svg = $('.eq-chart', body);
  const curve = $('.eq-curve', body);
  const area = $('.eq-area', body);
  const tip = $('.eq-tip', body);
  const toggle = $('#eq-enabled', body);
  const status = $('[data-status]', body);
  const qSlider = $('#eq-global-q', body);
  const qValue = $('[data-global-qvalue]', body);
  const userChips = $('[data-user-chips]', body);
  const nodes = new Map(eq.BANDS.map((band) => [band.id, $(`.eq-node[data-band="${band.id}"]`, body)]));
  const cards = new Map(eq.BANDS.map((band) => [band.id, $(`.eq-band[data-card="${band.id}"]`, body)]));

  let dragging = null;
  let hovered = null;
  let keyed = null;
  let lastClick = null;

  const markActive = () => {
    const active = eq.activePresetName();
    body.querySelectorAll('[data-preset]').forEach((chip) => {
      chip.classList.toggle('active', chip.dataset.preset.slice(chip.dataset.preset.indexOf(':') + 1) === active);
    });
    const remove = $('[data-delete]', body);
    if (remove) remove.disabled = !eq.userPresets().some((preset) => preset.name === active);
  };

  const renderUserChips = () => {
    userChips.innerHTML = userChipsMarkup();
    markActive();
  };

  const showTip = (id) => {
    const band = id ? eq.getBands().find((item) => item.id === id) : null;
    if (!band) {
      tip.classList.remove('show');
      return;
    }
    const definition = eq.BANDS.find((item) => item.id === id);
    const left = (xOf(band.freq) / W) * 100;
    const top = (yOf(band.gain) / VH) * 100;
    tip.textContent = `${definition.label} · ${hzLabel(band.freq)} · ${dbLabel(band.gain)}`;
    tip.style.left = `${left}%`;
    tip.style.top = `${top}%`;
    tip.style.setProperty('--tx', left < 16 ? '-12%' : left > 84 ? '-88%' : '-50%');
    tip.style.setProperty('--ty', top < 26 ? '18px' : 'calc(-100% - 18px)');
    tip.classList.add('show');
  };

  const syncFocus = () => {
    const id = dragging ?? hovered ?? keyed;
    nodes.forEach((node, key) => node.classList.toggle('hot', key === id));
    cards.forEach((card, key) => card.classList.toggle('hot', key === id));
    showTip(id);
  };

  const paint = () => {
    const bands = eq.getBands();
    const values = response(bands);
    const path = values
      ? values.map((db, index) => `${index ? 'L' : 'M'}${xOf(freqs[index]).toFixed(1)},${yOf(db).toFixed(1)}`).join(' ')
      : `M0,${H / 2} L${W},${H / 2}`;
    curve.setAttribute('d', path);
    area.setAttribute('d', `${path} L${W},${H / 2} L0,${H / 2} Z`);

    bands.forEach((band, index) => {
      const x = xOf(band.freq);
      const y = yOf(band.gain);
      const node = nodes.get(band.id);
      const guide = $('.eq-guide', node);
      guide.setAttribute('x1', x);
      guide.setAttribute('y1', y);
      guide.setAttribute('x2', x);
      guide.setAttribute('y2', H / 2);
      node.querySelectorAll('circle').forEach((circle) => {
        circle.setAttribute('cx', x);
        circle.setAttribute('cy', y);
      });
      const point = $('.eq-point', node);
      point.setAttribute('aria-valuenow', band.gain.toFixed(1));
      point.setAttribute('aria-valuetext', `${hzLabel(band.freq)}, ${dbLabel(band.gain)}`);

      const card = cards.get(band.id);
      $('[data-gain]', card).textContent = dbLabel(band.gain);
      $('[data-freq]', card).textContent = hzLabel(band.freq);
      $('[data-extra]', card).textContent = eq.BANDS[index].type === 'peaking' ? `Q ${band.q.toFixed(1)}` : 'Ancho fijo';
      const fill = $('.eq-meter i', card);
      const size = (Math.abs(band.gain) / eq.GAIN_MAX) * 50;
      fill.style.width = `${size}%`;
      fill.style.left = `${band.gain >= 0 ? 50 : 50 - size}%`;
    });

    const q = eq.getGlobalQ();
    qValue.textContent = q.toFixed(1);
    if (document.activeElement !== qSlider) qSlider.value = q;
    qSlider.style.setProperty('--fill', `${((q - 0.1) / 9.9) * 100}%`);

    const on = eq.isEnabled();
    toggle.checked = on;
    body.dataset.state = on ? 'on' : 'off';
    status.textContent = on ? 'Activado' : 'Desactivado';
    markActive();
    syncFocus();
  };

  const pointFromEvent = (event) => {
    const box = svg.getBoundingClientRect();
    return {
      x: ((event.clientX - box.left) / box.width) * W,
      y: ((event.clientY - box.top) / box.height) * VH,
    };
  };

  svg.addEventListener('pointerdown', (event) => {
    const node = event.target.closest('[data-band]');
    if (!node) return;
    const id = node.dataset.band;
    const now = performance.now();
    const { x, y } = pointFromEvent(event);
    if (lastClick && lastClick.id === id && now - lastClick.time < 400 && Math.hypot(x - lastClick.x, y - lastClick.y) < 18) {
      const definition = eq.BANDS.find((item) => item.id === id);
      eq.setBand(definition.id, { freq: definition.freq, gain: 0 });
      lastClick = null;
      dragging = null;
      svg.classList.remove('dragging');
      paint();
      event.preventDefault();
      return;
    }
    lastClick = { id, time: now, x, y };
    dragging = id;
    svg.classList.add('dragging');
    svg.setPointerCapture(event.pointerId);
    event.preventDefault();
    syncFocus();
  });
  svg.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const { x, y } = pointFromEvent(event);
    eq.setBand(dragging, { freq: freqOf(x), gain: dbOf(y) });
    paint();
  });
  const stopDrag = () => {
    if (!dragging) return;
    dragging = null;
    svg.classList.remove('dragging');
    syncFocus();
  };
  svg.addEventListener('pointerup', stopDrag);
  svg.addEventListener('pointercancel', stopDrag);

  svg.addEventListener('keydown', (event) => {
    const node = event.target.closest('[data-band]');
    if (!node) return;
    const band = eq.getBands().find((item) => item.id === node.dataset.band);
    const step = event.shiftKey ? 2 : 0.5;
    let patch = null;
    if (event.key === 'ArrowUp') patch = { gain: band.gain + step };
    else if (event.key === 'ArrowDown') patch = { gain: band.gain - step };
    else if (event.key === 'ArrowRight') patch = { freq: band.freq * (event.shiftKey ? 1.2 : 1.06) };
    else if (event.key === 'ArrowLeft') patch = { freq: band.freq / (event.shiftKey ? 1.2 : 1.06) };
    else if (event.key === 'Home') {
      const definition = eq.BANDS.find((item) => item.id === band.id);
      patch = { gain: 0, freq: definition.freq };
    }
    if (!patch) return;
    event.preventDefault();
    eq.setBand(band.id, patch);
    paint();
  });
  svg.addEventListener('focusin', (event) => {
    const node = event.target.closest('[data-band]');
    keyed = node ? node.dataset.band : null;
    syncFocus();
  });
  svg.addEventListener('focusout', () => {
    keyed = null;
    syncFocus();
  });

  body.addEventListener('pointerover', (event) => {
    const target = event.target.closest('[data-band], [data-card]');
    hovered = target ? target.dataset.band ?? target.dataset.card : null;
    syncFocus();
  });
  body.addEventListener('pointerleave', () => {
    hovered = null;
    syncFocus();
  });

  toggle.addEventListener('change', () => {
    eq.setEnabled(toggle.checked);
    paint();
  });
  body.addEventListener('input', (event) => {
    if (event.target.id === 'eq-global-q') {
      eq.setGlobalQ(Number(event.target.value));
      paint();
    }
  });
  body.addEventListener('click', async (event) => {
    const chip = event.target.closest('[data-preset]');
    if (chip) {
      const preset = eq.findPreset(chip.dataset.preset);
      if (preset) {
        eq.applyPreset(preset);
        paint();
        alertEq(`Preset «${preset.name}» aplicado`, 'success');
      }
      return;
    }
    if (event.target.closest('[data-reset]')) {
      eq.resetBands();
      paint();
      return;
    }
    if (event.target.closest('[data-save]')) {
      const active = eq.activePresetName();
      const isUser = eq.userPresets().some((preset) => preset.name === active);
      const name = await askText({
        title: 'Guardar preset',
        label: 'Nombre',
        value: isUser ? active : '',
        placeholder: 'Mi ecualización',
        confirmText: 'Guardar',
      });
      if (name === null) return;
      if (eq.FACTORY_PRESETS.some((preset) => preset.name.toLowerCase() === name.toLowerCase())) {
        alertEq('Ya hay un preset incluido con ese nombre', 'error');
        return;
      }
      eq.savePreset(name);
      renderUserChips();
      paint();
      alertEq(`Preset «${name}» guardado`, 'success');
      return;
    }
    const remove = event.target.closest('[data-delete]');
    if (remove && !remove.disabled) {
      const name = eq.activePresetName();
      const confirmed = await confirmDialog({
        title: 'Eliminar preset',
        message: `¿Eliminar el preset «${name}»?`,
        confirmText: 'Eliminar',
        danger: true,
      });
      if (confirmed && eq.deletePreset(name)) {
        renderUserChips();
        paint();
        alertEq('Preset eliminado', 'success');
      }
    }
  });

  modal({ title: 'Ecualizador', content: body, className: 'eq-modal' });
  paint();
}
