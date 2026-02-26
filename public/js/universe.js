import { initUniverse3D, buildUniverseGraph, highlightNode, updateActivePath } from './universe_engine.js';

let universeMap = {};
let universeDataArray = [];
let currentNodeId = null;
let crucibleItems = [];

// 模拟的 3 条 2D 地铁图数据
const mockEventLines = [
    {
        id: "track_v", name: "CHARACTER // 维（V）", color: "var(--track-char)",
        nodes: [
            { id: "e1", title: "记忆苏醒", timeX: 10 },
            { id: "e2", title: "遭遇伏击", timeX: 35 },
            { id: "e3", title: "义体过载", timeX: 70 }
        ]
    },
    {
        id: "track_arasaka", name: "LOCATION // 荒坂塔废墟", color: "var(--track-loc)",
        nodes: [
            { id: "e4", title: "底层封锁", timeX: 20 },
            { id: "e5", title: "数据泄露", timeX: 55 }
        ]
    },
    {
        id: "track_relic", name: "ITEM // 损坏的 Relic", color: "var(--track-item)",
        nodes: [
            { id: "e6", title: "获取芯片", timeX: 15 },
            { id: "e7", title: "防火墙崩溃", timeX: 50 },
            { id: "e8", title: "意识融合", timeX: 85 }
        ]
    }
];

function linkNodesForMap(nodes) {
    nodes.forEach(n => { n.children_ids = []; });
    nodes.forEach(n => {
        if (n.parent_id && universeMap[n.parent_id]) {
            universeMap[n.parent_id].children_ids.push(n.node_id);
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    fetchUniverseTree();
    renderEventLines();
    setupDragAndDrop();
    setupSynthesizeButton();
    setupCardCloseBtn();
});

async function fetchUniverseTree() {
    try {
        const res = await fetch(`http://localhost:3000/api/debug/tree?_t=${Date.now()}`, { cache: "no-store" });
        const data = await res.json();

        universeMap = {};
        universeDataArray = data.tree_data;
        data.tree_data.forEach(n => { universeMap[n.node_id] = n; });
        linkNodesForMap(data.tree_data);

        // 绑定 3D 节点点击事件：用于切换剧情主线
        initUniverse3D('universe-canvas', handleNodeClick, toggleHUD);

        const latestNode = universeDataArray[universeDataArray.length - 1];
        if (latestNode) {
            buildUniverseGraph(universeDataArray);
            focusNode(latestNode.node_id);
        } else {
            console.warn("Tree is empty!");
        }
    } catch (e) {
        console.error("加载宇宙树失败:", e);
        document.getElementById('chronicle-content').innerHTML = `<div class="log-entry system-msg" style="color:var(--warning-red)">ERROR: 无法链接主脑，请检查服务器网络。</div>`;
    }
}

// 点击 3D 节点切换“高亮命运主干”并更新日记
function handleNodeClick(nodeId) {
    focusNode(nodeId);
    showNodeInfoCard(nodeId); // 也保留一个浮动卡片便于快速查看张力
}

function focusNode(nodeId) {
    const node = universeMap[nodeId];
    if (!node) return;
    currentNodeId = nodeId;

    // 1. 调用 Engine 高亮该线并拉远摄像机
    updateActivePath(nodeId, universeDataArray);

    // 2. 爬取整个 active_path 并刷新到左侧的编年史 Chronicle Panel
    let path = [];
    let curr = nodeId;
    while (curr) {
        if (universeMap[curr]) {
            path.unshift(universeMap[curr]);
            curr = universeMap[curr].parent_id;
        } else break;
    }

    renderChronicle(path);

    // 3. 更新 HUD
    const tLvl = node.state_snapshot?.tension_level || 0;
    document.getElementById('hud-tension').innerText = tLvl;
    const tFill = document.getElementById('tension-fill');
    tFill.style.width = `${Math.min(100, Math.max(0, tLvl))}%`;
    if (tLvl >= 80) tFill.classList.add('warning');
    else tFill.classList.remove('warning');
}

function renderChronicle(nodePath) {
    const container = document.getElementById('chronicle-content');
    container.innerHTML = ''; // 清空

    nodePath.forEach((n, idx) => {
        const div = document.createElement('div');
        div.className = 'log-entry';

        // 解析剧情和选择
        let actionHTML = '';
        if (idx > 0 && n.parent_id) {
            actionHTML = `<div style="color:var(--accent-blue); font-size: 0.8em; margin-bottom: 6px;">&gt; 选择节点: ${n.universe_tag} 分支</div>`;
        }

        const text = (n.narrative_text || "无记录").replace(/\n/g, '<br>');

        div.innerHTML = `
            ${actionHTML}
            <div style="font-weight: 500;">${text}</div>
            <div style="font-size: 0.75em; color: var(--text-muted); margin-top: 8px; text-align: right;">ID: ${n.node_id.substring(0, 6)}</div>
        `;
        container.appendChild(div);
    });

    // 自动滚动到底部
    setTimeout(() => { container.scrollTop = container.scrollHeight; }, 100);
}

// 渲染底部的 2D 事件线
function renderEventLines() {
    const container = document.getElementById('event-lines-container');
    container.innerHTML = '';

    mockEventLines.forEach(track => {
        const trackDiv = document.createElement('div');
        trackDiv.className = 'event-track';

        // 轨道名称
        const label = document.createElement('div');
        label.className = 'track-label';
        label.innerText = track.name;

        // 实体线
        const line = document.createElement('div');
        line.className = 'track-line';
        line.style.background = track.color;

        trackDiv.appendChild(label);
        trackDiv.appendChild(line);

        // 生成节点胶囊
        track.nodes.forEach(n => {
            const capsule = document.createElement('div');
            capsule.className = 'capsule-node';
            capsule.draggable = true;
            capsule.style.borderColor = track.color;
            capsule.style.left = `${n.timeX}%`;

            // 存数据为了拖拽
            capsule.dataset.dragId = n.id;
            capsule.dataset.title = n.title;
            capsule.dataset.trackName = track.name;
            capsule.dataset.trackColor = track.color;

            capsule.innerHTML = `<span style="color:${track.color}; font-size:1.2em;">&bull;</span> ${n.title}`;

            // Drag Event
            capsule.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('application/json', JSON.stringify({
                    id: n.id, title: n.title, trackColor: track.color
                }));
                setTimeout(() => capsule.classList.add('dragging'), 0);
            });
            capsule.addEventListener('dragend', () => {
                capsule.classList.remove('dragging');
            });

            trackDiv.appendChild(capsule);
        });

        container.appendChild(trackDiv);
    });
}

// ---------------------------------------------------------
// Split-Screen Drag & Drop: 从下层拖入上层 Dock
// ---------------------------------------------------------
function setupDragAndDrop() {
    const dropzone = document.getElementById('dock-dropzone');

    dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('drag-over');
    });

    dropzone.addEventListener('dragleave', () => {
        dropzone.classList.remove('drag-over');
    });

    dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('drag-over');

        try {
            const dataStr = e.dataTransfer.getData('application/json');
            if (!dataStr) return;
            const data = JSON.parse(dataStr);

            if (crucibleItems.includes(data.id)) return;

            // 放入 Dock
            const miniCard = document.createElement('div');
            miniCard.className = 'dock-card-item';
            miniCard.dataset.id = data.id;
            // 采用对应轨道的颜色描边作区分
            miniCard.style.borderLeft = `4px solid ${data.trackColor}`;
            miniCard.innerHTML = `
                <span>${data.title}</span>
                <span style="color:var(--text-muted); font-size:1.2rem; margin-top:-2px">&times;</span>
            `;

            miniCard.addEventListener('click', () => {
                miniCard.remove();
                crucibleItems = crucibleItems.filter(i => i !== data.id);
                checkDockEmptyState();
                updateSynthesizeButton();
            });

            dropzone.appendChild(miniCard);
            crucibleItems.push(data.id);

            checkDockEmptyState();
            updateSynthesizeButton();
        } catch (err) {
            console.error(err);
        }
    });
}

function checkDockEmptyState() {
    const dropzone = document.getElementById('dock-dropzone');
    if (crucibleItems.length > 0) {
        dropzone.classList.add('has-items');
    } else {
        dropzone.classList.remove('has-items');
    }
}

function updateSynthesizeButton() {
    const btn = document.getElementById('btn-synthesize');
    if (crucibleItems.length > 0) {
        btn.disabled = false;
    } else {
        btn.disabled = true;
    }
}

function setupSynthesizeButton() {
    updateSynthesizeButton();
    const btn = document.getElementById('btn-synthesize');
    btn.addEventListener('click', () => {
        if (crucibleItems.length === 0) return;

        btn.innerText = 'SYNTHESIZING...';
        btn.disabled = true;

        // Mock Phase 1 Feedback
        setTimeout(() => {
            alert("Phase 1 Preview: 已读取 [" + crucibleItems.join(', ') + "] 交由顶层主脑引擎演算新宇宙分支！");

            // 清理 Dock
            document.querySelectorAll('.dock-card-item').forEach(el => el.remove());
            crucibleItems = [];
            checkDockEmptyState();

            btn.innerText = 'SYNTHESIZE / 合成推演';
            updateSynthesizeButton();
        }, 1000);
    });
}

function toggleHUD() {
    document.getElementById('node-info-card').classList.add('hidden');
}

function showNodeInfoCard(nodeId) {
    const node = universeMap[nodeId];
    if (!node) return;
    const card = document.getElementById('node-info-card');
    document.getElementById('card-node-id').innerText = node.node_id.substring(0, 8);
    document.getElementById('card-narrative-summary').innerHTML = `
        <div style="font-weight:600; margin-bottom:5px;">Universe: ${node.universe_tag}</div>
        <div style="color:var(--text-muted); font-size:0.8rem;">
            Tension: ${node.state_snapshot?.tension_level || 0}%
        </div>
    `;
    // 居中稍微偏移
    card.style.left = '40%';
    card.style.top = '30%';
    card.classList.remove('hidden');
}

function setupCardCloseBtn() {
    document.getElementById('btn-close-card').addEventListener('click', () => {
        document.getElementById('node-info-card').classList.add('hidden');
    });
}

window.testJump = function () { alert("跃迁功能联调中。"); };
window.resetUniverse = async function () {
    if (!confirm("警告：将抹除所有宇宙时间线并重置回原点，是否执行？")) return;
    try {
        await fetch('http://localhost:3000/api/debug/reset', { method: 'POST' });
        window.location.href = window.location.pathname + "?_t=" + Date.now();
    } catch (e) {
        alert("重置失败: " + e.message);
    }
};
