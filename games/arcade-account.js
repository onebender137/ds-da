/* DSDA Arcade Account — opt-in login + account sync (Phase 1).
 *
 * Loads alongside arcade-social.js (which injects it). NON-BREAKING: if the
 * player has no token, this module is a no-op and the cabinet runs exactly as
 * it does today (localStorage-only passport).
 *
 * When logged in (token in localStorage `dsda-token`):
 *   - On load:  PULL  GET  /api/account/sync -> merge persistent state into the
 *     localStorage passport (union badges, max daily scores/plays/streak,
 *     per-board bests from the account score history).
 *   - On save:  PUSH  POST /api/account/sync (debounced) on every
 *     DSDA:passport-saved event (badge earned, daily finished, score submitted).
 *
 * Board posts (v8, 2026-11-20): the fetch wrapper that attaches the session to
 * /api/board/score now ALSO filters member posts — a round only reaches the
 * cabinet board when it beats the member's personal best FOR THAT BOARD
 * (casuals already qualify-check the same way). The per-board best lives in
 * localStorage `dsda-board-bests`, seeded from the account-synced best
 * (passport.scores) when the sync covers that board id. The board id comes
 * straight from the POST body, so variant boards (dailies, skies,
 * difficulties, dragon-slalom_journey) need no per-game wiring. The
 * game_over gtag path (DSDA.account.submitScore) is untouched — the card's
 * recent-games history keeps every run; only the board post is filtered.
 * A 429'd board post is NOT dropped: it is stashed in localStorage
 * (`dsda-board-pending`) and retried when a cabinet next loads or after the
 * rate window resets, then cleared on success.
 *
 * Login: BRC-100 (window.CWI, preferred) or email/password. The token is a
 * stateless signed session from the board Worker.
 *
 * Exposes window.DSDA.account:
 *   loginBrc100(), loginEmail(email, pw), register(email, handle, pw),
 *   logout(), pull(), push(), getToken(), getAccount()
 */
(function () {
  'use strict';
  if (window.DSDA && window.DSDA.account && window.DSDA.account.__account) return;

  var API = (window.DSDA_API_BASE || '') + '/api/account';
  var TOKEN_KEY = 'dsda-token';
  var ACC_KEY = 'dsda-account';
  var PASS_KEY = 'dsda-passport';

  function tok() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }
  function setTok(t) { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch (e) {} }
  function getAcc() { try { return JSON.parse(localStorage.getItem(ACC_KEY) || 'null'); } catch (e) { return null; } }
  function setAcc(a) { try { a ? localStorage.setItem(ACC_KEY, JSON.stringify(a)) : localStorage.removeItem(ACC_KEY); } catch (e) {} }
  function getPass() { try { return JSON.parse(localStorage.getItem(PASS_KEY) || 'null'); } catch (e) { return null; } }
  function setPass(p) { try { localStorage.setItem(PASS_KEY, JSON.stringify(p)); } catch (e) {} }

  function api(path, method, body) {
    method = method || 'GET';
    var headers = { 'Content-Type': 'application/json' };
    var t = tok();
    if (t) headers['Authorization'] = 'Bearer ' + t;
    return fetch(API + path, {
      method: method, headers: headers,
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        // Dead/expired session: clear it so we stop syncing into the void and
        // the card page falls back to the login screen.
        if (r.status === 401 && t) logout();
        return { ok: r.status >= 200 && r.status < 300, status: r.status, j: j };
      });
    }).catch(function (e) { return { ok: false, status: 0, j: { error: String(e) } }; });
  }

  /* ---------------- login ---------------- */
  function emitLogin(account) {
    setAcc(account);
    window.dispatchEvent(new CustomEvent('DSDA:account-login', { detail: account }));
  }
  function loginBrc100() {
    if (!window.CWI || typeof window.CWI.getPublicKey !== 'function') {
      return Promise.resolve({ ok: false, error: 'no wallet (open in Fundy Wallet or BSV Browser)' });
    }
    return api('/nonce').then(function (n) {
      var nonce = n.j.nonce;
      var proto = { protocolID: [0, 'dsda ca login'], keyID: 'login', counterparty: 'anyone' };
      return window.CWI.getPublicKey({ protocolID: proto.protocolID, keyID: proto.keyID, counterparty: proto.counterparty, forSelf: true })
        .then(function (pk) {
          var data = Array.from(new TextEncoder().encode(nonce));
          return window.CWI.createSignature({ data: data, protocolID: proto.protocolID, keyID: proto.keyID, counterparty: proto.counterparty, forSelf: true })
            .then(function (sg) {
              var hex = Array.from(sg.signature).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
              return api('/login-brc100', 'POST', { nonce: nonce, publicKey: pk.publicKey, signature: hex });
            });
        });
    }).then(function (r) {
      if (r.ok) { setTok(r.j.token); emitLogin(r.j.account); return { ok: true, account: r.j.account }; }
      return { ok: false, error: r.j.error || 'login failed' };
    });
  }
  function loginEmail(email, password) {
    return api('/login', 'POST', { email: email, password: password }).then(function (r) {
      if (r.ok) { setTok(r.j.token); emitLogin(r.j.account); return { ok: true, account: r.j.account }; }
      return { ok: false, error: r.j.error || 'login failed' };
    });
  }
  function register(email, handle, password) {
    return api('/register', 'POST', { email: email, handle: handle, password: password }).then(function (r) {
      if (r.ok) { setTok(r.j.token); emitLogin(r.j.account); return { ok: true, account: r.j.account }; }
      return { ok: false, error: r.j.error || 'register failed' };
    });
  }
  function logout() {
    setTok(''); setAcc(null);
    window.dispatchEvent(new CustomEvent('DSDA:account-logout'));
  }
  // Request a password-reset email. In dev (no mail provider) the response
  // includes resetUrl so the flow is testable; in prod it's a generic message.
  function forgotPassword(email) {
    return api('/forgot-password', 'POST', { email: email });
  }
  function resetPassword(token, password) {
    return api('/reset-password', 'POST', { token: token, password: password });
  }

  // Link a BRC-100 wallet to the current account (requires session token).
  function linkWallet() {
    if (!tok()) return Promise.resolve({ ok: false, error: 'not logged in' });
    if (!window.CWI || typeof window.CWI.getPublicKey !== 'function') {
      return Promise.resolve({ ok: false, error: 'no wallet (open in Fundy Wallet or BSV Browser)' });
    }
    return api('/nonce?purpose=link').then(function (n) {
      var nonce = n.j.nonce;
      var proto = { protocolID: [0, 'dsda ca login'], keyID: 'login', counterparty: 'anyone' };
      return window.CWI.getPublicKey({ protocolID: proto.protocolID, keyID: proto.keyID, counterparty: proto.counterparty, forSelf: true })
        .then(function (pk) {
          var data = Array.from(new TextEncoder().encode(nonce));
          return window.CWI.createSignature({ data: data, protocolID: proto.protocolID, keyID: proto.keyID, counterparty: proto.counterparty, forSelf: true })
            .then(function (sg) {
              var hex = Array.from(sg.signature).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
              return api('/link-wallet', 'POST', { nonce: nonce, publicKey: pk.publicKey, signature: hex });
            });
        });
    }).then(function (r) {
      if (r.ok) { setAcc(r.j.account); return { ok: true, account: r.j.account }; }
      return { ok: false, error: r.j.error || 'link failed' };
    });
  }

  /* ---------------- sync ---------------- */
  // Pull persistent state and merge into the localStorage passport.
  function pull() {
    if (!tok()) return Promise.resolve(null);
    return api('/sync').then(function (r) {
      if (!r.ok) return null;
      r.j.daily = r.j.daily || {};
      var p = getPass() || { games: {}, badges: {}, daily: { days: {}, streak: 0, last: '' }, plays: 0 };
      p.games = p.games || {}; p.badges = p.badges || {};
      p.daily = p.daily || { days: {}, streak: 0, last: '' };
      p.daily.days = p.daily.days || {};
      // badges: union (keep earliest earned)
      Object.keys(r.j.badges || {}).forEach(function (id) {
        var ts = r.j.badges[id];
        p.badges[id] = Math.min(p.badges[id] || Infinity, ts);
      });
      // daily: merge per-day per-game max
      Object.keys(r.j.daily.days || {}).forEach(function (day) {
        p.daily.days[day] = p.daily.days[day] || {};
        Object.keys(r.j.daily.days[day]).forEach(function (game) {
          p.daily.days[day][game] = Math.max(p.daily.days[day][game] || 0, r.j.daily.days[day][game]);
        });
      });
      p.daily.streak = Math.max(p.daily.streak || 0, r.j.daily.streak || 0);
      p.daily.last = (r.j.daily.last && r.j.daily.last > (p.daily.last || '')) ? r.j.daily.last : (p.daily.last || '');
      p.plays = Math.max(p.plays || 0, r.j.plays || 0);
      // `scores` (player_scores, keyed by GAME id) feeds the account card +
      // points — it includes daily runs + pre-reset runs, so it's the
      // max-of-history, NOT the PB gate's source. Leave it as-is.
      p.scores = p.scores || {};
      Object.keys(r.j.scores || {}).forEach(function (g) {
        p.scores[g] = Math.trunc(+r.j.scores[g] || 0);
      });
      // `boards` (scores JOIN score_handles, keyed by BOARD id) is the PB
      // gate's source of truth: it reflects the LIVE boards, so daily/split
      // boards stay separate and board resets/deletes are picked up
      // automatically. This is what un-locks a member after a reset.
      p.boards = (r.j.boards && typeof r.j.boards === 'object') ? r.j.boards : {};
      // Re-seed the local board-best store from the synced BOARDS (overwrite).
      // Covered boards get the synced best (a reset lowers/clears it); boards
      // the sync does NOT cover get their stale local best cleared (a wiped
      // board has no rows for the member -> their best there is 0 again).
      try {
        var bb = boardBests();
        var touched = false;
        var synced = p.boards || {};
        Object.keys(synced).forEach(function (g) {
          var v = Math.trunc(+synced[g] || 0);
          if (bb[g] !== v) { bb[g] = v; touched = true; }
        });
        Object.keys(bb).forEach(function (g) {
          if (!(g in synced) && bb[g]) { bb[g] = 0; touched = true; }
        });
        if (touched) localStorage.setItem(BESTS_KEY, JSON.stringify(bb));
      } catch (e) {}
      setPass(p);
      window.dispatchEvent(new CustomEvent('DSDA:passport-synced', { detail: p }));
      return p;
    });
  }
  // Push the current passport to the account (debounced).
  var pushTimer = null;
  function push() {
    if (!tok() || pushTimer) return;
    pushTimer = setTimeout(function () {
      pushTimer = null;
      var p = getPass();
      if (!p) return;
      api('/sync', 'POST', { badges: p.badges, daily: p.daily, plays: p.plays });
    }, 800);
  }
  window.addEventListener('DSDA:passport-saved', function () { push(); });

  // Pull on load if there's a token.
  if (tok()) pull();

  // Submit a score to the account. Wallet-signed (CWI) when the account has a
  // linked wallet, else session (token). The server keeps the max; every score
  // is fine to send (rate-limited per IP).
  function submitScore(game, score) {
    if (!tok()) return Promise.resolve(null);
    var s = Math.round(score);
    if (!(s > 0)) return Promise.resolve(null);
    var acc = getAcc();
    var hasWallet = acc && acc.address && window.CWI && typeof window.CWI.createSignature === 'function';
    if (hasWallet) {
      var ts = Date.now();
      var payload = 'dsda-score|' + game + '|' + s + '|' + ts;
      var proto = { protocolID: [0, 'dsda ca login'], keyID: 'login', counterparty: 'anyone' };
      return window.CWI.getPublicKey({ protocolID: proto.protocolID, keyID: proto.keyID, counterparty: proto.counterparty, forSelf: true })
        .then(function (pk) {
          return window.CWI.createSignature({ data: Array.from(new TextEncoder().encode(payload)), protocolID: proto.protocolID, keyID: proto.keyID, counterparty: proto.counterparty, forSelf: true })
            .then(function (sg) {
              var hex = Array.from(sg.signature).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
              return api('/scores', 'POST', { game: game, score: s, ts: ts, publicKey: pk.publicKey, signature: hex });
            });
        }).catch(function () { return api('/scores', 'POST', { game: game, score: s }); });
    }
    return api('/scores', 'POST', { game: game, score: s });
  }

  /* ---------------- board posts carry the session (v8: + member gate + 429 queue)
     Every cabinet posts its score to <api>/api/board/score itself (it knows the
     right board id + score). When logged in, attach the session token so the
     Worker writes the row under the account handle. Expired/invalid session
     (401) -> log out and retry once as a casual so the score isn't lost.
     Member gate: a round only reaches the board when it beats the member's
     personal best FOR THAT BOARD (the board id is read from the POST body, so
     variant boards are keyed correctly). Non-PB rounds return a synthetic 200
     before hitting the network — no rate spend, no board churn. The per-board
     best lives in localStorage `dsda-board-bests`, seeded from the
     account-synced best (passport.scores) for members.
     Rate-limited (429) -> toast how long to wait (Retry-After, seconds per
     the HTTP spec) AND stash the post in localStorage `dsda-board-pending` —
     it is retried when a cabinet next loads or after the window resets, and
     cleared on success. A 429'd score is never dropped. */
  var BESTS_KEY = 'dsda-board-bests';
  var PEND_KEY = 'dsda-board-pending';
  function boardBests() { try { return JSON.parse(localStorage.getItem(BESTS_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function boardBest(boardId) {
    var b = +boardBests()[boardId] || 0;
    try {
      var p = JSON.parse(localStorage.getItem(PASS_KEY) || 'null');
      var acc = p && p.boards;
      // OVERWRITE (not max): the account-synced board best is authoritative for
      // boards it covers, so a stale local best (pre-reset / daily-run) drops
      // to the live board value. Boards the sync doesn't cover keep the local.
      if (acc && typeof acc === 'object' && acc[boardId] != null) b = +acc[boardId] || 0;
    } catch (e) {}
    return b;
  }
  function liftBoardBest(boardId, s) {
    try {
      var b = boardBests();
      if (s > (b[boardId] || 0)) { b[boardId] = s; localStorage.setItem(BESTS_KEY, JSON.stringify(b)); }
    } catch (e) {}
  }
  function loadPend() { try { return JSON.parse(localStorage.getItem(PEND_KEY) || 'null'); } catch (e) { return null; } }
  function savePend(p) { try { p ? localStorage.setItem(PEND_KEY, JSON.stringify(p)) : localStorage.removeItem(PEND_KEY); } catch (e) {} }

  var retryTimer = null;
  function scheduleRetry(ms) {
    if (retryTimer) return;
    retryTimer = setTimeout(function () { retryTimer = null; retryPending(); }, Math.max(5000, Math.min(ms, 65 * 60000)));
  }
  function stashPending(url, body, r) {
    try {
      var ra = r && r.headers && r.headers.get ? r.headers.get('Retry-After') : null;
      var secs = ra && /^\d+$/.test(ra) ? +ra : 300;
      secs = Math.max(60, Math.min(secs, 3600));
      savePend({ url: url, body: body, until: Date.now() + secs * 1000, ts: Date.now() });
      scheduleRetry(secs * 1000 + 1500);
    } catch (e) {}
  }
  function retryPending() {
    var p = loadPend();
    if (!p) return;
    var wait = (p.until || 0) - Date.now();
    if (wait > 1500) { scheduleRetry(wait + 1500); return; }
    savePend(null);
    // window.fetch is the wrapper: it re-attaches the session (or, after a 401,
    // falls back to casual) and re-stashes on another 429.
    fetch(p.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: p.body })
      .then(function (r) {
        // 429/401 are already re-stashed/handled by the wrapper.
        if (r && !r.ok && r.status !== 429 && r.status !== 401) savePend(p);
      })
      .catch(function () { savePend(p); scheduleRetry(60000); });
  }
  function rateToast(r) {
    try {
      var ra = r.headers && r.headers.get && r.headers.get('Retry-After');
      var secs = ra && /^\d+$/.test(ra) ? +ra : ra ? Math.max(0, (Date.parse(ra) - Date.now()) / 1000) : 0;
      var mins = Math.max(1, Math.ceil((secs || 60) / 60));
      if (window.DSDA && typeof window.DSDA.toast === 'function')
        window.DSDA.toast('\u23f3', 'BOARD LIMIT HIT', 'Too many posts this hour \u2014 try again in ~' + mins + ' min', true, 5200);
    } catch (e) {}
  }
  (function () {
    var orig = window.fetch;
    if (typeof orig !== 'function' || orig.__dsdaBoard) return;
    var wrapped = function (input, init) {
      try {
        var url = typeof input === 'string' ? input : (input && input.url) || '';
        var method = ((init && init.method) || 'GET').toUpperCase();
        if (method === 'POST' && /\/api\/board\/score(\?|$)/.test(url)) {
          var watch = function (r) {
            if (r && r.status === 429) { rateToast(r); stashPending(url, init && init.body, r); }
            return r;
          };
          var t = tok();
          if (t) {
            // Member board gate: a round that doesn't beat the personal best
            // for this board id never hits the network.
            try {
              var j = typeof init.body === 'string' ? JSON.parse(init.body) : null;
              var s = j ? Math.trunc(+j.score || 0) : 0;
              var g = j && typeof j.game === 'string' ? j.game : '';
              if (g && s > 0) {
                if (s <= boardBest(g)) {
                  // Honest dedupe: the round is NOT posted, but the cabinet must
                  // say so — read `deduped` from the body (or the X-DSDA-Dedup
                  // header) and show "Personal best stands", not "on the board ✓".
                  return Promise.resolve(new Response(
                    JSON.stringify({ ok: true, deduped: true }),
                    { status: 200, headers: { 'Content-Type': 'application/json', 'X-DSDA-Dedup': '1' } }
                  ));
                }
                liftBoardBest(g, s);
              }
            } catch (e) {}
          }
          if (!t) return orig.call(window, input, init).then(watch);
          var h = {};
          var src = init.headers;
          if (src && typeof src.forEach === 'function' && !Array.isArray(src)) src.forEach(function (v, k) { h[k] = v; });
          else if (src) for (var k in src) h[k] = src[k];
          h['Authorization'] = 'Bearer ' + t;
          var authed = Object.assign({}, init, { headers: h });
          return orig.call(window, input, authed).then(function (r) {
            if (r.status !== 401) return watch(r);
            logout();
            return orig.call(window, input, init).then(watch);
          });
        }
      } catch (e) {}
      return orig.apply(window, arguments);
    };
    wrapped.__dsdaBoard = true;
    window.fetch = wrapped;
  })();

  // Flush a 429-stashed board post from a previous session — any cabinet page
  // (or the hub) that loads this module can deliver it once the window resets.
  if (loadPend()) retryPending();

  window.DSDA = window.DSDA || {};
  window.DSDA.account = {
    __account: true,
    loginBrc100: loginBrc100, loginEmail: loginEmail, register: register,
    forgotPassword: forgotPassword, resetPassword: resetPassword,
    logout: logout, pull: pull, push: push, submitScore: submitScore, linkWallet: linkWallet,
    getToken: tok, getAccount: getAcc,
    boardBest: boardBest, pending: loadPend // v9: board gate reads passport.boards (live-board bests), not passport.scores (test hooks)
  };
})();
