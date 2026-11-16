#!/usr/bin/env python3
"""Generate host announcements for the 3 new DSDA stations with LOCAL Kokoro TTS.

Voices (distinct from the existing bm_lewis / af_sarah / am_eric):
  Easy Mellow FM 92.5  -> am_michael  (warm, calm)
  Most Pit FM 73.7     -> am_puck     (deep, dark)
  Tripped Up FM 127.5  -> af_heart    (smooth, mellow)

Kokoro has no SSML, so scripts are plain text (commas give natural pauses).
Usage: python3 gen_announce.py
"""
import json, os, urllib.request

KOKORO = "http://127.0.0.1:8795/tts"
BASE = "/home/coryr/ds-da/radio/stations"

STATIONS = {
    "easy-mellow": {
        "voice": "am_michael",
        "scripts": {
            "01_intro": "Easy Mellow FM, ninety two point five. The smoothest corner of the dial. Bossa, lounge, and easy listening. No rush, no noise, just mellow. You're tuned in to Easy Mellow.",
            "02_promo": "You're listening to Easy Mellow FM, ninety two point five. Keep it smooth out here. More mellow coming up.",
            "03_promo": "Easy Mellow, ninety two point five. The dial's mellowest frequency. Relax, and let the bossa carry you.",
            "04_bump":  "Easy Mellow FM. Ninety two point five. Smooth as it gets.",
            "05_outro": "That's a set from Easy Mellow FM, ninety two point five. Stay mellow, friend. We'll be right here on the dial.",
        },
    },
    "most-pit": {
        "voice": "am_puck",
        "scripts": {
            "01_intro": "Most Pit FM. Seven three seven. The heaviest frequency on this dial. Death metal, doom, and everything that growls. Welcome to the pit.",
            "02_promo": "You're locked into Most Pit FM, seven three seven. Keep it heavy. More riffs dropping.",
            "03_promo": "Most Pit, seven three seven. Where the guitars get mean. Stay in the pit.",
            "04_bump":  "Most Pit FM. Seven three seven. Heavier than hell.",
            "05_outro": "That's a set from the Most Pit, seven three seven. Keep your head down and your riffs loud. We're back on the dial.",
        },
    },
    "tripped-up": {
        "voice": "af_heart",
        "scripts": {
            "01_intro": "Tripped Up FM. One twenty seven point five. Smooth jazz, triphop, and late night vibes. You're tuned into the trip. Welcome to Tripped Up.",
            "02_promo": "You're on Tripped Up FM, one twenty seven point five. Keep it smooth. More trip coming up.",
            "03_promo": "Tripped Up, one twenty seven point five. Where the jazz drifts and the beats trip. Stay in the zone.",
            "04_bump":  "Tripped Up FM. One twenty seven point five. Smooth as the night.",
            "05_outro": "That's a set from Tripped Up FM, one twenty seven point five. Stay tripped, stay smooth. We'll be right here.",
        },
    },
}

def render(text, voice):
    body = json.dumps({"text": text, "voice": voice, "format": "mp3"}).encode()
    req = urllib.request.Request(KOKORO, data=body,
                                 headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=90) as r:
        return r.read()

def main():
    for st, cfg in STATIONS.items():
        d = os.path.join(BASE, st, "announcements")
        os.makedirs(d, exist_ok=True)
        for fname, text in cfg["scripts"].items():
            out = os.path.join(d, fname + ".mp3")
            if os.path.exists(out) and os.path.getsize(out) > 5000:
                print(f"  [have] {st}/{fname}.mp3"); continue
            audio = render(text, cfg["voice"])
            with open(out, "wb") as f:
                f.write(audio)
            print(f"  [OK] {st}/{fname}.mp3 ({len(audio)//1024}KB) voice={cfg['voice']}")
    print("\nDone.")

if __name__ == "__main__":
    main()
