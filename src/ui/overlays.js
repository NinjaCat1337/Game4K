// DOM overlays: result screens (count-up, delayed play button, confetti), settings panel with an in-panel
// restart confirmation, the "Update" pill and the iOS install hint. (The debug error box is main.js's.)
import { TIMING, CONFETTI_COLORS } from './theme.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const outCubic = (t) => 1 - Math.pow(1 - t, 3);
const CLOSE_MS = 320;

/**
 * @param {object} o
 * @param {HTMLElement} o.root #app
 * @param {{ now: number }} o.clock
 * @param {() => void} o.onPlay play button on the result screen
 * @param {(key: 'sound'|'vibration') => boolean} o.onToggle flips a setting, returns its new value
 * @param {() => void} o.onRestart restart confirmed
 * @param {() => void} o.onClose settings closed (resume)
 * @param {() => void} o.onDismissHint
 * @param {() => void} o.onUpdate update pill tapped
 * @param {() => void} o.onClick any overlay button (click sound)
 */
export function createOverlays(o) {
  const $ = (sel) => o.root.querySelector(sel);
  const el = {
    result: $('#result'),
    title: $('#result .result-title'),
    score: $('#result .result-score'),
    bestValue: $('#result .result-best-value'),
    play: $('#result .play'),
    confetti: $('#result .confetti'),
    settings: $('#settings'),
    backdrop: $('#settings .settings-backdrop'),
    toggles: Array.from(o.root.querySelectorAll('#settings [data-toggle]')),
    restart: $('#settings .btn-restart'),
    confirm: $('#settings .confirm'),
    yes: $('#settings .btn-yes'),
    cancel: $('#settings .btn-cancel'),
    resume: $('#settings .btn-resume'),
    version: $('#settings .version'),
    pill: $('#update-pill'),
    hint: $('#install-hint'),
    hintClose: $('#install-hint .install-close'),
  };
  let count = null;
  const timers = new Map();

  function open(node) {
    clearTimeout(timers.get(node));
    node.hidden = false;
    void node.offsetWidth; // commit the closed state so the transition runs
    node.classList.add('open');
  }

  function close(node, after) {
    node.classList.remove('open');
    clearTimeout(timers.get(node));
    timers.set(node, setTimeout(() => {
      if (node.classList.contains('open')) return; // reopened meanwhile
      node.hidden = true;
      if (after) after();
    }, CLOSE_MS));
  }

  const click = (fn) => (e) => {
    e.preventDefault();
    o.onClick();
    fn(e);
  };

  // result screen
  el.play.addEventListener('click', click(() => {
    if (!el.play.classList.contains('show')) return;
    el.play.classList.remove('show');
    el.play.disabled = true;
    o.onPlay();
  }));

  // settings
  el.toggles.forEach((btn) => {
    btn.addEventListener('click', click(() => {
      const v = o.onToggle(btn.dataset.toggle);
      btn.setAttribute('aria-checked', v ? 'true' : 'false');
    }));
  });
  const showConfirm = (on) => {
    el.confirm.hidden = !on;
    el.restart.hidden = on;
  };
  el.restart.addEventListener('click', click(() => showConfirm(true)));
  el.cancel.addEventListener('click', click(() => showConfirm(false)));
  el.yes.addEventListener('click', click(() => o.onRestart()));
  el.resume.addEventListener('click', click(() => o.onClose()));
  el.backdrop.addEventListener('click', () => o.onClose());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && el.settings.classList.contains('open')) o.onClose();
  });

  el.pill.addEventListener('click', click(() => o.onUpdate()));
  el.hintClose.addEventListener('click', click(() => o.onDismissHint()));

  function placePill(L) {
    if (el.pill.hidden) return;
    const w = el.pill.offsetWidth || 90;
    const h = el.pill.offsetHeight || 30;
    el.pill.style.left = `${Math.round(L.hud.score.x - w / 2)}px`;
    el.pill.style.top = `${Math.round(L.hud.best.y - h / 2)}px`;
  }

  function spawnConfetti(height) {
    const frag = document.createDocumentFragment();
    for (let i = 0; i < 44; i++) {
      const p = document.createElement('i');
      const w = 6 + Math.random() * 7;
      const s = p.style;
      s.setProperty('--x', `${(Math.random() * 100).toFixed(1)}%`);
      s.setProperty('--w', `${w.toFixed(1)}px`);
      s.setProperty('--h', `${(w * (0.45 + Math.random() * 0.5)).toFixed(1)}px`);
      s.setProperty('--c', CONFETTI_COLORS[i % CONFETTI_COLORS.length]);
      s.setProperty('--d', `${(2.4 + Math.random() * 2).toFixed(2)}s`);
      s.setProperty('--delay', `${(0.25 + Math.random() * 1.4).toFixed(2)}s`);
      s.setProperty('--dx', `${((Math.random() - 0.5) * 120).toFixed(0)}px`);
      s.setProperty('--fall', `${Math.round(height + 60)}px`);
      s.setProperty('--rot', `${Math.round((Math.random() - 0.5) * 1080)}deg`);
      frag.appendChild(p);
    }
    el.confetti.appendChild(frag);
  }

  return {
    /**
     * Shows the result screen: purple "Best Score!" (new best) or blue "Game Over". The score counts up
     * from 0, then the play button fades in.
     * @param {{ score: number, best: number, isNewBest: boolean, height: number }} r
     */
    showResult(r) {
      const n = el.result;
      n.classList.toggle('is-best', r.isNewBest);
      n.classList.toggle('is-over', !r.isNewBest);
      n.classList.remove('anim');
      el.title.textContent = r.isNewBest ? 'Best Score!' : 'Game Over';
      el.score.textContent = '0';
      el.bestValue.textContent = String(r.best);
      el.play.classList.remove('show');
      el.play.disabled = true;
      el.confetti.textContent = '';
      if (r.isNewBest) spawnConfetti(r.height);
      open(n);
      void n.offsetWidth;
      n.classList.add('anim');
      count = { start: o.clock.now + TIMING.resultCountDelay, to: r.score, shown: 0, playAt: -1 };
    },

    hideResult() {
      count = null;
      close(el.result, () => {
        el.confetti.textContent = '';
        el.result.classList.remove('anim');
      });
    },

    get resultOpen() {
      return el.result.classList.contains('open');
    },

    /** Advances the result count-up; returns nothing. */
    update() {
      if (!count) return;
      const t = o.clock.now;
      if (count.playAt < 0) {
        const k = clamp01((t - count.start) / TIMING.resultCount);
        const v = Math.round(count.to * outCubic(k));
        if (v !== count.shown) {
          count.shown = v;
          el.score.textContent = String(v);
        }
        if (k >= 1) count.playAt = t + TIMING.playDelay;
      } else if (t >= count.playAt) {
        el.play.disabled = false;
        el.play.classList.add('show');
        count = null;
      }
    },

    busy() {
      return count !== null;
    },

    /** Opens the settings panel with the current values. */
    openSettings(values) {
      el.toggles.forEach((btn) => {
        btn.setAttribute('aria-checked', values[btn.dataset.toggle] ? 'true' : 'false');
      });
      showConfirm(false);
      open(el.settings);
    },

    closeSettings() {
      close(el.settings);
    },

    get settingsOpen() {
      return el.settings.classList.contains('open');
    },

    setVersion(text) {
      el.version.textContent = text;
    },

    /** Shows/hides the "Update" pill, centered on the best-score row. */
    setUpdate(visible, layout) {
      el.pill.hidden = !visible;
      if (visible && layout) placePill(layout);
    },

    placePill,

    setHint(visible) {
      el.hint.hidden = !visible;
    },

    /** Height the install hint occupies at the bottom (0 when hidden). */
    hintHeight() {
      return el.hint.hidden ? 0 : el.hint.offsetHeight + 16;
    },
  };
}
