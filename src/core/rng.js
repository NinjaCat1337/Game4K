/**
 * @typedef {object} Rng
 * @property {() => number} next uniform float in [0, 1)
 * @property {(n: number) => number} int uniform integer in [0, n) for n ≥ 1
 * @property {<T>(arr: T[]) => T} pick uniform element of a non-empty array
 * @property {(weights: number[]) => number} weighted index chosen proportionally to the positive
 *   weights (-1 for an empty list; uniform when no weight is positive)
 * @property {number} state the full 32-bit generator state (read/write, for save games)
 */

const UINT32 = 4294967296;

function toUint32(v) {
  return Number(v) >>> 0;
}

/**
 * Seeded mulberry32 PRNG whose whole state is one uint32, so it can be saved and restored.
 * Every helper consumes exactly one `next()` call (except `weighted([])`, which consumes none).
 * @param {number} seed any number; coerced to uint32
 * @returns {Rng}
 */
export function makeRng(seed) {
  let s = toUint32(seed);

  function next() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / UINT32;
  }

  return {
    next,
    int(n) {
      return Math.floor(next() * n);
    },
    pick(arr) {
      return arr[Math.floor(next() * arr.length)];
    },
    weighted(weights) {
      const len = weights.length;
      if (len === 0) return -1;
      let total = 0;
      for (let i = 0; i < len; i++) {
        if (weights[i] > 0) total += weights[i];
      }
      if (!(total > 0) || !Number.isFinite(total)) return Math.floor(next() * len);
      let x = next() * total;
      let last = -1;
      for (let i = 0; i < len; i++) {
        const w = weights[i];
        if (w > 0) {
          last = i;
          x -= w;
          if (x < 0) return i;
        }
      }
      return last; // floating-point rounding guard
    },
    get state() {
      return s;
    },
    set state(v) {
      s = toUint32(v);
    },
  };
}

/**
 * A fresh uint32 seed: crypto.getRandomValues when available, else Math.random.
 * @returns {number}
 */
export function randomSeed() {
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === 'function') {
    try {
      const buf = new Uint32Array(1);
      c.getRandomValues(buf);
      return buf[0] >>> 0;
    } catch (e) {
      // fall through to Math.random
    }
  }
  return Math.floor(Math.random() * UINT32) >>> 0;
}
