import { SIZE, CELLS } from './constants.js';

/** @typedef {import('./shapes.js').Shape} Shape */

const FULL_ROW = (1 << SIZE) - 1;

function inBounds(shape, row, col) {
  return Number.isInteger(row) && Number.isInteger(col) && row >= 0 && col >= 0 &&
    row + shape.h <= SIZE && col + shape.w <= SIZE;
}

/**
 * A new empty board: Uint8Array(64), index r*8+c, 0 = empty, 1..7 = color id.
 * @returns {Uint8Array}
 */
export function emptyBoard() {
  return new Uint8Array(CELLS);
}

/**
 * An independent copy of a board (any array-like of 64 cells).
 * @param {ArrayLike<number>} board
 * @returns {Uint8Array}
 */
export function cloneBoard(board) {
  return Uint8Array.from(board);
}

/**
 * Whether the shape fits with its bounding-box top-left at (row, col). Out of bounds → false.
 * @param {ArrayLike<number>} board
 * @param {Shape} shape
 * @param {number} row
 * @param {number} col
 * @returns {boolean}
 */
export function canPlace(board, shape, row, col) {
  if (!inBounds(shape, row, col)) return false;
  const cells = shape.cells;
  for (let i = 0; i < cells.length; i++) {
    if (board[(row + cells[i][0]) * SIZE + col + cells[i][1]] !== 0) return false;
  }
  return true;
}

/**
 * Places the shape and returns a NEW board (the input is not mutated). Assumes canPlace().
 * @param {ArrayLike<number>} board
 * @param {Shape} shape
 * @param {number} row
 * @param {number} col
 * @param {number} color 1..7
 * @returns {Uint8Array}
 */
export function placeShape(board, shape, row, col, color) {
  const next = Uint8Array.from(board);
  for (const [r, c] of shape.cells) next[(row + r) * SIZE + col + c] = color;
  return next;
}

/**
 * All completely filled rows and columns, ascending.
 * @param {ArrayLike<number>} board
 * @returns {{ rows: number[], cols: number[] }}
 */
export function findFullLines(board) {
  const rows = [];
  const cols = [];
  for (let r = 0; r < SIZE; r++) {
    let full = true;
    for (let c = 0; c < SIZE && full; c++) full = board[r * SIZE + c] !== 0;
    if (full) rows.push(r);
  }
  for (let c = 0; c < SIZE; c++) {
    let full = true;
    for (let r = 0; r < SIZE && full; r++) full = board[r * SIZE + c] !== 0;
    if (full) cols.push(c);
  }
  return { rows, cols };
}

/**
 * Clear preview without mutating: the lines that would be full after placing the shape at (row, col).
 * Returns empty lists when the placement is invalid.
 * @param {ArrayLike<number>} board
 * @param {Shape} shape
 * @param {number} row
 * @param {number} col
 * @returns {{ rows: number[], cols: number[] }}
 */
export function linesCompletedBy(board, shape, row, col) {
  const rows = [];
  const cols = [];
  if (!canPlace(board, shape, row, col)) return { rows, cols };
  const masks = toRowMasks(board);
  for (let i = 0; i < shape.h; i++) masks[row + i] |= shape.masks[i] << col;
  let colFull = FULL_ROW;
  for (let r = 0; r < SIZE; r++) {
    if (masks[r] === FULL_ROW) rows.push(r);
    colFull &= masks[r];
  }
  for (let c = 0; c < SIZE; c++) {
    if (colFull & (1 << c)) cols.push(c);
  }
  return { rows, cols };
}

/**
 * Empties the given rows and columns. A cell on a crossing is removed (and reported) once.
 * @param {ArrayLike<number>} board
 * @param {number[]} rows
 * @param {number[]} cols
 * @returns {{ board: Uint8Array, cleared: Array<{ r: number, c: number, color: number }> }}
 *   NEW board, and the removed non-empty cells in row-major order with their colors before removal
 */
export function clearLines(board, rows, cols) {
  const next = Uint8Array.from(board);
  const rowHit = new Array(SIZE).fill(false);
  const colHit = new Array(SIZE).fill(false);
  for (const r of rows || []) if (Number.isInteger(r) && r >= 0 && r < SIZE) rowHit[r] = true;
  for (const c of cols || []) if (Number.isInteger(c) && c >= 0 && c < SIZE) colHit[c] = true;
  const cleared = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (!rowHit[r] && !colHit[c]) continue;
      const i = r * SIZE + c;
      if (next[i] !== 0) {
        cleared.push({ r, c, color: next[i] });
        next[i] = 0;
      }
    }
  }
  return { board: next, cleared };
}

/**
 * Every top-left position where the shape fits, row-major.
 * @param {ArrayLike<number>} board
 * @param {Shape} shape
 * @returns {Array<{ row: number, col: number }>}
 */
export function validPositions(board, shape) {
  const out = [];
  for (let row = 0; row + shape.h <= SIZE; row++) {
    for (let col = 0; col + shape.w <= SIZE; col++) {
      if (canPlace(board, shape, row, col)) out.push({ row, col });
    }
  }
  return out;
}

/**
 * Whether the shape fits anywhere.
 * @param {ArrayLike<number>} board
 * @param {Shape} shape
 * @returns {boolean}
 */
export function hasAnyPlacement(board, shape) {
  for (let row = 0; row + shape.h <= SIZE; row++) {
    for (let col = 0; col + shape.w <= SIZE; col++) {
      if (canPlace(board, shape, row, col)) return true;
    }
  }
  return false;
}

/**
 * Number of non-empty cells.
 * @param {ArrayLike<number>} board
 * @returns {number}
 */
export function filledCount(board) {
  let n = 0;
  for (let i = 0; i < CELLS; i++) if (board[i] !== 0) n++;
  return n;
}

/**
 * Whether every cell is empty.
 * @param {ArrayLike<number>} board
 * @returns {boolean}
 */
export function isEmpty(board) {
  for (let i = 0; i < CELLS; i++) if (board[i] !== 0) return false;
  return true;
}

/**
 * Occupancy as 8 row bitmasks (bit c set = cell (r, c) filled), the solver's board format.
 * @param {ArrayLike<number>} board
 * @returns {number[]}
 */
export function toRowMasks(board) {
  const masks = new Array(SIZE).fill(0);
  for (let r = 0; r < SIZE; r++) {
    let m = 0;
    for (let c = 0; c < SIZE; c++) if (board[r * SIZE + c] !== 0) m |= 1 << c;
    masks[r] = m;
  }
  return masks;
}
