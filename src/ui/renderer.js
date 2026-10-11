// Composes one frame on the single full-screen canvas: background (+flash) → shaken scene (board frame,
// neon, blocks with clear preview, board effects, ghost, tray, "No Space Left", shards, texts, held piece)
// → HUD → confetti. Static parts (board frame + grid) are cached per layout; blocks are sprites.
import { COLORS, TIMING, font } from './theme.js';
import { roundRectPath, tint, drawGem } from './sprites.js';
import { trayPieceRect } from './layout.js';
import { getShape } from '../core/shapes.js';

const N = 8;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * @param {HTMLCanvasElement} canvas
 * @param {object} sprites from createSprites()
 */
export function createRenderer(canvas, sprites) {
  const ctx = canvas.getContext('2d');
  let L = null;
  let bgGrad = null;
  let backgroundLayer = null;
  let boardLayer = null;
  const recolor = new Uint8Array(N * N);

  function renderBoardLayer() {
    const b = L.board;
    const m = 16;
    const dpr = L.dpr;
    const c = document.createElement('canvas');
    c.width = Math.ceil((b.size + 2 * m) * dpr);
    c.height = Math.ceil((b.size + 2 * m) * dpr);
    const g = c.getContext('2d');
    g.scale(dpr, dpr);
    // soft drop shadow under the frame
    g.save();
    g.shadowColor = 'rgba(139,93,246,0.5)';
    g.shadowBlur = 12 * dpr;
    g.shadowOffsetY = 2 * dpr;
    g.beginPath();
    roundRectPath(g, m, m, b.size, b.size, b.radius);
    g.fillStyle = COLORS.frame;
    g.fill();
    g.restore();
    // lighter rim
    g.beginPath();
    roundRectPath(g, m + 0.75, m + 0.75, b.size - 1.5, b.size - 1.5, b.radius);
    const rim = g.createLinearGradient(m, m, m + b.size, m + b.size);
    rim.addColorStop(0, COLORS.frameRim);
    rim.addColorStop(.5, '#898FE3');
    rim.addColorStop(1, '#EA79C4');
    g.strokeStyle = rim;
    g.lineWidth = 1.5;
    g.stroke();
    // empty cells over thin grid lines
    const ix = m + b.pad;
    const iy = m + b.pad;
    g.save();
    g.beginPath();
    roundRectPath(g, m + 2, m + 2, b.size - 4, b.size - 4, b.radius - 2);
    g.clip();
    g.fillStyle = COLORS.frameShade;
    g.fillRect(ix - 1, iy - 1, b.innerSize + 2, b.innerSize + 2);
    g.fillStyle = COLORS.grid;
    g.fillRect(ix, iy, b.innerSize, b.innerSize);
    g.fillStyle = COLORS.cell;
    const gl = Math.max(1.5, b.cell * 0.065);
    for (let r = 0; r < N; r++) {
      for (let col = 0; col < N; col++) {
        g.beginPath();
        roundRectPath(g, ix + col * b.cell + gl, iy + r * b.cell + gl, b.cell - 2 * gl, b.cell - 2 * gl, b.cell * .16);
        g.fill();
        g.strokeStyle = COLORS.cellRim;
        g.lineWidth = .75;
        g.stroke();
      }
    }
    g.restore();
    return { canvas: c, m };
  }

  function placeholder(slot, alpha, t) {
    const s = L.tray.slots[slot];
    const size = Math.max(10, L.tray.cell * 1.5);
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = COLORS.slotOutline;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    roundRectPath(ctx, s.cx - size / 2, s.cy - size / 2, size, size, size * 0.18);
    ctx.stroke();
    const dots = ['#FFE14A', '#38D0FF', '#FF8AD0'];
    for (let i = 0; i < 3; i++) {
      const a = t * 2.2 + (i * Math.PI * 2) / 3;
      const r = size * 0.78;
      const d = Math.max(2, size * 0.1) * (0.7 + 0.3 * Math.sin(t * 7 + i * 2));
      ctx.fillStyle = dots[i];
      ctx.fillRect(s.cx + Math.cos(a) * r - d / 2, s.cy + Math.sin(a) * r * 0.75 - d / 2, d, d);
    }
    ctx.globalAlpha = 1;
  }

  function drawPiece(piece, shape, rect, kind) {
    const cell = kind === 'tray' ? L.tray.cell : L.board.cell;
    const pc = sprites.piece(piece.shapeId, piece.color, cell, kind);
    const k = rect.w / (shape.w * cell);
    ctx.drawImage(pc.canvas, rect.x + pc.ox * k, rect.y + pc.oy * k, pc.w * k, pc.h * k);
    if (piece.gem >= 0) {
      const [r, c] = shape.cells[piece.gem];
      drawGem(ctx, rect.x + c * cell * k, rect.y + r * cell * k, cell * k);
    }
  }

  function paw(x, y, size, angle) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = COLORS.paw;
    ctx.beginPath();
    ctx.ellipse(0, size * .16, size * .24, size * .2, 0, 0, Math.PI * 2);
    ctx.fill();
    for (const [dx, dy] of [[-.29, -.1], [-.12, -.3], [.12, -.3], [.29, -.1]]) {
      ctx.beginPath();
      ctx.ellipse(dx * size, dy * size, size * .09, size * .12, dx, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  return {
    /** Applies a new layout: backing store = round(css × dpr), static layers rebuilt. */
    resize(layout) {
      L = layout;
      const W = Math.max(1, Math.round(L.width * L.dpr));
      const H = Math.max(1, Math.round(L.height * L.dpr));
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W;
        canvas.height = H;
      }
      sprites.setDpr(L.dpr);
      sprites.resetLayoutCaches();
      ctx.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
      bgGrad = ctx.createLinearGradient(0, 0, 0, L.height);
      bgGrad.addColorStop(0, COLORS.bgTop);
      bgGrad.addColorStop(1, COLORS.bgBottom);
      if (backgroundLayer) {
        backgroundLayer.width = 0;
        backgroundLayer.height = 0;
      }
      // Cache ambient light and stars so the idle scene needs no continuous animation.
      backgroundLayer = document.createElement('canvas');
      backgroundLayer.width = W;
      backgroundLayer.height = H;
      const bg = backgroundLayer.getContext('2d');
      bg.scale(L.dpr, L.dpr);
      bg.fillStyle = bgGrad;
      bg.fillRect(0, 0, L.width, L.height);
      for (const [x, y, color] of [[.05, .25, 'rgba(67,185,208,.12)'], [.95, .7, 'rgba(190,70,184,.14)']]) {
        const radius = Math.max(L.width * .45, L.height * .4);
        const light = bg.createRadialGradient(L.width * x, L.height * y, 0, L.width * x, L.height * y, radius);
        light.addColorStop(0, color);
        light.addColorStop(1, 'rgba(0,0,0,0)');
        bg.fillStyle = light;
        bg.fillRect(0, 0, L.width, L.height);
      }
      for (let i = 0; i < 32; i++) {
        const x = ((i * 73 + 19) % 997) / 997 * L.width;
        const y = ((i * 137 + 31) % 991) / 991 * L.height;
        bg.fillStyle = i % 3 ? 'rgba(164,197,239,.22)' : 'rgba(255,156,212,.28)';
        bg.beginPath();
        bg.arc(x, y, i % 3 ? .65 : 1.1, 0, Math.PI * 2);
        bg.fill();
      }
      if (boardLayer) {
        boardLayer.canvas.width = 0;
        boardLayer.canvas.height = 0;
      }
      boardLayer = renderBoardLayer();
    },

    /**
     * Draws a frame.
     * @param {{ game: object, fx: object, hud: object, input: object, clock: { now: number } }} s
     */
    draw(s) {
      if (!L) return;
      const { game, fx, hud, input } = s;
      const t = s.clock.now;
      const dpr = L.dpr;
      const b = L.board;
      const { inner, cell } = b;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(backgroundLayer, 0, 0, L.width, L.height);
      paw(L.width * .08, L.height * .18, 65, -.4);
      paw(L.width * .94, L.height * .69, 74, .35);
      paw(L.width * .14, L.height * .92, 48, -.55);
      const flash = fx.flashLevel();
      if (flash > 0) {
        ctx.globalAlpha = flash * 0.92;
        ctx.fillStyle = COLORS.flash;
        ctx.fillRect(0, 0, L.width, L.height);
        ctx.globalAlpha = 1;
      }

      const [sx, sy] = fx.shakeOffset();
      ctx.setTransform(dpr, 0, 0, dpr, sx * dpr, sy * dpr);
      const base = { dpr, sx, sy };

      // board frame + neon
      ctx.drawImage(boardLayer.canvas, b.x - boardLayer.m, b.y - boardLayer.m, b.size + 2 * boardLayer.m, b.size + 2 * boardLayer.m);
      fx.drawNeon(ctx, L);
      if (flash > 0) {
        ctx.globalAlpha = flash * 0.4;
        ctx.fillStyle = COLORS.flashBoard;
        ctx.fillRect(inner.x, inner.y, b.innerSize, b.innerSize);
        ctx.globalAlpha = 1;
      }

      // clear preview: lines a hovering piece would complete take the piece's color and pulse
      const drag = input.drag;
      const pv = drag && drag.preview && (drag.preview.rows.length || drag.preview.cols.length) ? drag.preview : null;
      recolor.fill(0);
      const pulse = 0.5 + 0.5 * Math.sin(t * 9.5);
      if (pv) {
        pv.rows.forEach((r) => { for (let c = 0; c < N; c++) recolor[r * N + c] = 1; });
        pv.cols.forEach((c) => { for (let r = 0; r < N; r++) recolor[r * N + c] = 1; });
        ctx.save();
        ctx.beginPath();
        ctx.rect(b.x, b.y, b.size, b.size);
        ctx.clip();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.3 + 0.28 * pulse;
        pv.rows.forEach((r) => ctx.drawImage(sprites.strip(drag.piece.color, false), b.x, inner.y + (r - 0.45) * cell, b.size, cell * 1.9));
        pv.cols.forEach((c) => ctx.drawImage(sprites.strip(drag.piece.color, true), inner.x + (c - 0.45) * cell, b.y, cell * 1.9, b.size));
        ctx.restore();
      }

      // placed blocks
      const board = game.board;
      const alpha = fx.boardAlpha();
      ctx.globalAlpha = alpha;
      for (let i = 0; i < N * N; i++) {
        const v = board[i];
        if (!v || fx.hidden[i]) continue;
        const color = recolor[i] ? drag.piece.color : v;
        ctx.drawImage(sprites.block(color, cell), inner.x + (i % N) * cell, inner.y + Math.floor(i / N) * cell, cell, cell);
        if (game.gems[i]) drawGem(ctx, inner.x + (i % N) * cell, inner.y + Math.floor(i / N) * cell, cell);
      }
      ctx.globalAlpha = 1;
      if (pv) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.1 + 0.2 * pulse;
        ctx.fillStyle = tint(drag.piece.color, 0.55);
        for (let i = 0; i < N * N; i++) {
          if (recolor[i] && board[i]) ctx.fillRect(inner.x + (i % N) * cell, inner.y + Math.floor(i / N) * cell, cell, cell);
        }
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
      }

      fx.drawBoard(ctx, L);

      // ghost of the snapped placement
      if (drag && drag.target && drag.preview) {
        const a = clamp01((t - drag.targetAt) / TIMING.ghostFade);
        const k = 1 + 0.06 * (1 - a);
        const gx = inner.x + (drag.target.col + drag.shape.w / 2) * cell;
        const gy = inner.y + (drag.target.row + drag.shape.h / 2) * cell;
        const lw = 2;
        ctx.setTransform(dpr * k, 0, 0, dpr * k, (gx * (1 - k) + sx) * dpr, (gy * (1 - k) + sy) * dpr);
        ctx.globalAlpha = a;
        ctx.fillStyle = COLORS.ghostFill;
        for (const { r, c } of drag.preview.cells) ctx.fillRect(inner.x + c * cell, inner.y + r * cell, cell, cell);
        ctx.strokeStyle = COLORS.ghostLine;
        ctx.lineWidth = lw;
        for (const { r, c } of drag.preview.cells) {
          ctx.strokeRect(inner.x + c * cell + lw / 2 + 0.5, inner.y + r * cell + lw / 2 + 0.5, cell - lw - 1, cell - lw - 1);
        }
        ctx.globalAlpha = 1;
        ctx.setTransform(dpr, 0, 0, dpr, sx * dpr, sy * dpr);
      }

      // tray (under "No Space Left" the pieces sit dimmed on the dark band)
      const returning = input.returning();
      const trayAlpha = fx.trayAlpha();
      ctx.beginPath();
      roundRectPath(ctx, L.tray.x, L.tray.y + 3, L.tray.w, L.tray.h - 6, 24);
      ctx.fillStyle = COLORS.trayFill;
      ctx.fill();
      ctx.strokeStyle = COLORS.trayRim;
      ctx.lineWidth = 1;
      ctx.stroke();
      fx.drawNoSpace(ctx, L, 'band');
      for (let slot = 0; slot < 3; slot++) {
        if (drag && drag.slot === slot) {
          placeholder(slot, 1, t);
          continue;
        }
        if (returning.some((r) => r.slot === slot)) continue;
        const piece = game.hand[slot];
        if (!piece) {
          const pa = fx.poofAlpha(slot);
          if (pa > 0) placeholder(slot, pa, t);
          continue;
        }
        const sc = fx.trayScale(slot);
        if (sc <= 0.01) continue;
        const shape = getShape(piece.shapeId);
        const r = trayPieceRect(L, slot, shape);
        const cx = r.x + r.w / 2;
        const cy = r.y + r.h / 2;
        ctx.globalAlpha = trayAlpha;
        drawPiece({ ...piece, gem: game.handGems[slot] }, shape, { x: cx - (r.w * sc) / 2, y: cy - (r.h * sc) / 2, w: r.w * sc, h: r.h * sc }, 'tray');
        ctx.globalAlpha = 1;
      }
      fx.drawNoSpace(ctx, L, 'text');
      if (L.mode === 'portrait' && L.tray.h > 90) {
        ctx.font = font(800, Math.min(12, cell * .3));
        ctx.fillStyle = COLORS.muted;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Drag blocks · clear lines to collect kitty gems', L.tray.x + L.tray.w / 2, L.tray.y + L.tray.h - 15);
      }

      fx.drawFx(ctx, base);
      fx.drawTexts(ctx, base);

      // pieces in the air: flying back, then the held one on top
      for (const r of returning) drawPiece(r.piece, r.shape, r.rect, 'lift');
      if (drag) drawPiece(drag.piece, drag.shape, input.visualRect(), 'lift');

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      hud.draw(ctx, L, sprites);
      fx.drawTop(ctx, { dpr, sx: 0, sy: 0 });
      ctx.globalAlpha = 1;
    },

  };
}
