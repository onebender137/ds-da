# Chip FM 103.7 — announcement scripts (SSML)
# Host voice: a Google Cloud Text-to-Speech NEURAL2 voice (en-US-Neural2-*).
# The specific voice name is set in gen_tts.py (VOICE constant) — swap it to
# audition a different Neural2 voice without touching the scripts.
#
# "Tricking the TTS" — the SSML devices used here:
#   <break time="NNNms"/>          -> explicit pauses (the "pause when needed")
#   <phoneme alphabet="ipa" ph=""> -> force an exact pronunciation
#   <say-as interpret-as="...">    -> control how numbers/letters are spoken
#   <prosody rate/pitch/volume>    -> pacing + energy
#   <emphasis level="...">         -> stress a word
#
# Words that a generic TTS tends to mangle in a retro-gaming context are
# hand-pinned below (chiptune, 8-bit, NES, FM, the frequency).
#
# Each entry: (output_filename, ssml_body). gen_tts.py wraps each body in
# <speak> ... </speak> and posts it to the TTS API.

# Frequency spoken the radio way: "one hundred three point seven"
FREQ = "one hundred three point seven"
# "FM" spoken as letters (space forces "eff em")
FM = "F M"
# "chiptune" pinned to chip-TOON
CHIPTUNE = '<phoneme alphabet="ipa" ph="t&#643;a&#618;p.tu&#720;n">chiptune</phoneme>'

ANNOUNCEMENTS = [
    (
        "01_intro.mp3",
        f"""
        You are locked on <emphasis level="moderate">Chip {FM}</emphasis>,
        {FREQ},
        <break time="450ms"/>
        the home of {CHIPTUNE}
        and <say-as interpret-as="cardinal">eight</say-as>-bit sound.
        <break time="650ms"/>
        No samples. No sequencers.
        <break time="300ms"/>
        Just square waves, <break time="250ms"/> triangle waves,
        and a whole lot of heart.
        """
    ),
    (
        "02_midshow.mp3",
        f"""
        Welcome back to Chip {FM}.
        <break time="550ms"/>
        You are cruising the {CHIPTUNE} highway,
        where every track is built note by note,
        <break time="350ms"/>
        the way it was meant to be done
        <break time="250ms"/>
        on a sound chip with <say-as interpret-as="cardinal">four</say-as>
        voices and a prayer.
        """
    ),
    (
        "03_upnext.mp3",
        """
        Coming up next,
        <break time="450ms"/>
        straight from the sound chip.
        <break time="550ms"/>
        Keep your hands on the controller
        <break time="300ms"/>
        and your eyes on the pixels.
        """
    ),
    (
        "04_retro.mp3",
        f"""
        Here at Chip {FM}, we keep it retro.
        <break time="550ms"/>
        Think <say-as interpret-as="characters">NES</say-as>,
        <break time="300ms"/>
        <say-as interpret-as="characters">GB</say-as> —
        the Game Boy —
        <break time="300ms"/>
        and the glorious beep and buzz of the eighties.
        <break time="450ms"/>
        It is not nostalgia.
        <break time="350ms"/>
        It is a <emphasis level="strong">lifestyle</emphasis>.
        """
    ),
    (
        "05_outro.mp3",
        f"""
        That is a set from Chip {FM},
        <break time="450ms"/>
        {FREQ},
        <break time="550ms"/>
        where the music is <say-as interpret-as="cardinal">eight</say-as>-bit,
        <break time="350ms"/>
        and the vibes are always <say-as interpret-as="cardinal">sixteen</say-as>.
        <break time="650ms"/>
        Stay locked in,
        <break time="300ms"/>
        players one and two.
        """
    ),
]
