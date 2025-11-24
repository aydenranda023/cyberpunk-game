// Global State
let db, auth, user, myProfile = null;
let currentRoomId = null;
let currentData = null;
let currentStage = 0;

// --- 1. INIT (Robust Config Parser) ---
window.initApp = function() {
    const cfgInput = document.getElementById('config-input');
    const btn = document.querySelector('button[onclick="initApp()"]');
    const cfgStr = cfgInput.value.trim();
    
    if(!cfgStr) return alert("请粘贴配置");
    btn.innerText = "解析中..."; btn.disabled = true;

    try {
        // ★★★ 强力解析修复 ★★★
        // 1. 提取 {} 内容
        let clean = cfgStr;
        const start = clean.indexOf('{');
        const end = clean.lastIndexOf('}');
        
        if(start === -1 || end === -1) throw new Error("找不到 { } 包裹的配置对象");
        
        clean = clean.substring(start, end + 1);
        // 2. 去除注释
        clean = clean.replace(/\/\/.*$/mg, '');
        // 3. 解析为对象
        const config = new Function("return " + clean)();

        if(!firebase.apps.length) firebase.initializeApp(config);
        auth = firebase.auth();
        db = firebase.database();

        auth.signInAnonymously().then(u => {
            user = u.user;
            loadCharacter();
            if(window.initParticles) window.initParticles();
        }).catch(e => {
            alert("登录失败: " + e.message);
            btn.disabled = false; btn.innerText = "初始化";
        });

    } catch(e) {
        alert("配置解析错误: " + e.message + "\n请只复制 const firebaseConfig = {...} 这一段");
        btn.disabled = false; btn.innerText = "初始化";
    }
}

// --- 2. CHARACTER ---
function loadCharacter() {
    db.ref('users/' + user.uid).once('value', s => {
        const val = s.val();
        if (val && val.profile) { myProfile = val.profile; renderLobby(); }
        else { createNewCharacter(); }
    });
}

function createNewCharacter() {
    const roles = [{id:"Solo",label:"佣兵"},{id:"Netrunner",label:"黑客"},{id:"Doc",label:"医生"}];
    const r = roles[Math.floor(Math.random()*roles.length)];
    const name = ["V", "强尼", "杰克", "露西", "K"][Math.floor(Math.random()*5)] + "_" + Math.floor(Math.random()*99);
    
    myProfile = { name: name, role: r.label, public: { hp: 100 }, private: { secret: "..." } };
    db.ref('users/' + user.uid).set({ profile: myProfile });
    renderLobby();
}

function renderLobby() {
    document.getElementById('card-name').innerText = myProfile.name;
    document.getElementById('card-role').innerText = myProfile.role;
    document.getElementById('step-config').classList.add('hidden');
    document.getElementById('step-lobby').classList.remove('hidden');
    
    db.ref('rooms').limitToLast(10).on('value', s => {
        const div = document.getElementById('room-list-container');
        div.innerHTML = "";
        const rooms = s.val();
        if(!rooms) { div.innerHTML = "<div style='padding:20px;color:#444'>暂无信号</div>"; return; }
        
        Object.keys(rooms).reverse().forEach(rid => {
            const r = rooms[rid];
            if(!r.host_info) return;
            const item = document.createElement('div');
            item.className = 'room-item';
            item.innerHTML = `<span style="color:var(--neon-cyan)">[${r.host_info.role}] ${r.host_info.name}</span> <span>接入 ></span>`;
            item.onclick = () => joinGame(rid);
            div.appendChild(item);
        });
    });
}

window.deleteCharacter = function() {
    if(confirm("重置?")) db.ref('users/'+user.uid).remove().then(()=>location.reload());
}

// --- 3. ACTIONS ---
window.createSoloGame = async function() {
    try {
        const res = await fetch('/api/game', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ action: 'CREATE_ROOM', userProfile: myProfile }) });
        const data = await res.json();
        currentRoomId = data.roomId;
        await fetch('/api/game', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ action: 'JOIN_ROOM', roomId: currentRoomId, userId: user.uid, userProfile: myProfile }) });
        enterWaiting();
    } catch(e) { alert(e.message); }
}

window.joinGame = async function(rid) {
    const ridVal = rid || document.getElementById('room-input').value;
    try {
        const res = await fetch('/api/game', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ action: 'JOIN_ROOM', roomId: ridVal, userId: user.uid, userProfile: myProfile }) });
        if(res.ok) { currentRoomId = ridVal; startTransition(); } else alert("无法加入");
    } catch(e) { alert("ERR"); }
}

function enterWaiting() {
    document.getElementById('step-lobby').classList.add('hidden');
    document.getElementById('step-waiting').classList.remove('hidden');
    document.getElementById('room-code-disp').innerText = currentRoomId;
    db.ref(`rooms/${currentRoomId}/players`).on('value', s => { document.getElementById('player-count').innerText = `连接数: ${s.numChildren()}`; });
}

window.firstStart = async function() {
    startTransition();
    fetch('/api/game', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ action: 'START_GAME', roomId: currentRoomId, userId: user.uid }) });
}

// --- 4. GAMEPLAY ---
function startTransition() {
    document.getElementById('modal').style.display = 'none';
    window.playIntroSequence().then(() => {
        const term = document.getElementById('terminal');
        term.style.visibility = 'visible'; term.style.opacity = 1;
        document.getElementById('hud-room').innerText = currentRoomId;
        document.getElementById('hud-hp').innerText = myProfile.public.hp;

        db.ref(`rooms/${currentRoomId}/current_scene`).on('value', snapshot => {
            const data = snapshot.val();
            if(data) {
                // ★★★ 容错获取数据 ★★★
                const myData = data[user.uid] || Object.values(data)[0];
                if(myData) renderScene(myData);
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

    const txt = data.stage_1_env || "连接中...";
    addMsg(txt, 'var(--neon-cyan)');
    setTimeout(() => { document.getElementById('next-trigger').style.display = 'block'; }, 1000);
}

window.advanceFragment = function() {
    document.getElementById('next-trigger').style.display = 'none';
    if (currentStage === 0) {
        currentStage = 1;
        addMsg(currentData.stage_2_event || "...", 'var(--neon-pink)');
        setTimeout(() => document.getElementById('next-trigger').style.display = 'block', 1000);
    } else if (currentStage === 1) {
        currentStage = 2;
        addMsg(currentData.stage_3_analysis || "...", 'var(--neon-yellow)');
        document.getElementById('btn-a').innerText = `[A] ${currentData.choices?.[0]?.text || "A"}`;
        document.getElementById('btn-b').innerText = `[B] ${currentData.choices?.[1]?.text || "B"}`;
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
    const d = document.createElement('div'); d.className="msg-block"; d.style.borderLeftColor=color; 
    document.getElementById('story-box').appendChild(d);
    
    // 打字机
    let i = 0;
    function type() {
        if (i < txt.length) {
            d.innerHTML += txt.charAt(i); i++;
            document.getElementById('content-scroll').scrollTop = 9999;
            setTimeout(type, 15);
        } else { d.classList.add('show'); }
    }
    type();
}
