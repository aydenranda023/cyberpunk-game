// ==========================================
// Neural Link - 3D Point Cloud Universe Engine
// ==========================================
import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.js';
// 注：我们需要确保加载 GSAP。这里假设 GSAP 已在 HTML 中通过 CDN 加载，可以直接使用 window.gsap
const gsap = window.gsap;

let scene, camera, renderer, universeGroup;
let isDragging = false;
let previousPointerX = 0, previousPointerY = 0;
let targetRotationX = 0, targetRotationY = 0;

// Nodes maps
const nodeMeshes = {}; // 隐形碰撞体映射（用于点击）: nodeId => Mesh
const nodeVisuals = {}; // 渲染材质映射: nodeId => Mesh
const branchVisuals = {}; // 渲染管线映射: childNodeId => Mesh
const nodePositions = {}; // 空间坐标： nodeId => THREE.Vector3

// 材质配置：苹果风格极简管线与白金节点
const hitGeometry = new THREE.SphereGeometry(1.5, 8, 8);
const hitMaterial = new THREE.MeshBasicMaterial({
    transparent: true, opacity: 0, depthWrite: false
});

// 使用基础的高分段球体作为地铁站/音符锚点
const nodeGeometry = new THREE.SphereGeometry(0.3, 32, 32);

// 创造一个柔和的发光粒子贴图
const canvas2d = document.createElement('canvas');
canvas2d.width = 128;
canvas2d.height = 128;
const ctx = canvas2d.getContext('2d');
const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
gradient.addColorStop(0.2, 'rgba(255, 255, 255, 0.8)');
gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.2)');
gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
ctx.fillStyle = gradient;
ctx.fillRect(0, 0, 128, 128);
const glowTexture = new THREE.CanvasTexture(canvas2d);

function getBranchMaterial(colorHex) {
    // 平滑的实体连线材质
    return new THREE.MeshPhysicalMaterial({
        color: colorHex,
        transparent: true,
        opacity: 0.6, // 加深透明度让管线更清晰
        roughness: 0.2,
        transmission: 0.5,
        thickness: 0.5
    });
}

function getNodeMaterial(colorHex) {
    // 改用 PointsMaterial 配合发光贴图，让节点看起来像能量脉冲
    return new THREE.PointsMaterial({
        color: colorHex,
        size: 0.8,
        map: glowTexture,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true
    });
}

// 统一颜色映射 (转向柔和但清晰的指示色)
const UNIVERSE_COLORS = {
    "Cyberpunk": 0x33ccff,    // 清澈蓝
    "Medieval Fantasy": 0xffaa00, // 琥珀金
    "Wasteland": 0x33cc66,    // 苍翠绿
    "default": 0xaaaaaa       // 浅灰
};
function getColorForUniverse(tag) {
    return UNIVERSE_COLORS[tag] || UNIVERSE_COLORS["default"];
}

// 取消所有点云闪烁逻辑
const animatedPointClouds = [];

// ==========================================
// 初始化 3D 舞台
// ==========================================
export function initUniverse3D(canvasId, onNodeClickCallback, onVoidClickCallback) {
    const canvas = document.getElementById(canvasId);
    scene = new THREE.Scene();
    scene.background = null;

    // 加强打光
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.7);
    dirLight.position.set(5, 10, 5);
    scene.add(dirLight);

    const container = canvas.parentElement;
    camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
    camera.position.set(5, 3, 10);
    camera.lookAt(0, 0, 0);

    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);

    setupControls(canvas, onNodeClickCallback, onVoidClickCallback);

    universeGroup = new THREE.Group();
    scene.add(universeGroup);

    // 移除五线谱： drawStaffLines();

    animate();
}

function drawStaffLines() {
    // 创造 5 条极淡的灰色管线横贯时空，作为乐谱背景
    const mat = new THREE.LineBasicMaterial({
        color: 0xcccccc,
        transparent: true,
        opacity: 0.3,
        depthWrite: false
    });

    // Y 轴分布五根线，Z轴轻微推后作为背景
    const spread = [-4, -2, 0, 2, 4];
    spread.forEach(yOffset => {
        const points = [];
        points.push(new THREE.Vector3(-100, yOffset, -2));
        points.push(new THREE.Vector3(100, yOffset, -2));
        const geom = new THREE.BufferGeometry().setFromPoints(points);
        const line = new THREE.Line(geom, mat);
        universeGroup.add(line);
    });
}

function setupControls(canvas, onClick, onVoidClick) {
    let isPanning = false;
    let clickStartX = 0, clickStartY = 0;
    let hasMoved = false;

    canvas.addEventListener('pointerdown', (e) => {
        isDragging = true;
        hasMoved = false;
        clickStartX = e.clientX;
        clickStartY = e.clientY;

        // e.button === 0 是左键(通常旋转)，这里设计 shift+左键为平移
        // 也可设置鼠标中键 (e.button === 1) 为旋转，或者单独平移。按用户要求："单独按下鼠标滚轮也变成了平移，应该是旋转视角"
        // 这说明中键点击默认应该保留原有类似左键的“旋转”。
        // 所以，仅当按下 Shift，不管是左键还是中键，才是平移。
        isPanning = e.shiftKey;
        previousPointerX = e.clientX;
        previousPointerY = e.clientY;
    });
    canvas.addEventListener('pointermove', (e) => {
        if (!isDragging) return;

        // 设置一个微小的像素阈值（比如 5px），超过才认为是有效的拖拽，避免点击被吃掉
        if (Math.abs(e.clientX - clickStartX) > 5 || Math.abs(e.clientY - clickStartY) > 5) {
            hasMoved = true;
        }

        const deltaX = e.clientX - previousPointerX;
        const deltaY = e.clientY - previousPointerY;

        if (isPanning) {
            // 平移镜头逻辑
            const panSpeed = 0.05;
            const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
            const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
            camera.position.addScaledVector(right, -deltaX * panSpeed);
            camera.position.addScaledVector(up, deltaY * panSpeed);
        } else {
            // 旋转逻辑
            targetRotationY += deltaX * 0.005;
            targetRotationX += deltaY * 0.005;
        }

        previousPointerX = e.clientX;
        previousPointerY = e.clientY;
    });
    window.addEventListener('pointerup', () => { isDragging = false; });

    // 滚轮缩放
    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const zoomSpeed = 0.05;
        const direction = new THREE.Vector3();
        camera.getWorldDirection(direction);
        if (e.deltaY < 0) {
            camera.position.addScaledVector(direction, Math.abs(e.deltaY) * zoomSpeed);
        } else {
            camera.position.addScaledVector(direction, -Math.abs(e.deltaY) * zoomSpeed);
        }
    }, { passive: false });

    // 射线检测点击
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    canvas.addEventListener('pointerup', (e) => {
        isDragging = false;
        if (hasMoved) return; // 如果发生了有效拖动，就不算点击节点

        const rect = canvas.getBoundingClientRect();
        mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);

        const intersects = raycaster.intersectObjects(Object.values(nodeMeshes));
        if (intersects.length > 0) {
            const clickedNodeId = intersects[0].object.userData.nodeId;
            onClick(clickedNodeId);
        } else {
            // 没有点击到任何节点，则触发虚空点击（可用来隐藏UI）
            if (onVoidClick) onVoidClick();
        }
    });

    window.addEventListener('resize', () => {
        const container = canvas.parentElement;
        if (!container) return;
        camera.aspect = container.clientWidth / container.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(container.clientWidth, container.clientHeight);
    });
}

// ==========================================
// 图谱生成逻辑
// ==========================================

// ==========================================
// 图谱生成逻辑：管线与地铁站
// ==========================================

function createBranchLine(p1, p2, colorHex) {
    // 使用贝塞尔曲线
    const midX = (p1.x + p2.x) / 2;
    const curve = new THREE.CubicBezierCurve3(
        p1,
        new THREE.Vector3(midX, p1.y, p1.z),
        new THREE.Vector3(midX, p2.y, p2.z),
        p2
    );

    // 有机感：改用更细的线，增加多重笔触效果
    const points = curve.getPoints(50);
    const geometry = new THREE.BufferGeometry().setFromPoints(points);

    // 主连线
    const mat = new THREE.LineBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity: 0.4,
        blending: THREE.AdditiveBlending
    });

    return new THREE.Line(geometry, mat);
}

function createNodeMesh(colorHex, pos) {
    // 使用 Points 替代 Mesh(Sphere)
    const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0)]);
    const points = new THREE.Points(geometry, getNodeMaterial(colorHex));
    return points;
}

// 批量构建初次加载或者跳跃产生的新起点树
export function buildUniverseGraph(nodesData) {
    if (nodesData.length === 0) return;
    const spacingZ = -5.0;

    nodesData.forEach((node) => {
        if (nodePositions[node.node_id]) return;

        let pos = new THREE.Vector3(0, 0, 0);
        let branchIsJump = false;

        if (node.parent_id && nodePositions[node.parent_id]) {
            const parentPos = nodePositions[node.parent_id];

            const isJumpNode = node.action_type === 'jump' ||
                (nodesData.find(n => n.node_id === node.parent_id)?.universe_tag !== node.universe_tag);

            // 统一神经网络分支逻辑：移除 Z 轴跃迁
            const offsetY = (Math.random() - 0.5) * 4.0;
            const offsetZ = (Math.random() - 0.5) * 4.0;
            pos.set(parentPos.x + 5.0, parentPos.y + offsetY, parentPos.z + offsetZ);
        }

        nodePositions[node.node_id] = pos;
        const color = getColorForUniverse(node.universe_tag);

        // 创建碰撞球
        const hitMesh = new THREE.Mesh(hitGeometry, hitMaterial);
        hitMesh.position.copy(pos);
        hitMesh.userData = { nodeId: node.node_id };
        universeGroup.add(hitMesh);
        nodeMeshes[node.node_id] = hitMesh;

        // 节点视觉
        const visualNode = createNodeMesh(color);
        visualNode.position.copy(pos);
        universeGroup.add(visualNode);
        nodeVisuals[node.node_id] = visualNode;

        // 生成管线树枝 (Multi-Parent)
        const parents = node.parent_ids || (node.parent_id ? [node.parent_id] : []);
        parents.forEach(parentId => {
            if (nodePositions[parentId]) {
                const branch = createBranchLine(nodePositions[parentId], pos, color);
                universeGroup.add(branch);
                // 使用组合ID避免覆盖
                branchVisuals[`${parentId}_${node.node_id}`] = branch;
            }
        });
    });
}

// 增量添加新回合节点
export function appendNewNode(newNode, oldNodeObj) {
    if (!newNode.parent_id || !nodePositions[newNode.parent_id]) return;

    const parentPos = nodePositions[newNode.parent_id];
    let pos = new THREE.Vector3();
    let branchIsJump = false;

    // 神经网络分支：向前上方/下方/侧面微弱分叉
    pos.set(
        parentPos.x + 5.0,
        parentPos.y + (Math.random() - 0.5) * 4.0,
        parentPos.z + (Math.random() - 0.5) * 4.0
    );

    // 强制不显示维度跳跃效果
    branchIsJump = false;

    nodePositions[newNode.node_id] = pos;
    const color = getColorForUniverse(newNode.universe_tag);

    const hitMesh = new THREE.Mesh(hitGeometry, hitMaterial);
    hitMesh.position.copy(pos);
    hitMesh.userData = { nodeId: newNode.node_id };
    universeGroup.add(hitMesh);
    nodeMeshes[newNode.node_id] = hitMesh;

    const visualNode = createNodeMesh(color);
    visualNode.position.copy(pos);
    // 从极小放大，恢复正常的初始尺寸
    visualNode.scale.set(0.01, 0.01, 0.01);
    gsap.to(visualNode.scale, { x: 1, y: 1, z: 1, duration: 1, ease: "elastic.out(1, 0.5)" });
    universeGroup.add(visualNode);
    nodeVisuals[newNode.node_id] = visualNode;

    if (!branchIsJump) {
        const branch = createBranchLine(parentPos, pos, color);
        // 管线生长渐显
        branch.material.opacity = 0;
        gsap.to(branch.material, { opacity: 0.6, duration: 1, delay: 0.5 });
        universeGroup.add(branch);
        branchVisuals[newNode.node_id] = branch;
    }
}

// 高亮并选择性移动摄像机
export function highlightNode(nodeId, moveCamera = false) {
    // 这个被重构为更复杂的回溯高亮在外部调用 updateActivePath
    if (!nodePositions[nodeId]) return;

    // highlightNode 仅负责移动相机，节点的视觉高亮由 updateActivePath 统一管理
    if (moveCamera) {
        const targetPos = new THREE.Vector3();
        // 使用 nodePositions 获取位置，因为 nodeVisuals 可能尚未完全初始化或动画中
        targetPos.copy(nodePositions[nodeId]);

        const targetZOffset = 18; // 稍微拉远，表现神经网络的纵深全貌
        const targetXOffset = -5; // 稍偏左，给右侧留点空间

        gsap.to(camera.position, {
            x: targetPos.x + targetXOffset,
            y: targetPos.y + 6,
            z: targetPos.z + targetZOffset,
            duration: 1.5,
            ease: "power2.inOut",
            onUpdate: () => {
                camera.lookAt(targetPos);
            }
        });
    }
}


const clock = new THREE.Clock();

function animate() {
    requestAnimationFrame(animate);
    const time = clock.getElapsedTime();

    // 缓动旋转
    universeGroup.rotation.y += (targetRotationY - universeGroup.rotation.y) * 0.1;
    universeGroup.rotation.x += (targetRotationX - universeGroup.rotation.x) * 0.1;

    // 增加轻微的有机波动感，让树看起来在流动
    universeGroup.position.y = Math.sin(time * 0.5) * 0.2;
    universeGroup.position.x = Math.cos(time * 0.3) * 0.1;

    renderer.render(scene, camera);
}

// -------------------------------------------------------------
// 【新增】主视角的高亮路径计算：淡化其余分支，点亮主线
// -------------------------------------------------------------
export function updateActivePath(targetNodeId, universeTreeData) {
    const activePathSet = new Set();
    let curr = targetNodeId;
    while (curr) {
        activePathSet.add(curr);
        const nodeObj = universeTreeData.find(n => n.node_id === curr);
        curr = nodeObj ? nodeObj.parent_id : null;
    }

    Object.keys(nodeVisuals).forEach(id => {
        const isActive = activePathSet.has(id);
        const node = nodeVisuals[id];

        // 节点高亮
        gsap.to(node.material, {
            opacity: isActive ? 1.0 : 0.4,
            size: isActive ? 1.2 : 0.75,
            duration: 0.6
        });
    });

    Object.keys(branchVisuals).forEach(branchKey => {
        // branchKey is "parent_child"
        const [pid, cid] = branchKey.split('_');
        const isActive = activePathSet.has(pid) && activePathSet.has(cid);

        gsap.to(branchVisuals[branchKey].material, {
            opacity: isActive ? 0.8 : 0.25,
            duration: 0.6
        });
    });
    highlightNode(targetNodeId, true);
}
