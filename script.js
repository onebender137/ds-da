document.addEventListener('DOMContentLoaded', () => {
    // 1. The Typewriter Effect
    const subtitle = document.querySelector('.subtitle');
    // Save the original text and clear it
    const text = subtitle.textContent;
    subtitle.textContent = '';
    
    let i = 0;
    function typeWriter() {
        if (i < text.length) {
            subtitle.textContent += text.charAt(i);
            i++;
            // Typing speed in milliseconds
            setTimeout(typeWriter, 40); 
        }
    }
    
    // Start typing 1 second after page loads
    setTimeout(typeWriter, 1000);

    // 2. The Terminal Boot Sequence (Press F12 on your live site to see this)
    console.log("%c[DSDA SYSTEM INITIALIZATION]", "color: #00e5ff; font-weight: bold; font-size: 14px;");
    setTimeout(() => console.log("%c> RTX 3090 Array... ONLINE", "color: #ffb300;"), 500);
    setTimeout(() => console.log("%c> Ollama Syndicate... ACTIVE", "color: #9d00ff;"), 1200);
    setTimeout(() => console.log("%c> The Architect... SYNCING", "color: #00e5ff;"), 1800);
    setTimeout(() => console.log("%c> Intern Status: Complaining", "color: #ff3333;"), 2500);
});
