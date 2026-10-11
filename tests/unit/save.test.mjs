import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Game } from '../../src/core/game.js';
import { SAVE_VERSION } from '../../src/core/constants.js';

const KEYS = ['v', 'seed', 'rngState', 'board', 'hand', 'score', 'streak', 'misses', 'clearsThisHand', 'handsDealt',
  'moves', 'over', 'questRngState', 'gems', 'handGems', 'quests'];

// Deterministic policy from the state alone: the move clearing the most lines, first in scan order.
function chooseMove(g) {
  let best = null;
  let bestLines = -1;
  for (let slot = 0; slot < 3; slot++) {
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const p = g.preview(slot, row, col);
        if (p && p.rows.length + p.cols.length > bestLines) {
          bestLines = p.rows.length + p.cols.length;
          best = [slot, row, col];
        }
      }
    }
  }
  return best;
}

function playMoves(g, n) {
  for (let i = 0; i < n && !g.over; i++) g.place(...chooseMove(g));
  return g;
}

// A mid-hand save (one or two pieces used) taken from a real game.
function midHandSave() {
  const g = new Game({ seed: 2025 });
  playMoves(g, 7);
  const save = g.toJSON();
  assert.ok(save.hand.some((p) => p === null) && save.hand.some((p) => p !== null), 'mid-hand');
  return save;
}

const roundTrip = (obj) => JSON.parse(JSON.stringify(obj));

test('toJSON: exact keys, JSON-safe plain data', () => {
  const g = playMoves(new Game({ seed: 31 }), 4);
  const s = g.toJSON();
  assert.deepEqual(Object.keys(s), KEYS);
  assert.equal(s.v, SAVE_VERSION);
  assert.equal(s.seed, 31);
  assert.ok(Array.isArray(s.board) && s.board.length === 64);
  assert.deepEqual(s.board, Array.from(g.board));
  assert.deepEqual(roundTrip(s), s);
  assert.deepEqual(JSON.parse(JSON.stringify(g)), s, 'JSON.stringify(game) uses toJSON');
  const snapshot = roundTrip(s);
  s.board.fill(7);
  s.hand[0] = { shapeId: 'o3', color: 1 };
  if (s.hand[1]) s.hand[1].color = 7;
  s.score = 0;
  assert.deepEqual(g.toJSON(), snapshot, 'mutating the snapshot does not touch the game');
});

test('fromJSON round-trips fresh, mid-hand and game-over states', () => {
  const fresh = new Game({ seed: 8 });
  const a = Game.fromJSON(roundTrip(fresh.toJSON()));
  assert.ok(a instanceof Game);
  assert.deepEqual(a.toJSON(), fresh.toJSON());

  const save = midHandSave();
  const b = Game.fromJSON(roundTrip(save));
  assert.ok(b instanceof Game);
  assert.deepEqual(b.toJSON(), save);
  assert.ok(b.board instanceof Uint8Array);
  assert.deepEqual(Game.fromJSON(save).toJSON(), save, 'works without stringify too');

  const ended = new Game({ seed: 3 });
  playMoves(ended, 500);
  assert.equal(ended.over, true);
  const c = Game.fromJSON(roundTrip(ended.toJSON()));
  assert.ok(c);
  assert.equal(c.over, true);
  assert.deepEqual(c.toJSON(), ended.toJSON());
  assert.equal(c.hasAnyMove(), false);
  assert.equal(c.place(0, 0, 0), null);
});

test('restored games continue identically, including future deals (RNG continuity)', () => {
  for (const [seed, pre] of [[2025, 7], [99, 2], [123, 16], [7, 1]]) {
    const original = playMoves(new Game({ seed }), pre);
    const restored = Game.fromJSON(roundTrip(original.toJSON()));
    assert.ok(restored);
    let deals = 0;
    for (let i = 0; i < 60 && !original.over; i++) {
      const move = chooseMove(original);
      assert.deepEqual(chooseMove(restored), move);
      const r1 = original.place(...move);
      const r2 = restored.place(...move);
      assert.deepEqual(r2, r1);
      if (r1.newHand) deals++;
    }
    assert.ok(deals >= 3 || original.over, `seed ${seed}: compared ${deals} deals`);
    assert.deepEqual(restored.toJSON(), original.toJSON());
  }
});

test('a restored game is independent of the object it came from', () => {
  const save = midHandSave();
  const g = Game.fromJSON(save);
  save.board.fill(5);
  save.hand[0] = null;
  save.score = 1;
  const again = midHandSave();
  assert.deepEqual(g.toJSON(), again);
});

test('fromJSON recomputes `over` from the board and hand', () => {
  const save = midHandSave();
  const board = new Array(64).fill(3);
  [0, 2, 4, 6, 1, 3, 5, 7].forEach((c, r) => { board[r * 8 + c] = 0; }); // only a 1×1 fits
  const stuck = Game.fromJSON({ ...save, board, gems: new Array(64).fill(0), handGems: [-1, -1, -1], hand: [{ shapeId: 'o3', color: 1 }, null, null], clearsThisHand: 0, over: false });
  assert.ok(stuck);
  assert.equal(stuck.over, true);
  const alive = Game.fromJSON({ ...save, over: true });
  assert.ok(alive);
  assert.equal(alive.over, false);
});

test('fromJSON accepts typed-array boards', () => {
  const save = midHandSave();
  const g = Game.fromJSON({ ...save, board: Uint8Array.from(save.board) });
  assert.ok(g);
  assert.deepEqual(g.toJSON(), save);
});

test('fromJSON rejects non-objects', () => {
  for (const bad of [null, undefined, 0, 42, NaN, '', 'save', true, [], [midHandSave()], () => {}, Symbol('s')]) {
    assert.equal(Game.fromJSON(bad), null, String(typeof bad));
  }
});

test('fromJSON rejects a wrong or missing version', () => {
  const save = midHandSave();
  for (const v of [0, 3, '1', 1.0001, null, undefined, true]) assert.equal(Game.fromJSON({ ...save, v }), null, String(v));
  const { v, ...noVersion } = save;
  assert.equal(v, SAVE_VERSION);
  assert.equal(Game.fromJSON(noVersion), null);
});

test('fromJSON rejects bad seeds and RNG states', () => {
  const save = midHandSave();
  for (const key of ['seed', 'rngState']) {
    for (const bad of [-1, 1.5, 2 ** 32, NaN, Infinity, '5', null, undefined, {}]) {
      assert.equal(Game.fromJSON({ ...save, [key]: bad }), null, `${key} = ${String(bad)}`);
    }
    assert.ok(Game.fromJSON({ ...save, [key]: 0 }));
    assert.ok(Game.fromJSON({ ...save, [key]: 0xffffffff }));
  }
});

test('fromJSON rejects bad boards (lengths, types, values)', () => {
  const save = midHandSave();
  const badBoards = [
    new Array(63).fill(0), new Array(65).fill(0), [], null, undefined, 'x'.repeat(64), { length: 64 }, 64,
  ];
  for (const board of badBoards) assert.equal(Game.fromJSON({ ...save, board }), null);
  for (const v of [-1, 8, 1.5, NaN, Infinity, '1', null, undefined, true, [1]]) {
    const board = [...save.board];
    board[37] = v;
    assert.equal(Game.fromJSON({ ...save, board }), null, `cell = ${String(v)}`);
  }
  const holes = [...save.board];
  delete holes[5];
  assert.equal(Game.fromJSON({ ...save, board: holes }), null, 'sparse array');
  assert.ok(Game.fromJSON({ ...save, board: new Array(64).fill(7) }), 'all values 0..7 are fine');
});

test('fromJSON rejects bad hands (lengths, ids, colors, entries)', () => {
  const save = midHandSave();
  const piece = save.hand.find((p) => p !== null);
  const withSlot = (entry) => {
    const hand = save.hand.map((p) => (p ? { ...p } : null));
    const i = hand.findIndex((p) => p !== null);
    hand[i] = entry;
    return { ...save, hand, handGems: [-1, -1, -1] };
  };
  for (const hand of [[], [piece], [piece, null], [piece, null, null, null], null, 'hand', { 0: piece, length: 3 }]) {
    assert.equal(Game.fromJSON({ ...save, hand }), null, JSON.stringify(hand));
  }
  for (const shapeId of ['foo', '', 'O3', 'constructor', '__proto__', 'toString', 'hasOwnProperty', 5, null, undefined]) {
    assert.equal(Game.fromJSON(withSlot({ shapeId, color: 3 })), null, `shapeId ${String(shapeId)}`);
  }
  for (const color of [0, 8, -1, 1.5, NaN, '3', null, undefined, true]) {
    assert.equal(Game.fromJSON(withSlot({ shapeId: 'dot', color })), null, `color ${String(color)}`);
  }
  for (const entry of [5, 'dot', [], ['dot', 3], undefined, true, {}]) {
    assert.equal(Game.fromJSON(withSlot(entry)), null, `entry ${JSON.stringify(entry)}`);
  }
  assert.equal(Game.fromJSON({ ...save, hand: [null, null, null] }), null, 'an empty tray is never saved');
  for (let color = 1; color <= 7; color++) assert.ok(Game.fromJSON(withSlot({ shapeId: 'dot', color })));
});

test('fromJSON rejects negative, fractional, NaN and non-number counters', () => {
  const save = midHandSave();
  for (const key of ['score', 'streak', 'misses', 'clearsThisHand', 'handsDealt', 'moves']) {
    for (const bad of [-1, 1.5, NaN, Infinity, -Infinity, '3', null, undefined, true, [], {}, 2 ** 53]) {
      assert.equal(Game.fromJSON({ ...save, [key]: bad }), null, `${key} = ${String(bad)}`);
    }
  }
  assert.equal(Game.fromJSON({ ...save, misses: 3 }), null, 'misses never reach the limit in a saved state');
  assert.equal(Game.fromJSON({ ...save, handsDealt: 0 }), null, 'the first hand is always dealt');
  const used = save.hand.filter((p) => p === null).length;
  assert.equal(Game.fromJSON({ ...save, clearsThisHand: used + 1 }), null, 'more clears than placements this tray');
  assert.ok(Game.fromJSON({ ...save, clearsThisHand: used, score: 123456, streak: 40, misses: 2, moves: 999 }));
});

test('fromJSON rejects a non-boolean `over`', () => {
  const save = midHandSave();
  for (const over of ['false', 0, 1, null, undefined, {}]) assert.equal(Game.fromJSON({ ...save, over }), null, String(over));
});

test('fromJSON never throws (throwing getters, proxies, frozen input)', () => {
  const save = midHandSave();
  const evil = { ...save };
  Object.defineProperty(evil, 'score', { enumerable: true, get() { throw new Error('boom'); } });
  assert.equal(Game.fromJSON(evil), null);
  const trap = new Proxy(save, { get() { throw new Error('trap'); } });
  assert.equal(Game.fromJSON(trap), null);
  const evilHand = { ...save, hand: new Proxy(save.hand, { get() { throw new Error('hand'); } }) };
  assert.equal(Game.fromJSON(evilHand), null);
  const frozen = Object.freeze({ ...save, board: Object.freeze([...save.board]), hand: Object.freeze(save.hand.map((p) => p && Object.freeze({ ...p }))) });
  assert.ok(Game.fromJSON(frozen));
});
