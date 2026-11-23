// DropBlock sim — pure deterministic 60 Hz. House rules (Phase 0): no DOM/three/audio/window,
// one mulberry32 for all state randomness, tick-only time, per-tick input bitmask (7 bits):
//   bit0 left press · bit1 left held (final) · bit2 right press · bit3 right held (final)
//   bit4 down press · bit5 down held (final) · bit6 hard drop press
// press bit = a keydown event arrived this tick (v1 keydown: immediate move + DAS re-arm);
// hold bit = the key's FINAL held state after all events of the tick. A sub-tick
// press+release yields press=1, hold=0 — v1's immediate move and re-arm both happen,
// which a pure level mask would lose.
//
// v1 functions are COPIED from games/dropblock/index.html @ c0e30ea (state lines verbatim;
// mesh/audio/FX lines stripped — the grid stores {color, ty} | null, exactly v1's shape,
// so findMatches/restRowFor/tryMove/finishClear run the same code as v1).
// Time quantization (v1 @ 60 Hz, measured): DAS keyboard 0.13/0.055 s → 8/4 ticks;
// touch 0.22/0.09 s → 14/6 ticks; clear 0.38 s → 23 ticks; settle = v1's per-tick lerp
// (convergence depends on fall distance, ~30 ticks worst case) with snap + 90-tick cap.
// Genesis lock: mechanic changes need Cory's sign-off.

(function (root) {
  'use strict';

  const COLS = 6, ROWS = 12, CELL = 1.0;
  const CLEAR_TICKS = 23;
  const SETTLE_CAP = 90;
  const TICK = 1 / 60;
  // DAS defaults = keyboard (v1 0.13/0.055 s @ 60 Hz). Touch: init(seed, { dasInit: 14, dasRep: 6 }).
  const DAS_INIT = 8, DAS_REP = 4;

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function init(seed, opts) {
    opts = opts || {};
    return {
      tick: 0,
      grid: Array.from({ length: ROWS }, () => Array(COLS).fill(null)), // {color, ty} | null
      falling: null,            // { color, col, y }
      nextColor: -1,
      score: 0, combo: 0, level: 0, fallingSpeed: 2.3,
      phase: 'menu',            // menu | falling | clearing | settling | over
      clearTicks: 0, settleTicks: 0, softAcc: 0,
      settle: null,             // "r,c" → current y during settling (v1 lerp)
      clearList: null,          // [r, c][] while clearing (renderer FX)
      maxChain: 0, settleCap: 0,
      heldL: false, heldR: false, softHeld: false,
      dasInit: opts.dasInit || DAS_INIT, dasRep: opts.dasRep || DAS_REP,
      moveTimer: 0, moveArmed: false, heldDir: 0,
      _rng: mulberry32(seed >>> 0),
    };
  }

  function start(s) {
    s.grid = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    s.falling = null; s.nextColor = -1;
    s.score = 0; s.combo = 0; s.level = 0; s.fallingSpeed = 2.3;
    s.softAcc = 0; s.moveTimer = 0; s.moveArmed = false; s.heldDir = 0;
    s.heldL = false; s.heldR = false; s.softHeld = false;
    s.clearTicks = 0; s.settleTicks = 0; s.clearList = null; s.settle = null;
    s.maxChain = 0; s.settleCap = 0; s.tick = 0;
    spawnPiece(s);
  }

  // ---- v1 functions (state lines verbatim from c0e30ea; FX lines stripped) ----

  function restRowFor(s, col) {
    for (let r = ROWS - 1; r >= 0; r--) if (s.grid[r][col]) return r + 1;
    return 0;
  }

  function spawnPiece(s) {
    const col = (s._rng() * COLS) | 0;
    if (s.grid[ROWS - 1][col]) { gameOver(s); return; }
    if (s.nextColor < 0) s.nextColor = (s._rng() * 6) | 0;
    const color = s.nextColor;
    s.nextColor = (s._rng() * 6) | 0;
    const y = ROWS * CELL + 1.4;
    s.falling = { color, col, y };
    s.phase = 'falling';
  }

  function tryMove(s, dir) {
    if (s.phase !== 'falling' || !s.falling) return;
    const nc = s.falling.col + dir;
    if (nc < 0 || nc >= COLS) return;
    // collide against the piece's CURRENT bottom row, not its landing row,
    // so a piece can slide over shorter stacks to reach the side lanes
    const r = Math.min(ROWS - 1, Math.max(0, Math.floor(s.falling.y - 0.5)));
    if (s.grid[r][nc]) return;
    s.falling.col = nc;
  }

  function hardDrop(s) {
    if (s.phase !== 'falling' || !s.falling) return;
    const row = restRowFor(s, s.falling.col);
    const ty = row * CELL + CELL / 2;
    s.falling.y = ty;
    s.score += 2;
    lockPiece(s);
  }

  function lockPiece(s) {
    const row = restRowFor(s, s.falling.col);
    if (row >= ROWS) {
      s.falling = null;
      gameOver(s);
      return;
    }
    s.grid[row][s.falling.col] = { color: s.falling.color, ty: row * CELL + CELL / 2 };
    s.falling = null;
    const m = findMatches(s);
    if (m.size) startClear(s, m, 1);
    else spawnPiece(s);
  }

  // byte-for-byte v1 findMatches (grid/ROWS/COLS only — no THREE, no DOM)
  function findMatches(s) {
    const matched = new Set();
    const scanRun = (cells) => {
      let run = 1;
      for (let i = 1; i <= cells.length; i++) {
        const same = i < cells.length
          && s.grid[cells[i][0]][cells[i][1]] && s.grid[cells[i - 1][0]][cells[i - 1][1]]
          && s.grid[cells[i][0]][cells[i][1]].color === s.grid[cells[i - 1][0]][cells[i - 1][1]].color;
        if (same) run++;
        else {
          if (run >= 3) for (let k = i - run; k < i; k++) matched.add(cells[k][0] + ',' + cells[k][1]);
          run = 1;
        }
      }
    };
    // horizontal
    for (let r = 0; r < ROWS; r++) scanRun(Array.from({ length: COLS }, (_, c) => [r, c]));
    // vertical
    for (let c = 0; c < COLS; c++) scanRun(Array.from({ length: ROWS }, (_, r) => [r, c]));
    // diagonals (both directions)
    for (let d = -(COLS - 1); d < ROWS; d++) { // r - c = d  (top-left → bottom-right)
      const cells = [];
      for (let r = 0; r < ROWS; r++) { const c = r - d; if (c >= 0 && c < COLS) cells.push([r, c]); }
      if (cells.length >= 3) scanRun(cells);
    }
    for (let ssum = 0; ssum < ROWS + COLS - 1; ssum++) { // r + c = s  (top-right → bottom-left)
      const cells = [];
      for (let r = 0; r < ROWS; r++) { const c = ssum - r; if (c >= 0 && c < COLS) cells.push([r, c]); }
      if (cells.length >= 3) scanRun(cells);
    }
    return matched;
  }

  function startClear(s, matched, n) {
    s.combo = n;
    s.score += matched.size * 10 * n;
    s.phase = 'clearing';
    s.clearTicks = 0;
    s.clearList = [...matched].map(k => { const i = k.indexOf(','); return [k.slice(0, i) | 0, k.slice(i + 1) | 0]; });
    if (n > s.maxChain) s.maxChain = n;
  }

  // v1 finishClear compaction verbatim + settle bookkeeping (old y per cell)
  function finishClear(s) {
    for (const [r, c] of s.clearList) s.grid[r][c] = null;
    s.clearList = null;
    s.settle = {};
    for (let c = 0; c < COLS; c++) {
      let w = 0;
      for (let r = 0; r < ROWS; r++) {
        const cd = s.grid[r][c];
        if (!cd) continue;
        s.settle[w + ',' + c] = r * CELL + CELL / 2; // old row center = where the mesh rests
        s.grid[r][c] = null;
        s.grid[w][c] = cd;
        cd.ty = w * CELL + CELL / 2;
        w++;
      }
    }
    s.phase = 'settling';
    s.settleTicks = 0;
  }

  function gameOver(s) {
    s.phase = 'over';
    s.falling = null;
  }

  function bumpLevel(s) {
    const lv = Math.min(12, Math.floor(s.score / 400));
    if (lv !== s.level) {
      s.level = lv;
      s.fallingSpeed = 2.3 + s.level * 0.55;
    }
  }

  // ---- 60 Hz step (v1 update() state logic, dt = TICK) ----

  function step(s, bits) {
    bits |= 0;
    if (s.phase === 'over' || s.phase === 'menu') { s.tick++; return; }

    // input (v1 keydown/keyup semantics): press = keydown event this tick → immediate
    // move + DAS re-arm; hold = final held state after the tick's events.
    const lPress = bits & 1, lHold = bits & 2;
    const rPress = bits & 4, rHold = bits & 8;
    const dPress = bits & 16, dHold = bits & 32;
    const hard = bits & 64;
    if (lPress && s.phase === 'falling' && s.falling) {
      s.heldDir = -1;
      tryMove(s, -1);
      s.moveTimer = 0; s.moveArmed = false;
    }
    if (rPress && s.phase === 'falling' && s.falling) {
      s.heldDir = 1;
      tryMove(s, 1);
      s.moveTimer = 0; s.moveArmed = false;
    }
    s.heldL = !!lHold; s.heldR = !!rHold; s.softHeld = !!dHold;
    if (!s.heldL && !s.heldR) { s.moveTimer = 0; s.moveArmed = false; }
    if (hard && s.phase === 'falling' && s.falling) hardDrop(s);

    if (s.phase === 'falling' && s.falling) {
      const dir = (s.heldL && !s.heldR) ? -1 : (s.heldR && !s.heldL) ? 1 : (s.heldL && s.heldR ? s.heldDir : 0);
      if (dir !== 0) {
        s.moveTimer += 1;
        if (s.moveTimer >= (s.moveArmed ? s.dasRep : s.dasInit)) {
          tryMove(s, dir);
          s.moveTimer = 0; s.moveArmed = true;
        }
      } else {
        s.moveTimer = 0; s.moveArmed = false;
      }
      const v = s.fallingSpeed * (s.softHeld ? 6 : 1);
      s.falling.y -= v * TICK;
      if (s.softHeld) {
        s.softAcc += v * TICK;
        while (s.softAcc >= 1) { s.softAcc -= 1; s.score += 1; }
      }
      const row = restRowFor(s, s.falling.col);
      const ty = row * CELL + CELL / 2;
      if (s.falling.y <= ty) lockPiece(s);
    } else if (s.phase === 'clearing') {
      s.clearTicks++;
      if (s.clearTicks >= CLEAR_TICKS) finishClear(s);
    } else if (s.phase === 'settling') {
      s.settleTicks++;
      let all = true;
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        const cd = s.grid[r][c];
        if (!cd) continue;
        const key = r + ',' + c;
        const dy = cd.ty - s.settle[key];
        if (Math.abs(dy) > 0.004) {
          all = false;
          s.settle[key] += dy * Math.min(1, TICK * 14);
        } else if (dy !== 0) {
          s.settle[key] = cd.ty;
        }
      }
      if (all || s.settleTicks >= SETTLE_CAP) {
        if (s.settleTicks >= SETTLE_CAP) s.settleCap++;
        s.settle = {};
        const m = findMatches(s);
        if (m.size) startClear(s, m, s.combo + 1);
        else { s.combo = 0; spawnPiece(s); }
      }
    }

    bumpLevel(s);
    s.tick++;
  }

  const score = (s) => s.score;
  const done = (s) => s.phase === 'over';

  const api = { init, start, step, score, done, COLS, ROWS, CELL,
    DAS_INIT, DAS_REP, CLEAR_TICKS, SETTLE_CAP };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DropBlockSim = api;
})(typeof window !== 'undefined' ? window : globalThis);
