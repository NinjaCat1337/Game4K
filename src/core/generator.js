import { COLOR_COUNT, HAND_SIZE } from './constants.js';
import { SHAPES, SHAPE_BY_ID } from './shapes.js';
import { toRowMasks } from './board.js';
import { canPlaceAllInSomeOrder, canCompleteLine, countPlacementsMask } from './solver.js';

/** @typedef {import('./shapes.js').Shape} Shape */
/** @typedef {import('./rng.js').Rng} Rng */
/** @typedef {{ shapeId: string, color: number }} HandPiece */

const MAX_CANDIDATES = 40;
const MAX_EXTRA_TRIES = 60;
const MAX_RESCUE_TRIES = 60;
const EASY_BOOST = new Set(['i2', 'i3', 'i4', 'o2', 'corner3', 't4']);
const EASY_CUT = new Set(['o3', 'corner5', 'i5']);
const HARD_BOOST = new Set(['o3', 'corner5', 'i5', 'rect']);

function finiteOr(v, fallback) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/**
 * Shape weights for the current score (difficulty curve), aligned with SHAPES:
 * score < 1500 → ×2 for i2, i3, i4, o2, corner3, t4 and ×0.5 for o3, corner5, i5;
 * 1500 ≤ score ≤ 50000 → base; score > 50000 → ×1.3 for o3, corner5, i5, rect.
 * @param {number} score
 * @returns {number[]}
 */
export function effectiveWeights(score) {
  const s = finiteOr(score, 0);
  return SHAPES.map((shape) => {
    let k = 1;
    if (s < 1500) {
      if (EASY_BOOST.has(shape.group)) k = 2;
      else if (EASY_CUT.has(shape.group)) k = 0.5;
    } else if (s > 50000 && HARD_BOOST.has(shape.group)) {
      k = 1.3;
    }
    return shape.weight * k;
  });
}

/**
 * Probability that a hand must be placeable in some order: 1 while handsDealt < 10,
 * then 0.9 − 0.3·clamp((score − 5000) / 45000, 0, 1).
 * @param {number} score
 * @param {number} handsDealt hands dealt before this one
 * @returns {number}
 */
export function fairnessProbability(score, handsDealt) {
  if (finiteOr(handsDealt, 0) < 10) return 1;
  const t = Math.min(1, Math.max(0, (finiteOr(score, 0) - 5000) / 45000));
  return 0.9 - 0.3 * t;
}

function pickHand(rng, weights) {
  const hand = [];
  for (let i = 0; i < HAND_SIZE; i++) hand.push(SHAPES[rng.weighted(weights)]);
  return hand;
}

// Memoized per-deal checks against one board (pure, so caching never changes RNG use).
function makeEvaluator(masks) {
  const fitsCache = new Map();
  const helpCache = new Map();
  const fairCache = new Map();
  const fits = (s) => {
    if (!fitsCache.has(s.id)) fitsCache.set(s.id, countPlacementsMask(masks, s) > 0);
    return fitsCache.get(s.id);
  };
  const helps = (s) => {
    if (!helpCache.has(s.id)) helpCache.set(s.id, canCompleteLine(masks, s));
    return helpCache.get(s.id);
  };
  return {
    fits,
    anyFits: (hand) => hand.some(fits),
    help: (hand) => hand.some(helps),
    fair(hand) {
      const key = hand.map((s) => s.id).sort().join(',');
      if (!fairCache.has(key)) fairCache.set(key, canPlaceAllInSomeOrder(masks, hand));
      return fairCache.get(key);
    },
  };
}

// While fairness is guaranteed (p = 1) a placeable hand must be dealt whenever one exists:
// sample among the shapes that fit right now, then fall back to single cells (always placeable
// in some order when any cell is empty, because filling a board's last empty cell clears a line).
function rescueFairHand(rng, weights, ev) {
  const fitWeights = SHAPES.map((s, i) => (weights[i] > 0 && ev.fits(s) ? weights[i] : 0));
  if (!fitWeights.some((w) => w > 0)) return null;
  for (let k = 0; k < MAX_RESCUE_TRIES; k++) {
    const hand = pickHand(rng, fitWeights);
    if (ev.fair(hand)) return hand;
  }
  const dots = new Array(HAND_SIZE).fill(SHAPE_BY_ID.dot);
  return ev.fair(dots) ? dots : null;
}

function assignColors(hand, rng) {
  const colors = hand.map(() => 1 + rng.int(COLOR_COUNT));
  if (colors.length > 1) {
    while (colors.every((c) => c === colors[0])) colors[colors.length - 1] = 1 + rng.int(COLOR_COUNT);
  }
  return hand.map((s, i) => ({ shapeId: s.id, color: colors[i] }));
}

/**
 * Deals a new tray of 3 pieces (spec §3 generator rules; all randomness from `rng`).
 * Fairness: with probability fairnessProbability() the hand must be placeable in some order;
 * combo help: with probability 0.35 (0.7 while a combo is alive with 2 misses used) some piece must
 * complete a line. Up to 40 weighted candidates; otherwise the best by (fair, help, anyFits), then up
 * to 60 more tries for a hand with at least one fitting piece, else a random (unplayable) hand.
 * While p = 1 (first 10 hands) a placeable hand is guaranteed whenever one exists.
 * @param {ArrayLike<number>} board Uint8Array(64)
 * @param {Rng} rng
 * @param {{ score?: number, handsDealt?: number, streak?: number, misses?: number }} [ctx]
 * @returns {HandPiece[]}
 */
export function dealHand(board, rng, ctx) {
  const c = ctx || {};
  const score = finiteOr(c.score, 0);
  const handsDealt = finiteOr(c.handsDealt, 0);
  const streak = finiteOr(c.streak, 0);
  const misses = finiteOr(c.misses, 0);
  const masks = toRowMasks(board);
  const weights = effectiveWeights(score);
  const p = fairnessProbability(score, handsDealt);
  const needFair = rng.next() < p;
  const needHelp = rng.next() < (streak >= 1 && misses >= 2 ? 0.7 : 0.35);
  const ev = makeEvaluator(masks);

  let chosen = null;
  let best = null;
  let bestRank = -1;
  for (let k = 0; k < MAX_CANDIDATES; k++) {
    const hand = pickHand(rng, weights);
    if ((!needFair || ev.fair(hand)) && (!needHelp || ev.help(hand))) {
      chosen = hand;
      break;
    }
    const rank = (ev.fair(hand) ? 4 : 0) + (ev.help(hand) ? 2 : 0) + (ev.anyFits(hand) ? 1 : 0);
    if (rank > bestRank) {
      best = hand;
      bestRank = rank;
    }
  }

  if (!chosen && needFair && p >= 1 && !ev.fair(best)) chosen = rescueFairHand(rng, weights, ev);

  if (!chosen) {
    chosen = best;
    if (!ev.anyFits(best)) {
      for (let k = 0; k < MAX_EXTRA_TRIES; k++) {
        const hand = pickHand(rng, weights);
        if (ev.anyFits(hand)) {
          chosen = hand;
          break;
        }
      }
    }
  }

  return assignColors(chosen, rng);
}
