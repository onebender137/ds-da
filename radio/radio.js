/* ============================================================
   DSDA Radio — cross-game radio network
   ------------------------------------------------------------
   A shared radio player + UI that any ds-da game can drop in.
   It loads stations.json (the manifest), streams tracks from
   their source URLs, and shows a now-playing widget.

   Drop into a game:
     <script src="../../radio/radio.js"></script>
     ...
     DSDARadio.init({ mount: 'radioBox', manifest: '../../radio/stations.json' });

   Design:
   - Tracks STREAM from their URLs (no bundling) — a real radio.
   - Plain <audio> element (robust cross-origin playback).
   - Optional: if the game exposes window.__dsdaAudioBus (an
     AudioNode), the radio routes through it for ducking — but
     that needs the audio to be same-origin or CORS-enabled.
   - New stations/tracks = edit stations.json only. Games never change.
   ============================================================ */
const DSDARadio = {
  manifest: null,
  station: 0,
  track: 0,
  playing: false,
  volume: 0.35,   // dropped from 0.5 — the streams are loud; 0.35 is the comfortable default
  audio: null,
  foldTimer: null, // auto-refold timer (2s after opening)
  el: null,
  els: {},
  _src: null,   // last requested source (for change detection)

  get cur() {
    const st = this.manifest && this.manifest.stations[this.station];
    if (!st) return null;
    return { station: st, track: st.tracks[this.track] };
  },

  async init(opts = {}) {
    const mountId = opts.mount || 'radioBox';
    this.el = document.getElementById(mountId);
    if (!this.el) { console.warn('[DSDARadio] mount #' + mountId + ' not found'); return; }
    this.manifestUrl = opts.manifest || '../../radio/stations.json';
    // restore the player's saved volume (persists across games + sessions)
    try {
      const sv = parseFloat(localStorage.getItem('dsda_radio_volume'));
      if (!isNaN(sv)) this.volume = Math.max(0, Math.min(1, sv));
    } catch (e) {}
    await this.loadManifest();
    this.buildUI();
    this.render();
    // start collapsed by default (saves screen space); the header pill re-opens it
    this.el.classList.add('folded');
    const head = this.el.querySelector('.radio-head');
    if (head) head.setAttribute('aria-expanded', 'false');
  },

  async loadManifest() {
    try {
      const r = await fetch(this.manifestUrl, { cache: 'no-cache' });
      this.manifest = await r.json();
    } catch (e) {
      console.warn('[DSDARadio] manifest load failed:', e);
      this.manifest = { stations: [] };
    }
  },

  buildUI() {
    const el = this.el;
    el.innerHTML = '';
    el.classList.add('dsda-radio');
    // NOTE: innerHTML below is STATIC structure only (no untrusted content).
    // Station/track names (from stations.json) are set via textContent in render().
    // header (a toggle button — click to fold/unfold the radio to save space)
    const head = document.createElement('button');
    head.className = 'radio-head';
    head.type = 'button';
    head.setAttribute('aria-expanded', 'true');
    head.title = 'Fold / unfold the radio';
    head.innerHTML = '<span class="radio-live"></span><span class="radio-title">DSDA RADIO</span><span class="radio-chev">▾</span>';
    head.addEventListener('click', () => this.toggleFold());
    el.appendChild(head);
    // body (dial + now playing + controls) — hidden when folded
    const body = document.createElement('div');
    body.className = 'radio-body';
    // station dial
    const dial = document.createElement('div');
    dial.className = 'radio-dial';
    this.manifest.stations.forEach((st, i) => {
      const b = document.createElement('button');
      b.className = 'radio-stn';
      b.textContent = st.name;
      b.title = st.tagline || '';
      b.addEventListener('click', () => this.setStation(i));
      dial.appendChild(b);
    });
    body.appendChild(dial);
    // now playing
    const now = document.createElement('div');
    now.className = 'radio-now';
    now.innerHTML = '<div class="radio-np-stn"></div><div class="radio-np-trk">—</div>';
    body.appendChild(now);
    // controls
    const ctl = document.createElement('div');
    ctl.className = 'radio-ctl';
    const mk = (label, title, fn) => {
      const b = document.createElement('button');
      b.textContent = label; b.title = title;
      b.addEventListener('click', fn);
      ctl.appendChild(b); return b;
    };
    this.els.prev = mk('⏮', 'Previous track', () => this.prev());
    this.els.play = mk('▶', 'Play / pause', () => this.toggle());
    this.els.next = mk('⏭', 'Next track', () => this.next());
    body.appendChild(ctl);
    // volume control (slider, 0-100)
    const vol = document.createElement('div');
    vol.className = 'radio-vol';
    const volIcon = document.createElement('span');
    volIcon.className = 'radio-vol-icon';
    volIcon.textContent = '🔊';
    volIcon.title = 'Volume';
    const volSlider = document.createElement('input');
    volSlider.type = 'range';
    volSlider.className = 'radio-vol-slider';
    volSlider.min = '0';
    volSlider.max = '100';
    volSlider.step = '1';
    volSlider.value = String(Math.round(this.volume * 100));
    volSlider.title = 'Volume';
    volSlider.setAttribute('aria-label', 'Radio volume');
    volSlider.addEventListener('input', () => {
      this.setVolume(volSlider.value / 100);
    });
    this.els.volSlider = volSlider;
    vol.appendChild(volIcon);
    vol.appendChild(volSlider);
    body.appendChild(vol);
    el.appendChild(body);

    // audio element
    this.audio = new Audio();
    this.audio.preload = 'metadata';
    this.audio.volume = this.volume;
    this.audio.addEventListener('ended', () => this.next());
    this.audio.addEventListener('error', () => {
      // skip to next on a bad track (don't stall the radio)
      if (this.playing) setTimeout(() => this.next(), 400);
    });
    this._injectStyle();
  },

  // FOLD: collapse the radio to a compact header pill (saves screen space).
  // Collapsed by default; opening it auto-refolds after 2s.
  toggleFold() {
    if (!this.el) return;
    const folded = this.el.classList.toggle('folded');
    const head = this.el.querySelector('.radio-head');
    if (head) head.setAttribute('aria-expanded', String(!folded));
    if (this.foldTimer) { clearTimeout(this.foldTimer); this.foldTimer = null; }
    if (!folded) {
      // opened — auto-refold after 2s
      this.foldTimer = setTimeout(() => this.toggleFold(), 2000);
    }
  },
  _injectStyle() {
    if (this._styleInjected) return;
    this._styleInjected = true;
    const s = document.createElement('style');
    s.textContent =
      '#radioBox.dsda-radio .radio-head{cursor:pointer;width:100%;background:none;border:none;' +
      'color:inherit;font:inherit;padding:0;text-align:left;}' +
      '#radioBox.dsda-radio .radio-chev{margin-left:auto;font-size:9px;opacity:.7;transition:transform .25s;}' +
      '#radioBox.dsda-radio.folded{width:auto;min-width:96px;}' +
      '#radioBox.dsda-radio.folded .radio-body{display:none;}' +
      '#radioBox.dsda-radio.folded .radio-chev{transform:rotate(-90deg);}' +
      '#radioBox.dsda-radio .radio-vol{display:flex;align-items:center;gap:6px;margin-top:3px;}' +
      '#radioBox.dsda-radio .radio-vol-icon{font-size:10px;opacity:.85;flex-shrink:0;}' +
      '#radioBox.dsda-radio .radio-vol-slider{flex:1;height:4px;-webkit-appearance:none;appearance:none;' +
      'background:rgba(0,229,255,0.22);border-radius:2px;outline:none;cursor:pointer;}' +
      '#radioBox.dsda-radio .radio-vol-slider::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;' +
      'width:11px;height:11px;border-radius:50%;background:#00e5ff;cursor:pointer;box-shadow:0 0 6px rgba(0,229,255,0.6);}' +
      '#radioBox.dsda-radio .radio-vol-slider::-moz-range-thumb{width:11px;height:11px;border-radius:50%;' +
      'background:#00e5ff;border:none;cursor:pointer;box-shadow:0 0 6px rgba(0,229,255,0.6);}';
    document.head.appendChild(s);
  },

  render() {
    if (!this.els.np && this.el) {
      this.els.npStn = this.el.querySelector('.radio-np-stn');
      this.els.npTrk = this.el.querySelector('.radio-np-trk');
      this.els.dial = [...this.el.querySelectorAll('.radio-stn')];
    }
    const c = this.cur;
    if (this.els.npStn) this.els.npStn.textContent = c ? c.station.name : 'NO SIGNAL';
    if (this.els.npTrk) this.els.npTrk.textContent = c ? c.track.title : '—';
    if (this.els.dial) this.els.dial.forEach((b, i) => b.classList.toggle('on', i === this.station));
    if (this.els.play) this.els.play.textContent = this.playing ? '❚❚' : '▶';
    if (c && c.station.accent && this.el) {
      this.el.style.setProperty('--radio-accent', c.station.accent);
    }
  },

  async _loadAndPlay() {
    const c = this.cur;
    if (!c) return;
    if (this._src !== c.track.url) {
      this._src = c.track.url;
      this.audio.src = c.track.url;
    }
    try {
      await this.audio.play();
      this.playing = true;
    } catch (e) {
      this.playing = false;
    }
    this.render();
  },

  async play() {
    if (!this.audio) return;
    await this._loadAndPlay();
  },
  pause() {
    if (this.audio) this.audio.pause();
    this.playing = false;
    this.render();
  },
  async toggle() {
    if (this.playing) this.pause();
    else await this.play();
  },
  next() {
    const st = this.manifest && this.manifest.stations[this.station];
    if (!st) return;
    this.track = (this.track + 1) % st.tracks.length;
    if (this.playing) this._loadAndPlay(); else this.render();
  },
  prev() {
    const st = this.manifest && this.manifest.stations[this.station];
    if (!st) return;
    this.track = (this.track - 1 + st.tracks.length) % st.tracks.length;
    if (this.playing) this._loadAndPlay(); else this.render();
  },
  setStation(i, trackIdx) {
    if (!this.manifest || !this.manifest.stations[i]) return;
    this.station = i;
    // optional second arg: which track to land on (games use it to start mid-playlist,
    // e.g. a random track per match). Omitted -> 0, exactly the old behavior.
    const nTracks = this.manifest.stations[i].tracks.length;
    this.track = (Number.isInteger(trackIdx) && trackIdx >= 0 && trackIdx < nTracks) ? trackIdx : 0;
    this._src = null;
    // Tuning to a station always starts playing it (real-radio behavior) —
    // the dial click is a user gesture so autoplay is allowed.
    this._loadAndPlay();
  },
  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.audio) this.audio.volume = this.volume;
    if (this.els.volSlider && document.activeElement !== this.els.volSlider) {
      this.els.volSlider.value = String(Math.round(this.volume * 100));
    }
    try { localStorage.setItem('dsda_radio_volume', String(this.volume)); } catch (e) {}
  },
};
