import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../../src/core/game.js';
import { makeRng } from '../../src/core/rng.js';
import { createQuests, advanceQuests, QUEST_TYPES } from '../../src/core/quests.js';

test('quests vary with the seed, stay distinct, and always start at zero', () => {
  const seen = new Set();
  for (let seed = 0; seed < 60; seed++) {
    const a = createQuests(makeRng(seed));
    assert.deepEqual(a, createQuests(makeRng(seed)));
    assert.equal(a.completed, 0);
    assert.notEqual(a.active[0].type, a.active[1].type);
    for (const q of a.active) {
      seen.add(q.type);
      assert.equal(q.progress, 0);
      assert.ok(q.target > 0);
    }
  }
  assert.deepEqual([...seen].sort(), [...QUEST_TYPES].sort());
});

test('a large move completes both quests once; new quests start with the next move', () => {
  const initial = { completed: 0, active: [
    { type: 'score', progress: 9, target: 10 }, { type: 'blocks', progress: 2, target: 3 },
  ] };
  const copy = JSON.stringify(initial);
  const { state, finished } = advanceQuests(initial, { score: 400, blocks: 9, lines: 3, gems: 4 }, makeRng(9));
  assert.equal(JSON.stringify(initial), copy);
  assert.equal(finished.length, 2);
  assert.equal(state.completed, 2);
  assert.ok(state.active.every((q) => q.progress === 0));
  assert.notEqual(state.active[0].type, state.active[1].type);
  assert.notEqual(state.active[0].type, 'score');
  assert.notEqual(state.active[1].type, 'blocks');
});

test('placing a jewel preserves it on the board; a later line clear collects it', () => {
  const game = new Game({ seed: 1 });
  game.setHand(['dot', 'i5h', 'i2h'], [1, 2, 3]);
  game.handGems = [0, -1, -1];
  game.quests = { completed: 0, active: [
    { type: 'gems', progress: 0, target: 2 }, { type: 'score', progress: 0, target: 60 },
  ] };
  const first = game.place(0, 0, 0);
  assert.equal(first.gemsCollected, 0);
  assert.equal(game.gems[0], 1);
  assert.equal(game.quests.active[0].progress, 0);
  game.place(1, 0, 1);
  const last = game.place(2, 0, 6);
  assert.equal(last.lines, 1);
  assert.equal(last.gemsCollected, 1);
  assert.ok(game.gems.every((v) => v === 0));
  assert.equal(game.quests.active[0].progress, 1);
});

test('a jewel placed on a row/column crossing is collected once and completes the quest', () => {
  const game = new Game({ seed: 3 });
  const board = new Array(64).fill(0);
  for (let i = 0; i < 7; i++) { board[7 * 8 + i] = 1; board[i * 8 + 7] = 2; }
  game.setBoard(board);
  game.setHand(['dot', 'dot', 'dot'], [1, 2, 3]);
  game.handGems = [0, -1, -1];
  game.gems[56] = 1;
  game.quests = { completed: 3, active: [
    { type: 'gems', progress: 0, target: 2 }, { type: 'lines', progress: 0, target: 4 },
  ] };
  const result = game.place(0, 7, 7);
  assert.equal(result.gemsCollected, 2);
  assert.equal(result.cleared.length, 15);
  assert.equal(result.questsCompleted.length, 1);
  assert.deepEqual(result.questsCompleted[0], { type: 'gems', progress: 2, target: 2 });
  assert.equal(game.quests.completed, 4);
  assert.equal(game.quests.active[0].progress, 0);
  assert.equal(game.quests.active[1].progress, 2);
  assert.equal(game.score, 21);
});

test('invalid moves never advance quests or consume a jewel', () => {
  const game = new Game({ seed: 44 });
  const before = game.toJSON();
  assert.equal(game.place(0, -1, 0), null);
  assert.equal(game.place(5, 0, 0), null);
  assert.deepEqual(game.toJSON(), before);
});

test('every fresh tray has a jewel and restarting resets run progress', () => {
  for (let seed = 0; seed < 50; seed++) {
    const game = new Game({ seed });
    assert.ok(game.handGems.some((i) => i >= 0));
    game.quests.completed = 5;
    game.quests.active[0].progress = 1;
    game.restart({ seed });
    assert.deepEqual(game.toJSON(), new Game({ seed }).toJSON());
  }
});

test('v1 saves migrate without resetting the board, score, or classic piece RNG', () => {
  const original = new Game({ seed: 2025 });
  original.place(0, 0, 0);
  const { gems, handGems, quests, questRngState, ...legacy } = original.toJSON();
  legacy.v = 1;
  const restored = Game.fromJSON(legacy);
  assert.ok(restored);
  assert.equal(restored.score, original.score);
  assert.deepEqual(restored.board, original.board);
  assert.deepEqual(restored.hand, original.hand);
  assert.equal(restored.toJSON().rngState, legacy.rngState);
  assert.equal(restored.toJSON().v, 2);
  assert.equal(restored.quests.completed, 0);
  assert.ok(restored.handGems.some((i) => i >= 0));
  assert.deepEqual(Game.fromJSON(restored.toJSON()).toJSON(), restored.toJSON());
});

test('v2 rejects corrupt jewel and quest metadata', () => {
  const game = new Game({ seed: 33 });
  const save = game.toJSON();
  for (const change of [
    { questRngState: -1 }, { questRngState: undefined }, { gems: [] },
    { gems: [1, ...new Array(63).fill(0)] }, { handGems: [999, -1, -1] }, { handGems: [null, -1, -1] },
    { quests: null }, { quests: { completed: -1, active: save.quests.active } },
    { quests: { completed: 0, active: [save.quests.active[0], save.quests.active[0]] } },
    { quests: { completed: 0, active: [{ type: 'gems', target: 2, progress: 2 }, { type: 'score', target: 60, progress: 0 }] } },
  ]) assert.equal(Game.fromJSON({ ...save, ...change }), null, JSON.stringify(change));
});

test('quest and jewel snapshots are independent of the live and restored game', () => {
  const game = new Game({ seed: 19 });
  const save = game.toJSON();
  const restored = Game.fromJSON(save);
  const before = game.toJSON();
  save.handGems.fill(-1);
  save.gems.fill(1);
  save.quests.active[0].progress = 12;
  save.quests.completed = 5;
  assert.deepEqual(game.toJSON(), before);
  assert.deepEqual(restored.toJSON(), before);
});
