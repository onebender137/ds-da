/* ============================================================================
   DSDA — fx.js  (home page effects)
   - hero "block network" canvas: drifting nodes, gold pulses travel the links
   - scroll progress bar + header condense
   - cursor spotlight on cards, 3D tilt on arcade tiles, scroll reveal
   - arcade rail pulls real top scores from /games/<id>/leaderboard.json
   No dependencies. Everything degrades gracefully if a piece fails.
   ========================================================================== */
(function () {
    'use strict';
    var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* ---------- scroll progress + header ---------- */
    var bar = document.querySelector('.scroll-progress');
    var header = document.querySelector('.header');
    function onScroll() {
        var h = document.documentElement;
        var max = h.scrollHeight - h.clientHeight;
        if (bar) bar.style.transform = 'scaleX(' + (max > 0 ? h.scrollTop / max : 0) + ')';
        if (header) header.classList.toggle('scrolled', h.scrollTop > 40);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    /* ---------- scroll reveal ---------- */
    var rev = document.querySelectorAll('.reveal');
    if ('IntersectionObserver' in window && !reduce) {
        var io = new IntersectionObserver(function (es) {
            es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
        }, { threshold: 0.12 });
        rev.forEach(function (el) { io.observe(el); });
    } else {
        rev.forEach(function (el) { el.classList.add('in'); });
    }

    /* ---------- card spotlight ---------- */
    document.querySelectorAll('.service-card').forEach(function (c) {
        c.addEventListener('pointermove', function (e) {
            var r = c.getBoundingClientRect();
            c.style.setProperty('--mx', (e.clientX - r.left) + 'px');
            c.style.setProperty('--my', (e.clientY - r.top) + 'px');
        });
    });

    /* ---------- arcade tiles: tilt + live high scores ---------- */
    document.querySelectorAll('.tile').forEach(function (t) {
        if (!reduce) {
            t.addEventListener('pointermove', function (e) {
                var r = t.getBoundingClientRect();
                var px = (e.clientX - r.left) / r.width - 0.5;
                var py = (e.clientY - r.top) / r.height - 0.5;
                t.style.setProperty('--ry', (px * 10).toFixed(2) + 'deg');
                t.style.setProperty('--rx', (-py * 8).toFixed(2) + 'deg');
            });
            t.addEventListener('pointerleave', function () {
                t.style.setProperty('--rx', '0deg'); t.style.setProperty('--ry', '0deg');
            });
        }
        var id = t.getAttribute('data-game');
        var out = t.querySelector('.tile-score');
        if (!id || !out || !window.fetch) return;
        fetch('/games/' + id + '/leaderboard.json', { cache: 'no-cache' })
            .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
            .then(function (j) {
                var top = j && j.top && j.top[0];
                if (!top) throw 0;
                out.innerHTML = '<span class="crown">👑</span> <b></b> <span></span>';
                out.querySelector('b').textContent = Number(top.s).toLocaleString();
                out.lastElementChild.textContent = String(top.n).slice(0, 3).toUpperCase();
            })
            .catch(function () { out.textContent = 'Be the first on the board'; });
    });

    /* ---------- hero network canvas ---------- */
    var cv = document.getElementById('netCanvas');
    if (!cv || !cv.getContext) return;
    var ctx = cv.getContext('2d');
    var hero = cv.parentElement;
    var W = 0, H = 0, DPR = 1, nodes = [], pulses = [], links = [];
    var mouse = { x: -9999, y: -9999 };
    var GOLD = '201,162,39', ICE = '140,170,255';

    function build() {
        DPR = Math.min(window.devicePixelRatio || 1, 2);
        W = hero.clientWidth; H = hero.clientHeight;
        cv.width = W * DPR; cv.height = H * DPR;
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
        var n = Math.max(24, Math.min(90, Math.round(W * H / 14000)));
        nodes = [];
        for (var i = 0; i < n; i++) {
            nodes.push({
                x: Math.random() * W, y: Math.random() * H,
                vx: (Math.random() - .5) * .22, vy: (Math.random() - .5) * .22,
                r: Math.random() * 1.6 + .8, gold: Math.random() < .22
            });
        }
        pulses = [];
    }

    function frame() {
        ctx.clearRect(0, 0, W, H);
        var maxD = Math.min(170, W / 5), i, j, a, b;
        links.length = 0;
        for (i = 0; i < nodes.length; i++) {
            a = nodes[i];
            if (!reduce) {
                a.x += a.vx; a.y += a.vy;
                if (a.x < -20) a.x = W + 20; else if (a.x > W + 20) a.x = -20;
                if (a.y < -20) a.y = H + 20; else if (a.y > H + 20) a.y = -20;
                var dx = a.x - mouse.x, dy = a.y - mouse.y, d2 = dx * dx + dy * dy;
                if (d2 < 14000) { var f = (1 - d2 / 14000) * .5; a.x += dx * f * .05; a.y += dy * f * .05; }
            }
        }
        ctx.lineWidth = 1;
        for (i = 0; i < nodes.length; i++) {
            a = nodes[i];
            for (j = i + 1; j < nodes.length; j++) {
                b = nodes[j];
                var ex = a.x - b.x, ey = a.y - b.y, d = Math.sqrt(ex * ex + ey * ey);
                if (d < maxD) {
                    var al = (1 - d / maxD);
                    ctx.strokeStyle = 'rgba(' + ICE + ',' + (al * .22).toFixed(3) + ')';
                    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
                    links.push([a, b]);
                }
            }
        }
        for (i = 0; i < nodes.length; i++) {
            a = nodes[i];
            ctx.fillStyle = a.gold ? 'rgba(' + GOLD + ',.95)' : 'rgba(' + ICE + ',.6)';
            if (a.gold) { ctx.shadowColor = 'rgba(' + GOLD + ',.9)'; ctx.shadowBlur = 12; }
            ctx.beginPath(); ctx.arc(a.x, a.y, a.gold ? a.r + .8 : a.r, 0, 6.2832); ctx.fill();
            ctx.shadowBlur = 0;
        }
        /* pulses = "blocks" propagating along links */
        if (!reduce && links.length && Math.random() < .06 && pulses.length < 14) {
            var l = links[(Math.random() * links.length) | 0];
            pulses.push({ a: l[0], b: l[1], t: 0, s: .008 + Math.random() * .01 });
        }
        for (i = pulses.length - 1; i >= 0; i--) {
            var p = pulses[i]; p.t += p.s;
            if (p.t >= 1) { pulses.splice(i, 1); continue; }
            var x = p.a.x + (p.b.x - p.a.x) * p.t, y = p.a.y + (p.b.y - p.a.y) * p.t;
            ctx.shadowColor = 'rgba(' + GOLD + ',1)'; ctx.shadowBlur = 16;
            ctx.fillStyle = 'rgba(255,230,140,' + (1 - Math.abs(p.t - .5) * 1.2).toFixed(2) + ')';
            ctx.fillRect(x - 2.5, y - 2.5, 5, 5);   /* square = a block, not a dot */
            ctx.shadowBlur = 0;
        }
        raf = requestAnimationFrame(frame);
    }

    var raf = 0, visible = true;
    function start() { if (!raf && visible) raf = requestAnimationFrame(frame); }
    function stop() { cancelAnimationFrame(raf); raf = 0; }

    build();
    if (reduce) { frame(); stop(); } else { start(); }
    var rt;
    window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(function () { build(); if (reduce) { frame(); stop(); } }, 150); });
    hero.addEventListener('pointermove', function (e) { var r = hero.getBoundingClientRect(); mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top; });
    hero.addEventListener('pointerleave', function () { mouse.x = mouse.y = -9999; });
    if ('IntersectionObserver' in window) {   /* don't burn battery when the hero is offscreen */
        new IntersectionObserver(function (es) { visible = es[0].isIntersecting; visible ? start() : stop(); }).observe(hero);
    }

    /* ---------- DSDA Radio band: live from /radio/stations.json ----------
       The markup in index.html is the fallback. When the shared manifest loads,
       the dial + cards are rebuilt from it, so a new station shows up here by itself. */
    (function () {
        var band = document.getElementById('radio');
        var grid = document.getElementById('stationGrid');
        var dial = document.getElementById('dial');
        var tuner = document.getElementById('tuner');
        if (!band || !grid || !dial || !tuner) return;
        var elFreq = document.getElementById('tunerFreq');
        var elName = document.getElementById('tunerName');
        var elTag = document.getElementById('tunerTag');
        var elCount = document.getElementById('radioCount');
        var WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'];
        var list = [], lo = 70, hi = 140, active = 0, hovering = false, inView = false;

        function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
        function color(c) { return /^#[0-9a-f]{3,8}$/i.test(c || '') ? c : '#c9a227'; }
        function pct(f) { return ((f - lo) / (hi - lo) * 100).toFixed(2) + '%'; }
        // "Most Pit FM 73.7" -> "Most Pit FM"; leaves "Z107.7 Classic Rock" alone
        function shortName(name, freq) {
            var out = (' ' + name + ' ').replace(' ' + freq + ' ', ' ').trim();
            return out || name;
        }
        // drop a trailing licence/credit segment: "8-bit chiptunes — HydroGene (CC0)" -> "8-bit chiptunes"
        function genre(tag) {
            var parts = String(tag || '').split(' — ');
            if (parts.length > 1 && /\bCC/.test(parts[parts.length - 1])) parts.pop();
            return parts.join(' — ');
        }

        function fromDom() {
            return [].map.call(grid.querySelectorAll('.station'), function (a) {
                return {
                    freq: a.getAttribute('data-freq'), href: a.getAttribute('href'),
                    accent: a.style.getPropertyValue('--accent').trim(),
                    name: a.querySelector('.st-name').textContent, tag: a.querySelector('.st-tag').textContent
                };
            });
        }
        function fromManifest(m) {
            return (m.stations || []).filter(function (s) { return s && s.name && isFinite(parseFloat(s.frequency)); })
                .sort(function (a, b) { return parseFloat(a.frequency) - parseFloat(b.frequency); })
                .map(function (s) {
                    var href = /^\/radio\/stations\/[\w-]+\/manifest\.json$/.test(s.manifest || '')
                        ? s.manifest.replace('manifest.json', '') : '/radio/stations/';
                    return { freq: String(s.frequency), href: href, accent: color(s.accent), name: shortName(s.name, String(s.frequency)), tag: genre(s.tagline) };
                });
        }

        function render() {
            var f = list.map(function (s) { return parseFloat(s.freq); });
            lo = Math.floor(Math.min.apply(null, f) / 10) * 10;
            hi = Math.ceil(Math.max.apply(null, f) / 10) * 10;
            if (hi <= lo) hi = lo + 10;
            var html = '';
            for (var n = lo; n <= hi; n += 10) html += '<span class="dial-num" style="--p:' + pct(n) + '">' + n + '</span>';
            list.forEach(function (s) { html += '<i class="dial-mark" style="--p:' + pct(parseFloat(s.freq)) + ';--accent:' + s.accent + '"></i>'; });
            dial.style.setProperty('--span', hi - lo);
            dial.innerHTML = html + '<div class="dial-needle"></div>';
            grid.innerHTML = list.map(function (s) {
                return '<a class="station" href="' + esc(s.href) + '" data-freq="' + esc(s.freq) + '" style="--accent:' + s.accent + '">' +
                    '<span class="st-freq">' + esc(s.freq) + '</span><span class="st-name">' + esc(s.name) + '</span>' +
                    '<span class="st-tag">' + esc(s.tag) + '</span></a>';
            }).join('');
            if (elCount) elCount.textContent = WORDS[list.length] || String(list.length);
            wire();
            tune(Math.min(active, list.length - 1));
        }

        function tune(i) {
            var s = list[i]; if (!s) return;
            active = i;
            tuner.style.setProperty('--accent', s.accent);
            elFreq.textContent = s.freq; elName.textContent = s.name; elTag.textContent = s.tag;
            var needle = dial.querySelector('.dial-needle');
            if (needle) needle.style.setProperty('--pos', pct(parseFloat(s.freq)));
            [].forEach.call(dial.querySelectorAll('.dial-mark'), function (m, k) { m.classList.toggle('on', k === i); });
            [].forEach.call(grid.querySelectorAll('.station'), function (a, k) { a.classList.toggle('on', k === i); });
        }
        function wire() {
            [].forEach.call(grid.querySelectorAll('.station'), function (a, k) {
                a.addEventListener('pointerenter', function () { tune(k); });
                a.addEventListener('focus', function () { tune(k); });
            });
        }

        list = fromDom();
        if (list.length) { wire(); tune(0); }
        grid.addEventListener('pointerenter', function () { hovering = true; });
        grid.addEventListener('pointerleave', function () { hovering = false; });

        // idle: the needle scans the dial, one station every few seconds, while the band is on screen
        if (!reduce && 'IntersectionObserver' in window) {
            new IntersectionObserver(function (es) { inView = es[0].isIntersecting; }, { threshold: 0.25 }).observe(band);
            setInterval(function () {
                if (inView && !hovering && !document.hidden && list.length > 1) tune((active + 1) % list.length);
            }, 3400);
        }

        fetch('/radio/stations.json', { cache: 'no-cache' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (m) { var next = m ? fromManifest(m) : []; if (next.length) { list = next; render(); } })
            .catch(function () {});
    })();
})();
