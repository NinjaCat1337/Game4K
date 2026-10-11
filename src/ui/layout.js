// Screen layout: where the HUD, the board and the tray go (spec §6). Pure functions of the root size,
// the safe-area insets and the device pixel ratio; everything is in CSS px.
import { LAYOUT } from './theme.js';

const N = 8;

/**
 * @typedef {{ x: number, y: number, w: number, h: number, cx: number, cy: number }} Slot
 * @typedef {object} Layout
 * @property {number} dpr
 * @property {number} width
 * @property {number} height
 * @property {'portrait'|'side'} mode
 * @property {{ top: number, right: number, bottom: number, left: number }} safe
 * @property {{ x: number, y: number, w: number, h: number }} usable
 * @property {{ best: { x: number, y: number, size: number }, score: { x: number, y: number, size: number },
 *   gear: { x: number, y: number, size: number } }} hud
 * @property {{ x: number, y: number, size: number, cell: number, pad: number, inner: { x: number, y: number },
 *   innerSize: number, radius: number }} board
 * @property {{ x: number, y: number, w: number, h: number, cell: number, slots: Slot[] }} tray
 */

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const finite = (v, d) => (Number.isFinite(v) ? v : d);

function normalizeSafe(safe) {
  const s = safe || {};
  const v = (k) => Math.max(0, finite(s[k], 0));
  return { top: v('top'), right: v('right'), bottom: v('bottom'), left: v('left') };
}

function makeBoard(x, y, cell, pad) {
  const innerSize = N * cell;
  const size = innerSize + 2 * pad;
  return {
    x, y, size, cell, pad, innerSize,
    inner: { x: x + pad, y: y + pad },
    radius: Math.max(3, Math.round(size * 0.022)),
  };
}

function makeSlots(x, y, w, h, vertical) {
  const slots = [];
  for (let i = 0; i < 3; i++) {
    const s = vertical
      ? { x, y: y + (i * h) / 3, w, h: h / 3 }
      : { x: x + (i * w) / 3, y, w: w / 3, h };
    s.cx = s.x + s.w / 2;
    s.cy = s.y + s.h / 2;
    slots.push(s);
  }
  return slots;
}

function hudSizes(scoreSize) {
  const bestSize = Math.round(clamp(scoreSize * 0.5, 18, 30));
  const gearSize = Math.round(clamp(bestSize * 1.3, 24, 38));
  return { bestSize, gearSize };
}

// Portrait column: best row ≈ 0.07·H, score ≈ 0.155·H, board top ≈ 0.225·H, tray 0.4 cell below the board,
// 4.4 cells tall. Half of the leftover height is spread over the three upper gaps, half stays below the tray.
function portrait(u, pad, height) {
  const H = u.h;
  const colW = Math.min(u.w, LAYOUT.maxColumn);
  const colX = u.x + (u.w - colW) / 2;
  const stack = (c) => LAYOUT.boardTop * H + N * c + 2 * pad + (LAYOUT.trayGap + LAYOUT.trayH) * c;
  let cell = Math.floor(Math.min(LAYOUT.boardFrac * colW, LAYOUT.boardMaxH * H) / N);
  while (cell > 6 && stack(cell) > H) cell--;
  cell = Math.max(6, cell);
  const leftover = Math.max(0, H - stack(cell));
  const add = leftover / 6;

  const bestY = u.y + LAYOUT.bestY * H + add;
  const scoreY = u.y + LAYOUT.scoreY * H + add;
  const boardY = u.y + LAYOUT.boardTop * H + 2 * add;
  const outer = N * cell + 2 * pad;
  const board = makeBoard(Math.round(colX + (colW - outer) / 2), Math.round(boardY), cell, pad);

  let scoreSize = Math.max(LAYOUT.scoreMin, Math.round(height * LAYOUT.scoreFrac));
  scoreSize = Math.round(Math.min(scoreSize, (board.y - bestY) * 1.05, cell * 1.6));
  const { bestSize, gearSize } = hudSizes(scoreSize);

  const trayY = Math.round(board.y + outer + LAYOUT.trayGap * cell + add);
  const trayH = Math.round(LAYOUT.trayH * cell);
  // the HUD row hugs the board (slightly wider), never wider than the column
  const hudL = Math.max(colX, board.x - cell * 0.35);
  const hudR = Math.min(colX + colW, board.x + outer + cell * 0.35);
  return {
    mode: 'portrait',
    hud: {
      best: { x: Math.round(hudL + 2), y: Math.round(bestY), size: bestSize },
      score: { x: Math.round(board.x + outer / 2), y: Math.round(scoreY), size: scoreSize },
      gear: { x: Math.round(hudR - gearSize / 2 - 2), y: Math.round(bestY), size: gearSize },
    },
    board,
    tray: {
      x: colX, y: trayY, w: colW, h: trayH,
      cell: Math.max(4, Math.round(cell * LAYOUT.trayScale)),
      slots: makeSlots(colX, trayY, colW, trayH, false),
    },
  };
}

// Side by side (phone landscape): board on the left, a column with the HUD and the tray on the right.
// The tray is a row of three slots or a vertical column, whichever lets the pieces be larger.
function sideBySide(u, pad, height) {
  const H = u.h;
  const gap = Math.max(16, Math.round(u.w * 0.035));
  const minRight = (c) => 3 * 5.6 * Math.max(4, Math.round(c * LAYOUT.trayScale));
  let cell = Math.floor((H - 2 * pad) / N);
  while (cell > 6 && N * cell + 2 * pad + gap + minRight(cell) > u.w) cell--;
  if (cell <= 6) return null;
  const outer = N * cell + 2 * pad;
  const rightW = Math.min(u.w - outer - gap, Math.max(minRight(cell), outer * 1.1));
  const x0 = u.x + (u.w - (outer + gap + rightW)) / 2;
  const board = makeBoard(Math.round(x0), Math.round(u.y + (H - outer) / 2), cell, pad);
  const rx = board.x + outer + gap;

  const scoreSize = Math.round(Math.max(LAYOUT.scoreMin, Math.min(height * LAYOUT.scoreFrac, cell * 1.2)));
  const { bestSize, gearSize } = hudSizes(scoreSize);
  const bestY = board.y + Math.max(bestSize, gearSize) * 0.6;
  const scoreY = bestY + bestSize * 0.7 + scoreSize * 0.8;
  const trayY = Math.round(scoreY + scoreSize * 0.75);
  const trayH = Math.max(40, Math.round(board.y + outer - trayY));

  const ideal = Math.round(cell * LAYOUT.trayScale);
  const rowCell = Math.min(ideal, Math.floor(rightW / 3 / 5.6), Math.floor(trayH / 5.6));
  const colCell = Math.min(ideal, Math.floor(rightW / 5.6), Math.floor(trayH / 3 / 5.6));
  const vertical = colCell > rowCell;
  return {
    mode: 'side',
    hud: {
      best: { x: Math.round(rx + 2), y: Math.round(bestY), size: bestSize },
      score: { x: Math.round(rx + rightW / 2), y: Math.round(scoreY), size: scoreSize },
      gear: { x: Math.round(rx + rightW - gearSize / 2 - 2), y: Math.round(bestY), size: gearSize },
    },
    board,
    tray: {
      x: rx, y: trayY, w: rightW, h: trayH,
      cell: Math.max(4, vertical ? colCell : rowCell),
      slots: makeSlots(rx, trayY, rightW, trayH, vertical),
    },
  };
}

/**
 * Computes the layout. Portrait column by default; the side-by-side variant is used when the screen is
 * landscape and the portrait board would be cramped (phone landscape). Desktop windows get the centered
 * portrait column.
 * @param {{ width: number, height: number, safe?: object, dpr?: number, reserveBottom?: number }} m
 *   reserveBottom: extra CSS px kept free at the bottom (e.g. for the install hint)
 * @returns {Layout}
 */
export function computeLayout({ width, height, safe, dpr = 1, reserveBottom = 0 }) {
  const W = Math.max(1, finite(width, 1));
  const Hh = Math.max(1, finite(height, 1));
  const s = normalizeSafe(safe);
  const usable = {
    x: s.left + LAYOUT.marginSide,
    y: s.top + LAYOUT.marginTop,
    w: Math.max(60, W - s.left - s.right - 2 * LAYOUT.marginSide),
    h: Math.max(80, Hh - s.top - s.bottom - LAYOUT.marginTop - LAYOUT.marginBottom - Math.max(0, finite(reserveBottom, 0))),
  };
  const pad = clamp(Math.round(W * LAYOUT.framePadFrac), 4, 8);
  let chosen = portrait(usable, pad, Hh);
  if (W > Hh && chosen.board.cell < LAYOUT.sideMinCell) {
    const side = sideBySide(usable, pad, Hh);
    if (side && side.board.cell > chosen.board.cell * 1.2) chosen = side;
  }
  return { dpr: clamp(finite(dpr, 1), 1, 3), width: W, height: Hh, safe: s, usable, ...chosen };
}

/**
 * Board cell under a point, or null.
 * @param {Layout} layout
 * @param {number} px
 * @param {number} py
 * @returns {{ row: number, col: number } | null}
 */
export function boardCellAt(layout, px, py) {
  const { inner, cell } = layout.board;
  const col = Math.floor((px - inner.x) / cell);
  const row = Math.floor((py - inner.y) / cell);
  return row >= 0 && row < N && col >= 0 && col < N ? { row, col } : null;
}

/**
 * Tray slot under a point (whole slot plus `forgiveness` px), nearest slot center wins; -1 if none.
 * @param {Layout} layout
 * @param {number} px
 * @param {number} py
 * @param {number} [forgiveness]
 * @returns {number}
 */
export function slotAt(layout, px, py, forgiveness = LAYOUT.slotForgiveness) {
  let best = -1;
  let bestD = Infinity;
  layout.tray.slots.forEach((s, i) => {
    if (px < s.x - forgiveness || px > s.x + s.w + forgiveness || py < s.y - forgiveness || py > s.y + s.h + forgiveness) return;
    const d = Math.hypot(px - s.cx, py - s.cy);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/**
 * Rect of a piece drawn in its tray slot (centered by bounding box, tray scale).
 * @param {Layout} layout
 * @param {number} slot
 * @param {{ w: number, h: number }} shape
 * @returns {{ x: number, y: number, w: number, h: number }}
 */
export function trayPieceRect(layout, slot, shape) {
  const s = layout.tray.slots[slot];
  const c = layout.tray.cell;
  const w = shape.w * c;
  const h = shape.h * c;
  return { x: Math.round(s.cx - w / 2), y: Math.round(s.cy - h / 2), w, h };
}

/**
 * Top-left pixel of board cell (row, col).
 * @param {Layout} layout
 * @param {number} row
 * @param {number} col
 * @returns {{ x: number, y: number }}
 */
export function cellPos(layout, row, col) {
  const { inner, cell } = layout.board;
  return { x: inner.x + col * cell, y: inner.y + row * cell };
}
