import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import * as constants from '../../src/core/constants.js';

const CORE_DIR = new URL('../../src/core/', import.meta.url);

// Spec §3: the exact public API of every core module.
const API = {
  'constants.js': ['SIZE', 'CELLS', 'HAND_SIZE', 'COLOR_COUNT', 'COMBO_MISS_LIMIT', 'ALL_CLEAR_BONUS', 'SAVE_VERSION'],
  'rng.js': ['makeRng', 'randomSeed'],
  'shapes.js': ['SHAPES', 'SHAPE_BY_ID', 'GROUPS', 'getShape'],
  'board.js': [
    'emptyBoard', 'cloneBoard', 'canPlace', 'placeShape', 'findFullLines', 'linesCompletedBy', 'clearLines',
    'validPositions', 'hasAnyPlacement', 'filledCount', 'isEmpty', 'toRowMasks',
  ],
  'solver.js': ['canPlaceMask', 'placeAndClearMask', 'canPlaceAllInSomeOrder', 'canCompleteLine', 'countPlacementsMask'],
  'scoring.js': ['placementPoints', 'lineBase', 'clearPoints', 'praiseFor'],
  'generator.js': ['effectiveWeights', 'fairnessProbability', 'dealHand'],
  'game.js': ['Game'],
  'quests.js': ['QUEST_TYPES', 'createQuests', 'advanceQuests', 'restoreQuests', 'decorateHand'],
};

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

test('src/core holds exactly the specified lowercase modules', () => {
  const files = readdirSync(CORE_DIR).sort();
  assert.deepEqual(files, Object.keys(API).sort());
  for (const f of files) assert.match(f, /^[a-z0-9]+\.js$/);
});

for (const [file, names] of Object.entries(API)) {
  test(`${file} imports under Node without a DOM and exports exactly its §3 API`, async () => {
    assert.equal(typeof globalThis.window, 'undefined');
    assert.equal(typeof globalThis.document, 'undefined');
    const mod = await import(new URL(file, CORE_DIR).href);
    assert.deepEqual(Object.keys(mod).sort(), [...names].sort());
    for (const name of names) assert.notEqual(mod[name], undefined, `${file} → ${name}`);
  });
}

test('core sources are pure: no DOM, storage, timers or Node APIs; randomness only in rng.js', () => {
  const banned = [
    'window', 'document', 'localStorage', 'sessionStorage', 'indexedDB', 'navigator', 'location', 'history',
    'setTimeout', 'setInterval', 'requestAnimationFrame', 'queueMicrotask', 'performance', 'fetch',
    'alert', 'confirm', 'prompt', 'process', 'require', 'Buffer',
  ];
  for (const file of Object.keys(API)) {
    const code = stripComments(readFileSync(new URL(file, CORE_DIR), 'utf8'));
    for (const word of banned) {
      assert.ok(!new RegExp(`\\b${word}\\b`).test(code), `${file} must not use ${word}`);
    }
    if (file !== 'rng.js') {
      assert.ok(!/Math\.random|crypto/.test(code), `${file} must take randomness from the seeded RNG`);
    }
    assert.ok(!/\bawait\b/.test(code), `${file} must not use await`);
    assert.ok(!/\bimport\s*\(/.test(code), `${file} must not use dynamic import()`);
    for (const m of code.matchAll(/\b(?:from|import)\s+['"]([^'"]+)['"]/g)) {
      assert.match(m[1], /^\.\/[a-z0-9]+\.js$/, `${file}: import '${m[1]}' must be relative with .js`);
    }
  }
});

test('constants match the spec', () => {
  assert.equal(constants.SIZE, 8);
  assert.equal(constants.CELLS, 64);
  assert.equal(constants.HAND_SIZE, 3);
  assert.equal(constants.COLOR_COUNT, 7);
  assert.equal(constants.COMBO_MISS_LIMIT, 3);
  assert.equal(constants.ALL_CLEAR_BONUS, 0);
  assert.equal(constants.SAVE_VERSION, 2);
});
