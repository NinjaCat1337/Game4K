import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  canPlaceMask, placeAndClearMask, canPlaceAllInSomeOrder, canCompleteLine, countPlacementsMask,
} from '../../src/core/solver.js';
import {
  emptyBoard, canPlace, placeShape, findFullLines, clearLines, validPositions, toRowMasks,
} from '../../src/core/board.js';
import { SHAPES, SHAPE_BY_ID } from '../../src/core/shapes.js';
import { makeRng } from '../../src/core/rng.js';

const S = SHAPE_BY_ID;

/** 8 strings of 8 chars: '.' empty, anything else filled. */
function parse(rows) {
  const b = new Uint8Array(64);
  rows.forEach((line, r) => [...line].forEach((ch, c) => { b[r * 8 + c] = ch === '.' ? 0 : 1; }));
  return b;
}

// Random board without full lines: each full line gets one random cell emptied (keeps dense boards dense).
function randomBoard(rng, density) {
  const b = new Uint8Array(64);
  for (let i = 0; i < 64; i++) if (rng.next() < density) b[i] = 1 + rng.int(7);
  for (;;) {
    const { rows, cols } = findFullLines(b);
    if (!rows.length && !cols.length) return b;
    if (rows.length) b[rows[0] * 8 + rng.int(8)] = 0;
    else b[rng.int(8) * 8 + cols[0]] = 0;
  }
}

// ---- independent brute-force reference (plain arrays, no board.js / solver.js) ----

function refApply(board, shape, row, col) {
  for (const [r, c] of shape.cells) {
    const rr = row + r;
    const cc = col + c;
    if (rr < 0 || rr > 7 || cc < 0 || cc > 7 || board[rr * 8 + cc]) return null;
  }
  const next = board.slice();
  for (const [r, c] of shape.cells) next[(row + r) * 8 + col + c] = 1;
  const rows = [];
  const cols = [];
  for (let i = 0; i < 8; i++) {
    let rowFull = true;
    let colFull = true;
    for (let j = 0; j < 8; j++) {
      if (!next[i * 8 + j]) rowFull = false;
      if (!next[j * 8 + i]) colFull = false;
    }
    if (rowFull) rows.push(i);
    if (colFull) cols.push(i);
  }
  for (const r of rows) for (let c = 0; c < 8; c++) next[r * 8 + c] = 0;
  for (const c of cols) for (let r = 0; r < 8; r++) next[r * 8 + c] = 0;
  return { board: next, lines: rows.length + cols.length };
}

function refFitsAnywhere(board, shape) {
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      if (shape.cells.every(([r, c]) => row + r < 8 && col + c < 8 && !board[(row + r) * 8 + col + c])) return true;
    }
  }
  return false;
}

// Every permutation × every position, no pruning or deduplication.
function refCanPlaceAll(board, shapes) {
  if (shapes.length === 0) return true;
  if (shapes.length === 1) return refFitsAnywhere(board, shapes[0]);
  for (let i = 0; i < shapes.length; i++) {
    const rest = shapes.filter((_, j) => j !== i);
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const res = refApply(board, shapes[i], row, col);
        if (res && refCanPlaceAll(res.board, rest)) return true;
      }
    }
  }
  return false;
}

function refCanCompleteLine(board, shape) {
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const res = refApply(board, shape, row, col);
      if (res && res.lines > 0) return true;
    }
  }
  return false;
}

// ---- tests ----

test('canPlaceMask agrees with board.canPlace everywhere (incl. out of bounds)', () => {
  const rng = makeRng(21);
  for (let k = 0; k < 150; k++) {
    const b = randomBoard(rng, rng.next());
    const m = toRowMasks(b);
    for (const s of SHAPES) {
      for (let row = -2; row < 10; row++) {
        for (let col = -2; col < 10; col++) assert.equal(canPlaceMask(m, s, row, col), canPlace(b, s, row, col));
      }
    }
  }
  const m = toRowMasks(emptyBoard());
  for (const bad of [0.5, NaN, '0', null, undefined, Infinity]) {
    assert.equal(canPlaceMask(m, S.dot, bad, 0), false);
    assert.equal(canPlaceMask(m, S.dot, 0, bad), false);
  }
});

test('placeAndClearMask matches placeShape + findFullLines + clearLines', () => {
  const rng = makeRng(22);
  let multi = 0;
  for (let k = 0; k < 300; k++) {
    const b = randomBoard(rng, 0.5 + rng.next() * 0.45);
    const m = toRowMasks(b);
    const before = [...m];
    const s = rng.pick(SHAPES);
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const res = placeAndClearMask(m, s, row, col);
        if (!canPlace(b, s, row, col)) {
          assert.equal(res, null);
          continue;
        }
        const placed = placeShape(b, s, row, col, 1);
        const lines = findFullLines(placed);
        const after = clearLines(placed, lines.rows, lines.cols).board;
        assert.deepEqual(res.masks, toRowMasks(after));
        assert.equal(res.lines, lines.rows.length + lines.cols.length);
        if (res.lines >= 2) multi++;
      }
    }
    assert.deepEqual(m, before, 'input masks not mutated');
  }
  assert.ok(multi > 0, 'multi-line clears exercised');
  // explicit crossing: row 3 + column 5 → 2 lines, everything on them emptied
  const cross = toRowMasks(parse([
    '.....#..',
    '.....#..',
    '.....#..',
    '#####.##',
    '.....#..',
    '.....#..',
    '.....#..',
    '.....#.#',
  ]));
  assert.deepEqual(placeAndClearMask(cross, S.dot, 3, 5), { masks: [0, 0, 0, 0, 0, 0, 0, 128], lines: 2 });
  assert.equal(placeAndClearMask(cross, S.dot, 3, 4), null);
  assert.equal(placeAndClearMask(cross, S.i2h, 0, 7), null);
});

test('countPlacementsMask equals validPositions().length', () => {
  const rng = makeRng(23);
  for (let k = 0; k < 200; k++) {
    const b = randomBoard(rng, rng.next());
    const m = toRowMasks(b);
    for (const s of SHAPES) assert.equal(countPlacementsMask(m, s), validPositions(b, s).length);
  }
  for (const s of SHAPES) assert.equal(countPlacementsMask(toRowMasks(emptyBoard()), s), (9 - s.h) * (9 - s.w));
});

test('canCompleteLine agrees with brute force', (t) => {
  const rng = makeRng(24);
  let yes = 0;
  let no = 0;
  for (let k = 0; k < 250; k++) {
    const b = randomBoard(rng, 0.5 + rng.next() * 0.45);
    const plain = Array.from(b, (v) => (v ? 1 : 0));
    const m = toRowMasks(b);
    for (const s of SHAPES) {
      const expected = refCanCompleteLine(plain, s);
      assert.equal(canCompleteLine(m, s), expected, s.id);
      if (expected) yes++;
      else no++;
    }
  }
  t.diagnostic(`completes a line ${yes} / cannot ${no}`);
  assert.ok(yes > 500 && no > 500, `yes ${yes} / no ${no}`);
  for (const s of SHAPES) assert.equal(canCompleteLine(toRowMasks(emptyBoard()), s), false, 'nothing completes a line on an empty board');
  const rowGap = toRowMasks(parse([
    '.#######',
    '........',
    '........',
    '........',
    '........',
    '........',
    '........',
    '........',
  ]));
  assert.equal(canCompleteLine(rowGap, S.dot), true);
  assert.equal(canCompleteLine(rowGap, S.i2v), true);
  assert.equal(canCompleteLine(rowGap, S.i2h), false);
  assert.equal(canCompleteLine(rowGap, S.o2), false);
});

test('canPlaceAllInSomeOrder: trivial cases', () => {
  const empty = toRowMasks(emptyBoard());
  assert.equal(canPlaceAllInSomeOrder(empty, []), true);
  assert.equal(canPlaceAllInSomeOrder(empty, [null, null, null]), true);
  assert.equal(canPlaceAllInSomeOrder(empty, [null, S.o3, null]), true);
  assert.equal(canPlaceAllInSomeOrder(empty, [S.o3, S.o3, S.o3]), true);
  for (let i = 0; i < SHAPES.length; i++) {
    assert.equal(canPlaceAllInSomeOrder(empty, [SHAPES[i], SHAPES[(i + 7) % 41], SHAPES[(i + 19) % 41]]), true);
  }
  const full = new Array(8).fill(255);
  assert.equal(canPlaceAllInSomeOrder(full, [S.dot]), false);
  assert.equal(canPlaceAllInSomeOrder(full, [S.dot, S.dot, S.dot]), false);
});

test('canPlaceAllInSomeOrder: a piece that only fits after another piece clears a line', () => {
  const b = parse([
    '##.#####',
    '####.###',
    '######.#',
    '###.####',
    '#####.##',
    '#######.',
    '..######',
    '####....',
  ]);
  const m = toRowMasks(b);
  assert.deepEqual(findFullLines(b), { rows: [], cols: [] });
  assert.equal(validPositions(b, S.o2).length, 0, 'o2 does not fit at first');
  assert.deepEqual(validPositions(b, S.i4h), [{ row: 7, col: 4 }]);
  assert.deepEqual(placeAndClearMask(m, S.i4h, 7, 4), {
    masks: [0b11111011, 0b11101111, 0b10111111, 0b11110111, 0b11011111, 0b01111111, 0b11111100, 0],
    lines: 1,
  });
  assert.equal(canPlaceAllInSomeOrder(m, [S.o2, S.i4h]), true);
  assert.equal(canPlaceAllInSomeOrder(m, [S.i4h, S.o2]), true);
  assert.equal(canPlaceAllInSomeOrder(m, [S.o2]), false);
  assert.equal(canPlaceAllInSomeOrder(m, [S.o2, S.o2]), false);
  assert.equal(canPlaceAllInSomeOrder(m, [S.o2, S.dot]), refCanPlaceAll(Array.from(b), [S.o2, S.dot]));
  assert.equal(canPlaceAllInSomeOrder(m, [S.o2, S.i4h, S.o2]), refCanPlaceAll(Array.from(b), [S.o2, S.i4h, S.o2]));
});

test('canPlaceAllInSomeOrder: each fits alone but not all together', () => {
  const b = parse([
    '...##.##',
    '...####.',
    '...#.###',
    '######.#',
    '.#######',
    '##.#####',
    '#.######',
    '###.####',
  ]);
  const m = toRowMasks(b);
  assert.deepEqual(findFullLines(b), { rows: [], cols: [] });
  assert.deepEqual(validPositions(b, S.o3), [{ row: 0, col: 0 }]);
  assert.equal(placeAndClearMask(m, S.o3, 0, 0).lines, 0);
  assert.equal(canPlaceAllInSomeOrder(m, [S.o3]), true);
  assert.equal(canPlaceAllInSomeOrder(m, [S.o3, S.o3]), false);
  assert.equal(canPlaceAllInSomeOrder(m, [S.o3, S.dot]), true);
  assert.equal(canPlaceAllInSomeOrder(m, [S.o3, S.o3, S.dot]), refCanPlaceAll(Array.from(b), [S.o3, S.o3, S.dot]));
});

test('canPlaceAllInSomeOrder agrees with brute force on 300 seeded random boards', (t) => {
  const rng = makeRng(25);
  let yes = 0;
  let no = 0;
  for (let k = 0; k < 300; k++) {
    const b = randomBoard(rng, 0.3 + rng.next() * 0.6);
    const plain = Array.from(b, (v) => (v ? 1 : 0));
    const m = toRowMasks(b);
    for (let h = 0; h < 2; h++) {
      const count = 1 + rng.int(3);
      const hand = [];
      for (let i = 0; i < count; i++) hand.push(i > 0 && rng.next() < 0.25 ? hand[0] : rng.pick(SHAPES));
      const expected = refCanPlaceAll(plain, hand);
      assert.equal(canPlaceAllInSomeOrder(m, hand), expected, `board ${k}: ${hand.map((s) => s.id)}`);
      // order of the input never matters
      assert.equal(canPlaceAllInSomeOrder(m, [...hand].reverse()), expected);
      if (expected) yes++;
      else no++;
    }
  }
  t.diagnostic(`placeable ${yes} / not placeable ${no}`);
  assert.ok(yes >= 150 && no >= 150, `yes ${yes} / no ${no}`);
});

test('canPlaceAllInSomeOrder agrees with brute force on dense boards with small pieces', (t) => {
  const rng = makeRng(26);
  const small = SHAPES.filter((s) => s.n <= 3);
  let yes = 0;
  let no = 0;
  for (let k = 0; k < 200; k++) {
    const b = randomBoard(rng, 0.75 + rng.next() * 0.2);
    const plain = Array.from(b, (v) => (v ? 1 : 0));
    const hand = [rng.pick(small), rng.pick(small), rng.next() < 0.5 ? rng.pick(small) : rng.pick(SHAPES)];
    const expected = refCanPlaceAll(plain, hand);
    assert.equal(canPlaceAllInSomeOrder(toRowMasks(b), hand), expected, `board ${k}: ${hand.map((s) => s.id)}`);
    if (expected) yes++;
    else no++;
  }
  t.diagnostic(`placeable ${yes} / not placeable ${no}`);
  assert.ok(yes >= 30 && no >= 30, `yes ${yes} / no ${no}`);
});

test('perf: 500 random 3-piece checks on ~half-full boards finish in < 1.5 s', (t) => {
  const rng = makeRng(27);
  const cases = [];
  for (let k = 0; k < 500; k++) {
    const b = randomBoard(rng, 0.4 + rng.next() * 0.2);
    cases.push([toRowMasks(b), [rng.pick(SHAPES), rng.pick(SHAPES), rng.pick(SHAPES)]]);
  }
  let worst = 0;
  const t0 = performance.now();
  for (const [m, hand] of cases) {
    const t = performance.now();
    canPlaceAllInSomeOrder(m, hand);
    worst = Math.max(worst, performance.now() - t);
  }
  const total = performance.now() - t0;
  t.diagnostic(`500 checks: ${total.toFixed(1)} ms total, slowest ${worst.toFixed(3)} ms`);
  assert.ok(total < 1500, `500 checks took ${total.toFixed(1)} ms`);
  assert.ok(worst < 50, `slowest single check ${worst.toFixed(2)} ms`);
});
