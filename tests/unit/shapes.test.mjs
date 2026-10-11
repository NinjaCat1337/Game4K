import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SHAPES, SHAPE_BY_ID, GROUPS, getShape } from '../../src/core/shapes.js';

// Independent transcription of the spec §3 catalog table as pictures ('#' = cell), in catalog order.
const TABLE = [
  ['dot', 'dot', 0.3, ['#']],
  ['i2h', 'i2', 0.6, ['##']],
  ['i2v', 'i2', 0.6, ['#', '#']],
  ['i3h', 'i3', 1.0, ['###']],
  ['i3v', 'i3', 1.0, ['#', '#', '#']],
  ['i4h', 'i4', 4.5, ['####']],
  ['i4v', 'i4', 4.5, ['#', '#', '#', '#']],
  ['i5h', 'i5', 4.5, ['#####']],
  ['i5v', 'i5', 4.5, ['#', '#', '#', '#', '#']],
  ['o2', 'o2', 5.5, ['##', '##']],
  ['o3', 'o3', 10, ['###', '###', '###']],
  ['r23', 'rect', 5, ['###', '###']],
  ['r32', 'rect', 5.5, ['##', '##', '##']],
  ['c3a', 'corner3', 0.6, ['##', '#.']],
  ['c3b', 'corner3', 0.6, ['##', '.#']],
  ['c3c', 'corner3', 0.6, ['#.', '##']],
  ['c3d', 'corner3', 0.6, ['.#', '##']],
  ['c5a', 'corner5', 2, ['###', '#..', '#..']],
  ['c5b', 'corner5', 2, ['###', '..#', '..#']],
  ['c5c', 'corner5', 2, ['#..', '#..', '###']],
  ['c5d', 'corner5', 2, ['..#', '..#', '###']],
  ['l4a', 'l4', 2, ['###', '#..']],
  ['l4b', 'l4', 2, ['###', '..#']],
  ['l4c', 'l4', 2, ['#..', '###']],
  ['l4d', 'l4', 2, ['..#', '###']],
  ['l4e', 'l4', 2, ['#.', '#.', '##']],
  ['l4f', 'l4', 2, ['.#', '.#', '##']],
  ['l4g', 'l4', 2, ['##', '#.', '#.']],
  ['l4h', 'l4', 2, ['##', '.#', '.#']],
  ['t4u', 't4', 3, ['.#.', '###']],
  ['t4d', 't4', 3, ['###', '.#.']],
  ['t4l', 't4', 3, ['.#', '##', '.#']],
  ['t4r', 't4', 3, ['#.', '##', '#.']],
  ['s4h', 'sz', 2, ['.##', '##.']],
  ['z4h', 'sz', 2, ['##.', '.##']],
  ['s4v', 'sz', 2, ['#.', '##', '.#']],
  ['z4v', 'sz', 2, ['.#', '##', '#.']],
  ['d2a', 'diag2', 0.4, ['#.', '.#']],
  ['d2b', 'diag2', 0.4, ['.#', '#.']],
  ['d3a', 'diag3', 0.5, ['#..', '.#.', '..#']],
  ['d3b', 'diag3', 0.5, ['..#', '.#.', '#..']],
];

const EXPECTED_GROUPS = [
  'dot', 'i2', 'i3', 'i4', 'i5', 'o2', 'o3', 'rect', 'corner3', 'corner5', 'l4', 't4', 'sz', 'diag2', 'diag3',
];

function cellsOf(picture) {
  const cells = [];
  picture.forEach((line, r) => [...line].forEach((ch, c) => ch === '#' && cells.push([r, c])));
  return cells;
}

const key = (cells) => cells.map(([r, c]) => `${r},${c}`).join(';');

test('the catalog has exactly the 41 spec shapes in catalog order', () => {
  assert.equal(SHAPES.length, 41);
  assert.deepEqual(SHAPES.map((s) => s.id), TABLE.map((t) => t[0]));
});

test('every shape matches the spec table: cells, group, weight, w/h/n, masks', () => {
  TABLE.forEach(([id, group, weight, picture], i) => {
    const s = SHAPES[i];
    const cells = cellsOf(picture);
    assert.equal(s.id, id);
    assert.equal(s.group, group, id);
    assert.equal(s.weight, weight, id);
    assert.deepEqual(s.cells.map((p) => [...p]), cells, id);
    assert.equal(s.n, cells.length, id);
    assert.equal(s.h, picture.length, id);
    assert.equal(s.w, Math.max(...picture.map((line) => line.length)), id);
    assert.deepEqual([...s.masks], picture.map((line) => [...line].reduce((m, ch, c) => (ch === '#' ? m | (1 << c) : m), 0)), id);
    assert.deepEqual(Object.keys(s), ['id', 'group', 'cells', 'w', 'h', 'n', 'masks', 'weight']);
  });
});

test('cells are normalized, sorted, unique; w/h are the bounding box', () => {
  for (const s of SHAPES) {
    const rs = s.cells.map((p) => p[0]);
    const cs = s.cells.map((p) => p[1]);
    assert.equal(Math.min(...rs), 0, s.id);
    assert.equal(Math.min(...cs), 0, s.id);
    assert.equal(Math.max(...rs) + 1, s.h, s.id);
    assert.equal(Math.max(...cs) + 1, s.w, s.id);
    const sorted = [...s.cells].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    assert.deepEqual(s.cells, sorted, s.id);
    assert.equal(new Set(s.cells.map((p) => `${p[0]},${p[1]}`)).size, s.n, s.id);
    for (const [r, c] of s.cells) {
      assert.ok(Number.isInteger(r) && Number.isInteger(c));
      assert.ok(r >= 0 && r < 5 && c >= 0 && c < 5);
    }
  }
});

test('masks: one per row, every row occupied, bits match cells, within width', () => {
  for (const s of SHAPES) {
    assert.equal(s.masks.length, s.h, s.id);
    let bits = 0;
    s.masks.forEach((m, r) => {
      assert.ok(m > 0, `${s.id} row ${r} empty`);
      assert.ok(m < 1 << s.w, s.id);
      const expected = s.cells.filter((p) => p[0] === r).reduce((acc, p) => acc | (1 << p[1]), 0);
      assert.equal(m, expected, `${s.id} row ${r}`);
      for (let x = m; x; x &= x - 1) bits++;
    });
    assert.equal(bits, s.n, s.id);
    // the leftmost column is used by some row (normalized)
    assert.ok(s.masks.some((m) => m & 1), s.id);
  }
});

test('all 41 cell-sets are distinct', () => {
  assert.equal(new Set(SHAPES.map((s) => key(s.cells))).size, 41);
});

test('group sizes and weights', () => {
  const sizes = {};
  for (const s of SHAPES) sizes[s.group] = (sizes[s.group] || 0) + 1;
  assert.deepEqual(sizes, {
    dot: 1, i2: 2, i3: 2, i4: 2, i5: 2, o2: 1, o3: 1, rect: 2, corner3: 4, corner5: 4, l4: 8, t4: 4, sz: 4,
    diag2: 2, diag3: 2,
  });
  for (const s of SHAPES) assert.ok(s.weight > 0, s.id);
  const total = SHAPES.reduce((a, s) => a + s.weight, 0);
  assert.ok(Math.abs(total - 95.7) < 1e-9, String(total));
});

test('diagonal pieces touch only at corners; every other piece is edge-connected', () => {
  for (const s of SHAPES) {
    const set = new Set(s.cells.map(([r, c]) => `${r},${c}`));
    const edgeNeighbours = ([r, c]) => [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].filter(([a, b]) => set.has(`${a},${b}`));
    if (s.group === 'diag2' || s.group === 'diag3') {
      for (const p of s.cells) assert.equal(edgeNeighbours(p).length, 0, s.id);
      continue;
    }
    const seen = new Set([key([s.cells[0]])]);
    const stack = [s.cells[0]];
    while (stack.length) {
      for (const q of edgeNeighbours(stack.pop())) {
        const k = `${q[0]},${q[1]}`;
        if (!seen.has(k)) {
          seen.add(k);
          stack.push(q);
        }
      }
    }
    assert.equal(seen.size, s.n, `${s.id} is not connected`);
  }
});

test('SHAPE_BY_ID maps every id to the same frozen object and nothing else', () => {
  assert.ok(Object.isFrozen(SHAPE_BY_ID));
  assert.deepEqual(Object.keys(SHAPE_BY_ID), SHAPES.map((s) => s.id));
  for (const s of SHAPES) assert.equal(SHAPE_BY_ID[s.id], s);
  for (const bad of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
    assert.equal(SHAPE_BY_ID[bad], undefined, bad);
  }
});

test('GROUPS lists the 15 groups in catalog order (frozen)', () => {
  assert.deepEqual([...GROUPS], EXPECTED_GROUPS);
  assert.ok(Object.isFrozen(GROUPS));
});

test('getShape returns catalog objects and throws on unknown ids', () => {
  for (const s of SHAPES) assert.equal(getShape(s.id), s);
  for (const bad of ['nope', '', 'O3', 'DOT', 'constructor', '__proto__', 'toString', undefined, null, 42, {}, Symbol('x')]) {
    assert.throws(() => getShape(bad), Error, String(typeof bad === 'symbol' ? 'symbol' : bad));
  }
});

test('the catalog is deeply frozen', () => {
  assert.ok(Object.isFrozen(SHAPES));
  for (const s of SHAPES) {
    assert.ok(Object.isFrozen(s), s.id);
    assert.ok(Object.isFrozen(s.cells), s.id);
    assert.ok(Object.isFrozen(s.masks), s.id);
    for (const p of s.cells) assert.ok(Object.isFrozen(p), s.id);
  }
  assert.throws(() => { SHAPES[0].n = 5; }, TypeError);
  assert.throws(() => { SHAPES[10].cells[0][0] = 3; }, TypeError);
  assert.throws(() => { SHAPES.push(SHAPES[0]); }, TypeError);
});
