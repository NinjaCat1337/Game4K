import { test } from 'node:test';
import assert from 'node:assert/strict';

import { effectiveWeights, fairnessProbability, dealHand } from '../../src/core/generator.js';
import { SHAPES, SHAPE_BY_ID } from '../../src/core/shapes.js';
import { makeRng } from '../../src/core/rng.js';
import { emptyBoard, findFullLines, toRowMasks } from '../../src/core/board.js';
import { canPlaceAllInSomeOrder, canCompleteLine, countPlacementsMask } from '../../src/core/solver.js';

const shapesOf = (hand) => hand.map((p) => SHAPE_BY_ID[p.shapeId]);
const DOTS = [SHAPE_BY_ID.dot, SHAPE_BY_ID.dot, SHAPE_BY_ID.dot];

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

// One isolated empty cell per row and column (a permutation): only the 1×1 piece fits anywhere.
function dotsOnlyBoard() {
  const b = new Uint8Array(64).fill(1);
  [0, 2, 4, 6, 1, 3, 5, 7].forEach((c, r) => { b[r * 8 + c] = 0; });
  return b;
}

function assertValidHand(hand) {
  assert.ok(Array.isArray(hand));
  assert.equal(hand.length, 3);
  for (const p of hand) {
    assert.deepEqual(Object.keys(p).sort(), ['color', 'shapeId']);
    assert.ok(SHAPE_BY_ID[p.shapeId], `unknown shape ${p.shapeId}`);
    assert.ok(Number.isInteger(p.color) && p.color >= 1 && p.color <= 7, `color ${p.color}`);
  }
  assert.ok(!(hand[0].color === hand[1].color && hand[1].color === hand[2].color), 'three equal colors');
}

const GROUP_FACTOR = {
  low: { i2: 2, i3: 2, i4: 2, o2: 2, corner3: 2, t4: 2, o3: 0.5, corner5: 0.5, i5: 0.5 },
  mid: {},
  high: { o3: 1.3, corner5: 1.3, i5: 1.3, rect: 1.3 },
};

test('effectiveWeights follows the difficulty curve', () => {
  const tiers = [
    [0, 'low'], [1499, 'low'], [1499.99, 'low'], [-50, 'low'],
    [1500, 'mid'], [20000, 'mid'], [50000, 'mid'],
    [50000.5, 'high'], [50001, 'high'], [1e7, 'high'],
  ];
  for (const [score, tier] of tiers) {
    const w = effectiveWeights(score);
    assert.equal(w.length, SHAPES.length);
    SHAPES.forEach((s, i) => {
      const k = GROUP_FACTOR[tier][s.group] || 1;
      assert.ok(Math.abs(w[i] - s.weight * k) < 1e-12, `score ${score}: ${s.id} ${w[i]} vs ${s.weight * k}`);
    });
  }
  assert.deepEqual(effectiveWeights(20000), SHAPES.map((s) => s.weight));
  const a = effectiveWeights(0);
  a[0] = 999;
  assert.notEqual(effectiveWeights(0)[0], 999, 'a fresh array each call');
  assert.deepEqual(effectiveWeights(NaN), effectiveWeights(0));
});

test('fairnessProbability: 1 for the first 10 hands, then 0.9 → 0.6 with score', () => {
  for (let h = 0; h < 10; h++) {
    for (const score of [0, 5000, 50000, 1e6]) assert.equal(fairnessProbability(score, h), 1);
  }
  const close = (a, b) => Math.abs(a - b) < 1e-12;
  assert.ok(close(fairnessProbability(0, 10), 0.9));
  assert.ok(close(fairnessProbability(5000, 10), 0.9));
  assert.ok(close(fairnessProbability(27500, 25), 0.75));
  assert.ok(close(fairnessProbability(50000, 10), 0.6));
  assert.ok(close(fairnessProbability(1e7, 500), 0.6));
  let prev = 1;
  for (let score = 0; score <= 60000; score += 500) {
    const p = fairnessProbability(score, 12);
    assert.ok(p <= prev + 1e-12 && p >= 0.6 - 1e-12 && p <= 0.9 + 1e-12);
    prev = p;
  }
  assert.equal(fairnessProbability(0, undefined), 1);
});

test('dealHand always returns 3 valid pieces with valid colors', () => {
  const rng = makeRng(40);
  const full = new Uint8Array(64).fill(2);
  for (let k = 0; k < 600; k++) {
    const board = k % 50 === 0 ? full : randomBoard(rng, rng.next());
    const ctx = { score: rng.int(120000), handsDealt: rng.int(40), streak: rng.int(5), misses: rng.int(3) };
    assertValidHand(dealHand(board, makeRng(k), ctx));
  }
  assertValidHand(dealHand(emptyBoard(), makeRng(1)));
  assertValidHand(dealHand(emptyBoard(), makeRng(1), null));
});

test('dealHand is deterministic per seed, never mutates the board, and uses only the given rng', () => {
  const rng = makeRng(41);
  const realRandom = Math.random;
  Math.random = () => { throw new Error('Math.random used'); };
  try {
    const seen = new Set();
    for (let k = 0; k < 200; k++) {
      const board = randomBoard(rng, rng.next() * 0.8);
      const copy = Uint8Array.from(board);
      const ctx = { score: rng.int(80000), handsDealt: rng.int(30), streak: rng.int(4), misses: rng.int(3) };
      const r1 = makeRng(1000 + k);
      const r2 = makeRng(1000 + k);
      const h1 = dealHand(board, r1, ctx);
      const h2 = dealHand(board, r2, { ...ctx });
      assert.deepEqual(h1, h2);
      assert.equal(r1.state, r2.state, 'same number of draws');
      assert.deepEqual(board, copy);
      seen.add(JSON.stringify(h1));
    }
    assert.ok(seen.size > 150, 'different seeds/boards give different hands');
  } finally {
    Math.random = realRandom;
  }
});

test('colors: random 1..7, never all three equal', () => {
  const counts = new Array(8).fill(0);
  let twoEqual = 0;
  for (let s = 0; s < 4000; s++) {
    const hand = dealHand(emptyBoard(), makeRng(s), { score: 0, handsDealt: 0 });
    assertValidHand(hand);
    for (const p of hand) counts[p.color]++;
    const [a, b, c] = hand.map((p) => p.color);
    if (a === b || b === c || a === c) twoEqual++;
  }
  assert.equal(counts[0], 0);
  for (let c = 1; c <= 7; c++) assert.ok(Math.abs(counts[c] - 12000 / 7) < 200, `color ${c}: ${counts[c]}`);
  assert.ok(twoEqual > 1000, 'pairs of equal colors are allowed');
});

test('while handsDealt < 10 every hand is placeable in some order whenever such a hand exists', (t) => {
  const rng = makeRng(42);
  const weights = effectiveWeights(0);
  let checked = 0;
  let hardBoards = 0;
  for (let k = 0; k < 500; k++) {
    const board = randomBoard(rng, 0.3 + rng.next() * 0.69);
    const m = toRowMasks(board);
    // Three 1×1 pieces are the most placeable hand there is: if they cannot all be placed, no hand can.
    if (!canPlaceAllInSomeOrder(m, DOTS)) continue;
    checked++;
    // boards where 40 plain weighted candidates usually all fail (the guarantee needs more than luck)
    let luck = false;
    for (let t = 0; t < 40 && !luck; t++) luck = canPlaceAllInSomeOrder(m, [0, 1, 2].map(() => SHAPES[rng.weighted(weights)]));
    if (!luck) hardBoards++;
    const ctx = { score: rng.int(100000), handsDealt: k % 10, streak: rng.int(4), misses: rng.int(3) };
    const hand = dealHand(board, makeRng(k), ctx);
    assertValidHand(hand);
    assert.ok(canPlaceAllInSomeOrder(m, shapesOf(hand)), `board ${k}: ${hand.map((p) => p.shapeId)}`);
  }
  t.diagnostic(`${checked} boards checked, ${hardBoards} where 40 plain weighted candidates found no placeable hand`);
  assert.ok(checked > 450, `checked ${checked}`);
  assert.ok(hardBoards >= 15, `only ${hardBoards} hard boards exercised`);
});

test('fair deals early, possibly unplayable deals later (faithful to the original)', (t) => {
  const board = dotsOnlyBoard();
  const m = toRowMasks(board);
  for (const s of SHAPES) assert.equal(countPlacementsMask(m, s) > 0, s.id === 'dot', s.id);
  let unplayable = 0;
  for (let seed = 0; seed < 200; seed++) {
    const early = dealHand(board, makeRng(seed), { score: 0, handsDealt: seed % 10 });
    assert.ok(canPlaceAllInSomeOrder(m, shapesOf(early)), `seed ${seed}`);
    const late = dealHand(board, makeRng(seed), { score: 60000, handsDealt: 40 });
    assertValidHand(late);
    if (!late.some((p) => p.shapeId === 'dot')) unplayable++;
  }
  t.diagnostic(`late deals with no fitting piece: ${unplayable}/200`);
  assert.ok(unplayable > 20, `late deals can end the game (${unplayable}/200)`);
  assert.ok(unplayable < 180, `but usually find a fitting piece (${unplayable}/200)`);
});

test('a board with a single empty cell still gets a fair hand early', () => {
  const board = new Uint8Array(64).fill(4);
  board[27] = 0;
  const m = toRowMasks(board);
  for (let seed = 0; seed < 30; seed++) {
    const hand = dealHand(board, makeRng(seed), { score: 0, handsDealt: 0 });
    assert.ok(canPlaceAllInSomeOrder(m, shapesOf(hand)));
  }
});

test('combo help: 0.7 when streak ≥ 1 and misses ≥ 2, else 0.35', (t) => {
  const rng = makeRng(43);
  const w = effectiveWeights(3000);
  const total = w.reduce((a, b) => a + b, 0);
  const boards = [];
  while (boards.length < 300) {
    const b = randomBoard(rng, 0.3 + rng.next() * 0.4);
    const m = toRowMasks(b);
    const q = SHAPES.reduce((acc, s, i) => acc + (canCompleteLine(m, s) ? w[i] : 0), 0) / total;
    if (q > 0 && 1 - (1 - q) ** 3 < 0.3) boards.push(b); // completing a line is possible but rare
  }
  const ctx = (streak, misses) => ({ score: 3000, handsDealt: 20, streak, misses });
  let normal = 0;
  let combo = 0;
  boards.forEach((b, k) => {
    const m = toRowMasks(b);
    const helps = (hand) => hand.some((p) => canCompleteLine(m, SHAPE_BY_ID[p.shapeId]));
    const base = dealHand(b, makeRng(k), ctx(0, 0));
    // only "combo alive AND 2 misses used" changes the deal
    assert.deepEqual(dealHand(b, makeRng(k), ctx(1, 1)), base);
    assert.deepEqual(dealHand(b, makeRng(k), ctx(0, 2)), base);
    const boosted = dealHand(b, makeRng(k), ctx(1, 2));
    assert.deepEqual(dealHand(b, makeRng(k), ctx(6, 2)), boosted);
    if (helps(base)) normal++;
    if (helps(boosted)) combo++;
  });
  const n = boards.length;
  t.diagnostic(`hands with a line-completing piece: normal ${(normal / n).toFixed(3)}, combo help ${(combo / n).toFixed(3)}`);
  assert.ok(normal / n >= 0.35, `normal help rate ${normal / n}`);
  assert.ok(combo / n >= 0.7, `combo help rate ${combo / n}`);
  assert.ok(combo / n >= normal / n + 0.08, `combo ${combo / n} vs normal ${normal / n}`);
});

test('20k picks are proportional to the effective weights', (t) => {
  for (const score of [0, 20000, 100000]) {
    const w = effectiveWeights(score);
    const total = w.reduce((a, b) => a + b, 0);
    const index = new Map(SHAPES.map((s, i) => [s.id, i]));
    const counts = new Array(SHAPES.length).fill(0);
    const rng = makeRng(44 + score);
    let picks = 0;
    // On an empty board every hand is fair and no piece can complete a line, so the dealt hand is
    // always the first weighted candidate: three independent weighted picks.
    while (picks < 20000) {
      for (const p of dealHand(emptyBoard(), rng, { score, handsDealt: picks % 30 })) {
        counts[index.get(p.shapeId)]++;
        picks++;
      }
    }
    let chi2 = 0;
    SHAPES.forEach((s, i) => {
      const p = w[i] / total;
      const expected = picks * p;
      chi2 += (counts[i] - expected) ** 2 / expected;
      const z = Math.abs(counts[i] - expected) / Math.sqrt(expected * (1 - p));
      assert.ok(z < 4.5, `score ${score}: ${s.id} ${counts[i]} vs ${expected.toFixed(1)}`);
    });
    t.diagnostic(`score ${score}: ${picks} picks, chi² ${chi2.toFixed(1)} (40 dof)`);
    assert.ok(chi2 < 80, `score ${score}: chi² ${chi2.toFixed(1)} (40 dof)`);
  }
});
