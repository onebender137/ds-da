// v1ref.js — the REAL v1 reference for the DropBlock sim equivalence gate.
// Slices the actual functions out of `git show c0e30ea:games/dropblock/index.html`
// (pre-sim-extraction, unmodified v1) and runs them in a Node vm context with
// THREE/sfx/DOM stubbed. The 200-run compare is sim vs v1 — not sim vs a transcription.
//
// Extracted verbatim: onKey, onKeyUp, update, spawnPiece, tryMove, hardDrop,
// lockPiece, findMatches, startClear, finishClear, gameOver, restRowFor,
// bumpLevel, setDanger + the real state declarations and constants.
// Math.random is replaced with mulberry32(seed).
'use strict';
const { execSync } = require('child_process');
const vm = require('vm');

const SHA = 'c0e30ea11d59d263713d6c65d3b85d65e3648c71';
const REPO = '/home/coryr/ds-da';
// SHA is a hardcoded constant, not user input — shell interpolation is safe here
const SRC = execSync(`git show ${SHA}:games/dropblock/index.html`, { cwd: REPO, maxBuffer: 16 * 1024 * 1024 }).toString();

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function extractFn(name) {
  const m = SRC.indexOf('function ' + name + '(');
  if (m < 0) throw new Error('function not found: ' + name);
  const i = SRC.indexOf('{', m);
  let depth = 0;
  for (let j = i; j < SRC.length; j++) {
    if (SRC[j] === '{') depth++;
    else if (SRC[j] === '}') { depth--; if (depth === 0) return SRC.slice(m, j + 1); }
  }
  throw new Error('unbalanced braces: ' + name);
}

function extractLine(prefix) {
  const i = SRC.indexOf(prefix);
  if (i < 0) throw new Error('line not found: ' + prefix);
  const e = SRC.indexOf(';\n', i);
  return SRC.slice(i, e + 1);
}

function extractBlock(startPrefix, endPrefix) {
  const a = SRC.indexOf(startPrefix);
  if (a < 0) throw new Error('block start not found: ' + startPrefix);
  const b = SRC.indexOf(endPrefix, a);
  if (b < 0) throw new Error('block end not found: ' + endPrefix);
  return SRC.slice(a, b + endPrefix.length);
}

// ---- real v1 constants + state declarations ----
const CONSTS =
  extractLine('const COLS = 6') + '\n' +
  extractBlock('const COLORS = [', '];') + '\n' +
  extractLine('const xOf = col');

const STATE = extractBlock('// ---------------- game state ----------------',
  'let nextColor = -1, previewMesh = null, previewLabel = null;');

// ---- THREE / DOM / sfx stubs ----
function makeStubs() {
  class V3 {
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
    copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
    add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
    multiplyScalar(k) { this.x *= k; this.y *= k; this.z *= k; return this; }
    applyAxisAngle() { return this; }
    clone() { return new V3(this.x, this.y, this.z); }
  }
  const meshStub = () => ({
    position: { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
    rotation: { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
    scale: { s: 1, setScalar(v) { this.s = v; } },
    material: { opacity: 0 },
    visible: true,
  });
  const elStub = () => ({
    classList: { toggle() { }, add() { }, remove() { }, contains() { return false; } },
    style: { display: '' },
    textContent: '',
    value: '',
    disabled: false,
    focus() { },
  });
  const noop = () => { };
  return {
    THREE: { Vector3: V3 },
    makeCandy: meshStub,
    flashMats: [0, 1, 2, 3, 4, 5].map(() => ({ opacity: 0 })),
    boardGroup: { add: noop, remove: noop },
    scene: { remove: noop },
    camera: { position: new V3(), lookAt: noop },
    sfx: { on: true, ensure: noop, move: noop, hardDrop: noop, lock: noop, match: noop, over: noop, levelUp: noop, danger: noop, chainBig: noop, newHigh: noop },
    Vocals: { on: true, play: noop, match: noop },
    MusicSys: { on: true, tryStart: noop, next: noop, stop: noop },
    DSDARadio: null,
    buzz: noop, shake: noop, squash: noop,
    spawnDust: noop, spawnBurst: noop, spawnRing: noop, spawnFloatText: noop,
    showBanner: noop, updateHud: noop, updatePreview: noop,
    track: noop, countUp: noop,
    loadScores: () => [], renderTopList: noop, dsdaInits: () => '',
    memberHandle: () => '', setSaveEnabled: noop, saveScore: noop,
    backToMenu: noop, togglePause: noop, setMenuSel: noop, activateMenu: noop,
    updateMenuDemo: noop, updateRim: noop, updateParticles: noop, updateFx: noop, updateImpacts: noop, updateGuide: noop,
    menuDemo: { on: false, fade: 0, blocks: [] },
    inputFrozen: false,
    previewPos: () => ({ y: 0 }),
    elFinal: elStub(), elInitials: elStub(), elSave: elStub(), elSavedMsg: elStub(),
    elShareMsg: elStub(), elNewHigh: elStub(), elTopList: elStub(), elOverlay: elStub(),
    elScores: { classList: { toggle() { }, add() { }, remove() { }, contains() { return true; } } }, elMenu: elStub(),
    $: (sel) => elStub(),
    document: { activeElement: null, addEventListener: noop, querySelector: () => elStub() },
    requestAnimationFrame: noop,
  };
}

function create(seed, mode) {
  mode = mode || 'keyboard';
  const rng = mulberry32(seed >>> 0);
  const stubs = makeStubs();
  const ctx = Object.assign({
    console,
    Math: Object.assign(Object.create(Math), { random: () => rng() }),
    Set, Array, Object, JSON, Math_imul: Math.imul,
  }, stubs);
  ctx.performance = { now: () => ctx.__tNow * 1000 };
  ctx.__tNow = 0;

  const fns = ['onKey', 'onKeyUp', 'update', 'spawnPiece', 'tryMove', 'hardDrop', 'lockPiece',
    'findMatches', 'startClear', 'finishClear', 'gameOver', 'restRowFor', 'bumpLevel', 'setDanger']
    .map(extractFn).join('\n\n');

  const code = CONSTS + '\n\n' + STATE + '\n\n' + fns + '\n\n' +
    `globalThis.__state = {
      get grid() { return grid; }, set grid(v) { grid = v; },
      get falling() { return falling; }, set falling(v) { falling = v; },
      get phase() { return phase; }, set phase(v) { phase = v; },
      get score() { return score; }, set score(v) { score = v; },
      get combo() { return combo; }, set combo(v) { combo = v; },
      get level() { return level; }, set level(v) { level = v; },
      get fallingSpeed() { return fallingSpeed; }, set fallingSpeed(v) { fallingSpeed = v; },
      get clearT() { return clearT; }, set clearT(v) { clearT = v; },
      get clearList() { return clearList; }, set clearList(v) { clearList = v; },
      get softAcc() { return softAcc; }, set softAcc(v) { softAcc = v; },
      get keysDown() { return keysDown; },
      get heldLeft() { return heldLeft; }, set heldLeft(v) { heldLeft = v; },
      get heldRight() { return heldRight; }, set heldRight(v) { heldRight = v; },
      get moveTimer() { return moveTimer; }, set moveTimer(v) { moveTimer = v; },
      get moveArmed() { return moveArmed; }, set moveArmed(v) { moveArmed = v; },
      get dasInit() { return dasInit; }, set dasInit(v) { dasInit = v; },
      get dasRep() { return dasRep; }, set dasRep(v) { dasRep = v; },
      get heldDir() { return heldDir; }, set heldDir(v) { heldDir = v; },
      get lastKeyT() { return lastKeyT; }, set lastKeyT(v) { lastKeyT = v; },
      get lastDownT() { return lastDownT; }, set lastDownT(v) { lastDownT = v; },
      get nextColor() { return nextColor; }, set nextColor(v) { nextColor = v; },
      get maxChain() { return maxChain; }, set maxChain(v) { maxChain = v; },
      get boardGroup() { return boardGroup; }, set boardGroup(v) { boardGroup = v; },
    };`;

  vm.createContext(ctx);
  vm.runInContext(code, ctx, { filename: 'v1-dropblock-' + SHA.slice(0, 7) + '.js' });
  ctx.__state.boardGroup = ctx.boardGroup;

  const CODES = { left: 'ArrowLeft', right: 'ArrowRight', down: 'ArrowDown', hard: 'Space' };

  return {
    mode,
    start() {
      const st = ctx.__state;
      st.grid = Array.from({ length: 12 }, () => Array(6).fill(null));
      st.falling = null; st.phase = 'menu';
      st.score = 0; st.combo = 0; st.level = 0; st.fallingSpeed = 2.3;
      st.clearList = []; st.softAcc = 0; st.maxChain = 0; st.nextColor = -1;
      st.heldLeft = false; st.heldRight = false; st.moveTimer = 0; st.moveArmed = false;
      st.heldDir = 0; st.lastKeyT = 0; st.lastDownT = 0;
      st.keysDown.clear();
      ctx.spawnPiece();
    },
    // events: [{key, type}] due this tick — applied exactly like v1's key handlers
    tick(events) {
      for (const e of events) {
        const ev = { code: CODES[e.key], repeat: false, preventDefault() { } };
        if (e.type === 'down') {
          ctx.onKey(ev);
          if (mode === 'touch' && (e.key === 'left' || e.key === 'right')) {
            // v1 touch handler: gentler DAS per swipe step
            ctx.__state.dasInit = 0.22; ctx.__state.dasRep = 0.09;
          }
        } else {
          ctx.onKeyUp(ev);
        }
      }
      ctx.__tNow += 1 / 60;
      ctx.update(1 / 60);
    },
    get state() { return ctx.__state; },
  };
}

module.exports = { create, SHA, SRC };
