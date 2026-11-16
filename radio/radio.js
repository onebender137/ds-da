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
// Tuning-knob model: within LOCK_TOL MHz of a station you're "locked" (clear);
// over FADE_RANGE MHz the static ramps quiet→full (the scan fuzz between stations).
const LOCK_TOL = 0.6;
const FADE_RANGE = 3.0;
const STATIC_LEVEL = 0.5;   // max static gain, relative to master volume
const DSDARadio = {
  manifest: null,
  station: 0,
  track: 0,
  playing: false,
  volume: 0.35,   // dropped from 0.5 — the streams are loud; 0.35 is the comfortable default
  audio: null,
  foldTimer: null, // auto-refold timer (6s after opening)
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
  // --- broadcast (live clock) path state ---
  _bcast: null,        // { manifest, itemIdx } for the tuned-in broadcast station
  _bcastCache: {},     // manifestUrl -> parsed manifest (so re-tuning is instant)
  // --- tuning knob + static (scan) state ---
  _scale: null,        // { min, max } frequency range of the dial
  _scaleEl: null,      // the .radio-scale element
  _knobEl: null,       // the .radio-knob element
  _knobPct: 50,        // knob position (0-100)
  _knobDragging: false,
  _mixStation: 1,      // station audio level (1 = clear, 0 = muted)
  _mixStatic: 0,       // static level (0 = none, 1 = full fuzz)
  _staticSrc: null,    // Web Audio white-noise buffer source
  _staticGain: null,   // Web Audio gain node for the static

  get cur() {
    const st = this.manifest && this.manifest.stations[this.station];
    if (!st) return null;
    if (this._isBroadcast(st)) {
      const item = this._bcast && this._bcastProg(this._bcast.manifest)[this._bcast.itemIdx];
      return { station: st, track: item || null };
    }
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
    // tuning dial — a frequency scale with a draggable knob (scan stations
    // left/right like a real radio; authentic static fuzz between stations).
    this._buildScale();
    body.appendChild(this._scaleEl);
    // now playing (broadcast stations get a freq readout + LIVE badge + credit)
    const now = document.createElement('div');
    now.className = 'radio-now';
    now.innerHTML = '<div class="radio-np-top"><span class="radio-np-stn"></span><span class="radio-np-freq"></span><span class="radio-np-live"></span></div><div class="radio-np-trk">—</div><div class="radio-np-credit"></div>';
    body.appendChild(now);
    // controls — prev station / play-pause / next station. The knob still
    // scans (with the static fuzz), but these buttons make it easy to jump
    // to a specific station on a small screen where the knob is fiddly
    // (103.7 and 107.7 are only 4 MHz apart, so the snap is easy to miss).
    const ctl = document.createElement('div');
    ctl.className = 'radio-ctl';
    const prevSt = document.createElement('button');
    prevSt.textContent = '⏮'; prevSt.title = 'Previous station';
    prevSt.setAttribute('aria-label', 'Previous station');
    prevSt.addEventListener('click', () => this.prevStation());
    ctl.appendChild(prevSt);
    this.els.prevSt = prevSt;
    const play = document.createElement('button');
    play.textContent = '▶'; play.title = 'Play / pause';
    play.setAttribute('aria-label', 'Play or pause');
    play.addEventListener('click', () => this.toggle());
    ctl.appendChild(play);
    this.els.play = play;
    const nextSt = document.createElement('button');
    nextSt.textContent = '⏭'; nextSt.title = 'Next station';
    nextSt.setAttribute('aria-label', 'Next station');
    nextSt.addEventListener('click', () => this.nextStation());
    ctl.appendChild(nextSt);
    this.els.nextSt = nextSt;
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
    this.audio.addEventListener('ended', () => this._onEnded());
    this.audio.addEventListener('error', () => {
      // skip to next on a bad track (don't stall the radio)
      if (this.playing) setTimeout(() => this.next(), 400);
    });
    this._injectStyle();
  },

  // FOLD: collapse the radio to a compact header pill (saves screen space).
  // Collapsed by default; opening it auto-refolds after 6s.
  toggleFold() {
    if (!this.el) return;
    const folded = this.el.classList.toggle('folded');
    const head = this.el.querySelector('.radio-head');
    if (head) head.setAttribute('aria-expanded', String(!folded));
    if (this.foldTimer) { clearTimeout(this.foldTimer); this.foldTimer = null; }
    if (!folded) {
      // opened — auto-refold after 6s (long enough to tune, short enough to clear)
      this.foldTimer = setTimeout(() => this.toggleFold(), 6000);
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
      'background:#00e5ff;border:none;cursor:pointer;box-shadow:0 0 6px rgba(0,229,255,0.6);}' +
      '#radioBox.dsda-radio .radio-np-top{display:flex;align-items:center;gap:5px;min-width:0;}' +
      '#radioBox.dsda-radio .radio-np-stn{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
      '#radioBox.dsda-radio .radio-np-freq{font-size:9px;font-weight:800;letter-spacing:1px;' +
      'color:var(--radio-accent,#00e5ff);flex-shrink:0;}' +
      '#radioBox.dsda-radio .radio-np-live{font-size:8px;font-weight:800;letter-spacing:1px;color:#ff4d4d;' +
      'margin-left:auto;flex-shrink:0;animation:dsdaRadioLive 1.4s ease-in-out infinite;}' +
      '#radioBox.dsda-radio .radio-np-credit{font-size:8px;opacity:.5;margin-top:1px;white-space:nowrap;' +
      'overflow:hidden;text-overflow:ellipsis;}' +
      '#radioBox.dsda-radio .radio-ctl{display:flex;align-items:center;justify-content:center;gap:16px;margin:3px 0;}' +
      '#radioBox.dsda-radio .radio-ctl button{background:none;border:none;color:inherit;cursor:pointer;font-size:17px;line-height:1;padding:5px 6px;opacity:.85;}' +
      '#radioBox.dsda-radio .radio-ctl button:hover{opacity:1;}' +
      // Open (unfolded) radio needs real width — the scale + 3 tappable labels
      // (103.7/107.7/137.7) are unreadable in a 130px corner widget. The folded
      // pill stays compact; only the expanded body is forced wider.
      '#radioBox.dsda-radio:not(.folded){min-width:240px;max-width:300px;}' +
      '#radioBox.dsda-radio .radio-scale{position:relative;height:64px;margin:2px 0 4px;cursor:ew-resize;touch-action:none;user-select:none;}' +
      '#radioBox.dsda-radio .radio-scale-track{position:absolute;left:0;right:0;top:36px;height:16px;' +
      'background:linear-gradient(180deg,#08080f,#12122a);border:1px solid var(--border);border-radius:4px;}' +
      '#radioBox.dsda-radio .radio-tick{position:absolute;top:38px;width:1px;height:9px;background:var(--border);transform:translateX(-50%);}' +
      '#radioBox.dsda-radio .radio-tick-major{top:36px;height:13px;background:var(--muted);}' +
      '#radioBox.dsda-radio .radio-stn-label{position:absolute;top:4px;transform:translateX(-50%);font-size:12px;font-weight:700;' +
      'letter-spacing:.5px;color:var(--radio-accent,#00e5ff);cursor:pointer;white-space:nowrap;padding:2px 3px;}' +
      '#radioBox.dsda-radio .radio-stn-label:hover{text-shadow:0 0 8px var(--radio-accent,#00e5ff);}' +
      '#radioBox.dsda-radio .radio-knob{position:absolute;top:28px;bottom:36px;width:4px;background:var(--radio-accent,#00e5ff);' +
      'transform:translateX(-50%);box-shadow:0 0 8px var(--radio-accent,#00e5ff);cursor:ew-resize;z-index:2;}' +
      '#radioBox.dsda-radio .radio-knob-handle{position:absolute;top:-6px;left:50%;transform:translateX(-50%);width:18px;height:18px;' +
      'border-radius:50%;background:var(--radio-accent,#00e5ff);box-shadow:0 0 10px var(--radio-accent,#00e5ff);}' +
      '@keyframes dsdaRadioLive{0%,100%{opacity:1}50%{opacity:.35}}';
    document.head.appendChild(s);
  },

  render() {
    if (!this.els.np && this.el) {
      this.els.npStn = this.el.querySelector('.radio-np-stn');
      this.els.npTrk = this.el.querySelector('.radio-np-trk');
      this.els.npFreq = this.el.querySelector('.radio-np-freq');
      this.els.npLive = this.el.querySelector('.radio-np-live');
      this.els.npCredit = this.el.querySelector('.radio-np-credit');
    }
    const c = this.cur;
    const isBcast = c && this._isBroadcast(c.station);
    if (this.els.npStn) this.els.npStn.textContent = c ? c.station.name : 'NO SIGNAL';
    if (this.els.npTrk) this.els.npTrk.textContent = (c && c.track) ? c.track.title : '—';
    if (this.els.npFreq) this.els.npFreq.textContent = isBcast ? (c.station.frequency + ' FM') : '';
    if (this.els.npLive) this.els.npLive.textContent = isBcast && this.playing ? '● LIVE' : '';
    if (this.els.npCredit) this.els.npCredit.textContent = (isBcast && c.track && c.track.credit) ? c.track.credit : '';
    // park the knob on the current station's frequency (unless mid-drag)
    if (this._knobEl && !this._knobDragging && c && c.station.frequency) {
      this._knobPct = this._freqToPct(parseFloat(c.station.frequency));
      this._knobEl.style.left = this._knobPct + '%';
    }
    if (this.els.play) this.els.play.textContent = this.playing ? '❚❚' : '▶';
    if (c && c.station.accent && this.el) {
      this.el.style.setProperty('--radio-accent', c.station.accent);
    }
  },

  // ---- path selection -------------------------------------------------
  _isBroadcast(st) { return !!(st && st.type === 'broadcast'); },
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

  // ---- tuning dial (frequency scale + draggable knob) ------------------
  // Builds the dial face: a frequency scale with tick marks, a label per
  // station, and a draggable knob. Dragging scans left/right; releasing
  // snaps to the nearest station and tunes in. Pointer Events cover both
  // mouse (desktop) and touch (mobile hold-and-drag).
  _buildScale() {
    const freqs = this.manifest.stations
      .map((st, i) => ({ st, i }))
      .filter(o => o.st.type === 'broadcast' && o.st.frequency);
    const vals = freqs.map(o => parseFloat(o.st.frequency));
    const pad = 2.0;
    const min = vals.length ? Math.min(...vals) - pad : 88;
    const max = vals.length ? Math.max(...vals) + pad : 108;
    this._scale = { min, max };

    const el = document.createElement('div');
    el.className = 'radio-scale';
    el.setAttribute('role', 'slider');
    el.setAttribute('aria-label', 'Radio tuning dial — drag to scan stations');
    // the scale track
    const track = document.createElement('div');
    track.className = 'radio-scale-track';
    el.appendChild(track);
    // tick marks: 1 MHz minor, 5 MHz major
    for (let f = Math.ceil(min); f <= Math.floor(max); f++) {
      const tick = document.createElement('div');
      tick.className = 'radio-tick' + (f % 5 === 0 ? ' radio-tick-major' : '');
      tick.style.left = this._freqToPct(f) + '%';
      el.appendChild(tick);
    }
    // station frequency labels — TAP one to jump straight to that station
    // (a reliable way to pick a station without dragging the knob precisely).
    // 103.7 and 107.7 are only 4 MHz apart (≈10% of this 38 MHz scale), so
    // their labels would overlap and be unreadable — de-crowd them so each
    // stays visible + tappable. (Nudging is visual only: tapping a label tunes
    // to its true station via the click handler, not its on-screen position.)
    const labelSpecs = freqs
      .map(o => ({ o, pct: this._freqToPct(parseFloat(o.st.frequency)) }))
      .sort((a, b) => a.pct - b.pct);
    const MIN_GAP = 22;   // pct; keeps 5-char labels clear on the ~220px open scale
    for (let i = 1; i < labelSpecs.length; i++) {
      if (labelSpecs[i].pct - labelSpecs[i-1].pct < MIN_GAP) {
        const mid = (labelSpecs[i].pct + labelSpecs[i-1].pct) / 2;
        labelSpecs[i-1].pct = mid - MIN_GAP / 2;
        labelSpecs[i].pct = mid + MIN_GAP / 2;
      }
    }
    // keep labels on the scale (the leftmost one can get pushed off-edge)
    labelSpecs.forEach(s => { s.pct = Math.max(4, Math.min(96, s.pct)); });
    labelSpecs.forEach(spec => {
      const o = spec.o;
      const lbl = document.createElement('div');
      lbl.className = 'radio-stn-label';
      lbl.textContent = o.st.frequency;
      lbl.style.left = spec.pct + '%';
      lbl.title = 'Tune to ' + o.st.name;
      lbl.setAttribute('role', 'button');
      lbl.setAttribute('aria-label', 'Tune to ' + o.st.name);
      lbl.addEventListener('pointerdown', (e) => e.stopPropagation());  // don't start a knob drag
      lbl.addEventListener('click', (e) => { e.stopPropagation(); this.setStation(o.i); });
      el.appendChild(lbl);
    });
    // the draggable knob (pointer)
    const knob = document.createElement('div');
    knob.className = 'radio-knob';
    knob.innerHTML = '<div class="radio-knob-handle"></div>';  // static structure
    el.appendChild(knob);
    this._scaleEl = el;
    this._knobEl = knob;
    // park the knob on the current station (or center)
    const cur = this.manifest.stations[this.station];
    this._knobPct = (cur && cur.frequency) ? this._freqToPct(parseFloat(cur.frequency)) : 50;
    knob.style.left = this._knobPct + '%';

    // --- pointer interaction (mouse + touch) ---
    const onDown = (e) => {
      this._knobDragging = true;
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
      this._knobMove(e);
      e.preventDefault();
    };
    const onMove = (e) => { if (this._knobDragging) this._knobMove(e); };
    const onUp = () => {
      if (!this._knobDragging) return;
      this._knobDragging = false;
      this._knobSnap();
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  },
  _freqToPct(f) { return (f - this._scale.min) / (this._scale.max - this._scale.min) * 100; },
  _pctToFreq(p) { return this._scale.min + (p / 100) * (this._scale.max - this._scale.min); },
  _knobMove(e) {
    const rect = this._scaleEl.getBoundingClientRect();
    if (rect.width === 0) return;   // folded/hidden — no measurable width
    let pct = (e.clientX - rect.left) / rect.width * 100;
    pct = Math.max(0, Math.min(100, pct));
    this._knobPct = pct;
    this._knobEl.style.left = pct + '%';
    this._tuneToKnob();
  },
  // While dragging: lock onto a station when close (clear audio), otherwise
  // cross-fade the current station out and the static in (the scan fuzz).
  _tuneToKnob() {
    const freq = this._pctToFreq(this._knobPct);
    let best = -1, bestDist = Infinity;
    this.manifest.stations.forEach((st, i) => {
      if (st.type === 'broadcast' && st.frequency) {
        const d = Math.abs(freq - parseFloat(st.frequency));
        if (d < bestDist) { bestDist = d; best = i; }
      }
    });
    if (best < 0) return;
    if (bestDist < LOCK_TOL) {
      // locked — clear audio, no static
      if (best !== this.station) this.setStation(best);   // tune in (broadcast clock)
      this._setMix(1, 0);
    } else {
      const f = Math.min(1, (bestDist - LOCK_TOL) / (FADE_RANGE - LOCK_TOL));
      this._setMix(1 - f, f);   // current station fades out, static fades in
    }
  },
  // On release: snap the knob to the nearest station and tune in.
  _knobSnap() {
    const freq = this._pctToFreq(this._knobPct);
    let best = 0, bestDist = Infinity;
    this.manifest.stations.forEach((st, i) => {
      if (st.type === 'broadcast' && st.frequency) {
        const d = Math.abs(freq - parseFloat(st.frequency));
        if (d < bestDist) { bestDist = d; best = i; }
      }
    });
    const st = this.manifest.stations[best];
    if (!st) return;
    this._knobPct = this._freqToPct(parseFloat(st.frequency));
    this._knobEl.style.left = this._knobPct + '%';
    if (best !== this.station) this.setStation(best);
    this._setMix(1, 0);
  },
  // --- static (white-noise) engine + volume mix -------------------------
  _initStatic(ctx) {
    if (this._staticSrc) return;
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) {} }
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this._staticSrc = ctx.createBufferSource();
    this._staticSrc.buffer = buf;
    this._staticSrc.loop = true;
    this._staticGain = ctx.createGain();
    this._staticGain.gain.value = 0;
    this._staticSrc.connect(this._staticGain);
    this._staticGain.connect(this._dest());   // route through the ducking bus
    this._staticSrc.start();
  },
  _dest() {
    const bus = window.__dsdaAudioBus;
    if (bus && bus.duck) return bus.duck('radio');
    return this._actx().destination;
  },
  _setMix(stationFactor, staticFactor) {
    this._mixStation = stationFactor;
    this._mixStatic = staticFactor;
    this._applyVolume();
  },
  _applyVolume() {
    const sf = (this._mixStation != null) ? this._mixStation : 1;
    const stf = (this._mixStatic != null) ? this._mixStatic : 0;
    if (stf > 0.001 && !this._staticGain) this._initStatic(this._actx());
    if (this.audio) this.audio.volume = this.volume * sf;
    if (this.gain && this.ctx) this.gain.gain.setTargetAtTime(this.volume * sf, this.ctx.currentTime, 0.015);
    if (this._staticGain) this._staticGain.gain.setTargetAtTime(this.volume * stf * STATIC_LEVEL, this.ctx.currentTime, 0.01);
  },

  // ---- shared entry point ---------------------------------------------
  async _loadAndPlay() {
    const c = this.cur;
    if (!c) return;
    const st = this.manifest.stations[this.station];
    try {
      if (this._isBroadcast(st)) {
        // resume/re-tune: re-sync to the live clock (time passed while paused)
        if (!this._bcast) {
          await this._tuneBroadcast(this.station);
        } else {
          const r = this._bcastItemAt(this._bcast.manifest, this._bcastPos(this._bcast.manifest));
          this._bcast.itemIdx = r.index;
          await this._playBroadcastItem(r.offset);
        }
      } else if (this._isSeamless(st)) {
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
    this._applyVolume();   // restore the station/static mix (e.g. after pause)
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
    if (this._staticGain) this._staticGain.gain.value = 0;   // static off while paused
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
    if (this._isBroadcast(st)) { this._advanceBroadcast(); return; }  // live feed: re-sync, no skipping
    this.track = (this.track + 1) % st.tracks.length;
    this._resume = null;
    if (this.playing) this._loadAndPlay(); else this.render();
  },
  prev() {
    const st = this.manifest && this.manifest.stations[this.station];
    if (!st) return;
    if (this._isBroadcast(st)) { this._advanceBroadcast(); return; }  // live feed: re-sync, no skipping
    this.track = (this.track - 1 + st.tracks.length) % st.tracks.length;
    this._resume = null;
    if (this.playing) this._loadAndPlay(); else this.render();
  },
  setStation(i, trackIdx) {
    if (!this.manifest || !this.manifest.stations[i]) return;
    this.station = i;
    const st = this.manifest.stations[i];
    this._src = null;
    this._resume = null;
    // Tuning to a station always starts playing it (real-radio behavior) —
    // the dial click is a user gesture so autoplay is allowed.
    if (this._isBroadcast(st)) {
      // live broadcast: fetch its manifest and tune to the shared wall clock
      this._bcast = null;
      this._tuneBroadcast(i);
    } else {
      // optional second arg: which track to land on (games use it to start
      // mid-playlist, e.g. a random track per match). Omitted -> 0.
      const nTracks = st.tracks.length;
      this.track = (Number.isInteger(trackIdx) && trackIdx >= 0 && trackIdx < nTracks) ? trackIdx : 0;
      this._loadAndPlay();
    }
    // park the knob on the station's frequency (unless mid-drag)
    if (this._knobEl && !this._knobDragging && st.frequency) {
      this._knobPct = this._freqToPct(parseFloat(st.frequency));
      this._knobEl.style.left = this._knobPct + '%';
    }
  },
  // Cycle to the previous / next station on the dial (wraps around). Used by
  // the ⏮ / ⏭ buttons — a reliable way to pick a station when the tuning
  // knob is hard to land precisely on a small screen.
  _dialIndices() {
    return (this.manifest && this.manifest.stations)
      ? this.manifest.stations.map((_, i) => i) : [];
  },
  nextStation() {
    const idxs = this._dialIndices();
    if (!idxs.length) return;
    const pos = idxs.indexOf(this.station);
    this.setStation(idxs[(pos + 1) % idxs.length]);
  },
  prevStation() {
    const idxs = this._dialIndices();
    if (!idxs.length) return;
    const pos = idxs.indexOf(this.station);
    this.setStation(idxs[(pos - 1 + idxs.length) % idxs.length]);
  },

  // ---- broadcast (live clock) path -------------------------------------
  // A "broadcast" station points at a manifest.json with program[] + epoch +
  // totalDuration. Every listener shares the same wall clock, so tuning in
  // lands you mid-item (a real radio catch) and everyone is on the same second.
  // On track end we re-sync to the clock and advance to the next program item.
  // The program array may be keyed `program` (standard) or `items` (legacy) —
  // accept both so a manifest field-name typo never kills a station.
  _bcastProg(m) { return (m && (m.program || m.items)) || []; },
  async _fetchBcastManifest(st) {
    if (this._bcastCache[st.manifest]) return this._bcastCache[st.manifest];
    const r = await fetch(st.manifest, { cache: 'no-store' });
    const m = await r.json();
    this._bcastCache[st.manifest] = m;
    return m;
  },
  _bcastPos(m) {
    let pos = (Date.now() / 1000 - m.epoch) % m.totalDuration;
    if (pos < 0) pos += m.totalDuration;
    return pos;
  },
  _bcastItemAt(m, pos) {
    let acc = 0;
    for (let i = 0; i < this._bcastProg(m).length; i++) {
      if (pos < acc + this._bcastProg(m)[i].duration) return { index: i, offset: pos - acc };
      acc += this._bcastProg(m)[i].duration;
    }
    return { index: this._bcastProg(m).length - 1, offset: 0 };
  },
  async _tuneBroadcast(stationIdx) {
    const st = this.manifest.stations[stationIdx];
    let m;
    try { m = await this._fetchBcastManifest(st); }
    catch (e) { console.warn('[DSDARadio] broadcast manifest failed:', e); this.render(); return; }
    const r = this._bcastItemAt(m, this._bcastPos(m));
    // base = the manifest's location, so the program's RELATIVE urls resolve
    // correctly no matter which page (game / station) is playing the show.
    this._bcast = { manifest: m, itemIdx: r.index, base: new URL(st.manifest, location.href) };
    this._stopSeamless();
    await this._playBroadcastItem(r.offset);
  },
  async _playBroadcastItem(offset) {
    const m = this._bcast.manifest;
    const item = this._bcastProg(m)[this._bcast.itemIdx];
    const url = this._bcast.base ? new URL(item.url, this._bcast.base).href : item.url;
    this.audio.loop = false;
    this.audio.src = url;
    this.audio.load();
    const self = this;
    await new Promise((resolve) => {
      const onMeta = () => {
        self.audio.removeEventListener('loadedmetadata', onMeta);
        const o = Math.max(0, Math.min(offset || 0, self.audio.duration - 0.15));
        try { self.audio.currentTime = o; } catch (e) {}
        resolve();
      };
      self.audio.addEventListener('loadedmetadata', onMeta);
      if (self.audio.readyState >= 1) onMeta();   // already have metadata
    });
    await this.audio.play();
    this.playing = true;
    this.render();
  },
  _onEnded() {
    const st = this.manifest && this.manifest.stations[this.station];
    if (this._isBroadcast(st)) this._advanceBroadcast();
    else this.next();
  },
  async _advanceBroadcast() {
    const m = this._bcast.manifest;
    const r = this._bcastItemAt(m, this._bcastPos(m));
    if (r.index === this._bcast.itemIdx) r.index = (this._bcast.itemIdx + 1) % this._bcastProg(m).length;
    this._bcast.itemIdx = r.index;
    if (this.playing) await this._playBroadcastItem(r.offset);
    else this.render();
  },
  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    this._applyVolume();
    if (this.els.volSlider && document.activeElement !== this.els.volSlider) {
      this.els.volSlider.value = String(Math.round(this.volume * 100));
    }
    try { localStorage.setItem('dsda_radio_volume', String(this.volume)); } catch (e) {}
  },
};
