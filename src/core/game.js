import {
  CELLS, HAND_SIZE, COLOR_COUNT, COMBO_MISS_LIMIT, ALL_CLEAR_BONUS, SAVE_VERSION,
} from './constants.js';
import { makeRng, randomSeed } from './rng.js';
import { SHAPE_BY_ID, getShape } from './shapes.js';
import {
  emptyBoard, canPlace as boardCanPlace, placeShape, findFullLines, linesCompletedBy, clearLines,
  hasAnyPlacement, isEmpty,
} from './board.js';
import { placementPoints, clearPoints, praiseFor } from './scoring.js';
import { dealHand } from './generator.js';

/** @typedef {import('./shapes.js').Shape} Shape */
/** @typedef {{ shapeId: string, color: number }} HandPiece */

/**
 * @typedef {object} MoveResult
 * @property {number} slot
 * @property {string} shapeId
 * @property {number} color
 * @property {number} row
 * @property {number} col
 * @property {Array<{ r: number, c: number }>} placed
 * @property {number[]} rows full rows that were cleared, ascending
 * @property {number[]} cols full columns that were cleared, ascending
 * @property {number} lines rows.length + cols.length
 * @property {Array<{ r: number, c: number, color: number }>} cleared each removed cell once, board colors
 *   before removal
 * @property {number} streakBefore
 * @property {number} streak
 * @property {number} misses
 * @property {number} comboShown N for the "Combo N" banner (0 = no banner)
 * @property {boolean} comboBroken a visible combo (streak ≥ 2) ended with this placement
 * @property {boolean} allClear
 * @property {boolean} perfect all three pieces of the finished tray cleared lines
 * @property {string | null} praise
 * @property {{ place: number, clear: number, bonus: number, total: number }} points
 * @property {number} scoreBefore
 * @property {number} scoreAfter
 * @property {HandPiece[] | null} newHand the tray dealt after this placement, if any
 * @property {boolean} over
 */

/**
 * @typedef {object} GameSave
 * @property {number} v SAVE_VERSION
 * @property {number} seed
 * @property {number} rngState
 * @property {number[]} board 64 cells
 * @property {Array<HandPiece | null>} hand
 * @property {number} score
 * @property {number} streak
 * @property {number} misses
 * @property {number} clearsThisHand
 * @property {number} handsDealt
 * @property {number} moves
 * @property {boolean} over
 */

const isUint = (v) => Number.isSafeInteger(v) && v >= 0;
const isUint32 = (v) => Number.isInteger(v) && v >= 0 && v <= 0xffffffff;
const isColor = (v) => Number.isInteger(v) && v >= 1 && v <= COLOR_COUNT;
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const copyPiece = (p) => (p ? { shapeId: p.shapeId, color: p.color } : null);
const absoluteCells = (shape, row, col) => shape.cells.map(([r, c]) => ({ r: row + r, c: col + c }));

function normalizeSeed(seed) {
  if (seed === undefined || seed === null || seed === '') return randomSeed();
  const n = Number(seed);
  return Number.isFinite(n) ? n >>> 0 : randomSeed();
}

// Assigns the whole state in one fixed order (constructor, restart and fromJSON share it).
function assign(game, s) {
  game.board = s.board;
  game.hand = s.hand;
  game.score = s.score;
  game.streak = s.streak;
  game.misses = s.misses;
  game.clearsThisHand = s.clearsThisHand;
  game.handsDealt = s.handsDealt;
  game.moves = s.moves;
  game.over = false;
  game.seed = s.seed;
  game._rng = makeRng(s.seed);
  if (s.rngState !== undefined) game._rng.state = s.rngState;
}

/**
 * One Classic-mode game: 8×8 board, a tray of 3 pieces, score and combo state.
 * Readable state: board (Uint8Array(64), replaced on every change), hand (Array<HandPiece|null>,
 * length 3, replaced on every change), score, streak, misses, clearsThisHand, handsDealt, moves,
 * over, seed. All randomness comes from a seeded RNG that is saved with the game.
 */
export class Game {
  /**
   * A fresh game: empty board and the first hand dealt.
   * @param {{ seed?: number }} [options] seed defaults to randomSeed()
   */
  constructor(options) {
    this._start(options ? options.seed : undefined);
  }

  /**
   * Restores a game saved with toJSON(), validating everything.
   * @param {unknown} obj
   * @returns {Game | null} null when obj is not a valid save of this version
   */
  static fromJSON(obj) {
    try {
      if (!isPlainObject(obj) || obj.v !== SAVE_VERSION) return null;
      const {
        seed, rngState, board, hand, score, streak, misses, clearsThisHand, handsDealt, moves, over,
      } = obj;
      if (!isUint32(seed) || !isUint32(rngState)) return null;
      if (!(Array.isArray(board) || ArrayBuffer.isView(board)) || board.length !== CELLS) return null;
      const cells = new Uint8Array(CELLS);
      for (let i = 0; i < CELLS; i++) {
        const v = board[i];
        if (!Number.isInteger(v) || v < 0 || v > COLOR_COUNT) return null;
        cells[i] = v;
      }
      if (!Array.isArray(hand) || hand.length !== HAND_SIZE) return null;
      const pieces = [];
      for (let i = 0; i < HAND_SIZE; i++) {
        const p = hand[i];
        if (p === null) {
          pieces.push(null);
          continue;
        }
        if (!isPlainObject(p) || typeof p.shapeId !== 'string' || !SHAPE_BY_ID[p.shapeId] ||
          !isColor(p.color)) return null;
        pieces.push({ shapeId: p.shapeId, color: p.color });
      }
      const usedSlots = pieces.filter((p) => p === null).length;
      if (usedSlots === HAND_SIZE) return null;
      if (![score, streak, misses, clearsThisHand, handsDealt, moves].every(isUint)) return null;
      if (misses >= COMBO_MISS_LIMIT || clearsThisHand > usedSlots || handsDealt < 1) return null;
      if (typeof over !== 'boolean') return null;

      const game = Object.create(Game.prototype);
      assign(game, {
        board: cells, hand: pieces, score, streak, misses, clearsThisHand, handsDealt, moves, seed, rngState,
      });
      game.over = !game.hasAnyMove();
      return game;
    } catch (e) {
      return null;
    }
  }

  /**
   * Plain JSON-safe snapshot (the RNG state is included, so future deals continue identically).
   * @returns {GameSave}
   */
  toJSON() {
    return {
      v: SAVE_VERSION,
      seed: this.seed,
      rngState: this._rng.state,
      board: Array.from(this.board),
      hand: this.hand.map(copyPiece),
      score: this.score,
      streak: this.streak,
      misses: this.misses,
      clearsThisHand: this.clearsThisHand,
      handsDealt: this.handsDealt,
      moves: this.moves,
      over: this.over,
    };
  }

  /**
   * Starts over: empty board, zeroed counters, first hand dealt.
   * @param {{ seed?: number }} [options] seed defaults to randomSeed()
   */
  restart(options) {
    this._start(options ? options.seed : undefined);
  }

  /**
   * The shape in a tray slot.
   * @param {number} slot 0..2
   * @returns {Shape | null} null for an empty slot or a bad index
   */
  shapeAt(slot) {
    const piece = this._piece(slot);
    return piece ? getShape(piece.shapeId) : null;
  }

  /**
   * Whether the slot's piece can be placed with its bounding-box top-left at (row, col).
   * @param {number} slot
   * @param {number} row
   * @param {number} col
   * @returns {boolean}
   */
  canPlace(slot, row, col) {
    if (this.over) return false;
    const shape = this.shapeAt(slot);
    return shape !== null && boardCanPlace(this.board, shape, row, col);
  }

  /**
   * Drop preview: target cells and the lines that would clear.
   * @param {number} slot
   * @param {number} row
   * @param {number} col
   * @returns {{ cells: Array<{ r: number, c: number }>, rows: number[], cols: number[] } | null}
   *   null when the placement is invalid
   */
  preview(slot, row, col) {
    if (!this.canPlace(slot, row, col)) return null;
    const shape = this.shapeAt(slot);
    const { rows, cols } = linesCompletedBy(this.board, shape, row, col);
    return { cells: absoluteCells(shape, row, col), rows, cols };
  }

  /**
   * Places a piece and resolves everything synchronously: cells → full lines → clear → points →
   * streak → slot used, moves++ → (tray empty: perfect check, new hand) → game-over check.
   * @param {number} slot
   * @param {number} row
   * @param {number} col
   * @returns {MoveResult | null} null when the move is invalid or the game is over
   */
  place(slot, row, col) {
    if (!this.canPlace(slot, row, col)) return null;
    const piece = this.hand[slot];
    const shape = getShape(piece.shapeId);
    const scoreBefore = this.score;
    const streakBefore = this.streak;

    const withPiece = placeShape(this.board, shape, row, col, piece.color);
    const { rows, cols } = findFullLines(withPiece);
    const lines = rows.length + cols.length;
    const { board, cleared } = lines > 0 ? clearLines(withPiece, rows, cols) : { board: withPiece, cleared: [] };
    const allClear = lines > 0 && isEmpty(board);
    const points = {
      place: placementPoints(shape),
      clear: clearPoints(lines, streakBefore),
      bonus: allClear ? ALL_CLEAR_BONUS : 0,
      total: 0,
    };
    points.total = points.place + points.clear + points.bonus;
    this.board = board;
    this.score += points.total;

    let comboShown = 0;
    let comboBroken = false;
    if (lines > 0) {
      comboShown = streakBefore >= 1 ? streakBefore : 0;
      this.streak += 1;
      this.misses = 0;
      this.clearsThisHand += 1;
    } else {
      this.misses += 1;
      if (this.misses >= COMBO_MISS_LIMIT) {
        comboBroken = this.streak >= 2;
        this.streak = 0;
        this.misses = 0;
      }
    }

    const hand = this.hand.slice();
    hand[slot] = null;
    this.hand = hand;
    this.moves += 1;

    let perfect = false;
    let newHand = null;
    if (hand.every((p) => p === null)) {
      perfect = this.clearsThisHand === HAND_SIZE;
      this._deal();
      newHand = this.hand.map(copyPiece);
    }
    this.over = !this.hasAnyMove();

    return {
      slot,
      shapeId: shape.id,
      color: piece.color,
      row,
      col,
      placed: absoluteCells(shape, row, col),
      rows,
      cols,
      lines,
      cleared,
      streakBefore,
      streak: this.streak,
      misses: this.misses,
      comboShown,
      comboBroken,
      allClear,
      perfect,
      praise: praiseFor(lines, allClear),
      points,
      scoreBefore,
      scoreAfter: this.score,
      newHand,
      over: this.over,
    };
  }

  /**
   * Whether any remaining tray piece fits anywhere (ignores `over`).
   * @returns {boolean}
   */
  hasAnyMove() {
    return this.hand.some((p) => p !== null && hasAnyPlacement(this.board, getShape(p.shapeId)));
  }

  /**
   * Debug/test: replaces the board (64 integers 0..7) and recomputes `over`.
   * @param {ArrayLike<number>} arr64
   * @throws {TypeError|RangeError} on malformed input
   */
  setBoard(arr64) {
    if (!arr64 || typeof arr64 !== 'object' || arr64.length !== CELLS) {
      throw new TypeError('setBoard: expected 64 cells');
    }
    const next = new Uint8Array(CELLS);
    for (let i = 0; i < CELLS; i++) {
      const v = arr64[i];
      if (!Number.isInteger(v) || v < 0 || v > COLOR_COUNT) {
        throw new RangeError('setBoard: cell ' + i + ' must be an integer 0..' + COLOR_COUNT);
      }
      next[i] = v;
    }
    this.board = next;
    this.over = !this.hasAnyMove();
  }

  /**
   * Debug/test: replaces the tray (up to 3 ids; null/missing = empty slot), resets clearsThisHand
   * and recomputes `over`. Missing or invalid colors get random colors distinct from the others.
   * @param {Array<string | null>} shapeIds
   * @param {number[]} [colors]
   * @throws {Error} on an unknown shape id or more than 3 ids
   */
  setHand(shapeIds, colors) {
    if (!Array.isArray(shapeIds) || shapeIds.length > HAND_SIZE) {
      throw new TypeError('setHand: expected an array of up to ' + HAND_SIZE + ' shape ids');
    }
    const hand = [];
    const taken = new Set();
    for (let i = 0; i < HAND_SIZE; i++) {
      const id = shapeIds[i];
      if (id === undefined || id === null) {
        hand.push(null);
        continue;
      }
      const c = colors ? colors[i] : undefined;
      hand.push({ shapeId: getShape(id).id, color: isColor(c) ? c : 0 });
      if (isColor(c)) taken.add(c);
    }
    for (const p of hand) {
      if (!p || p.color) continue;
      const free = [];
      for (let c = 1; c <= COLOR_COUNT; c++) if (!taken.has(c)) free.push(c);
      p.color = free.length > 0 ? this._rng.pick(free) : 1 + this._rng.int(COLOR_COUNT);
      taken.add(p.color);
    }
    this.hand = hand;
    this.clearsThisHand = 0;
    this.over = !this.hasAnyMove();
  }

  _start(seed) {
    assign(this, {
      board: emptyBoard(),
      hand: new Array(HAND_SIZE).fill(null),
      score: 0,
      streak: 0,
      misses: 0,
      clearsThisHand: 0,
      handsDealt: 0,
      moves: 0,
      seed: normalizeSeed(seed),
    });
    this._deal();
    this.over = !this.hasAnyMove();
  }

  _deal() {
    const hand = dealHand(this.board, this._rng, {
      score: this.score,
      handsDealt: this.handsDealt,
      streak: this.streak,
      misses: this.misses,
    });
    this.hand = hand.map(copyPiece);
    this.handsDealt += 1;
    this.clearsThisHand = 0;
  }

  _piece(slot) {
    return Number.isInteger(slot) && slot >= 0 && slot < HAND_SIZE ? this.hand[slot] : null;
  }
}
