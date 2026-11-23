// ============================================================
//  TAPPYCAT — sim.js  (Phase 0, DSDA Arcade Challenges)
//
//  Pure game logic. No DOM, no three.js, no WebGL, no audio, no
//  window. The cabinet (index.html) and the Phase-2 replayd both
//  import this file at the same git sha.
//
//  Contract:
//      TappySim.init(seed)          -> state
//      TappySim.step(state, bits)   -> mutates state one 1/60 s tick
//                                      bits: 0/1  (1 = flap, edge-consumed)
//      TappySim.score(state)        -> int
//      TappySim.done(state)         -> null | 'bonk' | 'fall' | 'dog'
//
//  Determinism rules (spec + grade fixes 2026-11-23):
//    * ONE sim rate: 60 Hz, pinned. Same in log, sim and replayd.
//    * mulberry32 for ALL state randomness (identical to the v1
//      cabinet PRNG — same function, same call order).
//    * Fixed-point sin LUT (256 x int16, hardcoded below) wherever
//      trig feeds state: bird swoop path, dog bob. Math.sqrt is
//      allowed (exact across engines).
//    * Time comes from ticks only. No Date.now / performance.now.
//    * Inputs are per-tick bits; a pending flap is consumed by the
//      FIRST step() that runs (see index.html accumulator).
//
//  State vs cosmetic: everything that feeds score, collisions,
//  spawns or death is in here. Audio, particles, fur, camera,
//  squash, blink, mockery text and the scenery stay in the
//  renderer.
// ============================================================
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.TappySim = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const HZ = 60;
    const DT = 1 / HZ;

    // Physics & hitboxes — values unchanged from v1 (leaderboard-comparable)
    const CAT_X = -4;
    const GRAVITY = -35;
    const JUMP_FORCE = 13.5;
    const BASE_SPEED = 8;
    const CEILING = 8;

    // --- fixed-point sin LUT: 256 entries, int16, ±32767 -------------
    // Hardcoded so browser and Node build the identical table byte for
    // byte (no Math.sin at load time in either).
    const SIN = new Int16Array([
        0, 804, 1608, 2410, 3212, 4011, 4808, 5602, 6393, 7179, 7962, 8739, 9512, 10278, 11039, 11793,
        12539, 13279, 14010, 14732, 15446, 16151, 16846, 17530, 18204, 18868, 19519, 20159, 20787, 21403, 22005, 22594,
        23170, 23731, 24279, 24811, 25329, 25832, 26319, 26790, 27245, 27683, 28105, 28510, 28898, 29268, 29621, 29956,
        30273, 30571, 30852, 31113, 31356, 31580, 31785, 31971, 32137, 32285, 32412, 32521, 32609, 32678, 32728, 32757,
        32767, 32757, 32728, 32678, 32609, 32521, 32412, 32285, 32137, 31971, 31785, 31580, 31356, 31113, 30852, 30571,
        30273, 29956, 29621, 29268, 28898, 28510, 28105, 27683, 27245, 26790, 26319, 25832, 25329, 24811, 24279, 23731,
        23170, 22594, 22005, 21403, 20787, 20159, 19519, 18868, 18204, 17530, 16846, 16151, 15446, 14732, 14010, 13279,
        12539, 11793, 11039, 10278, 9512, 8739, 7962, 7179, 6393, 5602, 4808, 4011, 3212, 2410, 1608, 804,
        0, -804, -1608, -2410, -3212, -4011, -4808, -5602, -6393, -7179, -7962, -8739, -9512, -10278, -11039, -11793,
        -12539, -13279, -14010, -14732, -15446, -16151, -16846, -17530, -18204, -18868, -19519, -20159, -20787, -21403, -22005, -22594,
        -23170, -23731, -24279, -24811, -25329, -25832, -26319, -26790, -27245, -27683, -28105, -28510, -28898, -29268, -29621, -29956,
        -30273, -30571, -30852, -31113, -31356, -31580, -31785, -31971, -32137, -32285, -32412, -32521, -32609, -32678, -32728, -32757,
        -32767, -32757, -32728, -32678, -32609, -32521, -32412, -32285, -32137, -31971, -31785, -31580, -31356, -31113, -30852, -30571,
        -30273, -29956, -29621, -29268, -28898, -28510, -28105, -27683, -27245, -26790, -26319, -25832, -25329, -24811, -24279, -23731,
        -23170, -22594, -22005, -21403, -20787, -20159, -19519, -18868, -18204, -17530, -16846, -16151, -15446, -14732, -14010, -13279,
        -12539, -11793, -11039, -10278, -9512, -8739, -7962, -7179, -6393, -5602, -4808, -4011, -3212, -2410, -1608, -804
    ]);
    function sinLUT(x) {
        let f = (x / 6.283185307179586) % 1;
        if (f < 0) f += 1;
        return SIN[(f * 256) | 0] / 32767;
    }

    // Same PRNG as the v1 cabinet (line 831) — same function, same
    // call order, so a given seed reproduces the v1 random stream.
    function mulberry32(a) {
        return function () {
            a |= 0; a = a + 0x6D2B79F5 | 0;
            let t = Math.imul(a ^ a >>> 15, 1 | a);
            t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }

    function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
    function lerp(a, b, p) { return a + (b - a) * p; }

    // ------------------------------------------------------------
    //  init(seed) — the safe-start runway, exactly as startGame()
    //  built it: long freebie ledge under the cat, then a fair
    //  runway. Starter length 7 is fixed; the other three lengths
    //  are rolled (state), in creation order.
    // ------------------------------------------------------------
    function init(seed) {
        const s = {
            seed: seed >>> 0,
            rng: mulberry32(seed >>> 0),
            state: 'PLAYING',
            reason: null,
            tick: 0,
            score: 0,
            streak: 0,
            // cat (x is the constant CAT_X)
            catY: -0.25,          // starter ledge y=-1.2 + 0.95
            catV: 0,
            grounded: true,
            airTime: 0,
            grace: 1.0,           // seconds of spawn protection
            // spawning
            spawnTimer: 0,
            lastSpawnY: -0.4,
            worldSpeed: BASE_SPEED,
            cuks: [],             // {id, x, y, len, scored, skipped}
            dogs: [],             // {id, x, y, baseY, t, barked2, dodged}
            dogTimer: 0,
            // bird
            birdTimer: 5,
            swoop: null,          // {t, dur, baseY}
            events: [],
            nextId: 1,
        };
        s.cuks.push({ id: s.nextId++, x: CAT_X, y: -1.2, len: 7, scored: true, skipped: false });
        s.cuks.push({ id: s.nextId++, x: 4,  y: -0.8, len: 3.5 + s.rng() * 1.5, scored: false, skipped: false });
        s.cuks.push({ id: s.nextId++, x: 11, y: 0.2,  len: 3.5 + s.rng() * 1.5, scored: false, skipped: false });
        s.cuks.push({ id: s.nextId++, x: 18, y: -0.4, len: 3.5 + s.rng() * 1.5, scored: false, skipped: false });
        s.events.push({ type: 'cuke', id: 1, len: 7, scored: true });
        s.events.push({ type: 'cuke', id: 2, len: s.cuks[1].len, scored: false });
        s.events.push({ type: 'cuke', id: 3, len: s.cuks[2].len, scored: false });
        s.events.push({ type: 'cuke', id: 4, len: s.cuks[3].len, scored: false });
        return s;
    }

    // ------------------------------------------------------------
    //  step(s, inputBits) — one 1/60 s tick.
    //  Order mirrors the v1 frame: grace, speed, flap, gravity +
    //  ceiling, spawn, cucumber motion + collision, airTime, void,
    //  bird, dogs.
    // ------------------------------------------------------------
    function step(s, inputBits) {
        if (s.state !== 'PLAYING') return;
        const dt = DT;

        if (s.grace > 0) s.grace -= dt;

        const speed = BASE_SPEED + Math.min(s.score * 0.07, 6);
        s.worldSpeed = speed;

        // Flap — edge-consumed by the caller (first step after press)
        if (inputBits & 1) {
            s.catV = JUMP_FORCE;
            s.grounded = false;
        }

        // Gravity + ceiling
        s.catV += GRAVITY * dt;
        s.catY += s.catV * dt;
        if (s.catY > CEILING) {
            s.catY = CEILING;
            if (s.catV > 0) s.catV = 0;
        }

        // Spawning — interval tightens as score climbs
        s.spawnTimer += dt;
        const interval = Math.max(1.05, 1.7 - s.score * 0.012);
        if (s.spawnTimer > interval) {
            s.spawnTimer = 0;
            const len = 3.5 + s.rng() * 1.5;
            const y = clamp(s.lastSpawnY + (s.rng() * 5.2 - 3.0), -2.5, 5);
            s.lastSpawnY = y;
            s.cuks.push({ id: s.nextId++, x: 22, y: y, len: len, scored: false, skipped: false });
            s.events.push({ type: 'cuke', id: s.nextId - 1, len: len, scored: false });
        }

        // Cucumber movement + collision
        const wasGrounded = s.grounded;
        s.grounded = false;
        const catBottom = s.catY - 0.5;
        const catTop = s.catY + 0.5;

        for (let i = s.cuks.length - 1; i >= 0; i--) {
            const c = s.cuks[i];
            c.x -= speed * dt;
            const halfLen = c.len / 2;
            const top = c.y + 0.45;
            const bottom = c.y - 0.45;
            const overlapX = Math.abs(CAT_X - c.x) < halfLen + 0.6;

            if (overlapX) {
                // Landing: falling onto the top face, generous window
                if (s.catV <= 0 && catBottom <= top + 0.15 && catBottom >= top - 0.95) {
                    s.catY = top + 0.5;
                    s.catV = 0;
                    s.grounded = true;
                    if (!wasGrounded && s.airTime > 0.15) {
                        s.events.push({ type: 'land', x: CAT_X, y: top });
                    }
                    if (!c.scored) {
                        c.scored = true;
                        s.streak++;
                        const pts = Math.min(s.streak, 5);
                        s.score += pts;
                        s.events.push({ type: 'score', pts: pts, streak: s.streak, x: c.x, y: top, score: s.score });
                    }
                }
                // Bonk: slamming into the side/underside
                else if (s.grace <= 0 && catBottom < top - 0.95 && catTop > bottom) {
                    s.state = 'GAMEOVER';
                    s.reason = 'bonk';
                    s.events.push({ type: 'over', reason: 'bonk' });
                    return;
                }
            }

            // Skipped a cucumber without landing → combo breaks
            if (!c.scored && !c.skipped && c.x + halfLen < CAT_X - 1.5) {
                c.skipped = true;
                if (s.streak >= 2) s.events.push({ type: 'combo-lost', x: c.x, y: c.y, streak: s.streak });
                s.streak = 0;
            }

            if (c.x < -16) s.cuks.splice(i, 1);
        }

        s.airTime = s.grounded ? 0 : s.airTime + dt;

        // The void
        if (s.catY < -10) {
            s.state = 'GAMEOVER';
            s.reason = 'fall';
            s.events.push({ type: 'over', reason: 'fall' });
            return;
        }

        // Bird — swoop position uses the sin LUT (feeds the +10 pounce)
        if (s.swoop) {
            const sw = s.swoop;
            sw.t += dt;
            const p = sw.t / sw.dur;
            if (p >= 1) {
                s.swoop = null;
                s.birdTimer = 0;
            } else {
                const bx = lerp(18, -14, p);
                const by = sw.baseY + sinLUT(p * 6.283185307179586) * 2;
                const dx = bx - CAT_X;
                const dy = by - s.catY;
                if (Math.sqrt(dx * dx + dy * dy) < 1.4) {
                    s.score += 10;
                    s.swoop = null;
                    s.birdTimer = -4;   // longer cooldown after a catch
                    s.events.push({ type: 'gotcha', x: bx, y: by, score: s.score });
                }
            }
        } else {
            s.birdTimer += dt;
            // Per-tick re-roll on the seeded stream (grade fix #2):
            // v1 re-rolled every frame; at 60 Hz sim == 60 Hz frame.
            if (s.birdTimer > 9 + s.rng() * 5) {
                s.swoop = { t: 0, dur: 3.2, baseY: s.rng() * 4 };
                s.events.push({ type: 'swoop-start', baseY: s.swoop.baseY });
            }
        }

        // Dogs — score >= 6
        if (s.score >= 6) {
            s.dogTimer += dt;
            const dInterval = Math.max(5, 10 - s.score * 0.06);
            if (s.dogTimer > dInterval) {
                s.dogTimer = 0;
                const y = clamp(s.catY + (s.rng() * 4 - 2), -1.5, 6);
                s.dogs.push({ id: s.nextId++, x: 26, y: y, baseY: y, t: 0, barked2: false, dodged: false });
                s.events.push({ type: 'dog', id: s.nextId - 1, y: y });
            }
        }
        for (let i = s.dogs.length - 1; i >= 0; i--) {
            const d = s.dogs[i];
            d.t += dt;
            d.x -= speed * 1.7 * dt;
            d.y = d.baseY + sinLUT(d.t * 3) * 0.5;

            if (!d.barked2 && d.x < 9) {
                d.barked2 = true;
                s.events.push({ type: 'bark2', x: d.x, y: d.y });
            }

            // Collision — hop over or duck under!
            if (s.grace <= 0) {
                const dx = d.x - CAT_X;
                const dy = d.y - s.catY;
                if (Math.sqrt(dx * dx + dy * dy) < 1.2) {
                    s.state = 'GAMEOVER';
                    s.reason = 'dog';
                    s.events.push({ type: 'over', reason: 'dog', dogId: d.id });
                    return;
                }
            }

            // Clean dodge = bonus
            if (!d.dodged && d.x < CAT_X - 2.5) {
                d.dodged = true;
                s.score += 2;
                s.events.push({ type: 'dodge', x: d.x, y: d.y, score: s.score });
            }

            if (d.x < -18) s.dogs.splice(i, 1);
        }

        s.tick++;
    }

    function score(s) { return s.score; }
    function done(s) { return s.state === 'GAMEOVER' ? s.reason : null; }

    return { HZ: HZ, DT: DT, CAT_X: CAT_X, init: init, step: step, score: score, done: done, sinLUT: sinLUT };
});
