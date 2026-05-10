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
    }
};

function loadDoc(slug) {
    const reader = document.getElementById('doc-content');
    const title = document.getElementById('doc-title');
    const data = archiveData[slug];

    if (data) {
        // Add a "flicker" effect when loading
        reader.style.opacity = 0;
        setTimeout(() => {
            title.textContent = data.title;
            reader.innerHTML = data.content;
            reader.style.opacity = 1;
        }, 200);
    }
}
