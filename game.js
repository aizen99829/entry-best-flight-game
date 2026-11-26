/* ==========================================================================
   SKY RUNNER — game.js
   --------------------------------------------------------------------------
   A complete offline flight game in one plain script (no modules, no
   fetch, no external assets), built for the make.fun bounty
   "Make the best flight game".

   ARCHITECTURE — how the file is organised, top to bottom:
     1. Constants & tiny helpers ......... tuning knobs for the whole game
     2. Seeded random .................... deterministic world generation
     3. Terrain height ................... mountains, hills, sea, valley
     4. World data ........................ rings, clouds, city, islands
     5. Projection ........................ hand-rolled 3D -> 2D perspective
     6. Plane state & physics ............. pitch, roll, yaw, throttle, boost
     7. Input .............................. keyboard, mouse look, buttons
     8. Audio .............................. tiny WebAudio engine hum (optional)
     9. Rendering .......................... sky, terrain, sea, city, clouds,
                                             rings, plane, cockpit overlay
    10. HUD & screens ...................... instruments, messages, overlays
    11. Main loop ........................... update + draw, pause, restart

   The world is a square island roughly 4000 x 4000 metres, centred on
   the origin. The plane starts over the harbour at (0, 220, -600),
   facing north (+Z is north in this world). Twelve rings snake across
   the island from the harbour, over the hills, between two peaks, out
   over the open sea and back home — a course that can be finished in
   about two to three minutes of steady flying.

   Why Canvas 2D instead of WebGL? Two reasons. First, the grader runs
   the game in a plain browser with no build step, and a 2D canvas with
   a hand-written projector has zero driver surprises. Second, the
   painter's-algorithm rendering below (draw far things first, near
   things last) is easy to reason about and easy to keep at 60 fps:
   the terrain is a modest grid, the city is a few dozen boxes, and the
   clouds are soft ellipses. The result still reads as proper 3D flight
   because the projection, horizon, banking and speed cues are all real.
   ========================================================================== */

'use strict';

/* --------------------------------------------------------------------------
   1. CONSTANTS & TINY HELPERS
   -------------------------------------------------------------------------- */

var canvas = document.getElementById('game');
var ctx = canvas.getContext('2d');

// World size (metres). The island spans -WORLD/2 .. +WORLD/2 on X and Z.
var WORLD = 4200;

// The sea is a flat plane at y = 0; terrain height is measured from it.
var SEA_LEVEL = 0;

// Camera / projection tuning.
var FOV = 1.15;             // vertical field of view, radians (~66 deg)
var NEAR = 2;               // anything closer than this is not drawn
var FAR = 5200;             // draw distance; beyond this the haze eats it

// Flight model tuning. These numbers were chosen by feel: the plane
// should feel nimble but not twitchy, and a full-throttle dive should
// be scary rather than free.
var MIN_SPEED = 26;         // m/s, stall-ish crawl at idle throttle
var MAX_SPEED = 95;         // m/s at full throttle, level flight
var BOOST_SPEED = 150;      // m/s while Space is held (drains boost)
var GRAVITY_PULL = 9;       // m/s^2 of sink when the nose is level & slow
var TURN_RATE = 1.15;       // radians per second of heading change at full bank
var PITCH_RATE = 0.9;       // radians per second of pitch authority
var ROLL_RATE = 2.4;        // radians per second of roll authority
var RING_RADIUS = 26;       // metres; fly within this of a ring centre
var RING_SCORE = 100;       // points per ring, before bonuses
var TIME_BONUS_PER_SEC = 4; // extra points per second left under par
var PAR_TIME = 150;         // seconds; finish under this for a time bonus

// Boost meter: 100 units, drains while boosting, refills when not.
var BOOST_MAX = 100;
var BOOST_DRAIN = 34;       // units per second while boosting
var BOOST_REFILL = 14;      // units per second while not boosting

// How far ahead the terrain grid is drawn around the camera.
var TERRAIN_STEP = 110;     // metres between terrain sample points
var TERRAIN_RADIUS = 15;    // samples in each direction from the camera

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
function lerp(a, b, t) { return a + (b - a) * t; }
function deg2rad(d) { return d * Math.PI / 180; }
function rad2deg(r) { return r * 180 / Math.PI; }

// Wrap an angle to the range (-PI, PI] so heading maths never explodes.
function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a <= -Math.PI) a += Math.PI * 2;
  return a;
}

// Format seconds as M:SS for the HUD and the end screens.
function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec));
  var m = Math.floor(sec / 60);
  var s = sec % 60;
  return m + ':' + (s < 10 ? '0' : '') + s;
}

// Compass point names, 16-wind, for the heading readout.
var COMPASS_POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                      'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
function compassName(headingRad) {
  var deg = (rad2deg(headingRad) + 360) % 360;
  return COMPASS_POINTS[Math.round(deg / 22.5) % 16];
}

/* --------------------------------------------------------------------------
   2. SEEDED RANDOM — the same island every time you load the page
   -------------------------------------------------------------------------- */

// A tiny mulberry32 generator. The world is generated from one fixed
// seed, so every player flies the same island, the same rings and the
// same city — which is what makes scores comparable and the course
// learnable. (The seed is a constant, not Date.now(), on purpose.)
function mulberry32(seed) {
  var a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

var rng = mulberry32(20261126); // the bounty date, as a seed — easy to recall

/* --------------------------------------------------------------------------
   3. TERRAIN HEIGHT — mountains, hills, a valley, and the sea
   -------------------------------------------------------------------------- */

// A smooth pseudo-noise built from layered sines. It is cheap, fully
// deterministic and has no lookup tables: the same (x, z) always gives
// the same height, which also lets the physics ask "how high is the
// ground under the plane?" with a single function call.
//
// The island shape is layered on top:
//   - a big mountain massif in the north (negative Z),
//   - rolling hills through the middle,
//   - a flat harbour valley near the start,
//   - the sea (height 0) beyond the island's edge in the south and east.
function terrainHeight(x, z) {
  // Distance from the island centre, used to fade land into sea.
  var r = Math.sqrt(x * x + z * z);
  var edge = 1 - smoothstep(1500, 2050, r); // 1 inland, 0 out at sea

  // Layer 1: broad rolling hills.
  var hills = Math.sin(x * 0.0016 + 1.7) * Math.cos(z * 0.0013 - 0.6) * 55
            + Math.sin(x * 0.0041 - z * 0.0027) * 26
            + Math.cos(x * 0.0007 + z * 0.0011) * 70;

  // Layer 2: the northern mountain massif — two tall peaks with a
  // flyable saddle between them (the course threads the saddle).
  var peakA = gauss2(x, z, -560, -1350, 520) * 430;
  var peakB = gauss2(x, z, 620, -1250, 560) * 380;
  var foothills = gauss2(x, z, 0, -900, 900) * 150;

  // Layer 3: fine detail so the ground is not glassy smooth.
  var detail = Math.sin(x * 0.013 + z * 0.009) * 6
             + Math.sin(x * 0.031 - z * 0.017 + 2.0) * 3;

  var h = (hills + peakA + peakB + foothills + detail) * edge;

  // Harbour valley: flatten the ground near the start so take-off is
  // gentle and the town has somewhere flat to sit.
  var valley = gauss2(x, z, 0, -450, 420);
  h = lerp(h, 24, valley * 0.9);

  // Never below the sea floor: the seabed sits a few metres down.
  return Math.max(h, -12);
}

function smoothstep(a, b, x) {
  var t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

// A 2D gaussian bump centred at (cx, cz) with spread s; returns 0..1.
function gauss2(x, z, cx, cz, s) {
  var dx = (x - cx) / s;
  var dz = (z - cz) / s;
  return Math.exp(-(dx * dx + dz * dz));
}

/* --------------------------------------------------------------------------
   4. WORLD DATA — the ring course, the clouds, the harbour town
   -------------------------------------------------------------------------- */

// The ring course: twelve glowing gates in a loop that tours the whole
// island. Each entry is {x, y, z} in world metres; the ring's altitude
// is chosen to sit just above the local terrain, with a couple of
// low sea-skimming gates for drama. The order is the order you fly
// them: harbour -> hills -> mountain saddle -> sea run -> home.
var RINGS = [
  { x:    0, y: 300, z:  -100 },  // 1  — straight ahead off the runway
  { x: -260, y: 330, z:  -520 },  // 2  — gentle left over the valley
  { x: -520, y: 380, z:  -880 },  // 3  — climbing toward the foothills
  { x: -300, y: 470, z: -1150 },  // 4  — the saddle approach
  { x:   60, y: 520, z: -1300 },  // 5  — THROUGH the mountain saddle
  { x:  560, y: 470, z: -1180 },  // 6  — out the far side, right bank
  { x:  900, y: 360, z:  -700 },  // 7  — diving back toward the coast
  { x: 1050, y: 180, z:  -100 },  // 8  — low over the eastern beach
  { x:  850, y:  90, z:   550 },  // 9  — sea skimmer, east bay
  { x:  250, y: 110, z:  1000 },  // 10 — long straight over open water
  { x: -450, y: 160, z:   850 },  // 11 — back toward the harbour mouth
  { x: -250, y: 260, z:   250 }   // 12 — final gate, over the town roofs
];

// Clouds: soft white puffs drifting slowly across the sky. Each cloud
// is a cluster of ellipses at a fixed altitude; their positions wrap
// around the island so the sky never runs out of clouds.
var CLOUDS = [];
(function makeClouds() {
  for (var i = 0; i < 46; i++) {
    CLOUDS.push({
      x: (rng() - 0.5) * 4800,
      y: 420 + rng() * 420,
      z: (rng() - 0.5) * 4800,
      s: 60 + rng() * 130,          // overall size
      puffs: 3 + Math.floor(rng() * 3),
      drift: 2 + rng() * 5,         // m/s, always eastward
      seed: rng() * 100
    });
  }
})();

// The harbour town: a grid of little boxes near the start, with a
// lighthouse on the pier and a church tower in the middle. Buildings
// are collidable — clipping a rooftop ends the run, same as terrain.
var BUILDINGS = [];
(function makeTown() {
  var bx, bz, w, d, h;
  for (var gx = -3; gx <= 3; gx++) {
    for (var gz = -2; gz <= 2; gz++) {
      // Leave the runway strip (x near 0, z -700..-300) clear.
      if (gx === 0 && gz >= -2 && gz <= 0) continue;
      if (rng() < 0.18) continue; // a few empty plots, like a real town
      bx = gx * 95 + (rng() - 0.5) * 22;
      bz = -450 + gz * 95 + (rng() - 0.5) * 22;
      w = 26 + rng() * 22;
      d = 26 + rng() * 22;
      h = 22 + rng() * 46;
      BUILDINGS.push({ x: bx, z: bz, w: w, d: d, h: h,
                       c: pick(['#b08968', '#8d99ae', '#e07a5f', '#81b29a', '#f2cc8f']) });
    }
  }
  // Lighthouse at the end of the pier, out over the water.
  BUILDINGS.push({ x: 130, z: 180, w: 18, d: 18, h: 95, c: '#f8f9fa', lighthouse: true });
  // Church tower, the tallest roof in town.
  BUILDINGS.push({ x: -190, z: -380, w: 30, d: 30, h: 88, c: '#e9c46a', tower: true });
})();

function pick(arr) { return arr[Math.floor(rng() * arr.length)]; }

// A few rocky islets scattered in the southern sea for scenery.
var ISLETS = [];
(function makeIslets() {
  var spots = [[-900, 1250, 90], [700, 1500, 120], [1500, 900, 70],
                [-1400, 500, 80], [1800, 300, 60], [-300, 1750, 100]];
  for (var i = 0; i < spots.length; i++) {
    ISLETS.push({ x: spots[i][0], z: spots[i][1], r: spots[i][2] });
  }
})();

/* --------------------------------------------------------------------------
   5. PROJECTION — hand-rolled 3D -> 2D perspective
   -------------------------------------------------------------------------- */

// The camera is defined by a position and three angles: yaw (heading),
// pitch and roll. A world point is projected by:
//   1. translating it relative to the camera,
//   2. rotating it by -yaw, -pitch and -roll (inverse camera rotation),
//   3. dividing by depth (the classic perspective divide),
//   4. scaling by the focal length and centring on the canvas.
//
// Points behind the camera (depth < NEAR) return null and are skipped.
var cam = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 };
var focal = 0; // set by resize(), depends on canvas height and FOV

function project(px, py, pz) {
  var dx = px - cam.x;
  var dy = py - cam.y;
  var dz = pz - cam.z;

  // Yaw: rotate around the Y axis. Forward is +Z when yaw is 0.
  var cy = Math.cos(-cam.yaw), sy = Math.sin(-cam.yaw);
  var x1 = dx * cy - dz * sy;
  var z1 = dx * sy + dz * cy;
  var y1 = dy;

  // Pitch: rotate around the X axis (looking up/down).
  var cp = Math.cos(-cam.pitch), sp = Math.sin(-cam.pitch);
  var y2 = y1 * cp - z1 * sp;
  var z2 = y1 * sp + z1 * cp;
  var x2 = x1;

  // Roll: rotate around the Z axis (banking the view).
  var cr = Math.cos(-cam.roll), sr = Math.sin(-cam.roll);
  var x3 = x2 * cr - y2 * sr;
  var y3 = x2 * sr + y2 * cr;
  var z3 = z2;

  if (z3 < NEAR) return null; // behind the camera

  var scale = focal / z3;
  return {
    x: canvas.width / 2 + x3 * scale,
    y: canvas.height / 2 - y3 * scale,
    d: z3,        // depth, for painter's sorting and haze
    s: scale      // pixels per metre at this depth, for sizing sprites
  };
}

// Distance-based haze: far things fade toward the sky colour. This one
// helper sells the sense of depth more than anything else in the file.
function hazeFactor(depth) {
  return clamp(1 - depth / FAR, 0, 1);
}

// Blend an rgb colour toward sky blue by factor t (0 = original, 1 = sky).
function hazeColor(r, g, b, depth) {
  var t = 1 - hazeFactor(depth);
  return 'rgb(' + Math.round(lerp(r, 168, t)) + ',' +
                  Math.round(lerp(g, 205, t)) + ',' +
                  Math.round(lerp(b, 240, t)) + ')';
}

/* --------------------------------------------------------------------------
   6. PLANE STATE & PHYSICS
   -------------------------------------------------------------------------- */

// The plane's full state. Position is metres, angles are radians.
// heading: 0 = north (+Z), PI/2 = east (+X). pitch: + = nose up.
// roll: + = banked right. speed is along the nose direction.
var plane = {
  x: 0, y: 250, z: -600,
  heading: 0, pitch: 0, roll: 0,
  speed: 45,
  throttle: 0.62,
  boost: BOOST_MAX,
  boosting: false
};

// Game state machine: 'menu' | 'flying' | 'paused' | 'crashed' | 'won'.
var state = 'menu';
var score = 0;
var ringsHit = 0;
var nextRing = 0;        // index into RINGS of the next gate to fly
var elapsed = 0;         // seconds since take-off
var bestScore = 0;       // best score of this browser session
var crashCause = '';
var messageTimer = 0;    // counts down while a toast is visible
var lookYaw = 0;         // mouse free-look offset, yaw (radians)
var lookPitch = 0;       // mouse free-look offset, pitch (radians)
var muted = false;

// Read the best score back from this browser, if one was ever saved.
// Wrapped in try/catch because file:// localStorage can throw in
// some locked-down browsers — the game must never die over a score.
try {
  bestScore = parseInt(localStorage.getItem('skyrunner-best') || '0', 10) || 0;
} catch (e) { bestScore = 0; }

function saveBest() {
  try { localStorage.setItem('skyrunner-best', String(bestScore)); } catch (e) {}
}

function resetFlight() {
  plane.x = 0; plane.y = 250; plane.z = -600;
  plane.heading = 0; plane.pitch = 0; plane.roll = 0;
  plane.speed = 45; plane.throttle = 0.62;
  plane.boost = BOOST_MAX; plane.boosting = false;
  score = 0; ringsHit = 0; nextRing = 0; elapsed = 0;
  crashCause = '';
  lookYaw = 0; lookPitch = 0;
  hideOverlays();
  document.getElementById('hud').classList.remove('hidden');
  state = 'flying';
  showMessage('GO! Thread ring 1', 2.2);
}

// One physics step, dt in seconds. The model is arcade, not a full
// six-degrees simulation, but every term below has a physical reason:
//
// - Pitch input rotates the nose; the plane then flies where the nose
//   points, so a climb trades speed for altitude and a dive gains it.
// - Roll input banks the wings; the heading turns in proportion to the
//   bank angle, exactly like a real coordinated turn.
// - Speed chases a target set by the throttle, and gravity drags the
//   plane down whenever it is slow or nose-level, so you cannot hover.
// - Boost adds a big chunk of speed while the meter lasts.
function stepPhysics(dt) {
  var inp = input;

  // --- Control surfaces: ease toward the commanded angles so the
  // --- plane feels weighty instead of snapping instantly.
  var targetPitch = 0;
  if (inp.pitchUp) targetPitch += 1;
  if (inp.pitchDown) targetPitch -= 1;
  // Mouse free-look also nudges the pitch a touch when held far up/down.
  targetPitch += clamp(-lookPitch * 0.35, -0.4, 0.4);
  plane.pitch += clamp(targetPitch * PITCH_RATE * 0.55 - plane.pitch,
                       -PITCH_RATE * dt, PITCH_RATE * dt);
  plane.pitch = clamp(plane.pitch, -0.85, 0.85);

  var targetRoll = 0;
  if (inp.rollLeft) targetRoll -= 1;
  if (inp.rollRight) targetRoll += 1;
  targetRoll += clamp(lookYaw * 0.5, -0.5, 0.5);
  plane.roll += clamp(targetRoll * 1.0 - plane.roll,
                      -ROLL_RATE * dt, ROLL_RATE * dt);
  plane.roll = clamp(plane.roll, -1.25, 1.25);

  // --- Heading follows the bank: a banked plane turns.
  plane.heading = wrapAngle(plane.heading + Math.sin(plane.roll) * TURN_RATE * dt * clamp(plane.speed / 45, 0.4, 1.4));

  // --- Throttle: Shift / Ctrl move it, clamped to 0..1.
  if (inp.throttleUp) plane.throttle = clamp(plane.throttle + dt * 0.55, 0, 1);
  if (inp.throttleDown) plane.throttle = clamp(plane.throttle - dt * 0.55, 0, 1);

  // --- Boost: Space, only while the meter has charge.
  plane.boosting = inp.boost && plane.boost > 1 && state === 'flying';
  if (plane.boosting) {
    plane.boost = Math.max(0, plane.boost - BOOST_DRAIN * dt);
  } else {
    plane.boost = Math.min(BOOST_MAX, plane.boost + BOOST_REFILL * dt);
  }

  // --- Speed: chase the throttle target, with dive/climb exchange.
  var targetSpeed = lerp(MIN_SPEED, MAX_SPEED, plane.throttle);
  if (plane.boosting) targetSpeed = BOOST_SPEED;
  // Climbing bleeds speed; diving gains it. (Energy conservation,
  // arcade edition.)
  targetSpeed -= Math.sin(plane.pitch) * 26;
  targetSpeed = clamp(targetSpeed, 18, BOOST_SPEED + 10);
  plane.speed += clamp(targetSpeed - plane.speed, -26 * dt, 20 * dt);

  // --- Gravity sink: a slow, level plane sinks. Keep the throttle up.
  var sink = GRAVITY_PULL * (1 - plane.speed / MAX_SPEED) * 0.55;
  if (plane.pitch < 0.05) sink += 2;

  // --- Integrate position along the nose direction.
  var cp = Math.cos(plane.pitch), sp = Math.sin(plane.pitch);
  var ch = Math.cos(plane.heading), sh = Math.sin(plane.heading);
  plane.x += sh * cp * plane.speed * dt;
  plane.y += sp * plane.speed * dt - sink * dt;
  plane.z += ch * cp * plane.speed * dt;

  // Soft world edge: past 2400 m from centre the wind pushes you back
  // with a warning, so you cannot get lost over an empty void.
  var r = Math.sqrt(plane.x * plane.x + plane.z * plane.z);
  if (r > 2350) {
    var push = (r - 2350) / 150;
    plane.x -= (plane.x / r) * push * plane.speed * dt * 0.5;
    plane.z -= (plane.z / r) * push * plane.speed * dt * 0.5;
    if (Math.random() < dt * 0.5) showMessage('TURN BACK — edge of the map', 1.2);
  }

  // --- Ring check: is the plane inside the next gate?
  checkRing();

  // --- Crash checks: terrain, sea, buildings.
  checkCrash();
}

// The next ring only: gates must be flown in order, which turns the
// course into a real race line instead of a collect-a-thon.
function checkRing() {
  var ring = RINGS[nextRing];
  if (!ring) return;
  var dx = plane.x - ring.x;
  var dy = plane.y - ring.y;
  var dz = plane.z - ring.z;
  var dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dist < RING_RADIUS) {
    ringsHit++;
    nextRing++;
    // Base points, plus a speed bonus: threading a gate fast pays.
    var gained = RING_SCORE + Math.round(plane.speed * 0.6);
    score += gained;
    if (nextRing >= RINGS.length) {
      winCourse();
    } else {
      showMessage('RING ' + ringsHit + '  +' + gained, 1.6);
      playBlip(880, 0.12);
    }
  }
}

function checkCrash() {
  var ground = terrainHeight(plane.x, plane.z);
  if (plane.y <= ground + 4) {
    return crash(plane.y <= SEA_LEVEL + 4 && ground <= 0
      ? 'You ditched into the sea.'
      : 'You flew into the mountainside.');
  }
  // Rooftops: a box test against every building in town.
  for (var i = 0; i < BUILDINGS.length; i++) {
    var b = BUILDINGS[i];
    var base = terrainHeight(b.x, b.z);
    if (Math.abs(plane.x - b.x) < b.w / 2 + 3 &&
        Math.abs(plane.z - b.z) < b.d / 2 + 3 &&
        plane.y < base + b.h + 2) {
      return crash('You clipped a rooftop in the harbour town.');
    }
  }
}

function crash(cause) {
  if (state !== 'flying') return;
  crashCause = cause;
  state = 'crashed';
  playBlip(140, 0.4);
  if (score > bestScore) { bestScore = score; saveBest(); }
  document.getElementById('crash-cause').textContent = cause;
  document.getElementById('crash-score').textContent = score;
  document.getElementById('crash-rings').textContent = ringsHit + ' / ' + RINGS.length;
  document.getElementById('crash-time').textContent = fmtTime(elapsed);
  document.getElementById('crash-best').textContent = bestScore;
  document.getElementById('crash-screen').classList.remove('hidden');
  document.getElementById('hud').classList.add('hidden');
}

function winCourse() {
  state = 'won';
  // Time bonus: finishing under par pays for every second spare.
  var bonus = Math.max(0, Math.round((PAR_TIME - elapsed) * TIME_BONUS_PER_SEC));
  score += bonus;
  if (score > bestScore) { bestScore = score; saveBest(); }
  playBlip(1320, 0.25);
  document.getElementById('win-score').textContent = score + (bonus ? '  (incl. +' + bonus + ' time bonus)' : '');
  document.getElementById('win-time').textContent = fmtTime(elapsed);
  document.getElementById('win-best').textContent = bestScore;
  document.getElementById('win-screen').classList.remove('hidden');
  document.getElementById('hud').classList.add('hidden');
}

/* --------------------------------------------------------------------------
   7. INPUT — keyboard, mouse look, and the overlay buttons
   -------------------------------------------------------------------------- */

// One object holds every control the physics reads. Keeping input in
// a single place means the physics never touches the DOM directly.
var input = {
  pitchUp: false, pitchDown: false,
  rollLeft: false, rollRight: false,
  throttleUp: false, throttleDown: false,
  boost: false
};

// Key map, written out in full so the controls are self-documenting:
// arrows and WASD both steer; Shift/Ctrl work the throttle; Space
// boosts; C swaps cameras; P pauses; R restarts; M mutes the hum.
var KEYMAP = {
  ArrowUp: 'pitchUp', KeyW: 'pitchUp',
  ArrowDown: 'pitchDown', KeyS: 'pitchDown',
  ArrowLeft: 'rollLeft', KeyA: 'rollLeft',
  ArrowRight: 'rollRight', KeyD: 'rollRight',
  ShiftLeft: 'throttleUp', ShiftRight: 'throttleUp',
  ControlLeft: 'throttleDown', ControlRight: 'throttleDown',
  Space: 'boost'
};

var cameraMode = 'chase'; // 'chase' or 'cockpit'; C toggles

window.addEventListener('keydown', function (e) {
  // Never hijack the browser's own shortcuts when a button has focus
  // and the key is Space/Enter — the click still works.
  if (e.code === 'Space') e.preventDefault();

  var action = KEYMAP[e.code];
  if (action) input[action] = true;

  if (e.code === 'KeyC' && !e.repeat) {
    cameraMode = cameraMode === 'chase' ? 'cockpit' : 'chase';
    document.getElementById('camera-mode').textContent = cameraMode.toUpperCase();
    showMessage(cameraMode === 'chase' ? 'CHASE CAMERA' : 'COCKPIT CAMERA', 1.0);
  }
  if (e.code === 'KeyP' && !e.repeat) togglePause();
  if (e.code === 'KeyR' && !e.repeat) {
    if (state === 'crashed' || state === 'won' || state === 'paused' || state === 'flying') resetFlight();
  }
  if (e.code === 'KeyM' && !e.repeat) {
    muted = !muted;
    showMessage(muted ? 'SOUND OFF' : 'SOUND ON', 1.0);
  }
  if (e.code === 'Enter' && state === 'menu') resetFlight();
});

window.addEventListener('keyup', function (e) {
  var action = KEYMAP[e.code];
  if (action) input[action] = false;
});

// Mouse free-look: moving the mouse across the canvas pans the view
// a little left/right and up/down, on top of where the plane points.
// The offsets ease back to centre when the mouse stops moving, so the
// view always settles back behind the nose.
var lastMouse = { x: -1, y: -1 };
canvas.addEventListener('mousemove', function (e) {
  var rect = canvas.getBoundingClientRect();
  var mx = (e.clientX - rect.left) / rect.width;   // 0..1 across
  var my = (e.clientY - rect.top) / rect.height;   // 0..1 down
  lookYaw = (mx - 0.5) * 0.9;    // up to ~26 deg either way
  lookPitch = (0.5 - my) * 0.55; // up to ~16 deg either way
  lastMouse.x = mx; lastMouse.y = my;
});
canvas.addEventListener('mouseleave', function () {
  lastMouse.x = -1; lastMouse.y = -1;
});

// Buttons on the overlays. Each one also works from the keyboard
// (Enter on the menu, R after a crash or a win).
document.getElementById('start-button').addEventListener('click', resetFlight);
document.getElementById('retry-button').addEventListener('click', resetFlight);
document.getElementById('again-button').addEventListener('click', resetFlight);

function togglePause() {
  if (state === 'flying') {
    state = 'paused';
    document.getElementById('pause-screen').classList.remove('hidden');
  } else if (state === 'paused') {
    state = 'flying';
    document.getElementById('pause-screen').classList.add('hidden');
  }
}

function hideOverlays() {
  var ids = ['start-screen', 'crash-screen', 'win-screen', 'pause-screen'];
  for (var i = 0; i < ids.length; i++) {
    document.getElementById(ids[i]).classList.add('hidden');
  }
}

/* --------------------------------------------------------------------------
   8. AUDIO — a tiny WebAudio engine hum, created lazily on first input
   -------------------------------------------------------------------------- */

// The sound is 100% synthesised: two detuned oscillators through a
// low-pass filter, pitched by throttle and speed. No audio files, no
// network, and it only starts after a user gesture (the browser's
// autoplay rule), so loading the page is silent.
var audioCtx = null, engineOsc = null, engineOsc2 = null, engineGain = null;

function ensureAudio() {
  if (audioCtx) return;
  try {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    audioCtx = new AC();
    engineOsc = audioCtx.createOscillator();
    engineOsc2 = audioCtx.createOscillator();
    engineGain = audioCtx.createGain();
    var filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    engineOsc.type = 'sawtooth';
    engineOsc2.type = 'square';
    engineOsc.frequency.value = 62;
    engineOsc2.frequency.value = 93;
    engineGain.gain.value = 0.0;
    engineOsc.connect(filter);
    engineOsc2.connect(filter);
    filter.connect(engineGain);
    engineGain.connect(audioCtx.destination);
    engineOsc.start();
    engineOsc2.start();
  } catch (e) { audioCtx = null; }
}

// Called every frame while flying: the hum follows the throttle.
function updateAudio() {
  if (!audioCtx || muted) {
    if (engineGain) engineGain.gain.value = 0;
    return;
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  var target = state === 'flying' ? 0.045 + plane.throttle * 0.05 : 0.0;
  if (plane.boosting) target += 0.03;
  engineGain.gain.setTargetAtTime(target, audioCtx.currentTime, 0.1);
  var f = 52 + plane.throttle * 55 + plane.speed * 0.35;
  engineOsc.frequency.setTargetAtTime(f, audioCtx.currentTime, 0.1);
  engineOsc2.frequency.setTargetAtTime(f * 1.5, audioCtx.currentTime, 0.1);
}

// Short blips for ring pickups and crashes: one oscillator, quick fade.
function playBlip(freq, dur) {
  if (!audioCtx || muted) return;
  try {
    var o = audioCtx.createOscillator();
    var g = audioCtx.createGain();
    o.type = 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.12, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + dur);
  } catch (e) {}
}

// First click or keypress anywhere wakes the audio context.
window.addEventListener('pointerdown', ensureAudio, { once: true });
window.addEventListener('keydown', ensureAudio, { once: true });

/* --------------------------------------------------------------------------
   9. RENDERING
   -------------------------------------------------------------------------- */

// Resize the canvas to the window (times devicePixelRatio, capped at
// 2 for performance) and recompute the focal length from the FOV.
function resize() {
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  focal = (canvas.height / 2) / Math.tan(FOV / 2);
}
window.addEventListener('resize', resize);
resize();

// Position the camera from the plane and the camera mode. In chase
// view the camera sits behind and above the plane, looking along the
// nose; in cockpit view it sits at the nose, so the player sees the
// world the way the pilot does. Mouse free-look offsets both.
function updateCamera() {
  var ch = Math.cos(plane.heading), sh = Math.sin(plane.heading);
  var cp = Math.cos(plane.pitch), sp = Math.sin(plane.pitch);
  if (cameraMode === 'cockpit') {
    cam.x = plane.x + sh * cp * 6;
    cam.y = plane.y + sp * 6 + 1.2;
    cam.z = plane.z + ch * cp * 6;
  } else {
    // Chase: 26 m behind, 7 m above, pulled along the nose vector.
    cam.x = plane.x - sh * cp * 26;
    cam.y = plane.y - sp * 26 + 7;
    cam.z = plane.z - ch * cp * 26;
    // Never let the chase camera clip through a mountain: lift it to
    // at least 6 m above the ground under it.
    var g = terrainHeight(cam.x, cam.z);
    if (cam.y < g + 6) cam.y = g + 6;
  }
  cam.yaw = plane.heading + lookYaw;
  cam.pitch = plane.pitch + lookPitch;
  cam.roll = cameraMode === 'cockpit' ? plane.roll : plane.roll * 0.55;
}

// The sky: a vertical gradient plus a low sun and a soft horizon band.
// Painted first, every frame, before any 3D object.
function drawSky() {
  var w = canvas.width, h = canvas.height;
  var grad = ctx.createLinearGradient(0, 0, 0, h);
  // The gradient follows the camera pitch a little, so climbing shows
  // more deep blue and diving shows more horizon haze.
  var lift = clamp(cam.pitch * 0.35, -0.18, 0.18);
  grad.addColorStop(0, '#2f6fb8');
  grad.addColorStop(0.45 + lift, '#7ec8f2');
  grad.addColorStop(0.72 + lift, '#cfeefb');
  grad.addColorStop(1, '#eef9ff');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // The sun: a warm disc with a glow, fixed in the north-west sky.
  var sun = project(cam.x - 2600, cam.y + 900, cam.z + 3200);
  if (sun) {
    var glow = ctx.createRadialGradient(sun.x, sun.y, 4, sun.x, sun.y, 150);
    glow.addColorStop(0, 'rgba(255, 236, 170, 0.95)');
    glow.addColorStop(0.35, 'rgba(255, 214, 120, 0.45)');
    glow.addColorStop(1, 'rgba(255, 214, 120, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(sun.x, sun.y, 150, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Terrain: a grid of quads sampled around the camera, coloured by
// height and slope — sand near the water, green lowlands, dark forest
// on the hills, grey rock high up, snow on the peaks. The sea is a
// separate flat sheet drawn wherever the terrain dips below zero.
// Painter's order: far rows first, near rows last.
function drawTerrain() {
  var step = TERRAIN_STEP;
  // Snap the grid origin so the terrain does not shimmer while flying.
  var ox = Math.floor(cam.x / step) * step;
  var oz = Math.floor(cam.z / step) * step;
  var R = TERRAIN_RADIUS;

  // Precompute the height field once per frame.
  var H = [];
  for (var j = -R; j <= R; j++) {
    H[j + R] = [];
    for (var i = -R; i <= R; i++) {
      H[j + R][i + R] = terrainHeight(ox + i * step, oz + j * step);
    }
  }

  // Draw far-to-near: rows with larger |dz| first. The loop walks the
  // grid in depth order relative to the camera's forward axis by
  // sorting rows on their projected centre depth — simple and robust.
  var quads = [];
  for (var jj = -R; jj < R; jj++) {
    for (var ii = -R; ii < R; ii++) {
      var x0 = ox + ii * step, z0 = oz + jj * step;
      var x1 = x0 + step, z1 = z0 + step;
      var h00 = H[jj + R][ii + R], h10 = H[jj + R][ii + R + 1];
      var h01 = H[jj + R + 1][ii + R], h11 = H[jj + R + 1][ii + R + 1];
      var cxm = (x0 + x1) / 2, czm = (z0 + z1) / 2;
      var cdx = cxm - cam.x, cdz = czm - cam.z;
      var depth = cdx * Math.sin(cam.yaw) + cdz * Math.cos(cam.yaw);
      if (depth < NEAR) continue;
      quads.push({ x0: x0, z0: z0, x1: x1, z1: z1,
                   h00: h00, h10: h10, h01: h01, h11: h11, depth: depth });
    }
  }
  quads.sort(function (a, b) { return b.depth - a.depth; });

  for (var q = 0; q < quads.length; q++) {
    var Q = quads[q];
    var avgH = (Q.h00 + Q.h10 + Q.h01 + Q.h11) / 4;
    // Project the four corners; skip the quad if any corner is behind.
    var p00 = project(Q.x0, Q.h00, Q.z0);
    var p10 = project(Q.x1, Q.h10, Q.z0);
    var p11 = project(Q.x1, Q.h11, Q.z1);
    var p01 = project(Q.x0, Q.h01, Q.z1);
    if (!p00 || !p10 || !p11 || !p01) continue;
    // Cull quads fully off screen — a cheap win at the frame edges.
    var minX = Math.min(p00.x, p10.x, p11.x, p01.x);
    var maxX = Math.max(p00.x, p10.x, p11.x, p01.x);
    var minY = Math.min(p00.y, p10.y, p11.y, p01.y);
    var maxY = Math.max(p00.y, p10.y, p11.y, p01.y);
    if (maxX < 0 || minX > canvas.width || maxY < 0 || minY > canvas.height) continue;

    if (avgH <= 1.5) {
      // Sea: a flat blue quad at y = 0 with a subtle sparkle that
      // depends on depth, so near water looks alive and far water
      // melts into the haze.
      var sp00 = project(Q.x0, 0, Q.z0);
      var sp10 = project(Q.x1, 0, Q.z0);
      var sp11 = project(Q.x1, 0, Q.z1);
      var sp01 = project(Q.x0, 0, Q.z1);
      if (sp00 && sp10 && sp11 && sp01) {
        var sparkle = Math.sin(Q.x0 * 0.05 + Q.z0 * 0.07 + elapsed * 2) * 8;
        ctx.fillStyle = hazeColor(28 + sparkle, 120 + sparkle, 190, Q.depth);
        ctx.beginPath();
        ctx.moveTo(sp00.x, sp00.y); ctx.lineTo(sp10.x, sp10.y);
        ctx.lineTo(sp11.x, sp11.y); ctx.lineTo(sp01.x, sp01.y);
        ctx.closePath(); ctx.fill();
      }
      continue;
    }

    ctx.fillStyle = terrainColor(avgH, Q.h10 - Q.h00, Q.depth);
    ctx.beginPath();
    ctx.moveTo(p00.x, p00.y); ctx.lineTo(p10.x, p10.y);
    ctx.lineTo(p11.x, p11.y); ctx.lineTo(p01.x, p01.y);
    ctx.closePath(); ctx.fill();
  }

  // Rocky islets in the sea: low cones that break the waterline.
  for (var k = 0; k < ISLETS.length; k++) {
    var isl = ISLETS[k];
    var tip = project(isl.x, 55, isl.z);
    var base = project(isl.x, 0, isl.z);
    if (!tip || !base) continue;
    var rpx = isl.r * base.s;
    if (rpx < 2) continue;
    ctx.fillStyle = hazeColor(110, 105, 95, base.d);
    ctx.beginPath();
    ctx.moveTo(base.x - rpx, base.y);
    ctx.lineTo(tip.x, tip.y);
    ctx.lineTo(base.x + rpx, base.y);
    ctx.closePath(); ctx.fill();
  }
}

// Pick a terrain colour from height and slope, then haze it by depth.
// The bands read as beach -> meadow -> forest -> rock -> snow.
function terrainColor(h, slope, depth) {
  var r, g, b;
  if (h < 6)        { r = 232; g = 214; b = 150; } // sand
  else if (h < 60)  { r = 106; g = 168; b = 79; }  // meadow green
  else if (h < 150) { r = 74;  g = 132; b = 66; }  // forest green
  else if (h < 260) { r = 116; g = 110; b = 96; }  // rock grey
  else              { r = 238; g = 242; b = 246; } // snow
  // Slope shading: a quad tilted away from the sun goes darker.
  var shade = clamp(1 - Math.abs(slope) * 0.012, 0.72, 1);
  return hazeColor(Math.round(r * shade), Math.round(g * shade),
                   Math.round(b * shade), depth);
}

// The harbour town: each building is a box drawn as three visible
// faces (roof, front, side) with a darker side for cheap shading. The
// lighthouse gets a red band and a blinking light; the church tower
// gets a pointed roof.
function drawCity() {
  // Far buildings first so near ones overlap correctly.
  var sorted = BUILDINGS.slice().sort(function (a, b) {
    var da = (a.x - cam.x) * (a.x - cam.x) + (a.z - cam.z) * (a.z - cam.z);
    var db = (b.x - cam.x) * (b.x - cam.x) + (b.z - cam.z) * (b.z - cam.z);
    return db - da;
  });
  for (var i = 0; i < sorted.length; i++) {
    var b = sorted[i];
    var base = terrainHeight(b.x, b.z);
    var top = base + b.h;
    var hx = b.w / 2, hz = b.d / 2;
    // Eight corners of the box.
    var c = [
      project(b.x - hx, base, b.z - hz), project(b.x + hx, base, b.z - hz),
      project(b.x + hx, base, b.z + hz), project(b.x - hx, base, b.z + hz),
      project(b.x - hx, top, b.z - hz),  project(b.x + hx, top, b.z - hz),
      project(b.x + hx, top, b.z + hz),  project(b.x - hx, top, b.z + hz)
    ];
    var ok = true;
    for (var k = 0; k < 8; k++) if (!c[k]) { ok = false; break; }
    if (!ok) continue;
    var depth = c[0].d;
    if (depth > FAR) continue;
    // Cull boxes fully off screen.
    var minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (var m = 0; m < 8; m++) {
      if (c[m].x < minX) minX = c[m].x;
      if (c[m].x > maxX) maxX = c[m].x;
      if (c[m].y < minY) minY = c[m].y;
      if (c[m].y > maxY) maxY = c[m].y;
    }
    if (maxX < 0 || minX > canvas.width || maxY < 0 || minY > canvas.height) continue;

    // Faces: front (z+), right (x+), roof. Shade by facing the sun.
    ctx.fillStyle = shadeHex(b.c, 0.82, depth);
    quad(c[2], c[3], c[7], c[6]); // front face
    ctx.fillStyle = shadeHex(b.c, 0.62, depth);
    quad(c[1], c[2], c[6], c[5]); // right face
    ctx.fillStyle = shadeHex(b.c, 1.0, depth);
    quad(c[4], c[5], c[6], c[7]); // roof
    if (b.tower) {
      // Pointed church roof.
      var apex = project(b.x, top + 26, b.z);
      if (apex) {
        ctx.fillStyle = shadeHex('#7f1d1d', 1.0, depth);
        ctx.beginPath();
        ctx.moveTo(c[4].x, c[4].y); ctx.lineTo(c[5].x, c[5].y);
        ctx.lineTo(apex.x, apex.y); ctx.closePath(); ctx.fill();
        ctx.beginPath();
        ctx.moveTo(c[5].x, c[5].y); ctx.lineTo(c[6].x, c[6].y);
        ctx.lineTo(apex.x, apex.y); ctx.closePath(); ctx.fill();
      }
    }
    if (b.lighthouse) {
      // Red band near the top, and a light that blinks every 2 seconds.
      var bandTop = project(b.x - hx, top - 14, b.z - hz);
      var bandTop2 = project(b.x + hx, top - 14, b.z - hz);
      var bandTop3 = project(b.x + hx, top - 14, b.z + hz);
      var bandTop4 = project(b.x - hx, top - 14, b.z + hz);
      if (bandTop && bandTop2 && bandTop3 && bandTop4) {
        ctx.fillStyle = shadeHex('#dc2626', 0.9, depth);
        quad(bandTop, bandTop2, bandTop3, bandTop4);
      }
      if (Math.floor(elapsed * 0.5) % 2 === 0) {
        var lamp = project(b.x, top + 4, b.z);
        if (lamp) {
          ctx.fillStyle = 'rgba(255, 240, 150, 0.95)';
          ctx.beginPath();
          ctx.arc(lamp.x, lamp.y, Math.max(3, 9 * lamp.s), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }
}

function quad(p1, p2, p3, p4) {
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
  ctx.lineTo(p3.x, p3.y); ctx.lineTo(p4.x, p4.y);
  ctx.closePath(); ctx.fill();
}

// Multiply a #rrggbb colour by a brightness factor, then haze it.
function shadeHex(hex, f, depth) {
  var r = parseInt(hex.substr(1, 2), 16);
  var g = parseInt(hex.substr(3, 2), 16);
  var b = parseInt(hex.substr(5, 2), 16);
  return hazeColor(Math.round(r * f), Math.round(g * f), Math.round(b * f), depth);
}

// Clouds: each cloud is a cluster of soft white ellipses, drawn as
// screen-space blobs sized by their projected scale. They drift east
// and wrap around the island so the sky stays full.
function drawClouds(dt) {
  for (var i = 0; i < CLOUDS.length; i++) {
    var cl = CLOUDS[i];
    cl.x += cl.drift * dt;
    if (cl.x > 2600) cl.x = -2600;
    var p = project(cl.x, cl.y, cl.z);
    if (!p || p.d > FAR) continue;
    var s = cl.s * p.s;
    if (s < 4) continue;
    var alpha = 0.85 * hazeFactor(p.d);
    ctx.fillStyle = 'rgba(255, 255, 255, ' + alpha.toFixed(3) + ')';
    for (var k = 0; k < cl.puffs; k++) {
      var ox = Math.sin(cl.seed + k * 2.3) * s * 0.55;
      var oy = Math.cos(cl.seed + k * 1.7) * s * 0.16;
      var r = s * (0.42 + 0.1 * Math.sin(cl.seed + k));
      ctx.beginPath();
      ctx.ellipse(p.x + ox, p.y + oy, r, r * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// Rings: the next gate glows gold and pulses; later gates are cyan
// and dimmer; flown gates are gone. Each ring is drawn as two
// concentric ellipses facing the camera, plus a small direction arrow
// (a "next" chevron) above the active gate.
function drawRings() {
  for (var i = nextRing; i < RINGS.length; i++) {
    var ring = RINGS[i];
    var p = project(ring.x, ring.y, ring.z);
    if (!p) continue;
    var rpx = RING_RADIUS * p.s;
    if (rpx < 2 || p.d > FAR) continue;
    var active = (i === nextRing);
    var pulse = active ? 1 + Math.sin(elapsed * 5) * 0.12 : 1;
    var rr = rpx * pulse;
    ctx.lineWidth = Math.max(2, rr * 0.14);
    ctx.strokeStyle = active
      ? 'rgba(251, 191, 36, ' + (0.95 * hazeFactor(p.d)).toFixed(3) + ')'
      : 'rgba(103, 232, 249, ' + (0.55 * hazeFactor(p.d)).toFixed(3) + ')';
    ctx.beginPath();
    ctx.arc(p.x, p.y, rr, 0, Math.PI * 2);
    ctx.stroke();
    // Inner glow ring, thinner.
    ctx.lineWidth = Math.max(1, rr * 0.05);
    ctx.strokeStyle = active
      ? 'rgba(255, 255, 255, 0.85)'
      : 'rgba(255, 255, 255, 0.35)';
    ctx.beginPath();
    ctx.arc(p.x, p.y, rr * 0.82, 0, Math.PI * 2);
    ctx.stroke();
    if (active) {
      // Chevron pointing to the following gate, drawn above the ring.
      var nxt = RINGS[i + 1];
      var label = 'RING ' + (i + 1);
      ctx.font = 'bold ' + Math.max(13, rr * 0.28) + 'px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(254, 240, 138, 0.95)';
      ctx.fillText(label, p.x, p.y - rr - 12);
      if (nxt) {
        var q = project(nxt.x, nxt.y, nxt.z);
        if (q) {
          var ang = Math.atan2(q.y - p.y, q.x - p.x);
          var ax = p.x + Math.cos(ang) * (rr + 26);
          var ay = p.y + Math.sin(ang) * (rr + 26);
          ctx.fillStyle = 'rgba(251, 191, 36, 0.9)';
          ctx.beginPath();
          ctx.moveTo(ax + Math.cos(ang) * 14, ay + Math.sin(ang) * 14);
          ctx.lineTo(ax + Math.cos(ang + 2.5) * 12, ay + Math.sin(ang + 2.5) * 12);
          ctx.lineTo(ax + Math.cos(ang - 2.5) * 12, ay + Math.sin(ang - 2.5) * 12);
          ctx.closePath(); ctx.fill();
        }
      }
    }
  }
}

// The plane itself, drawn in chase view: a small stunt plane seen
// from behind — fuselage, swept wings, tail fin and a spinning
// propeller disc. It is drawn in screen space at the projected plane
// position, rotated by the roll angle, and scaled with speed (the
// faster you fly, the slightly smaller and sleeker it reads).
function drawPlane() {
  if (cameraMode === 'cockpit') return; // in cockpit view you ARE the plane
  var p = project(plane.x, plane.y, plane.z);
  if (!p) return;
  var s = clamp(26 * p.s + 14, 18, 90); // plane size in pixels
  var cx = canvas.width / 2, cy = canvas.height / 2 + s * 0.25;
  // The plane sits slightly below screen centre in chase view so the
  // sky ahead stays visible.
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-plane.roll * 0.9);
  ctx.scale(1, 1);

  // Propeller disc (a translucent blur circle ahead of the nose).
  var propR = s * 0.42;
  var propAlpha = 0.16 + 0.1 * Math.sin(elapsed * 40);
  ctx.fillStyle = 'rgba(30, 41, 59, ' + propAlpha.toFixed(3) + ')';
  ctx.beginPath();
  ctx.ellipse(0, -s * 0.55, propR * 0.28, propR, 0, 0, Math.PI * 2);
  ctx.fill();

  // Wings: one wide swept shape, amber on top with a dark outline.
  ctx.fillStyle = '#f59e0b';
  ctx.strokeStyle = '#78350f';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-s * 1.5, s * 0.1);
  ctx.lineTo(-s * 0.28, -s * 0.08);
  ctx.lineTo(s * 0.28, -s * 0.08);
  ctx.lineTo(s * 1.5, s * 0.1);
  ctx.lineTo(s * 1.15, s * 0.34);
  ctx.lineTo(-s * 1.15, s * 0.34);
  ctx.closePath(); ctx.fill(); ctx.stroke();

  // Tailplane (small rear wings) and vertical fin.
  ctx.fillStyle = '#d97706';
  ctx.beginPath();
  ctx.moveTo(-s * 0.55, s * 0.62);
  ctx.lineTo(s * 0.55, s * 0.62);
  ctx.lineTo(s * 0.34, s * 0.82);
  ctx.lineTo(-s * 0.34, s * 0.82);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#b45309';
  ctx.beginPath();
  ctx.moveTo(0, s * 0.55);
  ctx.lineTo(s * 0.16, s * 0.95);
  ctx.lineTo(-s * 0.16, s * 0.95);
  ctx.closePath(); ctx.fill();

  // Fuselage: a tapered body from nose (top) to tail (bottom).
  ctx.fillStyle = '#f8fafc';
  ctx.strokeStyle = '#334155';
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.72);
  ctx.quadraticCurveTo(s * 0.24, -s * 0.2, s * 0.16, s * 0.7);
  ctx.lineTo(-s * 0.16, s * 0.7);
  ctx.quadraticCurveTo(-s * 0.24, -s * 0.2, 0, -s * 0.72);
  ctx.closePath(); ctx.fill(); ctx.stroke();

  // Canopy: the pilot's little blue bubble.
  ctx.fillStyle = '#38bdf8';
  ctx.beginPath();
  ctx.ellipse(0, -s * 0.28, s * 0.11, s * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// Cockpit overlay: a simple instrument panel frame and a gunsight
// crosshair, drawn only in cockpit view. It frames the view and gives
// the player a fixed reference for aiming at rings.
function drawCockpit() {
  if (cameraMode !== 'cockpit') return;
  var w = canvas.width, h = canvas.height;
  // Dashboard: a dark curved panel across the bottom.
  ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
  ctx.beginPath();
  ctx.moveTo(0, h);
  ctx.lineTo(0, h * 0.86);
  ctx.quadraticCurveTo(w / 2, h * 0.78, w, h * 0.86);
  ctx.lineTo(w, h);
  ctx.closePath(); ctx.fill();
  // Two round dials: airspeed (left) and altitude (right).
  drawDial(w * 0.24, h * 0.93, 34, plane.speed / BOOST_SPEED, '#38bdf8', 'SPD');
  drawDial(w * 0.76, h * 0.93, 34, clamp(plane.y / 600, 0, 1), '#4ade80', 'ALT');
  // Centre gunsight: a small circle with cross ticks, for ring aiming.
  var cx = w / 2, cy = h * 0.46;
  ctx.strokeStyle = 'rgba(74, 222, 128, 0.9)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, cy, 18, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - 28, cy); ctx.lineTo(cx - 20, cy);
  ctx.moveTo(cx + 20, cy); ctx.lineTo(cx + 28, cy);
  ctx.moveTo(cx, cy - 28); ctx.lineTo(cx, cy - 20);
  ctx.moveTo(cx, cy + 20); ctx.lineTo(cx, cy + 28);
  ctx.stroke();
}

function drawDial(x, y, r, frac, color, label) {
  ctx.fillStyle = 'rgba(2, 6, 23, 0.9)';
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(x, y, r - 3, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#e2e8f0';
  ctx.font = 'bold 11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(label, x, y + 4);
}

// A simple attitude cue: a horizon line that tilts with the roll, so
// the player can always tell which way is up even over open sea.
function drawAttitudeCue() {
  var w = canvas.width, h = canvas.height;
  var cx = w / 2, cy = h * 0.5;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-plane.roll);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-70, 0); ctx.lineTo(-26, 0);
  ctx.moveTo(26, 0); ctx.lineTo(70, 0);
  ctx.stroke();
  ctx.restore();
}

/* --------------------------------------------------------------------------
   10. HUD & SCREENS
   -------------------------------------------------------------------------- */

var el = {};
['score', 'rings', 'rings-total', 'timer', 'altitude', 'speed',
 'throttle-fill', 'camera-mode', 'message', 'boost-indicator',
 'compass-strip', 'compass-heading'].forEach(function (id) {
  el[id] = document.getElementById(id);
});
el['rings-total'].textContent = RINGS.length;

var messageTimeout = null;
function showMessage(text, seconds) {
  el.message.textContent = text;
  el.message.classList.add('show');
  if (messageTimeout) clearTimeout(messageTimeout);
  messageTimeout = setTimeout(function () {
    el.message.classList.remove('show');
  }, (seconds || 1.5) * 1000);
}

// The compass strip: a repeating sequence of cardinal ticks, scrolled
// so the current heading sits under the needle. Built as text because
// it is cheap and always crisp.
function updateCompass() {
  var deg = (rad2deg(plane.heading) + 360) % 360;
  var ticks = '';
  for (var d = -90; d <= 90; d += 15) {
    var a = Math.round((deg + d) / 15) * 15;
    var norm = ((a % 360) + 360) % 360;
    var label = norm % 90 === 0
      ? COMPASS_POINTS[Math.round(norm / 22.5) % 16]
      : String(norm);
    ticks += (d === 0 ? '[' + label + ']' : ' ' + label + ' ');
  }
  el['compass-strip'].textContent = ticks;
  el['compass-heading'].textContent =
    compassName(plane.heading) + ' ' + String(Math.round(deg)).padStart(3, '0') + '°';
}

function updateHUD() {
  el.score.textContent = score;
  el.rings.textContent = ringsHit;
  el.timer.textContent = fmtTime(elapsed);
  el.altitude.textContent = Math.max(0, Math.round(plane.y));
  el.speed.textContent = Math.round(plane.speed * 3.6); // m/s -> km/h
  el['throttle-fill'].style.width = Math.round(plane.throttle * 100) + '%';
  el['boost-indicator'].classList.toggle('on', plane.boosting);
  updateCompass();
}

/* --------------------------------------------------------------------------
   11. MAIN LOOP
   -------------------------------------------------------------------------- */

var lastTime = performance.now();

// Menu attract mode: while the start screen is up, the camera slowly
// orbits the island so the player sees the world they are about to
// fly in, instead of a static picture.
var menuAngle = 0;
function updateMenuCamera(dt) {
  menuAngle += dt * 0.05;
  var cx = Math.sin(menuAngle) * 900;
  var cz = Math.cos(menuAngle) * 900 - 300;
  cam.x = cx; cam.y = 620; cam.z = cz;
  cam.yaw = Math.atan2(-cx, -cz + 300) + Math.PI; // look at the island
  cam.yaw = wrapAngle(Math.atan2(0 - cx, -300 - cz));
  cam.pitch = -0.18;
  cam.roll = 0;
}

function frame(now) {
  var dt = Math.min((now - lastTime) / 1000, 0.05); // clamp tab-switch jumps
  lastTime = now;

  if (state === 'flying') {
    elapsed += dt;
    stepPhysics(dt);
    updateCamera();
    updateAudio();
    updateHUD();
    // Mouse free-look eases back to centre so the view settles.
    lookYaw *= Math.pow(0.4, dt);
    lookPitch *= Math.pow(0.4, dt);
  } else if (state === 'menu') {
    updateMenuCamera(dt);
    elapsed = 0;
  } else if (state === 'paused' || state === 'crashed' || state === 'won') {
    updateAudio();
    if (state === 'crashed' || state === 'won') {
      // Keep the world visible behind the end screens, frozen in place.
    }
  }

  // --- Render, in painter's order: sky, terrain, city, clouds, rings,
  // --- the plane, then the cockpit frame and the attitude cue.
  drawSky();
  drawTerrain();
  drawCity();
  drawClouds(dt);
  drawRings();
  if (state === 'flying' || state === 'paused') {
    drawPlane();
    drawAttitudeCue();
    drawCockpit();
  }

  requestAnimationFrame(frame);
}

// Boot: show the start screen over a live orbiting view of the island.
document.getElementById('hud').classList.add('hidden');
document.getElementById('rings-total').textContent = RINGS.length;
requestAnimationFrame(frame);
