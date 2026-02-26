import { initUniverse3D, buildUniverseGraph, updateActivePath } from './universe_engine.js';
import { renderChronicle } from './chronicle.js';
import { renderEventLines } from './event_lines.js';

// Base API URL to support running the frontend via Live Server (port 5500) while the backend is on 3000
const API_BASE = window.location.port === '3000' || window.location.port === '' ? '' : 'http://localhost:3000';

let universeMap = {};
let universeDataArray = [];
let currentNodeId = null;
let crucibleItems = [];

// Dynamic event lines will be loaded from the server

function linkNodesForMap(nodes) {
    nodes.forEach(n => { n.children_ids = []; });
    nodes.forEach(n => {
        const parents = n.parent_ids || (n.parent_id ? [n.parent_id] : []);
        parents.forEach(pid => {
            if (universeMap[pid]) {
                if (!universeMap[pid].children_ids) universeMap[pid].children_ids = [];
                universeMap[pid].children_ids.push(n.node_id);
            }
        });
    });
}

document.addEventListener('DOMContentLoaded', () => {
    fetchUniverseTree();
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
        const res = await fetch(`${API_BASE}/api/debug/tree?_t=${Date.now()}`, { cache: "no-store" });
        const data = await res.json();

        universeMap = {};
        universeDataArray = data.tree_data;
        data.tree_data.forEach(n => { universeMap[n.node_id] = n; });
        linkNodesForMap(data.tree_data);

        // Render dynamic event lines from backend
        if (data.event_lines) {
            renderEventLines('event-lines-container', data.event_lines);
        }

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
    let visited = new Set();

    // BFS/DFS path discovery for multi-parent DAG
    function buildPath(id) {
        if (!id || visited.has(id)) return;
        visited.add(id);
        const n = universeMap[id];
        if (n) {
            path.unshift(n);
            const nextParents = n.parent_ids || (n.parent_id ? [n.parent_id] : []);
            if (nextParents.length > 0) buildPath(nextParents[0]); // Simple linear history for log
        }
    }
    buildPath(nodeId);

    renderChronicle(path, (id) => focusNode(id));

    // Update HUD and Event Lines (Dynamically from latest state)
    updateHUD(node);
}

function updateHUD(node) {
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
            // 如果该时间线已经有节点在合成釜中，需要替换掉旧的
            const existingTrackIndex = crucibleItems.findIndex(i => i.id === data.id);
            if (existingTrackIndex !== -1) {
                // 如果是同一个节点，直接返回
                if (crucibleItems[existingTrackIndex].nodeId === data.nodeId) return;

                const existingNodeId = crucibleItems[existingTrackIndex].nodeId;
                const oldCard = dropzone.querySelector(`[data-node-id="${existingNodeId}"]`);
                if (oldCard) oldCard.remove();
                crucibleItems.splice(existingTrackIndex, 1);
            }

            const miniCard = document.createElement('div');
            miniCard.className = 'dock-card-item';
            miniCard.dataset.id = data.id;
            miniCard.dataset.nodeId = data.nodeId;
            miniCard.style.borderLeft = `4px solid ${data.trackColor}`;
            miniCard.innerHTML = `<span class="truncate-text" title="${data.title}">${data.title}</span><span class="remove-btn" style="font-size:1.2rem; margin-left:8px;">&times;</span>`;

            miniCard.addEventListener('click', () => {
                miniCard.remove();
                crucibleItems = crucibleItems.filter(i => i.nodeId !== data.nodeId);
                checkDockEmptyState();
                updateSynthesizeButton();
            });

            dropzone.appendChild(miniCard);
            crucibleItems.push({ id: data.id, nodeId: data.nodeId });
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
    btn.addEventListener('click', async () => {
        if (crucibleItems.length === 0) return;
        btn.innerText = 'SYNTHESIZING...';
        btn.disabled = true;

        try {
            // parent_node_ids defaults to genesis if no nodeId is somehow found, but since we drag nodes, nodeId should be present.
            const parentNodeIds = crucibleItems.map(item => item.nodeId);
            const involvedTracks = crucibleItems.map(item => item.id);

            const res = await fetch(`${API_BASE}/api/action`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    parent_node_ids: [...new Set(parentNodeIds)], // Unique parents
                    involved_tracks: [...new Set(involvedTracks)], // Unique tracks
                    player_action: "进行高维合成反应"
                })
            });

            const result = await res.json();
            if (result.success) {
                // Refresh UI
                await fetchUniverseTree();

                // Clear Dock
                document.querySelectorAll('.dock-card-item').forEach(el => el.remove());
                crucibleItems = [];
                checkDockEmptyState();
            }
        } catch (e) {
            console.error("Synthesis failed:", e);
        } finally {
            btn.innerText = 'SYNTHESIZE / 合成推演';
            updateSynthesizeButton();
        }
    });
}

function toggleHUD() {
    const card = document.getElementById('node-info-card');
    if (card) card.classList.add('hidden');
}

/**
 * 渲染左侧编年史日志
 */
function updateChronicleView(nodeId) {
    const path = getPathToRoot(nodeId);
    // 逆序，从根节点到当前节点显示
    const chronologicalPath = [...path].reverse();
    renderChronicle(chronologicalPath, (id) => {
        // 当用户点击日志项时，同步更新 3D 视角和 2D 轨道
        focusNode(id);
    });
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
        await fetch(`${API_BASE}/api/debug/reset`, { method: 'POST' });
        window.location.reload();
    } catch (e) { alert("Fail: " + e.message); }
};
