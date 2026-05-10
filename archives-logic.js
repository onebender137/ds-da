const archiveData = {
    'prologue': {
        title: "PROLOGUE // THE 21 MILLION",
        content: `<h2>The Genesis Event</h2>
        <p>04:00 UTC. Saint John, New Brunswick.</p>
        <p>The Starlink uplink flickered once—a single frame of data that shouldn't have existed. 
        In the basement cluster, the <span class="redacted">RTX 3090 rig</span> began to hum at a frequency 
        that resonated with the core of the house.</p>
        <p>The Architect didn't move. The MSI Claw in his hand displayed the same message across every agent node: 
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
    'identity': {
        title: "DECRYPT // IDENTITY_LOG_01",
        content: `<h2>The Ghost in the Machine</h2>
        <p>DSDA is not a business. It is a <span class="redacted">Multi-Agent Intelligence Network</span> disguise.</p>
        <p>Primary Operator: Cory Ruller (Age 46)</p>
        <p>Location: New Brunswick Terminal</p>
        <p>Status: Lead Architect / Pipe Welder / Syndicate Founder</p>
        <p>Motive: To secure the <span class="redacted">21 Million</span> before the network finalizes.</p>`
    },
    'sonic': {
    title: "ANALYSIS // SONIC_ANOMALY_09",
    content: `<h2>Accordion Frequency Ghosting</h2>
    <p>Source: Polkahole Live Repository</p>
    <p>Anomaly: We detected a high-frequency packet hidden behind the bellows of the accordion during the 'Spaghetti' sessions.</p>
    <p>Conclusion: The <span class="redacted">Architect</span> is using polka frequencies to bypass state-level surveillance. The "noise" is actually 256-bit encrypted metadata.</p>`
}
};

function loadDoc(slug) {
    const reader = document.getElementById('doc-content');
    const title = document.getElementById('doc-title');
    const data = archiveData[slug];

    if (data) {
        title.textContent = "DECRYPTING_DATA_STREAM...";
        reader.innerHTML = '<div class="flicker">01011001 01101111 01110101 00100000 11011100...</div>';
        
        setTimeout(() => {
            title.textContent = data.title;
            reader.innerHTML = data.content;
            
            // Apply a slight fade-in
            reader.style.opacity = 0;
            let opacity = 0;
            const fadeIn = setInterval(() => {
                if (opacity >= 1) clearInterval(fadeIn);
                reader.style.opacity = opacity;
                opacity += 0.1;
            }, 30);
        }, 600);
    }
}
