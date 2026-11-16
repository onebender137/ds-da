#!/usr/bin/env python3
"""Generate Chip FM announcements with LOCAL Kokoro TTS (port 8795).

Kokoro has no SSML, so this strips the SSML tags from announcements_ssml.py
down to plain text (breaks -> commas for pauses) and renders each with a
male voice distinct from Mental FM (bm_lewis) and Z107.7 (af_sarah).

Usage:
    python3 gen_kokoro.py            # uses VOICE below (am_eric)
    python3 gen_kokoro.py am_puck    # audition a different voice
"""
import json, os, re, sys, urllib.request

KOKORO = "http://127.0.0.1:8795/tts"
VOICE  = sys.argv[1] if len(sys.argv) > 1 else "am_eric"

def ssml_to_text(ssml: str) -> str:
    s = ssml
    s = re.sub(r'<break[^>]*/>', ',', s)      # pauses -> commas
    s = re.sub(r'<[^>]+>', '', s)             # strip emphasis/phoneme/say-as
    s = re.sub(r'\s+', ' ', s).strip()
    s = re.sub(r'\s+,', ',', s)
    s = re.sub(r',\s*,', ',', s)
    s = re.sub(r',\s+', ', ', s)
    return s

def render(text: str, voice: str) -> bytes:
    body = json.dumps({"text": text, "voice": voice, "format": "mp3"}).encode()
    req = urllib.request.Request(KOKORO, data=body,
                                 headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=90) as r:
        return r.read()

def main():
    here = os.path.dirname(os.path.abspath(__file__))
    sys.path.insert(0, here)
    from announcements_ssml import ANNOUNCEMENTS
    for fname, ssml_body in ANNOUNCEMENTS:
        text = ssml_to_text(ssml_body)
        audio = render(text, VOICE)
        with open(os.path.join(here, fname), "wb") as f:
            f.write(audio)
        print(f"  {fname}  {len(audio)//1024} KB  <- {text[:60]}...")
    print(f"Done — {len(ANNOUNCEMENTS)} announcements (voice={VOICE}) in {here}")

if __name__ == "__main__":
    main()
