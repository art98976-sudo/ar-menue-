// ============================================
// FOOD DATA
// ============================================
const menuData = {
    pizza:  { icon:'🍕', name:'Margherita Pizza', price:150, desc:'Fresh tomato sauce, mozzarella cheese and aromatic basil on a perfectly crispy thin crust.', calories:'320 kcal', time:'15 min', rating:'4.8', model:'./pizza.glb',  arId:'ar-pizza',  arScale:0.5,  size:'12 inch', serves:'2-3 people', weight:'400g' },
    burger: { icon:'🍔', name:'Classic Burger',   price:200, desc:'Juicy beef patty with melted cheese, crisp lettuce and tomato in a toasted sesame bun.',   calories:'540 kcal', time:'10 min', rating:'4.7', model:'./burger.glb', arId:'ar-burger', arScale:0.15, size:'5 inch',  serves:'1 person',   weight:'250g' },
    drink:  { icon:'🥤', name:'Fresh Lemonade',   price:80,  desc:'Cold pressed lemonade with fresh mint leaves, a squeeze of lime and a hint of honey.',      calories:'85 kcal',  time:'5 min',  rating:'4.9', model:'./drink.glb',  arId:'ar-drink',  arScale:0.2,  size:'350 ml',  serves:'1 person',   weight:'350g' },
};

let cart = {}, currentModel = null, arQty = 1, viewerMode = null;
let threeRenderer, threeScene, threeCamera, threeControls, loadedModel, T;
let isRendering = false; // ← stop rendering when not needed (saves battery)

// ── Get Three.js ──
function getThree() {
    if (T) return T;
    T = (window.AFRAME && window.AFRAME.THREE) || window.THREE;
    return T;
}

// ── Init Three.js ──
function initThreeJS() {
    const THREE = getThree();
    if (!THREE) return;
    const canvas = document.getElementById('three-canvas');
    const container = document.getElementById('viewer-3d');

    threeRenderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    threeRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // ← cap at 2x for performance
    threeRenderer.setSize(container.clientWidth, container.clientHeight);
    threeRenderer.setClearColor(0x0f0f0f, 1);
    threeScene = new THREE.Scene();
    threeScene.background = new THREE.Color(0x0f0f0f);

    threeCamera = new THREE.PerspectiveCamera(40, container.clientWidth / container.clientHeight, 0.1, 100);
    threeCamera.position.set(0, 0.5, 3);

    // Premium lighting setup
    threeScene.add(new THREE.AmbientLight(0xfff5e0, 2.0));

    // Key light with shadows
    const keyLight = new THREE.DirectionalLight(0xffffff, 3.5);
    keyLight.position.set(5, 10, 7);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
    keyLight.shadow.camera.near = 0.1;
    keyLight.shadow.camera.far = 50;
    keyLight.shadow.bias = -0.001;
    threeScene.add(keyLight);

    // Fill light
    const fillLight = new THREE.DirectionalLight(0xffe8d0, 2.0);
    fillLight.position.set(-5, 5, -5);
    threeScene.add(fillLight);

    // Rim light for depth
    const rimLight = new THREE.DirectionalLight(0xffd0a0, 1.5);
    rimLight.position.set(0, 3, -8);
    threeScene.add(rimLight);

    // Bottom warm light
    const bottomLight = new THREE.PointLight(0xffaa44, 1.0, 15);
    bottomLight.position.set(0, -3, 2);
    threeScene.add(bottomLight);

    // Shadow ground plane
    const groundGeo = new THREE.PlaneGeometry(20, 20);
    const groundMat = new THREE.ShadowMaterial({ opacity: 0.3 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -1.5;
    ground.receiveShadow = true;
    threeScene.add(ground);

    // Enable shadows on renderer
    threeRenderer.shadowMap.enabled = true;
    threeRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
    threeRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    threeRenderer.toneMappingExposure = 1.2;

    // OrbitControls
    const OC = (window.AFRAME && window.AFRAME.THREE && window.AFRAME.THREE.OrbitControls)
        || window.OrbitControls || THREE.OrbitControls;
    if (!OC) { console.error('OrbitControls not found'); return; }

    threeControls = new OC(threeCamera, canvas);
    threeControls.enableDamping = true;
    threeControls.dampingFactor = 0.05;
    threeControls.minDistance = 1;
    threeControls.maxDistance = 8;
    threeControls.enablePan = false;
    threeControls.autoRotate = true;
    threeControls.autoRotateSpeed = 1.5;

    canvas.addEventListener('touchstart', () => { threeControls.autoRotate = false; });
    canvas.addEventListener('mousedown',  () => { threeControls.autoRotate = false; });

    startRendering();
}

// ── Render loop — only runs when 3D is open ──
function startRendering() {
    isRendering = true;
    function loop() {
        if (!isRendering) return; // ← stop loop when viewer closes
        requestAnimationFrame(loop);
        threeControls && threeControls.update();
        threeRenderer && threeRenderer.render(threeScene, threeCamera);
    }
    loop();
}

function stopRendering() {
    isRendering = false;
}

// ── Load GLB Model ──
function loadGLBModel(modelPath) {
    const THREE = getThree();
    if (!THREE) return;
    if (loadedModel) { threeScene.remove(loadedModel); loadedModel = null; }

    document.getElementById('ar-loading').style.display = 'flex';
    const pb = document.getElementById('progress-bar');
    const pp = document.getElementById('progress-percent');
    const li = document.querySelector('.loading-icon');
    if (pb) pb.style.width = '0%';
    if (pp) pp.innerText = '0%';
    if (li && currentModel) li.innerText = menuData[currentModel].icon;

    const LoaderClass = (window.AFRAME && window.AFRAME.THREE && window.AFRAME.THREE.GLTFLoader)
        || window.GLTFLoader || THREE.GLTFLoader;
    if (!LoaderClass) return;

    const loader = new LoaderClass();

    // Draco decoder
    const DracoClass = window.DRACOLoader
        || (window.AFRAME && window.AFRAME.THREE && window.AFRAME.THREE.DRACOLoader);
    if (DracoClass) {
        const draco = new DracoClass();
        draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
        draco.setDecoderConfig({ type: 'js' });
        loader.setDRACOLoader(draco);
    }

    loader.load(modelPath,
        function(gltf) {
            if (pb) pb.style.width = '100%';
            if (pp) pp.innerText = '100%';
            loadedModel = gltf.scene;
            const box = new THREE.Box3().setFromObject(loadedModel);
            const center = box.getCenter(new THREE.Vector3());
            const size   = box.getSize(new THREE.Vector3());
            const scale  = 2.8 / Math.max(size.x, size.y, size.z);
            loadedModel.scale.setScalar(scale);
            loadedModel.position.sub(center.multiplyScalar(scale));
            // Enable shadows on all meshes
            loadedModel.traverse(child => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });
            threeScene.add(loadedModel);
            // Add steam effect for hot food
            addSteamEffect(loadedModel);
            setTimeout(() => { document.getElementById('ar-loading').style.display = 'none'; }, 200);
            threeCamera.position.set(0, 0.5, 3);
            threeControls && threeControls.reset();
            threeControls && (threeControls.autoRotate = true);
        },
        function(xhr) {
            if (xhr.lengthComputable) {
                const pct = Math.round((xhr.loaded / xhr.total) * 100);
                if (pb) pb.style.width = pct + '%';
                if (pp) pp.innerText = pct + '%';
            } else {
                const cur = parseFloat(pb && pb.style.width) || 0;
                if (cur < 90 && pb) pb.style.width = (cur + 1) + '%';
            }
        },
        function(err) {
            console.error('Model error:', err);
            document.getElementById('ar-loading').style.display = 'none';
            // Fallback sphere
            const geo = new THREE.SphereGeometry(1, 16, 16); // ← low poly fallback
            const mat = new THREE.MeshStandardMaterial({ color: 0xd4a574 });
            loadedModel = new THREE.Mesh(geo, mat);
            threeScene.add(loadedModel);
        }
    );
}

function resizeRenderer() {
    if (!threeRenderer || !threeCamera) return;
    const c = document.getElementById('viewer-3d');
    if (!c.clientWidth || !c.clientHeight) return;
    threeRenderer.setSize(c.clientWidth, c.clientHeight);
    threeCamera.aspect = c.clientWidth / c.clientHeight;
    threeCamera.updateProjectionMatrix();
}

// ── Shared UI ──
function updateViewerUI(modelId) {
    const item = menuData[modelId];
    arQty = 1;
    document.getElementById('ar-qty-num').innerText = '1';
    document.getElementById('ar-food-name').innerText = item.name;
    document.getElementById('ar-food-price').innerText = 'Rs. ' + item.price;
    document.getElementById('ar-detail-name').innerText = item.name;
    document.getElementById('ar-detail-price').innerText = 'Rs. ' + item.price;
    document.getElementById('ar-detail-desc').innerText = item.desc;
    document.getElementById('ar-cal-row').innerHTML =
        `<div class="cal-badge">🔥 ${item.calories}</div>
         <div class="cal-badge">⏱️ ${item.time}</div>
         <div class="cal-badge">⭐ ${item.rating}</div>`;
    // Size comparison
    const sizeRow = document.getElementById('ar-size-row');
    if (sizeRow) {
        sizeRow.innerHTML =
            `<div class="size-badge">📏 ${item.size}</div>
             <div class="size-badge">👥 ${item.serves}</div>
             <div class="size-badge">⚖️ ${item.weight}</div>`;
    }
    document.getElementById('menu-page').style.display = 'none';
    document.getElementById('bottom-nav').style.display = 'none';
    document.getElementById('cart-bar').classList.remove('visible');
    document.getElementById('ar-topbar').style.display = 'flex';
    document.getElementById('ar-bottombar').style.display = 'flex';
    document.getElementById('back-btn').classList.add('visible');
}

// ── Open 3D ──
function open3D(modelId) {
    currentModel = modelId;
    viewerMode = '3d';
    updateViewerUI(modelId);
    document.getElementById('viewer-3d').style.display = 'block';
    document.getElementById('viewer-ar').style.display = 'none';
    document.getElementById('ar-hint-bar').innerText = '☝️ Drag to rotate · 🤏 Pinch to zoom';
    if (!threeRenderer) initThreeJS();
    else startRendering(); // restart if stopped
    resizeRenderer();
    loadGLBModel(menuData[modelId].model);
    history.pushState({ page: '3d' }, '');
}

// ── Open AR ──
function openAR(modelId) {
    currentModel = modelId;
    viewerMode = 'ar';
    updateViewerUI(modelId);
    document.getElementById('viewer-ar').style.display = 'block';
    document.getElementById('viewer-3d').style.display = 'none';
    document.getElementById('ar-hint-bar').innerText = '📷 Scan image · ☝️ Drag to rotate · 🤏 Zoom';
    stopRendering(); // ← stop 3D render loop to free GPU for AR

    arRotY = 0; arRotX = 0;
    arScale = menuData[modelId].arScale || 0.5;

    // Hide all models first — show only when target detected
    ['ar-pizza','ar-burger','ar-drink'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.setAttribute('visible','false');
            el.setAttribute('scale', `${arScale} ${arScale} ${arScale}`);
        }
    });
    // Pre-set scale but keep hidden until target found
    const arEl = document.getElementById(menuData[modelId].arId);
    if (arEl) {
        arEl.setAttribute('scale', `${arScale} ${arScale} ${arScale}`);
        arEl.setAttribute('rotation','0 0 0');
        arEl.setAttribute('visible','false'); // hidden until detected
    }
    history.pushState({ page: 'ar' }, '');
}

// ── Close Viewer ──
function closeViewer() {
    currentModel = null; viewerMode = null;
    removeSteamEffect(); // ← remove steam particles
    stopRendering(); // ← stop render loop
    document.getElementById('viewer-3d').style.display = 'none';
    document.getElementById('viewer-ar').style.display = 'none';
    document.getElementById('ar-topbar').style.display = 'none';
    document.getElementById('ar-bottombar').style.display = 'none';
    document.getElementById('back-btn').classList.remove('visible');
    document.getElementById('menu-page').style.display = 'flex';
    document.getElementById('bottom-nav').style.display = 'flex';
    ['ar-pizza','ar-burger','ar-drink'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.setAttribute('visible','false');
    });
    updateCartBar();
}

function resetModel() {
    if (viewerMode === '3d' && threeControls) {
        threeControls.reset();
        threeControls.autoRotate = true;
    }
    if (viewerMode === 'ar') {
        arRotY = 0; arRotX = 0;
        const arEl = currentModel && document.getElementById(menuData[currentModel].arId);
        if (arEl) arEl.setAttribute('rotation','0 0 0');
    }
}

// ── Cart ──
function quickAdd(id) { addItemToCart(id,1); showToast('✅', menuData[id].name+' added!', 'Rs.'+menuData[id].price); }
function addToCart()   {
    if (!currentModel) return;
    addItemToCart(currentModel, arQty);
    showToast('🛒', menuData[currentModel].name+' ×'+arQty+' added!', 'Rs.'+(menuData[currentModel].price*arQty));
}
function addItemToCart(id,qty) {
    cart[id] ? cart[id].qty += qty : cart[id] = { qty };
    updateCartBar();
}
function removeFromCart(id) {
    if (!cart[id]) return;
    cart[id].qty--;
    if (cart[id].qty <= 0) delete cart[id];
    renderCartPage(); updateCartBar();
}
function addFromCart(id) { if (cart[id]) cart[id].qty++; renderCartPage(); updateCartBar(); }
function getCartCount() { return Object.values(cart).reduce((s,v)=>s+v.qty,0); }
function getCartTotal() { return Object.entries(cart).reduce((s,[id,v])=>s+menuData[id].price*v.qty,0); }
function updateCartBar() {
    const count=getCartCount(), total=getCartTotal(), bar=document.getElementById('cart-bar');
    if (count>0) {
        bar.classList.add('visible');
        document.getElementById('cart-count').innerText = count+' item'+(count>1?'s':'');
        document.getElementById('cart-total').innerText = 'Rs. '+total;
    } else bar.classList.remove('visible');
}
function changeQty(d) { arQty=Math.max(1,Math.min(10,arQty+d)); document.getElementById('ar-qty-num').innerText=arQty; }
function orderNow()    { if (!currentModel) return; addItemToCart(currentModel,arQty); closeViewer(); setTimeout(placeOrder,300); }
function openCart()    { renderCartPage(); document.getElementById('cart-page').classList.add('open'); history.pushState({page:'cart'},''); }
function closeCart()   { document.getElementById('cart-page').classList.remove('open'); }

function renderCartPage() {
    const container=document.getElementById('cart-items'), empty=document.getElementById('empty-cart'), keys=Object.keys(cart);
    if (!keys.length) { container.innerHTML=''; empty.style.display='flex'; }
    else {
        empty.style.display='none';
        container.innerHTML = keys.map(id=>{
            const item=menuData[id], qty=cart[id].qty, total=item.price*qty;
            return `<div class="cart-item">
                <div class="cart-item-icon">${item.icon}</div>
                <div class="cart-item-info">
                    <div class="cart-item-name">${item.name}</div>
                    <div class="cart-item-price">Rs.${item.price} × ${qty} = Rs.${total}</div>
                </div>
                <div class="qty-controls">
                    <button class="qty-btn" onclick="removeFromCart('${id}')">−</button>
                    <div class="qty-num">${qty}</div>
                    <button class="qty-btn" onclick="addFromCart('${id}')">+</button>
                </div>
            </div>`;
        }).join('');
    }
    const sub=getCartTotal(), tax=Math.round(sub*0.05);
    document.getElementById('summary-subtotal').innerText='Rs.'+sub;
    document.getElementById('summary-tax').innerText='Rs.'+tax;
    document.getElementById('summary-total').innerText='Rs.'+(sub+tax);
}

function placeOrder() {
    if (!getCartCount()) return;
    document.getElementById('order-id-text').innerText='Order #'+Math.floor(1000+Math.random()*9000);
    cart={}; updateCartBar();
    document.getElementById('cart-page').classList.remove('open');
    document.getElementById('order-success').classList.add('open');
}
function backToMenu() { document.getElementById('order-success').classList.remove('open'); showMenu(); }
function showMenu()   { document.getElementById('menu-page').style.display='flex'; document.getElementById('bottom-nav').style.display='flex'; }

window.addEventListener('popstate', function() {
    if (document.getElementById('viewer-3d').style.display==='block' || document.getElementById('viewer-ar').style.display==='block') { closeViewer(); return; }
    if (document.getElementById('cart-page').classList.contains('open')) { closeCart(); return; }
    if (document.getElementById('order-success').classList.contains('open')) { backToMenu(); return; }
});
history.pushState({page:'menu'},'');

function showToast(icon,msg,sub) {
    document.getElementById('toast-icon').innerText=icon;
    document.getElementById('toast-msg').innerText=msg;
    document.getElementById('toast-sub').innerText=sub;
    const t=document.getElementById('toast');
    t.style.display='block';
    setTimeout(()=>{ t.style.display='none'; },1800);
}
window.addEventListener('resize', resizeRenderer);

// ── AR Touch Controls ──
let arRotY=0, arRotX=0, arScale=0.5;
const arMinScale=0.05, arMaxScale=4.0;
let arLastX=null, arLastY=null, arLastPinch=null;

function getArModel() { return currentModel ? document.getElementById(menuData[currentModel].arId) : null; }
function pinchDist(t) { return Math.hypot(t[0].clientX-t[1].clientX, t[0].clientY-t[1].clientY); }

document.addEventListener('touchstart', e=>{
    if (viewerMode!=='ar') return;
    if (e.target.closest('#ar-bottombar')||e.target.closest('#back-btn')) return;
    if (e.touches.length===1) { arLastX=e.touches[0].clientX; arLastY=e.touches[0].clientY; arLastPinch=null; }
    else if (e.touches.length===2) { arLastPinch=pinchDist(e.touches); arLastX=null; arLastY=null; }
},{ passive:true });

document.addEventListener('touchmove', e=>{
    if (viewerMode!=='ar') return;
    if (e.target.closest('#ar-bottombar')||e.target.closest('#back-btn')) return;
    const el=getArModel(); if (!el) return;
    if (e.touches.length===1 && arLastX!==null) {
        const dx=e.touches[0].clientX-arLastX, dy=e.touches[0].clientY-arLastY;
        arRotY+=dx; arRotX+=dy;
        el.setAttribute('rotation',`${arRotX} ${arRotY} 0`);
        arLastX=e.touches[0].clientX; arLastY=e.touches[0].clientY;
    } else if (e.touches.length===2 && arLastPinch!==null) {
        const nd=pinchDist(e.touches), delta=nd-arLastPinch;
        arScale=Math.max(arMinScale, Math.min(arMaxScale, arScale+delta*0.008));
        el.setAttribute('scale',`${arScale} ${arScale} ${arScale}`);
        arLastPinch=nd;
    }
},{ passive:true });

document.addEventListener('touchend', ()=>{ arLastX=null; arLastY=null; arLastPinch=null; });

// ============================================
// AR SCANNING GUIDE + VIBRATION
// ============================================
let arDetected = false;

function initARDetection() {
    const scene = document.querySelector('a-scene');
    if (!scene) return;

    // MindAR target found/lost events
    const target = document.querySelector('[mindar-image-target]');
    if (target) {
        target.addEventListener('targetFound', function() {
            console.log('Target found!');
            onARDetected();
            // Make sure correct model is visible
            if (currentModel) {
                const arEl = document.getElementById(menuData[currentModel].arId);
                if (arEl) {
                    arEl.setAttribute('visible', 'true');
                    arEl.setAttribute('scale', `${arScale} ${arScale} ${arScale}`);
                }
            }
        });
        target.addEventListener('targetLost', function() {
            console.log('Target lost!');
            onARLost();
        });
    }
}

// Animate progress dots while scanning
let dotInterval = null;
let dotIndex = 0;

function startDotAnimation() {
    const dots = document.querySelectorAll('.scan-dot');
    dotInterval = setInterval(() => {
        dots.forEach(d => d.classList.remove('active'));
        dots[dotIndex % dots.length].classList.add('active');
        dotIndex++;
    }, 600);
}

function stopDotAnimation() {
    if (dotInterval) { clearInterval(dotInterval); dotInterval = null; }
}

function onARDetected() {
    if (arDetected) return;
    arDetected = true;
    stopDotAnimation();

    // ✅ SHOW the 3D model when target is found
    if (currentModel) {
        const arEl = document.getElementById(menuData[currentModel].arId);
        if (arEl) {
            arEl.setAttribute('visible', 'true');
            arEl.setAttribute('scale', `${arScale} ${arScale} ${arScale}`);
            arEl.setAttribute('rotation', '0 0 0');
        }
    }

    // Hide scanning guide smoothly
    const overlay = document.getElementById('scan-overlay');
    if (overlay) overlay.classList.add('hidden');

    // Show detected message
    const detected = document.getElementById('ar-detected');
    if (detected) {
        detected.style.display = 'flex';
        setTimeout(() => { detected.style.display = 'none'; }, 2500);
    }

    // Show controls hint
    const hint = document.getElementById('ar-controls-hint');
    if (hint) {
        hint.classList.add('visible');
        setTimeout(() => { hint.classList.remove('visible'); }, 4000);
    }

    // Vibrate phone
    if (navigator.vibrate) navigator.vibrate([100, 50, 200]);

    // Play success sound
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        [600, 800, 1000].forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0.2, ctx.currentTime + i * 0.1);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.1 + 0.2);
            osc.start(ctx.currentTime + i * 0.1);
            osc.stop(ctx.currentTime + i * 0.1 + 0.2);
        });
    } catch(e) {}
}

function onARLost() {
    arDetected = false;

    // Hide model when target lost
    if (currentModel) {
        const arEl = document.getElementById(menuData[currentModel].arId);
        if (arEl) arEl.setAttribute('visible', 'false');
    }

    const overlay = document.getElementById('scan-overlay');
    if (overlay) overlay.classList.remove('hidden');
    const hint = document.getElementById('ar-controls-hint');
    if (hint) hint.classList.remove('visible');
    startDotAnimation();
}

// Show/hide scan overlay when opening/closing AR
const _openAR = openAR;
openAR = function(modelId) {
    _openAR(modelId);
    arDetected = false;
    const overlay = document.getElementById('scan-overlay');
    if (overlay) overlay.classList.remove('hidden');
    // Init detection after scene loads
    setTimeout(initARDetection, 2000);
    // Start dot animation
    startDotAnimation();
    // Fix white screen - force video to show
    fixARVideo();
};

function fixARVideo() {
    // Run multiple times to catch video after it loads
    const attempts = [100, 500, 1000, 2000, 3000];
    attempts.forEach(delay => {
        setTimeout(() => {
            const videos = document.querySelectorAll('#viewer-ar video');
            videos.forEach(v => {
                v.style.cssText = `
                    position: fixed !important;
                    top: 0 !important;
                    left: 0 !important;
                    width: 100% !important;
                    height: 100% !important;
                    object-fit: cover !important;
                    z-index: 1 !important;
                    display: block !important;
                    opacity: 1 !important;
                    visibility: visible !important;
                `;
                // Force play if paused
                if (v.paused) v.play().catch(() => {});
            });

            // Also fix canvas z-index
            const canvases = document.querySelectorAll('#viewer-ar canvas');
            canvases.forEach(c => {
                c.style.cssText = `
                    position: fixed !important;
                    top: 0 !important;
                    left: 0 !important;
                    width: 100% !important;
                    height: 100% !important;
                    z-index: 2 !important;
                `;
            });
        }, delay);
    });
}

const _closeViewer = closeViewer;
closeViewer = function() {
    _closeViewer();
    arDetected = false;
    stopDotAnimation();
    if (videoFixInterval) { clearInterval(videoFixInterval); videoFixInterval = null; }
    const overlay = document.getElementById('scan-overlay');
    if (overlay) overlay.classList.remove('hidden');
    const hint = document.getElementById('ar-controls-hint');
    if (hint) hint.classList.remove('visible');
};

// ============================================
// STEAM EFFECT — rising particles for hot food
// ============================================
let steamParticles = null;
let steamAnimId = null;

function addSteamEffect(model) {
    const THREE = getThree();
    if (!THREE) return;

    // Only add steam for pizza and burger (hot food)
    if (currentModel === 'drink') return;

    // Remove old steam
    removeSteamEffect();

    const particleCount = 30;
    const positions = new Float32Array(particleCount * 3);
    const opacities  = new Float32Array(particleCount);
    const speeds     = new Float32Array(particleCount);
    const offsets    = new Float32Array(particleCount);

    for (let i = 0; i < particleCount; i++) {
        positions[i * 3]     = (Math.random() - 0.5) * 1.5; // x spread
        positions[i * 3 + 1] = Math.random() * 2;            // y start
        positions[i * 3 + 2] = (Math.random() - 0.5) * 1.5; // z spread
        opacities[i] = Math.random();
        speeds[i]    = 0.005 + Math.random() * 0.01;
        offsets[i]   = Math.random() * Math.PI * 2;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const mat = new THREE.PointsMaterial({
        color: 0xcccccc,
        size: 0.15,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
    });

    steamParticles = new THREE.Points(geo, mat);
    steamParticles.position.y = 1.0; // above the food
    threeScene.add(steamParticles);

    // Animate steam
    let frame = 0;
    function animateSteam() {
        steamAnimId = requestAnimationFrame(animateSteam);
        if (!steamParticles) return;
        frame++;
        const pos = steamParticles.geometry.attributes.position;
        for (let i = 0; i < particleCount; i++) {
            // Rise upward
            pos.array[i * 3 + 1] += speeds[i];
            // Drift sideways like real steam
            pos.array[i * 3]     += Math.sin(frame * 0.02 + offsets[i]) * 0.003;
            pos.array[i * 3 + 2] += Math.cos(frame * 0.02 + offsets[i]) * 0.003;
            // Reset when too high
            if (pos.array[i * 3 + 1] > 3) {
                pos.array[i * 3]     = (Math.random() - 0.5) * 1.5;
                pos.array[i * 3 + 1] = 0;
                pos.array[i * 3 + 2] = (Math.random() - 0.5) * 1.5;
            }
        }
        pos.needsUpdate = true;
        // Fade opacity
        mat.opacity = 0.3 + Math.sin(frame * 0.05) * 0.1;
    }
    animateSteam();
}

function removeSteamEffect() {
    if (steamParticles) {
        threeScene.remove(steamParticles);
        steamParticles = null;
    }
    if (steamAnimId) {
        cancelAnimationFrame(steamAnimId);
        steamAnimId = null;
    }
}
