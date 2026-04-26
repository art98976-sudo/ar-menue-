
// ════════════════════════════════════════════════════════════
// AR SCENE TEMPLATE — Every dish has fixed rules
// Like AR Code app — consistent across all food items
// ════════════════════════════════════════════════════════════
const AR_TEMPLATE = {

    // Fixed scale rules — real world sizes
    scale: {
        pizza:  { x: 2.0, y: 2.0, z: 2.0 },  // ~28cm plate
        burger: { x: 1.5, y: 1.5, z: 1.5 },  // ~15cm plate
        drink:  { x: 1.2, y: 1.2, z: 1.2 },  // ~10cm glass
        pasta:  { x: 2.0, y: 2.0, z: 2.0 },  // ~25cm bowl
        sushi:  { x: 1.8, y: 1.8, z: 1.8 },  // ~20cm platter
    },

    // Fixed position — Y pushed down to touch image surface
    position: {
        pizza:  { x: 0, y: 0, z: 0 },
        burger: { x: 0, y: 0, z: 0 },
        drink:  { x: 0, y: 0, z: 0 },
        pasta:  { x: 0, y: 0, z: 0 },
        sushi:  { x: 0, y: 0, z: 0 },
    },

    // Fixed rotation — 0 0 0 since model is already flat in Blender
    rotation: {
        pizza:  { x: 0, y: 0, z: 0 },
        burger: { x: 0, y: 0, z: 0 },
        drink:  { x: 0, y: 0, z: 0 },
        pasta:  { x: 0, y: 0, z: 0 },
        sushi:  { x: 0, y: 0, z: 0 },
    },

    // Fixed shadow — same for all dishes
    shadow: {
        outerRadius: 0.30,
        innerRadius: 0.20,
        outerOpacity: 0.15,
        innerOpacity: 0.35,
    },

    // Fixed lighting behavior
    lighting: {
        ambient: { color: '#fff5e0', intensity: 1.0 },
        key:     { color: '#FFD8B0', intensity: 1.6, position: '-3 6 4' },
        fill:    { color: '#ffe8d5', intensity: 0.45, position: '4 3 -2' },
        rim:     { color: '#fff0e8', intensity: 0.6,  position: '0 4 -6' },
    },
};

// Apply AR template to a model
function applyARTemplate(modelId) {
    const el = document.getElementById(menuData[modelId].arId);
    if (!el) return;

    const s = AR_TEMPLATE.scale[modelId];
    const p = AR_TEMPLATE.position[modelId];
    const r = AR_TEMPLATE.rotation[modelId];

    el.setAttribute('scale',    `${s.x} ${s.y} ${s.z}`);
    el.setAttribute('position', `${p.x} ${p.y} ${p.z}`);
    el.setAttribute('rotation', `${r.x} ${r.y} ${r.z}`);
    el.setAttribute('visible',  'true');
}

// Hide all AR models using template
function hideAllARModels() {
    Object.keys(AR_TEMPLATE.scale).forEach(id => {
        const arId = menuData[id] ? menuData[id].arId : null;
        if (!arId) return;
        const el = document.getElementById(arId);
        if (el) el.setAttribute('scale', '0 0 0');
    });
}

const menuData = {
    pizza:  { icon:'🍕', name:'Margherita Pizza', price:8.99, desc:'Fresh tomato sauce, mozzarella cheese and aromatic basil.', calories:'320 kcal', time:'15 min', rating:'4.8', model:'./pizza.glb',  arId:'ar-pizza',  arScale:2.0, size:'12 inch', serves:'2-3 people', weight:'400g' },
    burger: { icon:'🍔', name:'Classic Burger',   price:11.99, desc:'Juicy beef patty with melted cheese and crisp lettuce.',   calories:'540 kcal', time:'10 min', rating:'4.7', model:'./burger.glb', arId:'ar-burger', arScale:1.5, size:'5 inch',  serves:'1 person',   weight:'250g' },
    drink:  { icon:'🥤', name:'Fresh Lemonade',   price:4.99,  desc:'Cold pressed lemonade with fresh mint and lime.',          calories:'85 kcal',  time:'5 min',  rating:'4.9', model:'./drink.glb',  arId:'ar-drink',  arScale:1.2, size:'350 ml',   serves:'1 person',  weight:'350g' },
    pasta:  { icon:'🍝', name:'Creamy Pasta',     price:9.99, desc:'Rich creamy pasta with herbs, garlic and parmesan cheese.', calories:'480 kcal', time:'12 min', rating:'4.6', model:'./pasta.glb',  arId:'ar-pasta',  arScale:2.0, size:'300g',     serves:'1 person',  weight:'300g' },
    sushi:  { icon:'🍣', name:'Sushi Platter',    price:13.99, desc:'Fresh sushi rolls with premium ingredients and wasabi.',    calories:'310 kcal', time:'8 min',  rating:'4.9', model:'./sushi.glb',  arId:'ar-sushi',  arScale:1.8, size:'5 pieces',  serves:'1 person',  weight:'200g' },
};

let cart={}, currentModel=null, arQty=1, viewerMode=null;
let threeRenderer, threeScene, threeCamera, threeControls, loadedModel, T;
let isRendering=false;

function getThree(){if(T)return T;T=(window.AFRAME&&window.AFRAME.THREE)||window.THREE;return T;}

function initThreeJS(){
    const THREE=getThree();if(!THREE)return;
    const canvas=document.getElementById('three-canvas');
    const container=document.getElementById('viewer-3d');
    threeRenderer=new THREE.WebGLRenderer({canvas,antialias:true});
    threeRenderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
    threeRenderer.setSize(container.clientWidth,container.clientHeight);
    threeRenderer.setClearColor(0x0f0f0f,1);
    threeRenderer.shadowMap.enabled=true;
    threeRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    threeRenderer.toneMappingExposure = 0.9; // avoid overexposure
    threeScene=new THREE.Scene();

    // ── PREMIUM RESTAURANT BACKGROUND ──
    // Warm dark gradient - food pops, background supports not distracts
    const bgCanvas=document.createElement('canvas');
    bgCanvas.width=512;bgCanvas.height=512;
    const bgCtx=bgCanvas.getContext('2d');

    // Radial gradient: warm center lighter, dark edges = vignette
    const grad=bgCtx.createRadialGradient(256,300,30,256,256,380);
    grad.addColorStop(0,   '#2a1f14'); // warm dark center - wooden table feel
    grad.addColorStop(0.5, '#1a1208'); // mid dark warm
    grad.addColorStop(1,   '#050302'); // very dark edges - vignette
    bgCtx.fillStyle=grad;
    bgCtx.fillRect(0,0,512,512);

    // Soft ceiling light glow from top
    const topGlow=bgCtx.createRadialGradient(256,0,0,256,0,280);
    topGlow.addColorStop(0,   'rgba(255,200,120,0.15)');
    topGlow.addColorStop(1,   'rgba(0,0,0,0)');
    bgCtx.fillStyle=topGlow;
    bgCtx.fillRect(0,0,512,512);

    threeScene.background=new THREE.CanvasTexture(bgCanvas);

    // Depth fog - natural falloff behind food (real space feeling)
    threeScene.fog=new THREE.FogExp2(0x0f0a05, 0.06);
    threeCamera=new THREE.PerspectiveCamera(40,container.clientWidth/container.clientHeight,0.1,100);
    threeCamera.position.set(0,0.5,3);

    // ══════════════════════════════════════════
    // STEP 1 — HDRI Environment Light (base of everything)
    // Simulated using hemisphere light (warm top, cool bottom)
    // Creates natural reflections, removes plastic toy look
    const hemiLight = new THREE.HemisphereLight(
        0xfff5e0,  // sky color - warm white like studio softbox
        0x443322,  // ground color - warm dark like table reflection
        1.0        // intensity 0.8-1.2
    );
    threeScene.add(hemiLight);

    // STEP 2 — Key Light (Main light - food highlights)
    // Front + slightly above at 45 degrees, warm white 3000K
    const keyLight = new THREE.DirectionalLight(0xFFD8B0, 1.6);
    keyLight.position.set(-3, 6, 4); // front left above
    keyLight.castShadow = true;
    // STEP 5 — Shadow Settings
    keyLight.shadow.mapSize.width = 2048;
    keyLight.shadow.mapSize.height = 2048;
    keyLight.shadow.radius = 12;      // soft blurred edges
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.camera.near = 0.1;
    keyLight.shadow.camera.far = 20;
    threeScene.add(keyLight);

    // STEP 3 — Fill Light (removes harsh shadows)
    // Opposite side of key light, light warm grey
    const fillLight = new THREE.DirectionalLight(0xffe8d5, 0.45);
    fillLight.position.set(4, 3, -2); // opposite side
    threeScene.add(fillLight);

    // STEP 4 — Rim Light (Netflix quality glowing edges)
    // Behind object from top-back, warm neutral
    const rimLight = new THREE.DirectionalLight(0xfff0e8, 0.6);
    rimLight.position.set(0, 4, -6); // top back
    threeScene.add(rimLight);

    // Extra top light for food shine
    const topLight = new THREE.PointLight(0xffd8a0, 0.5, 10);
    topLight.position.set(0, 5, 1);
    threeScene.add(topLight);

    // STEP 5+6 — Shadow Ground + Contact Shadow
    // Soft dark oval under food - makes it feel anchored
    const groundMat = new THREE.ShadowMaterial({ opacity: 0.35 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -1.5;
    ground.receiveShadow = true;
    threeScene.add(ground);
    const OC=(window.AFRAME&&window.AFRAME.THREE&&window.AFRAME.THREE.OrbitControls)||window.OrbitControls;
    if(!OC)return;
    threeControls=new OC(threeCamera,canvas);
    threeControls.enableDamping=true;threeControls.dampingFactor=0.05;
    threeControls.minDistance=1;threeControls.maxDistance=8;
    threeControls.enablePan=false;threeControls.autoRotate=true;threeControls.autoRotateSpeed=1.5;
    canvas.addEventListener('touchstart',()=>{threeControls.autoRotate=false;});
    canvas.addEventListener('mousedown',()=>{threeControls.autoRotate=false;});
    startRendering();
}

function startRendering(){
    isRendering=true;
    function loop(){if(!isRendering)return;requestAnimationFrame(loop);threeControls&&threeControls.update();threeRenderer&&threeRenderer.render(threeScene,threeCamera);}
    loop();
}
function stopRendering(){isRendering=false;}

function loadGLBModel(path){
    const THREE=getThree();if(!THREE)return;
    if(loadedModel){threeScene.remove(loadedModel);loadedModel=null;}
    document.getElementById('ar-loading').style.display='flex';
    const pb=document.getElementById('progress-bar'),pp=document.getElementById('progress-percent'),li=document.querySelector('.loading-icon');
    if(pb)pb.style.width='0%';if(pp)pp.innerText='0%';if(li&&currentModel)li.innerText=menuData[currentModel].icon;
    const LC=(window.AFRAME&&window.AFRAME.THREE&&window.AFRAME.THREE.GLTFLoader)||window.GLTFLoader;if(!LC)return;
    const loader=new LC();
    const DC=window.DRACOLoader||(window.AFRAME&&window.AFRAME.THREE&&window.AFRAME.THREE.DRACOLoader);
    if(DC){const d=new DC();d.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');d.setDecoderConfig({type:'js'});loader.setDRACOLoader(d);}
    loader.load(path,function(gltf){
        if(pb)pb.style.width='100%';if(pp)pp.innerText='100%';
        loadedModel=gltf.scene;
        loadedModel.traverse(c=>{
            if(c.isMesh){
                c.castShadow=true;
                c.receiveShadow=true;
                // Improve material quality
                if(c.material){
                    c.material.roughness = c.material.roughness !== undefined ? c.material.roughness : 0.7;
                    c.material.metalness = c.material.metalness !== undefined ? c.material.metalness : 0.1;
                    c.material.needsUpdate = true;
                }
            }
        });
        const box=new THREE.Box3().setFromObject(loadedModel);
        const center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());
        const scale=2.8/Math.max(size.x,size.y,size.z);
        loadedModel.scale.setScalar(scale);loadedModel.position.sub(center.multiplyScalar(scale));
        threeScene.add(loadedModel);
        addSteamEffect(); // add steam rising from hot food
        setTimeout(()=>{document.getElementById('ar-loading').style.display='none';},200);
        threeCamera.position.set(0,0.5,3);threeControls&&threeControls.reset();threeControls&&(threeControls.autoRotate=true);
    },function(xhr){
        if(xhr.lengthComputable){const p=Math.round(xhr.loaded/xhr.total*100);if(pb)pb.style.width=p+'%';if(pp)pp.innerText=p+'%';}
    },function(err){console.error(err);document.getElementById('ar-loading').style.display='none';});
}

function resizeRenderer(){
    if(!threeRenderer||!threeCamera)return;
    const c=document.getElementById('viewer-3d');if(!c.clientWidth||!c.clientHeight)return;
    threeRenderer.setSize(c.clientWidth,c.clientHeight);threeCamera.aspect=c.clientWidth/c.clientHeight;threeCamera.updateProjectionMatrix();
}

function updateViewerUI(id){
    const item=menuData[id];arQty=1;
    document.getElementById('ar-qty-num').innerText='1';
    document.getElementById('ar-food-name').innerText=item.name;
    document.getElementById('ar-food-price').innerText='£'+item.price;
    document.getElementById('ar-detail-name').innerText=item.name;
    document.getElementById('ar-detail-price').innerText='£'+item.price;
    document.getElementById('ar-detail-desc').innerText=item.desc;
    document.getElementById('ar-cal-row').innerHTML=`<div class="cal-badge">🔥 ${item.calories}</div><div class="cal-badge">⏱️ ${item.time}</div><div class="cal-badge">⭐ ${item.rating}</div>`;
    const sr=document.getElementById('ar-size-row');if(sr)sr.innerHTML=`<div class="size-badge">📏 ${item.size}</div><div class="size-badge">👥 ${item.serves}</div><div class="size-badge">⚖️ ${item.weight}</div>`;
    document.getElementById('menu-page').style.display='none';document.getElementById('bottom-nav').style.display='none';
    document.getElementById('cart-bar').classList.remove('visible');document.getElementById('ar-topbar').style.display='flex';
    document.getElementById('ar-bottombar').style.display='flex';document.getElementById('back-btn').classList.add('visible');
}

function open3D(id){
    currentModel=id;viewerMode='3d';updateViewerUI(id);
    document.getElementById('viewer-3d').style.display='block';document.getElementById('viewer-ar').style.display='none';
    document.getElementById('ar-hint-bar').innerText='☝️ Drag to rotate · 🤏 Pinch to zoom';
    if(!threeRenderer)initThreeJS();else startRendering();
    resizeRenderer();loadGLBModel(menuData[id].model);history.pushState({page:'3d'},'');
}

function openAR(id){
    currentModel=id;viewerMode='ar';updateViewerUI(id);stopRendering();
    document.getElementById('viewer-ar').style.display='block';document.getElementById('viewer-3d').style.display='none';
    document.getElementById('ar-hint-bar').innerText='📷 Scan image · ☝️ Rotate · 🤏 Zoom';
    document.getElementById('scan-overlay').classList.remove('hidden');
    arRotY=0;arRotX=0;arScale=menuData[id].arScale;

    // Hide all models first — use different variable name to avoid conflict
    ['ar-pizza','ar-burger','ar-drink','ar-pasta','ar-sushi'].forEach(function(arId) {
        const el = document.getElementById(arId);
        if (el) el.setAttribute('scale', '0 0 0');
    });
    // Show selected model
    const arEl2 = document.getElementById(menuData[id].arId);
    if (arEl2) {
        arEl2.setAttribute('scale', `${menuData[id].arScale} ${menuData[id].arScale} ${menuData[id].arScale}`);
        arEl2.setAttribute('rotation', '-90 0 0');
        arEl2.setAttribute('position', '0 0 0.05'); // Step 5: slightly toward user
    }

    // Fix 2: Trigger resize so model appears without opening inspect
    setTimeout(function(){
        window.dispatchEvent(new Event('resize'));
        fixVideo();
    }, 500);
    setTimeout(fixVideo, 1500);
    setTimeout(fixVideo, 3000);

    // Attach MindAR events
    setTimeout(function(){
        const t=document.querySelector('[mindar-image-target]');
        if(t){t.removeEventListener('targetFound',onFound);t.removeEventListener('targetLost',onLost);t.addEventListener('targetFound',onFound);t.addEventListener('targetLost',onLost);}
    },1000);
    history.pushState({page:'ar'},'');
}

function onFound(){
    document.getElementById('scan-overlay').classList.add('hidden');
    const det=document.getElementById('ar-detected');if(det){det.style.display='flex';setTimeout(()=>{det.style.display='none';},2000);}

    // Place model flat on menu - no floating
    if(currentModel && menuData[currentModel]){
        const el = document.getElementById(menuData[currentModel].arId);
        if(el){
            const s = menuData[currentModel].arScale;
            el.setAttribute('position', '0 -0.5 0'); // push down to touch surface
            el.setAttribute('scale', `${s} ${s} ${s}`);
            el.setAttribute('rotation', '-90 0 0');
        }
    }
}
function onLost(){document.getElementById('scan-overlay').classList.remove('hidden');}

function fixVideo(){
    document.querySelectorAll('video').forEach(v=>{v.style.cssText='position:fixed!important;top:0!important;left:0!important;width:100vw!important;height:100vh!important;object-fit:cover!important;z-index:1!important;display:block!important;';});
    document.querySelectorAll('#viewer-ar canvas').forEach(c=>{c.style.cssText='position:fixed!important;top:0!important;left:0!important;width:100vw!important;height:100vh!important;z-index:2!important;background:transparent!important;';});
}
setInterval(()=>{if(document.getElementById('viewer-ar').style.display==='block')fixVideo();},1000);

function closeViewer(){
    currentModel=null;viewerMode=null;
    removeSteamEffect();
    stopRendering();
    const t=document.querySelector('[mindar-image-target]');
    if(t){t.removeEventListener('targetFound',onFound);t.removeEventListener('targetLost',onLost);}
    document.getElementById('viewer-3d').style.display='none';document.getElementById('viewer-ar').style.display='none';
    document.getElementById('ar-topbar').style.display='none';document.getElementById('ar-bottombar').style.display='none';
    document.getElementById('back-btn').classList.remove('visible');
    document.getElementById('menu-page').style.display='flex';document.getElementById('bottom-nav').style.display='flex';
    updateCartBar();
}

function resetModel(){
    if(viewerMode==='3d'&&threeControls){threeControls.reset();threeControls.autoRotate=true;}
    if(viewerMode==='ar'){arRotY=0;arRotX=0;const el=document.getElementById(menuData[currentModel].arId);if(el)el.setAttribute('rotation','0 0 0');}
}

function quickAdd(id){addItemToCart(id,1);showToast('✅',menuData[id].name+' added!','£'+menuData[id].price);}
function addToCart(){if(!currentModel)return;addItemToCart(currentModel,arQty);showToast('🛒',menuData[currentModel].name+' ×'+arQty,'£'+(menuData[currentModel].price*arQty));}
function addItemToCart(id,qty){cart[id]?cart[id].qty+=qty:cart[id]={qty};updateCartBar();}
function removeFromCart(id){if(!cart[id])return;cart[id].qty--;if(cart[id].qty<=0)delete cart[id];renderCartPage();updateCartBar();}
function addFromCart(id){if(cart[id])cart[id].qty++;renderCartPage();updateCartBar();}
function getCartCount(){return Object.values(cart).reduce((s,v)=>s+v.qty,0);}
function getCartTotal(){return Object.entries(cart).reduce((s,[id,v])=>s+menuData[id].price*v.qty,0);}
function updateCartBar(){
    const n=getCartCount(),t=getCartTotal(),b=document.getElementById('cart-bar');
    if(n>0){b.classList.add('visible');document.getElementById('cart-count').innerText=n+' item'+(n>1?'s':'');document.getElementById('cart-total').innerText='£'+t;}
    else b.classList.remove('visible');
}
function changeQty(d){arQty=Math.max(1,Math.min(10,arQty+d));document.getElementById('ar-qty-num').innerText=arQty;}
function orderNow(){if(!currentModel)return;addItemToCart(currentModel,arQty);closeViewer();setTimeout(placeOrder,300);}
function openCart(){renderCartPage();document.getElementById('cart-page').classList.add('open');history.pushState({page:'cart'},'');}
function closeCart(){document.getElementById('cart-page').classList.remove('open');}
function renderCartPage(){
    const c=document.getElementById('cart-items'),e=document.getElementById('empty-cart'),k=Object.keys(cart);
    if(!k.length){c.innerHTML='';e.style.display='flex';}
    else{e.style.display='none';c.innerHTML=k.map(id=>{const m=menuData[id],q=cart[id].qty;return `<div class="cart-item"><div class="cart-item-icon">${m.icon}</div><div class="cart-item-info"><div class="cart-item-name">${m.name}</div><div class="cart-item-price">£${m.price} × ${q} = £${m.price*q}</div></div><div class="qty-controls"><button class="qty-btn" onclick="removeFromCart('${id}')">−</button><div class="qty-num">${q}</div><button class="qty-btn" onclick="addFromCart('${id}')">+</button></div></div>`;}).join('');}
    const s=getCartTotal(),tax=Math.round(s*0.05);
    document.getElementById('summary-subtotal').innerText='£'+s;document.getElementById('summary-tax').innerText='£'+tax;document.getElementById('summary-total').innerText='£'+(s+tax);
}
function placeOrder(){if(!getCartCount())return;document.getElementById('order-id-text').innerText='Order #'+Math.floor(1000+Math.random()*9000);cart={};updateCartBar();document.getElementById('cart-page').classList.remove('open');document.getElementById('order-success').classList.add('open');}
function backToMenu(){document.getElementById('order-success').classList.remove('open');showMenu();}
function showMenu(){document.getElementById('menu-page').style.display='flex';document.getElementById('bottom-nav').style.display='flex';}
function showToast(icon,msg,sub){document.getElementById('toast-icon').innerText=icon;document.getElementById('toast-msg').innerText=msg;document.getElementById('toast-sub').innerText=sub;const t=document.getElementById('toast');t.style.display='block';setTimeout(()=>{t.style.display='none';},1800);}

window.addEventListener('popstate',function(){
    if(document.getElementById('viewer-3d').style.display==='block'||document.getElementById('viewer-ar').style.display==='block'){closeViewer();return;}
    if(document.getElementById('cart-page').classList.contains('open')){closeCart();return;}
    if(document.getElementById('order-success').classList.contains('open')){backToMenu();return;}
});
history.pushState({page:'menu'},'');
window.addEventListener('resize',resizeRenderer);

// AR Touch Controls
let arRotY=0,arRotX=0,arScale=0.3;
let arLastX=null,arLastY=null,arLastPinch=null;
function getArEl(){return currentModel?document.getElementById(menuData[currentModel].arId):null;}
function pd(t){return Math.hypot(t[0].clientX-t[1].clientX,t[0].clientY-t[1].clientY);}
const arMaxScale=6.0; // bigger zoom limit
document.addEventListener('touchstart',e=>{
    if(viewerMode!=='ar')return;
    if(e.target.closest('#ar-bottombar')||e.target.closest('#back-btn'))return;
    if(e.touches.length===1){arLastX=e.touches[0].clientX;arLastY=e.touches[0].clientY;arLastPinch=null;}
    else if(e.touches.length===2){arLastPinch=pd(e.touches);arLastX=null;arLastY=null;}
},{passive:true});
document.addEventListener('touchmove',e=>{
    if(viewerMode!=='ar')return;
    if(e.target.closest('#ar-bottombar')||e.target.closest('#back-btn'))return;
    const el=getArEl();if(!el)return;
    if(e.touches.length===1&&arLastX!==null){
        arRotY+=e.touches[0].clientX-arLastX;
        // Step 5: Keep flat -90, only spin Y axis
        el.setAttribute('rotation',`-90 ${arRotY} 0`);
        arLastX=e.touches[0].clientX;arLastY=e.touches[0].clientY;
    }else if(e.touches.length===2&&arLastPinch!==null){
        const nd=pd(e.touches);arScale=Math.max(0.05,Math.min(4,arScale+(nd-arLastPinch)*0.008));
        arScale=Math.max(0.05,Math.min(arMaxScale,arScale+(nd-arLastPinch)*0.015)); // faster zoom
        el.setAttribute('scale',`${arScale} ${arScale} ${arScale}`);arLastPinch=nd;
    }
},{passive:true});
document.addEventListener('touchend',()=>{arLastX=null;arLastY=null;arLastPinch=null;});

// ── Height adjustment for AR model ──
let arYOffset = -0.5;

function adjustHeight(delta) {
    arYOffset += delta;
    if (!currentModel) return;
    const el = document.getElementById(menuData[currentModel].arId);
    if (el) {
        el.setAttribute('position', `0 ${arYOffset.toFixed(2)} 0`);
        console.log('Y offset:', arYOffset.toFixed(2));
    }
}

// Show height controls when AR opens
const _origOpenAR = openAR;
openAR = function(id) {
    _origOpenAR(id);
    arYOffset = -0.5;
    setTimeout(() => {
        document.getElementById('height-controls').style.display = 'flex';
    }, 500);
};

const _origCloseViewer = closeViewer;
closeViewer = function() {
    _origCloseViewer();
    document.getElementById('height-controls').style.display = 'none';
};

// ── Steam Effect for 3D Viewer ──
let steamParticles = null, steamAnimId = null;

function addSteamEffect() {
    const THREE = getThree();
    if (!THREE || !threeScene || currentModel === 'drink') return;
    removeSteamEffect();

    const count = 25;
    const positions = new Float32Array(count * 3);
    const speeds = new Float32Array(count);
    const offsets = new Float32Array(count);

    for (let i = 0; i < count; i++) {
        positions[i*3]   = (Math.random() - 0.5) * 0.8;
        positions[i*3+1] = Math.random() * 1.5;
        positions[i*3+2] = (Math.random() - 0.5) * 0.8;
        speeds[i]  = 0.004 + Math.random() * 0.008;
        offsets[i] = Math.random() * Math.PI * 2;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const mat = new THREE.PointsMaterial({
        color: 0xdddddd,
        size: 0.12,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });

    steamParticles = new THREE.Points(geo, mat);
    steamParticles.position.y = 0.8;
    threeScene.add(steamParticles);

    let frame = 0;
    function animateSteam() {
        steamAnimId = requestAnimationFrame(animateSteam);
        if (!steamParticles) return;
        frame++;
        const pos = steamParticles.geometry.attributes.position;
        for (let i = 0; i < count; i++) {
            pos.array[i*3+1] += speeds[i];
            pos.array[i*3]   += Math.sin(frame * 0.02 + offsets[i]) * 0.002;
            pos.array[i*3+2] += Math.cos(frame * 0.02 + offsets[i]) * 0.002;
            if (pos.array[i*3+1] > 2.5) {
                pos.array[i*3]   = (Math.random() - 0.5) * 0.8;
                pos.array[i*3+1] = 0;
                pos.array[i*3+2] = (Math.random() - 0.5) * 0.8;
            }
        }
        pos.needsUpdate = true;
        mat.opacity = 0.25 + Math.sin(frame * 0.05) * 0.1;
    }
    animateSteam();
}

function removeSteamEffect() {
    if (steamParticles) { threeScene && threeScene.remove(steamParticles); steamParticles = null; }
    if (steamAnimId) { cancelAnimationFrame(steamAnimId); steamAnimId = null; }
}
