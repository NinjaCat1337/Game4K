/**
 * @typedef {object} Shape
 * @property {string} id
 * @property {string} group
 * @property {ReadonlyArray<[number, number]>} cells [r, c] pairs, normalized (min r = 0, min c = 0) and sorted
 * @property {number} w bounding-box width (columns)
 * @property {number} h bounding-box height (rows)
 * @property {number} n cell count
 * @property {ReadonlyArray<number>} masks masks[i] = bitmask of row i (bit c = column c)
 * @property {number} weight base generator weight
 */

// The 41-shape catalog (confirmed from 553 real tray pieces): [id, cells, group, weight], in catalog order.
const CATALOG = [
  ['dot', [[0, 0]], 'dot', 0.3],
  ['i2h', [[0, 0], [0, 1]], 'i2', 0.6],
  ['i2v', [[0, 0], [1, 0]], 'i2', 0.6],
  ['i3h', [[0, 0], [0, 1], [0, 2]], 'i3', 1.0],
  ['i3v', [[0, 0], [1, 0], [2, 0]], 'i3', 1.0],
  ['i4h', [[0, 0], [0, 1], [0, 2], [0, 3]], 'i4', 4.5],
  ['i4v', [[0, 0], [1, 0], [2, 0], [3, 0]], 'i4', 4.5],
  ['i5h', [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]], 'i5', 4.5],
  ['i5v', [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]], 'i5', 4.5],
  ['o2', [[0, 0], [0, 1], [1, 0], [1, 1]], 'o2', 5.5],
  ['o3', [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [2, 0], [2, 1], [2, 2]], 'o3', 10],
  ['r23', [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2]], 'rect', 5],
  ['r32', [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [2, 1]], 'rect', 5.5],
  ['c3a', [[0, 0], [0, 1], [1, 0]], 'corner3', 0.6],
  ['c3b', [[0, 0], [0, 1], [1, 1]], 'corner3', 0.6],
  ['c3c', [[0, 0], [1, 0], [1, 1]], 'corner3', 0.6],
  ['c3d', [[0, 1], [1, 0], [1, 1]], 'corner3', 0.6],
  ['c5a', [[0, 0], [0, 1], [0, 2], [1, 0], [2, 0]], 'corner5', 2],
  ['c5b', [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]], 'corner5', 2],
  ['c5c', [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]], 'corner5', 2],
  ['c5d', [[0, 2], [1, 2], [2, 0], [2, 1], [2, 2]], 'corner5', 2],
  ['l4a', [[0, 0], [0, 1], [0, 2], [1, 0]], 'l4', 2],
  ['l4b', [[0, 0], [0, 1], [0, 2], [1, 2]], 'l4', 2],
  ['l4c', [[0, 0], [1, 0], [1, 1], [1, 2]], 'l4', 2],
  ['l4d', [[0, 2], [1, 0], [1, 1], [1, 2]], 'l4', 2],
  ['l4e', [[0, 0], [1, 0], [2, 0], [2, 1]], 'l4', 2],
  ['l4f', [[0, 1], [1, 1], [2, 0], [2, 1]], 'l4', 2],
  ['l4g', [[0, 0], [0, 1], [1, 0], [2, 0]], 'l4', 2],
  ['l4h', [[0, 0], [0, 1], [1, 1], [2, 1]], 'l4', 2],
  ['t4u', [[0, 1], [1, 0], [1, 1], [1, 2]], 't4', 3],
  ['t4d', [[0, 0], [0, 1], [0, 2], [1, 1]], 't4', 3],
  ['t4l', [[0, 1], [1, 0], [1, 1], [2, 1]], 't4', 3],
  ['t4r', [[0, 0], [1, 0], [1, 1], [2, 0]], 't4', 3],
  ['s4h', [[0, 1], [0, 2], [1, 0], [1, 1]], 'sz', 2],
  ['z4h', [[0, 0], [0, 1], [1, 1], [1, 2]], 'sz', 2],
  ['s4v', [[0, 0], [1, 0], [1, 1], [2, 1]], 'sz', 2],
  ['z4v', [[0, 1], [1, 0], [1, 1], [2, 0]], 'sz', 2],
  ['d2a', [[0, 0], [1, 1]], 'diag2', 0.4],
  ['d2b', [[0, 1], [1, 0]], 'diag2', 0.4],
  ['d3a', [[0, 0], [1, 1], [2, 2]], 'diag3', 0.5],
  ['d3b', [[0, 2], [1, 1], [2, 0]], 'diag3', 0.5],
];

function buildShape([id, rawCells, group, weight]) {
  const minR = Math.min(...rawCells.map((p) => p[0]));
  const minC = Math.min(...rawCells.map((p) => p[1]));
  const cells = rawCells
    .map(([r, c]) => [r - minR, c - minC])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const h = Math.max(...cells.map((p) => p[0])) + 1;
  const w = Math.max(...cells.map((p) => p[1])) + 1;
  const masks = new Array(h).fill(0);
  for (const [r, c] of cells) masks[r] |= 1 << c;
  return Object.freeze({
    id,
    group,
    cells: Object.freeze(cells.map((p) => Object.freeze(p))),
    w,
    h,
    n: cells.length,
    masks: Object.freeze(masks),
    weight,
  });
}

/** All 41 shapes in catalog order (deeply frozen). @type {ReadonlyArray<Shape>} */
export const SHAPES = Object.freeze(CATALOG.map(buildShape));

/** Frozen id → Shape map (null prototype, so ids like 'constructor' are unknown). */
export const SHAPE_BY_ID = Object.freeze(
  SHAPES.reduce((map, s) => {
    map[s.id] = s;
    return map;
  }, Object.create(null)),
);

/** Frozen list of group names in catalog order. @type {ReadonlyArray<string>} */
export const GROUPS = Object.freeze([...new Set(SHAPES.map((s) => s.group))]);

/**
 * Looks up a shape by id.
 * @param {string} id
 * @returns {Shape}
 * @throws {Error} on an unknown id
 */
export function getShape(id) {
  const shape = typeof id === 'string' ? SHAPE_BY_ID[id] : undefined;
  if (!shape) throw new Error('Unknown shape id: ' + String(id));
  return shape;
}
