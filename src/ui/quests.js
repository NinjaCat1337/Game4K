const COPY = {
  score: { title: 'Earn points', icon: '★', hint: 'Earn points with new moves' },
  gems: { title: 'Collect kitty gems', icon: '', hint: 'Clear lines containing cat gems to collect them' },
  lines: { title: 'Clear lines', icon: '≋', hint: 'Fill rows or columns' },
  blocks: { title: 'Place blocks', icon: '▦', hint: 'Each cell of a placed piece counts' },
};

/** DOM quest cards stay accessible while the playfield is rendered on canvas. */
export function createQuestHud(root) {
  const panel = root.querySelector('#quest-panel');
  const cards = Array.from(panel.querySelectorAll('.quest-card'));
  const stars = panel.querySelector('.quest-stars');
  const message = panel.querySelector('.quest-message');
  let timer = 0;
  return {
    place(layout) {
      const q = layout.quests;
      Object.assign(panel.style, { left: `${q.x}px`, top: `${q.y}px`, width: `${q.w}px`, height: `${q.h}px` });
      panel.classList.toggle('compact', q.h < 95);
    },
    update(game, finished = []) {
      stars.textContent = `★ ${game.quests.completed}`;
      stars.setAttribute('aria-label', `Quest stars: ${game.quests.completed}`);
      game.quests.active.forEach((quest, i) => {
        const card = cards[i];
        const copy = COPY[quest.type];
        card.dataset.type = quest.type;
        card.title = copy.hint;
        const icon = card.querySelector('.quest-icon');
        if (quest.type === 'gems') {
          if (!icon.querySelector('img')) {
            const img = document.createElement('img');
            img.src = './icons/cat-gem.svg';
            img.alt = '';
            icon.replaceChildren(img);
          }
        } else icon.textContent = copy.icon;
        card.querySelector('.quest-name').textContent = copy.title;
        card.querySelector('.quest-value').textContent = `${quest.progress} / ${quest.target}`;
        const bar = card.querySelector('[role="progressbar"]');
        bar.setAttribute('aria-label', copy.title);
        bar.setAttribute('aria-valuenow', String(quest.progress));
        bar.setAttribute('aria-valuemax', String(quest.target));
        bar.firstElementChild.style.width = `${quest.progress / quest.target * 100}%`;
        card.classList.remove('quest-new');
        if (finished.length) {
          void card.offsetWidth;
          card.classList.add('quest-new');
        }
      });
      if (finished.length) {
        clearTimeout(timer);
        message.textContent = `Purr! Quest complete · +${finished.length} ★`;
        panel.classList.add('celebrating');
        timer = setTimeout(() => {
          panel.classList.remove('celebrating');
          message.textContent = 'Little quests, happy paws';
        }, 2600);
      }
    },
    reset(game) {
      clearTimeout(timer);
      panel.classList.remove('celebrating');
      message.textContent = 'Little quests, happy paws';
      this.update(game);
    },
  };
}
