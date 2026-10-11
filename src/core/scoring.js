/** @typedef {import('./shapes.js').Shape} Shape */

const PRAISE = { 2: 'Good!', 3: 'Great!', 4: 'Excellent!', 5: 'Amazing!' };

/**
 * Placement points: +1 per cell of the placed piece.
 * @param {Shape} shape
 * @returns {number}
 */
export function placementPoints(shape) {
  return shape.n;
}

/**
 * Base points for clearing `lines` rows+columns with one placement:
 * 0 → 0, 1 → 10, n ≥ 2 → 10·n·(n−1) (2 → 20, 3 → 60, 4 → 120, 5 → 200, 6 → 300).
 * @param {number} lines
 * @returns {number}
 */
export function lineBase(lines) {
  const n = Math.floor(lines);
  if (!(n >= 1)) return 0;
  if (n === 1) return 10;
  return 10 * n * (n - 1);
}

/**
 * Clear points: lineBase(lines) × (streakBefore + 1), where streakBefore is the number of
 * consecutive clearing placements before this one (the "Combo N" number).
 * @param {number} lines
 * @param {number} streakBefore
 * @returns {number}
 */
export function clearPoints(lines, streakBefore) {
  const s = Math.max(0, Math.floor(streakBefore) || 0);
  return lineBase(lines) * (s + 1);
}

/**
 * Praise word for a placement: all-clear → 'Unbelievable!'; 2 'Good!'; 3 'Great!'; 4 'Excellent!';
 * 5 'Amazing!'; ≥ 6 'Legendary!'; otherwise null.
 * @param {number} lines
 * @param {boolean} allClear
 * @returns {string | null}
 */
export function praiseFor(lines, allClear) {
  if (allClear) return 'Unbelievable!';
  if (lines >= 6) return 'Legendary!';
  return PRAISE[lines] || null;
}
