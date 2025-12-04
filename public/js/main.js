import { initFirebase, signInAnonymously, loadUserProfile, saveUserProfile, removeUserProfile, listenToRooms, listenToRoomPlayers, listenToRoomScene, getUser } from './firebase.js';
import { initParticles, playIntroSequence, playDeathSequence } from './visuals.js';

let myProfile, curRid, curData, curStg = 0;
const $ = i => document.getElementById(i), H = 'hidden', C = 'var(--neon-cyan)', P = 'var(--neon-pink)';
const show = i => $(i).classList.remove(H), hide = i => $(i).classList.add(H);
const api = async (a, b) => {
    try {
        const r = await fetch('/api/game', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: a, ...b }) });
        if (!r.ok) throw new Error(`API Error ${r.status}: ${await r.text()}`);
        return r;
    } catch (e) { alert(e.message); throw e; }
};

window.initApp = () => {
    initFirebase({ apiKey: "AIzaSyAcbkxphcJZlWXq3tJvfbb-xkj_i9LpnsU", authDomain: "cyberpunk-game-0529.firebaseapp.com", databaseURL: "https://cyberpunk-game-0529-default-rtdb.asia-southeast1.firebasedatabase.app", projectId: "cyberpunk-game-0529", storageBucket: "cyberpunk-game-0529.firebasestorage.app", messagingSenderId: "619803250426", appId: "1:619803250426:web:495f48f5127a67865f0343", measurementId: "G-DCPC4LKNBL" });
    hide('step-config'); show('loading-overlay');
    setTimeout(() => signInAnonymously().then(() => { loadChar(); initParticles(); hide('loading-overlay'); }), 1000);
};
window.addEventListener('DOMContentLoaded', window.initApp);

function loadChar() { loadUserProfile(getUser().uid).then(v => { if (v?.profile) { myProfile = v.profile; renderLobby(); } else createChar(); }); }
function createChar() {
    const roles = [{ id: "Solo", l: "佣兵", h: 120, i: ["步枪"], s: "通缉" }, { id: "Net", l: "黑客", h: 80, i: ["接入仓"], s: "损坏" }, { id: "Doc", l: "医生", h: 90, i: ["急救针"], s: "交易" }];
    const r = roles[Math.floor(Math.random() * roles.length)];

    const orgs = ["荒坂", "军用科技", "夜氏", "康陶", "漩涡帮", "虎爪帮", "六街帮", "生物技术", "沛卓石化"];
    const names = ["V", "大卫", "露西", "瑞贝卡", "强尼", "杰克", "帕南", "朱迪", "克里", "罗格", "索尔", "米契", "蝎子", "T-Bug", "德克斯特"];
    const org = orgs[Math.floor(Math.random() * orgs.length)];
    const name = names[Math.floor(Math.random() * names.length)];

    myProfile = { name: `${org}·${name}`, role: r.l, public: { hp: r.h, weapon: r.i[0] }, private: { hidden_items: r.i } };
    saveUserProfile(getUser().uid, myProfile); renderLobby();
}
function renderLobby() {
    $('card-name').innerText = myProfile.name; $('card-role').innerText = myProfile.role;
    hide('step-config'); show('step-lobby');
    listenToRooms(rs => {
        const d = $('room-list-container'); d.innerHTML = "";
        if (rs) Object.keys(rs).reverse().forEach(id => {
            const r = rs[id]; if (!r.host_info) return;
            const i = document.createElement('div'); i.className = 'room-item';
            i.innerHTML = `<span style="color:${C}">[${r.host_info.role}] ${r.host_info.name}</span> <span>${r.status}</span>`;
            i.onclick = () => window.joinGame(id); d.appendChild(i);
        });
    });
}
window.deleteCharacter = () => {
    if (confirm("Reset?")) {
        api('LEAVE_ROOM', { userId: getUser().uid }).then(() => {
            removeUserProfile(getUser().uid).then(() => location.reload());
        });
    }
};
window.toggleInventory = () => {
    const m = $('inventory-modal');
    if (m.classList.contains(H)) {
        m.classList.remove(H); const l = $('inv-list'); l.innerHTML = "";
        (myProfile.public.visible_items || []).forEach(i => l.innerHTML += `<div style="color:${C}">- ${i}</div>`);
        (myProfile.private.hidden_items || []).forEach(i => l.innerHTML += `<div style="color:${P}">- ${i} (隐)</div>`);
    } else m.classList.add(H);
};
window.createSoloGame = async () => {
    try {
        const res = await api('CREATE_ROOM', { userProfile: myProfile });
        const d = await res.json();
        if (!d.roomId) throw new Error("No Room ID returned");
        curRid = d.roomId;
        console.log("Created Room:", curRid);
        await api('JOIN_ROOM', { roomId: curRid, userId: getUser().uid, userProfile: myProfile });
        hide('step-lobby'); show('step-waiting'); $('room-code-disp').innerText = curRid;
        listenToRoomPlayers(curRid, c => $('player-count').innerText = `连接数: ${c}`);
    } catch (e) { console.error(e); alert("Create Game Failed: " + e.message); }
};
window.joinGame = async (id) => {
    const rid = id || $('room-input').value;
    if ((await api('JOIN_ROOM', { roomId: rid, userId: getUser().uid, userProfile: myProfile })).ok) { curRid = rid; start(); } else alert("Fail");
};
window.firstStart = () => { start(); api('START_GAME', { roomId: curRid, userId: getUser().uid }); };
function start() {
    $('modal').style.display = 'none';
    playIntroSequence().then(() => {
        $('terminal').style.visibility = 'visible'; $('terminal').style.opacity = 1;
        $('hud-name').innerText = myProfile.name; $('hud-hp').innerText = myProfile.public.hp;
        listenToRoomScene(curRid, d => { if (d) render(d[getUser().uid] || d); });
    });
}
function render(d) {
    console.log("Render called with:", d);
    hide('wait-overlay'); curData = d; curStg = 0; $('story-box').innerHTML = ""; $('controls').classList.remove('active'); $('next-trigger').style.display = 'none';
    if (d.is_dead) return playDeathSequence().then(() => location.reload());
    if (d.hp_change) {
        let hp = Math.max(0, parseInt($('hud-hp').innerText) + d.hp_change); $('hud-hp').innerText = hp;
        const c = d.hp_change < 0 ? P : C;
        document.body.style.boxShadow = `inset 0 0 50px ${c}`; setTimeout(() => document.body.style.boxShadow = "none", 500);
        $('hud-hp').style.color = c; setTimeout(() => $('hud-hp').style.color = C, 1000);
        addMsg(d.hp_change < 0 ? `[警告] 伤害: ${d.hp_change}` : `[系统] 恢复: +${d.hp_change}`, c);
    }
    if (d.image_keyword) {
        const i = $('scene-img'); i.style.opacity = 0;
        i.src = `https://loremflickr.com/640/360/cyberpunk,${d.image_keyword.split(' ')[0].replace(/[^a-zA-Z0-9]/g, "")}?random=${Date.now()}`;
        i.onload = () => { i.style.opacity = 0.8; $('loading-hint').innerText = "LIVE"; };
    }
    if (d.location && d.location !== "null") addMsg(`[地点: ${d.location}]`, C);

    console.log("Stage 1 Env:", d.stage_1_env);
    if (d.stage_1_env && d.stage_1_env !== "null") {
        addMsg(d.stage_1_env, C);
        setTimeout(() => $('next-trigger').style.display = 'block', 1000);
    } else {
        console.log("Skipping Stage 1, advancing...");
        curStg = 0; window.advanceFragment();
    }
    api('PRELOAD_TURN', { roomId: curRid, userId: getUser().uid });
}
window.advanceFragment = () => {
    console.log("AdvanceFragment called. curStg:", curStg);
    $('next-trigger').style.display = 'none';
    if (curStg === 0) {
        curStg = 1;
        console.log("Showing Stage 2 Event:", curData.stage_2_event);
        addMsg(curData.stage_2_event, P);
        setTimeout(() => $('next-trigger').style.display = 'block', 1000);
    }
    else if (curStg === 1) {
        curStg = 2;
        console.log("Showing Stage 3 Analysis:", curData.stage_3_analysis);
        addMsg(curData.stage_3_analysis, 'var(--neon-yellow)');
        if (curData.choices?.length >= 2) {
            $('btn-a').innerText = `[A] ${curData.choices[0].text}`; $('btn-b').innerText = `[B] ${curData.choices[1].text}`;
            $('controls').classList.add('active');
        }
        $('content-scroll').scrollTop = $('content-scroll').scrollHeight;
    }
};
window.makeChoice = async (t) => { show('wait-overlay'); try { await api('MAKE_MOVE', { roomId: curRid, userId: getUser().uid, choiceText: (t === 'A' ? curData.choices[0].text : curData.choices[1].text) }); } catch (e) { hide('wait-overlay'); } };
function addMsg(t, c) {
    if (!t) return; const d = document.createElement('div'); d.className = "msg-block"; d.style.borderLeftColor = c; d.innerText = t;
    $('story-box').appendChild(d); setTimeout(() => d.classList.add('show'), 50); $('content-scroll').scrollTop = $('content-scroll').scrollHeight;
}
