// DropBlock sim.test.js — equivalence gate: the pure 60 Hz sim vs REAL v1.
// The reference is the actual v1 code sliced from `git show c0e30ea:games/dropblock/index.html`
// (v1ref.js) — onKey/onKeyUp/update/spawnPiece/tryMove/hardDrop/lockPiece/findMatches/
// startClear/finishClear/gameOver/restRowFor/bumpLevel run verbatim in Node with
// THREE/sfx/DOM stubbed. Not a second transcription.
//
// Same seed, same input event stream, every tick compared: grid (colors), score, combo,
// level, fallingSpeed, phase, falling (col, color, y), nextColor, maxChain.
// v1 keeps its time-based mechanics (DAS 0.13/0.055 keyboard, 0.22/0.09 touch,
// clearDur 0.38, settle lerp) — the sim quantizes them to ticks, and this test proves
// the quantization is exactly equivalent at 60 Hz.
//
// Modes: 'keyboard' (DAS 8/4 ticks) and 'touch' (DAS 14/6 ticks = 0.22/0.09 s @ 60 Hz).
// Also asserts the 90-tick settle cap NEVER fires (v1 has no cap; worst case ~31 ticks).
'use strict';
const Sim = require('./sim.js');
const V1 = require('./v1ref.js');

const TICKS_PER_RUN = 20000;
const RUNS_PER_MODE = 200;
const Y_EPS = 1e-9;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------- deterministic human-ish input bot ----------------
function makeBot(seed) {
  const r = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  const events = {};
  let t = 12 + ((r() * 30) | 0);
  while (t < TICKS_PER_RUN) {
    const roll = r();
    let key;
    if (roll < 0.30) key = 'left';
    else if (roll < 0.60) key = 'right';
    else if (roll < 0.75) key = 'down';
    else key = 'hard';
    (events[t] = events[t] || []).push({ key, type: 'down' });
    if (key !== 'hard') {
      const dur = key === 'down' ? 3 + ((r() * 40) | 0) : 1 + ((r() * 14) | 0);
      const up = t + dur;
      if (up < TICKS_PER_RUN) (events[up] = events[up] || []).push({ key, type: 'up' });
    }
    t += 2 + ((r() * 12) | 0);
  }
  const keys = Object.keys(events).map(Number).sort((a, b) => a - b);
  return { keys, events, i: 0 };
}

// 7-bit encoding: press bits = keydown this tick; hold bits = FINAL held state
// after the tick's events (sub-tick press+release → press=1, hold=0).
function toBits(events, prev) {
  let lP = 0, lH = prev.l, rP = 0, rH = prev.r, dP = 0, dH = prev.d, hP = 0;
  for (const e of events) {
    if (e.key === 'left') { lP = 1; lH = e.type === 'down' ? 1 : 0; }
    else if (e.key === 'right') { rP = 1; rH = e.type === 'down' ? 1 : 0; }
    else if (e.key === 'down') { dP = 1; dH = e.type === 'down' ? 1 : 0; }
    else if (e.key === 'hard') hP = 1;
  }
  return (lP | (lH << 1) | (rP << 2) | (rH << 3) | (dP << 4) | (dH << 5) | (hP << 6));
}

function gridColors(g) {
  return g.map(row => row.map(c => (c ? c.color : -1)));
}

function drive(seed, mode) {
  const ref = V1.create(seed, mode);
  ref.start();
  const s = Sim.init(seed, mode === 'touch' ? { dasInit: 14, dasRep: 6 } : {});
  Sim.start(s);
  const bot = makeBot(seed);

  let prev = { l: false, r: false, d: false };
  for (let t = 1; t <= TICKS_PER_RUN; t++) {
    while (bot.i < bot.keys.length && bot.keys[bot.i] <= t) bot.i++;
    const due = bot.keys[bot.i] === t ? (bot.events[t] || []) : [];
    const bits = toBits(due, prev);

    ref.tick(due);
    Sim.step(s, bits);

    prev = { l: ref.state.heldLeft, r: ref.state.heldRight, d: ref.state.keysDown.has('down') };

    const rs = ref.state;
    const problems = [];
    if (JSON.stringify(gridColors(rs.grid)) !== JSON.stringify(gridColors(s.grid))) problems.push('grid');
    if (rs.score !== s.score) problems.push('score ' + rs.score + '!=' + s.score);
    if (rs.combo !== s.combo) problems.push('combo');
    if (rs.level !== s.level) problems.push('level');
    if (Math.abs(rs.fallingSpeed - s.fallingSpeed) > 1e-9) problems.push('fallingSpeed');
    if (rs.phase !== s.phase) problems.push('phase ' + rs.phase + '!=' + s.phase);
    if (rs.nextColor !== s.nextColor) problems.push('nextColor');
    if (rs.maxChain !== s.maxChain) problems.push('maxChain');
    if ((rs.falling === null) !== (s.falling === null)) problems.push('falling-null');
    else if (rs.falling) {
      if (rs.falling.col !== s.falling.col) problems.push('col');
      if (rs.falling.color !== s.falling.color) problems.push('color');
      if (Math.abs(rs.falling.y - s.falling.y) > Y_EPS) problems.push('y ' + rs.falling.y + '!=' + s.falling.y);
    }
    if (problems.length) {
      return { ok: false, seed, mode, t, problems,
        v1Grid: gridColors(rs.grid).slice(0, 4), simGrid: gridColors(s.grid).slice(0, 4),
        v1Score: rs.score, simScore: s.score, v1Phase: rs.phase, simPhase: s.phase, due, bits };
    }
    if (rs.phase === 'over' && s.phase === 'over') {
      return { ok: true, seed, mode, t, over: true, score: s.score, settleCap: s.settleCap };
    }
  }
  return { ok: true, seed, mode, t: TICKS_PER_RUN, score: s.score, settleCap: s.settleCap };
}

// ---------------- run the matrix ----------------
const results = { keyboard: [], touch: [] };
const firstFails = { keyboard: null, touch: null };
let settleCapTotal = 0, overCount = 0, tickTotal = 0;

for (let i = 0; i < RUNS_PER_MODE; i++) {
  const seed = 100000 + i * 7919 + 1;
  for (const mode of ['keyboard', 'touch']) {
    const res = drive(seed, mode);
    results[mode].push(res);
    if (!res.ok && !firstFails[mode]) firstFails[mode] = res;
    if (res.over) overCount++;
    tickTotal += res.t;
    settleCapTotal += res.settleCap;
  }
}

const report = {
  v1Sha: V1.SHA,
  runsPerMode: RUNS_PER_MODE,
  ticksPerRun: TICKS_PER_RUN,
  totalTicks: tickTotal,
  settleCapFires: settleCapTotal,
  gameOverRuns: overCount,
  results: {},
  firstFailures: firstFails,
};
for (const mode of ['keyboard', 'touch']) {
  const fails = results[mode].filter(r => !r.ok);
  report.results[mode] = {
    runs: results[mode].length,
    pass: results[mode].length - fails.length,
    fail: fails.length,
    maxScore: Math.max(...results[mode].map(r => r.score || 0)),
  };
}
const pass = report.results.keyboard.fail === 0 && report.results.touch.fail === 0 && settleCapTotal === 0;
console.log(JSON.stringify({ pass, ...report }, null, 1));
process.exit(pass ? 0 : 1);
