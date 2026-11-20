/* ============================================================================
   DSDA site bar for the radio pages (the hub + every station page).
   One line per page, straight after <body>:
       <script src="/radio/site-bar.js?v=3" data-themed></script>   (hub)
       <script src="/radio/site-bar.js?v=3"></script>               (station pages)

   It injects the ds-da.ca header as a fixed bar and pads the page so nothing
   sits underneath it. Everything is prefixed dsda-bar so it can't collide with
   a station's own styles (the radio pages don't load /style.css).

   PIXEL-MATCH RULE: the CSS below is a scoped copy of the .header / .logo /
   .nav / .theme-toggle / .nav-radio rules in /style.css — same sizes, padding,
   colours, breakpoints and link order as /index.html and /games/index.html,
   so the header doesn't jump when you move between pages. If you change the
   header in style.css, change it HERE too (and bump ?v= on every radio page).

   data-themed: the page has the site's light/dark theme (inline <head> script
   + /theme.js). The bar follows html.dark and shows the theme toggle.
   Without it (the station pages, which have their own dark art direction and
   don't load theme.js) the bar is always the dark-mode header and has no
   toggle — a toggle there would be a dead button.
   ========================================================================== */
(function () {
    'use strict';
    if (document.querySelector('.dsda-bar')) return;

    var me = document.currentScript;
    var themed = !!(me && me.hasAttribute('data-themed'));

    var LINKS = [
        { href: 'https://hopes-and-dreams.ca', html: 'Hopes &amp; Dreams' },
        { href: 'https://polkahole.ca', html: 'Polkahole' },
        { href: '/proof/', html: 'Proof<span class="dsda-bar-wide"> of Creation</span>' },
        { href: '/games/', html: 'Arcade' }
    ];
    var onHub = /^\/radio\/stations\/?(index\.html)?$/.test(location.pathname);

    // D = selector prefix for the dark look: always on for unthemed pages,
    // only under html.dark for themed ones.
    var D = themed ? 'html.dark ' : '';
    var css =
        ':root{--dsda-bar-h:80px}' +
        /* .header */
        '.dsda-bar{position:fixed;top:0;left:0;right:0;z-index:1000;' +
            'background:rgba(250,250,248,.95);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);' +
            'border-bottom:1px solid #e5e7eb;' +
            'font-family:Inter,-apple-system,BlinkMacSystemFont,sans-serif;line-height:1.6;' +
            'letter-spacing:normal;text-transform:none;text-shadow:none;text-align:left;' +
            '-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}' +
        '.dsda-bar *{box-sizing:border-box;margin:0}' +
        /* .header-inner */
        '.dsda-bar-inner{max-width:1200px;margin:0 auto;padding:20px 40px;display:flex;justify-content:space-between;align-items:center}' +
        /* .logo */
        '.dsda-bar .dsda-bar-logo{font-family:"Playfair Display",Georgia,serif;font-size:1.5rem;font-weight:700;color:#0a1628;text-decoration:none;letter-spacing:3px;line-height:1.6}' +
        /* .nav / .nav a */
        '.dsda-bar-nav{display:flex;align-items:center;gap:36px}' +
        '.dsda-bar .dsda-bar-link{color:#6b7280;text-decoration:none;font-size:.88rem;font-weight:500;letter-spacing:.5px;white-space:nowrap;transition:color .2s ease}' +
        '.dsda-bar .dsda-bar-link:hover{color:#a8861f}' +
        /* .nav a.nav-radio */
        '.dsda-bar .dsda-bar-radio{display:inline-flex;align-items:center;gap:8px;padding:6px 14px;border-radius:20px;' +
            'border:1px solid rgba(201,162,39,.55);color:#a8861f;font-weight:600;' +
            'transition:background .2s ease,color .2s ease,border-color .2s ease}' +
        '.dsda-bar .dsda-bar-radio:hover{background:#c9a227;border-color:#c9a227;color:#0a1628}' +
        '.dsda-bar-dot{width:7px;height:7px;border-radius:50%;flex:none;background:#e5484d;box-shadow:0 0 8px rgba(229,72,77,.8);animation:dsdaBarOnAir 1.8s ease-in-out infinite}' +
        '@keyframes dsdaBarOnAir{50%{opacity:.35}}' +
        /* .theme-toggle */
        '.dsda-bar .dsda-bar-theme{display:inline-flex;align-items:center;gap:8px;padding:6px 14px;border-radius:20px;' +
            'border:1px solid #e5e7eb;background:#fafaf8;color:#6b7280;font-family:Inter,sans-serif;' +
            'font-size:.78rem;font-weight:600;letter-spacing:.5px;line-height:normal;cursor:pointer;transition:all .2s ease}' +
        '.dsda-bar .dsda-bar-theme:hover{border-color:#c9a227;color:#0a1628}' +
        '.dsda-bar .dsda-bar-theme .theme-icon{font-size:.9rem;line-height:normal}' +
        '.dsda-bar .dsda-bar-theme .theme-label{white-space:nowrap}' +
        '.dsda-bar a:focus-visible,.dsda-bar button:focus-visible{outline:2px solid #c9a227;outline-offset:3px;border-radius:4px}' +
        /* dark mode (html.dark in style.css) */
        D + '.dsda-bar{background:rgba(10,22,40,.95);border-bottom-color:#1e293b}' +
        D + '.dsda-bar .dsda-bar-logo{color:#e2e8f0}' +
        D + '.dsda-bar .dsda-bar-link{color:#94a3b8}' +
        D + '.dsda-bar .dsda-bar-link:hover{color:#c9a227}' +
        D + '.dsda-bar .dsda-bar-radio{color:#c9a227}' +
        D + '.dsda-bar .dsda-bar-radio:hover{color:#0a1628}' +
        D + '.dsda-bar .dsda-bar-theme{background:#132038;border-color:#1e293b;color:#94a3b8}' +
        D + '.dsda-bar .dsda-bar-theme:hover{border-color:#c9a227;color:#e2e8f0}' +
        /* make room under the fixed bar (height is measured after mount) */
        'body.dsda-has-bar{padding-top:calc(var(--dsda-bar-h) + 20px);height:auto;min-height:100vh;min-height:100dvh;overflow-y:auto}' +
        /* breakpoints — same as style.css */
        '@media (max-width:1000px){.dsda-bar-nav{gap:8px 18px}.dsda-bar-wide{display:none}}' +
        '@media (max-width:768px){' +
            '.dsda-bar-inner{padding:12px 20px;flex-direction:column;gap:10px;position:relative}' +
            '.dsda-bar .dsda-bar-logo{align-self:center;font-size:1.75rem;letter-spacing:10px;text-indent:10px}' +
            '.dsda-bar-nav{flex-wrap:nowrap;justify-content:center;gap:8px 10px}' +
            '.dsda-bar .dsda-bar-link{font-size:.72rem;letter-spacing:.3px}' +
            '.dsda-bar .dsda-bar-radio{padding:3px 8px;gap:5px}' +
            '.dsda-bar .dsda-bar-theme .theme-label{display:none}' +
            /* style.css's base .theme-toggle rule sits after its phone media query, so on the live
               site the pill keeps its desktop padding/gap/icon size on phones — match what renders. */
            '.dsda-bar .dsda-bar-theme{position:absolute;top:10px;right:12px;z-index:2}' +
        '}' +
        '@media (max-width:350px){.dsda-bar-nav{gap:8px 7px}.dsda-bar .dsda-bar-link{font-size:.66rem;letter-spacing:0}.dsda-bar .dsda-bar-radio{padding:3px 6px}}' +
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

    var bar = document.createElement('header');
    bar.className = 'dsda-bar';
    // static template: every string in it is defined above in this file.
    // Order matches /index.html: theme toggle first, then the links, Radio last.
    bar.innerHTML =
        '<div class="dsda-bar-inner">' +
            '<a class="dsda-bar-logo" href="/" aria-label="DSDA home">DSDA</a>' +
            '<nav class="dsda-bar-nav" aria-label="ds-da.ca">' +
                (themed ? '<button class="dsda-bar-theme" id="themeToggle" aria-label="Toggle theme"><span class="theme-icon">☀️</span><span class="theme-label">Light</span></button>' : '') +
                LINKS.map(function (l) { return '<a class="dsda-bar-link" href="' + l.href + '">' + l.html + '</a>'; }).join('') +
                '<a class="dsda-bar-link dsda-bar-radio" href="/radio/stations/"' + (onHub ? ' aria-current="page"' : '') + '>' +
                    '<span class="dsda-bar-dot" aria-hidden="true"></span><span><span class="dsda-bar-wide">DSDA </span>Radio</span></a>' +
            '</nav>' +
        '</div>';

    // Pad the page by the bar's real height (it changes at the breakpoints and
    // when the web fonts land), instead of guessing a fixed number.
    function fit() {
        var h = bar.offsetHeight;
        if (h) document.documentElement.style.setProperty('--dsda-bar-h', h + 'px');
    }
    function mount() {
        document.body.classList.add('dsda-has-bar');
        document.body.insertBefore(bar, document.body.firstChild);
        fit();
        window.addEventListener('resize', fit);
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
        if (window.ResizeObserver) new ResizeObserver(fit).observe(bar);
    }
    if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
})();
