import { test } from 'node:test';
import assert from 'node:assert/strict';

import { placementPoints, lineBase, clearPoints, praiseFor } from '../../src/core/scoring.js';
import { SHAPES, SHAPE_BY_ID } from '../../src/core/shapes.js';

test('placementPoints = number of cells', () => {
  for (const s of SHAPES) assert.equal(placementPoints(s), s.n, s.id);
  assert.equal(placementPoints(SHAPE_BY_ID.dot), 1);
  assert.equal(placementPoints(SHAPE_BY_ID.o2), 4);
  assert.equal(placementPoints(SHAPE_BY_ID.o3), 9);
  assert.equal(placementPoints(SHAPE_BY_ID.c5a), 5);
  assert.equal(placementPoints(SHAPE_BY_ID.d3b), 3);
});

test('lineBase: 0 → 0, 1 → 10, n ≥ 2 → 10·n·(n−1)', () => {
  const expected = [0, 10, 20, 60, 120, 200, 300, 420, 560];
  expected.forEach((v, n) => assert.equal(lineBase(n), v, `lines ${n}`));
  for (let n = 2; n <= 16; n++) assert.equal(lineBase(n), 10 * n * (n - 1));
  assert.equal(lineBase(-1), 0);
  assert.equal(lineBase(NaN), 0);
  assert.equal(lineBase(undefined), 0);
});

test('clearPoints = lineBase × (streakBefore + 1)', () => {
  // consecutive single-line clears: streak 0,1,2,3 → 10, 20, 30, 40
  assert.deepEqual([0, 1, 2, 3].map((s) => clearPoints(1, s)), [10, 20, 30, 40]);
  assert.equal(clearPoints(2, 0), 20);
  assert.equal(clearPoints(3, 1), 120);
  assert.equal(clearPoints(0, 0), 0);
  assert.equal(clearPoints(0, 9), 0, 'no lines → no clear points at any streak');
  for (let lines = 0; lines <= 8; lines++) {
    for (let streak = 0; streak <= 20; streak++) assert.equal(clearPoints(lines, streak), lineBase(lines) * (streak + 1));
  }
  assert.equal(clearPoints(1, undefined), 10, 'a missing streak counts as 0');
});

test('clearPoints reproduces popups observed in the real game', () => {
  // [lines, combo number shown (= streakBefore), "+N" popup]
  const observed = [
    [1, 2, 30], [1, 3, 40], [1, 4, 50], [1, 6, 70], [1, 7, 80], [1, 9, 100], [1, 11, 120],
    [2, 0, 20], [2, 1, 40], [2, 2, 60], [2, 4, 100], [2, 5, 120], [2, 6, 140], [2, 10, 220],
    [3, 0, 60], [3, 1, 120], [3, 2, 180], [3, 3, 240],
    [4, 0, 120], [4, 1, 240],
    [5, 0, 200],
  ];
  for (const [lines, streak, popup] of observed) assert.equal(clearPoints(lines, streak), popup, `${lines} lines, combo ${streak}`);
});

test('praiseFor ladder', () => {
  assert.equal(praiseFor(0, false), null);
  assert.equal(praiseFor(1, false), null);
  assert.equal(praiseFor(2, false), 'Good!');
  assert.equal(praiseFor(3, false), 'Great!');
  assert.equal(praiseFor(4, false), 'Excellent!');
  assert.equal(praiseFor(5, false), 'Amazing!');
  assert.equal(praiseFor(6, false), 'Legendary!');
  assert.equal(praiseFor(7, false), 'Legendary!');
  assert.equal(praiseFor(16, false), 'Legendary!');
  for (let lines = 1; lines <= 8; lines++) assert.equal(praiseFor(lines, true), 'Unbelievable!', `all-clear with ${lines}`);
  assert.equal(praiseFor(2), 'Good!', 'allClear defaults to false');
});
