const input = document.getElementById('command-input');
const output = document.getElementById('output');

const commands = {
    'help': "SYSTEM PROTOCOLS:<br>ls - List active directory<br>cat [file] - Read file contents<br>status - Get system vitals<br>clear - Wipe terminal screen<br>exit - Return to core infrastructure",
    
    'ls': "DIRECTORY: /root/syndicate/<br>drwxr-xr-x  [ARCHITECT]  - Senior Coding Agent<br>-rw-r--r--  vitals.log   - Real-time telemetry<br>-rw-r--r--  intern.txt   - Personnel complaints<br>-rw-r--r--  network.cfg  - Starlink/Node config",
    
    'status': `[SYSTEM VITALS]<br>-------------------------<br>PRIMARY GPU: RTX 3090 - <span style="color:#00ff00">LOAD 14%</span><br>SECONDARY GPU: RTX 3060 - <span style="color:#00ff00">LOAD 2%</span><br>UPLINK: Starlink - <span style="color:#00ff00">LATENCY 34ms</span><br>ACTIVE AGENTS: 7 [Futurama-Class]<br>DINK STATUS: Heavily caffeinated / Lab coat stained`,

    'cat intern.txt': `LOG ENTRY: 2026-05-09<br>"Bender keeps telling me to 'bite his shiny metal GPU.' I'm an intern with a white coat, not a miracle worker." - Dink`,

    'cat vitals.log': `08:00:01 - Node-01 Handshake SUCCESS<br>08:30:45 - The Architect Agent: Self-correction loop ACTIVE<br>09:20:10 - Polka levels approaching critical spaghetti limit.`,

    'cat network.cfg': `SSID: Starlink_Syndicate_Alpha<br>LOCAL_IP: 192.168.1.137<br>TUNNEL: syndicate_pipe (Active)<br>PORT_FORWARDING: Disabled [Zero Trust Protocol]`,

    'the_architect.bin': "INITIALIZING AGENT: THE ARCHITECT...<br>[SYSTEM]: MSI Claw Environment Detected.<br>[SYSTEM]: Syncing with 3090 GPU Cluster...<br>------------------------------------"
};

input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        const cmd = input.value.toLowerCase().trim();
        processCommand(cmd);
        input.value = '';
    }
});

function processCommand(cmd) {
    printUserLine(cmd);

    const parts = cmd.split(' ');
    const baseCmd = parts[0];

    if (baseCmd === 'clear') {
        output.innerHTML = '';
    } else if (baseCmd === 'exit') {
        window.location.href = 'index.html';
    } else if (cmd === 'the_architect.bin') {
        runArchitect();
    } else if (commands[cmd]) {
        printOutput("> " + commands[cmd]);
    } else if (baseCmd === 'cat' && !parts[1]) {
        printOutput("> Usage: cat [filename]");
    } else if (baseCmd === 'cat' && commands[cmd]) {
        printOutput("> Reading file... <br>" + commands[cmd]);
    } else {
        printOutput(`> ERROR: Unknown protocol '${cmd}'. Type 'help' for valid commands.`);
    }
}

function runArchitect() {
    printOutput("> " + commands['the_architect.bin']);
    const lines = [
        "// Optimizing neural weights for Claw handheld...",
        "function syndicateDeploy() {",
        "  const agents = ['Bender', 'Dink', 'Fry'];",
        "  return agents.map(a => initiate(a));",
        "}",
        "// Architect Output: DEPLOYMENT SUCCESSFUL."
    ];
    let i = 0;
    const interval = setInterval(() => {
        if (i < lines.length) {
            printOutput(`<span style="color:#00ff00">${lines[i]}</span>`);
            i++;
        } else {
            clearInterval(interval);
        }
    }, 600);
}

function printUserLine(cmd) {
    const userLine = document.createElement('div');
    userLine.innerHTML = `<span class="prompt">DSDA_USER:~$</span> ${cmd}`;
    output.appendChild(userLine);
}

function printOutput(text) {
    const response = document.createElement('div');
    response.innerHTML = text;
    output.appendChild(response);
    output.scrollTop = output.scrollHeight;
}

document.addEventListener('click', () => input.focus());
