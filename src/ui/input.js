// Drag & drop with Pointer Events on the canvas (spec §7.1): one primary pointer, pick-up from a tray
// slot, finger lift with a mild upward gain, snapping, drop / fly-back. Pure input + geometry; the app
// decides what a drop does (game.place, sounds, haptics) inside the pointerup handler.
import { TIMING } from './theme.js';
import { slotAt, trayPieceRect } from './layout.js';
import { getShape } from '../core/shapes.js';
import { ease } from './effects.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * @typedef {object} Drag
 * @property {number} slot
 * @property {{ shapeId: string, color: number }} piece
 * @property {object} shape
 * @property {{ row: number, col: number } | null} target snapped valid placement
 * @property {{ cells: Array<{r: number, c: number}>, rows: number[], cols: number[] } | null} preview
 * @property {number} targetAt clock time the target last changed
 */

/**
 * @param {HTMLCanvasElement} canvas
 * @param {object} h
 * @param {{ now: number }} h.clock
 * @param {() => object} h.layout
 * @param {() => object} h.game
 * @param {() => boolean} h.enabled input allowed (no overlay, no game-over sequence)
 * @param {(slot: number) => void} h.onPick
 * @param {(slot: number, row: number, col: number, rect: object) => boolean} h.onDrop true when placed
 * @param {(slot: number, overBoard: boolean) => void} h.onReturn the piece flies back to the tray
 * @param {() => void} h.onActivity any pointer activity (wakes the loop, marks first interaction)
 */
export function createInput(canvas, h) {
  let drag = null;
  let returns = [];
  let origin = { left: 0, top: 0 };

  const pos = (e) => ({ x: e.clientX - origin.left, y: e.clientY - origin.top });
  let cursor = '';
  const setCursor = (c) => {
    if (c !== cursor) {
      cursor = c;
      canvas.style.cursor = c;
    }
  };

  // Mouse only: an open hand over a pickable tray piece.
  function hover(e) {
    if (e.pointerType !== 'mouse' || !h.enabled()) {
      setCursor('');
      return;
    }
    const r = canvas.getBoundingClientRect();
    const slot = slotAt(h.layout(), e.clientX - r.left, e.clientY - r.top);
    setCursor(slot >= 0 && h.game().hand[slot] ? 'grab' : '');
  }

  function logicalRect(d) {
    const cell = h.layout().board.cell;
    const w = d.shape.w * cell;
    const ht = d.shape.h * cell;
    if (d.touch) {
      const dx = d.p.x - d.p0.x;
      const dy = d.p.y - d.p0.y;
      return { x: d.base.x + dx, y: d.base.y + (dy < 0 ? dy * TIMING.upGain : dy), w, h: ht };
    }
    return { x: d.p.x - d.grab.gx * w, y: d.p.y - d.grab.gy * ht, w, h: ht };
  }

  // On-screen rect: grows from tray size to board size (slight overshoot) while it travels to the finger.
  function visualRect(d) {
    const lr = logicalRect(d);
    const t = h.clock.now - d.t0;
    if (t >= TIMING.pickup + TIMING.pickupSettle) return lr;
    const e = ease.outCubic(clamp01(t / TIMING.pickup));
    const over = t < TIMING.pickup ? 1 + 0.07 * e : 1 + 0.07 * (1 - ease.outQuad(clamp01((t - TIMING.pickup) / TIMING.pickupSettle)));
    const w = (d.from.w + (lr.w - d.from.w) * e) * over;
    const ht = (d.from.h + (lr.h - d.from.h) * e) * over;
    if (!d.touch) return { x: d.p.x - d.grab.gx * w, y: d.p.y - d.grab.gy * ht, w, h: ht };
    const fcx = d.from.x + d.from.w / 2;
    const fcy = d.from.y + d.from.h / 2;
    const cx = fcx + (lr.x + lr.w / 2 - fcx) * e;
    const cy = fcy + (lr.y + lr.h / 2 - fcy) * e;
    return { x: cx - w / 2, y: cy - ht / 2, w, h: ht };
  }

  // Nearest valid cell within ±0.75 cell of the piece's fractional top-left.
  function updateTarget() {
    const d = drag;
    const L = h.layout();
    const game = h.game();
    const lr = logicalRect(d);
    const { inner, cell } = L.board;
    const fr = (lr.y - inner.y) / cell;
    const fc = (lr.x - inner.x) / cell;
    const R = TIMING.snapRadius;
    const cands = [];
    for (let r = Math.ceil(fr - R); r <= Math.floor(fr + R); r++) {
      for (let c = Math.ceil(fc - R); c <= Math.floor(fc + R); c++) {
        cands.push({ r, c, d: (fr - r) * (fr - r) + (fc - c) * (fc - c) });
      }
    }
    cands.sort((a, b) => a.d - b.d);
    let target = null;
    for (const k of cands) {
      if (game.canPlace(d.slot, k.r, k.c)) {
        target = { row: k.r, col: k.c };
        break;
      }
    }
    const same = target && d.target ? target.row === d.target.row && target.col === d.target.col : target === d.target;
    if (!same) {
      d.target = target;
      d.targetAt = h.clock.now;
      d.preview = target ? game.preview(d.slot, target.row, target.col) : null;
    }
  }

  function finish(ok) {
    const d = drag;
    if (!d) return;
    drag = null;
    setCursor('');
    try {
      if (canvas.hasPointerCapture && canvas.hasPointerCapture(d.pointerId)) canvas.releasePointerCapture(d.pointerId);
    } catch {
      // ignore
    }
    const vr = visualRect(d);
    if (ok && d.target && h.onDrop(d.slot, d.target.row, d.target.col, vr)) return;
    returns = returns.filter((r) => r.slot !== d.slot);
    returns.push({ slot: d.slot, piece: d.piece, shape: d.shape, from: vr, t0: h.clock.now });
    const b = h.layout().board;
    const cx = vr.x + vr.w / 2;
    const cy = vr.y + vr.h / 2;
    const moved = Math.hypot(d.p.x - d.p0.x, d.p.y - d.p0.y) > 12; // a plain tap is not a failed drop
    h.onReturn(d.slot, ok && moved && cx >= b.x && cx <= b.x + b.size && cy >= b.y && cy <= b.y + b.size);
  }

  function onDown(e) {
    h.onActivity();
    if (drag || !e.isPrimary || !h.enabled()) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const r = canvas.getBoundingClientRect();
    origin = { left: r.left, top: r.top };
    const p = pos(e);
    const L = h.layout();
    const slot = slotAt(L, p.x, p.y);
    if (slot < 0) return;
    const piece = h.game().hand[slot];
    if (!piece) return;
    const shape = getShape(piece.shapeId);
    const cell = L.board.cell;
    const tr = trayPieceRect(L, slot, shape);
    const w = shape.w * cell;
    const ht = shape.h * cell;
    returns = returns.filter((x) => x.slot !== slot);
    drag = {
      slot,
      piece: { shapeId: piece.shapeId, color: piece.color, gem: h.game().handGems[slot] },
      shape,
      pointerId: e.pointerId,
      touch: e.pointerType !== 'mouse' && e.pointerType !== 'pen',
      t0: h.clock.now,
      from: tr,
      p0: p,
      p,
      base: { x: p.x - w / 2, y: p.y - TIMING.liftCells * cell - ht },
      grab: { gx: clamp01((p.x - tr.x) / Math.max(1, tr.w)), gy: clamp01((p.y - tr.y) / Math.max(1, tr.h)) },
      target: null,
      preview: null,
      targetAt: h.clock.now,
    };
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // ignore (synthetic events)
    }
    if (!drag.touch) setCursor('grabbing');
    updateTarget();
    h.onPick(slot);
  }

  function onMove(e) {
    if (!drag) {
      hover(e);
      return;
    }
    if (e.pointerId !== drag.pointerId) return;
    drag.p = pos(e);
    updateTarget();
    h.onActivity();
  }

  function onUp(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    drag.p = pos(e);
    updateTarget();
    finish(true);
    h.onActivity();
  }

  function onCancel(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    finish(false);
    h.onActivity();
  }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onCancel);
  canvas.addEventListener('lostpointercapture', onCancel);

  return {
    /** The active drag (or null). */
    get drag() {
      return drag;
    },
    /** Pieces flying back to the tray: [{ slot, piece, shape, rect, k }]. */
    returning() {
      const L = h.layout();
      return returns.map((r) => {
        const k = clamp01((h.clock.now - r.t0) / TIMING.returnToTray);
        const e = ease.outCubic(k);
        const to = trayPieceRect(L, r.slot, r.shape);
        return {
          slot: r.slot, piece: r.piece, shape: r.shape, k,
          rect: {
            x: r.from.x + (to.x - r.from.x) * e, y: r.from.y + (to.y - r.from.y) * e,
            w: r.from.w + (to.w - r.from.w) * e, h: r.from.h + (to.h - r.from.h) * e,
          },
        };
      });
    },
    /** On-screen rect of the dragged piece. */
    visualRect() {
      return drag ? visualRect(drag) : null;
    },
    /** Drops finished fly-backs. */
    update() {
      if (returns.length) returns = returns.filter((r) => h.clock.now - r.t0 < TIMING.returnToTray);
    },
    busy() {
      return drag !== null || returns.length > 0;
    },
    /** Cancels the drag: the piece flies back (or vanishes back instantly with `instant`). */
    cancel(instant = false) {
      if (!drag) {
        if (instant) returns = [];
        return;
      }
      if (instant) {
        drag = null;
        returns = [];
        setCursor('');
        return;
      }
      finish(false);
    },
    /** Re-validates the snapped target (after the board changed under a held piece). */
    refresh() {
      if (drag) {
        drag.target = null;
        updateTarget();
      }
    },
  };
}
