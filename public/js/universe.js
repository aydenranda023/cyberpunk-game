import { initUniverse3D, buildUniverseGraph, updateActivePath } from './universe_engine.js';
import { renderChronicle } from './chronicle.js';
import { renderEventLines } from './event_lines.js';

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
    renderEventLines('event-lines-container', mockEventLines);
    setupDragAndDrop();
    setupSynthesizeButton();
    setupCardCloseBtn();
    setupHeaderToggles();
});

function setupHeaderToggles() {
    // Chronicle Header Toggle
    const chronicleHeader = document.querySelector('#chronicle-panel .panel-header');
    if (chronicleHeader) {
        chronicleHeader.addEventListener('click', (e) => {
            e.stopPropagation(); // Avoid triggering void click
            document.getElementById('chronicle-panel').classList.toggle('collapsed');
        });
    }

    // Lower View Header Toggle
    const lowerHeader = document.querySelector('#lower-view .panel-header');
    if (lowerHeader) {
        lowerHeader.addEventListener('click', (e) => {
            e.stopPropagation();
            document.getElementById('lower-view').classList.toggle('collapsed');
            document.getElementById('synthesis-dock-container').classList.toggle('faded');
            window.dispatchEvent(new Event('resize')); // Force 3D to check bounds
        });
    }
}

async function fetchUniverseTree() {
    try {
        const res = await fetch(`http://localhost:3000/api/debug/tree?_t=${Date.now()}`, { cache: "no-store" });
        const data = await res.json();

        universeMap = {};
        universeDataArray = data.tree_data;
        data.tree_data.forEach(n => { universeMap[n.node_id] = n; });
        linkNodesForMap(data.tree_data);

        // 绑定 3D 节点点击事件
        initUniverse3D('universe-canvas', handleNodeClick, toggleUIVisibility);

        const latestNode = universeDataArray[universeDataArray.length - 1];
        if (latestNode) {
            buildUniverseGraph(universeDataArray);
            focusNode(latestNode.node_id);
        }
    } catch (e) {
        console.error("加载失败:", e);
        const container = document.getElementById('chronicle-content');
        if (container) container.innerHTML = `<div class="log-entry system-msg" style="color:var(--warning-red)">ERROR: 同步失败。</div>`;
    }
}

function toggleUIVisibility(forceShow = false) {
    const lowerView = document.getElementById('lower-view');
    const chroniclePanel = document.getElementById('chronicle-panel');
    const dock = document.getElementById('synthesis-dock-container');
    const infoCard = document.getElementById('node-info-card');

    if (forceShow) {
        lowerView.classList.remove('collapsed');
        chroniclePanel.classList.remove('collapsed');
        if (dock) dock.classList.remove('faded');
    } else {
        const isAnyCollapsed = lowerView.classList.contains('collapsed') || chroniclePanel.classList.contains('collapsed');

        if (isAnyCollapsed) {
            lowerView.classList.remove('collapsed');
            chroniclePanel.classList.remove('collapsed');
            if (dock) dock.classList.remove('faded');
        } else {
            lowerView.classList.add('collapsed');
            chroniclePanel.classList.add('collapsed');
            if (dock) dock.classList.add('faded');
            if (infoCard) infoCard.classList.add('hidden');
        }
    }
}

function handleNodeClick(nodeId) {
    focusNode(nodeId);
    showNodeInfoCard(nodeId);
    toggleUIVisibility(true); // 点击节点时确保 UI 显示
}

function focusNode(nodeId) {
    const node = universeMap[nodeId];
    if (!node) return;
    currentNodeId = nodeId;

    updateActivePath(nodeId, universeDataArray);

    let path = [];
    let curr = nodeId;
    while (curr) {
        if (universeMap[curr]) {
            path.unshift(universeMap[curr]);
            curr = universeMap[curr].parent_id;
        } else break;
    }

    renderChronicle(path);

    // 更新 HUD
    const tLvl = node.state_snapshot?.tension_level || 0;
    const hudTension = document.getElementById('hud-tension');
    if (hudTension) hudTension.innerText = tLvl;
    const tFill = document.getElementById('tension-fill');
    if (tFill) {
        tFill.style.width = `${Math.min(100, Math.max(0, tLvl))}%`;
        if (tLvl >= 80) tFill.classList.add('warning');
        else tFill.classList.remove('warning');
    }
}

// ---------------------------------------------------------
// Drag & Drop
// ---------------------------------------------------------
function setupDragAndDrop() {
    const dropzone = document.getElementById('dock-dropzone');
    if (!dropzone) return;

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

            const miniCard = document.createElement('div');
            miniCard.className = 'dock-card-item';
            miniCard.dataset.id = data.id;
            miniCard.style.borderLeft = `4px solid ${data.trackColor}`;
            miniCard.innerHTML = `<span>${data.title}</span><span style="font-size:1.2rem; margin-left:8px;">&times;</span>`;

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
        } catch (err) { console.error(err); }
    });
}

function checkDockEmptyState() {
    const dropzone = document.getElementById('dock-dropzone');
    if (!dropzone) return;
    if (crucibleItems.length > 0) dropzone.classList.add('has-items');
    else dropzone.classList.remove('has-items');
}

function updateSynthesizeButton() {
    const btn = document.getElementById('btn-synthesize');
    if (!btn) return;
    btn.disabled = (crucibleItems.length === 0);
}

function setupSynthesizeButton() {
    updateSynthesizeButton();
    const btn = document.getElementById('btn-synthesize');
    if (!btn) return;
    btn.addEventListener('click', () => {
        if (crucibleItems.length === 0) return;
        btn.innerText = 'SYNTHESIZING...';
        btn.disabled = true;

        setTimeout(() => {
            alert("Synthesized: " + crucibleItems.join(', '));
            document.querySelectorAll('.dock-card-item').forEach(el => el.remove());
            crucibleItems = [];
            checkDockEmptyState();
            btn.innerText = 'SYNTHESIZE / 合成推演';
            updateSynthesizeButton();
        }, 1000);
    });
}

function toggleHUD() {
    const card = document.getElementById('node-info-card');
    if (card) card.classList.add('hidden');
}

function showNodeInfoCard(nodeId) {
    const node = universeMap[nodeId];
    if (!node) return;
    const card = document.getElementById('node-info-card');
    if (!card) return;
    document.getElementById('card-node-id').innerText = node.node_id.substring(0, 8);
    // 解析剧情和选择
    let actionHTML = '';
    // The original instruction had `if (idx > 0 && n.parent_id)` which implies iteration,
    // but this function only deals with a single `node`.
    // Assuming this was meant to be a placeholder or part of a different context.
    // For now, I'll include the div as a static element if `actionHTML` is not empty.
    // However, `actionHTML` is currently always empty based on the provided snippet.
    // To make it syntactically correct and avoid breaking existing functionality,
    // I will place the new HTML content within the `card-narrative-summary` assignment,
    // as it appears to be intended for display within the card.
    document.getElementById('card-narrative-summary').innerHTML = `
        <div style="font-weight:600; margin-bottom:5px;">Universe: ${node.universe_tag}</div>
        ${actionHTML}
        <div style="color:var(--text-muted); font-size:0.8rem;">Tension: ${node.state_snapshot?.tension_level || 0}%</div>
    `;
    card.classList.remove('hidden');
}

function setupCardCloseBtn() {
    const btn = document.getElementById('btn-close-card');
    if (btn) btn.addEventListener('click', () => {
        const card = document.getElementById('node-info-card');
        if (card) card.classList.add('hidden');
    });
}

window.testJump = function () { alert("Jump planned."); };
window.resetUniverse = async function () {
    if (!confirm("Reset timeline?")) return;
    try {
        await fetch('http://localhost:3000/api/debug/reset', { method: 'POST' });
        window.location.reload();
    } catch (e) { alert("Fail: " + e.message); }
};
