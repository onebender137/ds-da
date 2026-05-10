        "// Optimizing neural weights for MSI Claw handheld...",
        "function syndicateDeploy() {",
        "  const agents = ['Bender', 'Dink', 'Fry'];",
        "  return agents.map(a => initiate(a));",
        "}",
        "// Architect Output: DEPLOYMENT SUCCESSFUL."
    ];
1const input = document.getElementById('command-input');
const output = document.getElementById('output');

const commands = {
    'help': "SYSTEM PROTOCOLS:<br>ls - List directory<br>cat [file] - Read file<br>status - System vitals<br>the_architect.bin - Run senior coding agent<br>python [program] - Execute redirect (hopes-and-dreams, polkahole)<br>clear - Wipe screen<br>exit - Return to core",
    'ls': "DIRECTORY: /root/syndicate/<br>drwxr-xr-x  [ARCHITECT]  - Coding Agent<br>-rw-r--r--  vitals.log   - Telemetry<br>-rw-r--r--  intern.txt   - Personnel complaints<br>-rw-r--r--  network.cfg  - Node config",
    'status': `[SYSTEM VITALS]<br>-------------------------<br>PRIMARY GPU: RTX 3090 - <span style="color:#00ff00">LOAD 14%</span><br>UPLINK: Starlink - <span style="color:#00ff00">LATENCY 34ms</span><br>DINK STATUS: Heavily caffeinated`,
    'cat intern.txt': `LOG ENTRY: 2026-05-09<br>"Bender keeps telling me to 'bite his shiny metal GPU.' I'm an intern, not a miracle worker." - Dink`,
    'cat vitals.log': `08:00:01 - Node-01 SUCCESS<br>08:30:45 - The Architect Agent: ACTIVE<br>09:20:10 - Polka levels approaching critical spaghetti limit.`,
    'cat network.cfg': `SSID: Starlink_Syndicate_Alpha<br>LOCAL_IP: 192.168.1.137<br>TUNNEL: syndicate_pipe (Active)`,
    'the_architect.bin': "INITIALIZING AGENT: THE ARCHITECT...<br>[SYSTEM]: MSI Claw Detected.<br>[SYSTEM]: Syncing with 3090 Cluster...<br>------------------------------------",
    'python hopes-and-dreams': "INITIALIZING H&D SUITE...<br>[SYSTEM]: Loading botanical database...<br>[SYSTEM]: Syncing cognitive logs...<br>------------------------------------",
    'python polkahole': "INITIALIZING POLKAHOLE.EXE...<br>[SYSTEM]: Tuning accordions...<br>[SYSTEM]: Spreading spaghetti on walls...<br>------------------------------------"
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
    const target = parts[1];

    if (baseCmd === 'clear') {
        output.innerHTML = '';
    } else if (baseCmd === 'exit') {
        window.location.href = 'index.html';
    } else if (cmd === 'the_architect.bin') {
        runArchitect();
    } else if (baseCmd === 'python') {
        if (target === 'hopes-and-dreams' || target === 'polkahole') {
            runPython(target);
        } else {
            printOutput("> ERROR: Script not found: " + (target || "NONE"));
        }
    } else if (commands[cmd]) {
        printOutput("> " + commands[cmd]);
    } else if (baseCmd === 'cat' && commands[cmd]) {
        printOutput("> Reading file... <br>" + commands[cmd]);
    } else {
        printOutput(`> ERROR: Unknown protocol '${cmd}'.`);
    }
}

function runArchitect() {
    printOutput("> " + commands['the_architect.bin']);
    const lines = [
        "// Optimizing neural weights for MSI Claw handheld...",
        "function syndicateDeploy() {",
        "  const agents = ['Bender', 'Dink', 'Fry'];",
        "  return agents.map(a => initiate(a));",
        "}",
        "// Architect Output: DEPLOYMENT SUCCESSFUL."
