// Pre-rendered bitmaps: beveled blocks (per color × size × dpr), tray/lifted pieces with baked soft shadows,
// glows, sparkles, bubbly display text, the crown, the score badge and the neon board frame.
// Nothing is blurred per frame: every shadowBlur happens once, here.
import { BLOCK_COLORS, COLORS, font } from './theme.js';
import { getShape } from '../core/shapes.js';

const WHITE = [255, 255, 255];
const BLACK = [0, 0, 0];
const TEXT_CACHE_MAX = 24;
const PIECE_CACHE_MAX = 12;

/**
 * '#RRGGBB' or 'rgb(r,g,b)' → [r, g, b] (arrays pass through).
 * @param {string|number[]} color
 * @returns {number[]}
 */
export function hexToRgb(color) {
  if (Array.isArray(color)) return color;
  const s = String(color);
  if (s.charCodeAt(0) !== 35) {
    const m = s.match(/\d+(\.\d+)?/g);
    return m && m.length >= 3 ? [+m[0], +m[1], +m[2]] : [255, 255, 255];
  }
  const n = parseInt(s.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Linear mix of two colors, t = 0 → a, 1 → b.
 * @param {string|number[]} a
 * @param {string|number[]} b
 * @param {number} t
 * @returns {string} 'rgb(r,g,b)'
 */
export function mix(a, b, t) {
  const [r, g, bl] = mixRgb(a, b, t);
  return `rgb(${r},${g},${bl})`;
}

/**
 * Like mix() but returns [r, g, b].
 * @param {string|number[]} a
 * @param {string|number[]} b
 * @param {number} t
 * @returns {number[]}
 */
export function mixRgb(a, b, t) {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return [0, 1, 2].map((i) => Math.round(x[i] + (y[i] - x[i]) * t));
}

/**
 * A color with alpha.
 * @param {string|number[]} hex
 * @param {number} alpha
 * @returns {string}
 */
export function rgba(hex, alpha) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Face color of a block color id (falls back to white for 0 / unknown). */
export function faceColor(id) {
  return BLOCK_COLORS[id] || '#FFFFFF';
}

/**
 * Mixes a block color toward white (t > 0) or black (t < 0).
 * @param {number} id
 * @param {number} t
 * @returns {string}
 */
export function tint(id, t) {
  return t >= 0 ? mix(faceColor(id), WHITE, t) : mix(faceColor(id), BLACK, -t);
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

function release(c) {
  if (c && c.width) {
    c.width = 0;
    c.height = 0;
  }
}

/**
 * Adds a rounded-rectangle path (no reliance on ctx.roundRect).
 * @param {CanvasRenderingContext2D} g
 */
export function roundRectPath(g, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  g.moveTo(x + rr, y);
  g.lineTo(x + w - rr, y);
  g.arcTo(x + w, y, x + w, y + rr, rr);
  g.lineTo(x + w, y + h - rr);
  g.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  g.lineTo(x + rr, y + h);
  g.arcTo(x, y + h, x, y + h - rr, rr);
  g.lineTo(x, y + rr);
  g.arcTo(x, y, x + rr, y, rr);
  g.closePath();
}

function poly(g, pts, fill) {
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.closePath();
  g.fillStyle = fill;
  g.fill();
}

// Soft rounded candy tile with a tiny cat smile, baked once per color and size.
function renderBlock(hex, size, dpr) {
  const s = Math.max(3, Math.round(size * dpr));
  const c = makeCanvas(s, s);
  const g = c.getContext('2d');
  const face = hexToRgb(hex);
  const gap = Math.max(1, s * 0.055);
  const rad = s * 0.19;
  g.beginPath();
  roundRectPath(g, gap, gap + s * 0.065, s - 2 * gap, s - 2 * gap - s * 0.065, rad);
  g.fillStyle = mix(face, BLACK, 0.16);
  g.fill();
  const grad = g.createLinearGradient(0, gap, 0, s - gap);
  grad.addColorStop(0, mix(face, WHITE, 0.26));
  grad.addColorStop(1, hex);
  g.beginPath();
  roundRectPath(g, gap, gap, s - 2 * gap, s - 2 * gap - s * 0.07, rad);
  g.fillStyle = grad;
  g.fill();
  g.strokeStyle = COLORS.blockOutline;
  g.lineWidth = Math.max(0.5, dpr * 0.65);
  g.stroke();
  g.lineCap = 'round';
  g.strokeStyle = 'rgba(255,255,255,.5)';
  g.lineWidth = s * 0.065;
  g.beginPath();
  g.moveTo(s * 0.26, s * 0.2);
  g.lineTo(s * 0.63, s * 0.2);
  g.stroke();
  g.fillStyle = 'rgba(25,25,56,.72)';
  for (const x of [0.35, 0.65]) {
    g.beginPath();
    g.ellipse(s * x, s * 0.5, s * 0.026, s * 0.04, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = 'rgba(25,25,56,.65)';
  g.lineWidth = s * 0.025;
  g.beginPath();
  g.moveTo(s * 0.44, s * 0.59);
  g.quadraticCurveTo(s * 0.5, s * 0.65, s * 0.56, s * 0.59);
  g.stroke();
  return c;
}

// Same outline as icons/cat-gem.svg; keep the quest symbol and canvas collectible consistent.
const GEM_OUTLINE = 'M15 28 13 11Q13 8 16 10L27 18Q32 16 37 18L48 10Q51 8 51 11L49 28Q57 42 45 50Q32 58 19 50Q7 42 15 28Z';
let gemPath = null;

/** A faceted kitty gem. Shared by the board, tray, held pieces and return animation. */
export function drawGem(g, x, y, size) {
  if (!gemPath) gemPath = new Path2D(GEM_OUTLINE);
  g.save();
  g.translate(x, y);
  g.scale(size / 64, size / 64);
  const gradient = g.createLinearGradient(32, 9, 32, 55);
  gradient.addColorStop(0, '#E9FFF8');
  gradient.addColorStop(.5, '#9DF5DF');
  gradient.addColorStop(1, '#51D8C5');
  g.fillStyle = gradient;
  g.fill(gemPath);
  g.strokeStyle = '#17434A';
  g.lineWidth = 2;
  g.lineJoin = 'round';
  g.stroke(gemPath);
  poly(g, [[17, 16], [20, 28], [26, 21]], '#FAFFF6');
  poly(g, [[47, 16], [44, 28], [38, 21]], '#FAFFF6');
  g.beginPath();
  g.moveTo(18, 32);
  g.lineTo(32, 27);
  g.lineTo(46, 32);
  g.moveTo(32, 27);
  g.lineTo(32, 53);
  g.strokeStyle = 'rgba(136,184,175,.6)';
  g.lineWidth = 1;
  g.stroke();
  g.beginPath();
  g.moveTo(18, 32);
  g.lineTo(26, 21);
  g.lineTo(32, 27);
  g.lineTo(44, 21);
  g.lineTo(48, 32);
  g.strokeStyle = 'rgba(246,255,248,.75)';
  g.lineWidth = 2;
  g.stroke();
  g.fillStyle = '#17434A';
  for (const eyeX of [24, 40]) {
    g.beginPath();
    g.ellipse(eyeX, 37, 1.8, 2.5, 0, 0, Math.PI * 2);
    g.fill();
  }
  poly(g, [[29, 42], [32, 44], [35, 42]], '#17434A');
  g.strokeStyle = '#17434A';
  g.lineWidth = 1.4;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(32, 44);
  g.lineTo(32, 46);
  g.quadraticCurveTo(28, 50, 25, 46);
  g.moveTo(32, 46);
  g.quadraticCurveTo(36, 50, 39, 46);
  g.stroke();
  g.restore();
}


// Glow profile across a clearing line (1 px wide / tall, stretched when drawn).
function renderStrip(hex, vertical) {
  const L = 96;
  const c = vertical ? makeCanvas(L, 1) : makeCanvas(1, L);
  const g = c.getContext('2d');
  const grad = vertical ? g.createLinearGradient(0, 0, L, 0) : g.createLinearGradient(0, 0, 0, L);
  const light = mixRgb(hex, WHITE, 0.6);
  grad.addColorStop(0, rgba(hex, 0));
  grad.addColorStop(0.18, rgba(hex, 0.16));
  grad.addColorStop(0.3, rgba(hex, 0.62));
  grad.addColorStop(0.5, rgba(light, 1));
  grad.addColorStop(0.7, rgba(hex, 0.62));
  grad.addColorStop(0.82, rgba(hex, 0.16));
  grad.addColorStop(1, rgba(hex, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

// Four-point sparkle with a white core.
function renderStar(hex) {
  const S = 48;
  const r = S / 2;
  const c = makeCanvas(S, S);
  const g = c.getContext('2d');
  g.translate(r, r);
  g.shadowColor = hex;
  g.shadowBlur = 7;
  const R = r * 0.8;
  const k = r * 0.13;
  g.beginPath();
  g.moveTo(0, -R);
  g.quadraticCurveTo(k, -k, R, 0);
  g.quadraticCurveTo(k, k, 0, R);
  g.quadraticCurveTo(-k, k, -R, 0);
  g.quadraticCurveTo(-k, -k, 0, -R);
  const rg = g.createRadialGradient(0, 0, 0, 0, 0, R);
  rg.addColorStop(0, '#FFFFFF');
  rg.addColorStop(0.35, mix(hex, WHITE, 0.6));
  rg.addColorStop(1, hex);
  g.fillStyle = rg;
  g.fill();
  return c;
}

// Soft shockwave ring (white, stretched when drawn).
function renderRing() {
  const S = 160;
  const c = makeCanvas(S, S);
  const g = c.getContext('2d');
  const rg = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  rg.addColorStop(0, 'rgba(255,255,255,0)');
  rg.addColorStop(0.62, 'rgba(255,255,255,0)');
  rg.addColorStop(0.86, 'rgba(255,255,255,0.75)');
  rg.addColorStop(0.93, 'rgba(255,255,255,0.35)');
  rg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = rg;
  g.fillRect(0, 0, S, S);
  return c;
}

function renderCrown(size, dpr) {
  // Designed in a 104 × 80 box.
  const k = size / 80;
  const m = 4;
  const c = makeCanvas((104 * k + 2 * m) * dpr, (80 * k + 2 * m) * dpr);
  const g = c.getContext('2d');
  g.setTransform(dpr * k, 0, 0, dpr * k, m * dpr, m * dpr);
  const body = () => {
    g.beginPath();
    g.moveTo(14, 60);
    g.lineTo(8, 25);
    g.lineTo(32, 42);
    g.lineTo(52, 13);
    g.lineTo(72, 42);
    g.lineTo(96, 25);
    g.lineTo(90, 60);
    g.closePath();
    roundRectPath(g, 13, 56, 78, 18, 6);
    g.moveTo(15, 24);
    g.arc(8, 24, 7, 0, Math.PI * 2);
    g.moveTo(59, 11);
    g.arc(52, 11, 7.5, 0, Math.PI * 2);
    g.moveTo(103, 24);
    g.arc(96, 24, 7, 0, Math.PI * 2);
  };
  g.lineJoin = 'round';
  // dark rim + drop shadow
  g.save();
  g.translate(0, 3);
  body();
  g.fillStyle = 'rgba(70,30,0,0.45)';
  g.fill();
  g.restore();
  body();
  g.strokeStyle = COLORS.crownLine;
  g.lineWidth = 6;
  g.stroke();
  const grad = g.createLinearGradient(0, 4, 0, 76);
  grad.addColorStop(0, COLORS.crownLight);
  grad.addColorStop(0.55, COLORS.crown);
  grad.addColorStop(1, COLORS.crownDark);
  g.fillStyle = grad;
  g.fill();
  // band separation + shine
  g.fillStyle = 'rgba(160,80,0,0.35)';
  g.fillRect(16, 56, 72, 2.5);
  g.fillStyle = 'rgba(255,255,255,0.6)';
  g.beginPath();
  g.ellipse(30, 50, 9, 4, -0.5, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.arc(50, 8, 2.6, 0, Math.PI * 2);
  g.fill();
  return { canvas: c, w: 104 * k + 2 * m, h: 80 * k + 2 * m, m };
}

// Cyan gem behind the score (a softened diamond with a lit facet and a baked glow).
function renderBadge(size, dpr) {
  const w = size * 0.92;
  const h = size;
  const m = size * 0.5;
  const W = w + 2 * m;
  const H = h + 2 * m;
  const c = makeCanvas(W * dpr, H * dpr);
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  const cx = W / 2;
  const cy = H / 2;
  const path = () => {
    const r = size * 0.12;
    const pts = [[cx, cy - h / 2], [cx + w / 2, cy], [cx, cy + h / 2], [cx - w / 2, cy]];
    g.beginPath();
    g.moveTo((pts[3][0] + pts[0][0]) / 2, (pts[3][1] + pts[0][1]) / 2);
    for (let i = 0; i < 4; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % 4];
      g.arcTo(p[0], p[1], q[0], q[1], r);
    }
    g.closePath();
  };
  g.save();
  g.shadowColor = COLORS.badgeGlow;
  g.shadowBlur = size * 0.42 * dpr;
  path();
  g.fillStyle = COLORS.badge;
  g.fill();
  g.fill();
  g.restore();
  path();
  const grad = g.createLinearGradient(0, cy - h / 2, 0, cy + h / 2);
  grad.addColorStop(0, COLORS.badgeLight);
  grad.addColorStop(0.5, COLORS.badge);
  grad.addColorStop(1, COLORS.badgeDeep);
  g.fillStyle = grad;
  g.fill();
  g.save();
  g.clip();
  g.fillStyle = 'rgba(255,255,255,0.32)';
  g.beginPath();
  g.moveTo(cx, cy - h / 2);
  g.lineTo(cx - w / 2, cy);
  g.lineTo(cx, cy - h * 0.06);
  g.closePath();
  g.fill();
  g.restore();
  path();
  g.strokeStyle = 'rgba(230,252,255,0.85)';
  g.lineWidth = Math.max(1, size * 0.035);
  g.stroke();
  return { canvas: c, w: W, h: H };
}

function renderNeon(w, h, r, dpr) {
  const m = 24;
  const c = makeCanvas((w + 2 * m) * dpr, (h + 2 * m) * dpr);
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  const path = () => {
    g.beginPath();
    roundRectPath(g, m, m, w, h, r);
  };
  g.shadowColor = COLORS.neon;
  g.shadowBlur = 18 * dpr;
  g.strokeStyle = rgba(COLORS.neon, 0.9);
  g.lineWidth = 4.5;
  path();
  g.stroke();
  g.stroke();
  g.shadowBlur = 6 * dpr;
  g.strokeStyle = COLORS.neonCore;
  g.lineWidth = 1.8;
  path();
  g.stroke();
  return { canvas: c, m };
}

/**
 * @typedef {object} TextPart
 * @property {string} text
 * @property {number} size CSS px
 * @property {number} [weight] default 900
 * @property {string|string[]} fill color or gradient stops (top → bottom)
 * @property {string} [stroke] outline color
 * @property {number} [strokeFrac] outline width as a fraction of size (default 0.12)
 * @property {string|null} [shadow] hard drop-shadow color (null = none)
 * @property {number} [skew] horizontal shear (negative leans right)
 * @property {string} [glow] soft outer glow color
 * @property {boolean} [gloss] glossy highlight on the upper half (default true)
 */

/**
 * @typedef {object} TextSprite
 * @property {HTMLCanvasElement} canvas
 * @property {number} w CSS px
 * @property {number} h CSS px
 * @property {number} vy y (inside the sprite) of the visual middle of the letters
 * @property {number} vh visual height of the letters incl. outline
 * @property {number} vw visual width incl. outline
 */

let scratch = null;
function measure(part) {
  if (!scratch) scratch = makeCanvas(8, 8).getContext('2d');
  scratch.font = font(part.weight || 900, part.size);
  return scratch.measureText(part.text).width;
}

// Bubbly text: soft glow → hard drop shadow → round outline → gradient fill → gloss. Several parts share
// one baseline (e.g. "Combo" + a bigger number).
function renderText(parts, gap, dpr) {
  const widths = parts.map(measure);
  const sws = parts.map((p) => (p.stroke ? p.size * (p.strokeFrac === undefined ? 0.12 : p.strokeFrac) : 0));
  const maxSize = Math.max(...parts.map((p) => p.size));
  const maxSw = Math.max(...sws);
  const skew = Math.max(...parts.map((p) => Math.abs(p.skew || 0)));
  const glowB = parts.some((p) => p.glow) ? maxSize * 0.32 : 0;
  const pad = Math.ceil(maxSw + maxSize * 0.12 + glowB);
  const textW = widths.reduce((s, w) => s + w, 0) + gap * (parts.length - 1);
  const W = Math.ceil(textW + 2 * pad + skew * maxSize);
  const H = Math.ceil(maxSize * 1.18 + 2 * pad);
  const baseline = pad + maxSize * 0.92;
  const c = makeCanvas(W * dpr, H * dpr);
  const g = c.getContext('2d');
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.lineJoin = 'round';
  g.miterLimit = 2;
  const xs = [];
  let x = pad + skew * maxSize * 0.45;
  parts.forEach((p, i) => {
    xs.push(x);
    x += widths[i] + gap;
  });
  const each = (fn) => parts.forEach((p, i) => {
    const sk = p.skew || 0;
    g.setTransform(dpr, 0, sk * dpr, dpr, -sk * baseline * dpr, 0);
    g.font = font(p.weight || 900, p.size);
    fn(p, xs[i], sws[i]);
  });

  each((p, px, sw) => {
    if (!p.glow) return;
    g.save();
    g.shadowColor = p.glow;
    g.shadowBlur = p.size * 0.3 * dpr;
    g.fillStyle = p.glow;
    g.strokeStyle = p.glow;
    g.lineWidth = sw * 2 + 1;
    g.strokeText(p.text, px, baseline);
    g.fillText(p.text, px, baseline);
    g.restore();
  });
  each((p, px, sw) => {
    if (p.shadow === null) return;
    const col = p.shadow || 'rgba(8,12,40,0.42)';
    g.fillStyle = col;
    g.strokeStyle = col;
    g.lineWidth = sw * 2;
    const dy = p.size * 0.075;
    if (sw) g.strokeText(p.text, px, baseline + dy);
    g.fillText(p.text, px, baseline + dy);
  });
  each((p, px, sw) => {
    if (!sw) return;
    g.strokeStyle = p.stroke;
    g.lineWidth = sw * 2;
    g.strokeText(p.text, px, baseline);
  });
  each((p, px) => {
    const stops = Array.isArray(p.fill) ? p.fill : [p.fill, p.fill];
    const grad = g.createLinearGradient(0, baseline - p.size * 0.78, 0, baseline + p.size * 0.08);
    stops.forEach((s, i) => grad.addColorStop(i / (stops.length - 1), s));
    g.fillStyle = grad;
    g.fillText(p.text, px, baseline);
    if (p.gloss === false) return;
    const gl = g.createLinearGradient(0, baseline - p.size * 0.8, 0, baseline - p.size * 0.32);
    gl.addColorStop(0, 'rgba(255,255,255,0.55)');
    gl.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gl;
    g.fillText(p.text, px, baseline);
  });
  return {
    canvas: c,
    w: W,
    h: H,
    vy: baseline - maxSize * 0.36,
    vh: maxSize * 0.78 + 2 * maxSw,
    vw: textW + 2 * maxSw + skew * maxSize * 0.5,
  };
}

/**
 * Sprite factory with caches keyed by size and device pixel ratio.
 * @returns {object}
 */
export function createSprites() {
  let dpr = 1;
  // Hot caches avoid building string keys per frame: blocks by size then color id; strips by color id;
  // stars by color string.
  const blocks = new Map();
  const strips = [[], []];
  const stars = new Map();
  const pieces = new Map();
  const texts = new Map();
  const glows = new Map();
  const misc = new Map();

  const dropBlocks = () => {
    blocks.forEach((row) => row.forEach(release));
    blocks.clear();
  };
  const dropAll = () => {
    dropBlocks();
    for (const map of [pieces, glows, misc]) {
      map.forEach((v) => release(v.canvas || v));
      map.clear();
    }
    stars.forEach(release);
    stars.clear();
    strips.forEach((list) => {
      list.forEach(release);
      list.length = 0;
    });
    clearTexts();
  };
  // Text bitmaps may still be held by live effects, so they are only forgotten, never released.
  const clearTexts = () => texts.clear();
  const cached = (map, key, make) => {
    let v = map.get(key);
    if (!v) {
      v = make();
      map.set(key, v);
    }
    return v;
  };
  // Least-recently-used lookup: a hit moves the entry to the end; the oldest entries beyond `max` go.
  const lru = (map, key, max, make, onEvict) => {
    let v = map.get(key);
    if (v) {
      map.delete(key);
      map.set(key, v);
      return v;
    }
    v = make();
    map.set(key, v);
    while (map.size > max) {
      const oldest = map.keys().next().value;
      if (onEvict) onEvict(map.get(oldest));
      map.delete(oldest);
    }
    return v;
  };

  const api = {
    get dpr() {
      return dpr;
    },
    /** Sets the device pixel ratio; caches are rebuilt lazily when it changes. */
    setDpr(v) {
      if (v === dpr) return;
      dpr = v;
      dropAll();
    },
    /** Drops size-dependent caches (pieces, misc, text) after a layout change; blocks stay (keyed by size). */
    resetLayoutCaches() {
      pieces.forEach((v) => release(v.canvas));
      pieces.clear();
      misc.forEach((v) => release(v.canvas || v));
      misc.clear();
      clearTexts();
      if (blocks.size > 6) dropBlocks();
    },
    /** Drops text sprites (after the web font loaded). */
    clearTexts,
    /**
     * Beveled block bitmap for a color id at `size` CSS px.
     * @param {number} id 1..7
     * @param {number} size
     * @returns {HTMLCanvasElement}
     */
    block(id, size) {
      let row = blocks.get(size);
      if (!row) {
        row = [];
        blocks.set(size, row);
      }
      return row[id] || (row[id] = renderBlock(faceColor(id), size, dpr));
    },
    /**
     * A whole piece with a baked soft drop shadow. kind 'tray' = small offset shadow; 'lift' = floating.
     * @returns {{ canvas: HTMLCanvasElement, ox: number, oy: number, w: number, h: number }} ox/oy = offset of
     *   the bitmap's top-left from the piece's top-left (CSS px); w/h = bitmap size in CSS px
     */
    piece(shapeId, id, cell, kind) {
      return lru(pieces, `${shapeId}:${id}:${cell}:${kind}`, PIECE_CACHE_MAX, () => {
        const shape = getShape(shapeId);
        const lift = kind === 'lift';
        const sh = lift
          ? { dx: 0.1 * cell, dy: 0.26 * cell, blur: 0.3 * cell, color: COLORS.liftShadow }
          : { dx: 0.1 * cell, dy: 0.14 * cell, blur: 0.14 * cell, color: COLORS.trayShadow };
        const m = Math.ceil(sh.blur * 2 + Math.max(sh.dx, sh.dy));
        const w = shape.w * cell + 2 * m;
        const h = shape.h * cell + 2 * m;
        const c = makeCanvas(w * dpr, h * dpr);
        const g = c.getContext('2d');
        g.scale(dpr, dpr);
        const far = w + 40; // draw the silhouette off-canvas so only its shadow lands
        g.save();
        g.shadowColor = sh.color;
        g.shadowBlur = sh.blur * dpr;
        g.shadowOffsetX = (sh.dx + far) * dpr;
        g.shadowOffsetY = sh.dy * dpr;
        g.fillStyle = '#000';
        g.beginPath();
        for (const [r, col] of shape.cells) g.rect(m + col * cell - far, m + r * cell, cell, cell);
        g.fill();
        g.restore();
        const bmp = api.block(id, cell);
        for (const [r, col] of shape.cells) g.drawImage(bmp, m + col * cell, m + r * cell, cell, cell);
        return { canvas: c, ox: -m, oy: -m, w, h };
      }, (old) => release(old.canvas)); // bitmaps are fetched per draw, so an evicted one is never reused
    },
    /** Glow profile across a clearing line; vertical = for a column. */
    strip(id, vertical) {
      const list = strips[vertical ? 1 : 0];
      return list[id] || (list[id] = renderStrip(faceColor(id), vertical));
    },
    /** Four-point sparkle tinted with a CSS color ('#RRGGBB' or 'rgb()'). */
    star(color) {
      let c = stars.get(color);
      if (!c) {
        c = renderStar(color);
        stars.set(color, c);
      }
      return c;
    },
    /** Soft white shockwave ring. */
    ring() {
      return cached(glows, 'ring', renderRing);
    },
    /** Gold crown, `size` CSS px tall. */
    crown(size) {
      return cached(misc, `crown:${size}`, () => renderCrown(size, dpr));
    },
    /** Cyan gem badge drawn behind the score. */
    badge(size) {
      return cached(misc, `badge:${size}`, () => renderBadge(size, dpr));
    },
    /** Neon glow outline for a board of w × h CSS px with corner radius r. */
    neon(w, h, r) {
      return cached(misc, `neon:${w}:${h}:${r}`, () => renderNeon(w, h, r, dpr));
    },
    /**
     * Bubbly display text (LRU-cached by key).
     * @param {string} key
     * @param {TextPart[]} parts
     * @param {number} [gap] CSS px between parts
     * @returns {TextSprite}
     */
    text(key, parts, gap = 0) {
      return lru(texts, key, TEXT_CACHE_MAX, () => renderText(parts, gap, dpr));
    },
  };
  return api;
}
