import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  emptyBoard, cloneBoard, canPlace, placeShape, findFullLines, linesCompletedBy, clearLines,
  validPositions, hasAnyPlacement, filledCount, isEmpty, toRowMasks,
} from '../../src/core/board.js';
import { SHAPES, SHAPE_BY_ID } from '../../src/core/shapes.js';
import { makeRng } from '../../src/core/rng.js';

const S = SHAPE_BY_ID;

/** 8 strings of 8 chars: '.' empty, '1'..'7' color. */
function parse(rows) {
  assert.equal(rows.length, 8);
  const b = new Uint8Array(64);
  rows.forEach((line, r) => {
    assert.equal(line.length, 8);
    [...line].forEach((ch, c) => { b[r * 8 + c] = ch === '.' ? 0 : Number(ch); });
  });
  return b;
}

function randomBoard(rng, density) {
  const b = new Uint8Array(64);
  for (let i = 0; i < 64; i++) if (rng.next() < density) b[i] = 1 + rng.int(7);
  return b;
}

// Independent reference: does the shape fit at (row, col)?
function refFits(board, shape, row, col) {
  return shape.cells.every(([r, c]) => {
    const rr = row + r;
    const cc = col + c;
    return rr >= 0 && rr < 8 && cc >= 0 && cc < 8 && board[rr * 8 + cc] === 0;
  });
}

function refFullLines(board) {
  const rows = [];
  const cols = [];
  for (let i = 0; i < 8; i++) {
    let row = true;
    let col = true;
    for (let j = 0; j < 8; j++) {
      if (!board[i * 8 + j]) row = false;
      if (!board[j * 8 + i]) col = false;
    }
    if (row) rows.push(i);
    if (col) cols.push(i);
  }
  return { rows, cols };
}

test('emptyBoard / cloneBoard / filledCount / isEmpty', () => {
  const a = emptyBoard();
  assert.ok(a instanceof Uint8Array);
  assert.equal(a.length, 64);
  assert.ok(a.every((v) => v === 0));
  assert.notEqual(emptyBoard(), a, 'a new board each call');
  assert.equal(filledCount(a), 0);
  assert.ok(isEmpty(a));

  a[10] = 3;
  const b = cloneBoard(a);
  assert.ok(b instanceof Uint8Array);
  assert.deepEqual([...b], [...a]);
  b[10] = 0;
  assert.equal(a[10], 3, 'the clone is independent');
  assert.equal(filledCount(a), 1);
  assert.ok(!isEmpty(a));
  assert.ok(isEmpty(b));

  const fromArray = cloneBoard(new Array(64).fill(2));
  assert.ok(fromArray instanceof Uint8Array);
  assert.equal(filledCount(fromArray), 64);
});

test('toRowMasks: bit c of row r = cell (r, c)', () => {
  const b = parse([
    '1.......',
    '.......2',
    '12345671',
    '........',
    '...3....',
    '........',
    '........',
    '7.7.7.7.',
  ]);
  assert.deepEqual(toRowMasks(b), [1, 128, 255, 0, 8, 0, 0, 0b01010101]);
  const rng = makeRng(4);
  for (let k = 0; k < 50; k++) {
    const rb = randomBoard(rng, 0.5);
    const m = toRowMasks(rb);
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) assert.equal(Boolean(m[r] & (1 << c)), rb[r * 8 + c] !== 0);
  }
});

test('canPlace on an empty board: exactly the in-bounds positions', () => {
  const b = emptyBoard();
  for (const s of SHAPES) {
    for (let row = -2; row < 10; row++) {
      for (let col = -2; col < 10; col++) {
        const inside = row >= 0 && col >= 0 && row + s.h <= 8 && col + s.w <= 8;
        assert.equal(canPlace(b, s, row, col), inside, `${s.id} @${row},${col}`);
      }
    }
  }
});

test('canPlace rejects out-of-bounds and non-integer coordinates', () => {
  const b = emptyBoard();
  assert.equal(canPlace(b, S.i5h, 0, 4), false);
  assert.equal(canPlace(b, S.i5h, 0, 3), true);
  assert.equal(canPlace(b, S.i5v, 4, 0), false);
  assert.equal(canPlace(b, S.i5v, 3, 0), true);
  assert.equal(canPlace(b, S.dot, 8, 0), false);
  assert.equal(canPlace(b, S.dot, 0, 8), false);
  assert.equal(canPlace(b, S.dot, -1, 0), false);
  for (const bad of [0.5, NaN, Infinity, '0', null, undefined]) {
    assert.equal(canPlace(b, S.dot, bad, 0), false, String(bad));
    assert.equal(canPlace(b, S.dot, 0, bad), false, String(bad));
  }
});

test('canPlace detects overlaps; diagonal pieces ignore the cells between them', () => {
  const b = parse([
    '.1......',
    '1.......',
    '........',
    '........',
    '........',
    '........',
    '........',
    '........',
  ]);
  assert.equal(canPlace(b, S.d2a, 0, 0), true, 'd2a cells (0,0),(1,1) are free');
  assert.equal(canPlace(b, S.d2b, 0, 0), false);
  assert.equal(canPlace(b, S.o2, 0, 0), false);
  assert.equal(canPlace(b, S.dot, 0, 1), false);
  assert.equal(canPlace(b, S.dot, 0, 0), true);
  const rng = makeRng(8);
  for (let k = 0; k < 120; k++) {
    const rb = randomBoard(rng, rng.next());
    for (const s of SHAPES) {
      for (let row = -1; row < 9; row++) {
        for (let col = -1; col < 9; col++) assert.equal(canPlace(rb, s, row, col), refFits(rb, s, row, col));
      }
    }
  }
});

test('placeShape returns a new board with the piece colored and never mutates', () => {
  const b = emptyBoard();
  b[0] = 4;
  const next = placeShape(b, S.t4u, 2, 3, 6);
  assert.notEqual(next, b);
  assert.ok(next instanceof Uint8Array);
  assert.deepEqual([...b], [4, ...new Array(63).fill(0)], 'input untouched');
  const expected = new Uint8Array(b);
  for (const [r, c] of [[2, 4], [3, 3], [3, 4], [3, 5]]) expected[r * 8 + c] = 6;
  assert.deepEqual(next, expected);
  assert.equal(filledCount(next), 5);
});

test('findFullLines: rows and columns, ascending', () => {
  assert.deepEqual(findFullLines(emptyBoard()), { rows: [], cols: [] });
  const full = new Uint8Array(64).fill(1);
  assert.deepEqual(findFullLines(full), { rows: [0, 1, 2, 3, 4, 5, 6, 7], cols: [0, 1, 2, 3, 4, 5, 6, 7] });
  const b = parse([
    '1......1',
    '1......1',
    '22222222',
    '1......1',
    '1......1',
    '33333333',
    '1......1',
    '1......1',
  ]);
  assert.deepEqual(findFullLines(b), { rows: [2, 5], cols: [0, 7] });
  const almost = parse([
    '1111111.',
    '1.......',
    '1.......',
    '1.......',
    '1.......',
    '1.......',
    '1.......',
    '........',
  ]);
  assert.deepEqual(findFullLines(almost), { rows: [], cols: [] });
  const rng = makeRng(9);
  for (let k = 0; k < 300; k++) {
    const rb = randomBoard(rng, 0.75 + rng.next() * 0.25);
    assert.deepEqual(findFullLines(rb), refFullLines(rb));
  }
});

test('clearLines: rows only, columns only, crossings removed once', () => {
  const b = parse([
    '...4....',
    '...4....',
    '12345671',
    '...4....',
    '...4....',
    '...4....',
    '...4..5.',
    '...4....',
  ]);
  const rowOnly = clearLines(b, [2], []);
  assert.equal(rowOnly.cleared.length, 8);
  assert.deepEqual(rowOnly.cleared.map((x) => x.c), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.ok(rowOnly.cleared.every((x) => x.r === 2));
  assert.deepEqual(rowOnly.cleared.map((x) => x.color), [1, 2, 3, 4, 5, 6, 7, 1]);

  const colOnly = clearLines(b, [], [3]);
  assert.equal(colOnly.cleared.length, 8);
  assert.ok(colOnly.cleared.every((x) => x.c === 3 && x.color === 4));

  const both = clearLines(b, [2], [3]);
  assert.equal(both.cleared.length, 15, '8 + 8 − 1 crossing cell');
  const keys = both.cleared.map((x) => `${x.r},${x.c}`);
  assert.equal(new Set(keys).size, 15, 'each cell once');
  assert.equal(keys.filter((k) => k === '2,3').length, 1);
  assert.deepEqual(both.cleared.find((x) => x.r === 2 && x.c === 3), { r: 2, c: 3, color: 4 });
  // row-major order
  const order = both.cleared.map((x) => x.r * 8 + x.c);
  assert.deepEqual(order, [...order].sort((x, y) => x - y));
  // new board, the rest untouched, the input untouched
  assert.notEqual(both.board, b);
  assert.equal(filledCount(both.board), 1);
  assert.equal(both.board[6 * 8 + 6], 5);
  assert.equal(filledCount(b), 16);
});

test('clearLines reports only non-empty cells and ignores invalid indices', () => {
  const b = parse([
    '1.......',
    '........',
    '........',
    '........',
    '........',
    '........',
    '........',
    '.......2',
  ]);
  const res = clearLines(b, [0, 7, 8, -1, 1.5, '3'], [9]);
  assert.deepEqual(res.cleared, [{ r: 0, c: 0, color: 1 }, { r: 7, c: 7, color: 2 }]);
  assert.ok(isEmpty(res.board));
  const none = clearLines(b, [], []);
  assert.deepEqual(none.cleared, []);
  assert.deepEqual([...none.board], [...b]);
  assert.notEqual(none.board, b);
});

test('placing into a row+column crossing completes 2 lines and removes the shared cell once', () => {
  const b = parse([
    '.....3..',
    '.....3..',
    '.....3..',
    '11111.11',
    '.....3..',
    '.....3..',
    '.....3..',
    '.....3.6',
  ]);
  assert.ok(canPlace(b, S.dot, 3, 5));
  assert.deepEqual(linesCompletedBy(b, S.dot, 3, 5), { rows: [3], cols: [5] });
  const placed = placeShape(b, S.dot, 3, 5, 7);
  const lines = findFullLines(placed);
  assert.deepEqual(lines, { rows: [3], cols: [5] });
  const { board, cleared } = clearLines(placed, lines.rows, lines.cols);
  assert.equal(lines.rows.length + lines.cols.length, 2);
  assert.equal(cleared.length, 15);
  assert.deepEqual(cleared.filter((x) => x.r === 3 && x.c === 5), [{ r: 3, c: 5, color: 7 }]);
  assert.equal(filledCount(board), 1);
  assert.equal(board[63], 6);
});

test('linesCompletedBy previews exactly what placing would produce, without mutating', () => {
  const rng = makeRng(10);
  let withLines = 0;
  for (let k = 0; k < 400; k++) {
    const b = randomBoard(rng, 0.55 + rng.next() * 0.4);
    // keep boards realistic: no full lines before the move
    const pre = findFullLines(b);
    const board = clearLines(b, pre.rows, pre.cols).board;
    const copy = cloneBoard(board);
    const s = rng.pick(SHAPES);
    for (const { row, col } of validPositions(board, s)) {
      const preview = linesCompletedBy(board, s, row, col);
      assert.deepEqual(preview, findFullLines(placeShape(board, s, row, col, 1)));
      if (preview.rows.length + preview.cols.length > 0) withLines++;
    }
    assert.deepEqual(board, copy);
  }
  assert.ok(withLines > 50, `exercised ${withLines} line-completing previews`);
  const full = parse([
    '1111111.',
    '........',
    '........',
    '........',
    '........',
    '........',
    '........',
    '........',
  ]);
  assert.deepEqual(linesCompletedBy(full, S.dot, 0, 7), { rows: [0], cols: [] });
  assert.deepEqual(linesCompletedBy(full, S.dot, 0, 0), { rows: [], cols: [] }, 'invalid → empty');
  assert.deepEqual(linesCompletedBy(full, S.i2h, 0, 7), { rows: [], cols: [] }, 'out of bounds → empty');
  assert.deepEqual(linesCompletedBy(full, S.i2h, 1, 0), { rows: [], cols: [] });
});

test('validPositions / hasAnyPlacement', () => {
  const b = emptyBoard();
  for (const s of SHAPES) {
    const pos = validPositions(b, s);
    assert.equal(pos.length, (9 - s.h) * (9 - s.w), s.id);
    assert.deepEqual(pos[0], { row: 0, col: 0 });
    assert.ok(hasAnyPlacement(b, s));
  }
  const rng = makeRng(12);
  let none = 0;
  for (let k = 0; k < 200; k++) {
    const rb = randomBoard(rng, 0.3 + rng.next() * 0.7);
    for (const s of SHAPES) {
      const expected = [];
      for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) if (refFits(rb, s, row, col)) expected.push({ row, col });
      assert.deepEqual(validPositions(rb, s), expected);
      assert.equal(hasAnyPlacement(rb, s), expected.length > 0);
      if (!expected.length) none++;
    }
  }
  assert.ok(none > 100, 'some shapes did not fit');
  const full = new Uint8Array(64).fill(3);
  for (const s of SHAPES) {
    assert.deepEqual(validPositions(full, s), []);
    assert.equal(hasAnyPlacement(full, s), false);
  }
});
