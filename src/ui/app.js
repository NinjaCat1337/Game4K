// The app: owns the Game, persistence, settings and the flow (play → game-over sequence → result → new
// game), wires input/effects/HUD/overlays/platform services together and runs the single rAF loop
// (time-based, dt clamped, sleeps when nothing moves).
import { Game } from '../core/game.js';
import { KEYS, loadJSON, saveJSON, removeKey, requestPersistence } from '../platform/storage.js';
import { createAudio } from '../platform/audio.js';
import { createHaptics } from '../platform/haptics.js';
import { initServiceWorker } from '../platform/pwa.js';
import { isIOS, isStandalone, installTouchGuards, onViewportChange, readSafeInsets } from '../platform/device.js';
import { computeLayout } from './layout.js';
import { createSprites } from './sprites.js';
import { createRenderer } from './renderer.js';
import { createEffects } from './effects.js';
import { createInput } from './input.js';
import { createHud } from './hud.js';
import { createQuestHud } from './quests.js';
import { createOverlays } from './overlays.js';
import { TIMING, APP_VERSION, CSS_VARS } from './theme.js';

const isCount = (v) => Number.isSafeInteger(v) && v >= 0;

/**
 * Creates the app (nothing runs until start()).
 * @param {{ root: HTMLElement, seed?: number | null, nosave?: boolean }} opts
 *   seed: deterministic new game (ignores the save); nosave: no storage reads/writes
 * @returns {object}
 */
export function createApp(opts) {
  const root = opts.root;
  const canvas = root.querySelector('#game');
  const gear = root.querySelector('#gear');
  const persist = !opts.nosave;
  const clock = { now: 0 };

  // ---------------------------------------------------------------- persisted state
  const settings = { sound: true, vibration: true };
  const hints = { installDismissed: false };
  let best = 0;
  if (persist) {
    const s = loadJSON(KEYS.settings, {});
    if (typeof s.sound === 'boolean') settings.sound = s.sound;
    if (typeof s.vibration === 'boolean') settings.vibration = s.vibration;
    const b = loadJSON(KEYS.best, 0);
    best = isCount(b) ? b : 0;
    hints.installDismissed = loadJSON(KEYS.hints, {}).installDismissed === true;
  }

  let game = null;
  if (opts.seed !== null && opts.seed !== undefined) {
    game = new Game({ seed: opts.seed });
  } else if (persist) {
    const g = Game.fromJSON(loadJSON(KEYS.save, null));
    if (g && !g.over) game = g;
  }
  if (!game) game = new Game();
  if (game.score > best) best = game.score;
  let bestAtStart = best;
  // a resumed game that already holds the record has shown its "New High Score!" toast before
  let toastDone = game.score > 0 && game.score >= best;

  // ---------------------------------------------------------------- services & modules
  const reducedMQ = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  const sprites = createSprites();
  const renderer = createRenderer(canvas, sprites);
  const fx = createEffects({ clock, sprites, reduced: () => !!(reducedMQ && reducedMQ.matches) });
  const hud = createHud({ clock, gear });
  const questHud = createQuestHud(root);
  const audio = createAudio();
  const haptics = createHaptics();
  audio.muted = !settings.sound;
  haptics.enabled = settings.vibration;

  let phase = 'play'; // 'play' | 'over' (game-over sequence) | 'result'
  let layout = null;
  let metrics = null;
  let raf = 0;
  let lastTs = 0;
  let pageHidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
  let interacted = false;
  let swApi = null;
  let pendingUpdate = false;
  const reported = new Set();

  const overlays = createOverlays({
    root,
    clock,
    onPlay,
    onToggle,
    onRestart: () => {
      overlays.closeSettings();
      newGame(true);
      applyPendingUpdate();
    },
    onClose: () => {
      overlays.closeSettings();
      wake();
    },
    onDismissHint: () => {
      hints.installDismissed = true;
      if (persist) saveJSON(KEYS.hints, hints);
      overlays.setHint(false);
      relayout();
    },
    onUpdate: () => {
      saveGame();
      if (swApi && swApi.applyUpdate()) overlays.setUpdate(false);
    },
    onClick: () => {
      interacted = true;
      audio.unlock();
      audio.play('click');
    },
  });

  const input = createInput(canvas, {
    clock,
    layout: () => layout,
    game: () => game,
    enabled: () => phase === 'play' && !overlays.settingsOpen && layout !== null,
    onPick: () => {
      audio.play('pick');
      wake();
    },
    onDrop,
    onReturn: (slot, overBoard) => {
      if (overBoard) audio.play('invalid');
      wake();
    },
    onActivity: () => {
      interacted = true;
      wake();
    },
  });

  // ---------------------------------------------------------------- loop
  const perf = { n: 0, sum: 0, max: 0, slow: 0 }; // JS time per frame (debug stats)

  function frame(ts) {
    raf = 0;
    const gap = lastTs ? ts - lastTs : 0;
    const dt = lastTs ? Math.min(Math.max(0, gap / 1000), TIMING.dtMax) : 0;
    lastTs = ts;
    clock.now += dt;
    const t0 = performance.now();
    try {
      fx.update(dt);
      const d = input.drag;
      fx.preview(dt, d ? d.preview : null, d ? d.piece.color : 0);
      input.update();
      hud.update();
      overlays.update();
      renderer.draw({ game, fx, hud, input, clock });
    } catch (err) {
      report(err);
    }
    const spent = performance.now() - t0;
    perf.n++;
    perf.sum += spent;
    perf.max = Math.max(perf.max, spent);
    if (gap > 25) perf.slow++;
    if (fx.busy() || input.busy() || hud.busy() || overlays.busy()) wake();
    else lastTs = 0;
  }

  function wake() {
    if (!raf && !pageHidden && layout) raf = requestAnimationFrame(frame);
  }

  function drawNow() {
    if (!layout) return;
    try {
      renderer.draw({ game, fx, hud, input, clock });
    } catch (err) {
      report(err);
    }
  }

  function report(err) {
    const key = String(err && err.message);
    if (reported.has(key)) return;
    reported.add(key);
    console.error(err);
  }

  // ---------------------------------------------------------------- layout
  function relayout(m) {
    if (m) metrics = m;
    if (!metrics) return;
    const next = computeLayout({ ...metrics, reserveBottom: overlays.hintHeight() });
    const changed = !layout || next.width !== layout.width || next.height !== layout.height ||
      next.dpr !== layout.dpr || next.board.cell !== layout.board.cell || next.board.x !== layout.board.x ||
      next.board.y !== layout.board.y || next.tray.y !== layout.tray.y || next.mode !== layout.mode;
    if (!changed) return;
    input.cancel(true);
    layout = next;
    root.style.setProperty('--u', `${Math.min(next.width / 100, next.height / 160).toFixed(3)}px`);
    root.classList.toggle('short', next.height < 560);
    renderer.resize(layout);
    fx.setLayout(layout);
    hud.place(layout);
    questHud.place(layout);
    overlays.placePill(layout);
    drawNow();
    wake();
  }

  function measure() {
    const r = root.getBoundingClientRect();
    return { width: r.width, height: r.height, dpr: Math.min(window.devicePixelRatio || 1, 3), safe: readSafeInsets() };
  }

  // ---------------------------------------------------------------- persistence
  function saveGame() {
    if (!persist) return;
    if (game.over) removeKey(KEYS.save);
    else saveJSON(KEYS.save, game.toJSON());
  }

  function saveBest() {
    if (persist) saveJSON(KEYS.best, best);
  }

  // ---------------------------------------------------------------- moves
  // Runs synchronously inside pointerup (haptics need the user gesture).
  function onDrop(slot, row, col, rect) {
    const res = game.place(slot, row, col);
    if (!res) return false;
    questHud.update(game, res.questsCompleted);
    audio.unlock();
    if (res.lines >= 4 || res.allClear) haptics.impact('heavy');
    else if (res.lines > 0) haptics.impact('medium');
    else haptics.tick();
    audio.play('place');

    const passedBest = !toastDone && bestAtStart > 0 && res.scoreAfter > bestAtStart;
    if (passedBest) toastDone = true;
    fx.onMove(res, { layout, rect, passedBest });
    fx.slotPoof(slot);
    fx.setCombo(res.streak >= 2);
    const t = clock.now;
    if (res.lines > 0) {
      fx.cue(t + TIMING.clearSoundDelay, () => audio.play('clear', { lines: res.lines, streak: res.streakBefore }));
    }
    if (res.perfect) fx.cue(t + TIMING.perfectDelay, () => audio.play('perfect'));
    else if (res.allClear) fx.cue(t + TIMING.textDelay, () => audio.play('perfect'));
    else if (res.questsCompleted.length) fx.cue(t + TIMING.textDelay, () => audio.play('perfect'));
    hud.add(res.scoreAfter, res.points.total);
    if (res.scoreAfter > best) {
      best = res.scoreAfter;
      saveBest();
    }
    if (res.newHand) {
      fx.dealTray(t + (res.lines > 0 ? TIMING.trayDelayClear : TIMING.trayDelayPlain), () => audio.play('deal'));
    }
    if (res.over) startGameOver();
    else saveGame();
    wake();
    return true;
  }

  // ---------------------------------------------------------------- game over → result → new game
  function startGameOver() {
    if (phase !== 'play') return;
    phase = 'over';
    input.cancel(true);
    fx.setCombo(false);
    saveGame();
    const at = clock.now + TIMING.gameOverDelay;
    const { resultAt } = fx.startGameOver(game.board, at);
    fx.cue(at, () => audio.play('gameover'));
    fx.cue(resultAt, showResult);
    wake();
  }

  function showResult() {
    phase = 'result';
    const isNewBest = game.score > bestAtStart && game.score > 0;
    overlays.showResult({ score: game.score, best, isNewBest, quests: game.quests.completed, height: layout ? layout.height : 800 });
    if (isNewBest) fx.cue(clock.now + 0.3, () => audio.play('newbest'));
    wake();
  }

  function onPlay() {
    overlays.hideResult();
    newGame(false);
    applyPendingUpdate();
  }

  function newGame(wipe) {
    const old = game.board;
    input.cancel(true);
    fx.reset();
    if (wipe) fx.wipe(old);
    game.restart();
    phase = 'play';
    bestAtStart = best;
    toastDone = false;
    hud.reset(0, best);
    questHud.reset(game);
    fx.setCombo(false);
    fx.dealTray(clock.now + (wipe ? 0.3 : 0.18), () => audio.play('deal'));
    saveGame();
    wake();
  }

  // A new version is waiting: apply it right away before the first interaction, else show the pill
  // (it is also applied automatically when the next game starts).
  function onUpdateReady(api) {
    swApi = api;
    pendingUpdate = true;
    if (!interacted) {
      saveGame();
      if (api.applyUpdate()) return;
    }
    overlays.setUpdate(true, layout);
  }

  function applyPendingUpdate() {
    if (!pendingUpdate || !swApi || !swApi.hasUpdate()) return;
    saveGame();
    if (swApi.applyUpdate()) overlays.setUpdate(false);
  }

  // ---------------------------------------------------------------- settings
  function openSettings() {
    if (phase !== 'play' || overlays.settingsOpen) return;
    input.cancel();
    overlays.openSettings(settings);
    wake();
  }

  function onToggle(key) {
    if (key !== 'sound' && key !== 'vibration') return false;
    settings[key] = !settings[key];
    audio.muted = !settings.sound;
    haptics.enabled = settings.vibration;
    if (key === 'vibration' && settings.vibration) haptics.tick();
    if (persist) saveJSON(KEYS.settings, settings);
    return settings[key];
  }

  // ---------------------------------------------------------------- debug helpers
  function afterDebugChange() {
    input.refresh();
    questHud.update(game);
    if (phase === 'play' && game.over) startGameOver();
    else saveGame();
    drawNow();
    wake();
  }

  function onFontsReady() {
    sprites.clearTexts();
    relayout(); // the install hint may have changed height with the web font
    drawNow();
    wake();
  }

  function loadFonts() {
    let loaded = false;
    try {
      if (!document.fonts || typeof document.fonts.load !== 'function') return;
      Promise.all([document.fonts.load('900 32px Nunito'), document.fonts.load('800 32px Nunito')])
        .then(() => {
          loaded = true;
          onFontsReady();
        }, () => {});
      setTimeout(() => {
        if (!loaded) onFontsReady(); // fallback redraw if the load never settles
      }, 3000);
    } catch {
      // ignore
    }
  }

  function showVersion() {
    overlays.setVersion(`Game4K v${APP_VERSION}`);
    try {
      if (typeof caches === 'undefined') return;
      caches.keys().then((keys) => {
        const k = keys.find((n) => n.startsWith('game4k-'));
        if (k) overlays.setVersion(`Game4K v${APP_VERSION} · build ${k.slice(7)}`);
      }, () => {});
    } catch {
      // ignore
    }
  }

  const app = {
    get game() {
      return game;
    },
    get layout() {
      return layout;
    },
    get phase() {
      return phase;
    },

    /** Boots everything: layout, first frame, listeners, fonts, service worker. */
    start() {
      Object.keys(CSS_VARS).forEach((k) => root.style.setProperty(k, CSS_VARS[k]));
      installTouchGuards(canvas);
      gear.addEventListener('click', (e) => {
        e.preventDefault();
        interacted = true;
        audio.unlock();
        audio.play('click');
        openSettings();
      });
      window.addEventListener('pointerdown', () => { interacted = true; }, { capture: true, passive: true });

      const showHint = isIOS() && !isStandalone() && !hints.installDismissed;
      overlays.setHint(showHint);
      hud.reset(game.score, bestAtStart);
      questHud.reset(game);
      fx.setCombo(game.streak >= 2);
      relayout(measure());
      onViewportChange(root, (m) => relayout(m));
      fx.dealTray(clock.now + 0.2, () => audio.play('deal'));

      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          pageHidden = true;
          input.cancel(true);
          saveGame();
        } else {
          pageHidden = false;
          lastTs = 0;
          drawNow();
          wake();
        }
      });
      window.addEventListener('pagehide', saveGame);
      window.addEventListener('pageshow', () => {
        pageHidden = document.visibilityState === 'hidden';
        drawNow();
        wake();
      });

      loadFonts();
      showVersion();
      if (persist) requestPersistence();
      initServiceWorker({
        onUpdateReady,
        beforeReload: saveGame,
      }).then((api) => {
        if (api) swApi = api;
      }, () => {});
      wake();
    },

    /** Debug/test: replace the board (64 ints 0..7), re-render, recompute game over. */
    setBoard(arr64) {
      game.setBoard(arr64);
      fx.setCombo(game.streak >= 2);
      afterDebugChange();
    },

    /** Debug/test: replace the tray (shape ids), re-render, recompute game over. */
    setHand(shapeIds, colors) {
      input.cancel(true);
      game.setHand(shapeIds, colors);
      fx.dealTray(clock.now, null);
      afterDebugChange();
    },

    /** Debug/test: a board + tray where nothing fits → the game-over sequence starts. */
    forceGameOver() {
      if (phase !== 'play') return;
      input.cancel(true);
      game.setHand(['o3', 'i5h', 'i5v']);
      const b = [];
      for (let i = 0; i < 64; i++) {
        const r = Math.floor(i / 8);
        const c = i % 8;
        b.push((r + c) % 3 === 0 ? 1 + ((r * 3 + c) % 7) : 0);
      }
      game.setBoard(b);
      afterDebugChange();
    },

    /** Debug/test snapshot. */
    state() {
      const d = input.drag;
      return {
        phase,
        score: game.score,
        shownScore: hud.shown,
        best,
        bestAtStart,
        streak: game.streak,
        misses: game.misses,
        moves: game.moves,
        over: game.over,
        hand: game.hand.map((p) => (p ? { shapeId: p.shapeId, color: p.color } : null)),
        board: Array.from(game.board),
        gems: Array.from(game.gems),
        handGems: game.handGems.slice(),
        quests: game.toJSON().quests,
        dragging: !!d,
        target: d && d.target ? { ...d.target } : null,
        settingsOpen: overlays.settingsOpen,
        resultOpen: overlays.resultOpen,
        mode: layout ? layout.mode : null,
        cell: layout ? layout.board.cell : 0,
        settings: { ...settings },
        audio: audio.state,
        updatePending: pendingUpdate,
        fx: fx.stats(),
        perf: { frames: perf.n, avgMs: perf.n ? +(perf.sum / perf.n).toFixed(3) : 0, maxMs: +perf.max.toFixed(3), slowFrames: perf.slow },
      };
    },

    /** Debug/test: resets the frame-time stats. */
    resetPerf() {
      perf.n = 0;
      perf.sum = 0;
      perf.max = 0;
      perf.slow = 0;
    },

    /** Debug/test: runs the update-ready path with a stub (shows the Update pill). */
    simulateUpdate() {
      interacted = true;
      onUpdateReady({ applyUpdate: () => false, hasUpdate: () => true, check() {} });
    },

    /** Debug/test: render synchronously now. */
    redraw() {
      drawNow();
      wake();
    },
  };
  return app;
}
