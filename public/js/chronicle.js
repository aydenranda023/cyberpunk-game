export function renderChronicle(nodePath, onFocusNode) {
    const container = document.getElementById('chronicle-content');
    if (!container) return;

    container.innerHTML = '';

    nodePath.forEach((n, idx) => {
        const div = document.createElement('div');
        div.className = 'log-entry';
        div.dataset.nodeId = n.node_id;

        // 分支标签
        let branchHTML = '';
        if (idx > 0 && n.parent_id) {
            branchHTML = `<div class="branch-tag">BRANCH // ${n.universe_tag}</div>`;
        }

        // 提取参与合成的胶囊 (假设数据中有 elements 列表)
        const elementsHTML = n.elements ? n.elements.map(el => `<span class="element-capsule">${el}</span>`).join('') : '';

        const text = (n.narrative_text || "无记录").replace(/\n/g, '<br>');

        div.innerHTML = `
            ${branchHTML}
            <div class="narrative-body">${text}</div>
            <div class="entry-meta">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div class="meta-elements">${elementsHTML}</div>
                    <div class="meta-id">ID: ${n.node_id.substring(0, 8)}</div>
                </div>
            </div>
        `;

        // 点击事件：高亮并居中
        div.addEventListener('click', () => {
            // 清除之前的 active
            document.querySelectorAll('.log-entry').forEach(el => el.classList.remove('active'));
            div.classList.add('active');

            if (onFocusNode) {
                onFocusNode(n.node_id);
            }
        });

        container.appendChild(div);
    });

    // 自动滚动到底部
    setTimeout(() => {
        container.scrollTop = container.scrollHeight;
    }, 100);
}
