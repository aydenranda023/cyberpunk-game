import { initUniverse3D, buildUniverseGraph, appendNewNode, highlightNode } from './universe_engine.js';

// 存储获取到的整个宇宙树和当前聚焦的节点
let universeMap = {};
let currentNodeId = null;

// 根据后台历史数据重建树结构中：父子链接
function linkNodesForMap(nodes) {
    // 寻找每个节点的 "children"，这有助于我们在 UI 上判断这里到底发生过什么选择
    nodes.forEach(n => { n.children_ids = []; });
    nodes.forEach(n => {
        if (n.parent_id && universeMap[n.parent_id]) {
            universeMap[n.parent_id].children_ids.push(n.node_id);
        }
    });
}

// ==========================================
// 1. UI 交互与数据逻辑 (Tap-to-Play)
// ==========================================

async function fetchUniverseTree() {
    try {
        // 防止浏览器贪婪缓存 GET 请求导致重置后仍显示旧宇宙树
        const res = await fetch(`http://localhost:3000/api/debug/tree?_t=${Date.now()}`, { cache: "no-store" });
        const data = await res.json();

        universeMap = {};
        data.tree_data.forEach(n => { universeMap[n.node_id] = n; });
        linkNodesForMap(data.tree_data);

        const allNodes = Object.values(universeMap);
        const latestNode = allNodes[allNodes.length - 1];

        // 启动独立分离的 3D 引擎，点击节点时调用 handleNodeClick，点击虚空时调用 toggleHUD
        initUniverse3D('universe-canvas', handleNodeClick, toggleHUD);

        if (latestNode) {
            buildUniverseGraph(allNodes); // 批量构建点云树
            focusNode(latestNode.node_id, true);
        } else {
            console.warn("Tree is empty!");
        }
    } catch (e) {
        console.error("加载宇宙树失败:", e);
        document.getElementById('story-content').innerHTML = `<span style="color:red">ERROR: 无法链接主脑，请检查服务器网络。</span>`;
    }
}

// 处理点击 3D 空间中的节点
function handleNodeClick(nodeId) {
    if (currentNodeId === nodeId) return; // 重复点击
    // 用户要求：选中历史节点时也要镜头居中
    focusNode(nodeId, true);
}

// 聚焦到某个节点：更新 HUD 和 UI
function focusNode(nodeId, moveCamera = false) {
    const node = universeMap[nodeId];
    if (!node) return;

    currentNodeId = nodeId;

    // 1. 更新 Status HUD
    document.getElementById('hud-universe').innerText = node.universe_tag;
    document.getElementById('hud-hp').innerText = node.player_status?.hp || 100;

    const tLvl = node.state_snapshot?.tension_level || 0;
    document.getElementById('hud-tension').innerText = tLvl;
    const tFill = document.getElementById('tension-fill');
    tFill.style.width = `${Math.min(100, Math.max(0, tLvl))}%`;
    if (tLvl >= 80) {
        tFill.classList.add('warning');
        document.getElementById('hud-tension').style.color = "var(--warning-color)";
    } else {
        tFill.classList.remove('warning');
        document.getElementById('hud-tension').style.color = "var(--primary-glow)";
    }

    document.getElementById('hud-objective').innerText = node.state_snapshot?.current_objective || "生存";

    // 2. 更新剧情面板
    const content = document.getElementById('story-content');

    // 如果这个节点存在孩子，说明历史已经发生过选择分支
    // 我们找出究竟执行了哪个选择，将其高亮显示出来！
    let historyText = "";
    if (node.children_ids.length > 0) {
        const branches = node.children_ids.map(childId => universeMap[childId]);
        historyText = `<div style="margin-top: 20px; border-top: 1px solid rgba(0,229,255,0.3); padding-top: 10px;">`;
        historyText += `<p style="color: rgba(255,255,255,0.5); font-size:12px;">【观测到的时间线分叉】</p>`;

        branches.forEach(child => {
            // 这里我们没在子节点里记录当时传入的 player_action（Phase2 漏了这字段），
            // 如果以后后端存了 `child.player_action`，可以直接显示出来。
            // 现在只能用占位符或者它产生的剧情暗示
            historyText += `<p><span style="color: var(--primary-glow)">➡ 已走过的路径：领向节点 ${child.node_id.slice(-4)}</span></p>`;
        });
        historyText += `</div>`;
    }

    content.innerHTML = (node.narrative_text || "无记录").replace(/\n/g, '<br>') + historyText;
    document.getElementById('narrative-panel').scrollTop = document.getElementById('narrative-panel').scrollHeight;

    // 3. 渲染选项
    // 不管是最新节点还是历史节点，都展示该节点当时真实的 AI choices
    // 区别在于：如果他是历史节点，他触发的 action_type 会是 'branch' 以便开启新时间线
    let forceActionType = 'continue';
    if (node.children_ids && node.children_ids.length > 0) {
        forceActionType = 'branch'; // 这是一个历史节点，再次做决定意味着分叉
    }

    if (node.choices && node.choices.length > 0) {
        renderChoices(node.choices, forceActionType);
    } else {
        // Fallback 万一旧数据缺失，给玩家提供两个模拟动作以进行修复
        renderChoices([
            { text: "继续深入调查" },
            { text: "小心查探周边" }
        ], forceActionType);
    }

    // 4. 通知 Three.js 引擎只高亮，不一定锁镜头
    highlightNode(nodeId, moveCamera);
}

function renderChoices(choicesArr, forceActionType) {
    const container = document.getElementById('choices-container');
    container.innerHTML = '';

    choicesArr.forEach(choice => {
        const btn = document.createElement('button');
        btn.className = 'cyber-btn';
        btn.innerText = choice.text;

        // 使用传入的强制类型（取决于是不是历史节点）
        btn.onclick = () => submitAction(choice.text, forceActionType);
        container.appendChild(btn);
    });
}

// 玩家点击 Tap-to-Play 按钮提交指令
async function submitAction(actionText, actionType = 'continue', targetUniverse = null) {
    if (!actionText || !currentNodeId) return;

    const deck = document.getElementById('choices-container');
    deck.classList.add('hidden');
    document.getElementById('loading-indicator').classList.remove('hidden');

    try {
        const payload = {
            current_node_id: currentNodeId,
            player_action: actionText,
            action_type: actionType
        };
        if (targetUniverse) payload.target_universe = targetUniverse;

        const res = await fetch('http://localhost:3000/api/action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!res.ok) throw new Error("API 请求失败 " + res.status);
        const data = await res.json();

        if (data.success && data.node_created) {
            const newNode = data.node_created;
            // 更新本地数据关系
            universeMap[newNode.node_id] = newNode;
            if (!universeMap[currentNodeId].children_ids) universeMap[currentNodeId].children_ids = [];
            universeMap[currentNodeId].children_ids.push(newNode.node_id);
            newNode.children_ids = [];

            // 通知 3D 渲染器增加节点，附加上旧节点作维度差异判断
            appendNewNode(newNode, universeMap[currentNodeId]);

            // 聚焦到产生的新节点，并且要求摄像机锁定飞过去看特效！
            focusNode(newNode.node_id, true);
        }
    } catch (e) {
        console.error(e);
        alert("执行指令出错：" + e.message);
    } finally {
        document.getElementById('loading-indicator').classList.add('hidden');
        deck.classList.remove('hidden');
    }
}

// 暴露给跳跃按钮的测试方法
window.testJump = function () {
    const uni = prompt("请输入你想强行跳跃的宇宙维度 (例如: Medieval Fantasy, Wasteland):", "Wasteland");
    if (uni) {
        submitAction("我强行开启了传送枪跨越了宇宙边界！", "jump", uni);
    }
};

window.submitCustomAction = function () {
    const input = document.getElementById('action-input');
    if (input.value.trim()) {
        const actionType = (universeMap[currentNodeId]?.children_ids?.length > 0) ? 'branch' : 'continue';
        submitAction(input.value.trim(), actionType);
        input.value = '';
    }
};

window.resetUniverse = async function () {
    if (!confirm("警告：将抹除所有宇宙时间线并重置回原点，是否执行？")) return;
    try {
        await fetch('http://localhost:3000/api/debug/reset', { method: 'POST' });
        // 强制带时间戳刷新页面，避免 HTML 缓存
        window.location.href = window.location.pathname + "?_t=" + Date.now();
    } catch (e) {
        alert("重置失败: " + e.message);
    }
};

// 【沉浸态切换控制】
function toggleHUD() {
    const uiElements = [document.getElementById('narrative-panel'), document.getElementById('status-hud'), document.getElementById('action-deck'), document.getElementById('top-controls')];
    const isHidden = uiElements[0].style.opacity === '0';
    uiElements.forEach(el => {
        el.style.opacity = isHidden ? '1' : '0';
        el.style.pointerEvents = isHidden ? 'auto' : 'none';
    });
}


// ==========================================
// 启动
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    fetchUniverseTree();
});
