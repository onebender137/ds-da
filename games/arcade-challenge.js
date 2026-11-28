/* DSDA Arcade — AUTHORITATIVE challenges (Phase 2, shadow verification).
 *
 * Drop-in for eligible cabinets (TappyCat, DropBlock):
 *   <script src="../arcade-challenge.js?v=5"></script>
 *
 * A no-op unless the URL has ?c=<challengeId>. When it does:
 *   - Loads the challenge (GET /api/challenge/<id>, session-authed) and shows a
 *     small HUD: title, window state, opponents, games, live standings, your
 *     attempts used.
 *   - Seeds each run from the server: the cabinet's start function calls
 *     window.__dsdaGetChallengeSeed(gameKey), which burns an attempt
 *     (POST .../run/start) and returns the per-attempt seed. Normal play (no
 *     ?c=) is untouched — the seed provider is never registered.
 *   - The input log comes from the CABINET'S OWN Phase-0 recorder
 *     (window.__dsdaStartRunLog / window.__dsdaGetRunLog): the [tick, bits]
 *     change-events are exactly what sim.step() consumed — the same
 *     mechanism that passed the 50/50 determinism gate. No DOM
 *     keydown/touch approximation (the event stream is lossy: event tick ≠
 *     consumed tick, touches collapsed, no release info).
 *   - On game_over, posts score + envelope log {v:2, sim_sha, seed, ticks,
 *     events} to POST .../run/<run_id>/finish. The worker checks sim_sha +
 *     seed against the challenge, gzips → R2. replayd replays it against the
 *     pinned sim build and posts a verdict (shadow until the per-cabinet
 *     replay gate flips the challenge to verify_mode='replay').
 *   - Challenge runs do NOT post to the public board or the account score
 *     history (window.__dsdaChallengeActive gates both — see
 *     arcade-social.js + each cabinet's submitGlobal).
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
    current: null,       // { run_id, seed, attempt_no, game_key, sim_sha }
    finishing: false
  };
  var bootPromise = null; // set by boot() — provider awaits it to avoid a race
  window.__dsdaChallengeActive = true;   // gates public board + account posts

  /* ---------------- run log (from the cabinet's Phase-0 recorder) --------
     The cabinet exposes window.__dsdaStartRunLog() / window.__dsdaGetRunLog()
     — the Phase-0 gate recorder that wraps Sim.step and captures the exact
     [tick, bits] change-events step() consumed. recordStop() also returns
     the seed + final tick count the cabinet actually used, which the worker
     cross-checks against the run row. */
  function startRec() {
    try { if (typeof window.__dsdaStartRunLog === 'function') return window.__dsdaStartRunLog(); } catch (e) {}
    return null;
  }
  function stopRec() {
    try { if (typeof window.__dsdaGetRunLog === 'function') return window.__dsdaGetRunLog(); } catch (e) {}
    return null;
  }

  /* ---------------- seed provider (called by the cabinet's start fn) ---------------- */
  window.__dsdaGetChallengeSeed = function (gameKey) {
    // Await the boot promise so a fast tap before boot finishes doesn't get
    // a null seed (which the cabinet reads as "not a challenge" → crypto seed
    // → silent non-counting game). Only a missing ?c= resolves null.
    return (bootPromise || Promise.resolve()).then(function () {
      if (!state.active || state.gameKeys.indexOf(gameKey) < 0) return null;
      if (state.current && state.current.game_key === gameKey) return state.current.seed; // already started this run
      return api('/' + state.id + '/run/start', 'POST', { game_key: gameKey }).then(function (r) {
        if (!r.ok) {
          showRunStartError((r.j && r.j.error) || ('HTTP ' + r.status));
          return { blocked: true };
        }
        state.current = { run_id: r.j.run_id, seed: r.j.seed, attempt_no: r.j.attempt_no, game_key: gameKey, sim_sha: r.j.sim_sha || null };
        state.finishing = false;
        startRec(); // start the cabinet's step() recorder for this run
        setCollapsed(true); // slim pill while running
        refreshStandings();
        return r.j.seed;
      });
    });
  };

  // Full-screen block when run/start fails: the player should never get a
  // silent non-counting game. Shows the reason and a button back to the
  // challenge page where they can accept (if invited) or see the status.
  function showRunStartError(err) {
    var existing = document.getElementById('dsda-run-error');
    if (existing) existing.remove();
    // Map server errors to player-facing text
    var msg = err;
    if (err === 'not in this challenge') msg = 'Accept the challenge first';
    else if (err === 'no attempts left') msg = 'No attempts left';
    else if (err === 'challenge closed') msg = 'Challenge closed';
    var modal = document.createElement('div');
    modal.id = 'dsda-run-error';
    modal.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:rgba(8,14,22,.96);display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px;padding:24px;text-align:center;';
    modal.innerHTML =
      '<div style="font-size:48px;">⚠️</div>' +
      '<div style="font:700 16px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#fff;letter-spacing:.06em;">CANNOT START RUN</div>' +
      '<div style="font:400 13px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#9fb3ad;max-width:340px;">' + esc(msg) + '</div>' +
      '<a href="/challenge/?c=' + state.id + '" style="font:600 13px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#6cffb2;border:1px solid rgba(108,255,178,.5);padding:12px 28px;border-radius:10px;text-decoration:none;background:rgba(108,255,178,.08);">← BACK TO CHALLENGE</a>';
    document.body.appendChild(modal);
  }

  /* ---------------- finish (game_over) ---------------- */
  function finishRun(score) {
    if (!state.current || state.finishing) return;
    state.finishing = true;
    var run = state.current;
    // The exact step() input log, from the cabinet's recorder.
    var rec = stopRec();
    var log = null;
    if (rec) {
      log = {
        v: 2,
        sim_sha: run.sim_sha || null,
        seed: rec.seed != null ? rec.seed : null,
        ticks: rec.ticks != null ? rec.ticks : null,
        events: Array.isArray(rec.events) ? rec.events : null
      };
    }
    setCollapsed(false); // expand HUD on game over
    var s = Math.round(+score || 0);
    api('/' + state.id + '/run/' + run.run_id + '/finish', 'POST', { score: s, log: log })
      .then(function (r) {
        if (r.ok) {
          // Attempt consumed server-side — clear run state so the next start
          // (PLAY AGAIN) burns a NEW run and restarts the recorder.
          state.current = null;
          state.finishing = false;
          // Replay mode: the score is untrusted until the verdict lands, so show
          // "verifying…" (the standings flip to the score once it's verified).
          var isReplay = state.data && state.data.verify_mode === 'replay';
          var sub = isReplay
            ? 'Attempt ' + run.attempt_no + ' · RUN IN · verifying…'
            : 'Attempt ' + run.attempt_no + ' · ' + s + (r.j && r.j.log_hash ? ' · log saved' : '');
          toast(EM[run.game_key] || '🎯', 'CHALLENGE RUN IN', sub);
        } else {
          // Run still open server-side — keep state.current so PLAY AGAIN
          // replays the same seed and this finish can be retried.
          state.finishing = false;
          toast('⚠️', 'CHALLENGE RUN', (r.j && r.j.error) || ('HTTP ' + r.status), 5200);
        }
        refreshStandings();
      })
      .catch(function () { state.finishing = false; toast('⚠️', 'CHALLENGE RUN', 'Could not save — check your connection', 5200); });
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
  var hudCollapsed = false;
  function injectCSS() {
    if (document.getElementById('dsda-ch-css')) return;
    var css = '' +
      '.dsda-ch{position:fixed;left:50%;top:calc(8px + env(safe-area-inset-top));transform:translateX(-50%);z-index:2147481000;width:min(94vw,460px);' +
      'font:600 11px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.03em;color:#eaf6ff;background:rgba(8,14,22,.92);' +
      'border:1px solid rgba(108,255,178,.4);border-radius:14px;padding:9px 12px;box-shadow:0 10px 30px rgba(0,0,0,.5);backdrop-filter:blur(8px);' +
      'display:flex;flex-direction:column;gap:5px;pointer-events:auto;cursor:pointer;transition:all .25s ease}' +
      '.dsda-ch.collapsed{width:auto;padding:5px 14px;border-radius:999px;gap:0}' +
      '.dsda-ch.collapsed .row{display:flex!important}' +
      '.dsda-ch.collapsed .pl,.dsda-ch.collapsed .sb{display:none}' +
      '.dsda-ch .row{display:flex;gap:8px;align-items:center;justify-content:space-between}' +
      '.dsda-ch .t{font-weight:800;letter-spacing:.06em;color:#ffd54a;font-size:12px;white-space:nowrap}' +
      '.dsda-ch.collapsed .t{font-size:11px}' +
      '.dsda-ch .st{font-weight:800;font-size:10px;padding:2px 8px;border-radius:999px;letter-spacing:.08em;white-space:nowrap}' +
      '.dsda-ch .st.open{color:#0d2b3d;background:#6cffb2}.dsda-ch .st.live{color:#1d1200;background:#ffd54a}.dsda-ch .st.settled{color:#eaf6ff;background:#22384a}' +
      '.dsda-ch .pl{color:#9fb3ad;font-size:10px}.dsda-ch .sb{color:#eaf6ff;font-size:10px}.dsda-ch .sb b{color:#6cffb2}' +
      '.dsda-ch .me{color:#ffd54a}' +
      '.dsda-ch .nrun{color:#5a6b6e;font-style:italic}.dsda-ch .vfy{color:#6cffb2;font-style:italic;animation:dsdachpulse 1.2s ease-in-out infinite}@keyframes dsdachpulse{0%,100%{opacity:1}50%{opacity:.35}}';
    var st = document.createElement('style'); st.id = 'dsda-ch-css'; st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }
  function setCollapsed(c) {
    hudCollapsed = c;
    if (hud) hud.classList.toggle('collapsed', c);
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
    if (!hud) {
      hud = document.createElement('div'); hud.className = 'dsda-ch';
      hud.addEventListener('click', function () { setCollapsed(!hudCollapsed); });
      document.body.appendChild(hud);
    }
    var d = state.data;
    if (!d) { hud.innerHTML = '<div class="row"><span class="t">🎯 CHALLENGE</span><span class="st open">LOADING</span></div>'; return; }
    var st = statusLabel(d);
    var stDisp = st.toUpperCase();
    if (d.pending_runs > 0) { st = 'settling'; stDisp = 'SETTLING · VERIFYING RUNS'; }
    var players = (d.players || []).map(function (p) {
      var me = p.handle === member();
      return '<span class="' + (me ? 'me' : '') + '">' + (me ? '★ ' : '') + esc(p.handle) + (p.status === 'accepted' ? '' : '·' + esc(p.status)) + '</span>';
    }).join('  ');
    var stand = (d.standings || []).map(function (s) {
      var me = s.handle === member();
      var bestStr = '';
      var hasScore = false;
      if (s.best && typeof s.best === 'object') {
        var parts = [];
        (state.gameKeys || []).forEach(function (g) {
          if (s.best[g] != null) { parts.push((EM[g] || g) + ' ' + s.best[g]); hasScore = true; }
        });
        bestStr = parts.length ? ' (' + parts.join(' ') + ')' : '';
      } else if (s.best != null) {
        bestStr = ' (best ' + s.best + ')'; hasScore = true;
      }
      // verifying…: a finished run awaiting a verdict (pending 0 / review 3)
      if (s.verifying > 0) bestStr += ' <span class="vfy">verifying…</span>';
      if (!hasScore && !(s.verifying > 0)) bestStr = ' <span class="nrun">no runs yet</span>';
      return '<span class="' + (me ? 'me' : '') + '">' + (me ? '★ ' : '') + esc(s.handle) + ' ' + (s.points != null ? s.points + 'pt' : '') + bestStr + '</span>';
    }).join('  ');
    // Collapsed: slim pill with title + status only
    if (hudCollapsed) {
      hud.innerHTML = '<div class="row"><span class="t">🎯 CHALLENGE</span><span class="st ' + st + '">' + stDisp + '</span></div>';
    } else {
      hud.innerHTML =
        '<div class="row"><span class="t">🎯 ' + esc((d.title || 'CHALLENGE').slice(0, 40)) + '</span>' +
        '<span class="st ' + st + '">' + stDisp + '</span></div>' +
        (players ? '<div class="pl">' + players + '</div>' : '') +
        (stand ? '<div class="sb">▸ ' + stand + '</div>' : '');
    }
  }
  function refreshStandings() {
    if (!state.active) return;
    api('/' + state.id, 'GET').then(function (r) { if (r.ok) { state.data = r.j; renderHUD(); } }).catch(function () {});
  }

  /* ---------------- boot ---------------- */
  function boot() {
    bootPromise = api('/' + state.id, 'GET').then(function (r) {
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
