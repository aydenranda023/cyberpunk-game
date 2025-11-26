import { initFirebase, signInAnonymously, loadUserProfile, saveUserProfile, removeUserProfile, listenToRooms, listenToRoomPlayers, listenToRoomScene, getUser, getDb } from './firebase.js';
import { initParticles, playIntroSequence } from './visuals.js';

let myProfile = null;
let currentRoomId = null;
let currentData = null;
let currentStage = 0;

// Expose to window for HTML onclick handlers
window.initApp = initApp;
window.createSoloGame = createSoloGame;
window.joinGame = joinGame;
window.deleteCharacter = deleteCharacter;
window.firstStart = firstStart;
window.advanceFragment = advanceFragment;
window.makeChoice = makeChoice;

// 1. INIT
function initApp() {
    const cfgStr = document.getElementById('config-input').value.trim();
    if (!cfgStr) return alert("Config Required");
    try {
        let clean = cfgStr.includes("=") ? cfgStr.substring(cfgStr.indexOf('{'), cfgStr.lastIndexOf('}') + 1) : cfgStr;
        const config = new Function("return " + clean)();

        initFirebase(config);

        signInAnonymously().then(() => {
            loadCharacter();
            initParticles();
        });
    } catch (e) { alert("配置错误"); console.error(e); }
}

function loadCharacter() {
    const user = getUser();
    loadUserProfile(user.uid).then(val => {
        if (val && val.profile) { myProfile = val.profile; renderLobby(); }
        else { createNewCharacter(); }
    });
}

function createNewCharacter() {
    const roles = [
        { id: "Solo", label: "街头佣兵", hp: 120, items: ["突击步枪"], secret: "被通缉" },
        { id: "Netrunner", label: "黑客", hp: 80, items: ["接入仓"], secret: "脑数据损坏" },
        { id: "Doc", label: "义体医生", hp: 90, items: ["急救针"], secret: "黑市交易" }
    ];
    const prefixes = ["流浪", "荒坂", "军用", "街头", "夜之城"];
    const names = ["V", "强尼", "杰克", "露西", "K"];
    const r = roles[Math.floor(Math.random() * roles.length)];
    const name = prefixes[Math.floor(Math.random() * prefixes.length)] + "·" + names[Math.floor(Math.random() * names.length)];

    myProfile = { name: name, role: r.label, public: { hp: r.hp, weapon: r.items[0] }, private: { secret: r.secret, hidden_items: r.items } };

    const user = getUser();
    saveUserProfile(user.uid, myProfile);
    renderLobby();
}

function renderLobby() {
    document.getElementById('card-name').innerText = myProfile.name;
    document.getElementById('card-role').innerText = myProfile.role;
    document.getElementById('card-secret').innerText = myProfile.private.secret;
    document.getElementById('step-config').classList.add('hidden');
    document.getElementById('step-lobby').classList.remove('hidden');

    listenToRooms(rooms => {
        const div = document.getElementById('room-list-container');
        div.innerHTML = "";
        if (rooms) {
            Object.keys(rooms).reverse().forEach(rid => {
                const r = rooms[rid];
                if (!r.host_info) return;
                const item = document.createElement('div');
                item.className = 'room-item';
                item.innerHTML = `<span style="color:var(--neon-cyan)">[${r.host_info.role}] ${r.host_info.name}</span> <span>${r.status}</span>`;
                item.onclick = () => joinGame(rid);
                div.appendChild(item);
            });
        }
    });
}

function deleteCharacter() {
    if (confirm("重置?")) {
        const user = getUser();
        removeUserProfile(user.uid).then(() => location.reload());
    }
}

// 2. CONNECT & START
async function createSoloGame() {
    try {
        const res = await fetch('/api/game', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'CREATE_ROOM', userProfile: myProfile }) });
        const data = await res.json();
        currentRoomId = data.roomId;
        const user = getUser();
        await fetch('/api/game', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'JOIN_ROOM', roomId: currentRoomId, userId: user.uid, userProfile: myProfile }) });

        document.getElementById('step-lobby').classList.add('hidden');
        document.getElementById('step-waiting').classList.remove('hidden');
        document.getElementById('room-code-disp').innerText = currentRoomId;

        listenToRoomPlayers(currentRoomId, count => {
            document.getElementById('player-count').innerText = `连接数: ${count}`;
        });
    } catch (e) { alert(e.message); }
}

async function joinGame(rid) {
    const ridVal = rid || document.getElementById('room-input').value;
    const user = getUser();
    try {
        const res = await fetch('/api/game', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'JOIN_ROOM', roomId: ridVal, userId: user.uid, userProfile: myProfile }) });
        if (res.ok) { currentRoomId = ridVal; startTransition(); } else alert("无法加入");
    } catch (e) { alert("ERR"); }
}

async function firstStart() {
    startTransition(); // Start intro
    // Trigger AI generation in background
    const user = getUser();
    fetch('/api/game', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'START_GAME', roomId: currentRoomId, userId: user.uid }) });
}

// 3. INTRO & SYNC
function startTransition() {
    document.getElementById('modal').style.display = 'none';

    playIntroSequence().then(() => {
        const term = document.getElementById('terminal');
        term.style.visibility = 'visible'; term.style.opacity = 1;
        document.getElementById('hud-room').innerText = currentRoomId;
        document.getElementById('hud-hp').innerText = myProfile.public.hp;
        document.getElementById('hud-item').innerText = myProfile.private.hidden_items[0];

        const user = getUser();
        listenToRoomScene(currentRoomId, data => {
            if (data) {
                // Support multi-view: get my view OR global view
                const myData = data[user.uid] || data;
                renderScene(myData);
            }
        });
    });
}

// 4. RENDER & LOGIC
function renderScene(data) {
    document.getElementById('wait-overlay').classList.add('hidden');
    currentData = data; currentStage = 0;
    document.getElementById('story-box').innerHTML = "";
    document.getElementById('controls').classList.remove('active');
    document.getElementById('next-trigger').style.display = 'none';

    const rawKw = data.image_keyword || "cyberpunk";
    const kw = rawKw.split(' ')[0].replace(/[^a-zA-Z0-9]/g, "");
    const url = `https://loremflickr.com/640/360/cyberpunk,${kw}?random=${Date.now()}`;
    const img = document.getElementById('scene-img'); img.style.opacity = 0; img.src = url;
    img.onload = () => { img.style.opacity = 0.8; document.getElementById('loading-hint').innerText = "LIVE"; };

    addMsg(data.stage_1_env, 'var(--neon-cyan)');
    setTimeout(() => { document.getElementById('next-trigger').style.display = 'block'; }, 1000);
}

function advanceFragment() {
    document.getElementById('next-trigger').style.display = 'none';
    if (currentStage === 0) {
        currentStage = 1;
        addMsg(currentData.stage_2_event, 'var(--neon-pink)');
        setTimeout(() => document.getElementById('next-trigger').style.display = 'block', 1000);
    } else if (currentStage === 1) {
        currentStage = 2;
        addMsg(currentData.stage_3_analysis, 'var(--neon-yellow)');
        document.getElementById('btn-a').innerText = `[A] ${currentData.choices[0].text}`;
        document.getElementById('btn-b').innerText = `[B] ${currentData.choices[1].text}`;
        document.getElementById('controls').classList.add('active');
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
