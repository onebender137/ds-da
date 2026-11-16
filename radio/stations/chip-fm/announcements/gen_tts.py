#!/usr/bin/env python3
"""Generate Chip FM announcements via Google Cloud Text-to-Speech (Neural2).

Usage:
    GOOGLE_TTS_API_KEY=xxxxx python3 gen_tts.py
    # or
    python3 gen_tts.py xxxxxxxx

Reads announcements_ssml.py (same dir), wraps each script in <speak>, posts to
the TTS API, and writes MP3s into this directory. No third-party deps (urllib).

Free tier: 1M chars/month free for Neural2 voices — these 5 scripts are a
rounding error. You won't be charged under the free tier.
"""
import base64, json, os, sys, urllib.request

# --- Pick a Neural2 voice (audition others by changing this) ---------------
# en-US-Neural2-A/B/C/D/E/F/G/H/I/J/K/L/M/N/P/Q/R/S/T/U/V/W/X/Y/Z
# C = warm male voice (good default for a retro-gaming host). Swap freely.
VOICE = "en-US-Neural2-C"
LANG  = "en-US"
API   = "https://texttospeech.googleapis.com/v1/text:synthesize"

def synthesize(ssml: str, key: str) -> bytes:
    body = {
        "input": { "ssml": ssml },
        "voice": { "languageCode": LANG, "name": VOICE },
        "audioConfig": {
            "audioEncoding": "MP3",
            "speakingRate": 1.0,
            "pitch": 0,
        },
    }
    req = urllib.request.Request(
        f"{API}?key={key}",
        data=json.dumps(body).encode(),
        headers={ "Content-Type": "application/json" },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return base64.b64decode(json.load(r)["audioContent"])

def main():
    key = os.environ.get("GOOGLE_TTS_API_KEY") or (sys.argv[1] if len(sys.argv) > 1 else "")
    if not key:
        sys.exit("Set GOOGLE_TTS_API_KEY or pass the key as argv[1]")
    here = os.path.dirname(os.path.abspath(__file__))
    sys.path.insert(0, here)
    from announcements_ssml import ANNOUNCEMENTS
    for fname, ssml_body in ANNOUNCEMENTS:
        ssml = f"<speak>{ssml_body}</speak>"
        audio = synthesize(ssml, key)
        with open(os.path.join(here, fname), "wb") as f:
            f.write(audio)
        print(f"  {fname}  {len(audio)//1024} KB")
    print(f"Done — {len(ANNOUNCEMENTS)} announcements written to {here}")

if __name__ == "__main__":
    main()
