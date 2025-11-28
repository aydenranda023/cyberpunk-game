import { initFirebase, signInAnonymously, loadUserProfile, saveUserProfile, removeUserProfile, listenToRooms, listenToRoomPlayers, listenToRoomScene, getUser } from './firebase.js';
import { initParticles, playIntroSequence, playDeathSequence } from './visuals.js';

let myProfile, currentRoomId, currentData, currentStage = 0;
const $ = id => document.getElementById(id);
const show = (id) => $(id).classList.remove('hidden');
const hide = (id) => $(id).classList.add('hidden');

window.initApp = () => {
    try {
        initFirebase({ apiKey: "AIzaSyAcbkxphcJZlWXq3tJvfbb-xkj_i9LpnsU", authDomain: "cyberpunk-game-0529.firebaseapp.com", databaseURL: "https://cyberpunk-game-0529-default-rtdb.asia-southeast1.firebasedatabase.app", projectId: "cyberpunk-game-0529", storageBucket: "cyberpunk-game-0529.firebasestorage.app", messagingSenderId: "619803250426", appId: "1:619803250426:web:495f48f5127a67865f0343", measurementId: "G-DCPC4LKNBL" });
        hide('step-config'); show('loading-overlay');
        setTimeout(() => signInAnonymously().then(() => { loadCharacter(); initParticles(); hide('loading-overlay'); }), 1000);
    } catch (e) { console.error(e); }
};
window.addEventListener('DOMContentLoaded', window.initApp);

function loadCharacter() {
    loadUserProfile(getUser().uid).then(val => {
        if (val?.profile) { myProfile = val.profile; renderLobby(); } else createNewCharacter();
    });
}

function createNewCharacter() {
    const roles = [{ id: "Solo", label: "街头佣兵", hp: 120, items: ["突击步枪"], secret: "被通缉" }, { id: "Netrunner", label: "黑客", hp: 80, items: ["接入仓"], secret: "脑数据损坏" }, { id: "Doc", label: "义体医生", hp: 90, items: ["急救针"], secret: "黑市交易" }];
    const r = roles[Math.floor(Math.random() * roles.length)];
    myProfile = { name: `User_${Math.floor(Math.random() * 1000)}`, role: r.label, public: { hp: r.hp, weapon: r.items[0] }, private: { secret: r.secret, hidden_items: r.items } };
    saveUserProfile(getUser().uid, myProfile); renderLobby();
}

function renderLobby() {
    $('card-name').innerText = myProfile.name; $('card-role').innerText = myProfile.role; $('card-secret').innerText = myProfile.private.secret;
    hide('step-config'); show('step-lobby');
    listenToRooms(rooms => {
        const div = $('room-list-container'); div.innerHTML = "";
        if (rooms) Object.keys(rooms).reverse().forEach(rid => {
            const r = rooms[rid]; if (!r.host_info) return;
            const item = document.createElement('div'); item.className = 'room-item';
            item.innerHTML = `<span style="color:var(--neon-cyan)">[${r.host_info.role}] ${r.host_info.name}</span> <span>${r.status}</span>`;
            item.onclick = () => window.joinGame(rid); div.appendChild(item);
        });
    });
}

window.deleteCharacter = () => { if (confirm("Reset?")) removeUserProfile(getUser().uid).then(() => location.reload()); };
window.toggleInventory = () => {
    const m = $('inventory-modal');
    if (m.classList.contains('hidden')) {
        m.classList.remove('hidden'); const l = $('inv-list'); l.innerHTML = "";
        (myProfile.public.visible_items || []).forEach(i => l.innerHTML += `<div style="color:var(--neon-cyan)">- ${i}</div>`);
        (myProfile.private.hidden_items || []).forEach(i => l.innerHTML += `<div style="color:var(--neon-pink)">- ${i} (隐)</div>`);
    } else m.classList.add('hidden');
};

window.createSoloGame = async () => {
    const res = await fetch('/api/game', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'CREATE_ROOM', userProfile: myProfile }) });
    const data = await res.json(); currentRoomId = data.roomId;
    await fetch('/api/game', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'JOIN_ROOM', roomId: currentRoomId, userId: getUser().uid, userProfile: myProfile }) });
    hide('step-lobby'); show('step-waiting'); $('room-code-disp').innerText = currentRoomId;
    listenToRoomPlayers(currentRoomId, c => $('player-count').innerText = `连接数: ${c}`);
};

window.joinGame = async (rid) => {
    const id = rid || $('room-input').value;
    if ((await fetch('/api/game', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'JOIN_ROOM', roomId: id, userId: getUser().uid, userProfile: myProfile }) })).ok) {
        currentRoomId = id; startTransition();
    } else alert("Fail");
};

window.firstStart = () => { startTransition(); fetch('/api/game', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'START_GAME', roomId: currentRoomId, userId: getUser().uid }) }); };

function startTransition() {
    $('modal').style.display = 'none';
    playIntroSequence().then(() => {
        $('terminal').style.visibility = 'visible'; $('terminal').style.opacity = 1;
        $('hud-name').innerText = myProfile.name; $('hud-hp').innerText = myProfile.public.hp;
        listenToRoomScene(currentRoomId, data => { if (data) renderScene(data[getUser().uid] || data); });
    });
}

function renderScene(data) {
    hide('wait-overlay'); currentData = data; currentStage = 0; $('story-box').innerHTML = ""; $('controls').classList.remove('active'); $('next-trigger').style.display = 'none';
    if (data.is_dead) return playDeathSequence().then(() => location.reload());

    if (data.hp_change) {
        let hp = parseInt($('hud-hp').innerText); hp = Math.max(0, hp + data.hp_change); $('hud-hp').innerText = hp;
        const color = data.hp_change < 0 ? 'var(--neon-pink)' : 'var(--neon-cyan)';
        document.body.style.boxShadow = `inset 0 0 50px ${color}`; setTimeout(() => document.body.style.boxShadow = "none", 500);
        $('hud-hp').style.color = color; setTimeout(() => $('hud-hp').style.color = 'var(--neon-cyan)', 1000);
        addMsg(data.hp_change < 0 ? `[警告] 伤害: ${data.hp_change}` : `[系统] 恢复: +${data.hp_change}`, color);
    }

    if (data.image_keyword) {
        const img = $('scene-img'); img.style.opacity = 0;
        img.src = `https://loremflickr.com/640/360/cyberpunk,${data.image_keyword.split(' ')[0].replace(/[^a-zA-Z0-9]/g, "")}?random=${Date.now()}`;
        img.onload = () => { img.style.opacity = 0.8; $('loading-hint').innerText = "LIVE"; };
    }
    if (data.location) addMsg(`[地点: ${data.location}]`, 'var(--neon-cyan)');
    if (data.stage_1_env) { addMsg(data.stage_1_env, 'var(--neon-cyan)'); setTimeout(() => $('next-trigger').style.display = 'block', 1000); }
    else { currentStage = 1; window.advanceFragment(); }
    fetch('/api/game', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'PRELOAD_TURN', roomId: currentRoomId, userId: getUser().uid }) });
}

window.advanceFragment = () => {
    $('next-trigger').style.display = 'none';
    if (currentStage === 0) { currentStage = 1; addMsg(currentData.stage_2_event, 'var(--neon-pink)'); setTimeout(() => $('next-trigger').style.display = 'block', 1000); }
    else if (currentStage === 1) {
        currentStage = 2; addMsg(currentData.stage_3_analysis, 'var(--neon-yellow)');
        if (currentData.choices?.length >= 2) {
            $('btn-a').innerText = `[A] ${currentData.choices[0].text}`; $('btn-b').innerText = `[B] ${currentData.choices[1].text}`;
            $('controls').classList.add('active');
        }
        $('content-scroll').scrollTop = $('content-scroll').scrollHeight;
    }
};

window.makeChoice = async (t) => {
    show('wait-overlay');
    try { await fetch('/api/game', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'MAKE_MOVE', roomId: currentRoomId, userId: getUser().uid, choiceText: (t === 'A' ? currentData.choices[0].text : currentData.choices[1].text) }) }); }
    catch (e) { hide('wait-overlay'); }
};

function addMsg(txt, c) {
    if (!txt) return;
    const d = document.createElement('div'); d.className = "msg-block"; d.style.borderLeftColor = c; d.innerText = txt;
    $('story-box').appendChild(d); setTimeout(() => d.classList.add('show'), 50); $('content-scroll').scrollTop = $('content-scroll').scrollHeight;
}
