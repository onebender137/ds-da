document.addEventListener('DOMContentLoaded', () => {
    // 1. Typewriter Subtitle
    const subtitle = document.querySelector('.subtitle');
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

    // 2. HUD Clock
    const clockElement = document.getElementById('clock');
    function updateClock() {
        const now = new Date();
        clockElement.textContent = now.toISOString().split('T')[1].split('.')[0] + " UTC";
    }
    setInterval(updateClock, 1000);
    updateClock();

    // 3. Telemetry Feed
    const telemetry = document.getElementById('telemetry-feed');
    function addTelemetry() {
        const hex = Math.floor(Math.random() * 0xFFFFFF).toString(16).toUpperCase();
        const statuses = ["SYNCED", "OK", "PENDING", "ACTIVE"];
        const status = statuses[Math.floor(Math.random() * statuses.length)];
        const line = `0x${hex}... ${status}<br>`;
        const lines = telemetry.innerHTML.split('<br>').slice(0, 5);
        telemetry.innerHTML = line + lines.join('<br>');
    }
    setInterval(addTelemetry, 2500);

    console.log("%c[DSDA SYSTEM INITIALIZATION]", "color: #00e5ff; font-weight: bold;");
});
