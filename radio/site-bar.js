/* ============================================================================
   DSDA site bar for the radio pages (the hub + every station page).
   One line per page, straight after <body>:
       <script src="/radio/site-bar.js?v=1"></script>
   It injects the ds-da.ca header (logo + the same links as the main site) as a
   fixed bar and pads the page so nothing sits underneath it. Everything is
   prefixed dsda-bar so it can't collide with a station's own styles.
   Edit the links HERE and all radio pages follow. Keep them in step with the
   header in /index.html and /games/index.html.
   ========================================================================== */
(function () {
    'use strict';
    if (document.querySelector('.dsda-bar')) return;

    var LINKS = [
        { href: 'https://hopes-and-dreams.ca', html: 'Hopes &amp; Dreams' },
        { href: 'https://polkahole.ca', html: 'Polkahole' },
        { href: '/proof/', html: 'Proof<span class="dsda-bar-wide"> of Creation</span>' },
        { href: '/games/', html: 'Arcade' }
    ];
    var onHub = /^\/radio\/stations\/?(index\.html)?$/.test(location.pathname);

    var css =
        ':root{--dsda-bar-h:65px}' +
        '.dsda-bar{position:fixed;top:0;left:0;right:0;z-index:1000;height:var(--dsda-bar-h);' +
            'background:rgba(10,22,40,.95);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);' +
            'border-bottom:1px solid #1e293b;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;' +
            'line-height:1.6;letter-spacing:normal;text-transform:none;text-shadow:none}' +
        '.dsda-bar-inner{max-width:1200px;height:100%;margin:0 auto;padding:0 40px;display:flex;align-items:center;justify-content:space-between;gap:20px}' +
        '.dsda-bar a{text-decoration:none}' +
        '.dsda-bar .dsda-bar-logo{font-family:"Playfair Display",Georgia,serif;font-size:1.5rem;font-weight:700;letter-spacing:3px;color:#e2e8f0}' +
        '.dsda-bar .dsda-bar-logo:hover{color:#c9a227}' +
        '.dsda-bar-nav{display:flex;align-items:center;gap:36px}' +
        '.dsda-bar .dsda-bar-link{color:#94a3b8;font-size:.88rem;font-weight:500;letter-spacing:.5px;white-space:nowrap;transition:color .2s ease}' +
        '.dsda-bar .dsda-bar-link:hover{color:#c9a227}' +
        '.dsda-bar .dsda-bar-radio{display:inline-flex;align-items:center;gap:8px;padding:6px 14px;border-radius:20px;' +
            'border:1px solid rgba(201,162,39,.55);color:#c9a227;font-weight:600;transition:background .2s ease,color .2s ease}' +
        '.dsda-bar .dsda-bar-radio:hover,.dsda-bar .dsda-bar-radio[aria-current]{background:#c9a227;border-color:#c9a227;color:#0a1628}' +
        '.dsda-bar-dot{width:7px;height:7px;border-radius:50%;flex:none;background:#e5484d;box-shadow:0 0 8px rgba(229,72,77,.8);animation:dsdaBarOnAir 1.8s ease-in-out infinite}' +
        '@keyframes dsdaBarOnAir{50%{opacity:.35}}' +
        '.dsda-bar a:focus-visible{outline:2px solid #c9a227;outline-offset:3px;border-radius:4px}' +
        /* make room: the pages centre a card in the viewport, so pad the top and let short screens scroll. */
        /* height:auto + min-height: a card taller than the screen grows the page down instead of sliding up under the bar */
        'body.dsda-has-bar{padding-top:calc(var(--dsda-bar-h) + 20px);height:auto;min-height:100vh;min-height:100dvh;overflow-y:auto}' +
        '@media (max-width:768px){' +
            ':root{--dsda-bar-h:82px}' +
            '.dsda-bar-inner{flex-direction:column;justify-content:center;gap:6px;padding:0 12px}' +
            '.dsda-bar .dsda-bar-logo{font-size:1.5rem;letter-spacing:10px;text-indent:10px;line-height:1.2}' +
            '.dsda-bar-nav{gap:10px;justify-content:center}' +
            '.dsda-bar .dsda-bar-link{font-size:.72rem;letter-spacing:.3px}' +
            '.dsda-bar .dsda-bar-radio{padding:3px 8px;gap:5px}' +
            '.dsda-bar-wide{display:none}' +
        '}' +
        '@media (max-width:350px){.dsda-bar-nav{gap:7px}.dsda-bar .dsda-bar-link{font-size:.66rem;letter-spacing:0}.dsda-bar .dsda-bar-radio{padding:3px 6px}}' +
        '@media (prefers-reduced-motion:reduce){.dsda-bar-dot{animation:none}}';

    var head = document.head || document.documentElement;
    var style = document.createElement('style');
    style.textContent = css;
    head.appendChild(style);
    // the main site's header fonts (the radio pages don't load them on their own)
    var font = document.createElement('link');
    font.rel = 'stylesheet';
    font.href = 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=Inter:wght@500;600&display=swap';
    head.appendChild(font);

    var bar = document.createElement('div');
    bar.className = 'dsda-bar';
    bar.setAttribute('role', 'banner');
    // static template: every string in it is defined above in this file
    bar.innerHTML =
        '<div class="dsda-bar-inner">' +
            '<a class="dsda-bar-logo" href="/" aria-label="DSDA home">DSDA</a>' +
            '<nav class="dsda-bar-nav" aria-label="ds-da.ca">' +
                LINKS.map(function (l) { return '<a class="dsda-bar-link" href="' + l.href + '">' + l.html + '</a>'; }).join('') +
                '<a class="dsda-bar-link dsda-bar-radio" href="/radio/stations/"' + (onHub ? ' aria-current="page"' : '') + '>' +
                    '<span class="dsda-bar-dot" aria-hidden="true"></span><span><span class="dsda-bar-wide">DSDA </span>Radio</span></a>' +
            '</nav>' +
        '</div>';

    function mount() {
        document.body.classList.add('dsda-has-bar');
        document.body.insertBefore(bar, document.body.firstChild);
    }
    if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
})();
