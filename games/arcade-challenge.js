/* DSDA Arcade — AUTHORITATIVE challenges (Phase 1, no stakes).
 *
 * Drop-in for eligible cabinets (TappyCat, DropBlock):
 *   <script src="../arcade-challenge.js?v=1"></script>
 *
 * A no-op unless the URL has ?c=<challengeId>. When it does:
 *   - Loads the challenge (GET /api/challenge/<id>, session-authed) and shows a
 *     small HUD: title, window state, opponents, games, live standings, your
 *     attempts used.
 *   - Seeds each run from the server: the cabinet's start function calls
 *     window.__dsdaGetChallengeSeed(gameKey), which burns an attempt
 *     (POST .../run/start) and returns the per-attempt seed. Normal play (no
 *     ?c=) is untouched — the seed provider is never registered.
 *   - On game_over, posts the score + [tick,bits] input log to
 *     POST .../run/<run_id>/finish. Challenge runs do NOT post to the public
 *     board or the account score history (window.__dsdaChallengeActive gates
 *     both — see arcade-social.js + each cabinet's submitGlobal).
 *
 * Identity comes from the session token (localStorage `dsda-token`), never the
 * request body. The seed only reaches the page in this player's own run/start
 * response. Everything is try/catch-wrapped: a broken challenge layer must
 * never take a cabinet down with it.
 */
(function () {
  'use strict';
  if (window.DSDA && window.DSDA.__challenge) return;

  var API = (window.DSDA_API_BASE || '') + '/api/challenge';
  var TOKEN_KEY = 'dsda-token';
  var GAME = (location.pathname.match(/\/games\/([a-z0-9-]+)/) || [])[1] || '';
  var EM = { tappycat: '🐱', dropblock: '🧱' };

  function tok() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }
  function member() {
    try {
      var a = JSON.parse(localStorage.getItem('dsda-account') || 'null');
      return a && a.handle ? String(a.handle) : '';
    } catch (e) { return ''; }
  }
  function api(path, method, body) {
    method = method || 'GET';
    var headers = { 'Content-Type': 'application/json' };
    var t = tok(); if (t) headers['Authorization'] = 'Bearer ' + t;
    return fetch(API + path, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.status >= 200 && r.status < 300, status: r.status, j: j }; }); })
      .catch(function (e) { return { ok: false, status: 0, j: { error: String(e) } }; });
  }
  function toast(icon, title, sub, ms) {
    try { if (window.DSDA && typeof window.DSDA.toast === 'function') window.DSDA.toast(icon, title, sub, true, ms || 5200); } catch (e) {}
  }
  // Server-sourced strings (handles are [a-z0-9_-], titles are creator-set) go
  // through this before innerHTML — cheap defense in depth.
  function esc(s) { return String(s == null ? '' : s).replace(/[<>&"']/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* ---------------- parse ?c= ---------------- */
  var CH_ID = null;
  try { CH_ID = new URLSearchParams(location.search).get('c'); } catch (e) {}
  CH_ID = CH_ID && /^[A-Za-z0-9_-]{6,64}$/.test(CH_ID) ? CH_ID : null;
  if (!CH_ID) return; // not a challenge URL — leave the cabinet exactly as-is

  // Logged-out user opening an invite link: send them to login/signup and bring
  // them back to the same ?c= afterwards. Challenge routes never auto-create an
  // account — the real signup/login path is the only way in.
  if (!tok()) {
    var gamesDir = location.pathname.split('/').slice(0, -2).join('/') || '/games';
    // next is a same-origin PATH (not a full URL) so the login page's hardened
    // check (single "/" + non-slash/non-backslash) accepts it and rejects
    // protocol-relative / scheme / backslash tricks.
    var backPath = location.pathname + location.search;
    var loginUrl = gamesDir + '/challenge-login.html?next=' + encodeURIComponent(backPath);
    try { location.replace(loginUrl); } catch (e) {}
    return; // navigating away
  }

  var state = {
    id: CH_ID, active: false, data: null,
    games: [], gameKeys: [],
    current: null,       // { run_id, seed, attempt_no, game_key }
    log: [],             // [tick, bits]
    logStart: 0,
    finishing: false
  };
  window.__dsdaChallengeActive = true;   // gates public board + account posts

  /* ---------------- input log ----------------
     Record (simTick, inputBits) for each input during the live run. The cabinet
     exposes window.__dsdaTick() (current sim tick); if absent we fall back to a
     wall-clock ms tick. Phase 1 stores the log (Phase 2 replays it) — it is not
     validated server-side, so a best-effort bit map is fine. */
  function tickNow() {
    try { if (typeof window.__dsdaTick === 'function') { var t = window.__dsdaTick(); if (t != null) return t; } } catch (e) {}
    return state.logStart ? Date.now() - state.logStart : 0;
  }
  var KEY_BITS = { ArrowLeft: 1, a: 1, ArrowRight: 2, d: 2, ArrowUp: 4, w: 4, ' ': 4, ArrowDown: 8, s: 8, z: 16, Z: 16, x: 32, X: 32, Shift: 64 };
  function recordBit(bits) {
    if (!state.current || state.finishing) return;
    var t = tickNow();
    var last = state.log[state.log.length - 1];
    if (last && last[0] === t) last[1] |= bits;       // merge same-tick presses
    else state.log.push([t, bits]);
    if (state.log.length > 20000) state.log.shift();   // hard cap (well under 256KB gz)
  }
  function onKey(e) { if (e && e.type === 'keydown' && !e.repeat) recordBit(KEY_BITS[e.key] || 0); }
  function onPointer(e) { if (e && (e.type === 'touchstart' || e.type === 'pointerdown')) recordBit(128); }

  /* ---------------- seed provider (called by the cabinet's start fn) ---------------- */
  window.__dsdaGetChallengeSeed = function (gameKey) {
    if (!state.active || state.gameKeys.indexOf(gameKey) < 0) return Promise.resolve(null);
    if (state.current && state.current.game_key === gameKey) return Promise.resolve(state.current.seed); // already started this run
    return api('/' + state.id + '/run/start', 'POST', { game_key: gameKey }).then(function (r) {
      if (!r.ok) { toast('⚠️', 'CHALLENGE RUN', (r.j && r.j.error) || ('HTTP ' + r.status), 4200); return null; }
      state.current = { run_id: r.j.run_id, seed: r.j.seed, attempt_no: r.j.attempt_no, game_key: gameKey };
      state.log = []; state.logStart = Date.now(); state.finishing = false;
      document.addEventListener('keydown', onKey, { passive: true });
      document.addEventListener('touchstart', onPointer, { passive: true });
      document.addEventListener('pointerdown', onPointer, { passive: true });
      refreshStandings();
      return r.j.seed;
    });
  };

  /* ---------------- finish (game_over) ---------------- */
  function finishRun(score) {
    if (!state.current || state.finishing) return;
    state.finishing = true;
    var run = state.current;
    var log = state.log.slice();
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('touchstart', onPointer);
    document.removeEventListener('pointerdown', onPointer);
    var s = Math.round(+score || 0);
    api('/' + state.id + '/run/' + run.run_id + '/finish', 'POST', { score: s, log: log })
      .then(function (r) {
        if (r.ok) {
          toast(EM[run.game_key] || '🎯', 'CHALLENGE RUN IN', 'Attempt ' + run.attempt_no + ' · ' + s + (r.j && r.j.log_hash ? ' · log saved' : ''));
        } else {
          toast('⚠️', 'CHALLENGE RUN', (r.j && r.j.error) || ('HTTP ' + r.status), 5200);
        }
        refreshStandings();
      })
      .catch(function () { toast('⚠️', 'CHALLENGE RUN', 'Could not save — check your connection', 5200); });
  }
  // Hook game_over via gtag (chain with arcade-social's wrapper).
  (function hookGtag() {
    var orig = window.gtag;
    if (typeof orig !== 'function') { window.dataLayer = window.dataLayer || []; orig = function () { window.dataLayer.push(arguments); }; }
    if (orig.__dsdaCh) return;
    var wrapped = function (cmd, name, params) {
      try {
        if (cmd === 'event' && name === 'game_over' && state.current) {
          var score = params && (params.final_score != null ? params.final_score : (params.score != null ? params.score : 0));
          finishRun(score);
          // tell arcade-social not to also submit this to the account score history
          if (params) params.no_submit = true;
        }
      } catch (e) {}
      return orig.apply(this, arguments);
    };
    wrapped.__dsdaCh = true;
    window.gtag = wrapped;
  })();

  /* ---------------- HUD ---------------- */
  var hud = null;
  function injectCSS() {
    if (document.getElementById('dsda-ch-css')) return;
    var css = '' +
      '.dsda-ch{position:fixed;left:50%;top:calc(8px + env(safe-area-inset-top));transform:translateX(-50%);z-index:2147481000;width:min(94vw,460px);' +
      'font:600 11px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.03em;color:#eaf6ff;background:rgba(8,14,22,.92);' +
      'border:1px solid rgba(108,255,178,.4);border-radius:14px;padding:9px 12px;box-shadow:0 10px 30px rgba(0,0,0,.5);backdrop-filter:blur(8px);' +
      'display:flex;flex-direction:column;gap:5px;pointer-events:none}' +
      '.dsda-ch .row{display:flex;gap:8px;align-items:center;justify-content:space-between}' +
      '.dsda-ch .t{font-weight:800;letter-spacing:.06em;color:#ffd54a;font-size:12px}' +
      '.dsda-ch .st{font-weight:800;font-size:10px;padding:2px 8px;border-radius:999px;letter-spacing:.08em}' +
      '.dsda-ch .st.open{color:#0d2b3d;background:#6cffb2}.dsda-ch .st.live{color:#1d1200;background:#ffd54a}.dsda-ch .st.settled{color:#eaf6ff;background:#22384a}' +
      '.dsda-ch .pl{color:#9fb3ad;font-size:10px}.dsda-ch .sb{color:#eaf6ff;font-size:10px}.dsda-ch .sb b{color:#6cffb2}' +
      '.dsda-ch .me{color:#ffd54a}';
    var st = document.createElement('style'); st.id = 'dsda-ch-css'; st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }
  function statusLabel(d) {
    if (!d) return '';
    var now = Date.now();
    if (d.status === 'settled' || d.status === 'settling') return 'settled';
    if (d.status === 'live') return 'live';
    if (d.status === 'open') {
      if (d.opens_at && now < d.opens_at) return 'open';
      if (d.closes_at && now > d.closes_at) return 'settled';
      return 'live';
    }
    return d.status || 'open';
  }
  function renderHUD() {
    injectCSS();
    if (!hud) { hud = document.createElement('div'); hud.className = 'dsda-ch'; document.body.appendChild(hud); }
    var d = state.data;
    if (!d) { hud.innerHTML = '<div class="row"><span class="t">🎯 CHALLENGE</span><span class="st open">LOADING</span></div>'; return; }
    var st = statusLabel(d);
    var players = (d.players || []).map(function (p) {
      var me = p.handle === member();
      return '<span class="' + (me ? 'me' : '') + '">' + (me ? '★ ' : '') + esc(p.handle) + (p.status === 'accepted' ? '' : '·' + esc(p.status)) + '</span>';
    }).join('  ');
    var stand = (d.standings || []).map(function (s) {
      var me = s.handle === member();
      return '<span class="' + (me ? 'me' : '') + '">' + (me ? '★ ' : '') + esc(s.handle) + ' ' + (s.points != null ? s.points + 'pt' : '') + (s.best != null ? ' (best ' + s.best + ')' : '') + '</span>';
    }).join('  ');
    var used = 0, tot = 0;
    (state.gameKeys).forEach(function (g) { tot += (d.games || []).filter(function (x) { return x.game_key === g; })[0] ? 1 : 0; });
    hud.innerHTML =
      '<div class="row"><span class="t">🎯 ' + esc((d.title || 'CHALLENGE').slice(0, 40)) + '</span>' +
      '<span class="st ' + st + '">' + st.toUpperCase() + '</span></div>' +
      (players ? '<div class="pl">' + players + '</div>' : '') +
      (stand ? '<div class="sb">▸ ' + stand + '</div>' : '');
  }
  function refreshStandings() {
    if (!state.active) return;
    api('/' + state.id, 'GET').then(function (r) { if (r.ok) { state.data = r.j; renderHUD(); } }).catch(function () {});
  }

  /* ---------------- boot ---------------- */
  function boot() {
    api('/' + state.id, 'GET').then(function (r) {
      if (!r.ok) {
        toast('⚠️', 'CHALLENGE', (r.j && r.j.error) || 'Not found — is the link right?', 5200);
        window.__dsdaChallengeActive = false;
        return;
      }
      state.data = r.j;
      state.games = r.j.games || [];
      state.gameKeys = state.games.map(function (g) { return typeof g === 'string' ? g : g.game_key; });
      state.active = true;
      renderHUD();
      // refresh live standings while the tab is visible
      setInterval(function () { if (document.visibilityState === 'visible' && state.active) refreshStandings(); }, 30000);
    }).catch(function () { window.__dsdaChallengeActive = false; });
  }
  window.DSDA = Object.assign(window.DSDA || {}, { __challenge: true, challengeRun: state });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
