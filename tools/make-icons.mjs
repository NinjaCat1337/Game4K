// Procedural app icons, zero dependencies (PNG = node:zlib + CRC32).
// Opaque, full-bleed square art (iOS rounds the corners itself): indigo-blue gradient with a soft glow and a
// cluster of beveled blocks in the game palette, drawn like the game's tiles (four trapezoid bevels, thin
// dark outline, soft drop shadow). Block edges are snapped to whole pixels so small sizes stay crisp.
//
// Usage: node tools/make-icons.mjs [--out <dir>] [--master <file.png>]
//   --out     icons folder (default: <project>/icons)
//   --master  also write a 1024 px master PNG there (for review)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const PALETTE = {
  red: '#E2483F', orange: '#F26A1B', yellow: '#F5BE06', green: '#2DBE3C',
  cyan: '#16BFEA', blue: '#3A62EC', purple: '#8E4EE2',
};

/** Cluster on a 3×3 grid: [row, col, color]. */
export const DEFAULT_CLUSTER = [
  [0, 1, 'yellow'], [0, 2, 'yellow'],
  [1, 0, 'red'], [1, 1, 'cyan'], [1, 2, 'cyan'],
  [2, 0, 'red'], [2, 1, 'cyan'], [2, 2, 'green'],
];

/** Output files: [file name, size, cluster share of the icon side]. */
export const ICONS = [
  ['apple-touch-icon.png', 180, 0.64],
  ['favicon-32.png', 32, 0.86],
  ['icon-192.png', 192, 0.64],
  ['icon-512.png', 512, 0.64],
  ['icon-maskable-512.png', 512, 0.52], // art inside the central 80% circle
];
const MASTER_SIZE = 1024;
const MASTER_SHARE = 0.64;

// ---------------------------------------------------------------- color helpers
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const WHITE = [255, 255, 255];
const BLACK = [0, 0, 0];
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

function bevelSet(color) {
  const face = hex(color);
  return {
    face,
    faceTop: mix(face, WHITE, 0.07),
    top: mix(face, WHITE, 0.45),
    left: mix(face, WHITE, 0.15),
    right: mix(face, BLACK, 0.15),
    bottom: mix(face, BLACK, 0.35),
  };
}

// ---------------------------------------------------------------- scene
const BG_TOP = hex('#4F68D2');
const BG_BOTTOM = hex('#2C3C92');
const GLOW = hex('#7C95F0');
const SHADOW = hex('#0E1440');

/**
 * Builds the scene for a square icon of `size` px: blocks with pixel-snapped edges (in px).
 * @param {number} size
 * @param {number} share cluster side / icon side
 * @param {Array<[number, number, string]>} cluster
 */
function layout(size, share, cluster) {
  const rows = 1 + Math.max(...cluster.map((b) => b[0]));
  const cols = 1 + Math.max(...cluster.map((b) => b[1]));
  const n = Math.max(rows, cols);
  const cell = Math.max(3, Math.round((size * share) / n));
  // optical centering: move halfway from the grid's center toward the blocks' centroid
  const mr = cluster.reduce((s, b) => s + b[0] + 0.5, 0) / cluster.length - rows / 2;
  const mc = cluster.reduce((s, b) => s + b[1] + 0.5, 0) / cluster.length - cols / 2;
  const ox = Math.round((size - cell * cols) / 2 - mc * cell * 0.5);
  const oy = Math.round((size - cell * rows) / 2 - mr * cell * 0.5);
  const blocks = cluster.map(([r, c, color]) => ({
    x: ox + c * cell, y: oy + r * cell, s: cell, colors: bevelSet(PALETTE[color] || color),
  }));
  return { size, cell, blocks, cx: ox + (cell * cols) / 2, cy: oy + (cell * rows) / 2, extent: cell * n };
}

function background(scene, x, y) {
  const { size } = scene;
  let c = mix(BG_TOP, BG_BOTTOM, smooth(0, 1, y / size));
  // soft glow behind the cluster
  const dx = (x - scene.cx) / (scene.extent * 0.95);
  const dy = (y - scene.cy) / (scene.extent * 0.95);
  const g = Math.exp(-(dx * dx + dy * dy) * 1.6);
  c = mix(c, GLOW, 0.42 * g);
  return c;
}

/** Signed distance from (x, y) to an axis-aligned rect. */
function sdRect(x, y, rx, ry, w, h) {
  const qx = Math.abs(x - (rx + w / 2)) - w / 2;
  const qy = Math.abs(y - (ry + h / 2)) - h / 2;
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0);
}

function shadowAlpha(scene, x, y) {
  const { cell } = scene;
  const offX = cell * 0.06;
  const offY = cell * 0.1;
  const blur = Math.max(1, cell * 0.16);
  let d = Infinity;
  for (const b of scene.blocks) d = Math.min(d, sdRect(x, y, b.x + offX, b.y + offY, b.s, b.s));
  return 0.42 * (1 - smooth(-blur, blur, d));
}

function blockColor(b, x, y, outlinePx) {
  const u = (x - b.x) / b.s;
  const v = (y - b.y) / b.s;
  const bw = 0.14;
  const m = Math.min(u, 1 - u, v, 1 - v);
  const k = b.colors;
  let c;
  if (m < bw) {
    if (m === v) c = k.top;
    else if (m === 1 - v) c = k.bottom;
    else if (m === u) c = k.left;
    else c = k.right;
  } else {
    c = mix(k.faceTop, k.face, clamp01((v - bw) / (1 - 2 * bw)));
  }
  if (m * b.s < outlinePx) c = mix(c, BLACK, 0.35);
  return c;
}

function sample(scene, x, y, outlinePx) {
  for (const b of scene.blocks) {
    if (x >= b.x && x < b.x + b.s && y >= b.y && y < b.y + b.s) return blockColor(b, x, y, outlinePx);
  }
  return mix(background(scene, x, y), SHADOW, shadowAlpha(scene, x, y));
}

/**
 * Renders an opaque RGB icon.
 * @param {number} size px
 * @param {{ share?: number, cluster?: Array<[number, number, string]> }} [opts]
 * @returns {Uint8Array} size*size*3 RGB bytes
 */
export function renderIcon(size, { share = 0.64, cluster = DEFAULT_CLUSTER } = {}) {
  const scene = layout(size, share, cluster);
  const ss = size <= 64 ? 6 : size <= 600 ? 4 : 3;
  const outlinePx = Math.min(3, Math.max(0.75, scene.cell * 0.035));
  const out = new Uint8Array(size * size * 3);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let bl = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = sample(scene, px + (sx + 0.5) / ss, py + (sy + 0.5) / ss, outlinePx);
          r += c[0];
          g += c[1];
          bl += c[2];
        }
      }
      const n = ss * ss;
      // tiny ordered dither against gradient banding
      const dither = (((px * 7 + py * 13) % 16) / 16 - 0.5) * 0.9;
      const i = (py * size + px) * 3;
      out[i] = Math.max(0, Math.min(255, Math.round(r / n + dither)));
      out[i + 1] = Math.max(0, Math.min(255, Math.round(g / n + dither)));
      out[i + 2] = Math.max(0, Math.min(255, Math.round(bl / n + dither)));
    }
  }
  return out;
}

// ---------------------------------------------------------------- PNG encoder
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, crc]);
}

const paeth = (a, b, c) => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/**
 * Encodes 8-bit RGB pixels as PNG (per-row adaptive filter, max deflate).
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array} rgb
 * @returns {Buffer}
 */
export function encodePNG(width, height, rgb) {
  const bpp = 3;
  const stride = width * bpp;
  const raw = Buffer.alloc((stride + 1) * height);
  const cand = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const row = rgb.subarray(y * stride, (y + 1) * stride);
    const prev = y ? rgb.subarray((y - 1) * stride, y * stride) : null;
    let bestType = 0;
    let bestScore = Infinity;
    let best = null;
    for (let type = 0; type < 5; type++) {
      let score = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? row[i - bpp] : 0;
        const b = prev ? prev[i] : 0;
        const c = prev && i >= bpp ? prev[i - bpp] : 0;
        const pred = type === 0 ? 0 : type === 1 ? a : type === 2 ? b : type === 3 ? (a + b) >> 1 : paeth(a, b, c);
        const val = (row[i] - pred) & 0xff;
        cand[i] = val;
        score += val < 128 ? val : 256 - val;
      }
      if (score < bestScore) {
        bestScore = score;
        bestType = type;
        best = Buffer.from(cand);
      }
    }
    raw[y * (stride + 1)] = bestType;
    best.copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB (opaque)
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- CLI
function main() {
  const args = process.argv.slice(2);
  const opt = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const project = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const outDir = path.resolve(opt('--out') || path.join(project, 'icons'));
  fs.mkdirSync(outDir, { recursive: true });
  for (const [name, size, share] of ICONS) {
    const png = encodePNG(size, size, renderIcon(size, { share }));
    fs.writeFileSync(path.join(outDir, name), png);
    console.log(`make-icons: ${path.join(outDir, name)} (${size}×${size}, ${png.length} bytes)`);
  }
  const master = opt('--master');
  if (master) {
    const file = path.resolve(master);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, encodePNG(MASTER_SIZE, MASTER_SIZE, renderIcon(MASTER_SIZE, { share: MASTER_SHARE })));
    console.log(`make-icons: ${file} (${MASTER_SIZE}×${MASTER_SIZE} master)`);
  }
}

function isMain() {
  try {
    const norm = (p) => {
      const real = fs.realpathSync(p);
      return process.platform === 'win32' ? real.toLowerCase() : real;
    };
    return norm(process.argv[1]) === norm(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) main();
