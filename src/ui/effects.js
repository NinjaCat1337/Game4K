// Everything that animates on its own: placement settle, clear flash → glow bands → shards, combo banner,
// "+N" popups, praise, Perfect!, toasts, background flash, screen shake, neon frame, tray pop-in,
// game-over band / fill sweep / fade. Time comes from the shared clock (seconds, advanced by clamped dt),
// so a backgrounded app freezes its effects instead of skipping them.
import { TIMING, PARTICLES, COLORS, TEXT, CONFETTI_COLORS } from './theme.js';
import { faceColor, tint, rgba } from './sprites.js';

const N = 8;
const TAU = Math.PI * 2;

/** Easing helpers (t in 0..1). */
export const ease = Object.freeze({
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  outQuad: (t) => 1 - (1 - t) * (1 - t),
  inOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  inQuad: (t) => t * t,
});

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/**
 * Pop-in scale: 0 → peak (at 60 % of dur) → 1.
 * @param {number} t seconds since start
 * @param {number} dur
 * @param {number} peak
 * @returns {number}
 */
export function popCurve(t, dur, peak) {
  if (t <= 0) return 0;
  const p = t / dur;
  if (p >= 1) return 1;
  if (p < 0.6) return peak * ease.outCubic(p / 0.6);
  return peak + (1 - peak) * ease.inOutQuad((p - 0.6) / 0.4);
}

/**
 * @param {{ clock: { now: number }, sprites: object, reduced: () => boolean }} deps
 */
export function createEffects({ clock, sprites, reduced }) {
  const P = [];
  const pool = [];
  let bursts = [];
  let bands = [];
  let texts = [];
  let cues = [];
  let settle = null;
  const hidden = new Uint8Array(N * N);
  let flashStart = -1;
  let shake = { start: -1, amp: 0, p1: 0, p2: 0 };
  const neon = { level: 0, combo: false, pulseUntil: -1, lastBurst: -1 };
  const trayPop = [-1, -1, -1];
  const poofs = [-1, -1, -1];
  let gameOver = null;
  let previewAcc = 0;
  let layout = null;

  const now = () => clock.now;
  const budget = (n) => Math.max(1, Math.round(n * (reduced() ? PARTICLES.reducedFactor : 1)));

  // ---------------------------------------------------------------- particles
  function spawn(o) {
    if (P.length >= PARTICLES.max) return null;
    const p = pool.pop() || {};
    p.kind = 'sq';
    p.x = 0;
    p.y = 0;
    p.vx = 0;
    p.vy = 0;
    p.g = 0;
    p.drag = 0;
    p.size = 4;
    p.size1 = -1;
    p.rot = 0;
    p.vr = 0;
    p.color = '#fff';
    p.color2 = null;
    p.life = 0.5;
    p.t = 0;
    p.delay = 0;
    p.add = false;
    p.alpha = 1;
    p.fadeAt = 0.55;
    p.twinkle = 0;
    p.phase = Math.random() * TAU;
    p.flutter = 0;
    p.layer = 'fx';
    Object.assign(p, o);
    P.push(p);
    return p;
  }

  function stepParticles(dt) {
    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i];
      if (p.delay > 0) {
        p.delay -= dt;
        continue;
      }
      p.t += dt;
      if (p.t >= p.life) {
        P[i] = P[P.length - 1];
        P.pop();
        pool.push(p);
        continue;
      }
      if (p.drag) {
        const k = Math.max(0, 1 - p.drag * dt);
        p.vx *= k;
        p.vy *= k;
      }
      p.vy += p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
    }
  }

  function drawParticles(ctx, layer, base) {
    const { dpr, sx, sy } = base;
    let additive = false;
    for (let i = 0; i < P.length; i++) {
      const p = P[i];
      if (p.layer !== layer || p.delay > 0) continue;
      const u = p.t / p.life;
      let a = p.alpha * (u > p.fadeAt ? 1 - (u - p.fadeAt) / (1 - p.fadeAt) : 1);
      if (u < 0.08) a *= u / 0.08;
      if (p.twinkle) a *= 0.5 + 0.5 * Math.sin(p.t * p.twinkle + p.phase);
      if (a <= 0.01) continue;
      if (p.add !== additive) {
        additive = p.add;
        ctx.globalCompositeOperation = additive ? 'lighter' : 'source-over';
      }
      ctx.globalAlpha = a;
      const s = p.size1 >= 0 ? p.size + (p.size1 - p.size) * u : p.size;
      const x = (p.x + sx) * dpr;
      const y = (p.y + sy) * dpr;
      if (p.kind === 'spark') {
        ctx.setTransform(dpr, 0, 0, dpr, x, y);
        ctx.fillStyle = p.color;
        ctx.fillRect(-s / 2, -s / 2, s, s);
        continue;
      }
      const cos = Math.cos(p.rot) * dpr;
      const sin = Math.sin(p.rot) * dpr;
      if (p.kind === 'conf') {
        const f = Math.cos(p.t * p.flutter + p.phase);
        ctx.setTransform(cos, sin, -sin * f, cos * f, x, y);
        ctx.fillStyle = p.color;
        ctx.fillRect(-s / 2, -s * 0.3, s, s * 0.6);
      } else if (p.kind === 'star') {
        ctx.setTransform(cos, sin, -sin, cos, x, y);
        ctx.drawImage(sprites.star(p.color), -s / 2, -s / 2, s, s);
      } else if (p.kind === 'wave') {
        ctx.setTransform(dpr, 0, 0, dpr, x, y);
        ctx.drawImage(sprites.ring(), -s / 2, -s / 2, s, s);
      } else {
        ctx.setTransform(cos, sin, -sin, cos, x, y);
        ctx.fillStyle = p.color;
        ctx.fillRect(-s / 2, -s / 2, s, s);
        if (p.color2) {
          ctx.fillStyle = p.color2;
          ctx.fillRect(-s / 2, -s / 2, s, s * 0.32);
        }
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.setTransform(dpr, 0, 0, dpr, sx * dpr, sy * dpr);
  }

  function sparkleBurst(x, y, radius, count, colors, opts = {}) {
    const n = budget(count);
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * TAU;
      const sp = rand(0.4, 1) * radius * (opts.speed || 3);
      spawn({
        kind: 'star', x: x + Math.cos(ang) * radius * 0.2, y: y + Math.sin(ang) * radius * 0.2,
        vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - radius * (opts.lift || 0), drag: opts.drag || 3,
        g: opts.g || 0, size: rand(0.18, 0.34) * radius, size1: 0, rot: Math.random() * TAU, vr: rand(-3, 3),
        color: pick(colors), life: rand(0.5, 0.85) * (opts.life || 1), add: true, fadeAt: 0.35,
        layer: opts.layer || 'top', delay: opts.delay || 0,
      });
    }
  }

  function confettiBurst(x, y, cell, count, opts = {}) {
    const n = budget(count);
    for (let i = 0; i < n; i++) {
      const ang = -Math.PI / 2 + rand(-1.15, 1.15);
      const sp = cell * rand(5, 11) * (opts.power || 1);
      spawn({
        kind: 'conf', x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, g: cell * 14, drag: 1.6,
        size: cell * rand(0.2, 0.32), rot: Math.random() * TAU, vr: rand(-9, 9), flutter: rand(8, 16),
        color: pick(CONFETTI_COLORS), life: rand(1.1, 1.6), fadeAt: 0.7, layer: opts.layer || 'fx', delay: rand(0, 0.06),
      });
    }
  }

  // ---------------------------------------------------------------- cues
  function cue(at, fn) {
    cues.push({ at, fn });
  }

  function runCues() {
    if (!cues.length) return;
    const t = now();
    const due = cues.filter((c) => c.at <= t);
    if (!due.length) return;
    cues = cues.filter((c) => c.at > t);
    due.sort((a, b) => a.at - b.at).forEach((c) => {
      try {
        c.fn();
      } catch (err) {
        console.error(err);
      }
    });
  }

  // ---------------------------------------------------------------- text
  const textSprite = {
    banner(n, cell) {
      const s1 = Math.round(TEXT.combo.size * cell);
      const s2 = Math.round(TEXT.comboNum.size * cell);
      return sprites.text(`combo:${n}:${s1}`, [
        { text: 'Combo', size: s1, fill: TEXT.combo.fill, stroke: TEXT.combo.stroke, skew: TEXT.combo.skew },
        { text: String(n), size: s2, fill: TEXT.comboNum.fill, stroke: TEXT.comboNum.stroke, skew: TEXT.comboNum.skew, glow: 'rgba(255,190,40,0.55)' },
      ], Math.round(cell * 0.16));
    },
    popup(n, id, cell) {
      const s = Math.round(TEXT.popup.size * cell);
      return sprites.text(`pop:${n}:${id}:${s}`, [
        { text: `+${n}`, size: s, fill: ['#FFFFFF', '#FFFFFF', tint(id, 0.5)], stroke: tint(id, -0.55), strokeFrac: 0.12 },
      ]);
    },
    praise(word, id, cell) {
      const s = Math.round(TEXT.praise.size * cell);
      return sprites.text(`praise:${word}:${id}:${s}`, [
        { text: word, size: s, fill: [tint(id, 0.85), tint(id, 0.42), faceColor(id)], stroke: tint(id, -0.55), strokeFrac: 0.11, glow: rgba(faceColor(id), 0.5) },
      ]);
    },
    perfect(cell) {
      const s = Math.round(TEXT.perfect.size * cell);
      return sprites.text(`perfect:${s}`, [
        { text: 'Purr-fect!', size: s, fill: TEXT.perfect.fill, stroke: TEXT.perfect.stroke, shadow: TEXT.perfect.shadow, strokeFrac: 0.1, glow: 'rgba(255,90,110,0.6)' },
      ]);
    },
    toast(cell) {
      const s = Math.round(TEXT.toast.size * cell);
      return sprites.text(`toast:${s}`, [
        { text: 'Meow! New high score!', size: s, fill: TEXT.toast.fill, stroke: TEXT.toast.stroke, glow: 'rgba(255,120,210,0.75)' },
      ]);
    },
    noSpace(cell) {
      const s = Math.round(TEXT.noSpace.size * cell);
      return sprites.text(`nospace:${s}`, [
        { text: 'No Space Left', size: s, weight: 800, fill: TEXT.noSpace.fill, gloss: false, shadow: 'rgba(6,10,36,0.45)' },
      ]);
    },
  };

  function makeText(kind, sp, start, life, extra) {
    return { kind, sp, start, life, x: 0, y: 0, rise: 0, fit: 1, fadeFrom: -1, onShow: null, shown: false, ...extra };
  }

  // Stack the items of one move vertically around `anchor` inside the board so they never overlap.
  function placeGroup(items, anchor) {
    const L = layout;
    const { inner, innerSize, cell } = L.board;
    const gap = cell * 0.06;
    items.forEach((it) => {
      it.fit = Math.min(1, (innerSize + L.board.pad * 2) / Math.max(1, it.sp.vw));
    });
    const slotH = (it) => it.sp.vh * it.fit + it.rise;
    const total = items.reduce((s, it) => s + slotH(it), 0) + gap * (items.length - 1);
    let y = anchor.y - total / 2;
    y = Math.max(inner.y + 2, Math.min(y, inner.y + innerSize - total - 2));
    if (total > innerSize) y = inner.y + (innerSize - total) / 2;
    items.forEach((it) => {
      const half = (it.sp.vw * it.fit) / 2;
      it.x = Math.max(inner.x + half + 2, Math.min(anchor.x, inner.x + innerSize - half - 2));
      if (half * 2 > innerSize) it.x = inner.x + innerSize / 2;
      it.y = y + it.rise + (it.sp.vh * it.fit) / 2;
      y += slotH(it) + gap;
    });
  }

  function textPose(it, t) {
    const u = t / it.life;
    let s = 1;
    let dy = 0;
    let a = 1;
    let rot = 0;
    switch (it.kind) {
      case 'banner':
        s = popCurve(t, 0.3, 1.22);
        dy = -it.rise * ease.outQuad(u);
        a = u > 0.78 ? 1 - (u - 0.78) / 0.22 : 1;
        if (u > 0.78) s *= 1 + (u - 0.78) * 0.4;
        break;
      case 'popup':
        s = popCurve(t, 0.2, 1.14);
        dy = -it.rise * ease.outCubic(u);
        a = u > 0.62 ? 1 - (u - 0.62) / 0.38 : 1;
        break;
      case 'perfect':
        s = popCurve(t, 0.32, 1.3);
        rot = (1 - clamp01(t / 0.32)) * -0.14;
        a = u > 0.75 ? 1 - (u - 0.75) / 0.25 : 1;
        break;
      default: // praise, toast
        s = popCurve(t, 0.26, 1.18);
        dy = -it.rise * ease.outQuad(u);
        a = u > 0.72 ? 1 - (u - 0.72) / 0.28 : 1;
    }
    return { s: s * it.fit, dy, a, rot };
  }

  // ---------------------------------------------------------------- move effects
  /**
   * Starts every effect of one placement.
   * @param {object} res MoveResult from game.place()
   * @param {{ layout: object, rect: { x: number, y: number }, passedBest: boolean }} info
   *   rect = where the dragged piece was released (CSS px, top-left)
   */
  function onMove(res, info) {
    layout = info.layout;
    const t0 = now();
    const L = layout;
    const { inner, cell } = L.board;
    const id = res.color;
    const clearedSet = new Set(res.cleared.map((c) => c.r * N + c.c));

    // settle: the cells that stay on the board slide into place and squash 1.08 → 1
    if (settle) settle.cells.forEach(({ r, c }) => { hidden[r * N + c] = 0; });
    const remain = res.placed.filter(({ r, c }) => !clearedSet.has(r * N + c));
    const px = inner.x + res.col * cell;
    const py = inner.y + res.row * cell;
    const minR = Math.min(...res.placed.map((p) => p.r));
    const maxR = Math.max(...res.placed.map((p) => p.r));
    const minC = Math.min(...res.placed.map((p) => p.c));
    const maxC = Math.max(...res.placed.map((p) => p.c));
    const pcx = inner.x + ((minC + maxC + 1) / 2) * cell;
    const pcy = inner.y + ((minR + maxR + 1) / 2) * cell;
    settle = {
      cells: remain, color: id, start: t0, cx: pcx, cy: pcy,
      dx: info.rect ? info.rect.x - px : 0, dy: info.rect ? info.rect.y - py : 0,
    };
    remain.forEach(({ r, c }) => { hidden[r * N + c] = 1; });
    // a puff of dust under the piece
    const dust = budget(6);
    for (let i = 0; i < dust; i++) {
      spawn({
        kind: 'spark', x: pcx + rand(-0.5, 0.5) * (maxC - minC + 1) * cell, y: inner.y + (maxR + 1) * cell - 2,
        vx: rand(-1.4, 1.4) * cell, vy: rand(-1.2, -0.3) * cell, drag: 5, size: cell * rand(0.06, 0.11),
        color: tint(id, 0.6), life: rand(0.25, 0.4), add: true, layer: 'fx',
      });
    }

    // stale texts of earlier moves make room
    texts.forEach((it) => {
      if (it.fadeFrom < 0) it.fadeFrom = t0;
    });

    const group = [];
    if (res.lines > 0) {
      // clear flash → staggered burst (outward from the piece)
      const cells = res.cleared.map(({ r, c }) => {
        let d = Infinity;
        res.placed.forEach((p) => { d = Math.min(d, Math.max(Math.abs(p.r - r), Math.abs(p.c - c))); });
        return { r, c, color: id, at: t0 + TIMING.clearFlash + d * TIMING.staggerPerCell, burst: false };
      });
      bursts.push({ start: t0, cells, cx: pcx, cy: pcy });
      const gain = res.lines >= 4 ? 0.62 : res.lines >= 2 ? 0.8 : 1;
      res.rows.forEach((r) => bands.push({ vertical: false, idx: r, color: id, start: t0 + 0.03, sparked: false, gain }));
      res.cols.forEach((c) => bands.push({ vertical: true, idx: c, color: id, start: t0 + 0.03, sparked: false, gain }));

      const big = res.lines >= 3 || res.allClear;
      if (big && !reduced()) flashStart = t0 + 0.05;
      if ((res.lines >= 4 || res.allClear) && !reduced()) {
        shake = { start: t0 + 0.05, amp: res.allClear || res.lines >= 5 ? 6 : 4.5, p1: Math.random() * TAU, p2: Math.random() * TAU };
      }
      if (big) neon.pulseUntil = t0 + TIMING.neonPulse;
      neon.lastBurst = t0;

      if (res.comboShown > 0) {
        const sp = textSprite.banner(res.comboShown, cell);
        group.push(makeText('banner', sp, t0, TIMING.bannerLife, {
          rise: cell * 0.12,
          onShow: (it) => sparkleBurst(it.x + it.sp.vw * 0.32, it.y, cell, Math.min(16, 5 + res.comboShown), ['#FFE26A', '#FFFFFF', '#FFC21A'], { layer: 'top', speed: 2.4 }),
        }));
      }
      const pts = res.points.clear + res.points.bonus;
      if (pts > 0) group.push(makeText('popup', textSprite.popup(pts, id, cell), t0 + TIMING.textDelay, TIMING.textLife, { rise: cell * 0.42 }));
      if (res.praise) {
        group.push(makeText('praise', textSprite.praise(res.praise, id, cell), t0 + TIMING.textDelay + 0.04, TIMING.textLife, {
          rise: cell * 0.12,
          onShow: (it) => sparkleBurst(it.x, it.y, cell, res.allClear ? 16 : 8, [faceColor(id), '#FFFFFF'], { layer: 'top', speed: 2.6 }),
        }));
      }
      if (res.perfect) {
        group.push(makeText('perfect', textSprite.perfect(cell), t0 + TIMING.perfectDelay, TIMING.textLife + 0.15, {
          rise: 0,
          onShow: (it) => confettiBurst(it.x, it.y, cell, PARTICLES.confetti),
        }));
      }
      if (res.allClear) {
        const size = L.board.innerSize;
        const bx = inner.x + size / 2;
        const by = inner.y + size / 2;
        cue(t0 + 0.16, () => {
          if (!reduced()) {
            spawn({ kind: 'wave', x: bx, y: by, size: cell * 1.2, size1: cell * 11, color: '#FFFFFF', life: 0.65, add: true, layer: 'top', fadeAt: 0.15, alpha: 0.85 });
          }
          const n = budget(PARTICLES.allClearStars);
          for (let i = 0; i < n; i++) {
            const x = inner.x + Math.random() * size;
            const y = inner.y + Math.random() * size;
            const ang = Math.atan2(y - by, x - bx);
            const sp = cell * rand(0.6, 2.2);
            spawn({
              kind: 'star', x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - cell * 0.6, drag: 1.4,
              size: cell * rand(0.3, 0.6), size1: 0, rot: Math.random() * TAU, vr: rand(-3, 3),
              color: pick(CONFETTI_COLORS), life: rand(0.7, 1.2), add: true, fadeAt: 0.4, twinkle: rand(10, 18),
              delay: rand(0, 0.35) * (Math.hypot(x - bx, y - by) / size), layer: 'top',
            });
          }
        });
      }
    }
    if (info.passedBest) {
      group.push(makeText('toast', textSprite.toast(cell), t0 + (group.length ? 0.58 : 0.12), TIMING.toastLife, {
        rise: cell * 0.1,
        onShow: (it) => sparkleBurst(it.x, it.y, cell * 1.2, 14, ['#FFFFFF', '#FF8AD0', '#FFE14A'], { layer: 'top', speed: 2.8 }),
      }));
    }
    if (group.length) {
      let ax;
      let ay;
      if (res.lines > 0) {
        const rows = res.rows.map((r) => inner.y + (r + 0.5) * cell);
        const cols = res.cols.map((c) => inner.x + (c + 0.5) * cell);
        ax = cols.length && !rows.length ? cols.reduce((s, v) => s + v, 0) / cols.length : inner.x + L.board.innerSize / 2;
        ay = rows.length ? rows.reduce((s, v) => s + v, 0) / rows.length : pcy;
        if (rows.length && cols.length) ax = pcx;
        if (res.allClear) {
          ax = inner.x + L.board.innerSize / 2;
          ay = inner.y + L.board.innerSize / 2;
        }
      } else {
        ax = inner.x + L.board.innerSize / 2;
        ay = inner.y + L.board.innerSize * 0.3;
      }
      placeGroup(group, { x: ax, y: ay });
      texts.push(...group);
    }
  }

  function updateBursts() {
    const t = now();
    const L = layout;
    if (!L) return;
    const { inner, cell } = L.board;
    for (const b of bursts) {
      for (const c of b.cells) {
        if (c.burst || t < c.at) continue;
        c.burst = true;
        const x = inner.x + (c.c + 0.5) * cell;
        const y = inner.y + (c.r + 0.5) * cell;
        let dx = x - b.cx;
        let dy = y - b.cy;
        const len = Math.hypot(dx, dy) || 1;
        dx /= len;
        dy /= len;
        const n = budget(PARTICLES.shardsPerCell);
        const face = faceColor(c.color);
        const light = tint(c.color, 0.45);
        const dark = tint(c.color, -0.3);
        for (let i = 0; i < n; i++) {
          const ang = Math.atan2(dy, dx) + rand(-1.1, 1.1);
          const sp = cell * rand(1.6, 4.4);
          const k = Math.random();
          spawn({
            kind: 'sq', x: x + rand(-0.28, 0.28) * cell, y: y + rand(-0.28, 0.28) * cell,
            vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - cell * rand(0.8, 2.2), g: cell * 9, drag: 1.6,
            size: cell * rand(0.15, 0.3), size1: cell * 0.05, rot: Math.random() * TAU, vr: rand(-10, 10),
            color: k < 0.55 ? face : k < 0.8 ? light : dark, color2: k < 0.55 ? light : null,
            life: TIMING.shardLife + Math.random() * TIMING.shardLifeVar, fadeAt: 0.45, layer: 'fx',
          });
        }
        spawn({
          kind: 'spark', x, y, size: cell * 0.9, size1: cell * 1.5, color: tint(c.color, 0.7),
          life: 0.16, add: true, alpha: 0.5, fadeAt: 0.1, layer: 'fx',
        });
      }
    }
    bursts = bursts.filter((b) => b.cells.some((c) => !c.burst || t < c.at + TIMING.burstShrink));
  }

  function updateBands() {
    const t = now();
    const L = layout;
    if (!L) return;
    const { inner, cell } = L.board;
    for (const b of bands) {
      if (b.sparked || t < b.start) continue;
      b.sparked = true;
      const n = budget(PARTICLES.sparksPerLine);
      const light = tint(b.color, 0.65);
      for (let i = 0; i < n; i++) {
        const along = Math.random() * N * cell;
        const across = (b.idx + 0.5 + rand(-0.38, 0.38)) * cell;
        spawn({
          kind: 'spark', x: inner.x + (b.vertical ? across : along), y: inner.y + (b.vertical ? along : across),
          vx: rand(-0.5, 0.5) * cell, vy: rand(-0.9, 0.2) * cell, drag: 1.5, size: cell * rand(0.07, 0.14),
          color: Math.random() < 0.3 ? '#FFFFFF' : light, life: rand(0.42, 0.72), add: true, twinkle: rand(18, 30),
          fadeAt: 0.5, delay: rand(0, 0.12), layer: 'fx',
        });
      }
    }
    const end = TIMING.bandIn + TIMING.bandHold + TIMING.bandOut;
    bands = bands.filter((b) => t - b.start < end);
  }

  function bandLevel(b, t) {
    const x = t - b.start;
    if (x < 0) return 0;
    if (x < TIMING.bandIn) return x / TIMING.bandIn;
    if (x < TIMING.bandIn + TIMING.bandHold) return 1;
    return Math.max(0, 1 - ease.inQuad((x - TIMING.bandIn - TIMING.bandHold) / TIMING.bandOut));
  }

  function updateTexts() {
    const t = now();
    for (const it of texts) {
      if (!it.shown && t >= it.start) {
        it.shown = true;
        if (it.onShow && it.fadeFrom < 0) it.onShow(it);
      }
    }
    texts = texts.filter((it) => t - it.start < it.life && !(it.fadeFrom >= 0 && t - it.fadeFrom > TIMING.staleTextFade));
  }

  // ---------------------------------------------------------------- neon frame
  function updateNeon(dt) {
    const t = now();
    const target = neon.combo || t < neon.pulseUntil ? 1 : 0;
    neon.level += (target - neon.level) * Math.min(1, dt * 7);
    if (Math.abs(target - neon.level) < 0.004) neon.level = target;
    if (layout && neon.level > 0.5 && neonAwake() && Math.random() < dt * 7) {
      const { x, y, size } = layout.board;
      const side = Math.floor(Math.random() * 4);
      const k = Math.random() * size;
      const px = side === 0 ? x + k : side === 1 ? x + size : side === 2 ? x + k : x;
      const py = side === 0 ? y : side === 1 ? y + k : side === 2 ? y + size : y + k;
      spawn({
        kind: 'star', x: px, y: py, vx: rand(-8, 8), vy: rand(-14, -4), size: rand(7, 12), size1: 0,
        rot: Math.random() * TAU, vr: rand(-2, 2), color: COLORS.neon, life: rand(0.5, 0.9), add: true, layer: 'fx',
      });
    }
  }

  function neonAwake() {
    return now() - neon.lastBurst < TIMING.neonIdleFreeze || now() < neon.pulseUntil;
  }

  function boardAlpha() {
    if (!gameOver || now() < gameOver.fadeStart) return 1;
    return clamp01(1 - (now() - gameOver.fadeStart) / TIMING.boardFade);
  }

  function noSpaceLevel() {
    if (!gameOver) return 0;
    const x = now() - gameOver.start;
    if (x < 0) return 0;
    return clamp01(x / 0.2) * boardAlpha();
  }

  // Remaining tray pieces dim under the band, then fade out with the board.
  function trayAlpha() {
    if (!gameOver) return 1;
    const x = now() - gameOver.start;
    if (x < 0) return 1;
    return (1 - 0.58 * clamp01(x / 0.2)) * boardAlpha();
  }

  // ---------------------------------------------------------------- public API
  return {
    ease,
    cue,
    onMove,

    /** Advances everything by dt (the clock itself is advanced by the app). */
    update(dt) {
      runCues();
      updateBursts();
      updateBands();
      updateTexts();
      updateNeon(dt);
      stepParticles(dt);
      if (settle && now() - settle.start >= TIMING.settle) {
        settle.cells.forEach(({ r, c }) => { hidden[r * N + c] = 0; });
        settle = null;
      }
      for (let i = 0; i < 3; i++) {
        if (trayPop[i] >= 0 && now() - trayPop[i] >= TIMING.trayPop) trayPop[i] = -1;
        if (poofs[i] >= 0 && now() - poofs[i] >= TIMING.slotPoof) poofs[i] = -1;
      }
    },

    /** True while anything is still moving (the loop may sleep otherwise). */
    busy() {
      const t = now();
      return P.length > 0 || bursts.length > 0 || bands.length > 0 || texts.length > 0 || cues.length > 0 ||
        settle !== null || (flashStart >= 0 && t - flashStart < TIMING.bgFlash) ||
        (shake.start >= 0 && t - shake.start < TIMING.shake) ||
        (neon.level > 0 && neon.level < 1) || (neon.level > 0 && neonAwake()) ||
        trayPop.some((v) => v >= 0) || poofs.some((v) => v >= 0) ||
        (gameOver !== null && t < gameOver.end + 0.05);
    },

    /** Drops every effect (new game / layout change). */
    reset() {
      P.forEach((p) => pool.push(p));
      P.length = 0;
      bursts = [];
      bands = [];
      texts = [];
      cues = [];
      settle = null;
      hidden.fill(0);
      flashStart = -1;
      shake.start = -1;
      neon.pulseUntil = -1;
      neon.combo = false;
      gameOver = null;
      trayPop.fill(-1);
      poofs.fill(-1);
    },

    /** The layout effects are drawn against (set on every relayout). */
    setLayout(L) {
      layout = L;
    },

    /** Neon frame on while a combo is alive (streak ≥ 2). */
    setCombo(on) {
      if (on && !neon.combo) neon.lastBurst = now();
      neon.combo = !!on;
    },

    /** New tray: slots pop in (0 → 1.08 → 1) starting at `at`, 60 ms apart, with a few sparkles each. */
    dealTray(at, onStart) {
      for (let i = 0; i < 3; i++) trayPop[i] = at + i * TIMING.trayStagger;
      cue(at, () => {
        if (onStart) onStart();
        if (!layout) return;
        layout.tray.slots.forEach((s, i) => {
          sparkleBurst(s.cx, s.cy, layout.tray.cell * 2.2, PARTICLES.traySparkles, CONFETTI_COLORS,
            { speed: 2.2, life: 0.8, layer: 'fx', delay: i * TIMING.trayStagger });
        });
      });
    },

    /** Scale of a tray slot's piece (pop-in). */
    trayScale(slot) {
      const s = trayPop[slot];
      if (s < 0) return 1;
      return popCurve(now() - s, TIMING.trayPop, 1.08);
    },

    /** The slot whose piece was just placed shows its placeholder for a moment. */
    slotPoof(slot) {
      poofs[slot] = now();
    },

    /** Placeholder alpha for a slot that was just emptied (0 when none). */
    poofAlpha(slot) {
      const s = poofs[slot];
      return s < 0 ? 0 : clamp01(1 - (now() - s) / TIMING.slotPoof);
    },

    /** Spawns sparkles along the lines a hovering piece would complete. */
    preview(dt, lines, colorId) {
      if (!layout || !lines || (!lines.rows.length && !lines.cols.length)) {
        previewAcc = 0;
        return;
      }
      const { inner, cell } = layout.board;
      const count = lines.rows.length + lines.cols.length;
      previewAcc += dt * PARTICLES.previewRate * count * (reduced() ? PARTICLES.reducedFactor : 1);
      const light = tint(colorId, 0.7);
      while (previewAcc >= 1) {
        previewAcc -= 1;
        const k = Math.floor(Math.random() * count);
        const vertical = k >= lines.rows.length;
        const idx = vertical ? lines.cols[k - lines.rows.length] : lines.rows[k];
        const along = Math.random() * N * cell;
        const across = (idx + 0.5 + rand(-0.42, 0.42)) * cell;
        spawn({
          kind: Math.random() < 0.35 ? 'star' : 'spark',
          x: inner.x + (vertical ? across : along), y: inner.y + (vertical ? along : across),
          vx: rand(-0.2, 0.2) * cell, vy: rand(-0.7, -0.2) * cell, size: cell * rand(0.08, 0.16), size1: 0,
          color: Math.random() < 0.4 ? '#FFFFFF' : light, life: rand(0.35, 0.6), add: true, twinkle: 24, layer: 'fx',
        });
      }
    },

    /** Background flash level 0..1. */
    flashLevel() {
      if (flashStart < 0) return 0;
      const x = now() - flashStart;
      if (x < 0 || x >= TIMING.bgFlash) return 0;
      if (x < 0.08) return x / 0.08;
      if (x < 0.26) return 1;
      return 1 - ease.inOutQuad((x - 0.26) / (TIMING.bgFlash - 0.26));
    },

    /** Screen-shake offset in CSS px. */
    shakeOffset() {
      if (shake.start < 0) return [0, 0];
      const x = now() - shake.start;
      if (x < 0 || x >= TIMING.shake) return [0, 0];
      const k = Math.pow(1 - x / TIMING.shake, 2) * shake.amp;
      return [k * Math.sin(x * 95 + shake.p1), k * Math.cos(x * 81 + shake.p2)];
    },

    /** Neon frame intensity 0..1. */
    neonLevel() {
      return neon.level;
    },

    /** Cells hidden from the static board draw (they are being animated). */
    hidden,

    /** Board-cell alpha (game-over fade). */
    boardAlpha,

    /** "No Space Left" band / tray dim level 0..1. */
    noSpaceLevel,

    /** Alpha of the remaining tray pieces (dimmed during the game-over sequence). */
    trayAlpha,

    /**
     * Game-over visuals starting at `at`: band + dim, fill sweep bottom → top, fade. Returns when the result
     * screen should appear.
     * @param {Uint8Array} board
     * @param {number} at
     * @returns {{ resultAt: number }}
     */
    startGameOver(board, at) {
      const sweepStart = at + TIMING.noSpace * 0.85;
      const row = TIMING.sweep / N;
      const cells = [];
      for (let i = 0; i < N * N; i++) {
        if (board[i]) continue;
        const r = Math.floor(i / N);
        cells.push({ i, color: 1 + Math.floor(Math.random() * 7), at: sweepStart + (N - 1 - r) * row + Math.random() * 0.025 });
      }
      const fadeStart = sweepStart + TIMING.sweep + TIMING.sweepHold;
      gameOver = { start: at, cells, fadeStart, end: fadeStart + TIMING.boardFade };
      return { resultAt: gameOver.end };
    },

    /** Restart wipe: every block bursts into shards, rippling out from the center. */
    wipe(board) {
      const t0 = now();
      const cells = [];
      for (let i = 0; i < N * N; i++) {
        if (!board[i]) continue;
        const r = Math.floor(i / N);
        const c = i % N;
        const d = Math.max(Math.abs(r - 3.5), Math.abs(c - 3.5));
        cells.push({ r, c, color: board[i], at: t0 + 0.03 + d * 0.035, burst: false });
      }
      if (cells.length && layout) {
        const { inner, innerSize } = layout.board;
        bursts.push({ start: t0, cells, cx: inner.x + innerSize / 2, cy: inner.y + innerSize / 2 });
      }
    },

    // ---------------------------------------------------------------- drawing
    /** Neon glow around the board frame (drawn right after the frame). */
    drawNeon(ctx, L) {
      if (neon.level <= 0.01) return;
      const b = L.board;
      const n = sprites.neon(b.size, b.size, b.radius);
      const pulse = neonAwake() ? 0.82 + 0.18 * Math.sin(now() * 6.2) : 1;
      ctx.globalAlpha = neon.level * pulse;
      ctx.drawImage(n.canvas, b.x - n.m, b.y - n.m, b.size + 2 * n.m, b.size + 2 * n.m);
      ctx.globalAlpha = 1;
    },

    /** Settling piece, flashing/bursting cleared blocks, glow bands, fill sweep. */
    drawBoard(ctx, L) {
      const t = now();
      const { inner, cell } = L.board;
      // glow bands (additive, under the bursting blocks), kept inside the board frame
      if (bands.length) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(L.board.x, L.board.y, L.board.size, L.board.size);
        ctx.clip();
        for (const b of bands) {
          const lv = bandLevel(b, t);
          if (lv <= 0) continue;
          const span = N * cell;
          const thick = cell * 2.3;
          const off = (b.idx + 0.5) * cell - thick / 2;
          ctx.globalAlpha = lv * 0.42;
          ctx.fillStyle = faceColor(b.color);
          if (b.vertical) ctx.fillRect(inner.x + b.idx * cell, inner.y, cell, span);
          else ctx.fillRect(inner.x, inner.y + b.idx * cell, span, cell);
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = lv * 0.9 * b.gain;
          const strip = sprites.strip(b.color, b.vertical);
          if (b.vertical) ctx.drawImage(strip, inner.x + off, inner.y - cell * 0.2, thick, span + cell * 0.4);
          else ctx.drawImage(strip, inner.x - cell * 0.2, inner.y + off, span + cell * 0.4, thick);
          ctx.globalCompositeOperation = 'source-over';
        }
        ctx.restore();
        ctx.globalAlpha = 1;
      }
      // bursting blocks
      for (const b of bursts) {
        for (const c of b.cells) {
          const x = inner.x + c.c * cell;
          const y = inner.y + c.r * cell;
          const bmp = sprites.block(c.color, cell);
          if (t < c.at) {
            const e = t - b.start;
            const fl = e < 0.05 ? e / 0.05 : Math.max(0, 1 - (e - 0.05) / 0.14);
            const sc = 1 + 0.06 * fl;
            const s = cell * sc;
            ctx.drawImage(bmp, x + (cell - s) / 2, y + (cell - s) / 2, s, s);
            if (fl > 0) {
              ctx.globalAlpha = fl * 0.55;
              ctx.fillStyle = '#FFFFFF';
              ctx.fillRect(x + (cell - s) / 2, y + (cell - s) / 2, s, s);
              ctx.globalAlpha = 1;
            }
          } else if (t < c.at + TIMING.burstShrink) {
            const k = (t - c.at) / TIMING.burstShrink;
            const s = cell * (1 - 0.65 * k);
            ctx.globalAlpha = 1 - k;
            ctx.drawImage(bmp, x + (cell - s) / 2, y + (cell - s) / 2, s, s);
            ctx.globalAlpha = 1;
          }
        }
      }
      // settling piece
      if (settle) {
        const k = clamp01((t - settle.start) / TIMING.settle);
        const slide = 1 - ease.outCubic(clamp01((t - settle.start) / (TIMING.settle * 0.7)));
        const sc = TIMING.settleScale - (TIMING.settleScale - 1) * ease.outQuad(k);
        const bmp = sprites.block(settle.color, cell);
        const s = cell * sc;
        for (const { r, c } of settle.cells) {
          const x = inner.x + c * cell + settle.dx * slide;
          const y = inner.y + r * cell + settle.dy * slide;
          const cx = settle.cx + (x + cell / 2 - settle.cx) * sc;
          const cy = settle.cy + (y + cell / 2 - settle.cy) * sc;
          ctx.drawImage(bmp, cx - s / 2, cy - s / 2, s, s);
        }
        if (k < 1) {
          ctx.globalAlpha = 0.32 * (1 - k);
          ctx.fillStyle = '#FFFFFF';
          for (const { r, c } of settle.cells) {
            const x = inner.x + c * cell + settle.dx * slide;
            const y = inner.y + r * cell + settle.dy * slide;
            const cx = settle.cx + (x + cell / 2 - settle.cx) * sc;
            const cy = settle.cy + (y + cell / 2 - settle.cy) * sc;
            ctx.fillRect(cx - s / 2, cy - s / 2, s, s);
          }
          ctx.globalAlpha = 1;
        }
      }
      // game-over fill sweep
      if (gameOver) {
        const fade = boardAlpha();
        for (const c of gameOver.cells) {
          if (t < c.at) continue;
          const sc = popCurve(t - c.at, 0.13, 1.1);
          const s = cell * sc;
          const x = inner.x + (c.i % N) * cell;
          const y = inner.y + Math.floor(c.i / N) * cell;
          ctx.globalAlpha = fade;
          ctx.drawImage(sprites.block(c.color, cell), x + (cell - s) / 2, y + (cell - s) / 2, s, s);
        }
        ctx.globalAlpha = 1;
      }
    },

    /** Shards, sparks, preview sparkles (above the tray, below texts). */
    drawFx(ctx, base) {
      drawParticles(ctx, 'fx', base);
    },

    /**
     * "No Space Left": `part` 'band' (dark band across the tray, drawn under the dimmed pieces) or 'text'.
     */
    drawNoSpace(ctx, L, part) {
      const lv = noSpaceLevel();
      if (lv <= 0) return;
      const { tray, board } = L;
      const h = Math.min(tray.h * 0.62, board.cell * 2.9);
      const cy = tray.y + tray.h / 2;
      const x0 = L.mode === 'portrait' ? -20 : tray.x - 12;
      const w = L.mode === 'portrait' ? L.width + 40 : tray.w + 24;
      const k = ease.outCubic(clamp01((now() - gameOver.start) / 0.28));
      ctx.globalAlpha = lv;
      if (part === 'band') {
        const bh = h * (0.5 + 0.5 * k);
        ctx.fillStyle = COLORS.bandDark;
        ctx.fillRect(x0, cy - bh / 2, w, bh);
        ctx.fillStyle = COLORS.bandLine;
        ctx.fillRect(x0, cy - bh / 2, w, 1);
        ctx.fillRect(x0, cy + bh / 2 - 1, w, 1);
      } else {
        const sp = textSprite.noSpace(board.cell);
        const tx = L.mode === 'portrait' ? board.x + board.size / 2 : tray.x + tray.w / 2;
        const s = Math.min(1, (w - 16) / sp.vw) * (0.85 + 0.15 * k);
        ctx.drawImage(sp.canvas, tx - (sp.w * s) / 2, cy - sp.vy * s, sp.w * s, sp.h * s);
      }
      ctx.globalAlpha = 1;
    },

    /** Combo banners, popups, praise, Perfect!, toasts. */
    drawTexts(ctx, base) {
      if (!texts.length) return;
      const t = now();
      const { dpr, sx, sy } = base;
      for (const it of texts) {
        const e = t - it.start;
        if (e < 0) continue;
        const pose = textPose(it, e);
        let a = pose.a;
        if (it.fadeFrom >= 0) a *= clamp01(1 - (t - it.fadeFrom) / TIMING.staleTextFade);
        if (a <= 0.01 || pose.s <= 0.01) continue;
        const cos = Math.cos(pose.rot) * pose.s * dpr;
        const sin = Math.sin(pose.rot) * pose.s * dpr;
        ctx.setTransform(cos, sin, -sin, cos, (it.x + sx) * dpr, (it.y + pose.dy + sy) * dpr);
        ctx.globalAlpha = Math.min(1, a);
        ctx.drawImage(it.sp.canvas, -it.sp.w / 2, -it.sp.vy, it.sp.w, it.sp.h);
      }
      ctx.globalAlpha = 1;
      ctx.setTransform(dpr, 0, 0, dpr, sx * dpr, sy * dpr);
    },

    /** Confetti and celebration sparkles (above everything). */
    drawTop(ctx, base) {
      drawParticles(ctx, 'top', base);
    },

    /** Debug/test counters. */
    stats() {
      return { particles: P.length, texts: texts.length, bursts: bursts.length, bands: bands.length, cues: cues.length, neon: neon.level };
    },
  };
}
