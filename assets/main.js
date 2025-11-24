// assets/main.js - V18.2 FINAL STABLE

// --- 全局变量 ---
let db, auth, user;
let myProfile = null;      // 玩家档案
let currentRoomId = null;  // 当前房间号
let currentData = null;    // 当前回合的剧情数据
let currentStage = 0;      // 阅读阶段: 0=环境, 1=事件, 2=分析
let preBuffer = { A: null, B: null }; // 预加载缓存

// ============================================================
// 1. 初始化与鉴权 (Init & Auth)
// ============================================================

window.initApp = function() {
    const cfgInput = document.getElementById('config-input');
    const cfgStr = cfgInput.value.trim();
    const btn = document.querySelector('button[onclick="initApp()"]');
    
    if(!cfgStr) return alert("错误：请粘贴 Firebase 配置代码");
    
    btn.innerText = "正在解析...";
    btn.disabled = true;
    
    try {
        // --- 增强解析逻辑 ---
        let clean = cfgStr;
        
        // 1. 移除 const firebaseConfig = 等前缀
        clean = clean.replace(/^(const|var|let)\s+\w+\s*=\s*/, '');
        
        // 2. 提取最外层的 { ... }
        const firstBrace = clean.indexOf('{');
        const lastBrace = clean.lastIndexOf('}');
        
        if (firstBrace !== -1 && lastBrace !== -1) {
            clean = clean.substring(firstBrace, lastBrace + 1);
        } else {
            // 如果用户只粘贴了内容没粘贴括号，尝试包一层
            if (!clean.trim().startsWith('{')) clean = '{' + clean + '}';
        }

        // 3. 移除注释 (//...)
        clean = clean.replace(/\/\/.*$/mg, '');
        
        // 4. 尝试解析 (使用 Function 构造器以兼容非标准 JSON 格式)
        const config = new Function("return " + clean)();
        
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
            loadCharacter(); // 下一步：加载角色
            
            // 尝试启动特效
            if (window.initParticles) window.initParticles();
            
        }).catch(e => {
            console.error("Firebase Auth Error:", e);
            alert("登录失败: " + e.message + "\n请检查网络连接。");
            btn.innerText = "初始化 (INIT)";
            btn.disabled = false;
        });

    } catch(e) {
        console.error("Config Parse Error:", e);
        alert("配置解析错误: " + e.message + "\n请确保复制了完整的配置代码。");
        btn.innerText = "初始化 (INIT)";
        btn.disabled = false;
    }
}

// ============================================================
// 2. 角色系统 (Character System)
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
        alert("数据库连接失败: " + e.message);
        if(btn) btn.disabled = false;
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
    // 填充身份卡
    document.getElementById('card-name').innerText = myProfile.name;
    document.getElementById('card-role').innerText = myProfile.role;
    
    // 切换界面
    document.getElementById('step-config').classList.add('hidden');
    document.getElementById('step-lobby').classList.remove('hidden');
    
    // 监听房间列表
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
            // 过滤旧数据
            if(!r.host_info) return;
            
            const item = document.createElement('div');
            item.className = 'room-item';
            
            // 状态颜色
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
// 3. 游戏连接与操作 (Game Actions)
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
    // 先切界面监听
    startTransition();
    
    // 后台触发生成
    fetch('/api/game', { 
        method: 'POST', 
        headers: {'Content-Type': 'application/json'}, 
        body: JSON.stringify({ action: 'START_GAME', roomId: currentRoomId, userId: user.uid }) 
    });
}

// ============================================================
// 4. 渲染与交互 (Render & Interact)
// ============================================================

function startTransition() {
    document.getElementById('modal').style.display = 'none';
    
    // 确保 Intro 函数存在
    if (window.playIntroSequence) {
        window.playIntroSequence().then(setupGameUI);
    } else {
        setupGameUI(); // 如果没有动画文件，直接开始
    }
}

function setupGameUI() {
    const term = document.getElementById('terminal');
    term.style.visibility = 'visible'; 
    term.style.opacity = 1;
    
    // HUD 更新
    document.getElementById('hud-room').innerText = currentRoomId;
    document.getElementById('hud-hp').innerText = myProfile.public.hp;
    // 安全获取隐藏物品
    const hiddenItem = (myProfile.private && myProfile.private.hidden_items) ? myProfile.private.hidden_items[0] : "无";
    document.getElementById('hud-item-disp').innerText = "物品: " + hiddenItem;

    // 监听剧情 (罗生门视角)
    db.ref(`rooms/${currentRoomId}/current_scene`).on('value', snapshot => {
        const data = snapshot.val();
        if(data) {
            // ★★★ 核心修复：安全获取数据 ★★★
            // 先尝试拿 user.uid 的数据，拿不到就拿 Object.values 的第一个（保底）
            const myData = data[user.uid] || Object.values(data)[0];
            if (myData) renderScene(myData);
        }
    });
}

function renderScene(data) {
    document.getElementById('wait-overlay').classList.add('hidden');
    currentData = data; 
    currentStage = 0;

    document.getElementById('story-box').innerHTML = "";
    document.getElementById('controls').classList.remove('active');
    document.getElementById('next-trigger').style.display = 'none';
    
    // 图片加载
    const rawKw = data.image_keyword || "cyberpunk";
    const kw = rawKw.split(' ')[0].replace(/[^a-zA-Z0-9]/g,"");
    // 添加时间戳防止缓存
    const url = `https://loremflickr.com/640/360/cyberpunk,${kw}?random=${Date.now()}`;
    
    const img = document.getElementById('scene-img'); 
    img.style.opacity=0; 
    img.src=url;
    img.onload = () => { 
        img.style.opacity=0.8; 
        document.getElementById('loading-hint').innerText = "LIVE"; 
    };

    // 文字段落 1
    const txt1 = data.stage_1_env || "[数据流干扰...]";
    addMsg(txt1, 'var(--neon-cyan)');
    
    // 延迟显示点击按钮
    setTimeout(() => { 
        document.getElementById('next-trigger').style.display = 'block'; 
    }, 1000);
}

window.advanceFragment = function() {
    document.getElementById('next-trigger').style.display = 'none';
    
    // 保护逻辑：如果数据没加载好，不允许点
    if (!currentData) return;

    if (currentStage === 0) {
        currentStage = 1;
        addMsg(currentData.stage_2_event || "...", 'var(--neon-pink)');
        setTimeout(() => document.getElementById('next-trigger').style.display = 'block', 1000);
    } else if (currentStage === 1) {
        currentStage = 2;
        addMsg(currentData.stage_3_analysis || "...", 'var(--neon-yellow)');
        
        // 按钮文字
        const tA = currentData.choices?.[0]?.text || "行动 A";
        const tB = currentData.choices?.[1]?.text || "行动 B";
        document.getElementById('btn-a').innerText = `[A] ${tA}`;
        document.getElementById('btn-b').innerText = `[B] ${tB}`;
        
        document.getElementById('controls').classList.add('active');
        
        // 滚动到底部
        const b = document.getElementById('content-scroll'); 
        b.scrollTop = b.scrollHeight;
    }
}

window.makeChoice = async function(text) {
    // 锁屏
    document.getElementById('wait-overlay').classList.remove('hidden');
    
    const choiceText = (text === 'A') ? currentData.choices[0].text : currentData.choices[1].text;
    try {
        await fetch('/api/game', { 
            method: 'POST', 
            headers: {'Content-Type': 'application/json'}, 
            body: JSON.stringify({ action: 'MAKE_MOVE', roomId: currentRoomId, userId: user.uid, choiceText: choiceText }) 
        });
    } catch(e) { 
        document.getElementById('wait-overlay').classList.add('hidden'); 
        alert("提交失败，请重试");
    }
}

function addMsg(txt, color) {
    if(!txt) return;
    
    const d = document.createElement('div'); 
    d.className="msg-block"; 
    d.style.borderLeftColor=color; 
    // 先不填字，为了打字机效果
    document.getElementById('story-box').appendChild(d); 
    setTimeout(()=>d.classList.add('show'), 50);
    
    // 打字机效果
    let i=0;
    function type() {
        if(i < txt.length) { 
            d.innerHTML += txt.charAt(i); 
            i++; 
            document.getElementById('content-scroll').scrollTop = document.getElementById('content-scroll').scrollHeight;
            setTimeout(type, 15); 
        }
    }
    type();
}
