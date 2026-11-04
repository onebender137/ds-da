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
    // Default to including credentials (cookies) for authenticated requests
    if (!opts) opts = {};
    if (!opts.credentials) opts.credentials = 'include';
    const res = await fetch(API_BASE + path, opts);
    return res.json().then(j => ({ ok: res.ok, j }));
}
function apiPost(path, body, opts) {
    if (!opts) opts = {};
    return api(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'include',
        ...opts
    });
}

// --- view routing ---
function showView(name) {
    ['anchor', 'proof', 'faq', 'dashboard'].forEach(v => {
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
    // State: array of files (batch anchoring)
    const state = { files: [], tier: 'basic', expected_sat: 1 };

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

    // --- file drop / browse (multiple files) ---
    const drop = document.getElementById('drop');
    const fileInput = document.getElementById('file');
    if (drop) {
        drop.addEventListener('click', () => fileInput.click());
        ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
        ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
        drop.addEventListener('drop', e => {
            if (e.dataTransfer.files.length) {
                Array.from(e.dataTransfer.files).forEach(f => addFile(f));
            }
        });
    }
    if (fileInput) {
        fileInput.setAttribute('multiple', 'true');
        fileInput.addEventListener('change', () => {
            if (fileInput.files.length) {
                Array.from(fileInput.files).forEach(f => addFile(f));
                fileInput.value = ''; // reset so the same file can be re-added
            }
        });
    }

    function addFile(f) {
        const reader = new FileReader();
        reader.onload = () => {
            state.files.push({
                name: f.name,
                size: f.size,
                content_b64: reader.result.split(',')[1]
            });
            renderFileList();
            updateCostEstimate();
        };
        reader.readAsDataURL(f);
    }

    function removeFile(index) {
        state.files.splice(index, 1);
        renderFileList();
        updateCostEstimate();
    }

    function renderFileList() {
        const el = document.getElementById('fileinfo');
        if (!el) return;
        if (state.files.length === 0) {
            el.style.display = 'none';
            return;
        }
        el.style.display = 'block';
        let html = '<div class="file-list">';
        state.files.forEach((f, i) => {
            const sizeStr = f.size < 1024 ? f.size + ' B'
                : f.size < 1048576 ? (f.size / 1024).toFixed(1) + ' KB'
                : (f.size / 1048576).toFixed(2) + ' MB';
            html += '<div class="file-item">' +
                '<span class="file-name">' + esc(f.name) + ' <span class="file-size">(' + sizeStr + ')</span></span>' +
                '<button class="file-remove" data-index="' + i + '" title="Remove">&times;</button>' +
                '</div>';
        });
        const totalBytes = state.files.reduce((sum, f) => sum + f.size, 0);
        const totalStr = totalBytes < 1024 ? totalBytes + ' B'
            : totalBytes < 1048576 ? (totalBytes / 1024).toFixed(1) + ' KB'
            : (totalBytes / 1048576).toFixed(2) + ' MB';
        html += '<div class="file-total">' + state.files.length + ' file' + (state.files.length > 1 ? 's' : '') + ' · ' + totalStr + ' total</div>';
        html += '</div>';
        el.innerHTML = html;
        // Wire up the remove buttons
        el.querySelectorAll('.file-remove').forEach(btn => {
            btn.addEventListener('click', () => removeFile(parseInt(btn.getAttribute('data-index'))));
        });
    }

    // --- live cost estimate + payment card ---
    function updateCostEstimate() {
        const el = document.getElementById('costEstimate');
        const totalBytes = state.files.reduce((sum, f) => sum + f.size, 0);
        let size = totalBytes || 0;
        if (!size) size = document.getElementById('text').value.length;
        if (!size) { el.style.display = 'none'; return; }
        apiPost('/api/estimate', { size, tier: state.tier }).then(({ j: est }) => {
            const custCents = est.customer_sat * 0.00002;  // @ $20/BSV
            const custStr = custCents < 0.01 ? '<0.01¢' : custCents.toFixed(2) + '¢';
            document.getElementById('costVal').textContent = custStr + ' total';
            document.getElementById('costDetail').textContent =
                '  (' + est.customer_sat.toFixed(0) + ' sats · ' + est.tier + ' · ' + (size / 1024).toFixed(1) + ' KB · includes 3% service fee)';
            el.style.display = 'block';
            // update the payment card (amount + address + QR)
            state.expected_sat = Math.ceil(est.customer_sat);
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
        if (statusEl) statusEl.textContent = '⏳ Waiting for payment… paste your txid below to confirm';
        const sat = state.expected_sat || 1;
        let waitingStarted = false;
        pollTimer = setInterval(async () => {
            try {
                // If the customer entered a txid, watch for confirmation (secure, per-txid)
                const payTxid = document.getElementById('payTxid').value.trim();
                if (/^[0-9a-f]{64}$/i.test(payTxid)) {
                    const { j: txSt } = await apiPost('/api/tx-status', { txid: payTxid });
                    if (txSt.confirmed && txSt.amount_sat >= sat) {
                        // Tx is confirmed + pays enough! Stop + anchor
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
                    return;
                }
                // No txid entered — don't auto-detect (avoids cross-user collisions)
                // Just show a gentle reminder
                if (statusEl && statusEl.textContent.indexOf('Waiting') === 0) {
                    statusEl.textContent = '⏳ Waiting for payment… paste your txid below to confirm';
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

    // --- anchor (verify payment first, then anchor all files) ---
    const anchorBtn = document.getElementById('anchorBtn');
    if (anchorBtn) anchorBtn.addEventListener('click', () => {
        const err = document.getElementById('err');
        err.style.display = 'none';
        const text = document.getElementById('text').value;
        if (state.files.length === 0 && !text) {
            err.textContent = 'Add a file or paste text first.'; err.style.display = 'block'; return;
        }
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
                // Step 2: anchor all files (in sequence)
                const filesToAnchor = state.files.length > 0
                    ? state.files.map(f => ({
                        content_b64: f.content_b64,
                        title: f.name,
                        creator: document.getElementById('creator').value || 'anon',
                        tier: state.tier,
                        filename: f.name
                    }))
                    : [{
                        content_b64: btoa(unescape(encodeURIComponent(text))),
                        title: document.getElementById('title').value || 'untitled',
                        creator: document.getElementById('creator').value || 'anon',
                        tier: state.tier,
                        filename: ''
                    }];
                return anchorBatch(filesToAnchor, anchorBtn, err);
            })
            .catch(e => { anchorBtn.disabled = false; anchorBtn.textContent = 'VERIFY PAYMENT + ANCHOR ON BSV';
                err.textContent = String(e); err.style.display = 'block'; });
    });

    // Anchor files one at a time (in sequence)
    function anchorBatch(files, anchorBtn, errEl) {
        const results = [];
        let i = 0;
        function next() {
            if (i >= files.length) {
                // All done — show the results
                anchorBtn.disabled = false;
                anchorBtn.textContent = 'VERIFY PAYMENT + ANCHOR ON BSV';
                showBatchResults(results);
                return;
            }
            anchorBtn.textContent = 'ANCHORING ' + (i + 1) + '/' + files.length + '…';
            const body = files[i];
            apiPost('/api/anchor', body).then(({ ok, j }) => {
                if (!ok) {
                    // This file failed — log it + move on
                    results.push({ title: body.title, error: j.error || 'anchor failed' });
                } else {
                    results.push(j);
                }
                i++;
                next();
            }).catch(e => {
                results.push({ title: body.title, error: String(e) });
                i++;
                next();
            });
        }
        next();
    }

    // Show the batch results
    function showBatchResults(results) {
        const card = document.getElementById('resultCard');
        card.style.display = 'block';
        const successes = results.filter(r => r.txid);
        const failures = results.filter(r => r.error);
        let badge = successes.length + ' anchored';
        if (failures.length > 0) badge += ' · ' + failures.length + ' failed';
        document.getElementById('resBadge').textContent = badge;
        let rows = [];
        successes.forEach(r => {
            rows.push(['TXID: ' + r.title, '<a href="?txid=' + r.txid + '" target="_blank">' + r.txid.substring(0, 24) + '…</a>']);
            rows.push(['SHA-256', r.sha256]);
            rows.push(['TIMESTAMP', new Date(r.ts * 1000).toISOString()]);
            rows.push(['DATA BYTES', r.data_bytes]);
            rows.push(['', '<a href="' + r.verify_url + '" target="_blank">Verify on-chain</a>']);
        });
        failures.forEach(r => {
            rows.push(['FAILED: ' + r.title, r.error]);
        });
        document.getElementById('resKv').innerHTML = rows.map(r =>
            '<div><span class="k">' + r[0] + '</span><span class="v">' + r[1] + '</span></div>'
        ).join('');
        document.getElementById('resNote').textContent =
            'This proof is now immutable on the BSV blockchain. Anyone can verify it at the proof page.';
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
        // Render the proof QR code (scan → opens this proof page)
        const proofUrl = location.origin + location.pathname + '?txid=' + txid;
        const qrEl = document.getElementById('proofQR');
        if (qrEl && typeof QRCode !== 'undefined') {
            new QRCode(qrEl, {
                text: proofUrl,
                width: 160,
                height: 160,
                colorDark: '#0a1628',
                colorLight: '#ffffff',
                correctLevel: QRCode.CorrectLevel.M
            });
        }
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
    const sharePdf = document.getElementById('sharePdf');
    if (sharePdf) sharePdf.addEventListener('click', () => {
        const c = cert || { title: 'unknown', creator: 'anon', tier: 'unknown', ts: 0, sha256: '', txid };
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ unit: 'pt', format: 'letter' });
        const W = doc.internal.pageSize.getWidth();
        const M = 60; // margin
        let y = 80;
        // Header
        doc.setFontSize(24);
        doc.setFont('helvetica', 'bold');
        doc.text('DSDA', W / 2, y, { align: 'center' });
        y += 30;
        doc.setFontSize(14);
        doc.setFont('helvetica', 'normal');
        doc.text('Proof of Creation Certificate', W / 2, y, { align: 'center' });
        y += 10;
        doc.setDrawColor(201, 162, 39);
        doc.setLineWidth(2);
        doc.line(M, y, W - M, y);
        y += 30;
        // Certificate details
        const fields = [
            ['Title', c.title],
            ['Creator', c.creator],
            ['Tier', c.tier],
            ['Anchored', new Date(c.ts * 1000).toLocaleString()],
            ['SHA-256', c.sha256],
            ['BSV Transaction', c.txid],
            ['Verify', proofUrl]
        ];
        fields.forEach(([label, value]) => {
            doc.setFontSize(10);
            doc.setFont('helvetica', 'bold');
            doc.text(label.toUpperCase(), M, y);
            doc.setFont('helvetica', 'normal');
            doc.text(String(value), M + 120, y);
            y += 20;
        });
        y += 10;
        // QR code (if available)
        const qrEl = document.getElementById('proofQR');
        if (qrEl && qrEl.querySelector('img')) {
            const qrImg = qrEl.querySelector('img');
            const qrData = qrImg.src;
            const qrSize = 120;
            doc.addImage(qrData, 'PNG', W / 2 - qrSize / 2, y, qrSize, qrSize);
            y += qrSize + 20;
            doc.setFontSize(9);
            doc.text('Scan to verify this proof', W / 2, y, { align: 'center' });
        }
        // Footer
        y = 720;
        doc.setFontSize(9);
        doc.text('This certificate is anchored on the BSV blockchain.', W / 2, y, { align: 'center' });
        y += 14;
        doc.text('Verify at: ' + proofUrl, W / 2, y, { align: 'center' });
        y += 14;
        doc.text('© 2026 Dream Syndicate Digital Assets', W / 2, y, { align: 'center' });
        // Save the PDF
        doc.save('dsda-proof-' + c.txid.substring(0, 8) + '.pdf');
        shareStatus.textContent = '✓ PDF downloaded';
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

// ===================== LOGIN + DASHBOARD =====================
function initLogin() {
    const loginBtn = document.getElementById('loginBtn');
    const loginModal = document.getElementById('loginModal');
    const loginModalClose = document.getElementById('loginModalClose');
    const loginSubmit = document.getElementById('loginSubmit');
    const logoutBtn = document.getElementById('logoutBtn');

    // Check if the user is already logged in
    api('/api/me', { credentials: 'include' }).then(({ j }) => {
        if (j.logged_in && j.user) {
            // Hide the login button, show the dashboard link
            if (loginBtn) loginBtn.style.display = 'none';
            const navDash = document.getElementById('navDashboard');
            if (navDash) navDash.style.display = 'inline';
            // Pre-fill the address
            const addrInput = document.getElementById('loginAddress');
            if (addrInput) addrInput.value = j.user.address;
        } else {
            // Show the login button, hide the dashboard link
            if (loginBtn) loginBtn.style.display = 'inline-block';
            const navDash = document.getElementById('navDashboard');
            if (navDash) navDash.style.display = 'none';
        }
    }).catch(() => {});

    // Open the login modal
    if (loginBtn) loginBtn.addEventListener('click', () => {
        if (loginModal) loginModal.style.display = 'flex';
    });
    // Close the login modal
    if (loginModalClose) loginModalClose.addEventListener('click', () => {
        if (loginModal) loginModal.style.display = 'none';
    });
    if (loginModal) loginModal.addEventListener('click', (e) => {
        if (e.target === loginModal) loginModal.style.display = 'none';
    });

    // Submit the login
    if (loginSubmit) loginSubmit.addEventListener('click', async () => {
        const status = document.getElementById('loginStatus');
        const name = document.getElementById('loginName').value.trim();
        const address = document.getElementById('loginAddress').value.trim();
        const wif = document.getElementById('loginWif').value.trim();
        loginSubmit.disabled = true;
        loginSubmit.textContent = 'Signing…';

        try {
            // Get a nonce from the server
            const { j: nonceRes } = await api('/api/login-nonce');
            const nonce = nonceRes.nonce;

            let sigAddress, signature;

            // Method 1: Wallet extension (preferred — no WIF needed)
            if (window.bsv && typeof window.bsv.sign === 'function') {
                try {
                    status.textContent = '🔐 Approve the signature request in your wallet…';
                    const result = await window.bsv.sign(nonce);
                    // result: { address, signature } (signature is base64)
                    sigAddress = result.address;
                    signature = result.signature;
                } catch (walletErr) {
                    // User rejected the signature request
                    status.textContent = '❌ Signature request rejected in wallet.';
                    loginSubmit.disabled = false;
                    loginSubmit.textContent = 'Sign + Login';
                    return;
                }
            }
            // Method 2: WIF (fallback — no wallet extension)
            else if (wif) {
                const key = new BSV.PrivateKey(wif);
                sigAddress = key.address();
                const sigResult = key.sign_text(nonce);
                signature = sigResult[1]; // base64 signature
            }
            // Method 3: Address only (not enough — need a signature)
            else if (address) {
                status.textContent = 'No wallet extension detected. Paste your WIF below to sign.';
                loginSubmit.disabled = false;
                loginSubmit.textContent = 'Sign + Login';
                return;
            }
            else {
                status.textContent = 'Install a BSV wallet extension (Unstoppable/Green) or paste your WIF.';
                loginSubmit.disabled = false;
                loginSubmit.textContent = 'Sign + Login';
                return;
            }

            // Send the signature to the server
            const { ok, j } = await apiPost('/api/login', {
                nonce, address: sigAddress, signature, display_name: name
            });

            if (ok && j.ok) {
                status.textContent = '✅ Logged in as ' + (j.user.display_name || j.user.address);
                setTimeout(() => {
                    if (loginModal) loginModal.style.display = 'none';
                    if (loginBtn) loginBtn.style.display = 'none';
                    const navDash = document.getElementById('navDashboard');
                    if (navDash) navDash.style.display = 'inline';
                    location.href = '?view=dashboard';
                }, 1000);
            } else {
                status.textContent = '❌ ' + (j.error || 'Login failed');
            }
        } catch (e) {
            status.textContent = '❌ ' + String(e);
        }
        loginSubmit.disabled = false;
        loginSubmit.textContent = 'Sign + Login';
    });

    // Logout
    if (logoutBtn) logoutBtn.addEventListener('click', async () => {
        await apiPost('/api/logout', {}, { credentials: 'include' });
        location.href = '?view=anchor';
    });
}

function initDashboard() {
    // Load the user's data
    api('/api/me', { credentials: 'include' }).then(({ j }) => {
        if (!j.logged_in || !j.user) {
            // Not logged in — redirect to anchor
            location.href = '?view=anchor';
            return;
        }
        const user = j.user;
        // Welcome message
        const welcome = document.getElementById('dashWelcome');
        if (welcome) welcome.textContent = 'Welcome, ' + (user.display_name || user.address) + '!';
        // Stats
        document.getElementById('statProofs').textContent = user.total_proofs || 0;
        document.getElementById('statSpent').textContent = (user.total_spent_sat || 0).toLocaleString();
        document.getElementById('statSince').textContent = new Date(user.created_at * 1000).toLocaleDateString();
        // Account info
        const acct = document.getElementById('dashAccount');
        if (acct) {
            acct.innerHTML =
                '<div><span class="k">ADDRESS</span><span class="v">' + user.address + '</span></div>' +
                '<div><span class="k">NAME</span><span class="v">' + esc(user.display_name || '—') + '</span></div>' +
                '<div><span class="k">MEMBER SINCE</span><span class="v">' + new Date(user.created_at * 1000).toLocaleDateString() + '</span></div>' +
                '<div><span class="k">LAST LOGIN</span><span class="v">' + new Date(user.last_login * 1000).toLocaleString() + '</span></div>';
        }
        // Load proofs (with tags + rename)
        api('/api/my-proofs', { credentials: 'include' }).then(({ j }) => {
            const el = document.getElementById('dashProofs');
            if (!el) return;
            if (!j.proofs || j.proofs.length === 0) {
                el.innerHTML = '<p class="muted">No proofs yet. Anchor something to get started!</p>';
                return;
            }
            el.innerHTML = j.proofs.map(p => {
                const tags = p.tags ? (typeof p.tags === 'string' ? JSON.parse(p.tags) : p.tags) : [];
                const tagHtml = tags.map(t => '<span class="dash-tag">' + esc(t) + '</span>').join('');
                return '<div class="dash-item" data-txid="' + p.txid + '">' +
                    '<div class="dash-item-row">' +
                    '<a href="?txid=' + p.txid + '" class="dash-item-title">' + esc(p.title || 'untitled') + '</a>' +
                    '<button class="dash-rename-btn" title="Rename">✏️</button>' +
                    '</div>' +
                    '<span class="dash-item-meta">' + p.tier + ' · ' + (p.size_bytes || 0).toLocaleString() + ' bytes · ' +
                    new Date(p.created_at * 1000).toLocaleDateString() + '</span>' +
                    '<div class="dash-tags">' + tagHtml + '<button class="dash-add-tag-btn" title="Add tag">+ tag</button></div>' +
                    '<input type="text" class="dash-tag-input" placeholder="Add a tag…" style="display:none">' +
                    '</div>';
            }).join('');
            // Wire up the rename + tag buttons
            el.querySelectorAll('.dash-rename-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const item = btn.closest('.dash-item');
                    const txid = item.getAttribute('data-txid');
                    const titleEl = item.querySelector('.dash-item-title');
                    const currentTitle = titleEl.textContent;
                    const newTitle = prompt('Rename this proof:', currentTitle);
                    if (newTitle && newTitle.trim() && newTitle !== currentTitle) {
                        apiPost('/api/rename-proof', { txid, title: newTitle.trim() }, { credentials: 'include' })
                            .then(({ j }) => {
                                if (j.ok) titleEl.textContent = newTitle.trim();
                            });
                    }
                });
            });
            el.querySelectorAll('.dash-add-tag-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const item = btn.closest('.dash-item');
                    const input = item.querySelector('.dash-tag-input');
                    input.style.display = 'block';
                    input.focus();
                    input.onkeydown = (e) => {
                        if (e.key === 'Enter' && input.value.trim()) {
                            const txid = item.getAttribute('data-txid');
                            const tagsEl = item.querySelector('.dash-tags');
                            const existing = Array.from(tagsEl.querySelectorAll('.dash-tag')).map(t => t.textContent);
                            const newTag = input.value.trim();
                            if (!existing.includes(newTag)) {
                                const tagSpan = document.createElement('span');
                                tagSpan.className = 'dash-tag';
                                tagSpan.textContent = newTag;
                                tagsEl.insertBefore(tagSpan, btn);
                                apiPost('/api/tag-proof', { txid, tags: [...existing, newTag] }, { credentials: 'include' });
                            }
                            input.value = '';
                            input.style.display = 'none';
                        }
                        if (e.key === 'Escape') {
                            input.style.display = 'none';
                        }
                    };
                });
            });
        }).catch(() => {});
        // Load payments
        api('/api/my-payments', { credentials: 'include' }).then(({ j }) => {
            const el = document.getElementById('dashPayments');
            if (!el) return;
            if (!j.payments || j.payments.length === 0) {
                el.innerHTML = '<p class="muted">No payments yet.</p>';
                return;
            }
            el.innerHTML = j.payments.map(p =>
                '<div class="dash-item">' +
                '<span class="dash-item-title">' + p.amount_sat.toLocaleString() + ' sats</span>' +
                '<span class="dash-item-meta">' +
                '<a href="https://whatsonchain.com/tx/' + p.txid + '" target="_blank">' + p.txid.substring(0, 16) + '…</a> · ' +
                new Date(p.created_at * 1000).toLocaleDateString() + '</span>' +
                '</div>'
            ).join('');
        }).catch(() => {});
    }).catch(() => {
        location.href = '?view=anchor';
    });
}

// ===================== INIT =====================
function init() {
    const params = new URLSearchParams(location.search);
    const txid = params.get('txid');
    const view = params.get('view') || 'anchor';
    if (txid) { showView('proof'); initProofView(txid); }
    else if (view === 'faq') { showView('faq'); }
    else if (view === 'dashboard') { showView('dashboard'); initDashboard(); }
    else { showView('anchor'); initAnchorView(); }
    loadStatus();
    initLogin();
}
document.addEventListener('DOMContentLoaded', init);
