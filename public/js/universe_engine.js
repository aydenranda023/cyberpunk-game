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
const nodeVisuals = {}; // 发光点云映射（用于视觉放大）: nodeId => Points
const nodePositions = {}; // 空间坐标： nodeId => THREE.Vector3

// 材质配置
const hitGeometry = new THREE.SphereGeometry(1.5, 8, 8); // 稍微放大隐形碰撞体，方便点选
const hitMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false, // 必须关闭深度写入！否则透明球体会遮挡背后的自发光点云
    colorWrite: false  // 也可以关闭颜色写入，彻底变成理化碰撞体
});

// 创造一个圆形的粒子透明贴图
const canvas2d = document.createElement('canvas');
canvas2d.width = 64;
canvas2d.height = 64;
const ctx = canvas2d.getContext('2d');
ctx.beginPath();
ctx.arc(32, 32, 30, 0, Math.PI * 2);
ctx.fillStyle = 'white';
ctx.fill();
const circleTexture = new THREE.CanvasTexture(canvas2d);

function getBranchMaterial(colorHex) {
    const baseColor = new THREE.Color(0xffffff);
    const tintColor = new THREE.Color(colorHex);
    return new THREE.PointsMaterial({
        color: baseColor.lerp(tintColor, 0.25), // 偏白，混入 25% 宇宙主题色
        size: 0.06, // 缩小点云
        map: circleTexture,
        transparent: true,
        opacity: 0.8,
        alphaTest: 0.1,
        depthWrite: false, // 恢复关闭深度写入，开启 AdditiveBlending 才能自发光不发黑
        blending: THREE.AdditiveBlending
    });
}

function getNodeMaterial(colorHex) {
    const baseColor = new THREE.Color(0xffffff);
    const tintColor = new THREE.Color(colorHex);
    return new THREE.PointsMaterial({
        color: baseColor.lerp(tintColor, 0.4), // 混入 40% 宇宙主题色
        size: 0.1, // 缩小节点点云
        map: circleTexture,
        transparent: true,
        opacity: 1.0,
        alphaTest: 0.1,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });
}

// 统一颜色映射
const UNIVERSE_COLORS = {
    "Cyberpunk": 0x00e5ff, // 青色
    "Medieval Fantasy": 0xffaa00, // 橙金
    "Wasteland": 0xccff00, // 毒绿
    "default": 0xffffff // 默认白
};
function getColorForUniverse(tag) {
    return UNIVERSE_COLORS[tag] || UNIVERSE_COLORS["default"];
}

// 基于时间的Shader材质（用于粒子闪烁和浮动）。为了不引入过复杂 Shader，先用 JS 遍历更新
const animatedPointClouds = [];

// ==========================================
// 初始化 3D 舞台
// ==========================================
export function initUniverse3D(canvasId, onNodeClickCallback, onVoidClickCallback) {
    const canvas = document.getElementById(canvasId);
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a0c);
    scene.fog = new THREE.FogExp2(0x0a0a0c, 0.002);

    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 15;
    camera.position.y = 5;

    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);

    setupControls(canvas, onNodeClickCallback, onVoidClickCallback);

    universeGroup = new THREE.Group();
    scene.add(universeGroup);

    animate();
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

        mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
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
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });
}

// ==========================================
// 图谱生成逻辑
// ==========================================

function createBranchPointCloud(p1, p2, colorHex) {
    const dist = p1.distanceTo(p2);
    const numPoints = Math.floor(dist * 40);
    const positions = new Float32Array(numPoints * 3);
    const phases = new Float32Array(numPoints); // 用作明暗闪动偏移

    for (let i = 0; i < numPoints; i++) {
        const t = Math.random();
        const x = p1.x + (p2.x - p1.x) * t;
        const y = p1.y + (p2.y - p1.y) * t;
        const z = p1.z + (p2.z - p1.z) * t;
        const noise = 0.4;
        positions[i * 3] = x + (Math.random() - 0.5) * noise;
        positions[i * 3 + 1] = y + (Math.random() - 0.5) * noise;
        positions[i * 3 + 2] = z + (Math.random() - 0.5) * noise;
        phases[i] = Math.random() * Math.PI * 2;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('phase', new THREE.BufferAttribute(phases, 1));

    const points = new THREE.Points(geom, getBranchMaterial(colorHex));
    animatedPointClouds.push({ mesh: points, originalPositions: Array.from(positions) });
    return points;
}

function createNodePointCloud(colorHex) { // 不再传入 pos 偏移，而是原点中心建模
    const numPoints = 150; // 适当减少粒子量
    const positions = new Float32Array(numPoints * 3);
    const phases = new Float32Array(numPoints);

    for (let i = 0; i < numPoints; i++) {
        const u = Math.random();
        const v = Math.random();
        const theta = 2 * Math.PI * u;
        const phi = Math.acos(2 * v - 1);
        const r = Math.random() * 0.8; // 节点膨大范围恢复到较大

        // 生成相对重心坐标
        positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
        positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
        positions[i * 3 + 2] = r * Math.cos(phi);
        phases[i] = Math.random() * Math.PI * 2;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('phase', new THREE.BufferAttribute(phases, 1));
    const points = new THREE.Points(geom, getNodeMaterial(colorHex));
    animatedPointClouds.push({ mesh: points, originalPositions: Array.from(positions) });
    return points;
}

// 批量构建初次加载或者跳跃产生的新起点树
export function buildUniverseGraph(nodesData) {
    if (nodesData.length === 0) return;
    const spacingZ = -5.0;

    nodesData.forEach((node) => {
        if (nodePositions[node.node_id]) return; // 已存在的不再绘制

        let pos = new THREE.Vector3(0, 0, 0);
        let branchIsJump = false; // 是否为跳跃分支

        if (node.parent_id && nodePositions[node.parent_id]) {
            const parentPos = nodePositions[node.parent_id];

            // 如果 parent 存在，但这个 node 的 universe_tag 突变，说明它是个 jump 新世界源头
            // 给它一个巨大的平移，视觉上隔离
            const isJumpNode = node.action_type === 'jump' ||
                (nodesData.find(n => n.node_id === node.parent_id)?.universe_tag !== node.universe_tag);

            if (isJumpNode) {
                // 距离拉远，形成新树枝簇
                pos.set(parentPos.x + 20.0, parentPos.y + (Math.random() - 0.5) * 10, parentPos.z + spacingZ);
                branchIsJump = true;
            } else {
                // 正常同宇宙分叉
                const offsetX = (Math.random() - 0.5) * 8.0;
                const offsetY = (Math.random() - 0.5) * 8.0;
                pos.set(parentPos.x + offsetX, parentPos.y + offsetY, parentPos.z + spacingZ);
            }
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
        const visualNode = createNodePointCloud(color);
        visualNode.position.copy(pos); // 通过给 mesh 赋予坐标，而非定死在几何体里
        universeGroup.add(visualNode);
        nodeVisuals[node.node_id] = visualNode;

        // 生成树枝
        if (node.parent_id && nodePositions[node.parent_id]) {
            if (!branchIsJump) {
                const branch = createBranchPointCloud(nodePositions[node.parent_id], pos, color);
                universeGroup.add(branch);
            }
        }
    });
}

// 增量添加新回合节点
export function appendNewNode(newNode, oldNodeObj) {
    if (!newNode.parent_id || !nodePositions[newNode.parent_id]) return;

    const parentPos = nodePositions[newNode.parent_id];
    let pos = new THREE.Vector3();
    let branchIsJump = false;

    // Jump 逻辑判断：如果类型是 jump 或者标签变了
    if (newNode.action_type === 'jump' || (oldNodeObj && oldNodeObj.universe_tag !== newNode.universe_tag)) {
        pos.set(
            parentPos.x + 20.0 * (Math.random() > 0.5 ? 1 : -1),
            parentPos.y + (Math.random() - 0.5) * 15.0,
            parentPos.z - 5.0
        );
        branchIsJump = true;
    } else {
        pos.set(
            parentPos.x + (Math.random() - 0.5) * 8.0,
            parentPos.y + (Math.random() - 0.5) * 8.0,
            parentPos.z - 5.0
        );
    }

    nodePositions[newNode.node_id] = pos;
    const color = getColorForUniverse(newNode.universe_tag);

    const hitMesh = new THREE.Mesh(hitGeometry, hitMaterial);
    hitMesh.position.copy(pos);
    hitMesh.userData = { nodeId: newNode.node_id };
    universeGroup.add(hitMesh);
    nodeMeshes[newNode.node_id] = hitMesh;

    const visualNode = createNodePointCloud(color);
    visualNode.position.copy(pos);
    // 从极小放大，恢复正常的初始尺寸 1
    visualNode.scale.set(0.01, 0.01, 0.01);
    gsap.to(visualNode.scale, { x: 1, y: 1, z: 1, duration: 1, ease: "elastic.out(1, 0.5)" });
    universeGroup.add(visualNode);
    nodeVisuals[newNode.node_id] = visualNode;

    if (!branchIsJump) {
        const branch = createBranchPointCloud(parentPos, pos, color);
        branch.material.opacity = 0;
        gsap.to(branch.material, { opacity: 0.8, duration: 1, delay: 0.5 });
        universeGroup.add(branch);
    }
}

// 高亮并选择性移动摄像机
export function highlightNode(nodeId, moveCamera = false) {
    // 重置大小 (保持原色，不重置为蓝色，只调低透明度)
    Object.keys(nodeVisuals).forEach(id => {
        const visual = nodeVisuals[id];
        visual.scale.set(1, 1, 1);
        visual.material.opacity = 0.5;
        // 如果我们还需要额外样式，可以在这里加
    });

    const activeVisual = nodeVisuals[nodeId];
    if (activeVisual) {
        // 确保高亮时恢复大小
        activeVisual.scale.set(1, 1, 1);

        // 停止之前的 GSAP 动画并开启 亮度(opacity) 呼吸，而不是整体缩放
        gsap.killTweensOf(activeVisual.material);
        activeVisual.material.opacity = 0.5;

        gsap.to(activeVisual.material, {
            opacity: 1.0,
            duration: 0.8,
            yoyo: true,
            repeat: -1,
            ease: "sine.inOut"
        });

        if (moveCamera) {
            const targetPos = new THREE.Vector3();
            activeVisual.getWorldPosition(targetPos);

            const currentZDist = camera.position.distanceTo(targetPos);
            const targetZOffset = Math.max(6, Math.min(20, currentZDist));

            gsap.to(camera.position, {
                x: targetPos.x, // 强制居中对准 X
                y: targetPos.y, // 强制居中对准 Y
                z: targetPos.z + targetZOffset,
                duration: 1.2,
                ease: "power2.inOut",
                onUpdate: () => {
                    camera.lookAt(targetPos);
                }
            });
        }
    }
}


const clock = new THREE.Clock();

function animate() {
    requestAnimationFrame(animate);
    const time = clock.getElapsedTime();

    // 缓动旋转
    universeGroup.rotation.y += (targetRotationY - universeGroup.rotation.y) * 0.1;
    universeGroup.rotation.x += (targetRotationX - universeGroup.rotation.x) * 0.1;

    // 使点云浮动闪烁
    animatedPointClouds.forEach(pc => {
        const positions = pc.mesh.geometry.attributes.position.array;
        const phases = pc.mesh.geometry.attributes.phase.array;
        const orig = pc.originalPositions;

        for (let i = 0; i < phases.length; i++) {
            // 增加粒子的随机运动幅度，使其有如暗网萤火虫般飘忽
            const offset = Math.sin(time * 1.5 + phases[i]) * 0.08;
            positions[i * 3 + 1] = orig[i * 3 + 1] + offset;
            positions[i * 3] = orig[i * 3] + offset * 0.5; // X轴也带点晃动
        }
        pc.mesh.geometry.attributes.position.needsUpdate = true;
    });

    renderer.render(scene, camera);
}
