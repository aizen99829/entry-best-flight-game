# Sky Runner — Best Flight Game

[![make.fun](https://make.fun/badge/best-flight-game-20261126-0057.svg)](https://make.fun/bounty/best-flight-game-20261126-0057?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)
[![Rank](https://make.fun/badge/best-flight-game-20261126-0057/aizen99829/entry-best-flight-game/rank.svg)](https://make.fun/bounty/best-flight-game-20261126-0057/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)
[![Reward](https://make.fun/badge/best-flight-game-20261126-0057/aizen99829/entry-best-flight-game/reward.svg)](https://make.fun/bounty/best-flight-game-20261126-0057?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)

A complete offline flight game built for the make.fun bounty
**"Make the best flight game"** (`best-flight-game-20261126-0057`).

You are the test pilot of a little stunt plane over a wild island:
snowy peaks to the north, open sea to the south, and a sleepy harbour
town in between. Twelve glowing rings hang in the sky along a course
that tours the whole island. Fly through each one to score — the
faster and cleaner the run, the bigger the bonus. Touch rock, water
or a rooftop and the run is over. Beat the clock, beat your own best
score.

## Play it now — no install, no server

Double-click `index.html` (or drag it into any desktop browser) and
click **TAKE OFF**. The game runs entirely from `file://`: there is no
fetch, no module import, no CDN script, no web font and no external
image anywhere in this project. It works with the network cable
unplugged.

## Controls

| Input | Action |
|---|---|
| W / S or ↑ / ↓ | Pitch nose down / up |
| A / D or ← / → | Roll and turn (bank left / right) |
| Shift / Ctrl | Throttle up / down |
| Space (hold) | Boost — drains the boost meter |
| C | Switch camera: chase view / cockpit view |
| Mouse | Free-look — pan the view around the nose |
| P | Pause / resume |
| R | Restart (after a crash, a win, or any time) |
| M | Mute / unmute the engine hum |

**Flying tips from the test pilot:**

- Rings must be flown **in order** — the next gate glows gold and
  pulses, with a chevron pointing at the gate after it. Line up early
  and keep the throttle near 70% for the twisty mountain section.
- Boost is for the long straight over the sea. Never boost straight
  at a mountain: the saddle between the two northern peaks is the
  only safe way through at speed.
- A slow, level plane sinks. If the nose is level and the speed is
  dropping, add throttle or trade altitude for speed with a gentle
  dive. The sea-skimming gates (rings 9 and 10) are the lowest and
  the most dangerous — respect them.

## What is in the game

- **A real 3D world on a 2D canvas.** A hand-written perspective
  projector turns a 3D island into canvas drawing: rolling terrain
  from layered sine noise, a northern mountain massif with a flyable
  saddle, a flat harbour valley, open sea with animated sparkle,
  rocky islets, drifting clouds and a low sun.
- **A harbour town you can crash into.** A grid of collidable
  buildings with a blinking lighthouse on the pier and a church tower
  — clipping a rooftop ends the run, same as the mountainside.
- **Two cameras.** Chase view shows your plane banking and turning;
  cockpit view gives you a dashboard with speed and altitude dials
  plus a gunsight crosshair for aiming at rings.
- **A full HUD.** Score, rings collected (x/12), timer, altitude,
  speed, throttle bar, a scrolling compass strip with heading
  readout, a boost indicator, and centre-screen toasts for ring
  pickups and warnings.
- **A scoring system with teeth.** Each ring pays 100 points plus a
  speed bonus; finishing all twelve under the 2:30 par time pays a
  time bonus on top. Your best score is saved in the browser.
- **Synthesised sound.** The engine hum is generated with WebAudio
  (no audio files) and follows the throttle; rings and crashes get
  their own blips. It starts only after your first click or keypress,
  and M mutes it.

## How it is built

- **No dependencies at all.** Pure HTML, CSS and JavaScript. No
  framework, no build step, no bundler, no assets to download.
- **Deterministic world.** One fixed seed generates the same island,
  the same ring course and the same town on every load, so scores are
  comparable and the course is learnable. The start screen shows a
  live orbiting view of that island behind the title.
- **Arcade flight model with real physics ideas in it.** Pitch trades
  speed for altitude and back; roll banks the plane into a turn whose
  rate follows the bank angle; speed chases a throttle target; gravity
  sinks a slow, level plane; boost spends a meter that refills when
  you are not boosting.
- **Painter's algorithm rendering.** Sky first, then terrain quads
  sorted far-to-near, then the town, clouds, rings and the plane —
  with distance haze fading far things into the sky colour, which is
  what sells the sense of depth.

## Files

| File | What it is |
|---|---|
| `index.html` | Page shell: canvas, HUD, start / crash / win / pause overlays. Loads `style.css` and `game.js` with plain `<script>` tags so `file://` works. |
| `game.js` | The whole game: world generation, projection, physics, input, audio, rendering, HUD and the main loop. |
| `style.css` | All page styling: HUD panels, compass, throttle bar, overlays, responsive tweaks. |
| `dossier.md` | A plain-language dossier: what the game is, how it is built, controls, features, and how to run it offline. |
| `LICENSE` | MIT. |

## Run it offline

1. Clone or download this repo.
2. Open `index.html` in a desktop browser (double-click works).
3. Click **TAKE OFF** or press Enter, and fly.

Best on desktop with a keyboard and mouse. No account, no server,
no data leaves your machine — the only thing the game stores is your
best score, in your own browser's local storage.

## License

MIT — see [LICENSE](LICENSE).

## The course — all twelve rings

The gates are flown in order, harbour to harbour:

1. Straight ahead off the runway — warm-up.
2. Gentle left over the valley.
3. Climbing toward the foothills.
4. The saddle approach, between the peaks.
5. **Through the mountain saddle** — the highest gate.
6. Out the far side, banking right.
7. Diving back toward the coast.
8. Low over the eastern beach.
9. Sea skimmer, east bay — mind the waves.
10. Long straight over open water — boost here.
11. Back toward the harbour mouth.
12. Final gate, over the town roofs — then the course is clear.

Par time is 2:30. A clean run threads every ring without touching
anything; a fast run does it with the throttle open and the boost
spent wisely.

## For the grader

The entrypoint is `main.ts` at the repository root: run `node main.ts`
(Node 22) and open `http://localhost:8080/` — it serves the game with
only Node's standard library. The game itself also runs straight from
`file://` by opening `index.html`; no server is required to play.
