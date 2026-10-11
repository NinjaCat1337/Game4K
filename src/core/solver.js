import { SIZE } from './constants.js';

/** @typedef {import('./shapes.js').Shape} Shape */

// Boards here are number[8] row bitmasks (bit c = column c), as produced by board.js#toRowMasks().
const FULL_ROW = (1 << SIZE) - 1;
const POPCOUNT = new Uint8Array(1 << SIZE);
for (let i = 1; i < POPCOUNT.length; i++) POPCOUNT[i] = (i & 1) + POPCOUNT[i >> 1];

function sanitize(rowMasks) {
  const m = new Array(SIZE);
  for (let r = 0; r < SIZE; r++) m[r] = (rowMasks[r] | 0) & FULL_ROW;
  return m;
}

function fitsAt(m, sm, h, row, col) {
  for (let i = 0; i < h; i++) {
    if (m[row + i] & (sm[i] << col)) return false;
  }
  return true;
}

function anyFit(m, shape) {
  const sm = shape.masks;
  const h = shape.h;
  const maxRow = SIZE - h;
  const maxCol = SIZE - shape.w;
  for (let row = 0; row <= maxRow; row++) {
    for (let col = 0; col <= maxCol; col++) {
      if (fitsAt(m, sm, h, row, col)) return true;
    }
  }
  return false;
}

// dst = src + shape at (row, col), then full rows/columns emptied; returns the number of lines cleared.
function placeClearInto(src, dst, sm, h, row, col) {
  for (let r = 0; r < SIZE; r++) dst[r] = src[r];
  for (let i = 0; i < h; i++) dst[row + i] |= sm[i] << col;
  let colFull = FULL_ROW;
  let rowFull = 0;
  for (let r = 0; r < SIZE; r++) {
    colFull &= dst[r];
    if (dst[r] === FULL_ROW) rowFull |= 1 << r;
  }
  if (rowFull === 0 && colFull === 0) return 0;
  const keep = FULL_ROW & ~colFull;
  for (let r = 0; r < SIZE; r++) dst[r] = (rowFull >> r) & 1 ? 0 : dst[r] & keep;
  return POPCOUNT[rowFull] + POPCOUNT[colFull];
}

// Whether placing (assumed valid) leaves at least one full row or column.
function completesLine(m, sm, h, row, col) {
  let colFull = FULL_ROW;
  for (let r = 0; r < SIZE; r++) {
    const i = r - row;
    const v = i >= 0 && i < h ? m[r] | (sm[i] << col) : m[r];
    if (v === FULL_ROW) return true;
    colFull &= v;
  }
  return colFull !== 0;
}

function isDuplicate(list, i) {
  for (let j = 0; j < i; j++) {
    if (list[j] === list[i] || list[j].id === list[i].id) return true;
  }
  return false;
}

function search(m, rem) {
  const n = rem.length;
  if (n === 1) return anyFit(m, rem[0]);
  const fits = new Array(n);
  let fitCount = 0;
  for (let i = 0; i < n; i++) {
    fits[i] = anyFit(m, rem[i]);
    if (fits[i]) fitCount++;
  }
  if (fitCount === 0) return false;
  // Without a clear the board only gains cells, so when no OTHER remaining piece fits now,
  // only placements that clear lines can lead anywhere.
  const othersFit = fitCount > 1;
  const next = new Array(SIZE);
  for (let i = 0; i < n; i++) {
    if (!fits[i] || isDuplicate(rem, i)) continue;
    const s = rem[i];
    const rest = rem.slice(0, i).concat(rem.slice(i + 1));
    const sm = s.masks;
    const h = s.h;
    const maxRow = SIZE - h;
    const maxCol = SIZE - s.w;
    for (let row = 0; row <= maxRow; row++) {
      for (let col = 0; col <= maxCol; col++) {
        if (!fitsAt(m, sm, h, row, col)) continue;
        if (placeClearInto(m, next, sm, h, row, col) === 0 && !othersFit) continue;
        if (search(next, rest)) return true;
      }
    }
  }
  return false;
}

/**
 * Whether the shape fits with its bounding-box top-left at (row, col). Out of bounds → false.
 * @param {ArrayLike<number>} rowMasks
 * @param {Shape} shape
 * @param {number} row
 * @param {number} col
 * @returns {boolean}
 */
export function canPlaceMask(rowMasks, shape, row, col) {
  if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0 ||
    row + shape.h > SIZE || col + shape.w > SIZE) return false;
  return fitsAt(rowMasks, shape.masks, shape.h, row, col);
}

/**
 * Places the shape and clears every full row/column (crossing cells once).
 * @param {ArrayLike<number>} rowMasks not mutated
 * @param {Shape} shape
 * @param {number} row
 * @param {number} col
 * @returns {{ masks: number[], lines: number } | null} null when the placement is invalid
 */
export function placeAndClearMask(rowMasks, shape, row, col) {
  if (!canPlaceMask(rowMasks, shape, row, col)) return null;
  const masks = new Array(SIZE);
  const lines = placeClearInto(sanitize(rowMasks), masks, shape.masks, shape.h, row, col);
  return { masks, lines };
}

/**
 * Whether all shapes can be placed one after another in SOME order (any positions), resolving
 * line clears after each placement. DFS over distinct orders × valid positions with early exit;
 * identical shapes are tried once per level. Null entries (used tray slots) are ignored.
 * @param {ArrayLike<number>} rowMasks
 * @param {Array<Shape | null>} shapes
 * @returns {boolean}
 */
export function canPlaceAllInSomeOrder(rowMasks, shapes) {
  const list = [];
  for (const s of shapes) if (s) list.push(s);
  if (list.length === 0) return true;
  list.sort((a, b) => b.n - a.n); // bulky pieces are the most constrained: try them first
  return search(sanitize(rowMasks), list);
}

/**
 * Whether some valid placement of the shape completes at least one row or column.
 * @param {ArrayLike<number>} rowMasks
 * @param {Shape} shape
 * @returns {boolean}
 */
export function canCompleteLine(rowMasks, shape) {
  const m = sanitize(rowMasks);
  const sm = shape.masks;
  const h = shape.h;
  const maxRow = SIZE - h;
  const maxCol = SIZE - shape.w;
  for (let row = 0; row <= maxRow; row++) {
    for (let col = 0; col <= maxCol; col++) {
      if (fitsAt(m, sm, h, row, col) && completesLine(m, sm, h, row, col)) return true;
    }
  }
  return false;
}

/**
 * Number of valid top-left positions for the shape.
 * @param {ArrayLike<number>} rowMasks
 * @param {Shape} shape
 * @returns {number}
 */
export function countPlacementsMask(rowMasks, shape) {
  const m = sanitize(rowMasks);
  const sm = shape.masks;
  const h = shape.h;
  const maxRow = SIZE - h;
  const maxCol = SIZE - shape.w;
  let count = 0;
  for (let row = 0; row <= maxRow; row++) {
    for (let col = 0; col <= maxCol; col++) {
      if (fitsAt(m, sm, h, row, col)) count++;
    }
  }
  return count;
}
