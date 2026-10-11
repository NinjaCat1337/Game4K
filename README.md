# Game4K — Meow Blocks

A neon block puzzle with a dark background, bright tiles, little cats, kitty gems, and random quests.
The classic Block Blast! rules run on an 8×8 board. This installable web app (PWA) is designed
for iPhone and also works on desktop and Android. Once loaded, it can run offline.

**Play:** https://ninjacat1337.github.io/Game4K/

## How to play

- Drag the three pieces from the tray onto the board in any order. Pieces cannot rotate.
- A new tray appears after all three pieces have been placed.
- Filled rows and columns clear together.
- Each placed cell earns 1 point. Clearing 1–6 lines earns 10, 20, 60, 120, 200, or 300 points,
  multiplied by the clearing streak plus 1.
- The combo survives two moves without a clear and ends on the third.
- “Purr-fect!” means every piece in the tray cleared at least one line.
- The game ends when none of the remaining pieces fits. Your best score stays on your device.

## Kitty quests and gems

- Two random quests are always active: earn points, collect kitty gems, clear lines, or place a number of block cells.
- Progress counts actions taken after the quest appears. Each completed quest earns a star and immediately
  makes room for a new quest. Targets gradually increase as you complete quests.
- Gems are little faceted cat heads inside blocks. Every new tray contains at least one gem.
  Clear a row or column containing a gem to collect it. A gem at a row/column crossing counts once.
- Stars count completed quests in the current game. Starting a new game resets quests, progress, and stars.
- The board, gems, quest progress, and both random generator states are saved together.
  Older saves keep their board and score when upgraded.

## Run locally

Node.js 22 or newer is required. Playing the game needs no installed dependencies.

```sh
npm start
```

Open http://localhost:8080/. If that port is busy, the server prints the next available address.

## Test on iPhone over Wi-Fi

1. Connect your computer and iPhone to the same Wi-Fi network.
2. Run `npm start` and find the network address printed by the server, such as `http://192.168.50.16:8080/`.
   On Windows, `ipconfig` also lists the Wi-Fi adapter's IPv4 address.
3. Open the full address, including `http://` and the port, in Safari on your iPhone.

Ordinary network HTTP supports playing and testing the layout. Offline installation requires HTTPS;
localhost also supports service workers for development.

## Publish updates

```sh
npm run stamp
git add -A
git commit -m "Describe the changes"
git push
```

Run `npm run stamp` before committing application changes. It updates the asset list and cache version
in `sw.js` so installed apps can receive the update. It also checks path casing and missing offline assets.
GitHub Pages deployment and browser caches can delay when the updated version becomes visible.

## Install on iPhone

1. Open the game in Safari and let it finish loading.
2. Tap **Share** and choose **Add to Home Screen**.
3. Leave **Open as Web App** enabled when that option is available, then tap **Add**.
4. Open the installed game while online once to prepare its offline cache.

Safari and the installed app may have separate storage. Updates are checked when the app opens;
an **Update** button appears if a new version is ready during play. After changing the app icon or title,
remove the old Home Screen shortcut and add it again to refresh the installed metadata.
Sound follows supported device audio behavior; haptic support varies by device and browser.
Both can be turned off in settings.

## Development

| Command | Purpose |
|---|---|
| `npm start` | Local server, default port 8080, revalidated assets, case-sensitive path checks |
| `npm test` | Unit tests for game logic, quests, and save validation |
| `npm run test:e2e` | Browser checks for touch input, quests, saves, six screen sizes, and offline mode; starts its own server and writes screenshots to `tests/e2e/out/` |
| `npm run icons` | Generates PNG icons from the original cat-and-block artwork in `icons/icon.svg` |
| `npm run stamp` | Updates the service worker's asset list and cache version |
| `node tools/stamp-sw.mjs --check` | Checks that the service worker cache stamp is current |

Browser checks and icon generation require `npm install` plus installed Chrome, Chromium, or Edge.
Set `CHROME_PATH` to override browser detection. Set `GAME4K_URL` to run browser checks against an existing server.

Debug URL parameters:

- `?seed=123`: start a deterministic game, ignoring any saved game.
- `?nosave=1`: disable storage reads and writes.
- `?debug=1`: expose `window.__game4k` and display errors on screen.
- `?safe=59,0,34,0`: emulate top, right, bottom, and left safe-area insets in CSS pixels.

```text
index.html, css/             Page shell and styles
src/main.js                  Bootstrap
src/core/                    Pure game and quest logic, tested in Node
src/ui/                      Canvas rendering, input, effects, quest cards, overlays
src/platform/                Storage, Web Audio, haptics, PWA, device behavior
sw.js, manifest.webmanifest  Offline cache and application metadata
fonts/, icons/               Self-hosted Nunito, cat artwork, app icons
tools/                       Local server, icon generation, cache stamping
tests/                       Unit and browser tests
```

Keep application paths relative and lowercase. GitHub Pages distinguishes path casing even when Windows does not.

## Credits

- Nunito: SIL Open Font License 1.1 (`fonts/OFL.txt`), from `@fontsource/nunito`.
- Icons, graphics, and sounds are original assets created in this project's code. No original game assets are used.
- This is an unofficial, noncommercial project with no affiliation to the creators of Block Blast!
