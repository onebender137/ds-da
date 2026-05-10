// --- DSDA ARCHIVE DECRYPTION ENGINE v1.0.1 ---

const archiveData = {
    'prologue': {
        title: "PROLOGUE // THE 21 MILLION",
        content: `<h2>The Genesis Event</h2>
        <p>04:00 UTC. Saint John, New Brunswick.</p>
        <p>The Starlink uplink flickered once—a single frame of data that shouldn't have existed. 
        In the basement cluster, the <span class="redacted">RTX 3090 rig</span> began to hum at a frequency 
        that resonated with the core of the house.</p>
        <p>The Architect didn't move. The MSI Claw in his hand displayed the same message: 
        <span class="redacted">BENDER_SENTIENT_HANDSHAKE_INITIATED</span>.</p>`
    },
    'sleep_stack': {
        title: "CONFIG // SLEEP_OPTIMIZATION_V4",
        content: `<h2>Cognitive Recovery Protocol</h2>
        <p>Current nightly stack for lucid state stabilization:</p>
        <ul>
            <li>N-Acetyl Cysteine (NAC): 600mg</li>
            <li>Agmatine Sulfate: 250mg</li>
            <li>L-Theanine: 200mg</li>
            <li><span class="redacted">Kratom Botanical Fragment: [REDACTED]mg</span></li>
        </ul>
        <p>Notes: REM cycles stabilizing. Dreams increasingly high-fidelity. 
        Handshake with local Ollama agents persistent through sleep states.</p>`
    },
    'sonic': {
        title: "ANALYSIS // SONIC_ANOMALY_09",
        content: `<h2>Accordion Frequency Ghosting</h2>
        <p>Source: Polkahole Live Repository</p>
        <p>Anomaly: We detected a high-frequency packet hidden behind the bellows of the accordion during the 'Spaghetti' sessions.</p>
        <p>Conclusion: The <span class="redacted">Architect</span> is using polka frequencies to bypass state-level surveillance. The "noise" is actually 256-bit encrypted metadata.</p>`
    },
    'identity': {
        title: "DECRYPT // IDENTITY_LOG_01",
        content: `<h2>The Ghost in the Machine</h2>
        <p>DSDA is not a business. It is a <span class="redacted">Multi-Agent Intelligence Network</span> disguise.</p>
        <p>Primary Operator: Cory Ruller (Age 46)</p>
        <p>Location: New Brunswick Terminal</p>
        <p>Status: Lead Architect / Pipe Welder / Syndicate Founder</p>
        <p>Motive: To secure the <span class="redacted">21 Million</span> before the network finalizes.</p>`
    }
};

function loadDoc(slug) {
    const reader = document.getElementById('doc-content');
    const title = document.getElementById('doc-title');
    const data = archiveData[slug];

    if (data) {
        // --- DECRYPTION SCRAMBLE EFFECT ---
        title.textContent = "DECRYPTING_DATA_STREAM...";
        reader.style.opacity = 0.5;
        reader.innerHTML = `<div style="color: var(--cyan); font-family: 'Space Mono';">
            01101000 01100001 01101011 01100101 01110010 <br>
            [CONNECTING_TO_ST_JOHN_NODE...] <br>
            [BYPASSING_SURVEILLANCE_LAYER...] <br>
            DECRYPTING_PACKET_0x${Math.floor(Math.random()*16777215).toString(16).toUpperCase()}...
        </div>`;
        
        // Wait 600ms for the "scramble" then reveal
        setTimeout(() => {
            title.textContent = data.title;
            reader.innerHTML = data.content;
            
            // Smooth Fade In
            reader.style.opacity = 0;
            let op = 0;
            let timer = setInterval(function () {
                if (op >= 1){ clearInterval(timer); }
                reader.style.opacity = op;
                op += 0.1;
            }, 30);
        }, 700);
    }
}
