const input = document.getElementById('command-input');
const output = document.getElementById('output');

const commands = {
    'help': "Available commands: [ls, status, about, polkahole, clear, exit]",
    'ls': "Current directories:<br>- the_architect.bin<br>- syndicate_vitals.log<br>- intern_complaints.txt<br>- polkahole_setlist.md",
    'about': "Dream Syndicate Digital Assets: Next-gen infrastructure and AI multi-agent operations hub.",
    'status': "GPU Cluster: ONLINE (RTX 3090 Active)<br>Neural Link: STABLE<br>Intern Status: UNHAPPY (Wearing white coat, needs coffee)",
    'polkahole': "ERROR: High-fidelity accordion levels detected. 'Spaghetti on the walls' protocol initialized.",
    'exit': "Redirecting to Core...",
    'clear': ""
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
