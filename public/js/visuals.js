export function initParticles() {
    const c = document.getElementById('canvas-container');
    if (!c) return;
    const s = new THREE.Scene(); s.fog = new THREE.FogExp2(0, 0.001);
    const cam = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 1, 1000); cam.position.z = 100;
    const r = new THREE.WebGLRenderer({ alpha: true }); r.setSize(window.innerWidth, window.innerHeight);
    c.innerHTML = ''; c.appendChild(r.domElement);
    const pts = []; const cols = [];
    for (let i = 0; i < 1500; i++) {
        pts.push((Math.random() - 0.5) * 400, (Math.random() - 0.5) * 400, (Math.random() - 0.5) * 400);
        const col = new THREE.Color([0x00f3ff, 0xbc13fe, 0xff0055][Math.floor(Math.random() * 3)]);
        cols.push(col.r, col.g, col.b);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    const p = new THREE.Points(g, new THREE.PointsMaterial({ size: 2, vertexColors: true, opacity: 0.7, transparent: true }));
    s.add(p);
    const anim = () => { requestAnimationFrame(anim); p.rotation.x += 0.0005; r.render(s, cam); }; anim();
    window.onresize = () => { cam.aspect = window.innerWidth / window.innerHeight; cam.updateProjectionMatrix(); r.setSize(window.innerWidth, window.innerHeight); };
}

const wait = ms => new Promise(r => setTimeout(r, ms));
export async function playIntroSequence() {
    const t = document.getElementById('intro-content'), d = document.getElementById('the-door'), l = document.getElementById('intro-layer');
    l.classList.remove('hidden'); l.style.display = 'flex';
    for (let txt of ["初始化...", "接入多元宇宙...", "锁定时空...", "传送启动。"]) {
        t.innerText = txt; t.style.opacity = 1; t.style.transform = "scale(1)";
        await wait(1500); t.style.opacity = 0; t.style.transform = "scale(0.9)"; await wait(300);
    }
    t.style.display = 'none'; d.style.opacity = 1; d.classList.add('zoom-effect');
    await wait(2000); l.style.opacity = 0; setTimeout(() => l.classList.add('hidden'), 1000);
}

export async function playDeathSequence() {
    const t = document.getElementById('intro-content'), l = document.getElementById('intro-layer');
    l.classList.remove('hidden'); l.style.display = 'flex'; l.style.opacity = 1; l.style.background = '#000';
    for (let txt of ["生命体征危急...", "CRITICAL FAILURE", "GAME OVER"]) {
        t.innerText = txt; t.style.color = '#ff0055'; t.style.opacity = 1; t.style.transform = "scale(1.1)";
        await wait(1500); t.style.opacity = 0; t.style.transform = "scale(0.9)"; await wait(300);
    }
    await wait(1000);
}
