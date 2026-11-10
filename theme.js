/* ============================================================================
   DSDA — theme.js
   Light/dark theme toggle. Persists to localStorage.
   The "apply on load" part is an inline script in the <head> (to avoid a
   flash); this file handles the toggle button + the initial state.
   ========================================================================== */

(function () {
    'use strict';

    function getTheme() {
        return localStorage.getItem('dsda-theme') || 'light';
    }

    function applyTheme(theme) {
        document.documentElement.classList.toggle('dark', theme === 'dark');
        localStorage.setItem('dsda-theme', theme);
        updateButton(theme);
        // Notify pages with a 3D scene (e.g. the arcade hall) so they can
        // re-light the scene for the new theme.
        window.dispatchEvent(new CustomEvent('dsda-theme-change', { detail: { theme } }));
    }

    function updateButton(theme) {
        var btn = document.getElementById('themeToggle');
        if (!btn) return;
        var icon = btn.querySelector('.theme-icon');
        var label = btn.querySelector('.theme-label');
        if (theme === 'dark') {
            if (icon) icon.textContent = '🌙';
            if (label) label.textContent = 'Dark';
            btn.setAttribute('aria-label', 'Switch to light mode');
        } else {
            if (icon) icon.textContent = '☀️';
            if (label) label.textContent = 'Light';
            btn.setAttribute('aria-label', 'Switch to dark mode');
        }
    }

    function init() {
        var btn = document.getElementById('themeToggle');
        if (!btn) return;
        // Sync the button to the current theme (set by the inline <head> script)
        updateButton(getTheme());
        btn.addEventListener('click', function () {
            var newTheme = (getTheme() === 'dark') ? 'light' : 'dark';
            applyTheme(newTheme);
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
