const input = document.getElementById('command-input');
const output = document.getElementById('output');

const commands = {
    'help': "SYSTEM PROTOCOLS:<br>ls - List active directory<br>cat [file] - Read file contents<br>status - Get system vitals<br>clear - Wipe terminal screen<br>exit - Return to core infrastructure",
    
    'ls': "DIRECTORY: /root/syndicate/<br>drwxr-xr-x  [ARCHITECT]  - Senior Coding Agent<br>-rw-r--r--  vitals.log   - Real-time telemetry<br>-rw-r--r--  intern.txt   - Personnel complaints<br>-rw-r--r--  network.cfg  - Starlink/Node config",
    
    'status': `
        [SYSTEM VITALS]<br>
        -------------------------<br>
        PRIMARY GPU: RTX 3090 (24GB VRAM) - <span style="color:#00ff00">LOAD 14%</span><br>
        SECONDARY GPU: RTX 3060 - <span style="color:#00ff00">LOAD 2%</span><br>
        UPLINK: Starlink Satellite - <span style="color:#00ff00">LATENCY 34ms</span><br>
        ACTIVE AGENTS: 7 [Futurama-Class Syndicate]<br>
        DINK STATUS: Heavily caffeinated / Lab coat stained
    `,

    'cat intern.txt': `
        LOG ENTRY: 2026-05-09<br>
        "I've been watching the bittensor portfolio for 12 hours straight. 
        Bender keeps telling me to 'bite his shiny metal GPU.' 
        I'm an intern with a white coat, not a miracle worker. 
        Can we please buy some higher-quality espresso beans?" - Dink
    `,

    'cat vitals.log': `
        08:00:01 - Node-01 Handshake SUCCESS<br>
        08:15:22 - MSI Claw Dev Environment Initialized<br>
        08:30:45 - The Architect Agent: Self-correction loop ACTIVE<br>
        09:20:10 - Polka levels approaching critical spaghetti limit.
    `,

    'cat network.cfg': `
        SSID: Starlink_Syndicate_Alpha<br>
        LOCAL_IP: 192.168.1.137<br>
        TUNNEL: syndicate_pipe (Active)<br>
        PORT_FORWARDING: Disabled [Zero Trust Protocol Enabled]
    `
};

input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        const cmd = input.value.toLowerCase().trim();
        processCommand(cmd);
        input.value = '';
    }
});

function processCommand(cmd) {
    // Add the user's line to the output
    const userLine = document.createElement('div');
    userLine.innerHTML = `<span class="prompt">DSDA_USER:~$</span> ${cmd}`;
    output.appendChild(userLine);

    // Logic for response
    if (cmd === 'clear') {
        output.innerHTML = '';
    } else if (cmd === 'exit') {
        window.location.href = '/';
    } else if (commands[cmd]) {
        const response = document.createElement('div');
        response.innerHTML = `> ${commands[cmd]}`;
        output.appendChild(response);
    } else {
        const error = document.createElement('div');
        error.innerHTML = `> COMMAND NOT RECOGNIZED: ${cmd}. Type 'help' for protocols.`;
        output.appendChild(error);
    }

    // Always scroll to bottom
    output.scrollTop = output.scrollHeight;
}

// Keep focus on the input no matter where you click
document.addEventListener('click', () => input.focus());
