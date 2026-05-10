// --- DSDA TERMINAL ENGINE v1.0.7: STABLE MASTER BUILD ---

const commands = {
    'help': "SYSTEM PROTOCOLS:<br>ls - List directory<br>cat [file] - Read file<br>status - System vitals<br>the_architect.bin - Run agent simulation<br>python [program] - Execute redirect (hopes-and-dreams, polkahole)<br>whoami - Decrypt identity<br>clear - Wipe screen<br>exit - Return to core infrastructure",
    
    'ls': "DIRECTORY: /root/syndicate/<br>drwxr-xr-x  [ARCHITECT]  - Senior Coding Agent<br>-rw-r--r--  vitals.log   - Telemetry Data<br>-rw-r--r--  intern.txt   - Personnel complaints<br>-rw-r--r--  network.cfg  - Starlink/Node config",
    
    'status': `[SYSTEM VITALS]<br>-------------------------<br>PRIMARY GPU: RTX 3090 - <span style="color:#00ff00">LOAD 14%</span><br>SECONDARY GPU: RTX 3060 - <span style="color:#00ff00">LOAD 2%</span><br>UPLINK: Starlink - <span style="color:#00ff00">LATENCY 34ms</span><br>ACTIVE AGENTS: 7 [Futurama-Class]<br>DINK STATUS: Heavily caffeinated / Lab coat stained`,

    'cat intern.txt': `LOG ENTRY: 2026-05-09<br>"Bender keeps telling me to 'bite his shiny metal GPU.' I'm an intern with a white coat, not a miracle worker." - Dink`,

    'cat vitals.log': `08:00:01 - Node-01 Handshake SUCCESS<br>08:30:45 - The Architect Agent: Self-correction loop ACTIVE<br>09:20:10 - Polka levels approaching critical spaghetti limit.`,

    'cat network.cfg': `SSID: Starlink_Syndicate_Alpha<br>LOCAL_IP: 192.168.1.137<br>TUNNEL: syndicate_pipe (Active)<br>PORT: 443 [Zero Trust Enabled]`,

    'the_architect.bin': "INITIALIZING AGENT: THE ARCHITECT...<br>[SYSTEM]: MSI Claw Environment Detected.<br>[SYSTEM]: Syncing with 3090 GPU Cluster...<br>------------------------------------",

    'python hopes-and-dreams': "INITIALIZING H&D SUITE...<br>[SYSTEM]: Loading botanical database...<br>------------------------------------",

    'python polkahole': "INITIALIZING POLKAHOLE.EXE...<br>[SYSTEM]: Tuning accordions...<br>------------------------------------",

    'whoami': "DECRYPTING IDENTITY...<br>[REDACTED]: Syndicate Founder / Lead Architect.<br>[STATUS]: Ghost in the machine.<br>NOTES: Surveillance is active. Stay in the shadows."
};

// --- CORE ENGINE ---

document.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById('command-input');
    const output = document.getElementById('output');

    if (!input || !output) {
        console.error("CRITICAL ERROR: Terminal elements not found.");
        return;
    }

    // 1. Confirm script is running with a Boot Message
    printOutput("<span style='color:#ffb300'>[SYSTEM]: Terminal Logic v1.0.7 Loaded Successfully.</span>", output);
    input.focus();

    // 2. Listen for Enter Key
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const cmd = input.value.toLowerCase().trim();
            if (cmd) {
                printUserLine(cmd, output);
                processCommand(cmd, output);
            }
            input.value = ''; // Clear input after enter
        }
    });

    // Keep focus on input
    document.addEventListener('click', () => input.focus());
});

function processCommand(cmd, output) {
    const parts = cmd.split(' ');
    const baseCmd = parts[0];
    const target = parts[1];

    // Logic Tree
    if (baseCmd === 'clear') {
        output.innerHTML = '';
    } else if (baseCmd === 'exit') {
        window.location.href = 'index.html';
    } else if (cmd === 'the_architect.bin') {
        runArchitect(output);
    } else if (baseCmd === 'python') {
        if (target === 'hopes-and-dreams' || target === 'polkahole') {
            runPython(target, output);
        } else {
            printOutput("> ERROR: Script not found: " + (target || "NONE"), output);
        }
    } else if (commands[cmd]) {
        printOutput("> " + commands[cmd], output);
    } else if (baseCmd === 'cat' && parts[1]) {
        const fileName = parts[1];
        const fullCmd = `cat ${fileName}`;
        if (commands[fullCmd]) {
            printOutput("> Reading file... <br>" + commands[fullCmd], output);
        } else {
            printOutput(`> ERROR: File '${fileName}' not found.`, output);
        }
    } else {
        printOutput(`> ERROR: Unknown protocol '${cmd}'. Type 'help' for valid commands.`, output);
    }
}

// --- SPECIAL SEQUENCES ---

function runArchitect(output) {
    printOutput("> " + commands['the_architect.bin'], output);
    const lines = [
        "// Optimizing neural weights for MSI Claw handheld...",
        "function syndicateDeploy() {",
        "  const agents = ['Bender', 'Dink', 'Fry'];",
        "  return agents.map(a => initiate(a));",
        "}",
        "// Architect Output: DEPLOYMENT SUCCESSFUL."
    ];
    let i = 0;
    const interval = setInterval(() => {
        if (i < lines.length) {
            printOutput(`<span style="color:#00ff00">${lines[i]}</span>`, output);
            i++;
        } else {
            clearInterval(interval);
        }
    }, 600);
}

function runPython(program, output) {
    const url = program === 'hopes-and-dreams' ? "https://hopes-and-dreams.ca" : "https://polkahole.ca";
    printOutput("> " + commands['python ' + program], output);
    const lines = [
        `// Executing ${program}.py...`,
        "// Establishing SSL tunnel...",
        "// Handshaking with remote node...",
        "// REDIRECTING TO SOURCE..."
    ];
    let i = 0;
    const interval = setInterval(() => {
        if (i < lines.length) {
            printOutput(`<span style="color:#00ff00">${lines[i]}</span>`, output);
            i++;
        } else {
            clearInterval(interval);
            window.location.href = url;
        }
    }, 600);
}

function printUserLine(cmd, output) {
    const userLine = document.createElement('div');
    userLine.innerHTML = `<span style="color:#9d00ff">DSDA_USER:~$</span> ${cmd}`;
    output.appendChild(userLine);
}

function printOutput(text, output) {
    const response = document.createElement('div');
    response.innerHTML = text;
    output.appendChild(response);
    output.scrollTop = output.scrollHeight;
}
