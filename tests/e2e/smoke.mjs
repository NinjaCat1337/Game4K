// Real pointer input, quest completion, save/resume, responsive layouts, overlays and offline PWA.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from '../../tools/browser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'tests/e2e/out');
await fs.mkdir(out, { recursive: true });
let server = null;
let browser = null;
let base = process.env.GAME4K_URL;
const errors = [];

function watch(page) {
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('response', (response) => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
}

async function ready(page, query = '?seed=63&nosave=1&debug=1') {
  await page.goto(`${base}/${query}`);
  await page.waitForFunction(() => window.__game4k?.layout?.board?.cell > 0);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
}

async function dropDot(page, row, col, touch = false) {
  const coords = await page.evaluate(({ row, col }) => {
    const L = window.__game4k.layout;
    const s = L.tray.slots[0];
    return { x0: s.cx, y0: s.cy, x: L.board.inner.x + (col + .5) * L.board.cell,
      y: L.board.inner.y + (row + .5) * L.board.cell, cell: L.board.cell };
  }, { row, col });
  if (touch) {
    const cdp = await page.context().newCDPSession(page);
    // Touch pieces lift by 1.5 cells, and upward movement is amplified by 1.25.
    const top = coords.y - coords.cell / 2;
    const baseY = coords.y0 - 2.5 * coords.cell;
    const y = coords.y0 + (top - baseY) / 1.25;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: coords.x0, y: coords.y0 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: coords.x, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  } else {
    await page.mouse.move(coords.x0, coords.y0);
    await page.mouse.down();
    await page.mouse.move(coords.x, coords.y, { steps: 12 });
    await page.mouse.up();
  }
  await page.waitForTimeout(650);
}

try {
  if (!base) {
    server = spawn(process.execPath, ['tools/serve.mjs', '--port', '8095'], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    base = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Local server did not start')), 10000);
      server.once('error', reject);
      server.stdout.on('data', (data) => {
        const match = String(data).match(/http:\/\/localhost:\d+\//);
        if (match) { clearTimeout(timeout); resolve(match[0].replace(/\/$/, '')); }
      });
    });
  }
  base = base.replace(/\/$/, '');
  browser = await launchBrowser();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const page = await context.newPage();
  watch(page);
  await ready(page);
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  assert.equal(await page.title(), 'Meow Blocks · Game4K');
  assert.doesNotMatch(await page.locator('body').textContent(), /[А-Яа-яЁё]/);
  await page.locator('.quest-icon img').evaluate((img) => img.decode());
  assert.equal(await page.locator('.quest-icon img').getAttribute('src'), './icons/cat-gem.svg');

  // Build a near-full row with two jewels; complete both quests using a native touch drag.
  await page.evaluate(() => {
    const d = window.__game4k;
    const b = new Array(64).fill(0);
    for (let c = 0; c < 7; c++) b[56 + c] = 1 + c;
    d.setBoard(b);
    d.setHand(['dot', 'dot', 'dot'], [4, 5, 7]);
    d.game.handGems = [0, -1, -1];
    d.game.gems[56] = 1;
    d.game.quests = { completed: 0, active: [
      { type: 'gems', target: 2, progress: 0 }, { type: 'score', target: 11, progress: 0 },
    ] };
    d.app.redraw();
  });
  await dropDot(page, 7, 7, true);
  const completed = await page.evaluate(() => window.__game4k.state());
  assert.equal(completed.score, 11);
  assert.equal(completed.quests.completed, 2);
  assert.ok(completed.gems.every((v) => v === 0));
  assert.ok(completed.quests.active.every((q) => q.progress === 0));
  assert.match(await page.locator('.quest-message').innerText(), /Quest complete/);
  assert.equal(await page.locator('.quest-stars').innerText(), '★ 2');
  console.log('PASS touch drag → jewel collection → two quests → new quests');

  // Inspect the complete layout at common phone sizes, landscape and desktop.
  for (const [width, height] of [[390, 844], [375, 667], [320, 568], [844, 390], [568, 320], [1365, 900]]) {
    await page.setViewportSize({ width, height });
    await ready(page);
    const geometry = await page.evaluate(() => {
      const L = window.__game4k.layout;
      const panel = document.querySelector('#quest-panel').getBoundingClientRect();
      const overflow = [...document.querySelectorAll('.quest-card, .quest-heading, .quest-name')].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.className);
      for (const card of document.querySelectorAll('.quest-card')) {
        const value = card.querySelector('.quest-value').getBoundingClientRect();
        const progress = card.querySelector('.quest-progress').getBoundingClientRect();
        if (value.bottom > progress.top + 1) overflow.push('quest-value overlaps progress');
      }
      return { L, panel: { x: panel.x, y: panel.y, right: panel.right, bottom: panel.bottom }, overflow };
    });
    const { L, panel, overflow } = geometry;
    assert.ok(L.board.x >= 0 && L.board.y >= 0);
    assert.ok(L.board.x + L.board.size <= width && L.board.y + L.board.size <= height);
    assert.ok(L.tray.y + L.tray.h <= height, `${width}×${height} tray fits`);
    assert.ok(panel.x >= 0 && panel.right <= width && panel.y >= 0 && panel.bottom <= height);
    if (L.mode === 'portrait') assert.ok(panel.bottom + 6 <= L.board.y, 'quests above board');
    else assert.ok(panel.x >= L.board.x + L.board.size, 'quests beside board');
    assert.deepEqual(overflow, [], `${width}×${height}: text fits`);
    await page.screenshot({ path: path.join(out, `layout-${width}x${height}.png`) });
  }
  console.log('PASS six responsive layouts, including 320px and phone landscape');

  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page, '?seed=63&nosave=1&debug=1&safe=59,0,34,0');
  const safe = await page.evaluate(() => {
    const L = window.__game4k.layout;
    return { top: L.board.y, bottom: L.tray.y + L.tray.h, safe: L.safe };
  });
  assert.ok(safe.top >= safe.safe.top && safe.bottom <= 844 - safe.safe.bottom);
  await page.locator('#gear').click();
  await page.locator('#settings.open').waitFor();
  await page.waitForFunction(() => window.__game4k.state().audio === 'running');
  await page.locator('[data-toggle="sound"]').click();
  assert.equal(await page.locator('[data-toggle="sound"]').getAttribute('aria-checked'), 'false');
  await page.waitForFunction(() => window.__game4k.state().audio === 'suspended');
  await page.locator('[data-toggle="sound"]').click();
  await page.waitForFunction(() => window.__game4k.state().audio === 'running');
  await page.locator('[data-toggle="sound"]').click();
  await page.screenshot({ path: path.join(out, 'settings.png') });
  await page.locator('.btn-resume').click();
  await page.locator('#settings').waitFor({ state: 'hidden' });
  console.log('PASS safe areas, sound mute/resume and settings');

  await page.evaluate(() => window.__game4k.forceGameOver());
  await page.locator('#result.open').waitFor();
  await page.locator('#result .play.show').waitFor();
  await page.screenshot({ path: path.join(out, 'result.png') });
  await page.locator('#result .play').click();
  await page.waitForFunction(() => window.__game4k.state().phase === 'play');
  assert.equal((await page.evaluate(() => window.__game4k.state())).quests.completed, 0);
  console.log('PASS game over and restart');

  // Same browser storage, actual UI move, then reload without the seed override.
  await ready(page, '?seed=24&debug=1');
  await page.evaluate(() => {
    const d = window.__game4k;
    d.setHand(['dot', 'dot', 'dot'], [1, 3, 5]);
    d.game.handGems = [0, -1, -1];
  });
  await dropDot(page, 2, 3);
  const saved = await page.evaluate(() => window.__game4k.game.toJSON());
  await ready(page, '?debug=1');
  assert.deepEqual(await page.evaluate(() => window.__game4k.game.toJSON()), saved);
  console.log('PASS save/resume, including quests, jewels and RNG');

  // A preview with real occupied tiles and jewels, ready for review.
  await page.evaluate(() => {
    const d = window.__game4k;
    const b = new Array(64).fill(0);
    for (const [r, c, color] of [[4,0,4],[5,0,4],[6,0,4],[6,1,4],[7,0,4],[7,1,4],[7,2,4],[6,4,7],[6,5,7],[7,4,7],[7,5,7],[5,6,1],[5,7,1],[6,7,1],[3,3,5],[3,4,5],[4,3,5],[4,4,5]]) b[r*8+c] = color;
    d.setBoard(b);
    d.setHand(['c3c', 'o2', 'i3h'], [3,1,5]);
    d.game.gems[48] = 1;
    d.game.gems[52] = 1;
    d.app.redraw();
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(out, 'game-preview.png') });
  await context.close();

  // Install the new service-worker cache and reload with network access disabled.
  const offlineContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const offlinePage = await offlineContext.newPage();
  watch(offlinePage);
  await ready(offlinePage, '?debug=1');
  await offlinePage.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
  });
  await offlineContext.setOffline(true);
  await offlinePage.reload();
  await offlinePage.waitForFunction(() => window.__game4k?.state().phase === 'play');
  assert.equal(await offlinePage.locator('.quest-card').count(), 2);
  assert.ok(await offlinePage.locator('.quest-cat').evaluate((img) => img.complete && img.naturalWidth > 0));
  await offlineContext.close();
  console.log('PASS offline PWA, including new quest module and cat SVG');
  assert.deepEqual(errors, []);
  console.log(`Browser checks passed. Screenshots: ${out}`);
} finally {
  if (browser) await browser.close();
  if (server) server.kill();
}
