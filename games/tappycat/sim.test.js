// ============================================================
//  TAPPYCAT sim — equivalence + determinism test
//
//  Proves sim.js is behaviourally identical to the v1 cabinet
//  physics when v1 runs at exactly 60 Hz (fixed delta = 1/60):
//  same formulas, same order, same PRNG stream (mulberry32 in
//  place of Math.random), with only the sin LUT quantization as
//  an allowed deviation on trig-fed positions (bird/dog).
//
//  Run:  node sim.test.js
// ============================================================
'use strict';
const sim = require('./sim.js');

// --- v1 constants (unchanged from index.html) ---
const CAT_X = -4, GRAVITY = -35, JUMP_FORCE = 13.5, BASE_SPEED = 8, CEILING = 8;
function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
function mulberry32(a) {
    return function () {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

// --- v1 state machine, transcribed from index.html (state parts only) ---
// Math.random -> the seeded stream; THREE.MathUtils.clamp -> clamp.
function v1Init(seed) {
    const v = {
        rng: mulberry32(seed >>> 0),
        gameState: 'PLAYING', score: 0, streak: 0,
        catY: -0.25, catV: 0, grounded: true, airTime: 0, grace: 1.0,
        spawnTimer: 0, lastSpawnY: -0.4, worldSpeed: BASE_SPEED,
        cuks: [], dogs: [], dogTimer: 0,
        birdTimer: 5, swoop: null,
    };
    v.cuks.push({ x: CAT_X, y: -1.2, len: 7, scored: true, skipped: false });
    v.cuks.push({ x: 4,  y: -0.8, len: 3.5 + v.rng() * 1.5, scored: false, skipped: false });
    v.cuks.push({ x: 11, y: 0.2,  len: 3.5 + v.rng() * 1.5, scored: false, skipped: false });
    v.cuks.push({ x: 18, y: -0.4, len: 3.5 + v.rng() * 1.5, scored: false, skipped: false });
    return v;
}
function v1Step(v, delta, inputBit) {
    if (v.gameState !== 'PLAYING') return;
    if (v.grace > 0) v.grace -= delta;
    const speed = BASE_SPEED + Math.min(v.score * 0.07, 6);
    v.worldSpeed = speed;
    if (inputBit & 1) { v.catV = JUMP_FORCE; v.grounded = false; }
    v.catV += GRAVITY * delta;
    v.catY += v.catV * delta;
    if (v.catY > CEILING) { v.catY = CEILING; if (v.catV > 0) v.catV = 0; }
    v.spawnTimer += delta;
    const interval = Math.max(1.05, 1.7 - v.score * 0.012);
    if (v.spawnTimer > interval) {
        v.spawnTimer = 0;
        const len = 3.5 + v.rng() * 1.5;
        const y = clamp(v.lastSpawnY + (v.rng() * 5.2 - 3.0), -2.5, 5);
        v.lastSpawnY = y;
        v.cuks.push({ x: 22, y: y, len: len, scored: false, skipped: false });
    }
    const wasGrounded = v.grounded;
    v.grounded = false;
    const catBottom = v.catY - 0.5, catTop = v.catY + 0.5;
    for (let i = v.cuks.length - 1; i >= 0; i--) {
        const c = v.cuks[i];
        c.x -= speed * delta;
        const halfLen = c.len / 2;
        const top = c.y + 0.45, bottom = c.y - 0.45;
        const overlapX = Math.abs(CAT_X - c.x) < halfLen + 0.6;
        if (overlapX) {
            if (v.catV <= 0 && catBottom <= top + 0.15 && catBottom >= top - 0.95) {
                v.catY = top + 0.5; v.catV = 0; v.grounded = true;
                if (!c.scored) { c.scored = true; v.streak++; v.score += Math.min(v.streak, 5); }
            } else if (v.grace <= 0 && catBottom < top - 0.95 && catTop > bottom) {
                v.gameState = 'GAMEOVER'; v.reason = 'bonk'; return;
            }
        }
        if (!c.scored && !c.skipped && c.x + halfLen < CAT_X - 1.5) { c.skipped = true; v.streak = 0; }
        if (c.x < -16) v.cuks.splice(i, 1);
    }
    v.airTime = v.grounded ? 0 : v.airTime + delta;
    if (v.catY < -10) { v.gameState = 'GAMEOVER'; v.reason = 'fall'; return; }
    if (v.swoop) {
        v.swoop.t += delta;
        const p = v.swoop.t / v.swoop.dur;
        if (p >= 1) { v.swoop = null; v.birdTimer = 0; }
        else {
            const bx = 18 + (p * (-14 - 18));
            const by = v.swoop.baseY + Math.sin(p * Math.PI * 2) * 2;
            const dx = bx - CAT_X, dy = by - v.catY;
            if (Math.sqrt(dx * dx + dy * dy) < 1.4) {
                v.score += 10; v.swoop = null; v.birdTimer = -4;
            }
        }
    } else {
        v.birdTimer += delta;
        if (v.birdTimer > 9 + v.rng() * 5) {
            v.swoop = { t: 0, dur: 3.2, baseY: v.rng() * 4 };
        }
    }
    if (v.score >= 6) {
        v.dogTimer += delta;
        const dInterval = Math.max(5, 10 - v.score * 0.06);
        if (v.dogTimer > dInterval) {
            v.dogTimer = 0;
            const y = clamp(v.catY + (v.rng() * 4 - 2), -1.5, 6);
            v.dogs.push({ x: 26, y: y, baseY: y, t: 0, barked2: false, dodged: false });
        }
    }
    for (let i = v.dogs.length - 1; i >= 0; i--) {
        const d = v.dogs[i];
        d.t += delta;
        d.x -= speed * 1.7 * delta;
        d.y = d.baseY + Math.sin(d.t * 3) * 0.5;
        if (!d.barked2 && d.x < 9) d.barked2 = true;
        if (v.grace <= 0) {
            const dx = d.x - CAT_X, dy = d.y - v.catY;
            if (Math.sqrt(dx * dx + dy * dy) < 1.2) { v.gameState = 'GAMEOVER'; v.reason = 'dog'; return; }
        }
        if (!d.dodged && d.x < CAT_X - 2.5) { d.dodged = true; v.score += 2; }
        if (d.x < -18) v.dogs.splice(i, 1);
    }
}

// --- driver ---
function play(v1, s, events, maxTicks) {
    let bits = 0, ei = 0;
    for (let t = 0; t < maxTicks; t++) {
        while (ei < events.length && events[ei][0] === t) { bits = events[ei][1]; ei++; }
        v1Step(v1, 1 / 60, bits);
        sim.step(s, bits);
        if (v1.gameState !== 'PLAYING' || s.state !== 'PLAYING') return t;
    }
    return maxTicks;
}

// Pseudo-random flap scripts: deterministic, varied rhythm per seed
function flapScript(seed, maxTicks) {
    const r = mulberry32(seed);
    const ev = [[0, 0]];
    let t = 0, bit = 0;
    while (t < maxTicks) {
        t += 15 + (r() * 40) | 0;
        bit = bit ? 0 : 1;
        if (t < maxTicks) ev.push([t, bit]);
    }
    return ev;
}

let failures = 0;
function check(name, cond, detail) {
    if (!cond) { failures++; console.log('FAIL', name, detail || ''); }
    else console.log('ok  ', name);
}

// Test 1: equivalence, 5 seeds x 3 scripts, up to 60 s each
for (let seed = 1; seed <= 5; seed++) {
    for (let script = 0; script < 3; script++) {
        const v1 = v1Init(seed * 7919 + script);
        const s = sim.init(seed * 7919 + script);
        const ev = flapScript(seed * 131 + script, 3600);
        const endTick = play(v1, s, ev, 3600);
        const sameEnd = (v1.gameState === s.state);
        const sameScore = (v1.score === s.score);
        const sameCatY = Math.abs(v1.catY - s.catY) < 1e-9;
        // cuke positions: exact (no trig in cuke path)
        let cukeOK = v1.cuks.length === s.cuks.length;
        if (cukeOK) for (let i = 0; i < v1.cuks.length; i++) {
            if (Math.abs(v1.cuks[i].x - s.cuks[i].x) > 1e-9 || Math.abs(v1.cuks[i].y - s.cuks[i].y) > 1e-9 || v1.cuks[i].len !== s.cuks[i].len) cukeOK = false;
        }
        check(`eq seed=${seed} scr=${script}`, sameEnd && sameScore && sameCatY && cukeOK,
            JSON.stringify({ v1: { st: v1.gameState, sc: v1.score, y: v1.catY }, sim: { st: s.state, sc: s.score, y: s.catY }, endTick }));
    }
}

// Test 2: determinism — identical seed+inputs => identical result (3x)
{
    const ev = flapScript(42, 3600);
    const runs = [];
    for (let i = 0; i < 3; i++) {
        const s = sim.init(42);
        let bits = 0, ei = 0;
        for (let t = 0; t < 3600 && s.state === 'PLAYING'; t++) {
            while (ei < ev.length && ev[ei][0] === t) { bits = ev[ei][1]; ei++; }
            sim.step(s, bits);
        }
        runs.push(JSON.stringify({ score: s.score, ticks: s.tick, reason: s.reason, catY: s.catY }));
    }
    check('determinism 3x', runs[0] === runs[1] && runs[1] === runs[2], runs[0]);
}

// Test 3: physics sanity — cat falls without flapping, dies by bonk/fall early
{
    const s = sim.init(12345);
    for (let t = 0; t < 3600 && s.state === 'PLAYING'; t++) sim.step(s, 0);
    check('no-flap dies early', s.state === 'GAMEOVER' && s.tick < 300, JSON.stringify({ tick: s.tick, reason: s.reason }));
}

// Test 4: a skilled flapper survives and scores (catY band check)
// Feedback policy with hysteresis (deterministic, state-driven):
// flap when falling below the low line, re-arm only above the high
// line — keeps the cat in the cucumber band without thrashing.
{
    const s = sim.init(999);
    let minY = 99, maxY = -99, landed = false, armed = true;
    for (let t = 0; t < 3600 && s.state === 'PLAYING'; t++) {
        let bit = 0;
        if (armed && s.catV < -1.5 && s.catY < 0.6) { bit = 1; armed = false; }
        if (s.catY > 1.9) armed = true;
        sim.step(s, bit);
        minY = Math.min(minY, s.catY); maxY = Math.max(maxY, s.catY);
        if (s.grounded && s.streak > 0) landed = true;
    }
    check('flapper playable (lands, scores, survives 5s)',
        s.tick >= 300 && s.score > 0 && landed,
        JSON.stringify({ state: s.state, score: s.score, ticks: s.tick, band: [minY, maxY] }));
}

// Test 5: dog + dodge + bird paths actually execute.
// Part A: force a high score so dogs spawn; run the hysteresis flapper
// long enough to cross dogs (spawn, bark2, swoop/gotcha all in this path).
// Part B: deterministic dodge — seed one dog on a LOW lane (y=-1.5) and
// hold the cat HIGH (catY~5), so the dog passes clear and trips the
// clean-dodge +2 at x < CAT_X-2.5 with no collision.
{
    const s = sim.init(777);
    s.score = 50;                      // dogs spawn at score >= 6
    let sawDog = false, sawGotcha = false, sawSwoop = false, sawBark2 = false;
    let armed = true;
    for (let t = 0; t < 7200 && s.state === 'PLAYING'; t++) {
        let bit = 0;
        if (armed && s.catV < -1.5 && s.catY < 0.6) { bit = 1; armed = false; }
        if (s.catY > 1.9) armed = true;
        sim.step(s, bit);
        for (const e of s.events) {
            if (e.type === 'dog') sawDog = true;
            if (e.type === 'gotcha') sawGotcha = true;
            if (e.type === 'swoop-start') sawSwoop = true;
            if (e.type === 'bark2') sawBark2 = true;
        }
        s.events.length = 0;
    }
    const partA = sawDog && sawSwoop && sawBark2;

    // Part B: deterministic clean dodge
    const s2 = sim.init(888);
    s2.score = 50;
    s2.catY = 5; s2.catV = 0; s2.grounded = false;
    s2.dogs.push({ id: 900, x: 26, y: -1.5, baseY: -1.5, t: 0, barked2: true, dodged: false });
    let sawDodge = false, dodgedScore = s2.score;
    let armedB = true;
    for (let t = 0; t < 3600 && s2.state === 'PLAYING'; t++) {
        // hold the cat high: flap when falling below 4.5
        let bit = 0;
        if (armedB && s2.catV < -1.0 && s2.catY < 4.5) { bit = 1; armedB = false; }
        if (s2.catY > 5.5) armedB = true;
        sim.step(s2, bit);
        for (const e of s2.events) if (e.type === 'dodge') { sawDodge = true; dodgedScore = s2.score; }
        s2.events.length = 0;
        if (sawDodge) break;
    }
    const partB = sawDodge && dodgedScore > 50;   // +2 from the clean dodge

    check('dog/dodge/bird paths', partA && partB,
        JSON.stringify({ partA: { dog: sawDog, swoop: sawSwoop, bark2: sawBark2, gotcha: sawGotcha }, partB: { sawDodge, dodgedScore }, aState: s.state, bState: s2.state }));
}

// Test 6: score() / done() contract
{
    const s = sim.init(5);
    check('contract', sim.score(s) === 0 && sim.done(s) === null && sim.HZ === 60 && sim.DT === 1 / 60);
    sim.step(s, 0);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
