// Bootstrap: reads the URL flags (?seed, ?nosave, ?debug), starts the app and, only with ?debug=1, exposes
// window.__game4k plus an on-screen error box.
import { createApp } from './ui/app.js';

const params = new URLSearchParams(location.search);
const debug = params.get('debug') === '1';
const nosave = params.get('nosave') === '1';
const seedRaw = params.get('seed');
const seed = seedRaw !== null && seedRaw.trim() !== '' && Number.isFinite(Number(seedRaw)) ? Number(seedRaw) >>> 0 : null;

function showError(text) {
  const box = document.getElementById('errors');
  if (!box) return;
  box.hidden = false;
  box.textContent += `${text}\n`;
}

if (debug) {
  window.addEventListener('error', (e) => {
    showError(`${e.message || 'error'}${e.filename ? ` @ ${e.filename}:${e.lineno}:${e.colno}` : ''}`);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    showError(`unhandled rejection: ${r && (r.stack || r.message) ? r.stack || r.message : String(r)}`);
  });
}

function boot() {
  let app;
  try {
    app = createApp({ root: document.getElementById('app'), seed, nosave });
    app.start();
  } catch (err) {
    console.error(err);
    if (debug) showError(String(err && (err.stack || err.message)));
    return;
  }
  if (!debug) return;
  window.__game4k = {
    app,
    get game() {
      return app.game;
    },
    get layout() {
      return app.layout;
    },
    setBoard: (arr64) => app.setBoard(arr64),
    setHand: (shapeIds, colors) => app.setHand(shapeIds, colors),
    state: () => app.state(),
    forceGameOver: () => app.forceGameOver(),
  };
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
