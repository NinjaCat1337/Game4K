// Every color, size and timing constant of the UI layer (classic navy skin). Times are in seconds,
// sizes in CSS px or as fractions of the board cell / usable height.

/** App version shown in the settings panel. */
export const APP_VERSION = '1.0';

/** Display font stack; Nunito 800/900 is self-hosted (css/style.css). */
export const FONT_FAMILY = "'Nunito', ui-rounded, 'Arial Rounded MT Bold', system-ui, sans-serif";

/**
 * Canvas font shorthand.
 * @param {number} weight 800 | 900
 * @param {number} px
 * @returns {string}
 */
export function font(weight, px) {
  return `${weight} ${Math.round(px * 10) / 10}px ${FONT_FAMILY}`;
}

/** Block face colors by color id (index 0 = empty). */
export const BLOCK_COLORS = Object.freeze([
  null,
  '#E2483F', // 1 red
  '#F26A1B', // 2 orange
  '#F5BE06', // 3 yellow
  '#2DBE3C', // 4 green
  '#16BFEA', // 5 cyan
  '#3A62EC', // 6 blue
  '#8E4EE2', // 7 purple
]);

/** Scene, HUD and effect colors of the classic skin. */
export const COLORS = Object.freeze({
  bgTop: '#3B4FA8',
  bgBottom: '#4A64BE',
  flash: '#2F7BE0',
  flashBoard: '#2456C8',
  frame: '#2A3E70',
  frameRim: '#4A63A6',
  frameShade: '#1F2F5A',
  cell: '#1E2648',
  grid: '#181E3E',
  neon: '#59D8FF',
  neonCore: '#DDF8FF',
  ghostFill: 'rgba(255,255,255,0.28)',
  ghostLine: 'rgba(255,255,255,0.82)',
  blockOutline: 'rgba(0,0,0,0.35)',
  trayShadow: 'rgba(12,18,60,0.42)',
  liftShadow: 'rgba(8,12,44,0.38)',
  slotOutline: 'rgba(190,215,255,0.34)',
  crownLight: '#FFE45C',
  crown: '#FCC00C',
  crownDark: '#E08E00',
  crownLine: '#8A4B00',
  best: '#FCD800',
  bestDeep: '#F5A800',
  bestOutline: '#8A5200',
  gear: '#B4D8F0',
  score: '#FFFFFF',
  scoreShadow: '#243C9C',
  badgeLight: '#B8F6FF',
  badge: '#3FD2FF',
  badgeDeep: '#1590E0',
  badgeGlow: 'rgba(80,220,255,0.9)',
  bandDark: 'rgba(16,22,58,0.74)',
  bandLine: 'rgba(255,255,255,0.10)',
});

/**
 * Colors of the DOM parts (gear, result screens), applied as CSS custom properties on #app at startup so
 * css/style.css takes them from here.
 */
export const CSS_VARS = Object.freeze({
  '--gear': COLORS.gear,
  '--best-top': '#5418A8',
  '--best-bottom': '#8454D8',
  '--best-title': '#FCB400',
  '--crown': '#FCCC0C',
  '--over-top': '#1848B4',
  '--over-bottom': '#1878CC',
  '--over-title': '#39B5FF',
  '--over-best': '#FCA818',
  '--play-best': '#F0A818',
  '--play-best-deep': '#E49C0C',
  '--play-over': '#30B418',
  '--play-over-deep': '#189C00',
});

/** Bubbly text styles: fill gradient stops (top → bottom), outline, shadow; sizes are × board cell. */
export const TEXT = Object.freeze({
  combo: { size: 0.86, fill: ['#FFFFFF', '#E8F8FF', '#9AD6FF'], stroke: '#15215E', skew: -0.2 },
  comboNum: { size: 1.26, fill: ['#FFF6A8', '#FFD028', '#F59000'], stroke: '#5A2600', skew: -0.2 },
  popup: { size: 0.74 },
  praise: { size: 0.88 },
  perfect: { size: 1.0, fill: ['#FFC4B4', '#FF7C74', '#E3203A'], stroke: '#FFFFFF', shadow: 'rgba(110,0,30,0.55)' },
  toast: { size: 0.72, fill: ['#FFFFFF', '#FFE0F4', '#FF8AD0'], stroke: '#6A1460' },
  noSpace: { size: 0.6, fill: ['#FFFFFF', '#F4F7FF', '#D8E2FF'] },
});

/** Layout proportions (spec §6). */
export const LAYOUT = Object.freeze({
  marginSide: 12,
  marginTop: 8,
  marginBottom: 12,
  maxColumn: 520,
  boardFrac: 0.89,
  boardMaxH: 0.5,
  bestY: 0.07,
  scoreY: 0.155,
  boardTop: 0.225,
  trayGap: 0.4,
  trayH: 4.4,
  trayScale: 0.47,
  framePadFrac: 0.012,
  scoreFrac: 0.054,
  scoreMin: 40,
  slotForgiveness: 8,
  sideMinCell: 34,
});

/** Durations and delays (spec §7). */
export const TIMING = Object.freeze({
  pickup: 0.09,
  pickupSettle: 0.07,
  liftCells: 1.5,
  upGain: 1.25,
  snapRadius: 0.75,
  settle: 0.11,
  settleScale: 1.08,
  returnToTray: 0.16,
  ghostFade: 0.07,
  clearFlash: 0.1,
  staggerPerCell: 0.024,
  burstShrink: 0.12,
  shardLife: 0.45,
  shardLifeVar: 0.15,
  bandIn: 0.07,
  bandHold: 0.16,
  bandOut: 0.42,
  bannerLife: 1.0,
  textDelay: 0.3,
  textLife: 1.0,
  perfectDelay: 0.42,
  toastLife: 1.7,
  staleTextFade: 0.14,
  bgFlash: 0.8,
  shake: 0.28,
  neonPulse: 1.3,
  neonIdleFreeze: 3,
  trayDelayClear: 0.12,
  trayDelayPlain: 0.04,
  trayPop: 0.25,
  trayStagger: 0.06,
  slotPoof: 0.32,
  countMin: 0.8,
  countMax: 1.6,
  badge: 1.15,
  gameOverDelay: 0.55,
  noSpace: 0.9,
  sweep: 0.5,
  sweepHold: 0.14,
  boardFade: 0.3,
  resultCount: 1.6,
  resultCountDelay: 0.55,
  playDelay: 0.4,
  clearSoundDelay: 0.05,
  dtMax: 0.05,
});

/** Particle budgets (halved-ish with prefers-reduced-motion). */
export const PARTICLES = Object.freeze({
  shardsPerCell: 5,
  sparksPerLine: 14,
  previewRate: 26,
  confetti: 46,
  allClearStars: 48,
  traySparkles: 7,
  max: 900,
  reducedFactor: 0.35,
});

/** Confetti palette (also used for sparkles). */
export const CONFETTI_COLORS = Object.freeze([
  '#FF5A6E', '#FFB020', '#FFE14A', '#4BE07A', '#38D0FF', '#5D7CFF', '#B57BFF', '#FF8AD0',
]);
