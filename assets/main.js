// assets/main.js - V18.3 PARSER FIX

// --- 全局变量 ---
let db, auth, user;
let myProfile = null;
let currentRoomId = null;
let currentData = null;
let currentStage = 0;
let preBuffer = { A: null, B: null };

// ============================================================
// 1. 初始化与鉴权 (增强解析版)
// ============================================================

window.initApp = function() {
    const cfgInput = document.getElementById('config-input');
    const cfgStr = cfgInput.value.trim();
    const btn = document.querySelector('button[onclick="initApp()"]');
    
    if(!cfgStr) return alert("错误：请粘贴 Firebase 配置代码");
    
    btn.innerText = "正在解析...";
    btn.disabled = true;
    
    try {
        let cleanStr = cfgStr;

        // 1. 【清洗】如果你不小心复制了HTML标签，去掉它们
        cleanStr = cleanStr.replace(/<script.*?>/gi, '').replace(/<\/script>/gi, '');

        // 2. 【提取】只找第一个 '{' 和最后一个 '}' 中间的内容
        const firstOpen = cleanStr.indexOf('{');
        const lastClose = cleanStr.lastIndexOf('}');

        if (firstOpen === -1 || lastClose === -1) {
            throw new Error("无法识别配置格式。请确保你复制了包含 { ... } 的代码块。");
        }

        cleanStr = cleanStr.substring(firstOpen, lastClose + 1);

        // 3. 【去噪】移除代码中的注释 (// 及其后面的文字)
        cleanStr = cleanStr.replace(/\/\/.*$/mg, '');

        // 4. 【解析】使用 Function 构造器解析 JS 对象
        // console.log("Parsed Config String:", cleanStr); // 调试用
        const config = new Function("return " + cleanStr)();
        
        // --- Firebase 连接 ---
        btn.innerText = "连接云端...";
        
        if (!firebase.apps.length) {
            firebase.initializeApp(config);
        }
        auth = firebase.auth();
        db = firebase.database();
        
        auth.signInAnonymously().then(u => {
            user = u.user;
            console.log("登录成功 UID:", user.uid);
            loadCharacter(); 
            if (window.initParticles) window.initParticles();
        }).catch(e => {
            console.error("Auth Error:", e);
            alert("登录失败: " + e.message + "\n请检查网络。");
            btn.innerText = "初始化 (INIT)";
            btn.disabled = false;
        });

    } catch(e) {
        console.error("Config Parse Error:", e);
        alert("配置代码解析失败:\n" + e.message + "\n\n建议：只复制 const firebaseConfig = { ... } 这一段，不要复制 script 标签。");
        btn.innerText = "初始化 (INIT)";
        btn.disabled = false;
    }
}

// ============================================================
// 2. 角色系统
// ============================================================

function loadCharacter() {
    const btn = document.querySelector('button[onclick="initApp()"]');
    if(btn) btn.innerText = "读取档案...";
    
    db.ref('users/' + user.uid).once('value', s => {
        const val = s.val();
        if (val && val.profile) { 
            myProfile = val.profile; 
            renderLobby(); 
        } else { 
            createNewCharacter(); 
        }
    }).catch(e => {
        alert("数据库读取失败: " + e.message);
        if(btn) { btn.innerText = "初始化 (INIT)"; btn.disabled = false; }
    });
}

function createNewCharacter() {
    const roles = [
        { id: "Solo", label: "街头佣兵", hp: 120, items: ["突击步枪", "兴奋剂"], secret: "被荒坂通缉" },
        { id: "Netrunner", label: "网络黑客", hp: 80, items: ["黑客接入仓", "病毒芯片"], secret: "脑数据损坏" },
        { id: "Doc", label: "义体医生", hp: 90, items: ["急救针", "麻醉剂"], secret: "黑市贩卖器官" },
        { id: "Corp", label: "公司特工", hp: 100, items: ["消音手枪", "身份卡"], secret: "双重间谍" }
    ];
    const prefixes = ["流浪", "荒坂", "军用", "街头", "夜之城", "暴恐"];
    const names = ["V", "强尼", "杰克", "露西", "K", "大卫", "罗格"];
    
    const r = roles[Math.floor(Math.random() * roles.length)];
    const name = prefixes[Math.floor(Math.random()*prefixes.length)] + "·" + names[Math.floor(Math.random()*names.length)] + "_" + Math.floor(Math.random()*99);
    
    myProfile = { 
        name: name, 
        role: r.label, 
        public: { hp: r.hp, weapon: r.items[0] }, 
        private: { secret: r.secret, hidden_items: r.items } 
    };
    
    db.ref('users/' + user.uid).set({ 
        profile: myProfile,
        created_at: firebase.database.ServerValue.TIMESTAMP
    });
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
        
        if(!rooms) { 
            div.innerHTML = "<div style='padding:20px;color:#444;text-align:center'>暂无信号</div>"; 
            return; 
        }
        
        Object.keys(rooms).reverse().forEach(rid => {
            const r = rooms[rid];
            if(!r.host_info) return;
            
            const item = document.createElement('div');
            item.className = 'room-item';
            let statusColor = r.status === 'SOLO' ? 'var(--neon-green)' : 'var(--neon-yellow)';
            let playerCount = r.players ? Object.keys(r.players).length : 0;

            item.innerHTML = `
                <div>
                    <div style="color:var(--neon-cyan); font-weight:bold">[${r.host_info.role}] ${r.host_info.name}</div>
                    <div style="color:#666; font-size:0.8rem">ID: ${rid} | <span style="color:${statusColor}">${r.status}</span> (${playerCount}人)</div>
                </div>
                <div style="color:var(--neon-cyan); align-self:center; font-size:1.2rem">»</div>
            `;
            item.onclick = () => window.joinGame(rid);
            div.appendChild(item);
        });
    });
}

window.deleteCharacter = function() {
    if(confirm("警告：这将永久删除你的当前角色档案。确定吗？")) {
        db.ref('users/'+user.uid).remove().then(()=>location.reload());
    }
}

// ============================================================
// 3. 游戏操作
// ============================================================

window.createSoloGame = async function() {
    const btn = document.querySelector('button[onclick="createSoloGame()"]');
    btn.innerText = "建立中..."; btn.disabled = true;
    try {
        const res = await fetch('/api/game', { 
            method: 'POST', 
            headers: {'Content-Type': 'application/json'}, 
            body: JSON.stringify({ action: 'CREATE_ROOM', userProfile: myProfile }) 
        });
        const data = await res.json();
        if(data.error) throw new Error(data.error);
        
        currentRoomId = data.roomId;
        await fetch('/api/game', { 
            method: 'POST', 
            headers: {'Content-Type': 'application/json'}, 
            body: JSON.stringify({ action: 'JOIN_ROOM', roomId: currentRoomId, userId: user.uid, userProfile: myProfile }) 
        });
        enterWaitingRoom();
    } catch(e) { 
        alert("创建失败: " + e.message);
        btn.innerText = "开启单人位面"; btn.disabled = false;
    }
}

window.joinGame = async function(rid) {
    const ridVal = rid || document.getElementById('room-input').value;
    if(!ridVal) return alert("请输入 ID");
    try {
        const res = await fetch('/api/game', { 
            method: 'POST', 
            headers: {'Content-Type': 'application/json'}, 
            body: JSON.stringify({ action: 'JOIN_ROOM', roomId: ridVal, userId: user.uid, userProfile: myProfile }) 
        });
        if(res.ok) { 
            currentRoomId = ridVal; 
            startTransition(); 
        } else {
            const data = await res.json();
            alert("加入失败: " + (data.error || "未知错误"));
        }
    } catch(e) { alert("网络请求失败"); }
}

function enterWaitingRoom() {
    document.getElementById('step-lobby').classList.add('hidden');
    document.getElementById('step-waiting').classList.remove('hidden');
    document.getElementById('room-code-disp').innerText = currentRoomId;
    db.ref(`rooms/${currentRoomId}/players`).on('value', s => { 
        document.getElementById('player-count').innerText = `连接数: ${s.numChildren()}`; 
    });
}

window.firstStart = async function() {
    startTransition();
    fetch('/api/game', { 
        method: 'POST', 
        headers: {'Content-Type': 'application/json'}, 
        body: JSON.stringify({ action: 'START_GAME', roomId: currentRoomId, userId: user.uid }) 
    });
}

// ============================================================
// 4. 渲染与交互
// ============================================================

function startTransition() {
    document.getElementById('modal').style.display = 'none';
    if (window.playIntroSequence) {
        window.playIntroSequence().then(setupGameUI);
    } else { setupGameUI(); }
}

function setupGameUI() {
    const term = document.getElementById('terminal');
    term.style.visibility = 'visible'; term.style.opacity = 1;
    document.getElementById('hud-room').innerText = currentRoomId;
    document.getElementById('hud-hp').innerText = myProfile.public.hp;
    const hiddenItem = (myProfile.private && myProfile.private.hidden_items) ? myProfile.private.hidden_items[0] : "无";
    document.getElementById('hud-item-disp').innerText = "物品: " + hiddenItem;

    db.ref(`rooms/${currentRoomId}/current_scene`).on('value', snapshot => {
        const data = snapshot.val();
        if(data) {
            // 容错：先找自己的ID，找不到找P0/P1，还找不到找values第一个
            const myData = data[user.uid] || data["P0"] || Object.values(data)[0];
            if (myData) renderScene(myData);
        }
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

    // 容错：如果没文字，给个默认
    const txt1 = data.stage_1_env || (data.txt_1 ? data.txt_1 : "[信号连接中...]");
    addMsg(txt1, 'var(--neon-cyan)');
    setTimeout(() => { document.getElementById('next-trigger').style.display = 'block'; }, 1000);
}

window.advanceFragment = function() {
    document.getElementById('next-trigger').style.display = 'none';
    if (currentStage === 0) {
        currentStage = 1;
        // 兼容旧格式
        const txt = currentData.stage_2_event || currentData.txt_2 || "...";
        addMsg(txt, 'var(--neon-pink)');
        setTimeout(() => document.getElementById('next-trigger').style.display = 'block', 1000);
    } else if (currentStage === 1) {
        currentStage = 2;
        const txt = currentData.stage_3_analysis || currentData.txt_3 || "...";
        addMsg(txt, 'var(--neon-yellow)');
        
        const tA = currentData.choices?.[0]?.text || "行动 A";
        const tB = currentData.choices?.[1]?.text || "行动 B";
        document.getElementById('btn-a').innerText = `[A] ${tA}`;
        document.getElementById('btn-b').innerText = `[B] ${tB}`;
        document.getElementById('controls').classList.add('active');
        const b = document.getElementById('content-scroll'); b.scrollTop = b.scrollHeight;
    }
}

window.makeChoice = async function(text) {
    document.getElementById('wait-overlay').classList.remove('hidden');
    const choiceText = (text === 'A') ? currentData.choices[0].text : currentData.choices[1].text;
    try {
        await fetch('/api/game', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ action: 'MAKE_MOVE', roomId: currentRoomId, userId: user.uid, choiceText: choiceText }) });
    } catch(e) { document.getElementById('wait-overlay').classList.add('hidden'); alert("发送失败"); }
}

function addMsg(txt, color) {
    const d = document.createElement('div'); d.className="msg-block"; d.style.borderLeftColor=color;
    document.getElementById('story-box').appendChild(d);
    let i=0;
    function type() {
        if(i < txt.length) { d.innerHTML += txt.charAt(i); i++; document.getElementById('content-scroll').scrollTop = 9999; setTimeout(type, 15); }
        else { d.classList.add('show'); }
    }
    type();
}
