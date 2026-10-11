// Quests use their own seeded RNG, so decorations never affect the classic piece generator.
export const QUEST_TYPES = Object.freeze(['score', 'gems', 'lines', 'blocks']);

const TARGETS = Object.freeze({
  score: [60, 90, 120], gems: [2, 3, 4], lines: [2, 3, 4], blocks: [16, 24, 32],
});

function nextQuest(rng, completed, excluded) {
  const type = rng.pick(QUEST_TYPES.filter((t) => !excluded.includes(t)));
  const tier = Math.min(4, Math.floor(completed / 4));
  const target = rng.pick(TARGETS[type]) + tier * (type === 'score' ? 20 : type === 'blocks' ? 4 : 1);
  return { type, target, progress: 0 };
}

export function createQuests(rng) {
  const first = nextQuest(rng, 0, []);
  return { completed: 0, active: [first, nextQuest(rng, 0, [first.type])] };
}

/** Advance both current quests once. Replacement quests start with the next move. */
export function advanceQuests(state, gains, rng) {
  const finished = [];
  const active = state.active.map((q) => {
    const progress = Math.min(q.target, q.progress + gains[q.type]);
    if (progress === q.target) finished.push({ ...q, progress });
    return { ...q, progress };
  });
  const completed = state.completed + finished.length;
  for (let i = 0; i < active.length; i++) {
    if (active[i].progress < active[i].target) continue;
    // Avoid the just-completed type and the other slot, including its replacement.
    active[i] = nextQuest(rng, completed, [active[i].type, active[1 - i].type]);
  }
  return { state: { completed, active }, finished };
}

/** Validate and copy untrusted quest data from a v2 save. */
export function restoreQuests(value) {
  if (!value || !Number.isSafeInteger(value.completed) || value.completed < 0 ||
      !Array.isArray(value.active) || value.active.length !== 2) return null;
  const active = [];
  for (const q of value.active) {
    if (!q || !QUEST_TYPES.includes(q.type) || !Number.isSafeInteger(q.target) || q.target < 1 ||
        !Number.isSafeInteger(q.progress) || q.progress < 0 || q.progress >= q.target) return null;
    active.push({ type: q.type, target: q.target, progress: q.progress });
  }
  if (active[0].type === active[1].type) return null;
  return { completed: value.completed, active };
}

/** One jewel at most per piece, at least one per nonempty tray. Values index shape.cells. */
export function decorateHand(hand, rng, getShape) {
  const gems = hand.map((p) => p && rng.next() < 0.45 ? rng.int(getShape(p.shapeId).n) : -1);
  if (!gems.some((g) => g >= 0)) {
    const slots = hand.map((p, i) => p ? i : -1).filter((i) => i >= 0);
    if (slots.length) {
      const slot = rng.pick(slots);
      gems[slot] = rng.int(getShape(hand[slot].shapeId).n);
    }
  }
  return gems;
}
