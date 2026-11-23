# TappyCat 50-run determinism gate (2026-11-23)

All 50 runs replayed identical in Node against
`git show c0e30ea:games/tappycat/sim.js` (score, ticks, reason — all match).

| Leg | Engine | Runs | Log |
| --- | --- | --- | --- |
| Chromium desktop (headless) | V8 | 13 | logs-chromium.json |
| Firefox desktop (headless) | Gecko | 13 | logs-firefox.json |
| WebKit (headless WPE) | JavaScriptCore | 12 | logs-webkit.json |
| Android Chrome (Pixel 9, 120 Hz, real device over adb/CDP) | V8 on Android | 12 | logs-android.json |

Log format: `{seed, events: [[tick, bits] change-events], score, ticks, reason, wallSec, rate}`.
Replay: `node ~/.hermes/cache/scratch/gate/replay.js <sha> <logs...>` (replay script
lives in scratch; the gate is a one-shot merge gate, replayd supersedes it in Phase 2).

Tick-rate evidence (same session): 59.95/s aggregate over 72.5 s of play
(per-run 59.82–60.20, 16 fps CDP tab); 59.94–60.06 per-run on the Pixel (120 Hz).
