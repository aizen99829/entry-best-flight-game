# Sky Runner — Game Dossier

## What it is

**Sky Runner** is a complete offline flight game built for the make.fun
bounty *"Make the best flight game"* (`best-flight-game-20261126-0057`).
You fly a little stunt plane over a wild island — snowy peaks to the
north, open sea to the south, a sleepy harbour town in between — and
thread twelve glowing rings hung along a course that tours the whole
island. Touch rock, water or a rooftop and the run ends; thread every
ring and the course is clear.

## How it is built

- Pure HTML / CSS / JavaScript. No frameworks, no build step, no
  external assets, no network calls of any kind.
- The 3D world is rendered on a single Canvas 2D element with a
  hand-written perspective projector (no WebGL, no libraries): rolling
  terrain from layered sine noise, a northern mountain massif with a
  flyable saddle, a flat harbour valley, open sea with animated
  sparkle, a harbour town of collidable buildings (plus a blinking
  lighthouse and a church tower), drifting clouds, and a low sun.
- Deterministic world: one fixed seed generates the same island, rings
  and town on every load, so scores are comparable and the course is
  learnable.
- The flight model is arcade but physical: pitch trades speed for
  altitude, roll banks the plane into a turn, throttle sets the target
  speed, gravity sinks a slow level plane, and boost spends a meter
  that refills when not boosting.

## Controls

| Input | Action |
|---|---|
| W / S or ↑ / ↓ | Pitch nose down / up |
| A / D or ← / → | Roll and turn (bank left / right) |
| Shift / Ctrl | Throttle up / down |
| Space (hold) | Boost (drains the boost meter) |
| C | Switch camera: chase view / cockpit view |
| Mouse | Free-look (pan the view around the nose) |
| P | Pause / resume |
| R | Restart (after a crash, a win, or any time) |
| M | Mute / unmute the engine hum |

## Features

- Two cameras: chase view (see your plane bank and turn) and cockpit
  view (dashboard, dials, gunsight crosshair).
- Full HUD: score, rings collected (x/12), timer, altitude, speed,
  throttle bar, compass strip with heading readout, boost indicator,
  centre-screen toasts for ring pickups and warnings.
- Ring course in order: 12 gates from the harbour, over the hills,
  through the mountain saddle, out over the sea and back home. Each
  ring pays 100 points plus a speed bonus; finishing under the 2:30
  par time pays a time bonus.
- Crash detection against terrain, sea and rooftops, with a cause
  shown on the crash screen; best score saved in the browser.
- Synthesised engine hum (WebAudio, no audio files) that follows the
  throttle, plus blips for rings and crashes. Starts only after the
  first user gesture; M mutes.
- Start screen with a live orbiting view of the island behind it;
  pause screen; win screen when all 12 rings are threaded.

## How to run (offline)

1. Open `index.html` by double-clicking it, or drag it into any
   desktop browser. No server needed — the game runs from `file://`.
2. Click **TAKE OFF** (or press Enter).
3. Fly with the keyboard; move the mouse to look around.

## Files

- `index.html` — page shell, canvas, HUD, start / crash / win /
  pause overlays; loads `style.css` and `game.js` with plain scripts.
- `game.js` — the whole game: world generation, projection, physics,
  input, audio, rendering, HUD and the main loop.
- `style.css` — all page styling (HUD, compass, overlays).
- `README.md` — project readme with the make.fun badges.
- `LICENSE` — MIT.
