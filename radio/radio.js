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

   Design — TWO playback paths, picked per station:

   A) SEAMLESS (Web Audio).  One-track loop stations (the games'
      own originals).  The file is fetched and decoded ONCE into an
      AudioBuffer, then played by an AudioBufferSourceNode with
      loop = true.  The loop happens inside the audio graph:
      sample-accurate, no media-element seek, no re-buffer, no
      decoder reset — therefore no gap.
      NOTE: <audio>.loop is NOT gapless.  Looping a media element
      is a seek back to 0, and the element re-establishes its byte
      range + flushes the decode pipeline to do it.  Over the
      network that is the 1-2s "skip" we had.  Do not use it for
      music that has to loop in time.

   B) STREAM (<audio>).  Playlist / cross-origin stations
      (Polkahole).  A gap between two different songs is
      inaudible, and Web Audio would need CORS headers from the
      remote host anyway.

   Which path a station takes:  "loop": true/false in stations.json
   forces it; with no flag, a one-track SAME-ORIGIN station is
   treated as a seamless loop and anything else streams.

   - If the game exposes window.__dsdaAudioBus (an AudioNode), the
     seamless path routes through it, so ducking under voice/SFX
     works for those stations.
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
  // --- seamless (Web Audio) path state ---
  ctx: null,       // AudioContext (the game's own, if it exposes a bus)
  gain: null,      // volume node for the seamless path
  node: null,      // live AudioBufferSourceNode
  _buffers: {},    // url -> decoded AudioBuffer (decode once, retune instantly)
  _resume: null,   // {url, at} so pause/unpause doesn't restart the loop
  _nodeStartedAt: 0,
  _nodeOffset: 0,

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

    // audio element — used for the STREAM path only (playlist / cross-origin).
    // preload 'auto' (was 'metadata') so the next song is buffered before the
    // current one ends; shortens the gap between playlist tracks too.
    this.audio = new Audio();
    this.audio.preload = 'auto';
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

  // ---- path selection -------------------------------------------------
  _isSeamless(st) {
    if (!st || !st.tracks || !st.tracks.length) return false;
    if (typeof st.loop === 'boolean') return st.loop;   // manifest override
    return st.tracks.length === 1 && this._sameOrigin(st.tracks[0].url);
  },
  _sameOrigin(url) {
    try { return new URL(url, location.href).origin === location.origin; }
    catch (e) { return false; }
  },

  // ---- seamless path (Web Audio) --------------------------------------
  _actx() {
    if (this.ctx) return this.ctx;
    const bus = window.__dsdaAudioBus;
    if (bus && bus.context) {
      // share the game's context so the radio can be ducked under voice/SFX
      this.ctx = bus.context;
      this.gain = this.ctx.createGain();
      this.gain.connect(bus);
    } else {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.gain = this.ctx.createGain();
      this.gain.connect(this.ctx.destination);
    }
    this.gain.gain.value = this.volume;
    return this.ctx;
  },

  /* Trim the loop to the audio that is actually there.
     Two kinds of junk sit at the edges of a rendered track:
       - format padding: MP3 is framed at 1152 samples, so the encoder pads
         the tail out to a frame boundary (and adds a short encoder delay).
       - dead air the render script left behind. ShatterBlock's four
         originals carry ~1.1s of literal zero samples at the end.
     Either one makes a "seamless" loop audibly skip, so the loop points are
     set to the first/last sample above -60 dBFS instead of 0..duration.
     -60 dBFS measured best on the real assets: it costs the Machine Elves
     tracks nothing (0ms trimmed — their audio runs hot to the last sample)
     and takes ShatterBlock's dead air off completely (1241ms vs 1088ms at
     -80 dBFS, where a 150ms breath survived). Each end is capped at 2s so a
     bad scan can never eat the track.

     Then both ends are SNAPPED to the quietest sample within 5ms (i.e. the
     nearest zero crossing). Trimming alone leaves a step at the splice —
     last sample of the loop vs first sample — and a step is a click. Machine
     Elves' "fairyland" steps 0.45 (-6.9 dBFS) raw; snapping takes it to
     0.0026 (-51.8 dBFS), inaudible, for under 5ms of loop-length change.
     A fade would also kill the click but would dip the level every bar.

     Auto-detection has a limit: it finds where the AUDIO ends, which is not
     the same thing as where the BAR ends. Where a final note's decay rings
     past the bar line the loop comes out long, and where the render was
     truncated it comes out short — either way the beat stumbles once a loop.
     Nothing measurable in the file fixes that, so a track may carry explicit
     "loopStart"/"loopEnd" (seconds) in stations.json, which win outright.
     Those come from the render script's own tempo and bar count, or from
     tuning by ear. */
  _loopPoints(buf, track) {
    if (track && (typeof track.loopEnd === 'number' || typeof track.loopStart === 'number')) {
      const s = Math.max(0, Math.min(buf.duration, +track.loopStart || 0));
      let e = (typeof track.loopEnd === 'number') ? +track.loopEnd : buf.duration;
      e = Math.max(s + 0.05, Math.min(buf.duration, e));
      return { start: s, end: e };
    }
    if (buf.__dsdaLoop) return buf.__dsdaLoop;
    const THR = 1e-3;                    // -60 dBFS
    const n = buf.length, sr = buf.sampleRate;
    const ch = [];
    for (let c = 0; c < buf.numberOfChannels; c++) ch.push(buf.getChannelData(c));
    const amp = (i) => {
      let a = 0;
      for (let c = 0; c < ch.length; c++) { const v = Math.abs(ch[c][i]); if (v > a) a = v; }
      return a;
    };
    // 1. trim format padding + dead air
    const cap = Math.floor(2 * sr);
    let s = 0, e = n - 1;
    while (s < n - 1 && s < cap && amp(s) <= THR) s++;
    while (e > s && (n - 1 - e) < cap && amp(e) <= THR) e--;
    e += 1;                              // e is now exclusive
    // 2. snap both ends to the nearest zero crossing (5ms window)
    const w = Math.floor(0.005 * sr);
    let bs = s, bv = Infinity;
    for (let i = s; i <= Math.min(s + w, n - 1); i++) { const a = amp(i); if (a < bv) { bv = a; bs = i; } }
    let be = e, bev = Infinity;
    for (let i = Math.max(bs + 1, e - w); i < Math.min(e + 1, n); i++) { const a = amp(i); if (a < bev) { bev = a; be = i + 1; } }
    s = bs; e = Math.min(be, n);
    const pts = { start: s / sr, end: e / sr };
    try { Object.defineProperty(buf, '__dsdaLoop', { value: pts }); } catch (err) {}
    return pts;
  },

  async _playSeamless(url, track) {
    const ctx = this._actx();
    if (ctx.state === 'suspended') { try { await ctx.resume(); } catch (e) {} }
    let buf = this._buffers[url];
    if (!buf) {
      const r = await fetch(url);                     // same-origin (or CORS-enabled)
      if (!r.ok) throw new Error('radio fetch ' + r.status);
      buf = await ctx.decodeAudioData(await r.arrayBuffer());
      this._buffers[url] = buf;
    }
    const pts = this._loopPoints(buf, track);
    let from = pts.start;
    if (this._resume && this._resume.url === url &&
        this._resume.at >= pts.start && this._resume.at < pts.end) from = this._resume.at;
    this._resume = null;
    this._stopSeamless();
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.loopStart = pts.start;
    src.loopEnd = pts.end;
    src.connect(this.gain);
    src.start(0, from);
    this.node = src;
    this._nodeStartedAt = ctx.currentTime;
    this._nodeOffset = from;
  },

  // where in the buffer we are right now (an AudioBufferSourceNode has no
  // currentTime, so it's derived from the context clock and wrapped)
  _seamlessPos() {
    const src = this.node;
    if (!src || !this.ctx) return null;
    const ls = src.loopStart, le = src.loopEnd || src.buffer.duration;
    const span = Math.max(1e-3, le - ls);
    let p = this._nodeOffset + (this.ctx.currentTime - this._nodeStartedAt);
    if (p >= le) p = ls + ((p - ls) % span);
    return p;
  },

  _stopSeamless() {
    if (!this.node) return;
    try { this.node.stop(); } catch (e) {}
    try { this.node.disconnect(); } catch (e) {}
    this.node = null;
  },

  // ---- shared entry point ---------------------------------------------
  async _loadAndPlay() {
    const c = this.cur;
    if (!c) return;
    const st = this.manifest.stations[this.station];
    try {
      if (this._isSeamless(st)) {
        this.audio.pause();                 // keep the stream path silent
        await this._playSeamless(c.track.url, c.track);
      } else {
        this._stopSeamless();
        this.audio.loop = (st.tracks.length === 1);
        if (this._src !== c.track.url) {
          this._src = c.track.url;
          this.audio.src = c.track.url;
        }
        await this.audio.play();
      }
      this.playing = true;
    } catch (e) {
      console.warn('[DSDARadio] play failed:', e);
      this.playing = false;
    }
    this.render();
  },

  async play() {
    if (!this.audio) return;
    await this._loadAndPlay();
  },
  pause() {
    if (this.node) {
      const at = this._seamlessPos();
      const c = this.cur;
      if (at != null && c) this._resume = { url: c.track.url, at };
      this._stopSeamless();
    }
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
    this._resume = null;
    if (this.playing) this._loadAndPlay(); else this.render();
  },
  prev() {
    const st = this.manifest && this.manifest.stations[this.station];
    if (!st) return;
    this.track = (this.track - 1 + st.tracks.length) % st.tracks.length;
    this._resume = null;
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
    this._resume = null;
    // Tuning to a station always starts playing it (real-radio behavior) —
    // the dial click is a user gesture so autoplay is allowed.
    this._loadAndPlay();
  },
  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.audio) this.audio.volume = this.volume;          // stream path
    if (this.gain && this.ctx) {                              // seamless path
      // short ramp instead of a jump — a bare .value = x on a live graph clicks
      this.gain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.015);
    }
    if (this.els.volSlider && document.activeElement !== this.els.volSlider) {
      this.els.volSlider.value = String(Math.round(this.volume * 100));
    }
    try { localStorage.setItem('dsda_radio_volume', String(this.volume)); } catch (e) {}
  },
};
