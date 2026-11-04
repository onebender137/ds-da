/* ============================================================================
   DSDA Proof-of-Creation — proof.js (SPA logic)
   Views: anchor (default), proof (?txid=...), FAQ (?view=faq)
   The backend API lives on bigboy (port 8796, served under /dsda/).
   ========================================================================== */

// API base URL. Cloudflare Tunnel (public, no Tailscale required).
// The backend sends CORS: *, so cross-origin works.
const API_BASE = 'https://api.ds-da.ca';
const NOTARY_ADDRESS = '14nn7V37RkgaYjieZQeafeYeyeWxgkJTsQ';

// --- helpers ---
// esc() escapes user-provided strings (title, creator) before innerHTML.
// txid + sha256 are hex-only (safe). So all innerHTML below is XSS-safe.
function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
async function api(path, opts) {
    const res = await fetch(API_BASE + path, opts);
    return res.json().then(j => ({ ok: res.ok, j }));
}
function apiPost(path, body) {
    return api(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
}

// --- view routing ---
function showView(name) {
    ['anchor', 'proof', 'faq'].forEach(v => {
        const el = document.getElementById('view-' + v);
        if (el) el.style.display = (v === name) ? 'block' : 'none';
    });
}

// --- wallet status (HUD) ---
function loadStatus() {
    api('/api/status').then(({ j: s }) => {
        const el = document.getElementById('walletStatus');
        if (!el) return;
        if (s.funded) {
            el.innerHTML = 'Notary: <span class="funded">Funded</span> · ' +
                s.balance_bsv.toFixed(6) + ' BSV';
        } else {
            el.innerHTML = 'Notary: <span style="color:#dc2626">Unfunded</span>';
        }
    }).catch(() => {
        const el = document.getElementById('walletStatus');
        if (el) el.textContent = 'Notary: offline';
    });
}

// ===================== ANCHOR VIEW =====================
function initAnchorView() {
    const state = { content_b64: null, name: null, size: null, tier: 'basic', expected_sat: 1 };

    // --- lookup a proof by txid ---
    const lookupBtn = document.getElementById('lookupBtn');
    const lookupTxid = document.getElementById('lookupTxid');
    function doLookup() {
        const txid = lookupTxid.value.trim();
        const err = document.getElementById('lookupErr');
        err.style.display = 'none';
        if (!/^[0-9a-f]{64}$/i.test(txid)) {
            err.textContent = 'That does not look like a valid txid (64 hex chars).';
            err.style.display = 'block';
            return;
        }
        location.href = '?txid=' + txid;
    }
    if (lookupBtn) lookupBtn.addEventListener('click', doLookup);
    if (lookupTxid) lookupTxid.addEventListener('keydown', e => { if (e.key === 'Enter') doLookup(); });

    // --- tier selection ---
    const tiersEl = document.querySelector('.tiers');
    if (tiersEl) tiersEl.addEventListener('click', e => {
        const t = e.target.closest('.tier');
        if (!t) return;
        document.querySelectorAll('.tier').forEach(x => x.classList.remove('sel'));
        t.classList.add('sel');
        state.tier = t.getAttribute('data-tier');
        updateCostEstimate();
    });

    // --- file drop / browse ---
    const drop = document.getElementById('drop');
    const fileInput = document.getElementById('file');
    if (drop) {
        drop.addEventListener('click', () => fileInput.click());
        ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
        ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
        drop.addEventListener('drop', e => { if (e.dataTransfer.files.length) readFile(e.dataTransfer.files[0]); });
    }
    if (fileInput) fileInput.addEventListener('change', () => { if (fileInput.files.length) readFile(fileInput.files[0]); });
    function readFile(f) {
        const reader = new FileReader();
        reader.onload = () => {
            state.content_b64 = reader.result.split(',')[1];
            state.name = f.name; state.size = f.size; state.filename = f.name;
            const fi = document.getElementById('fileinfo');
            fi.style.display = 'block';
            fi.textContent = '✓ ' + f.name + ' (' + f.size + ' bytes) — ready to anchor';
            document.getElementById('text').value = '';
            updateCostEstimate();
        };
        reader.readAsDataURL(f);
    }

    // --- live cost estimate + payment card ---
    function updateCostEstimate() {
        const el = document.getElementById('costEstimate');
        let size = state.size || 0;
        if (!size) size = document.getElementById('text').value.length;
        if (!size) { el.style.display = 'none'; return; }
        apiPost('/api/estimate', { size, tier: state.tier }).then(({ j: est }) => {
            const onCents = est.on_chain_sat * 0.00002;  // @ $20/BSV
            const onStr = onCents < 0.01 ? '<0.01¢' : onCents.toFixed(2) + '¢';
            document.getElementById('costVal').textContent = onStr + ' on-chain';
            document.getElementById('costDetail').textContent =
                '  (' + est.on_chain_sat.toFixed(0) + ' sats · ' + est.tier + ' · ' + (size / 1024).toFixed(1) + ' KB)';
            el.style.display = 'block';
            // update the payment card (amount + address + QR)
            state.expected_sat = Math.ceil(est.on_chain_sat);
            updatePaymentCard();
        }).catch(() => { el.style.display = 'none'; });
    }
    function updatePaymentCard() {
        const sat = state.expected_sat || 0;
        const bsv = (sat / 1e8).toFixed(8);
        document.getElementById('payAmount').textContent =
            sat + ' sats (' + bsv + ' BSV)';
        document.getElementById('payAddress').textContent = NOTARY_ADDRESS;
        // render the QR code (BIP21 URI)
        const bip21 = 'bsv:' + NOTARY_ADDRESS + '?amount=' + (sat / 1e8) + '&label=DSDA%20Proof%20of%20Creation';
        renderQR(bip21, document.getElementById('payQR'));
        document.getElementById('paymentCard').style.display = 'block';
        // Start the polling loop (auto-detect the payment + auto-anchor)
        startPaymentPolling();
    }
    let pollTimer = null;
    let blockWatcherTimer = null;
    let countdownTimer = null;
    let factsTimer = null;
    let countdownStart = null;
    const COUNTDOWN_SECS = 600; // ~10 min block time
    const BSV_FACTS = [
        "BSV blocks can hold up to 2 GB of data — 2000x larger than Bitcoin.",
        "The BSV blockchain has been running continuously since 2018. Zero downtime.",
        "A full MP3 song (~10 MB) costs less than a cent to store on BSV.",
        "BSV's unbounded blocks mean no more 'unconfirmed tx' anxiety for big data.",
        "The BSV network is secured by miners worldwide — no single point of failure.",
        "Your proof will outlive your hard drive, your phone, + probably your smartphone's successor.",
        "BSV data fees are ~0.1 sat/byte — a 1 MB file costs less than a satoshi.",
        "The blockchain is the ultimate notary: it never sleeps, never loses records, + never lies.",
    ];
    let factIndex = 0;

    function startCountdown() {
        if (countdownTimer) clearInterval(countdownTimer);
        countdownStart = Date.now();
        countdownTimer = setInterval(() => {
            const elapsed = Math.floor((Date.now() - countdownStart) / 1000);
            const remaining = Math.max(0, COUNTDOWN_SECS - elapsed);
            const min = Math.floor(remaining / 60);
            const sec = remaining % 60;
            const el = document.getElementById('blockCountdown');
            if (el) el.textContent = 'Next block in ~' + min + ':' + String(sec).padStart(2, '0');
            // Update progress bar
            const bar = document.getElementById('blockProgress');
            if (bar) bar.style.width = Math.min(100, (elapsed / COUNTDOWN_SECS) * 100) + '%';
            if (remaining <= 0) {
                clearInterval(countdownTimer);
                countdownTimer = null;
            }
        }, 1000);
    }
    function startFacts() {
        if (factsTimer) clearInterval(factsTimer);
        factIndex = Math.floor(Math.random() * BSV_FACTS.length);
        const el = document.getElementById('bsvFact');
        if (el) el.textContent = BSV_FACTS[factIndex];
        factsTimer = setInterval(() => {
            factIndex = (factIndex + 1) % BSV_FACTS.length;
            const e = document.getElementById('bsvFact');
            if (e) e.textContent = BSV_FACTS[factIndex];
        }, 15000);
    }
    function stopWaitingAnimations() {
        if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
        if (factsTimer) { clearInterval(factsTimer); factsTimer = null; }
    }

    function startPaymentPolling() {
        // Clear any existing poll timer
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
        if (blockWatcherTimer) { clearInterval(blockWatcherTimer); blockWatcherTimer = null; }
        const statusEl = document.getElementById('payStatus');
        if (statusEl) statusEl.textContent = '⏳ Waiting for payment… (auto-detects when you send)';
        const sat = state.expected_sat || 1;
        let waitingStarted = false;
        pollTimer = setInterval(async () => {
            try {
                // Check 1: auto-detect a new confirmed payment (UTXO scan)
                const { j: res } = await apiPost('/api/check-payment', { expected_sat: sat });
                if (res.paid) {
                    stopWaitingAnimations();
                    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
                    if (blockWatcherTimer) { clearInterval(blockWatcherTimer); blockWatcherTimer = null; }
                    if (statusEl) statusEl.innerHTML = '✅ Payment confirmed! Anchoring…';
                    const anchorBtn = document.getElementById('anchorBtn');
                    if (anchorBtn) anchorBtn.click();
                    return;
                }
                // Check 2: if the customer entered a txid, watch for confirmation
                const payTxid = document.getElementById('payTxid').value.trim();
                if (/^[0-9a-f]{64}$/i.test(payTxid)) {
                    const { j: txSt } = await apiPost('/api/tx-status', { txid: payTxid });
                    if (txSt.confirmed) {
                        stopWaitingAnimations();
                        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
                        if (blockWatcherTimer) { clearInterval(blockWatcherTimer); blockWatcherTimer = null; }
                        if (statusEl) statusEl.innerHTML = '✅ Payment confirmed! Anchoring…';
                        const anchorBtn = document.getElementById('anchorBtn');
                        if (anchorBtn) anchorBtn.click();
                    } else if (txSt.confirmations === 0 && txSt.amount_sat > 0) {
                        // Tx is in the mempool (unconfirmed) — show block watcher
                        if (!waitingStarted) {
                            waitingStarted = true;
                            startCountdown();
                            startFacts();
                            // Show the "while you wait" section
                            const waitSec = document.getElementById('waitingSection');
                            if (waitSec) waitSec.style.display = 'block';
                        }
                        if (statusEl) {
                            statusEl.innerHTML =
                                '🕐 Payment detected — waiting for block confirmation';
                        }
                    } else if (txSt.confirmations === 0 && txSt.amount_sat === 0) {
                        if (statusEl) {
                            statusEl.textContent =
                                '🕐 Tx found — waiting for it to pay the notary address…';
                        }
                    }
                }
            } catch (e) {
                // API offline — keep polling (don't spam the user)
            }
        }, 5000);  // poll every 5 seconds
    }
    function renderQR(data, el) {
        if (!el) return;
        el.innerHTML = '';
        // Use a lightweight QR code generator (no external dependency)
        // We'll use the qrcode.js library (loaded via CDN)
        if (typeof QRCode !== 'undefined') {
            new QRCode(el, { text: data, width: 180, height: 180, colorDark: '#0a1628', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
        } else {
            // Fallback: show the BIP21 URI as text (the user can copy it)
            el.innerHTML = '<div class="qr-fallback">' + data + '</div>';
        }
    }
    const textEl = document.getElementById('text');
    if (textEl) textEl.addEventListener('input', updateCostEstimate);

    // --- anchor (verify payment first, then anchor) ---
    const anchorBtn = document.getElementById('anchorBtn');
    if (anchorBtn) anchorBtn.addEventListener('click', () => {
        const err = document.getElementById('err');
        err.style.display = 'none';
        const text = document.getElementById('text').value;
        if (!state.content_b64 && !text) {
            err.textContent = 'Add a file or paste text first.'; err.style.display = 'block'; return;
        }
        const payload = state.content_b64 || btoa(unescape(encodeURIComponent(text)));
        const body = {
            content_b64: payload,
            title: document.getElementById('title').value || 'untitled',
            creator: document.getElementById('creator').value || 'anon',
            tier: state.tier,
            filename: state.filename || ''
        };
        anchorBtn.disabled = true; anchorBtn.textContent = 'VERIFYING PAYMENT…';
        // Step 1: verify the payment (no payment, no anchor)
        const payTxid = document.getElementById('payTxid').value.trim();
        if (!/^[0-9a-f]{64}$/i.test(payTxid)) {
            err.textContent = 'Paste your payment txid first (step 3).'; err.style.display = 'block';
            anchorBtn.disabled = false; anchorBtn.textContent = 'VERIFY PAYMENT + ANCHOR ON BSV'; return;
        }
        apiPost('/api/verify-payment', { payment_txid: payTxid, expected_sat: state.expected_sat || 1 })
            .then(({ j: pay }) => {
                if (!pay.paid) {
                    err.textContent = 'Payment not verified: ' + (pay.reason || 'unknown');
                    err.style.display = 'block'; anchorBtn.disabled = false;
                    anchorBtn.textContent = 'VERIFY PAYMENT + ANCHOR ON BSV'; return null;
                }
                // Step 2: anchor
                anchorBtn.textContent = 'ANCHORING…';
                return apiPost('/api/anchor', body);
            })
            .then(res => {
                if (!res) return;
                anchorBtn.disabled = false; anchorBtn.textContent = 'VERIFY PAYMENT + ANCHOR ON BSV';
                if (!res.ok) { err.textContent = res.j.error || 'anchor failed'; err.style.display = 'block'; return; }
                showResult(res.j);
            })
            .catch(e => { anchorBtn.disabled = false; anchorBtn.textContent = 'VERIFY PAYMENT + ANCHOR ON BSV';
                err.textContent = String(e); err.style.display = 'block'; });
    });

    function showResult(c) {
        const card = document.getElementById('resultCard');
        card.style.display = 'block';
        document.getElementById('resBadge').textContent = c.tier + ' · ' + (c.broadcast ? 'ON-CHAIN' : 'DRY-RUN');
        const rows = [
            ['TXID', '<a href="?txid=' + c.txid + '" target="_blank">' + c.txid + '</a>'],
            ['SHA-256', c.sha256],
            ['TIER', c.tier],
            ['TITLE', esc(c.title)],
            ['CREATOR', esc(c.creator)],
            ['TIMESTAMP', new Date(c.ts * 1000).toISOString()],
            ['DATA BYTES', c.data_bytes],
            ['EXPLORER', '<a href="' + c.verify_url + '" target="_blank">whatsonchain.com</a>']
        ];
        document.getElementById('resKv').innerHTML = rows.map(r =>
            '<div><span class="k">' + r[0] + '</span><span class="v">' + r[1] + '</span></div>'
        ).join('');
        document.getElementById('resNote').textContent = c.broadcast
            ? 'This proof is now immutable on the BSV blockchain. Anyone can verify it at the proof page.'
            : 'Dry-run (wallet not funded). The tx was built + signed but not broadcast.';
        card.scrollIntoView({ behavior: 'smooth' });
    }
    // Render the payment card + QR code on page load (so the user can see the
    // address + QR code immediately, even before the cost estimate is calculated)
    updatePaymentCard();
}

// ===================== PROOF VIEW =====================
function initProofView(txid) {
    document.getElementById('proofTxid').textContent = txid;
    let cert = null;
    let b64 = null;

    function renderCert(c) {
        const rows = [
            ['TXID', c.txid],
            ['SHA-256', c.sha256],
            ['TIER', c.tier],
            ['TITLE', esc(c.title)],
            ['CREATOR', esc(c.creator)],
            ['TIMESTAMP', new Date(c.ts * 1000).toISOString()],
            ['SOURCE', c.source || 'archive'],
            ['EXPLORER', '<a href="https://whatsonchain.com/tx/' + c.txid + '" target="_blank">whatsonchain.com/tx/' + c.txid + '</a>']
        ];
        document.getElementById('kv').innerHTML = rows.map(r =>
            '<div><span class="k">' + r[0] + '</span><span class="v">' + r[1] + '</span></div>'
        ).join('');
        // On-chain content for Premium-tier anchors (recovered from the chain)
        if (c.tier === 'premium') {
            document.getElementById('contentCard').style.display = 'block';
            const contentUrl = API_BASE + '/proof/' + c.txid + '/content';
            const display = document.getElementById('contentDisplay');
            const img = document.createElement('img');
            img.src = contentUrl;
            img.alt = 'On-chain content: ' + c.title;
            img.onerror = () => { display.innerHTML = '<a href="' + contentUrl + '" style="color:var(--cyan);font-weight:600">Download the on-chain file</a>'; };
            display.appendChild(img);
        }
    }

    // Load the cert (from the archive, or pull from the chain if not present)
    api('/api/lookup/' + txid).then(({ j: onchain }) => {
        if (onchain.txid) { cert = onchain; renderCert(cert); }
        else { document.getElementById('kv').innerHTML = '<span class="v">No on-chain data found for this txid.</span>'; }
    }).catch(() => {
        document.getElementById('kv').innerHTML = '<span class="v">Lookup failed — check the txid.</span>';
    });

    // --- share / email ---
    const proofUrl = location.href;
    const shareBtn = document.getElementById('shareBtn');
    const shareMenu = document.getElementById('shareMenu');
    const shareStatus = document.getElementById('shareStatus');
    if (shareBtn) shareBtn.addEventListener('click', () => {
        shareMenu.style.display = shareMenu.style.display === 'none' ? 'block' : 'none';
    });
    const shareEmail = document.getElementById('shareEmail');
    if (shareEmail) shareEmail.addEventListener('click', () => {
        const c = cert || { title: 'unknown', creator: 'anon', tier: 'unknown', ts: 0, sha256: '', txid };
        const subject = encodeURIComponent('DSDA Proof of Creation: ' + c.title);
        const body = encodeURIComponent(
            'Proof of Creation Certificate\n\n' +
            'Title: ' + c.title + '\n' +
            'Creator: ' + c.creator + '\n' +
            'Tier: ' + c.tier + '\n' +
            'Anchored: ' + new Date(c.ts * 1000).toLocaleString() + '\n' +
            'SHA-256: ' + c.sha256 + '\n' +
            'BSV Transaction: ' + c.txid + '\n\n' +
            'Verify this proof (no login, no trust in us):\n' + proofUrl + '\n\n' +
            '— DSDA Proof of Creation (ds-da.ca)');
        location.href = 'mailto:?subject=' + subject + '&body=' + body;
    });
    const shareCopy = document.getElementById('shareCopy');
    if (shareCopy) shareCopy.addEventListener('click', () => {
        navigator.clipboard.writeText(proofUrl).then(() => { shareStatus.textContent = '✓ Link copied to clipboard'; })
            .catch(() => { shareStatus.textContent = 'Link: ' + proofUrl; });
    });
    const shareSocial = document.getElementById('shareSocial');
    if (shareSocial) shareSocial.addEventListener('click', () => {
        const c = cert || { title: 'unknown' };
        const shareData = {
            title: 'DSDA Proof of Creation: ' + c.title,
            text: 'I anchored "' + c.title + '" on the BSV blockchain. Verify it: ',
            url: proofUrl
        };
        if (navigator.share) { navigator.share(shareData).then(() => { shareStatus.textContent = '✓ Shared'; }).catch(() => {}); }
        else {
            const tweetUrl = 'https://twitter.com/intent/tweet?text=' +
                encodeURIComponent('I anchored "' + c.title + '" on the BSV blockchain. Verify it: ' + proofUrl);
            window.open(tweetUrl, '_blank');
        }
    });

    // --- verify the content ---
    const drop = document.getElementById('dropVerify');
    const fileInput = document.getElementById('fileVerify');
    if (drop) {
        drop.addEventListener('click', () => fileInput.click());
        ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
        ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
        drop.addEventListener('drop', e => { if (e.dataTransfer.files.length) readFile(e.dataTransfer.files[0]); });
    }
    if (fileInput) fileInput.addEventListener('change', () => { if (fileInput.files.length) readFile(fileInput.files[0]); });
    function readFile(f) {
        const reader = new FileReader();
        reader.onload = () => { b64 = reader.result.split(',')[1];
            document.getElementById('verifyBtn').disabled = false;
            drop.innerHTML = '✓ ' + esc(f.name) + ' (' + f.size + ' bytes)'; };
        reader.readAsDataURL(f);
    }
    const verifyBtn = document.getElementById('verifyBtn');
    if (verifyBtn) verifyBtn.addEventListener('click', () => {
        if (!b64 || !cert) return;
        verifyBtn.disabled = true; verifyBtn.textContent = 'VERIFYING…';
        apiPost('/api/verify', { content_b64: b64, cert: cert }).then(({ j: res }) => {
            verifyBtn.disabled = false; verifyBtn.textContent = 'VERIFY';
            const v = document.getElementById('ver');
            v.style.display = 'block';
            const ok = res.verified;
            v.innerHTML = '<span class="badge-status ' + (ok ? 'ok' : 'no') + '">' +
                (ok ? '✅ VERIFIED' : '❌ MISMATCH') + '</span>' +
                '<div class="kv" style="margin-top:12px">' +
                '<div><span class="k">content hash matches certificate</span><span class="v">' + res.local_match + '</span></div>' +
                '<div><span class="k">anchor found on-chain</span><span class="v">' + res.on_chain_match + '</span></div>' +
                '</div>';
        }).catch(e => { verifyBtn.disabled = false; verifyBtn.textContent = 'VERIFY';
            const v = document.getElementById('ver'); v.style.display = 'block'; v.textContent = String(e); });
    });
}

// ===================== INIT =====================
function init() {
    const params = new URLSearchParams(location.search);
    const txid = params.get('txid');
    const view = params.get('view') || 'anchor';
    if (txid) { showView('proof'); initProofView(txid); }
    else if (view === 'faq') { showView('faq'); }
    else { showView('anchor'); initAnchorView(); }
    loadStatus();
}
document.addEventListener('DOMContentLoaded', init);
