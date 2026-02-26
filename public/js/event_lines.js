/**
 * Event Lines Module
 * Handles the 2D subway-map style event tracks.
 */
export function renderEventLines(containerId, mockEventLines) {
    const container = document.getElementById(containerId);
    if (!container) return;

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
            // Apply background color directly for solid fill
            capsule.style.backgroundColor = track.color;
            capsule.style.left = `${n.timeX}%`;

            // 存数据为了拖拽
            capsule.dataset.dragId = n.id;
            capsule.dataset.title = n.title;
            capsule.dataset.trackName = track.name;
            capsule.dataset.trackColor = track.color;

            capsule.innerHTML = `${n.title}`;

            // Drag Event
            capsule.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('application/json', JSON.stringify({
                    id: n.id, title: n.title, trackColor: track.color
                }));
                // 必须异步添加类名，否则拖拽镜像也会变暗
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
