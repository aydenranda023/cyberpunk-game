// 主游戏逻辑
let db, auth, user, myProfile = null;
let currentRoomId = null;
let currentData = null;
let currentStage = 0;
let preBuffer = { A: null, B: null };

// 将函数挂载到 window 方便 HTML 调用
window.initApp = function() {
    const cfgStr = document.getElementById('config-input').value.trim();
    if(!cfgStr) return alert("Config Required");
    try {
        let clean = cfgStr.includes("=") ? cfgStr.substring(cfgStr.indexOf('{'), cfgStr.lastIndexOf('}')+1) : cfgStr;
        const config = new Function("return " + clean)();
        firebase.initializeApp(config);
        auth = firebase.auth();
        db = firebase.database();
        auth.signInAnonymously().then(u => {
            user = u.user;
            loadCharacter();
            window.initParticles(); // 调用 visuals.js
        });
    } catch(e) { alert("配置错误"); }
}

function loadCharacter() {
    db.ref('users/' + user.uid).once('value', s => {
        const val = s.val();
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
    const name = prefixes[Math.floor(Math.random()*prefixes.length)] + "·" + names[Math.floor(Math.random()*names.length)];
    
    myProfile = { name: name, role: r.label, public: { hp: r.hp, weapon: r.items[0] }, private: { secret: r.secret, hidden_items: r.items } };
    db.ref('users/' + user.uid).set({ profile: myProfile });
    renderLobby();
}

function renderLobby() {
    document.getElementById('card-name').innerText = myProfile.name;
    document.getElementById('card-role').innerText = myProfile.role;
    document.getElementById('card-secret').innerText = myProfile.private.secret;
    document.getElementById('step-config').classList.add('hidden');
    document.getElementById('step-lobby').classList.remove('hidden');
    
    db.ref('rooms').limitToLast(10).on('value', s => {
        const div = document.getElementById('room-list-container');
        div.innerHTML = "";
        const rooms = s.val();
        if(rooms) {
            Object.keys(rooms).reverse().forEach(rid => {
                const r = rooms[rid];
                if(!r.host_info) return;
                const item = document.createElement('div');
                item.className = 'room-item';
                item.innerHTML = `<span style="color:var(--neon-cyan)">[${r.host_info.role}] ${r.host_info.name}</span> <span>${r.status}</span>`;
                item.onclick = () => joinGame(rid);
                div.appendChild(item);
            });
        }
    });
}

window.deleteCharacter = function() {
    if(confirm("重置?")) db.ref('users/'+user.uid).remove().then(()=>location.reload());
}

window.createSoloGame = async function() {
    try {
        const res = await fetch('/api/game', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ action: 'CREATE_ROOM', userProfile: myProfile }) });
        const data = await res.json();
        currentRoomId = data.roomId;
        await fetch('/api/game', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ action: 'JOIN_ROOM', roomId: currentRoomId, userId: user.uid, userProfile: myProfile }) });
        
        document.getElementById('step-lobby').classList.add('hidden');
        document.getElementById('step-waiting').classList.remove('hidden');
        document.getElementById('room-code-disp').innerText = currentRoomId;
        db.ref(`rooms/${currentRoomId}/players`).on('value', s => { document.getElementById('player-count').innerText = `连接数: ${s.numChildren()}`; });
    } catch(e) { alert(e.message); }
}

window.joinGame = async function(rid) {
    const ridVal = rid || document.getElementById('room-input').value;
    try {
        const res = await fetch('/api/game', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ action: 'JOIN_ROOM', roomId: ridVal, userId: user.uid, userProfile: myProfile }) });
        if(res.ok) { currentRoomId = ridVal; startTransition(); } else alert("无法加入");
    } catch(e) { alert("ERR"); }
}

window.firstStart = async function() {
    startTransition();
    fetch('/api/game', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ action: 'START_GAME', roomId: currentRoomId, userId: user.uid }) });
}

function startTransition() {
    document.getElementById('modal').style.display = 'none';
    
    window.playIntroSequence().then(() => {
        const term = document.getElementById('terminal');
        term.style.visibility = 'visible'; term.style.opacity = 1;
        
        document.getElementById('hud-name-disp').innerText = myProfile.name;
        document.getElementById('hud-hp-disp').innerText = myProfile.public.hp;
        document.getElementById('hud-item-disp').innerText = "物品: " + myProfile.private.hidden_items[0];

        db.ref(`rooms/${currentRoomId}/current_scene`).on('value', snapshot => {
            const data = snapshot.val();
            if(data) {
                const myData = data[user.uid] || data;
                renderScene(myData);
            }
        });
    });
}

function renderScene(data) {
    document.getElementById('wait-overlay').classList.add('hidden');
    currentData = data; currentStage = 0;
    document.getElementById('story-box').innerHTML = "";
    document.getElementById('controls').classList.remove('active');
    document.getElementById('next-trigger').style.display = 'none';
    
    const rawKw = data.image_keyword || "cyberpunk";
    const kw = rawKw.split(' ')[0].replace(/[^a-zA-Z0-9]/g,"");
    const url = `https://loremflickr.com/640/360/cyberpunk,${kw}?random=${Date.now()}`;
    const img = document.getElementById('scene-img'); img.style.opacity=0; img.src=url;
    img.onload = () => { img.style.opacity=0.8; document.getElementById('loading-hint').innerText = "LIVE"; };

    addMsg(data.stage_1_env, 'var(--neon-cyan)');
    setTimeout(() => { document.getElementById('next-trigger').style.display = 'block'; }, 1000);
}

window.advanceFragment = function() {
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

window.makeChoice = async function(text) {
    document.getElementById('wait-overlay').classList.remove('hidden');
    const choiceText = (text === 'A') ? currentData.choices[0].text : currentData.choices[1].text;
    try {
        await fetch('/api/game', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ action: 'MAKE_MOVE', roomId: currentRoomId, userId: user.uid, choiceText: choiceText }) });
    } catch(e) { document.getElementById('wait-overlay').classList.add('hidden'); }
}

function addMsg(txt, color) {
    if(!txt) return;
    const d = document.createElement('div'); d.className="msg-block"; d.style.borderLeftColor=color; d.innerText=txt;
    document.getElementById('story-box').appendChild(d); setTimeout(()=>d.classList.add('show'), 50);
    const b = document.getElementById('content-scroll'); b.scrollTop = b.scrollHeight;
}
