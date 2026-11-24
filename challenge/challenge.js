/* DSDA Challenges — shared UI helpers for the standalone /challenge pages
   (create + landing). This is NOT the in-cabinet module
   (games/arcade-challenge.js); that one boots inside a game on ?c=.
   These helpers talk to the same /api/challenge surface with the same
   dsda-token session as arcade-account.js. */
(function () {
  'use strict';
  var BASE = (window.DSDA_API_BASE || '') + '/api/challenge';
  function tok() { try { return localStorage.getItem('dsda-token') || ''; } catch (e) { return ''; } }
  function acc() { try { return JSON.parse(localStorage.getItem('dsda-account') || 'null'); } catch (e) { return null; } }

  function api(path, method, body) {
    return fetch(BASE + path, {
      method: method || 'GET',
      headers: Object.assign({ 'Content-Type': 'application/json' }, tok() ? { 'dsda-token': tok() } : {}),
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        return { ok: r.status >= 200 && r.status < 300, status: r.status, j: j };
      });
    }).catch(function (e) { return { ok: false, status: 0, j: { error: String(e) } }; });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function status(s) {
    return { open: 'OPEN', invited: 'INVITED', live: 'LIVE', settled: 'SETTLED', expired: 'EXPIRED' }[s] || (s || '').toUpperCase();
  }
  function gameLabel(g) { return g === 'tappycat' ? '🐱 TappyCat' : g === 'dropblock' ? '🧱 DropBlock' : g; }
  function gamesLabel(gs) { return (gs || []).map(gameLabel).join('  ·  '); }
  // Cabinet URL for playing a challenge game (?c= boots the challenge module in-cabinet).
  function playUrl(game, id) {
    return (game === 'tappycat' ? '/games/tappycat/' : '/games/dropblock/') + '?c=' + id;
  }
  function timeLeft(d) {
    if (!d || !d.closes_at) return '';
    var ms = d.closes_at - Date.now();
    if (ms < 0) return 'closed';
    var s = Math.floor(ms / 1000);
    var days = Math.floor(s / 86400); s -= days * 86400;
    var h = Math.floor(s / 3600); s -= h * 3600;
    var m = Math.floor(s / 60); s -= m * 60;
    if (days > 0) return days + 'd ' + h + 'h left';
    if (h > 0) return h + 'h ' + m + 'm left';
    return m + 'm ' + s + 's left';
  }
  function challengeUrl(id) { return location.origin + '/challenge/?c=' + id; }

  // Logged-out users land on the login page (same hardened next= check as
  // challenge-login.html). Returns true when a session token is present.
  function requireLogin(next) {
    if (tok()) return true;
    var u = new URL(location.href);
    var n = next || (u.pathname + u.search);
    if (n.charAt(0) !== '/' || n.indexOf('//') >= 0 || n.indexOf('/challenge-login') >= 0) n = '/challenge/';
    location.href = '/games/challenge-login.html?next=' + encodeURIComponent(n);
    return false;
  }

  window.DSDA = window.DSDA || {};
  window.DSDA.challenge = {
    api: api, esc: esc, status: status, gameLabel: gameLabel, gamesLabel: gamesLabel,
    playUrl: playUrl, timeLeft: timeLeft, challengeUrl: challengeUrl, requireLogin: requireLogin,
    token: tok, account: acc, BASE: BASE
  };
})();
