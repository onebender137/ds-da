# DropBlock 50-run determinism gate (2026-11-23)

All 50 runs replayed identical in Node against
`git show 65b02fe:games/dropblock/sim.js` (score, ticks, phase — all match).

| Leg | Engine | Runs | Log |
| --- | --- | --- | --- |
| Chromium desktop (headless) | V8 | 13 | logs-chromium.json |
| Firefox desktop (headless) | Gecko | 13 | logs-firefox.json |
| WebKit (headless WPE) | JavaScriptCore | 12 | logs-webkit.json |
| Android Brave (Pixel 9, 120 Hz, real device over adb/CDP) | V8 on Android | 12 | logs-android.json |

Log format: `{seed, events: [[tick, bits] change-events], score, ticks, phase, wallSec, rate}`.
`bits` is the pinned 8-bit input mask: bit0 left press, bit1 left held-final,
bit2 right press, bit3 right held-final, bit4 down press, bit5 down held-final,
bit6 hard-drop press, **bit7 touch source** (drives the per-press DAS profile:
keyboard 8/4 ticks, touch 14/6 — replays reproduce the profile switch).

Replay: `node ~/.hermes/cache/scratch/gate/replay-db.js <sha> <logs...>`
(replay script lives in scratch; the gate is a one-shot merge gate,
replayd supersedes it in Phase 2).

Tick-rate evidence (same session): 58.9–60.1 t/s per-run on desktop legs
(chromium 59.69 mean, firefox 59.99 mean, webkit 60.02 mean); 59.94–60.08
per-run on the Pixel (real 120 Hz display). Zero page errors on any leg.
