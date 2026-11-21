/* DSDA Arcade — social layer (games/arcade-social.js)
   One drop-in for every cabinet: <script src="../arcade-social.js?v=2"></script>
   Zero per-game wiring needed for the basics, because it listens to the
   gtag('event','game_start'|'game_over',…) calls every cabinet already makes:

   - PASSPORT  arcade-wide badges + per-cabinet plays/bests in localStorage
               ('dsda-passport'), shown on the arcade page.
   - SHARE     after a game_over with a final_score, a bar offers
               "Share score" (native share sheet / clipboard) and
               "Challenge a friend" (link with your score baked in).
   - CHALLENGE ?vs=INI-SCORE on any cabinet URL shows a "beat this" card and
               calls the result at game over.
   - ANALYTICS adds duration_s + a play counter to every game_over event.
   - DAILY     DSDA.daily helpers (day key in the arcade's own time zone,
               seeded RNG, streaks) for cabinets that opt in (Cookie Frog).

   Cabinets can also call DSDA.share(...), DSDA.badge(id) and DSDA.daily.*
   directly. Everything is wrapped in try/catch: a broken social layer must
   never take a cabinet down with it. */
(function () {
  'use strict';
  if (window.DSDA && window.DSDA.__social) return;

  var TZ = 'America/Moncton';
  var DAY0 = Date.UTC(2026, 10, 18); // Daily #1 = Nov 18 2026
  var KEY = 'dsda-passport';
  var INITS_KEY = 'dsda-initials';

  var CABINETS = {
    'dropblock': 'DropBlock', 'shatterblock': 'ShatterBlock', 'popper': 'Machine Elves',
    'slipstream': 'Slipstream', 'stunts': 'STUNTS', 'blockcrush': 'BlockCrush',
    'plumber-bob': 'Plumber Bob', 'dragon-slalom': 'Dragon Slalom', 'tappycat': 'TappyCat',
    'angry-nerds': 'Angry Nerds', 'neon-circuit': 'Neon Circuit', 'cookie-frog': 'Cookie Frog',
    'beaverz': 'Beaverz', 'poke-it': 'Poke It', 'pipebombs': 'Pipebombs', 'chicken': 'Chicken'
  };
  var EMOJI = {
    'dropblock': '🧱', 'shatterblock': '💥', 'popper': '🍄', 'slipstream': '🏎️', 'stunts': '🚲',
    'blockcrush': '🍬', 'plumber-bob': '🪠', 'dragon-slalom': '🐉', 'tappycat': '🐱',
    'angry-nerds': '🤓', 'neon-circuit': '🏁', 'cookie-frog': '🐸', 'beaverz': '🦫', 'poke-it': '🎈',
    'pipebombs': '💣', 'chicken': '🐔'
  };

  /* ---------------- badges ---------------- */
  var N_CABS = Object.keys(CABINETS).length;
  var BADGES = [
    { id: 'first-coin', icon: '🪙', name: 'First Coin', desc: 'Play any cabinet' },
    { id: 'tourist', icon: '🧭', name: 'Tourist', desc: 'Play 3 different cabinets' },
    { id: 'regular', icon: '🎟️', name: 'Regular', desc: 'Play 7 different cabinets' },
    { id: 'all-cabinets', icon: '👑', name: 'Arcade Royalty', desc: 'Play every cabinet in the arcade' },
    { id: 'marathon', icon: '🏃', name: 'Marathon', desc: '25 games played' },
    { id: 'century', icon: '💯', name: 'Century', desc: '100 games played' },
    { id: 'deep-diver', icon: '🤿', name: 'Deep Diver', desc: 'Reach level 5 in any cabinet' },
    { id: 'night-owl', icon: '🦉', name: 'Night Owl', desc: 'Finish a game between 2 and 5 AM' },
    { id: 'loudmouth', icon: '📣', name: 'Loudmouth', desc: 'Share a score' },
    { id: 'gauntlet', icon: '🧤', name: 'Gauntlet Thrown', desc: 'Send a challenge link' },
    { id: 'giant-slayer', icon: '🗡️', name: 'Giant Slayer', desc: 'Beat a friend\'s challenge score' },
    { id: 'daily-1', icon: '📅', name: 'Daily Dipper', desc: 'Finish a Daily challenge' },
    { id: 'streak-3', icon: '🔥', name: 'On Fire', desc: '3-day Daily streak' },
    { id: 'streak-7', icon: '☄️', name: 'Week Warrior', desc: '7-day Daily streak' },
    { id: 'frog-frost', icon: '❄️', name: 'Thin Ice', desc: 'Cookie Frog: reach Frost Pond (level 4)' },
    { id: 'frog-marsh', icon: '🐸', name: 'Marsh King', desc: 'Cookie Frog: reach Amber Marsh (level 6)' }
  ];
  var BADGE_BY_ID = {};
  BADGES.forEach(function (b) { BADGE_BY_ID[b.id] = b; });

  /* ---------------- storage ---------------- */
  function load() {
    var p = null;
    try { p = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
    if (!p || typeof p !== 'object') p = {};
    p.games = p.games || {};
    p.badges = p.badges || {};
    p.daily = p.daily || { days: {}, streak: 0, last: '' };
    p.plays = p.plays || 0;
    return p;
  }
  function save(p) { try { localStorage.setItem(KEY, JSON.stringify(p)); window.dispatchEvent(new CustomEvent('DSDA:passport-saved', { detail: p })); } catch (e) {} }
  function inits() {
    try { return (localStorage.getItem(INITS_KEY) || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3); }
    catch (e) { return ''; }
  }

  /* ---------------- time / daily ---------------- */
  function dayKey(d) {
    d = d || new Date();
    try {
      var parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
      var o = {}; parts.forEach(function (x) { o[x.type] = x.value; });
      return o.year + o.month + o.day;
    } catch (e) {
      var u = new Date(d.getTime() - 4 * 3600e3);
      return u.toISOString().slice(0, 10).replace(/-/g, '');
    }
  }
  function keyToUTC(k) { return Date.UTC(+k.slice(0, 4), +k.slice(4, 6) - 1, +k.slice(6, 8)); }
  function dayNumber(k) { return Math.round((keyToUTC(k || dayKey()) - DAY0) / 864e5) + 1; }
  function prevKey(k) { var t = new Date(keyToUTC(k) - 864e5); return t.toISOString().slice(0, 10).replace(/-/g, ''); }
  function hashStr(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) {
    var a = typeof seed === 'number' ? seed >>> 0 : hashStr(String(seed));
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function msToNextDay() {
    // walk forward in 5-minute steps until the arcade day flips (cheap + DST-proof)
    var now = Date.now(), k = dayKey(new Date(now)), t = now;
    for (var i = 0; i < 400; i++) { t += 300e3; if (dayKey(new Date(t)) !== k) return t - now; }
    return 864e5;
  }

  /* ---------------- UI ---------------- */
  var css = '' +
    '.dsda-x-toasts{position:fixed;left:50%;top:calc(12px + env(safe-area-inset-top));transform:translateX(-50%);z-index:2147483000;display:flex;flex-direction:column;align-items:center;gap:8px;pointer-events:none;width:min(92vw,420px)}' +
    '.dsda-x-toast{font:700 13px/1.3 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.04em;color:#1d1200;background:linear-gradient(90deg,#ffd54a,#ffb02e);border-radius:14px;padding:10px 14px;box-shadow:0 8px 28px rgba(0,0,0,.45),0 0 22px rgba(255,200,60,.35);display:flex;gap:10px;align-items:center;opacity:0;transform:translateY(-10px);transition:opacity .3s,transform .3s;pointer-events:auto}' +
    '.dsda-x-toast.on{opacity:1;transform:none}.dsda-x-toast .i{font-size:22px}.dsda-x-toast small{display:block;font-weight:600;opacity:.75;letter-spacing:.02em}' +
    '.dsda-x-toast.cool{color:#e9fff6;background:linear-gradient(90deg,#123d33,#0d2b3d);border:1px solid rgba(108,255,178,.45);box-shadow:0 8px 28px rgba(0,0,0,.5),0 0 18px rgba(108,255,178,.2)}' +
    '.dsda-x-bar{position:fixed;left:50%;bottom:calc(74px + env(safe-area-inset-bottom));transform:translate(-50%,240%);z-index:2147482000;display:flex;gap:8px;padding:8px;border-radius:18px;background:rgba(8,14,20,.88);border:1px solid rgba(255,213,74,.4);box-shadow:0 10px 30px rgba(0,0,0,.5);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);transition:transform .35s cubic-bezier(.2,.9,.3,1.2)}' +
    '.dsda-x-bar.on{transform:translate(-50%,0)}' +
    '.dsda-x-bar button{font:800 13px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.05em;border:0;border-radius:12px;padding:12px 14px;cursor:pointer;white-space:nowrap;touch-action:manipulation}' +
    '.dsda-x-bar .s{color:#1d1200;background:linear-gradient(90deg,#ffd54a,#ffb02e)}' +
    '.dsda-x-bar .c{color:#e9fff6;background:#173a30;border:1px solid rgba(108,255,178,.45)}' +
    '.dsda-x-bar .x{color:#9fb3ad;background:transparent;padding:12px 8px}' +
    '@media (max-width:420px){.dsda-x-bar button{font-size:12px;padding:11px 10px}}' +
    '.dsda-x-toast.champ{pointer-events:none;font-size:12px;padding:7px 13px;border-radius:999px;gap:8px;max-width:100%;color:#1d1200;background:linear-gradient(90deg,#ffe27a,#ffb02e);box-shadow:0 6px 20px rgba(0,0,0,.4),0 0 18px rgba(255,200,60,.35)}' +
    '.dsda-x-toast.champ .i{font-size:17px}.dsda-x-toast.champ small{font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}';
  function injectCSS() {
    if (document.getElementById('dsda-x-css')) return;
    var st = document.createElement('style'); st.id = 'dsda-x-css'; st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }
  var toastBox = null;
  function toast(icon, title, sub, cool, ms) {
    try {
      injectCSS();
      if (!toastBox) { toastBox = document.createElement('div'); toastBox.className = 'dsda-x-toasts'; document.body.appendChild(toastBox); }
      var t = document.createElement('div'); t.className = 'dsda-x-toast' + (cool === true ? ' cool' : (cool ? ' ' + cool : ''));
      t.innerHTML = '<span class="i"></span><span><b></b><small></small></span>';
      t.querySelector('.i').textContent = icon; t.querySelector('b').textContent = title; t.querySelector('small').textContent = sub || '';
      toastBox.appendChild(t);
      void t.offsetWidth; setTimeout(function () { t.classList.add('on'); }, 20);
      setTimeout(function () { t.classList.remove('on'); setTimeout(function () { t.remove(); }, 400); }, ms || 3800);
    } catch (e) {}
  }

  function badge(id) {
    var b = BADGE_BY_ID[id]; if (!b) return false;
    var p = load(); if (p.badges[id]) return false;
    p.badges[id] = Date.now(); save(p);
    toast(b.icon, 'BADGE · ' + b.name.toUpperCase(), b.desc);
    try { if (typeof _gtag === 'function') _gtag('event', 'badge_unlock', { badge: id }); } catch (e) {}
    return true;
  }

  /* ---------------- share ---------------- */
  function share(opts) {
    opts = opts || {};
    var text = opts.text || '', url = opts.url || location.href.split('#')[0];
    var full = text + (url ? '\n' + url : '');
    var done = function (how) { if (how !== 'failed') badge(opts.challenge ? 'gauntlet' : 'loudmouth'); return how; };
    try {
      if (navigator.share) {
        return navigator.share({ title: opts.title || document.title, text: text, url: url })
          .then(function () { return done('shared'); })
          .catch(function (e) { if (e && e.name === 'AbortError') return 'cancelled'; return copy(full).then(done); });
      }
    } catch (e) {}
    return copy(full).then(done);
  }
  function copy(s) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(s).then(function () { toast('📋', 'COPIED', 'Paste it anywhere — text, Messenger, the group chat', true, 2600); return 'copied'; },
          function () { return legacyCopy(s); });
      }
    } catch (e) {}
    return Promise.resolve(legacyCopy(s));
  }
  function legacyCopy(s) {
    try {
      var ta = document.createElement('textarea'); ta.value = s; ta.style.cssText = 'position:fixed;opacity:0;top:0';
      document.body.appendChild(ta); ta.select(); var ok = document.execCommand('copy'); ta.remove();
      if (ok) { toast('📋', 'COPIED', 'Paste it anywhere', true, 2600); return 'copied'; }
    } catch (e) {}
    toast('⚠️', 'COULDN\'T COPY', 'Long-press the address bar to share instead', true, 3000);
    return 'failed';
  }

  /* ---------------- challenge links ---------------- */
  function gameIdFromPath() {
    var m = location.pathname.match(/\/games\/([a-z0-9-]+)/);
    return m ? m[1] : 'arcade';
  }
  function cabinetUrl(game) {
    var base = location.origin && location.origin.indexOf('http') === 0 ? location.origin : 'https://ds-da.ca';
    return base + '/games/' + game + '/';
  }
  function parseChallenge() {
    try {
      var v = new URLSearchParams(location.search).get('vs'); if (!v) return null;
      var m = v.match(/^([A-Za-z0-9_-]{1,16})-(\d{1,9})$/); if (!m) return null;
      var c = { n: m[1], s: +m[2] };
      var d = new URLSearchParams(location.search).get('d'); if (d && /^\d{8}$/.test(d)) c.day = d;
      // optional cabinet-specific details (e.g. Neon Circuit's track + difficulty) and a readable label
      var sp = new URLSearchParams(location.search), q = {}, any = false;
      sp.forEach(function (val, key) { if (['vs', 'd', 'daily', 'cl'].indexOf(key) < 0 && /^[a-z]{1,4}$/.test(key) && /^[A-Za-z0-9_-]{1,12}$/.test(val)) { q[key] = val; any = true; } });
      if (any) c.q = q;
      var cl = sp.get('cl'); if (cl) c.label = cl.replace(/[<>&"]/g, '').slice(0, 48);
      return c;
    } catch (e) { return null; }
  }
  function challengeLink(game, score, extra) {
    // Use account handle if logged in, otherwise fall back to initials
    var me = 'YOU';
    try {
      var acc = window.DSDA && window.DSDA.account && window.DSDA.account.getAccount && window.DSDA.account.getAccount();
      if (acc && acc.handle) me = acc.handle;
      else me = inits() || 'YOU';
    } catch (e) {}
    me = me.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 16);
    var u = cabinetUrl(game) + '?vs=' + me + '-' + Math.round(score);
    if (extra && extra.day) u += '&d=' + extra.day + '&daily=1';
    if (extra && extra.q) for (var k in extra.q) u += '&' + k + '=' + encodeURIComponent(extra.q[k]);
    if (extra && extra.label) u += '&cl=' + encodeURIComponent(extra.label);
    return u;
  }
  // Logged-in arcade member's handle ('' for casual players). Reads storage
  // directly so it works before arcade-account.js has finished loading.
  function member() {
    try {
      if (!localStorage.getItem('dsda-token')) return '';
      var a = JSON.parse(localStorage.getItem('dsda-account') || 'null');
      return a && a.handle ? String(a.handle).replace(/[^a-z0-9_-]/gi, '').slice(0, 16) : '';
    } catch (e) { return ''; }
  }
  // 3-char placeholder for cabinets whose save flow needs initials. The Worker
  // ignores it for members (handle comes from the token).
  function memberInits() {
    var h = member().toUpperCase().replace(/[^A-Z0-9]/g, '');
    return (h || 'YOU').slice(0, 3).padEnd(3, 'X');
  }
  function fmt(n) { try { return Math.round(n).toLocaleString('en-US'); } catch (e) { return String(n); } }

  /* ---------------- passport recording (gtag hook) ---------------- */
  var CH = parseChallenge();
  var startedAt = 0, current = null;
  function onStart(game) { startedAt = Date.now(); current = game; hideBar(); }
  function onOver(game, params) {
    var p = load();
    var g = p.games[game] = p.games[game] || { plays: 0, best: 0, bestLevel: 0, first: Date.now() };
    g.plays++; g.last = Date.now(); p.plays++;
    var score = typeof params.final_score === 'number' ? params.final_score : (params.final_score != null && !isNaN(+params.final_score) ? +params.final_score : null);
    var lvl = +(params.level_reached || params.level || 0) || 0;
    var newBest = false;
    if (score != null && score > (g.best || 0)) { g.best = Math.round(score); newBest = true; }
    if (lvl > (g.bestLevel || 0)) g.bestLevel = lvl;
    save(p);
    // Opt-in: submit the score to the account (wallet-signed or session; no-op if not logged in)
    if (score != null && score > 0 && window.DSDA.account && window.DSDA.account.submitScore) {
      window.DSDA.account.submitScore(game, score);
    }
    var played = Object.keys(p.games).length;
    badge('first-coin');
    if (played >= 3) badge('tourist');
    if (played >= 7) badge('regular');
    if (played >= N_CABS) badge('all-cabinets');
    if (p.plays >= 25) badge('marathon');
    if (p.plays >= 100) badge('century');
    if (lvl >= 5) badge('deep-diver');
    var h = new Date().getHours(); if (h >= 2 && h < 5) badge('night-owl');
    if (game === 'cookie-frog') { if (lvl >= 4) badge('frog-frost'); if (lvl >= 6) badge('frog-marsh'); }
    // challenge verdict
    var sameQ = !(CH && CH.q && params.challenge_q) || Object.keys(CH.q).every(function (k) { return String(params.challenge_q[k]) === String(CH.q[k]); });
    if (CH && score != null && game === gameIdFromPath() && sameQ) {
      if (score > CH.s) { toast('🗡️', 'YOU BEAT ' + CH.n + '!', fmt(score) + ' vs ' + fmt(CH.s) + ' — send it back to them', false, 5200); badge('giant-slayer'); }
      else toast('🎯', CH.n + ' STILL LEADS', 'Short by ' + fmt(CH.s - score) + ' — run it back', true, 4200);
    }
    if (score != null && score > 0 && !params.no_share) showBar(game, score, params);
    return { duration_s: startedAt ? Math.round((Date.now() - startedAt) / 1000) : undefined, arcade_plays: p.plays, new_best: newBest };
  }
  var _gtag = null;
  function hookGtag() {
    var orig = window.gtag;
    if (typeof orig !== 'function' || orig.__dsda) return;
    _gtag = orig;
    var wrapped = function (cmd, name, params) {
      try {
        if (cmd === 'event' && (name === 'game_start' || name === 'game_over')) {
          var game = (params && params.game) || gameIdFromPath();
          if (name === 'game_start') onStart(game);
          else {
            var extra = onOver(game, params || {});
            params = Object.assign({}, params || {}, extra);
            return orig.call(this, cmd, name, params);
          }
        }
      } catch (e) {}
      return orig.apply(this, arguments);
    };
    wrapped.__dsda = true;
    window.gtag = wrapped;
  }
  // Cabinet with no gtag (offline / blocked) — give it a no-op one so the hook still fires.
  if (typeof window.gtag !== 'function') { window.dataLayer = window.dataLayer || []; window.gtag = function () { window.dataLayer.push(arguments); }; }
  hookGtag();

  /* ---------------- share bar ---------------- */
  var bar = null, barTimer = 0;
  function hideBar() { if (bar) bar.classList.remove('on'); clearTimeout(barTimer); }
  function showBar(game, score, params) {
    try {
      injectCSS();
      if (!bar) {
        bar = document.createElement('div'); bar.className = 'dsda-x-bar';
        bar.innerHTML = '<button class="s">📣 SHARE</button><button class="c">🎯 CHALLENGE</button><button class="x" aria-label="Dismiss">✕</button>';
        document.body.appendChild(bar);
        bar.querySelector('.x').onclick = hideBar;
        // keep taps on the bar from reaching the game underneath
        ['pointerdown', 'touchstart', 'mousedown', 'click'].forEach(function (ev) { bar.addEventListener(ev, function (e) { e.stopPropagation(); }, { passive: true }); });
      }
      var name = CABINETS[game] || document.title, em = EMOJI[game] || '🕹️';
      var daily = params && params.daily_day;
      var line = em + ' ' + name + (daily ? ' Daily #' + dayNumber(daily) : '') + ': ' + fmt(score) +
        (params.level_reached ? ' · LV ' + params.level_reached : '') + (params.share_extra ? ' · ' + params.share_extra : '');
      bar.querySelector('.s').onclick = function () { share({ title: name, text: line, url: daily ? cabinetUrl(game) + '?daily=1' : cabinetUrl(game) }); };
      bar.querySelector('.c').onclick = function () {
        var lab = params.challenge_label ? ' — ' + params.challenge_label : '';
        var ex = { day: daily || null, q: params.challenge_q || null, label: params.challenge_label || null };
        share({ title: name, challenge: true, text: em + ' Beat my ' + fmt(score) + ' on ' + name + lab + (daily ? ' (Daily #' + dayNumber(daily) + ')' : '') + ' 👀',
          url: challengeLink(game, score, ex) });
      };
      void bar.offsetWidth; setTimeout(function () { bar.classList.add('on'); }, 20);
      clearTimeout(barTimer); barTimer = setTimeout(hideBar, 30000);
    } catch (e) {}
  }

  /* ---------------- challenge card on arrival ---------------- */
  function showChallengeCard() {
    if (!CH) return;
    var game = gameIdFromPath(); if (!CABINETS[game]) return;
    setTimeout(function () { toast('🎯', CH.n + ' CHALLENGED YOU', 'Beat ' + fmt(CH.s) + ' on ' + CABINETS[game] + (CH.label ? ' — ' + CH.label : '') + (CH.day ? ' — Daily #' + dayNumber(CH.day) : ''), true, 6500); }, 900);
  }

  /* ---------------- daily helpers ---------------- */
  var daily = {
    key: dayKey, number: dayNumber, rng: rng, msToNext: msToNextDay,
    requested: function () { try { return new URLSearchParams(location.search).get('daily') === '1'; } catch (e) { return false; } },
    board: function (game, k) { return game + '-d' + (k || dayKey()); },
    // call when a Daily run ends; returns the streak
    finish: function (game, score, k) {
      k = k || dayKey(); var p = load(), d = p.daily;
      var day = d.days[k] = d.days[k] || {};
      day[game] = Math.max(day[game] || 0, Math.round(score || 0));
      if (d.last !== k) { d.streak = (d.last === prevKey(k)) ? (d.streak || 0) + 1 : 1; d.last = k; }
      // keep 60 days
      var ks = Object.keys(d.days).sort(); while (ks.length > 60) delete d.days[ks.shift()];
      save(p);
      badge('daily-1'); if (d.streak >= 3) badge('streak-3'); if (d.streak >= 7) badge('streak-7');
      return d.streak;
    },
    best: function (game, k) { var p = load(), day = p.daily.days[k || dayKey()]; return day && day[game] || 0; },
    streak: function () { var p = load(), d = p.daily, k = dayKey(); return (d.last === k || d.last === prevKey(k)) ? d.streak || 0 : 0; }
  };

  /* ---------------- champ watch ----------------
     Every cabinet + the hall polls /api/board/all (once a minute, only while the
     tab is visible). When a board's #1 changes to a new, recent, higher score that
     isn't the local player's, a small non-interactive pill says so:
       "👑 ANG is the new champ!  Cookie Frog · 5,400"
     The last #1 seen per board lives in localStorage, so a first visit is a silent
     baseline, open tabs don't double up, and backdated manual restores (old `d`)
     never fire. Mute: DSDA.champs.mute(true) — the hall ticker has a 🔔 toggle.   */
  var CHAMP_KEY = 'dsda-champs', CHAMP_MUTE = 'dsda-champ-mute', CHAMP_FRESH = 6 * 3600e3;
  var MODE_LABEL = { master: 'Masters', initiate: 'Initiates', casual: 'Casual', standard: 'Standard',
    overpressure: 'Overpressure', breeze: 'Breeze', storm: 'Storm', journey: '' };
  function boardName(id) {
    var i = String(id).indexOf('_'), base = i < 0 ? id : id.slice(0, i), mode = i < 0 ? '' : id.slice(i + 1);
    var name = CABINETS[base] || base;
    var lbl = mode ? (MODE_LABEL[mode] !== undefined ? MODE_LABEL[mode] : mode.charAt(0).toUpperCase() + mode.slice(1)) : '';
    return lbl ? name + ' · ' + lbl : name;
  }
  function boardEmoji(id) { var i = String(id).indexOf('_'); return EMOJI[i < 0 ? id : id.slice(0, i)] || '🕹️'; }
  function champMuted() { try { return localStorage.getItem(CHAMP_MUTE) === '1'; } catch (e) { return false; } }
  function isMe(e) {
    try {
      var m = member(); if (m && e.h && String(e.h).toLowerCase() === m.toLowerCase()) return true;
      var ini = (localStorage.getItem('dsda-initials') || '').toUpperCase();
      return !e.h && !!ini && e.n === ini;
    } catch (x) { return false; }
  }
  var champLast = null, champAt = 0, champBusy = false;
  function champPoll() {
    if (champBusy || document.visibilityState === 'hidden') return;
    champBusy = true; champAt = Date.now();
    /* the abort only guards a connection that never answers; once headers land
       there's no deadline (a busy page — the 3D hall, a slow phone — may take a
       while to run the callbacks). A failed poll retries in 10 s, not 60. */
    var ok = false, ctl = window.AbortController ? new AbortController() : null, kill = setTimeout(function () { if (ctl) ctl.abort(); }, 8000);
    fetch('/api/board/all', { cache: 'no-store', signal: ctl ? ctl.signal : undefined })
      .then(function (r) { clearTimeout(kill); return r.ok ? r.json() : null; })
      .then(function (all) {
        if (!all || typeof all !== 'object') return;
        ok = true;
        champLast = all;
        try { window.dispatchEvent(new CustomEvent('DSDA:boards', { detail: all })); } catch (e) {}
        var seen = null; try { seen = JSON.parse(localStorage.getItem(CHAMP_KEY) || 'null'); } catch (e) {}
        var first = !seen || typeof seen !== 'object'; seen = first ? {} : seen;
        var news = [], now = Date.now();
        Object.keys(all).forEach(function (id) {
          var b = all[id], t = b && b.top && b.top[0];
          if (!t || !(t.s > 0)) return;
          var sig = t.s + '|' + t.d, prev = seen[id];
          if (!first && prev && prev !== sig) {
            var prevS = +String(prev).split('|')[0] || 0;
            if (t.s > prevS && t.d > now - CHAMP_FRESH && !isMe(t)) news.push({ id: id, t: t, prevS: prevS });
          }
          seen[id] = sig;
        });
        try { localStorage.setItem(CHAMP_KEY, JSON.stringify(seen)); } catch (e) {}
        if (champMuted()) return;
        news.slice(0, 3).forEach(function (x, i) {
          setTimeout(function () {
            toast('👑', (x.t.h || x.t.n) + ' is the new champ!',
              boardEmoji(x.id) + ' ' + boardName(x.id) + ' · ' + fmt(x.t.s) + (x.prevS ? '  (beat ' + fmt(x.prevS) + ')' : ''), 'champ', 4500);
          }, i * 5200);
        });
      })
      .catch(function () {})
      .then(function () { clearTimeout(kill); champBusy = false; if (!ok) setTimeout(champPoll, 10000); });
  }
  function champStart() {
    var hall = /\/games\/?$/.test(location.pathname);
    setTimeout(champPoll, hall ? 800 : 7000);
    setInterval(champPoll, 60000);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && Date.now() - champAt > 30000) champPoll();
    });
  }
  var champs = {
    poll: champPoll, last: function () { return champLast; }, boardName: boardName, boardEmoji: boardEmoji, isMe: isMe,
    muted: champMuted,
    mute: function (on) { try { on ? localStorage.setItem(CHAMP_MUTE, '1') : localStorage.removeItem(CHAMP_MUTE); } catch (e) {} return champMuted(); }
  };

  window.DSDA = Object.assign(window.DSDA || {}, {
    champs: champs,
    __social: true, CABINETS: CABINETS, BADGES: BADGES,
    passport: load, badge: badge, toast: toast, share: share,
    challenge: CH, challengeLink: challengeLink, daily: daily, fmt: fmt,
    member: member, memberInits: memberInits
  });

  // Opt-in account sync: load arcade-account.js once (no-op if the player
  // isn't logged in). It reads the token, pulls persistent state into
  // localStorage on load, and pushes on every DSDA:passport-saved.
  try {
    if (!document.getElementById('dsda-account-script')) {
      var s = document.createElement('script');
      s.id = 'dsda-account-script';
      s.src = '/games/arcade-account.js?v=10';
      s.async = true;
      (document.head || document.documentElement).appendChild(s);
    }
  } catch (e) {}

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showChallengeCard);
  else showChallengeCard();
  try { champStart(); } catch (e) {}
})();
