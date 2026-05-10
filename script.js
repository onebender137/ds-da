document.addEventListener('DOMContentLoaded', () => {
    
    // --- 1. Typewriter Subtitle ---
    const subtitle = document.querySelector('.subtitle');
    if (subtitle) {
        const text = subtitle.textContent;
        subtitle.textContent = '';
        let i = 0;
        function typeWriter() {
            if (i < text.length) {
                subtitle.textContent += text.charAt(i);
                i++;
                setTimeout(typeWriter, 40); 
            }
        }
        setTimeout(typeWriter, 1000);
    }

    // --- 2. GPU Temperature Monitor (Moved Out of the Subtitle Block) ---
    setInterval(() => {
        const temp = document.getElementById('gpu-temp');
        if (temp) {
            // Simulates a GPU flux between 62 and 68 degrees
            temp.textContent = Math.floor(Math.random() * (68 - 62 + 1)) + 62;
        }
    }, 3000);

    // --- 3. HUD Clock ---
    const clockElement = document.getElementById('clock');
    if (clockElement) {
        function updateClock() {
            const now = new Date();
            clockElement.textContent = now.toISOString().split('T')[1].split('.')[0] + " UTC";
        }
        setInterval(updateClock, 1000);
        updateClock();
    }

    // --- 4. Telemetry Feed Logic ---
    const telemetry = document.getElementById('telemetry-feed');
    if (telemetry) {
        function addTelemetry() {
            const hex = Math.floor(Math.random() * 0xFFFFFF).toString(16).toUpperCase();
            const statuses = ["SYNCED", "OK", "PENDING", "ACTIVE", "ENCRYPTING", "NODE_LOCKED"];
            const status = statuses[Math.floor(Math.random() * statuses.length)];
            const line = `0x${hex}... ${status}<br>`;
            
            const currentLines = telemetry.innerHTML.split('<br>').filter(l => l.trim() !== "");
            const newLines = [line, ...currentLines.slice(0, 5)];
            telemetry.innerHTML = newLines.join('<br>');
        }
        setInterval(addTelemetry, 2500);
    }

    console.log("%c[DSDA MAIN HUB INITIALIZED]", "color: #00e5ff; font-weight: bold;");
});
