// Heads-up display drawn on the canvas: crown + best score (top-left), the big score with its count-up,
// bump and glowing cyan badge (center). The gear is a DOM button positioned from the layout.
import { COLORS, TIMING, font } from './theme.js';
import { popCurve } from './effects.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const outCubic = (t) => 1 - Math.pow(1 - t, 3);

/**
 * @param {{ clock: { now: number }, gear: HTMLElement | null }} deps
 */
export function createHud({ clock, gear }) {
  const st = {
    from: 0, to: 0, start: -1, dur: 0, shown: 0, bestAtStart: 0, badge: -9, bump: -9, bumpAmp: 0, crownPop: -9,
  };
  let bestGrad = null;
  let bestGradKey = '';

  const displayed = () => Math.floor(st.shown + 1e-6);

  return {
    /** Shows `score` immediately (new game / resume); `best` is the best score before this game. */
    reset(score, best) {
      st.from = score;
      st.to = score;
      st.shown = score;
      st.start = -1;
      st.bestAtStart = best;
      st.badge = -9;
      st.bump = -9;
      st.crownPop = -9;
    },

    /**
     * Points were added: count up from the shown value to `score` (0.8–1.6 s, ease-out, longer for bigger
     * gains), flash the badge and bump the digits.
     * @param {number} score new total
     * @param {number} gain points of this move
     */
    add(score, gain) {
      const t = clock.now;
      st.from = st.shown;
      st.to = score;
      st.start = t;
      st.dur = TIMING.countMin + (TIMING.countMax - TIMING.countMin) * clamp01((score - st.from - 5) / 200);
      st.badge = t;
      st.bump = t;
      st.bumpAmp = gain >= 100 ? 0.16 : gain >= 20 ? 0.11 : 0.06;
    },

    update() {
      if (st.start < 0) return;
      const k = clamp01((clock.now - st.start) / st.dur);
      const before = displayed();
      st.shown = st.from + (st.to - st.from) * outCubic(k);
      if (st.bestAtStart > 0 && before <= st.bestAtStart && displayed() > st.bestAtStart) st.crownPop = clock.now;
      if (k >= 1) {
        st.shown = st.to;
        st.start = -1;
      }
    },

    busy() {
      const t = clock.now;
      return st.start >= 0 || t - st.badge < TIMING.badge || t - st.bump < 0.4 || t - st.crownPop < 0.6;
    },

    /** Score currently displayed (mid count-up). */
    get shown() {
      return displayed();
    },

    /** Value next to the crown: the old best until the live score passes it. */
    get crownValue() {
      return Math.max(st.bestAtStart, displayed());
    },

    /** Moves the DOM gear button onto the layout's gear spot. */
    place(L) {
      if (!gear) return;
      const g = L.hud.gear;
      const hit = Math.max(44, g.size + 12);
      gear.style.width = `${hit}px`;
      gear.style.height = `${hit}px`;
      gear.style.left = `${Math.round(g.x - hit / 2)}px`;
      gear.style.top = `${Math.round(g.y - hit / 2)}px`;
      gear.style.setProperty('--icon', `${g.size}px`);
    },

    /** Draws crown + best and the score (with badge) in CSS px (ctx already scaled by dpr). */
    draw(ctx, L, sprites) {
      const t = clock.now;
      const { score, best } = L.hud;
      const dpr = L.dpr;
      ctx.font = font(900, Math.min(17, L.quests.w * .047));
      ctx.fillStyle = COLORS.label;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Meow Blocks', score.x, best.y);

      // badge: pops behind the score whenever points are added, glows, then fades
      const bt = t - st.badge;
      if (bt >= 0 && bt < TIMING.badge) {
        const size = Math.round(score.size * 1.22);
        const b = sprites.badge(size);
        const sc = popCurve(bt, 0.3, 1.2);
        const a = bt < TIMING.badge - 0.5 ? 1 : (TIMING.badge - bt) / 0.5;
        const cy = score.y - score.size * 0.06;
        ctx.globalAlpha = clamp01(a);
        ctx.drawImage(b.canvas, score.x - (b.w * sc) / 2, cy - (b.h * sc) / 2, b.w * sc, b.h * sc);
        if (bt < 0.4) {
          // a soft ring of light leaves the badge as it pops
          const k = bt / 0.4;
          const d = size * (0.9 + 1.6 * k);
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 0.45 * (1 - k);
          ctx.drawImage(sprites.ring(), score.x - d / 2, cy - d / 2, d, d);
          ctx.globalCompositeOperation = 'source-over';
        }
        ctx.globalAlpha = 1;
      }

      // score digits with a little bump
      const txt = String(displayed());
      const bu = t - st.bump;
      const bump = bu >= 0 && bu < 0.32 ? st.bumpAmp * (bu < 0.07 ? bu / 0.07 : 1 - outCubic((bu - 0.07) / 0.25)) : 0;
      const s = 1 + bump;
      ctx.setTransform(dpr * s, 0, 0, dpr * s, score.x * dpr, score.y * dpr);
      ctx.font = font(900, score.size);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.fillStyle = COLORS.scoreShadow;
      ctx.fillText(txt, 0, score.size * 0.075);
      ctx.strokeStyle = COLORS.scoreOutline;
      ctx.lineWidth = score.size * 0.07;
      ctx.strokeText(txt, 0, 0);
      ctx.fillStyle = COLORS.score;
      ctx.fillText(txt, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // crown + best
      const crown = sprites.crown(Math.round(best.size * 1.08));
      const ct = t - st.crownPop;
      const cs = ct >= 0 && ct < 0.6 ? 1 + 0.4 * Math.sin((ct / 0.6) * Math.PI) * (1 - ct / 0.6) : 1;
      const ccx = best.x - crown.m + crown.w / 2;
      const ccy = best.y - best.size * 0.04;
      ctx.drawImage(crown.canvas, ccx - (crown.w * cs) / 2, ccy - (crown.h * cs) / 2, crown.w * cs, crown.h * cs);
      const bx = best.x + crown.w - crown.m * 2 + best.size * 0.18;
      const bTxt = String(Math.max(st.bestAtStart, displayed()));
      ctx.font = font(900, best.size);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const key = `${best.y}:${best.size}`;
      if (key !== bestGradKey) {
        bestGrad = ctx.createLinearGradient(0, best.y - best.size * 0.4, 0, best.y + best.size * 0.4);
        bestGrad.addColorStop(0, '#FFF1BA');
        bestGrad.addColorStop(0.5, COLORS.best);
        bestGrad.addColorStop(1, COLORS.bestDeep);
        bestGradKey = key;
      }
      ctx.fillStyle = 'rgba(70,34,0,0.4)';
      ctx.fillText(bTxt, bx, best.y + best.size * 0.08);
      ctx.strokeStyle = COLORS.bestOutline;
      ctx.lineWidth = best.size * 0.12;
      ctx.strokeText(bTxt, bx, best.y);
      ctx.fillStyle = bestGrad;
      ctx.fillText(bTxt, bx, best.y);
    },
  };
}
