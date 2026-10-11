import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeRng, randomSeed } from '../../src/core/rng.js';

// Canonical mulberry32 as published (float accumulator), used as an independent reference.
function referenceMulberry32(a) {
  return function next() {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const take = (rng, n) => Array.from({ length: n }, () => rng.next());

test('makeRng is mulberry32 (matches the canonical implementation)', () => {
  for (const seed of [0, 1, 42, 123456789, 0x7fffffff, 0xffffffff]) {
    const ref = referenceMulberry32(seed);
    const rng = makeRng(seed);
    for (let i = 0; i < 2000; i++) assert.equal(rng.next(), ref(), `seed ${seed}, draw ${i}`);
  }
});

test('next() is in [0, 1) and looks uniform', () => {
  const rng = makeRng(7);
  const buckets = new Array(10).fill(0);
  const N = 50000;
  let sum = 0;
  for (let i = 0; i < N; i++) {
    const x = rng.next();
    assert.ok(x >= 0 && x < 1);
    buckets[Math.floor(x * 10)]++;
    sum += x;
  }
  assert.ok(Math.abs(sum / N - 0.5) < 0.01);
  for (const b of buckets) assert.ok(Math.abs(b - N / 10) < 400, `bucket ${b}`);
});

test('same seed → same sequence; different seeds → different sequences', () => {
  assert.deepEqual(take(makeRng(99), 500), take(makeRng(99), 500));
  assert.notDeepEqual(take(makeRng(99), 20), take(makeRng(100), 20));
  const firsts = new Set();
  for (let s = 0; s < 1000; s++) firsts.add(makeRng(s).next());
  assert.equal(firsts.size, 1000);
});

test('seeds are coerced to uint32', () => {
  assert.deepEqual(take(makeRng(-1), 10), take(makeRng(0xffffffff), 10));
  assert.deepEqual(take(makeRng(2 ** 32 + 5), 10), take(makeRng(5), 10));
  assert.deepEqual(take(makeRng(7.9), 10), take(makeRng(7), 10));
  assert.deepEqual(take(makeRng(undefined), 10), take(makeRng(0), 10));
  assert.deepEqual(take(makeRng('12'), 10), take(makeRng(12), 10));
});

test('state round-trip continues the exact sequence', () => {
  const rng = makeRng(2024);
  take(rng, 37);
  const saved = rng.state;
  assert.ok(Number.isInteger(saved) && saved >= 0 && saved <= 0xffffffff);
  const expected = take(rng, 200);
  rng.state = saved;
  assert.equal(rng.state, saved);
  assert.deepEqual(take(rng, 200), expected);
  // a different generator restored to the same state continues identically, also via JSON
  const other = makeRng(1);
  other.state = JSON.parse(JSON.stringify({ s: saved })).s;
  assert.deepEqual(take(other, 200), expected);
});

test('state stays a uint32 and the setter coerces', () => {
  const rng = makeRng(3);
  for (let i = 0; i < 5000; i++) {
    rng.next();
    const s = rng.state;
    assert.ok(Number.isInteger(s) && s >= 0 && s <= 0xffffffff);
  }
  rng.state = -1;
  assert.equal(rng.state, 0xffffffff);
  rng.state = 2 ** 32 + 9;
  assert.equal(rng.state, 9);
  rng.state = 'nope';
  assert.equal(rng.state, 0);
});

test('int/pick/weighted each consume exactly one draw', () => {
  const a = makeRng(55);
  const b = makeRng(55);
  for (let i = 0; i < 300; i++) {
    assert.equal(a.int(7), Math.floor(b.next() * 7));
    assert.equal(a.pick(['x', 'y', 'z']), ['x', 'y', 'z'][Math.floor(b.next() * 3)]);
    a.weighted([1, 2, 3]);
    b.next();
  }
  assert.equal(a.state, b.state);
});

test('int(n) covers 0..n-1 uniformly', () => {
  const rng = makeRng(11);
  const counts = new Array(7).fill(0);
  for (let i = 0; i < 70000; i++) {
    const v = rng.int(7);
    assert.ok(Number.isInteger(v) && v >= 0 && v < 7);
    counts[v]++;
  }
  for (const c of counts) assert.ok(Math.abs(c - 10000) < 450, `count ${c}`);
  assert.equal(makeRng(1).int(1), 0);
});

test('pick returns every element and only elements', () => {
  const rng = makeRng(5);
  const arr = ['a', 'b', 'c', 'd'];
  const seen = new Set();
  for (let i = 0; i < 1000; i++) {
    const v = rng.pick(arr);
    assert.ok(arr.includes(v));
    seen.add(v);
  }
  assert.equal(seen.size, arr.length);
});

test('weighted picks proportionally and never picks non-positive weights', () => {
  const rng = makeRng(77);
  const weights = [0, 1, 0, 3, -2, 6, NaN];
  const counts = new Array(weights.length).fill(0);
  const N = 20000;
  for (let i = 0; i < N; i++) counts[rng.weighted(weights)]++;
  assert.equal(counts[0], 0);
  assert.equal(counts[2], 0);
  assert.equal(counts[4], 0);
  assert.equal(counts[6], 0);
  const total = 10;
  for (const [i, w] of [[1, 1], [3, 3], [5, 6]]) {
    const p = w / total;
    const sd = Math.sqrt(N * p * (1 - p));
    assert.ok(Math.abs(counts[i] - N * p) < 5 * sd, `index ${i}: ${counts[i]} vs ${N * p}`);
  }
});

test('weighted edge cases', () => {
  const rng = makeRng(1);
  const before = rng.state;
  assert.equal(rng.weighted([]), -1);
  assert.equal(rng.state, before, 'an empty list consumes no draw');
  for (let i = 0; i < 200; i++) {
    const v = rng.weighted([0, 0, 0]);
    assert.ok(v >= 0 && v < 3, 'all-zero weights fall back to a uniform index');
  }
  for (let i = 0; i < 200; i++) assert.equal(rng.weighted([0, 0, 5]), 2);
  for (let i = 0; i < 200; i++) assert.equal(rng.weighted([1e-9]), 0);
});

test('randomSeed returns varying uint32 integers', () => {
  const seen = new Set();
  for (let i = 0; i < 20; i++) {
    const s = randomSeed();
    assert.ok(Number.isInteger(s) && s >= 0 && s <= 0xffffffff, String(s));
    seen.add(s);
  }
  assert.ok(seen.size > 1);
});

test('randomSeed falls back to Math.random without crypto', () => {
  const desc = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  try {
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true, writable: true });
    const s = randomSeed();
    assert.ok(Number.isInteger(s) && s >= 0 && s <= 0xffffffff);
  } finally {
    if (desc) Object.defineProperty(globalThis, 'crypto', desc);
    else delete globalThis.crypto;
  }
});
