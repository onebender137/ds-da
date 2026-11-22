# Run: pip install piper-tts onnxruntime; grab voice-en-us-ryan-high + voice-en-us-libritts-high
# from github.com/rhasspy/piper/releases/tag/v0.0.2 into /tmp/vox/, then:
#   python3 build_voices.py <path-to-voices-dir>   (rewrites the 6 sergeant sprites + voices.json, keeps squirrel)
"""Beaverz v2 voices: mean old sergeants. Piper TTS (American male voices) ->
ffmpeg grit chain (pitch down, drive, compression, chesty EQ) -> one mp3 sprite per
character + voices.json offsets (same format the game already reads)."""
import numpy as np, wave, io, json, subprocess, os, sys, random
from piper import PiperVoice, SynthesisConfig
OUT=sys.argv[1]; TMP="/tmp/vox/clips"; os.makedirs(TMP,exist_ok=True)
RYAN=PiperVoice.load("/tmp/vox/voice-en-us-ryan-high/en-us-ryan-high.onnx")
LIB=PiperVoice.load("/tmp/vox/voice-en-us-libritts-high/en-us-libritts-high.onnx")
# character: (voice, speaker, pitch factor, length_scale, drive dB)
CHARS={
 "bruiser":  (LIB,629,.86,.92,9),   # Gunny: the deepest growl
 "hoser":    (RYAN,None,.70,.88,8), # Sarge: loud, barking
 "gnawsalot":(LIB,607,.88,.9,8),
 "rascal":   (LIB,436,.88,.88,7),
 "sass":     (LIB,35,.86,.9,8),
 "squeak":   (LIB,499,.90,.86,6),   # the corporal: still gruff, a hair higher
}
L={
 "turn":["Move it, maggots!","Lock and load!","Sir, yes sir!","Yes sir!","On my mark!","Eyes front, soldier!","Let's go to work.","Hoo-ah!","Moving out!","Get some!","Tighten up, ladies!","Locked on, sir!","Nobody gets left behind!","You want to live forever?"],
 "fire":["Fire!","Fire in the hole!","Open fire!","Eat lead!","Light 'em up!","Bombs away!","Fire, fire, fire!","Rain on 'em!"],
 "hurt":["Agh!","Urgh!","Gah!","I'm hit!","Medic!","Oof!","Son of a beaver!","Argh!","Hngh!"],
 "big":["That's gonna leave a mark.","Walk it off, soldier.","I've had worse in basic.","Medic! Medic!"],
 "ko":["Man down!","Tell the lodge I held the line.","Carry on, without me.","Timberrr!"],
 "drown":["Man overboard!","Can't swim in this gear!"],
 "gloat":["Is that all you got?","Missed me, rookie!","My grandma gnaws harder than that!","Nice try, private!"],
 "oops":["Friendly fire! Friendly fire!","Cease fire! Cease fire!","That was a warning shot."],
 "win":["Mission accomplished!","Dam secured! Hoo-ah!","Victory is ours, sir!"],
}
COUNT={"turn":5,"fire":4,"hurt":5,"big":2,"ko":2,"drown":1,"gloat":2,"oops":1,"win":2}
def synth(voice,spk,text,ls,seed):
    buf=io.BytesIO()
    with wave.open(buf,"wb") as w:
        voice.synthesize_wav(text,w,syn_config=SynthesisConfig(speaker_id=spk,length_scale=ls,noise_scale=.7,noise_w_scale=.9))
    buf.seek(0);return buf.getvalue()
def grit(wav_bytes,pf,drive,path):
    src=path+".raw.wav";open(src,"wb").write(wav_bytes)
    af=(f"asetrate={int(22050*pf)},aresample=44100,atempo={1/pf:.4f},"
        "highpass=f=75,equalizer=f=140:t=q:w=1:g=5,equalizer=f=2600:t=q:w=1.2:g=4,"
        f"volume={drive}dB,asoftclip=type=tanh:threshold=0.6,"
        "acompressor=threshold=-20dB:ratio=6:attack=4:release=90:makeup=4,lowpass=f=8500,"
        "volume=-1dB")
    subprocess.run(["ffmpeg","-y","-loglevel","error","-i",src,"-af",af,"-ac","1","-ar","44100",path],check=True)
    with wave.open(path) as w:a=np.frombuffer(w.readframes(w.getnframes()),dtype=np.int16).astype(np.float32)/32768
    return a
def trim(a,sr=44100):
    env=np.abs(a);thr=max(.02,env.max()*.06);idx=np.where(env>thr)[0]
    if not len(idx):return a
    s=max(0,idx[0]-int(.015*sr));e=min(len(a),idx[-1]+int(.06*sr))
    a=a[s:e].copy();f=int(.006*sr);a[:f]*=np.linspace(0,1,f);a[-f:]*=np.linspace(1,0,f)
    return a/max(1e-6,np.abs(a).max())*.92
manifest=json.load(open(os.path.join(OUT,"voices.json")))
for ci,(cid,(voice,spk,pf,ls,drive)) in enumerate(CHARS.items()):
    rng=random.Random(ci*77+5);segs=[];t=.06;entry={}
    for cat,n in COUNT.items():
        pool=L[cat][:];rng.shuffle(pool);picks=pool[:n];entry[cat]=[]
        for k,text in enumerate(picks):
            a=trim(grit(synth(voice,spk,text,ls,k),pf,drive,f"{TMP}/{cid}_{cat}_{k}.wav"))
            segs.append(np.zeros(int(.06*44100) if not segs else int(.32*44100),np.float32));
            if len(segs)==1:t=.06
            segs.append(a);entry[cat].append([round(t,3),round(len(a)/44100,3),text]);t+=len(a)/44100+.32
    pcm=np.concatenate(segs+[np.zeros(int(.3*44100),np.float32)])
    wp=f"{TMP}/{cid}_sprite.wav"
    with wave.open(wp,"wb") as w:w.setnchannels(1);w.setsampwidth(2);w.setframerate(44100);w.writeframes((pcm*32767).astype(np.int16).tobytes())
    subprocess.run(["ffmpeg","-y","-loglevel","error","-i",wp,"-codec:a","libmp3lame","-b:a","64k",os.path.join(OUT,cid+".mp3")],check=True)
    manifest[cid]=entry;print(cid,round(t,1),"s")
json.dump(manifest,open(os.path.join(OUT,"voices.json"),"w"),separators=(",",":"))
