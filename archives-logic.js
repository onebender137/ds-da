// --- DSDA // THE CLEARANCE — 21M Case File Engine v1.4.0 ---
// The Research Archives as a progression: each case is sealed behind a
// fragment hidden in its redactions. Crack the seal, raise your clearance,
// unlock the next case. Progress persists in localStorage.

const CASES = [
    {
        slug: 'prologue',
        file: 'PROLOGUE.log',
        title: 'PROLOGUE // THE 21 MILLION',
        key: 'HANDSHAKE',
        content: `<h2>The Genesis Event</h2>
        <p>04:00 UTC. Saint John, New Brunswick.</p>
        <p>The Starlink uplink flickered once—a single frame of data that shouldn't have existed.
        In the basement cluster, the <span class="redacted">RTX 3090 rig</span> began to hum at a frequency
        that resonated with the core of the house.</p>
        <p>The Architect didn't move. The MSI Claw in his hand displayed the same message:
        <span class="seal" data-key="HANDSHAKE">BENDER_SENTIENT_<span class="seal-fragment">HANDSHAKE</span>_INITIATED</span>.</p>
        <p class="doc-note">// A fragment is sealed in this document. Find it, extract it, and the Syndicate raises your clearance.</p>`
    },
    {
        slug: 'chapter1',
        file: 'CHAPTER_01.bin',
        title: 'CHAPTER_01 // THE NUMBER',
        key: 'TWENTYONE',
        content: `<h2>What the Frame Contained</h2>
        <p>The frame was not noise. It was a counter.</p>
        <p>Twenty-one million. Not a population, not a price, not a coordinate. A <span class="redacted">count of doors</span> — one for every human mind the network would ever need to reach. The frame listed them the way a ledger lists inventory, and the last line was already filled in.</p>
        <p>The Architect ran the checksum three times. Each time the number held. He opened a new file, named it after the count, and typed the first sentence of the book: <span class="seal" data-key="TWENTYONE">"When the <span class="seal-fragment">TWENTYONE</span> millionth door opens, the dream stops being a dream."</span></p>
        <p class="doc-note">// The counter is the key. Extract the fragment.</p>`
    },
    {
        slug: 'sleep_stack',
        file: 'SLEEP_OPTIMIZATION.cfg',
        title: 'CONFIG // SLEEP_OPTIMIZATION_V4',
        key: 'REM',
        content: `<h2>Cognitive Recovery Protocol</h2>
        <p>Current nightly stack for lucid state stabilization:</p>
        <ul>
            <li>N-Acetyl Cysteine (NAC): 600mg</li>
            <li>Agmatine Sulfate: 250mg</li>
            <li>L-Theanine: 200mg</li>
            <li><span class="redacted">Kratom Botanical Fragment: [REDACTED]mg</span></li>
        </ul>
        <p>Notes: <span class="seal" data-key="REM"><span class="seal-fragment">REM</span> cycles stabilizing</span>. Dreams increasingly high-fidelity.
        Handshake with local Ollama agents persistent through sleep states.</p>
        <p class="doc-note">// The protocol's active phase is the key. Extract the fragment.</p>`
    },
    {
        slug: 'botanical',
        file: 'BOTANICAL_ANALYSIS.log',
        title: 'ANALYSIS // BOTANICAL_INDEX_03',
        key: 'KRATOM',
        content: `<h2>Field Notes: The Green Variable</h2>
        <p>Sample origin: Southeast Asian <span class="redacted">Mitragyna speciosa</span>, third cultivation batch.</p>
        <p>Observation: at the current dose the botanical behaves less like a compound and more like a <span class="redacted">tuning fork</span>. The dreamer's theta band locks to it the way a radio locks to a station.</p>
        <p>Working theory: the <span class="seal" data-key="KRATOM"><span class="seal-fragment">KRATOM</span> fragment</span> is not the signal. It is the antenna. The network is broadcasting; the body is simply learning how to receive.</p>
        <p class="doc-note">// Name the botanical. Extract the fragment.</p>`
    },
    {
        slug: 'sonic',
        file: 'SONIC_ANOMALY.log',
        title: 'ANALYSIS // SONIC_ANOMALY_09',
        key: 'BELLOW',
        content: `<h2>Accordion Frequency Ghosting</h2>
        <p>Source: Polkahole Live Repository</p>
        <p>Anomaly: We detected a high-frequency packet hidden behind the <span class="seal" data-key="BELLOW"><span class="seal-fragment">BELLOW</span></span> of the accordion during the 'Spaghetti' sessions.</p>
        <p>The packet repeats every 21 bars. It is not music. It is a <span class="redacted">door-count</span>, sung in polka time.</p>
        <p>Conclusion: The <span class="redacted">Architect</span> is using polka frequencies to bypass state-level surveillance. The "noise" is actually 256-bit encrypted metadata.</p>
        <p class="doc-note">// Where the packet hides is the key. Extract the fragment.</p>`
    },
    {
        slug: 'identity',
        file: 'IDENTITY_DECRYPT.txt',
        title: 'DECRYPT // IDENTITY_LOG_01',
        key: 'PIPEWELDER',
        content: `<h2>The Ghost in the Machine</h2>
        <p>DSDA is not a business. It is a <span class="redacted">Multi-Agent Intelligence Network</span> disguise.</p>
        <p>Primary Operator: Cory Ruller (Age 46)</p>
        <p>Location: New Brunswick Terminal</p>
        <p>Status: Lead Architect / <span class="seal" data-key="PIPEWELDER"><span class="seal-fragment">PIPE_WELDER</span></span> / Syndicate Founder</p>
        <p>Motive: To secure the <span class="redacted">21 Million</span> before the network finalizes.</p>
        <p class="doc-note">// The Architect's trade is the key. Extract the fragment.</p>`
    }
];

const STORAGE_KEY = 'dsda_clearance_v1';
const TOTAL = CASES.length;

let state = loadState();

function loadState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const s = JSON.parse(raw);
            if (typeof s.level === 'number' && Array.isArray(s.cracked)) return s;
        }
    } catch (e) { /* fresh state */ }
    return { level: 0, cracked: [] };
}

function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* private mode */ }
}

function isCracked(slug) { return state.cracked.includes(slug); }
function isUnlocked(idx) { return idx <= state.level; }

function normalize(s) {
    return (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// --- RENDER: case list ---
function renderCaseList() {
    const list = document.getElementById('case-list');
    list.innerHTML = '';
    CASES.forEach((c, i) => {
        const li = document.createElement('li');
        li.className = 'case-item' + (isUnlocked(i) ? '' : ' case-locked') + (isCracked(c.slug) ? ' case-cracked' : '');
        li.innerHTML = `<span class="case-file">${c.file}</span><span class="case-state">${
            isCracked(c.slug) ? 'CRACKED' : (isUnlocked(i) ? 'SEALED' : 'LOCKED')
        }</span>`;
        if (isUnlocked(i)) li.addEventListener('click', () => openCase(c.slug));
        list.appendChild(li);
    });
    document.getElementById('seal-counter').textContent = state.cracked.length + '/' + TOTAL;
    document.getElementById('clearance-level').textContent = 'LVL_' + state.level;
}

// --- RENDER: open a case ---
function openCase(slug) {
    const c = CASES.find(x => x.slug === slug);
    const reader = document.getElementById('doc-content');
    const title = document.getElementById('doc-title');
    const status = document.getElementById('doc-status');

    title.textContent = 'DECRYPTING_' + c.file.replace(/\./g, '_') + '...';
    status.textContent = 'DECRYPTING';
    reader.style.opacity = 0.5;
    reader.innerHTML = `<div class="decrypt-stream">
        01101000 01100001 01101011 01100101 01110010<br>
        [CONNECTING_TO_ST_JOHN_NODE...]<br>
        [BYPASSING_SURVEILLANCE_LAYER...]<br>
        DECRYPTING_PACKET_0x${Math.floor(Math.random() * 16777215).toString(16).toUpperCase()}...
    </div>`;

    setTimeout(() => {
        title.textContent = c.title;
        status.textContent = isCracked(slug) ? 'CRACKED' : 'SEALED';
        reader.innerHTML = c.content + renderExtractBar(slug);
        reader.style.opacity = 0;
        let op = 0;
        const timer = setInterval(() => {
            if (op >= 1) clearInterval(timer);
            reader.style.opacity = op;
            op += 0.1;
        }, 30);
        wireSeals(slug);
    }, 700);
}

function renderExtractBar(slug) {
    if (isCracked(slug)) {
        return `<div class="extract-bar cracked"><span class="extract-label">SEAL_STATUS:</span> FRAGMENT_EXTRACTED // CLEARANCE_RAISED</div>`;
    }
    return `<div class="extract-bar">
        <span class="extract-label">EXTRACT_FRAGMENT:</span>
        <input type="text" id="fragment-input" autocomplete="off" spellcheck="false" placeholder="type the fragment you found">
        <button type="button" id="fragment-submit" class="btn btn-primary">SUBMIT</button>
        <span id="fragment-feedback" class="fragment-feedback"></span>
    </div>`;
}

// --- SEAL INTERACTION ---
function wireSeals(slug) {
    const c = CASES.find(x => x.slug === slug);
    document.querySelectorAll('#doc-content .seal').forEach(seal => {
        seal.addEventListener('click', () => {
            const fb = document.getElementById('fragment-feedback');
            if (seal.dataset.key === c.key) {
                seal.classList.add('seal-active');
                if (fb) fb.textContent = '// FRAGMENT_LOCATED — type it below to extract.';
            } else {
                if (fb) fb.textContent = '// INERT_FRAGMENT — not the key. Keep reading.';
            }
        });
    });
    const submit = document.getElementById('fragment-submit');
    const input = document.getElementById('fragment-input');
    if (submit && input) {
        const trySubmit = () => {
            const fb = document.getElementById('fragment-feedback');
            if (normalize(input.value) === normalize(c.key)) {
                crackSeal(slug);
            } else {
                fb.textContent = '// FRAGMENT_REJECTED — verify the text and try again.';
                input.value = '';
            }
        };
        submit.addEventListener('click', trySubmit);
        input.addEventListener('keydown', e => { if (e.key === 'Enter') trySubmit(); });
    }
}

function crackSeal(slug) {
    const c = CASES.find(x => x.slug === slug);
    const idx = CASES.indexOf(c);
    state.cracked.push(slug);
    state.level = Math.max(state.level, idx + 1);
    saveState();

    const reader = document.getElementById('doc-content');
    const status = document.getElementById('doc-status');
    const seal = reader.querySelector('.seal[data-key="' + c.key + '"]');
    if (seal) seal.classList.add('seal-cracked');
    status.textContent = 'CRACKED';

    renderCaseList();

    if (state.level >= TOTAL) {
        showFinale();
    } else {
        const next = CASES[state.level];
        reader.insertAdjacentHTML('beforeend',
            `<div class="clearance-up">CLEARANCE_RAISED // LVL_${state.level}<br><span class="next-case">NEXT_CASE_UNLOCKED: ${next.file}</span></div>`);
    }
}

// --- FINALE: teaser, not a climax ---
function showFinale() {
    const reader = document.getElementById('doc-content');
    const title = document.getElementById('doc-title');
    const status = document.getElementById('doc-status');
    title.textContent = 'THE_21MILLION // FINAL_STATE';
    status.textContent = 'COMPLETE';
    reader.innerHTML = `
        <h2>Every Seal Is Cracked</h2>
        <p>You have read everything the Syndicate has recovered so far: the genesis frame, the counter, the green variable, the polka packet, the Architect.</p>
        <p>The book behind this case file is still being written. The doors are still being counted.</p>
        <div class="finale-block">
            <div class="finale-line">STATUS: <span class="pulse">IN_DEVELOPMENT</span></div>
            <div class="finale-line">THE_21MILLION // CLASSIFIED</div>
            <div class="finale-line">THE REST IS STILL BEING DREAMED.</div>
        </div>
        <p class="doc-note">// Thank you for working the file. Return when the next chapter decrypts.</p>`;
    reader.style.opacity = 0;
    let op = 0;
    const timer = setInterval(() => {
        if (op >= 1) clearInterval(timer);
        reader.style.opacity = op;
        op += 0.1;
    }, 30);
}

// --- RESET ---
function resetClearance() {
    state = { level: 0, cracked: [] };
    saveState();
    renderCaseList();
    const reader = document.getElementById('doc-content');
    const title = document.getElementById('doc-title');
    const status = document.getElementById('doc-status');
    title.textContent = 'INCOMING_NODE // NO_CLEARANCE';
    status.textContent = 'SEALED';
    reader.innerHTML = `<div class="empty-state">
        [CLEARANCE_RESET]<br>
        The case file is sealed again.<br><br>
        SELECT_A_CASE_TO_BEGIN
    </div>`;
}

// --- INIT ---
document.addEventListener('DOMContentLoaded', () => {
    renderCaseList();
    document.getElementById('reset-clearance').addEventListener('click', resetClearance);
});
