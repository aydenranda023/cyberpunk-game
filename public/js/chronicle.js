/**
 * Chronicle Log Module
 * Handles the display of narrative history.
 */
export function renderChronicle(nodePath) {
    const container = document.getElementById('chronicle-content');
    if (!container) return;

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
    setTimeout(() => {
        container.scrollTop = container.scrollHeight;
    }, 100);
}
