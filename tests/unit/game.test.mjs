import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Game } from '../../src/core/game.js';
import { SHAPE_BY_ID } from '../../src/core/shapes.js';
import { makeRng } from '../../src/core/rng.js';
import { findFullLines, toRowMasks, isEmpty, filledCount, hasAnyPlacement } from '../../src/core/board.js';
import { canPlaceAllInSomeOrder } from '../../src/core/solver.js';
import { clearPoints, praiseFor } from '../../src/core/scoring.js';
import { ALL_CLEAR_BONUS, SAVE_VERSION } from '../../src/core/constants.js';

/** 8 strings of 8 chars: '.' empty, '#' color 1, '1'..'7' that color. */
function parse(rows) {
  assert.equal(rows.length, 8);
  const b = [];
  for (const line of rows) {
    assert.equal(line.length, 8);
    for (const ch of line) b.push(ch === '.' ? 0 : ch === '#' ? 1 : Number(ch));
  }
  return b;
}

const EMPTY_ROWS = new Array(8).fill('........');

// Row 7 needs (7,0); the block at (0,7) keeps the clear from being an all-clear.
const B_CLEAR = parse(['.......5', ...EMPTY_ROWS.slice(1, 7), '.1111111']);
// Nothing near completion: a 1×1 at (4,4) clears nothing.
const B_MISS = parse(['.......5', ...EMPTY_ROWS.slice(1)]);

function clearStep(g, slot = 0) {
  g.setBoard(B_CLEAR);
  return g.place(slot, 7, 0);
}

function missStep(g, slot = 0) {
  g.setBoard(B_MISS);
  return g.place(slot, 4, 4);
}

// One isolated empty cell per row/column (only a 1×1 fits) plus an extra empty cell at (0,4).
function dotsOnlyBoardWithExtraCell() {
  const b = new Array(64).fill(2);
  [0, 2, 4, 6, 1, 3, 5, 7].forEach((c, r) => { b[r * 8 + c] = 0; });
  b[4] = 0;
  return b;
}

function validMoves(g) {
  const out = [];
  for (let slot = 0; slot < 3; slot++) {
    for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) if (g.canPlace(slot, row, col)) out.push([slot, row, col]);
  }
  return out;
}

const firstMove = (g, slot) => validMoves(g).find((m) => m[0] === slot);

test('a fresh game: empty board, first hand dealt, counters at zero', () => {
  const g = new Game({ seed: 1 });
  assert.ok(g.board instanceof Uint8Array);
  assert.equal(g.board.length, 64);
  assert.ok(isEmpty(g.board));
  assert.equal(g.hand.length, 3);
  for (const p of g.hand) {
    assert.ok(SHAPE_BY_ID[p.shapeId]);
    assert.ok(Number.isInteger(p.color) && p.color >= 1 && p.color <= 7);
  }
  assert.equal(g.score, 0);
  assert.equal(g.streak, 0);
  assert.equal(g.misses, 0);
  assert.equal(g.clearsThisHand, 0);
  assert.equal(g.handsDealt, 1);
  assert.equal(g.moves, 0);
  assert.equal(g.over, false);
  assert.equal(g.seed, 1);
  assert.ok(g.hasAnyMove());
});

test('seeds: deterministic per seed, random by default, coerced to uint32', () => {
  assert.deepEqual(new Game({ seed: 42 }).toJSON(), new Game({ seed: 42 }).toJSON());
  const hands = new Set();
  for (let s = 1; s <= 30; s++) hands.add(JSON.stringify(new Game({ seed: s }).hand));
  assert.ok(hands.size > 20);
  for (const g of [new Game(), new Game({}), new Game(null), new Game({ seed: undefined })]) {
    assert.ok(Number.isInteger(g.seed) && g.seed >= 0 && g.seed <= 0xffffffff);
    assert.equal(g.handsDealt, 1);
  }
  assert.equal(new Game({ seed: -1 }).seed, 0xffffffff);
  assert.equal(new Game({ seed: '42' }).seed, 42);
  assert.deepEqual(new Game({ seed: 0 }).toJSON(), new Game({ seed: 0 }).toJSON());
});

test('restart resets everything (same seed → same game as a new one)', () => {
  const g = new Game({ seed: 5 });
  g.place(...firstMove(g, 0));
  g.place(...firstMove(g, 1));
  g.restart({ seed: 9 });
  assert.deepEqual(g.toJSON(), new Game({ seed: 9 }).toJSON());
  g.place(...firstMove(g, 0));
  g.restart();
  assert.ok(isEmpty(g.board));
  assert.equal(g.moves, 0);
  assert.equal(g.score, 0);
  assert.equal(g.handsDealt, 1);
  assert.equal(g.over, false);
  assert.ok(Number.isInteger(g.seed));
});

test('shapeAt / canPlace / preview', () => {
  const g = new Game({ seed: 3 });
  g.setBoard(B_CLEAR);
  g.setHand(['dot', 'i2h', 'o2'], [1, 2, 3]);
  assert.equal(g.shapeAt(0), SHAPE_BY_ID.dot);
  assert.equal(g.shapeAt(2), SHAPE_BY_ID.o2);
  for (const bad of [-1, 3, 1.5, '0', null, undefined]) assert.equal(g.shapeAt(bad), null);
  assert.equal(g.canPlace(0, 7, 0), true);
  assert.equal(g.canPlace(0, 7, 1), false, 'overlap');
  assert.equal(g.canPlace(1, 0, 7), false, 'out of bounds');
  assert.equal(g.canPlace(4, 0, 0), false, 'bad slot');
  const board = Array.from(g.board);
  const hand = JSON.stringify(g.hand);
  assert.deepEqual(g.preview(0, 7, 0), { cells: [{ r: 7, c: 0 }], rows: [7], cols: [] });
  assert.deepEqual(g.preview(1, 3, 3), { cells: [{ r: 3, c: 3 }, { r: 3, c: 4 }], rows: [], cols: [] });
  assert.deepEqual(g.preview(2, 5, 0), {
    cells: [{ r: 5, c: 0 }, { r: 5, c: 1 }, { r: 6, c: 0 }, { r: 6, c: 1 }], rows: [], cols: [],
  });
  assert.equal(g.preview(0, 7, 1), null);
  assert.equal(g.preview(1, 0, 7), null);
  assert.equal(g.preview(7, 0, 0), null);
  assert.deepEqual(Array.from(g.board), board, 'preview never mutates');
  assert.equal(JSON.stringify(g.hand), hand);
});

test('place() returns null for invalid moves and leaves the state untouched', () => {
  const g = new Game({ seed: 4 });
  g.setBoard(B_CLEAR);
  g.setHand(['dot', 'i2h', null], [1, 2]);
  const before = JSON.stringify(g.toJSON());
  const attempts = [
    [-1, 0, 0], [3, 0, 0], [1.5, 0, 0], ['0', 0, 0], [null, 0, 0], [undefined, 0, 0],
    [2, 0, 0], // empty slot
    [0, 7, 1], // overlap
    [1, 0, 7], [0, 8, 0], [0, -1, 0], [0, 0, 8], // out of bounds
    [0, 0.5, 0], [0, 0, '1'], [0, NaN, 0],
  ];
  for (const a of attempts) assert.equal(g.place(...a), null, JSON.stringify(a));
  assert.equal(JSON.stringify(g.toJSON()), before);
  assert.ok(g.place(0, 7, 0));
  assert.equal(g.place(0, 4, 4), null, 'a used slot cannot be placed again');
});

test('place() returns null once the game is over', () => {
  const g = new Game({ seed: 5 });
  const [slot, row, col] = firstMove(g, 0);
  g.over = true; // e.g. a forced game over
  assert.equal(g.canPlace(slot, row, col), false);
  assert.equal(g.preview(slot, row, col), null);
  assert.equal(g.place(slot, row, col), null);
  assert.equal(g.moves, 0);
});

test('MoveResult: every field for a row + column crossing clear', () => {
  const g = new Game({ seed: 6 });
  g.setBoard(parse([
    '6......4',
    '.......4',
    '.......4',
    '1234567.',
    '.......4',
    '.......4',
    '.......4',
    '.......4',
  ]));
  g.setHand(['dot', 'o2', 'i3h'], [5, 2, 3]);
  const r = g.place(0, 3, 7);
  const col7 = (rr) => ({ r: rr, c: 7, color: 4 });
  assert.deepEqual(r, {
    slot: 0,
    shapeId: 'dot',
    color: 5,
    row: 3,
    col: 7,
    placed: [{ r: 3, c: 7 }],
    rows: [3],
    cols: [7],
    lines: 2,
    cleared: [
      col7(0), col7(1), col7(2),
      { r: 3, c: 0, color: 1 }, { r: 3, c: 1, color: 2 }, { r: 3, c: 2, color: 3 }, { r: 3, c: 3, color: 4 },
      { r: 3, c: 4, color: 5 }, { r: 3, c: 5, color: 6 }, { r: 3, c: 6, color: 7 }, { r: 3, c: 7, color: 5 },
      col7(4), col7(5), col7(6), col7(7),
    ],
    streakBefore: 0,
    streak: 1,
    misses: 0,
    comboShown: 0,
    comboBroken: false,
    allClear: false,
    perfect: false,
    praise: 'Good!',
    points: { place: 1, clear: 20, bonus: 0, total: 21 },
    scoreBefore: 0,
    scoreAfter: 21,
    newHand: null,
    over: false,
  });
  assert.equal(r.cleared.length, 15, 'the crossing cell is removed once');
  assert.equal(filledCount(g.board), 1);
  assert.equal(g.board[0], 6);
  assert.deepEqual(g.hand, [null, { shapeId: 'o2', color: 2 }, { shapeId: 'i3h', color: 3 }]);
  assert.equal(g.score, 21);
  assert.equal(g.moves, 1);
  assert.equal(g.clearsThisHand, 1);
  assert.equal(g.streak, 1);
});

test('multi-line clears: 3 lines with a streak, 6 lines, praise words', () => {
  const g = new Game({ seed: 7 });
  g.setHand(['dot', 'i3v', 'o3'], [1, 2, 3]);
  const first = clearStep(g, 0);
  assert.equal(first.streak, 1);
  g.setBoard(parse([
    '.......5',
    '........',
    '........',
    '........',
    '........',
    '.1111111',
    '.1111111',
    '.1111111',
  ]));
  const r3 = g.place(1, 5, 0);
  assert.deepEqual([r3.rows, r3.cols, r3.lines], [[5, 6, 7], [], 3]);
  assert.equal(r3.streakBefore, 1);
  assert.equal(r3.comboShown, 1);
  assert.deepEqual(r3.points, { place: 3, clear: 120, bonus: 0, total: 123 });
  assert.equal(r3.praise, 'Great!');
  assert.equal(r3.cleared.length, 24);

  g.setBoard(parse([
    '###....#',
    '###.....',
    '###.....',
    '###.....',
    '###.....',
    '...#####',
    '...#####',
    '...#####',
  ]));
  const r6 = g.place(2, 5, 0);
  assert.deepEqual([r6.rows, r6.cols, r6.lines], [[5, 6, 7], [0, 1, 2], 6]);
  assert.equal(r6.allClear, false);
  assert.equal(r6.praise, 'Legendary!');
  assert.equal(r6.streakBefore, 2);
  assert.deepEqual(r6.points, { place: 9, clear: 900, bonus: 0, total: 909 });
  assert.equal(r6.cleared.length, 48 - 9);
  assert.equal(r6.perfect, true, 'all three pieces of this tray cleared lines');
  assert.ok(r6.newHand);
  assert.equal(g.score, 11 + 123 + 909);
});

test('all-clear: Unbelievable!, bonus = ALL_CLEAR_BONUS, empty board', () => {
  const g = new Game({ seed: 8 });
  g.setBoard(parse([...EMPTY_ROWS.slice(0, 7), '.1111111']));
  g.setHand(['dot', 'i2h', 'o2'], [6, 2, 3]);
  const r = g.place(0, 7, 0);
  assert.equal(r.allClear, true);
  assert.equal(r.praise, 'Unbelievable!');
  assert.equal(r.lines, 1);
  assert.deepEqual(r.points, { place: 1, clear: 10, bonus: ALL_CLEAR_BONUS, total: 11 + ALL_CLEAR_BONUS });
  assert.ok(isEmpty(g.board));
  const notAll = new Game({ seed: 8 });
  notAll.setHand(['dot', 'dot', 'dot'], [1, 2, 3]);
  assert.equal(clearStep(notAll).allClear, false);
  assert.equal(missStep(notAll, 1).allClear, false);
});

test('streak: consecutive clears raise the multiplier; comboShown = clears before', () => {
  const g = new Game({ seed: 9 });
  const results = [];
  for (let i = 0; i < 5; i++) {
    g.setHand(['dot', 'dot', 'dot'], [1, 2, 3]);
    results.push(clearStep(g));
  }
  assert.deepEqual(results.map((r) => r.streakBefore), [0, 1, 2, 3, 4]);
  assert.deepEqual(results.map((r) => r.streak), [1, 2, 3, 4, 5]);
  assert.deepEqual(results.map((r) => r.comboShown), [0, 1, 2, 3, 4]);
  assert.deepEqual(results.map((r) => r.points.clear), [10, 20, 30, 40, 50]);
  assert.deepEqual(results.map((r) => r.points.total), [11, 21, 31, 41, 51]);
  for (const r of results) {
    assert.equal(r.misses, 0);
    assert.equal(r.comboBroken, false);
    assert.equal(r.praise, null);
  }
});

test('streak: 2 misses keep the combo, the 3rd breaks it (comboBroken only for a visible combo)', () => {
  const g = new Game({ seed: 10 });
  const step = (kind) => {
    g.setHand(['dot', 'dot', 'dot'], [1, 2, 3]);
    return kind === 'clear' ? clearStep(g) : missStep(g);
  };
  step('clear');
  step('clear');
  let r = step('miss');
  assert.deepEqual([r.streak, r.misses, r.comboBroken, r.comboShown], [2, 1, false, 0]);
  r = step('miss');
  assert.deepEqual([r.streak, r.misses, r.comboBroken], [2, 2, false]);
  r = step('clear');
  assert.deepEqual([r.streakBefore, r.comboShown, r.streak, r.misses, r.points.clear], [2, 2, 3, 0, 30]);
  step('miss');
  step('miss');
  r = step('miss');
  assert.deepEqual([r.streakBefore, r.streak, r.misses, r.comboBroken], [3, 0, 0, true]);
  r = step('clear');
  assert.deepEqual([r.streakBefore, r.comboShown, r.streak, r.points.clear], [0, 0, 1, 10]);
  step('miss');
  step('miss');
  r = step('miss');
  assert.deepEqual([r.streak, r.misses, r.comboBroken], [0, 0, false], 'a streak of 1 shows no combo to break');
  // without a streak the miss counter just cycles
  assert.deepEqual([step('miss').misses, step('miss').misses, step('miss').misses], [1, 2, 0]);
  assert.equal(g.streak, 0);
});

test('misses carry across hand refills', () => {
  const g = new Game({ seed: 11 });
  g.setHand(['dot', 'dot', 'dot'], [1, 2, 3]);
  clearStep(g, 0);
  clearStep(g, 1);
  const handsBefore = g.handsDealt;
  g.setHand([null, null, 'dot'], [1, 2, 3]);
  missStep(g, 2);
  assert.equal(g.handsDealt, handsBefore + 1, 'refilled');
  g.setHand(['dot', 'dot', 'dot'], [1, 2, 3]);
  const r1 = missStep(g, 0);
  assert.deepEqual([r1.streak, r1.misses], [2, 2], 'the miss before the refill still counts');
  const r2 = missStep(g, 1);
  assert.deepEqual([r2.streak, r2.misses, r2.comboBroken], [0, 0, true]);

  // and a clear right after a refill continues the combo
  const h = new Game({ seed: 12 });
  h.setHand(['dot', 'dot', 'dot'], [1, 2, 3]);
  clearStep(h, 0);
  missStep(h, 1);
  const refill = missStep(h, 2);
  assert.ok(refill.newHand);
  assert.deepEqual([refill.streak, refill.misses], [1, 2]);
  h.setHand(['dot', 'dot', 'dot'], [1, 2, 3]);
  const c = clearStep(h, 0);
  assert.deepEqual([c.streakBefore, c.comboShown, c.streak, c.misses, c.points.clear], [1, 1, 2, 0, 20]);
});

test('perfect: all three pieces of one tray cleared lines', () => {
  const g = new Game({ seed: 13 });
  g.setHand(['dot', 'dot', 'dot'], [1, 2, 3]);
  const handsBefore = g.handsDealt;
  const r1 = clearStep(g, 0);
  const r2 = clearStep(g, 1);
  assert.deepEqual([r1.perfect, r2.perfect, r1.newHand, r2.newHand], [false, false, null, null]);
  assert.equal(g.clearsThisHand, 2);
  const r3 = clearStep(g, 2);
  assert.equal(r3.perfect, true);
  assert.equal(r3.comboShown, 2);
  assert.equal(g.clearsThisHand, 0, 'reset by the new hand');
  assert.equal(g.handsDealt, handsBefore + 1);

  for (const pattern of [['clear', 'clear', 'miss'], ['miss', 'clear', 'clear'], ['clear', 'miss', 'clear']]) {
    const h = new Game({ seed: 14 });
    h.setHand(['dot', 'dot', 'dot'], [1, 2, 3]);
    const res = pattern.map((kind, slot) => (kind === 'clear' ? clearStep(h, slot) : missStep(h, slot)));
    assert.equal(res[2].perfect, false, pattern.join());
    assert.ok(res[2].newHand);
  }
});

test('a new hand is dealt only after all three pieces are placed', () => {
  const g = new Game({ seed: 15 });
  const hand0 = g.hand;
  const hand0Copy = JSON.stringify(hand0);
  const order = [2, 0, 1];
  const results = order.map((slot) => g.place(...firstMove(g, slot)));
  assert.equal(results[0].newHand, null);
  assert.equal(results[1].newHand, null);
  assert.equal(JSON.stringify(hand0), hand0Copy, 'hand arrays are replaced, never mutated');
  assert.equal(results[0].shapeId, JSON.parse(hand0Copy)[2].shapeId);
  assert.ok(Array.isArray(results[2].newHand) && results[2].newHand.length === 3);
  assert.deepEqual(g.hand, results[2].newHand);
  assert.ok(g.hand.every((p) => p !== null));
  assert.equal(g.handsDealt, 2);
  assert.equal(g.moves, 3);
  results[2].newHand[0].color = 99;
  assert.notEqual(g.hand[0].color, 99, 'newHand is a copy');
});

test('game over is detected right after a placement', () => {
  const g = new Game({ seed: 16 });
  g.setBoard(dotsOnlyBoardWithExtraCell());
  g.setHand(['dot', 'o3', 'o3'], [1, 2, 3]);
  assert.equal(g.over, false);
  const r = g.place(0, 0, 4);
  assert.equal(r.lines, 0);
  assert.equal(r.newHand, null);
  assert.equal(r.over, true);
  assert.equal(g.over, true);
  assert.equal(g.hasAnyMove(), false);
  assert.equal(g.place(1, 0, 0), null);
  assert.equal(g.canPlace(1, 0, 0), false);
});

test('game over is detected right after a deal (allowed after the first 10 hands only)', (t) => {
  const save = (rngState, handsDealt) => ({
    v: SAVE_VERSION,
    seed: 1,
    rngState,
    board: dotsOnlyBoardWithExtraCell(),
    hand: [{ shapeId: 'dot', color: 3 }, null, null],
    score: 60000,
    streak: 0,
    misses: 0,
    clearsThisHand: 0,
    handsDealt,
    moves: 3 * handsDealt - 1,
    over: false,
  });
  let overAtDeal = 0;
  for (let k = 0; k < 120; k++) {
    const late = Game.fromJSON(save(k, 40));
    assert.ok(late);
    assert.equal(late.over, false);
    const r = late.place(0, 0, 4);
    assert.equal(r.lines, 0);
    assert.ok(r.newHand);
    const fits = r.newHand.some((p) => p.shapeId === 'dot'); // only a 1×1 fits on this board
    assert.equal(r.over, !fits);
    assert.equal(late.over, !fits);
    if (!fits) overAtDeal++;

    const early = Game.fromJSON(save(k, 3));
    const e = early.place(0, 0, 4);
    assert.equal(e.over, false, 'the first 10 hands are always placeable');
    assert.ok(canPlaceAllInSomeOrder(toRowMasks(early.board), early.hand.map((p) => SHAPE_BY_ID[p.shapeId])));
  }
  t.diagnostic(`late deals that ended the game at once: ${overAtDeal}/120`);
  assert.ok(overAtDeal > 0, 'some late deals end the game at once');
});

test('hasAnyMove ignores used slots and only checks the remaining pieces', () => {
  const g = new Game({ seed: 17 });
  g.setBoard(dotsOnlyBoardWithExtraCell());
  g.setHand([null, 'o3', 'dot'], [1, 2, 3]);
  assert.equal(g.hasAnyMove(), true);
  g.setHand(['o3', 'i2h', null], [1, 2]);
  assert.equal(g.hasAnyMove(), false);
  assert.equal(g.over, true, 'setHand recomputes over');
  g.setBoard(new Array(64).fill(0));
  assert.equal(g.over, false, 'setBoard recomputes over');
  g.setHand([]);
  assert.equal(g.hasAnyMove(), false);
  assert.equal(g.over, true);
});

test('setBoard / setHand validate input and set state', () => {
  const g = new Game({ seed: 18 });
  for (const bad of [null, undefined, [], new Array(63).fill(0), new Array(65).fill(0), 'x'.repeat(64)]) {
    assert.throws(() => g.setBoard(bad), TypeError);
  }
  for (const v of [-1, 8, 1.5, NaN, '1', null]) {
    const arr = new Array(64).fill(0);
    arr[10] = v;
    assert.throws(() => g.setBoard(arr), RangeError, String(v));
  }
  const src = new Array(64).fill(0);
  src[0] = 7;
  g.setBoard(src);
  src[0] = 1;
  assert.equal(g.board[0], 7, 'the board is copied');
  assert.ok(g.board instanceof Uint8Array);
  g.setBoard(new Uint8Array(64));

  assert.throws(() => g.setHand(['nope']), Error);
  assert.throws(() => g.setHand(['dot', 'dot', 'dot', 'dot']), TypeError);
  assert.throws(() => g.setHand('dot'), TypeError);
  g.setHand(['o3', 'dot', 'i2h'], [7, 6, 5]);
  assert.deepEqual(g.hand, [{ shapeId: 'o3', color: 7 }, { shapeId: 'dot', color: 6 }, { shapeId: 'i2h', color: 5 }]);
  g.setHand(['o3', null]);
  assert.equal(g.hand.length, 3);
  assert.deepEqual(g.hand.slice(1), [null, null]);
  for (let s = 0; s < 50; s++) {
    const h = new Game({ seed: s });
    h.setHand(['dot', 'dot', 'dot']);
    const colors = h.hand.map((p) => p.color);
    assert.equal(new Set(colors).size, 3, 'missing colors are distinct');
    for (const c of colors) assert.ok(c >= 1 && c <= 7);
    h.setHand(['dot', 'dot', 'dot'], [4, 0, 9]);
    assert.equal(h.hand[0].color, 4);
    assert.notEqual(h.hand[1].color, 4);
    assert.ok(h.hand[2].color >= 1 && h.hand[2].color <= 7);
  }
  // setHand starts a fresh tray: clearsThisHand resets, streak and misses stay
  g.setHand(['dot', 'dot', 'dot'], [1, 2, 3]);
  clearStep(g, 0);
  missStep(g, 1);
  assert.deepEqual([g.clearsThisHand, g.streak, g.misses], [1, 1, 1]);
  g.setHand(['dot', 'dot', 'dot'], [1, 2, 3]);
  assert.deepEqual([g.clearsThisHand, g.streak, g.misses], [0, 1, 1]);
});

test('self-play: invariants hold on every move of 120 seeded games', (t) => {
  const stats = { games: 0, moves: 0, clears: 0, multi: 0, perfect: 0, allClear: 0, broken: 0, lateHands: 0, overAtDeal: 0 };
  for (let seed = 1; seed <= 120; seed++) {
    const g = new Game({ seed });
    const player = makeRng(seed * 31 + 7);
    let total = 0;
    while (!g.over && g.moves < 300) {
      const before = g.toJSON();
      const moves = validMoves(g);
      assert.ok(moves.length > 0, 'not over → some move exists');
      // mostly greedy (most lines), sometimes random
      let move = player.pick(moves);
      if (player.next() < 0.8) {
        let best = -1;
        for (const m of moves) {
          const p = g.preview(...m);
          const n = p.rows.length + p.cols.length;
          if (n > best) {
            best = n;
            move = m;
          }
        }
      }
      const [slot, row, col] = move;
      const piece = before.hand[slot];
      const shape = SHAPE_BY_ID[piece.shapeId];
      const r = g.place(slot, row, col);
      assert.ok(r);
      stats.moves++;
      total += r.points.total;

      assert.deepEqual([r.slot, r.row, r.col, r.shapeId, r.color], [slot, row, col, piece.shapeId, piece.color]);
      assert.equal(r.placed.length, shape.n);
      assert.equal(r.lines, r.rows.length + r.cols.length);
      assert.equal(r.cleared.length, 8 * r.lines - r.rows.length * r.cols.length);
      assert.equal(new Set(r.cleared.map((x) => x.r * 8 + x.c)).size, r.cleared.length);
      assert.equal(r.allClear, r.lines > 0 && isEmpty(g.board));
      assert.equal(r.praise, praiseFor(r.lines, r.allClear));
      assert.deepEqual(r.points, {
        place: shape.n,
        clear: clearPoints(r.lines, r.streakBefore),
        bonus: r.allClear ? ALL_CLEAR_BONUS : 0,
        total: shape.n + clearPoints(r.lines, r.streakBefore) + (r.allClear ? ALL_CLEAR_BONUS : 0),
      });
      assert.deepEqual([r.scoreBefore, r.scoreAfter, g.score], [before.score, before.score + r.points.total, total]);
      assert.equal(r.streakBefore, before.streak);
      if (r.allClear) stats.allClear++;
      if (r.lines > 0) {
        stats.clears++;
        if (r.lines > 1) stats.multi++;
        assert.deepEqual([r.streak, r.misses, r.comboBroken], [before.streak + 1, 0, false]);
        assert.equal(r.comboShown, before.streak >= 1 ? before.streak : 0);
      } else if (before.misses + 1 >= 3) {
        assert.deepEqual([r.streak, r.misses, r.comboShown], [0, 0, 0]);
        assert.equal(r.comboBroken, before.streak >= 2);
        if (r.comboBroken) stats.broken++;
      } else {
        assert.deepEqual([r.streak, r.misses, r.comboShown, r.comboBroken], [before.streak, before.misses + 1, 0, false]);
      }
      assert.deepEqual(findFullLines(g.board), { rows: [], cols: [] }, 'no full line survives a move');
      assert.equal(g.moves, before.moves + 1);

      const lastPiece = before.hand.filter((p) => p !== null).length === 1;
      if (lastPiece) {
        assert.ok(r.newHand);
        assert.deepEqual(g.hand, r.newHand);
        assert.equal(g.handsDealt, before.handsDealt + 1);
        assert.equal(g.clearsThisHand, 0);
        assert.equal(r.perfect, before.clearsThisHand + (r.lines > 0 ? 1 : 0) === 3);
        if (r.perfect) stats.perfect++;
        if (r.over) stats.overAtDeal++;
        if (before.handsDealt < 10) {
          assert.ok(canPlaceAllInSomeOrder(toRowMasks(g.board), r.newHand.map((p) => SHAPE_BY_ID[p.shapeId])),
            'the first 10 hands are always placeable');
        } else {
          stats.lateHands++;
        }
      } else {
        assert.equal(r.newHand, null);
        assert.equal(r.perfect, false);
        assert.equal(g.handsDealt, before.handsDealt);
        assert.equal(g.clearsThisHand, before.clearsThisHand + (r.lines > 0 ? 1 : 0));
        assert.equal(g.hand[slot], null);
      }
      const anyFits = g.hand.some((p) => p && hasAnyPlacement(g.board, SHAPE_BY_ID[p.shapeId]));
      assert.equal(r.over, !anyFits);
      assert.equal(g.over, !anyFits);
    }
    stats.games++;
  }
  t.diagnostic(JSON.stringify(stats));
  assert.ok(stats.clears > 100 && stats.multi > 10, JSON.stringify(stats));
  assert.ok(stats.perfect > 0 && stats.broken > 0 && stats.lateHands > 0, JSON.stringify(stats));
});

test('the same seed and the same moves replay identically', () => {
  const play = (seed) => {
    const g = new Game({ seed });
    const log = [];
    while (!g.over && g.moves < 120) {
      const moves = validMoves(g);
      const m = moves[(g.moves * 7919) % moves.length];
      log.push(g.place(...m));
    }
    return { log, end: g.toJSON() };
  };
  for (const seed of [3, 77, 4242]) assert.deepEqual(play(seed), play(seed));
});

test('a seeded game takes all randomness from its own RNG', () => {
  const realRandom = Math.random;
  const cryptoDesc = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Math.random = () => { throw new Error('Math.random used'); };
  Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true, writable: true });
  try {
    const g = new Game({ seed: 321 });
    while (!g.over && g.moves < 60) g.place(...validMoves(g)[0]);
    g.setHand(['dot', 'o2', null]);
    const copy = Game.fromJSON(JSON.parse(JSON.stringify(g)));
    assert.deepEqual(copy.toJSON(), g.toJSON());
    g.restart({ seed: 5 });
    assert.equal(g.seed, 5);
  } finally {
    Math.random = realRandom;
    if (cryptoDesc) Object.defineProperty(globalThis, 'crypto', cryptoDesc);
    else delete globalThis.crypto;
  }
});
