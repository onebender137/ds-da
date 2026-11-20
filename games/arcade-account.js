/* DSDA Arcade Account — opt-in login + account sync (Phase 1).
 *
 * Loads alongside arcade-social.js (which injects it). NON-BREAKING: if the
 * player has no token, this module is a no-op and the cabinet runs exactly as
 * it does today (localStorage-only passport).
 *
 * When logged in (token in localStorage `dsda-token`):
 *   - On load:  PULL  GET  /api/account/sync -> merge persistent state into the
 *     localStorage passport (union badges, max daily scores/plays/streak).
 *   - On save:  PUSH  POST /api/account/sync (debounced) on every
 *     DSDA:passport-saved event (badge earned, daily finished, score submitted).
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

  var API = (window.DSDA_API_BASE || 'https://api.ds-da.ca') + '/api/account';
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
      return Promise.resolve({ ok: false, error: 'no wallet (open in BSV Browser / Pocket Wallet)' });
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
      return Promise.resolve({ ok: false, error: 'no wallet (open in BSV Browser / Pocket Wallet)' });
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

  window.DSDA = window.DSDA || {};
  window.DSDA.account = {
    __account: true,
    loginBrc100: loginBrc100, loginEmail: loginEmail, register: register,
    forgotPassword: forgotPassword, resetPassword: resetPassword,
    logout: logout, pull: pull, push: push, submitScore: submitScore, linkWallet: linkWallet,
    getToken: tok, getAccount: getAcc
  };
})();
