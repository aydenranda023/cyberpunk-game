// Three.js & Intro 动画逻辑
window.initParticles = function(){
    const c=document.getElementById('canvas-container');if(!c)return;
    const s=new THREE.Scene();s.fog=new THREE.FogExp2(0,0.001);
    const cam=new THREE.PerspectiveCamera(75,window.innerWidth/window.innerHeight,1,1000);cam.position.z=100;
    const r=new THREE.WebGLRenderer({alpha:true});r.setSize(window.innerWidth,window.innerHeight);
    c.innerHTML='';c.appendChild(r.domElement);
    const g=new THREE.BufferGeometry();const v=[],cl=[];
    for(let i=0;i<1500;i++){v.push((Math.random()-0.5)*400,(Math.random()-0.5)*400,(Math.random()-0.5)*400);const c=[0x00f3ff,0xbc13fe,0xff0055][Math.floor(Math.random()*3)];const hc=new THREE.Color(c);cl.push(hc.r,hc.g,hc.b);}
    g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.setAttribute('color',new THREE.Float32BufferAttribute(cl,3));
    const m=new THREE.PointsMaterial({size:2,vertexColors:true,opacity:0.7,transparent:true});
    const p=new THREE.Points(g,m);s.add(p);
    const a=()=>{requestAnimationFrame(a);p.rotation.x+=0.0005;r.render(s,cam);};a();
    window.addEventListener('resize',()=>{cam.aspect=window.innerWidth/window.innerHeight;cam.updateProjectionMatrix();r.setSize(window.innerWidth,window.innerHeight);});
}

window.playIntroSequence = async function() {
    const layer = document.getElementById('intro-layer');
    const txt = document.getElementById('intro-content');
    const door = document.getElementById('the-door');
    
    layer.classList.remove('hidden');
    layer.style.display = 'flex';
    layer.style.opacity = 1;
    
    const lines = [
        "正在初始化神经链路...", "已接入多元宇宙枢纽 (Multiverse Nexus)",
        "这里是所有现实的交汇点...", "每一扇门，都是一个截然不同的世界。",
        "正在为你随机锁定一个时空坐标...", "坐标已确认。准备传送。", "祝你好运，行者。"
    ];
    
    const wait = ms => new Promise(r => setTimeout(r, ms));
    for (let line of lines) {
        txt.innerText = line; txt.style.opacity = 1; txt.style.transform = "scale(1)";
        await wait(1800); txt.style.opacity = 0; txt.style.transform = "scale(0.9)"; await wait(400);
    }
    
    txt.style.display = 'none'; door.style.opacity = 1; 
    door.classList.add('zoom-effect'); 
    await wait(2000);
    
    layer.style.opacity = 0;
    setTimeout(() => layer.classList.add('hidden'), 1000);
    return true;
}
