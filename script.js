// ============================================
// FOOD DATA
// ============================================
const menuData = {
    pizza: {
        icon: '🍕', name: 'Margherita Pizza', price: 150,
        desc: 'Fresh tomato sauce, mozzarella cheese and aromatic basil on a perfectly crispy thin crust.',
        calories: '320 kcal', time: '15 min', rating: '4.8',
        model: './pizza.glb', arId: 'ar-pizza',
    },
    burger: {
        icon: '🍔', name: 'Classic Burger', price: 200,
        desc: 'Juicy beef patty with melted cheese, crisp lettuce and tomato in a toasted sesame bun.',
        calories: '540 kcal', time: '10 min', rating: '4.7',
        model: './burger.glb', arId: 'ar-burger',
    },
    drink: {
        icon: '🥤', name: 'Fresh Lemonade', price: 80,
        desc: 'Cold pressed lemonade with fresh mint leaves, a squeeze of lime and a hint of honey.',
        calories: '85 kcal', time: '5 min', rating: '4.9',
        model: './drink.glb', arId: 'ar-drink',
    },
};

let cart = {};
let currentModel = null;
let arQty = 1;
let viewerMode = null;
let threeRenderer, threeScene, threeCamera, threeControls;
let loadedModel = null;
let T = null; // Three.js reference

// ============================================
// GET THREE.JS — use AFRAME's version
// ============================================
function getThree() {
    if (T) return T;
    // Use AFRAME's bundled Three.js to avoid conflicts
    if (window.AFRAME && window.AFRAME.THREE) {
        T = window.AFRAME.THREE;
    } else if (window.THREE) {
        T = window.THREE;
    }
    return T;
}

// ============================================
// THREE.JS INIT
// ============================================
function initThreeJS() {
    const THREE = getThree();
    if (!THREE) { console.error('Three.js not found'); return; }

    const canvas = document.getElementById('three-canvas');
    const container = document.getElementById('viewer-3d');

    threeRenderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    threeRenderer.setPixelRatio(window.devicePixelRatio);
    threeRenderer.setSize(container.clientWidth, container.clientHeight);
    threeRenderer.shadowMap.enabled = true;
    threeRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    threeRenderer.toneMappingExposure = 1.5;

    threeScene = new THREE.Scene();
    // Premium dark background - food looks best on dark
    threeScene.background = new THREE.Color(0x0f0f0f);

    threeCamera = new THREE.PerspectiveCamera(38, container.clientWidth / container.clientHeight, 0.1, 100);
    threeCamera.position.set(0, 0.8, 2.5);

    // Bright realistic lighting
    threeScene.add(new THREE.AmbientLight(0xfff8f0, 2.5));

    const keyLight = new THREE.DirectionalLight(0xffffff, 3.0);
    keyLight.position.set(3, 8, 5);
    keyLight.castShadow = true;
    threeScene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xffe8d0, 2.0);
    fillLight.position.set(-4, 4, -3);
    threeScene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xffd0a0, 1.5);
    rimLight.position.set(0, 3, -5);
    threeScene.add(rimLight);

    const bottomLight = new THREE.PointLight(0xffcc88, 1.5, 10);
    bottomLight.position.set(0, -2, 2);
    threeScene.add(bottomLight);

    // Get OrbitControls
    const OC = THREE.OrbitControls || window.OrbitControls;
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
    canvas.addEventListener('mousedown', () => { threeControls.autoRotate = false; });

    animate();
}

function animate() {
    requestAnimationFrame(animate);
    if (threeControls) threeControls.update();
    if (threeRenderer && threeScene && threeCamera) {
        threeRenderer.render(threeScene, threeCamera);
    }
}

function loadGLBModel(modelPath) {
    const THREE = getThree();
    if (!THREE) return;

    if (loadedModel) { threeScene.remove(loadedModel); loadedModel = null; }
    document.getElementById('ar-loading').style.display = 'flex';

    // Use AFRAME's GLTFLoader or window.GLTFLoader
    const LoaderClass = (window.AFRAME && window.AFRAME.THREE && window.AFRAME.THREE.GLTFLoader)
        || window.GLTFLoader
        || THREE.GLTFLoader;

    if (!LoaderClass) { console.error('GLTFLoader not found'); return; }
    const loader = new LoaderClass();

    // Set up Draco decoder for compressed models
    const DracoClass = window.DRACOLoader || (window.AFRAME && window.AFRAME.THREE && window.AFRAME.THREE.DRACOLoader);
    if (DracoClass) {
        const dracoLoader = new DracoClass();
        // Use Google's hosted Draco decoder which is always available
        dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
        dracoLoader.setDecoderConfig({ type: 'js' });
        loader.setDRACOLoader(dracoLoader);
    }

    // Reset progress bar
    const progressBar = document.getElementById('progress-bar');
    const progressPercent = document.getElementById('progress-percent');
    const loadingIcon = document.querySelector('.loading-icon');
    if (progressBar) progressBar.style.width = '0%';
    if (progressPercent) progressPercent.innerText = '0%';

    loader.load(modelPath,
        function (gltf) {
            // 100% complete
            if (progressBar) progressBar.style.width = '100%';
            if (progressPercent) progressPercent.innerText = '100%';

            loadedModel = gltf.scene;
            const box = new THREE.Box3().setFromObject(loadedModel);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());
            const scale = 2.8 / Math.max(size.x, size.y, size.z);
            loadedModel.scale.setScalar(scale);
            loadedModel.position.sub(center.multiplyScalar(scale));
            threeScene.add(loadedModel);

            // Hide loading after short delay
            setTimeout(() => {
                document.getElementById('ar-loading').style.display = 'none';
            }, 300);

            threeCamera.position.set(0, 0.8, 2.5);
            threeControls.reset();
            threeControls.autoRotate = true;
        },
        function (xhr) {
            // Show progress
            if (xhr.lengthComputable) {
                const percent = Math.round((xhr.loaded / xhr.total) * 100);
                if (progressBar) progressBar.style.width = percent + '%';
                if (progressPercent) progressPercent.innerText = percent + '%';
                // Change icon based on item
                if (loadingIcon && currentModel) {
                    loadingIcon.innerText = menuData[currentModel].icon;
                }
            } else {
                // Unknown size - animate bar
                if (progressBar) {
                    const current = parseFloat(progressBar.style.width) || 0;
                    if (current < 90) progressBar.style.width = (current + 2) + '%';
                }
            }
        },
        function (error) {
            console.error('Model load error:', error);
            document.getElementById('ar-loading').style.display = 'none';
            // Show fallback sphere
            const geo = new THREE.SphereGeometry(1, 32, 32);
            const mat = new THREE.MeshStandardMaterial({ color: 0xd4a574 });
            loadedModel = new THREE.Mesh(geo, mat);
            threeScene.add(loadedModel);
        }
    );
}

function resizeRenderer() {
    if (!threeRenderer || !threeCamera) return;
    const container = document.getElementById('viewer-3d');
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === 0 || h === 0) return;
    threeRenderer.setSize(w, h);
    threeCamera.aspect = w / h;
    threeCamera.updateProjectionMatrix();
}

// ============================================
// UPDATE SHARED UI
// ============================================
function updateViewerUI(modelId) {
    const item = menuData[modelId];
    arQty = 1;
    document.getElementById('ar-qty-num').innerText = '1';
    document.getElementById('ar-food-name').innerText = item.name;
    document.getElementById('ar-food-price').innerText = 'Rs. ' + item.price;
    document.getElementById('ar-detail-name').innerText = item.name;
    document.getElementById('ar-detail-price').innerText = 'Rs. ' + item.price;
    document.getElementById('ar-detail-desc').innerText = item.desc;
    document.getElementById('ar-cal-row').innerHTML = `
        <div class="cal-badge">🔥 ${item.calories}</div>
        <div class="cal-badge">⏱️ ${item.time}</div>
        <div class="cal-badge">⭐ ${item.rating}</div>`;
    document.getElementById('menu-page').style.display = 'none';
    document.getElementById('bottom-nav').style.display = 'none';
    document.getElementById('cart-bar').classList.remove('visible');
    document.getElementById('ar-topbar').style.display = 'flex';
    document.getElementById('ar-bottombar').style.display = 'flex';
    document.getElementById('back-btn').classList.add('visible');
}

// ============================================
// OPEN 3D
// ============================================
function open3D(modelId) {
    currentModel = modelId;
    viewerMode = '3d';
    updateViewerUI(modelId);
    document.getElementById('viewer-3d').style.display = 'block';
    document.getElementById('viewer-ar').style.display = 'none';
    document.getElementById('ar-hint-bar').innerText = '☝️ Drag to rotate · 🤏 Pinch to zoom';
    if (!threeRenderer) initThreeJS();
    resizeRenderer();
    loadGLBModel(menuData[modelId].model);
    history.pushState({ page: '3d' }, '');
}

// ============================================
// OPEN AR
// ============================================
function openAR(modelId) {
    currentModel = modelId;
    viewerMode = 'ar';
    updateViewerUI(modelId);
    document.getElementById('viewer-ar').style.display = 'block';
    document.getElementById('viewer-3d').style.display = 'none';
    document.getElementById('ar-hint-bar').innerText = '📷 Scan image · ☝️ Drag to rotate · 🤏 Pinch to zoom';
    ['ar-pizza', 'ar-burger', 'ar-drink'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.setAttribute('visible', 'false');
    });

    // Different scale per item
    const arScales = { pizza: 0.5, burger: 0.3, drink: 0.5 };
    arRotY = 0;
    arScale = arScales[modelId] || 0.5;

    const arEl = document.getElementById(menuData[modelId].arId);
    if (arEl) {
        arEl.setAttribute('visible', 'true');
        arEl.setAttribute('position', '0 0.05 0');
        arEl.setAttribute('scale', `${arScale} ${arScale} ${arScale}`);
        arEl.setAttribute('rotation', '0 0 0');
    }
    history.pushState({ page: 'ar' }, '');
}

// ============================================
// CLOSE VIEWER
// ============================================
function closeViewer() {
    currentModel = null;
    viewerMode = null;
    document.getElementById('viewer-3d').style.display = 'none';
    document.getElementById('viewer-ar').style.display = 'none';
    document.getElementById('ar-topbar').style.display = 'none';
    document.getElementById('ar-bottombar').style.display = 'none';
    document.getElementById('back-btn').classList.remove('visible');
    document.getElementById('menu-page').style.display = 'flex';
    document.getElementById('bottom-nav').style.display = 'flex';
    ['ar-pizza', 'ar-burger', 'ar-drink'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.setAttribute('visible', 'false');
    });
    if (threeControls) threeControls.autoRotate = false;
    updateCartBar();
}

function resetModel() {
    if (viewerMode === '3d' && threeControls) {
        threeControls.reset();
        threeControls.autoRotate = true;
    }
}

// ============================================
// CART
// ============================================
function quickAdd(id) {
    addItemToCart(id, 1);
    showToast('✅', menuData[id].name + ' added!', 'Rs. ' + menuData[id].price);
}

function addToCart() {
    if (!currentModel) return;
    addItemToCart(currentModel, arQty);
    showToast('🛒', menuData[currentModel].name + ' × ' + arQty + ' added!', 'Rs. ' + (menuData[currentModel].price * arQty));
}

function addItemToCart(id, qty) {
    if (cart[id]) { cart[id].qty += qty; } else { cart[id] = { qty: qty }; }
    updateCartBar();
}

function removeFromCart(id) {
    if (!cart[id]) return;
    cart[id].qty -= 1;
    if (cart[id].qty <= 0) delete cart[id];
    renderCartPage(); updateCartBar();
}

function addFromCart(id) {
    if (cart[id]) cart[id].qty += 1;
    renderCartPage(); updateCartBar();
}

function getCartCount() { return Object.values(cart).reduce((s, v) => s + v.qty, 0); }
function getCartTotal() { return Object.entries(cart).reduce((s, [id, v]) => s + menuData[id].price * v.qty, 0); }

function updateCartBar() {
    const count = getCartCount(), total = getCartTotal();
    const bar = document.getElementById('cart-bar');
    if (count > 0) {
        bar.classList.add('visible');
        document.getElementById('cart-count').innerText = count + ' item' + (count > 1 ? 's' : '');
        document.getElementById('cart-total').innerText = 'Rs. ' + total;
    } else { bar.classList.remove('visible'); }
}

function changeQty(delta) {
    arQty = Math.max(1, Math.min(10, arQty + delta));
    document.getElementById('ar-qty-num').innerText = arQty;
}

function orderNow() {
    if (!currentModel) return;
    addItemToCart(currentModel, arQty);
    closeViewer();
    setTimeout(() => placeOrder(), 300);
}

function openCart() {
    renderCartPage();
    document.getElementById('cart-page').classList.add('open');
    history.pushState({ page: 'cart' }, '');
}

function closeCart() { document.getElementById('cart-page').classList.remove('open'); }

function renderCartPage() {
    const container = document.getElementById('cart-items');
    const empty = document.getElementById('empty-cart');
    const keys = Object.keys(cart);
    if (keys.length === 0) { container.innerHTML = ''; empty.style.display = 'flex'; }
    else {
        empty.style.display = 'none';
        container.innerHTML = keys.map(id => {
            const item = menuData[id], qty = cart[id].qty, total = item.price * qty;
            return `<div class="cart-item">
                <div class="cart-item-icon">${item.icon}</div>
                <div class="cart-item-info">
                    <div class="cart-item-name">${item.name}</div>
                    <div class="cart-item-price">Rs. ${item.price} × ${qty} = Rs. ${total}</div>
                </div>
                <div class="qty-controls">
                    <button class="qty-btn" onclick="removeFromCart('${id}')">−</button>
                    <div class="qty-num">${qty}</div>
                    <button class="qty-btn" onclick="addFromCart('${id}')">+</button>
                </div>
            </div>`;
        }).join('');
    }
    const subtotal = getCartTotal(), tax = Math.round(subtotal * 0.05);
    document.getElementById('summary-subtotal').innerText = 'Rs. ' + subtotal;
    document.getElementById('summary-tax').innerText = 'Rs. ' + tax;
    document.getElementById('summary-total').innerText = 'Rs. ' + (subtotal + tax);
}

function placeOrder() {
    if (getCartCount() === 0) return;
    document.getElementById('order-id-text').innerText = 'Order #' + Math.floor(1000 + Math.random() * 9000);
    cart = {}; updateCartBar();
    document.getElementById('cart-page').classList.remove('open');
    document.getElementById('order-success').classList.add('open');
}

function backToMenu() { document.getElementById('order-success').classList.remove('open'); showMenu(); }
function showMenu() {
    document.getElementById('menu-page').style.display = 'flex';
    document.getElementById('bottom-nav').style.display = 'flex';
}

window.addEventListener('popstate', function () {
    if (document.getElementById('viewer-3d').style.display === 'block' ||
        document.getElementById('viewer-ar').style.display === 'block') { closeViewer(); return; }
    if (document.getElementById('cart-page').classList.contains('open')) { closeCart(); return; }
    if (document.getElementById('order-success').classList.contains('open')) { backToMenu(); return; }
});

history.pushState({ page: 'menu' }, '');

function showToast(icon, msg, sub) {
    document.getElementById('toast-icon').innerText = icon;
    document.getElementById('toast-msg').innerText = msg;
    document.getElementById('toast-sub').innerText = sub;
    const toast = document.getElementById('toast');
    toast.style.display = 'block';
    setTimeout(() => { toast.style.display = 'none'; }, 1800);
}

window.addEventListener('resize', resizeRenderer);

// ============================================
// AR TOUCH CONTROLS — rotate and zoom in AR
// ============================================
let arRotY = 0;
let arScale = 0.8;
const arMinScale = 0.1;
const arMaxScale = 4.0;
let arLastTouchX = null;
let arLastPinchDist = null;

function getArModel() {
    if (!currentModel) return null;
    return document.getElementById(menuData[currentModel].arId);
}

function arGetPinchDist(t) {
    const dx = t[0].clientX - t[1].clientX;
    const dy = t[0].clientY - t[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
}

document.addEventListener('touchstart', function(e) {
    if (viewerMode !== 'ar') return;
    if (e.target.closest('#ar-bottombar') || e.target.closest('#back-btn')) return;
    if (e.touches.length === 1) {
        arLastTouchX = e.touches[0].clientX;
        arLastPinchDist = null;
    } else if (e.touches.length === 2) {
        arLastPinchDist = arGetPinchDist(e.touches);
        arLastTouchX = null;
    }
}, { passive: true });

document.addEventListener('touchmove', function(e) {
    if (viewerMode !== 'ar') return;
    if (e.target.closest('#ar-bottombar') || e.target.closest('#back-btn')) return;
    const el = getArModel();
    if (!el) return;

    if (e.touches.length === 1 && arLastTouchX !== null) {
        // Full 360 rotation - faster and unlimited
        const dx = e.touches[0].clientX - arLastTouchX;
        arRotY += dx * 1.0;
        // 360 rotation - no limit on arRotY
        el.setAttribute('rotation', `0 ${arRotY} 0`);
        arLastTouchX = e.touches[0].clientX;
    } else if (e.touches.length === 2 && arLastPinchDist !== null) {
        // More zoom range
        const newDist = arGetPinchDist(e.touches);
        const delta = newDist - arLastPinchDist;
        arScale += delta * 0.008;
        if (arScale < arMinScale) arScale = arMinScale;
        if (arScale > arMaxScale) arScale = arMaxScale;
        el.setAttribute('scale', `${arScale} ${arScale} ${arScale}`);
        arLastPinchDist = newDist;
    }
}, { passive: true });

document.addEventListener('touchend', function() {
    arLastTouchX = null;
    arLastPinchDist = null;
});
