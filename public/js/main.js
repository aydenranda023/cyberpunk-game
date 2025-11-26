// Stage 1 finished, go to Stage 2
currentStage = 1;
addMsg(currentData.stage_2_event, 'var(--neon-pink)');
setTimeout(() => document.getElementById('next-trigger').style.display = 'block', 1000);
    } else if (currentStage === 1) {
    // Stage 2 finished, go to Stage 3
    currentStage = 2;
    addMsg(currentData.stage_3_analysis, 'var(--neon-yellow)');

    if (currentData.choices && currentData.choices.length >= 2) {
        document.getElementById('btn-a').innerText = `[A] ${currentData.choices[0].text}`;
        document.getElementById('btn-b').innerText = `[B] ${currentData.choices[1].text}`;
        document.getElementById('controls').classList.add('active');
    }
    const b = document.getElementById('content-scroll'); b.scrollTop = b.scrollHeight;
}
}

async function makeChoice(text) {
    document.getElementById('wait-overlay').classList.remove('hidden');
    const choiceText = (text === 'A') ? currentData.choices[0].text : currentData.choices[1].text;
    const user = getUser();
    try {
        await fetch('/api/game', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'MAKE_MOVE', roomId: currentRoomId, userId: user.uid, choiceText: choiceText }) });
    } catch (e) { document.getElementById('wait-overlay').classList.add('hidden'); }
}

function addMsg(txt, color) {
    if (!txt) return;
    const d = document.createElement('div'); d.className = "msg-block"; d.style.borderLeftColor = color; d.innerText = txt;
    document.getElementById('story-box').appendChild(d); setTimeout(() => d.classList.add('show'), 50);
    const b = document.getElementById('content-scroll'); b.scrollTop = b.scrollHeight;
}
