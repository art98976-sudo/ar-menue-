// ============================================
// FOOD DATA — edit prices, names, desc here
// ============================================
const menuData = {
    pizza: {
        icon: '🍕', name: 'Margherita Pizza', price: 150,
        desc: 'Fresh tomato sauce, mozzarella cheese and aromatic basil on a perfectly crispy thin crust.',
        calories: '320 kcal', time: '15 min', rating: '4.8',
        scale: 0.5, posY: 0.1,
    },
    burger: {
        icon: '🍔', name: 'Classic Burger', price: 200,
        desc: 'Juicy beef patty with melted cheese, crisp lettuce and tomato in a toasted sesame bun.',
        calories: '540 kcal', time: '10 min', rating: '4.7',
        scale: 0.5, posY: 0.1,
    },
    drink: {
        icon: '🥤', name: 'Fresh Lemonade', price: 80,
        desc: 'Cold pressed lemonade with fresh mint leaves, a squeeze of lime and a hint of honey.',
        calories: '85 kcal', time: '5 min', rating: '4.9',
        scale: 0.5, posY: 0.1,
    },
};

// ============================================
// CART STATE
// ============================================
let cart = {};

// ============================================
// AR STATE
// ============================================
let currentModel = null;
let arQty = 1;
let rotX = 0, rotY = 0, rotZ = 0;
let currentScale = 0.5;
const minScale = 0.1;
const maxScale = 3.0;
let lastTouchX = null;
let lastTouchY = null;
let lastPinchDist = null;
const rotateSpeed = 0.4;
const pinchSpeed = 0.01;

// ============================================
// CART FUNCTIONS
// ============================================
function quickAdd(id) {
    addItemToCart(id, 1);
    showToast('✅', menuData[id].name + ' added!', 'Rs. ' + menuData[id].price);
}

function addToCart() {
    if (!currentModel) return;
    addItemToCart(currentModel, arQty);
    showToast('🛒', menuData[currentModel].name + ' × ' + arQty + ' added!',
        'Rs. ' + (menuData[currentModel].price * arQty));
}

function addItemToCart(id, qty) {
    if (cart[id]) {
        cart[id].qty += qty;
    } else {
        cart[id] = { qty: qty };
    }
    updateCartBar();
}

function removeFromCart(id) {
    if (!cart[id]) return;
    cart[id].qty -= 1;
    if (cart[id].qty <= 0) delete cart[id];
    renderCartPage();
    updateCartBar();
}

function addFromCart(id) {
    if (cart[id]) cart[id].qty += 1;
    renderCartPage();
    updateCartBar();
}

function getCartCount() {
    return Object.values(cart).reduce((sum, v) => sum + v.qty, 0);
}

function getCartTotal() {
    return Object.entries(cart).reduce((sum, [id, v]) => {
        return sum + (menuData[id].price * v.qty);
    }, 0);
}

function updateCartBar() {
    const count = getCartCount();
    const total = getCartTotal();
    const bar = document.getElementById('cart-bar');
    if (count > 0) {
        bar.classList.add('visible');
        document.getElementById('cart-count').innerText = count + ' item' + (count > 1 ? 's' : '');
        document.getElementById('cart-total').innerText = 'Rs. ' + total;
    } else {
        bar.classList.remove('visible');
    }
}

// ============================================
// QUANTITY IN AR PANEL
// ============================================
function changeQty(delta) {
    arQty = Math.max(1, Math.min(10, arQty + delta));
    document.getElementById('ar-qty-num').innerText = arQty;
}

// ============================================
// ORDER NOW FROM AR (skip cart)
// ============================================
function orderNow() {
    if (!currentModel) return;
    addItemToCart(currentModel, arQty);
    closeAR();
    setTimeout(() => placeOrder(), 300);
}

// ============================================
// OPEN / CLOSE CART PAGE
// ============================================
function openCart() {
    renderCartPage();
    document.getElementById('cart-page').classList.add('open');
}

function closeCart() {
    document.getElementById('cart-page').classList.remove('open');
}

function renderCartPage() {
    const container = document.getElementById('cart-items');
    const empty = document.getElementById('empty-cart');
    const keys = Object.keys(cart);

    if (keys.length === 0) {
        container.innerHTML = '';
        empty.style.display = 'flex';
    } else {
        empty.style.display = 'none';
        container.innerHTML = keys.map(id => {
            const item = menuData[id];
            const qty = cart[id].qty;
            const total = item.price * qty;
            return `
            <div class="cart-item">
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

    const subtotal = getCartTotal();
    const tax = Math.round(subtotal * 0.05);
    const total = subtotal + tax;
    document.getElementById('summary-subtotal').innerText = 'Rs. ' + subtotal;
    document.getElementById('summary-tax').innerText = 'Rs. ' + tax;
    document.getElementById('summary-total').innerText = 'Rs. ' + total;
}

// ============================================
// PLACE ORDER
// ============================================
function placeOrder() {
    if (getCartCount() === 0) return;
    const orderId = '#' + Math.floor(1000 + Math.random() * 9000);
    document.getElementById('order-id-text').innerText = 'Order ' + orderId;
    cart = {};
    updateCartBar();
    document.getElementById('cart-page').classList.remove('open');
    document.getElementById('order-success').classList.add('open');
}

// ============================================
// BACK TO MENU
// ============================================
function backToMenu() {
    document.getElementById('order-success').classList.remove('open');
    showMenu();
}

function showMenu() {
    document.getElementById('menu-page').style.display = 'flex';
    document.getElementById('bottom-nav').style.display = 'flex';
}

// ============================================
// OPEN AR
// ============================================
function openAR(modelId) {
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

    Object.keys(menuData).forEach(id => {
        const el = document.getElementById(id);
        if (el) el.setAttribute('visible', 'false');
    });

    const el = document.getElementById(modelId);
    if (el) {
        el.setAttribute('visible', 'true');
        el.setAttribute('position', `0 ${item.posY} 0`);
        el.setAttribute('scale', `${item.scale} ${item.scale} ${item.scale}`);
        el.setAttribute('rotation', '0 0 0');
    }

    currentModel = modelId;
    currentScale = item.scale;
    rotX = 0; rotY = 0; rotZ = 0;
}

// ============================================
// CLOSE AR
// ============================================
function closeAR() {
    currentModel = null;

    document.getElementById('ar-topbar').style.display = 'none';
    document.getElementById('ar-bottombar').style.display = 'none';
    document.getElementById('menu-page').style.display = 'flex';
    document.getElementById('bottom-nav').style.display = 'flex';

    Object.keys(menuData).forEach(id => {
        const el = document.getElementById(id);
        if (el) el.setAttribute('visible', 'false');
    });

    updateCartBar();
}

// Fix for mobile: listen for touchend on back button too
document.addEventListener('DOMContentLoaded', function () {
    const backBtn = document.getElementById('back-btn');
    if (backBtn) {
        backBtn.addEventListener('touchend', function (e) {
            e.preventDefault();
            e.stopPropagation();
            closeAR();
        });
    }
});

// ============================================
// RESET MODEL
// ============================================
function resetModel() {
    if (!currentModel) return;
    rotX = 0; rotY = 0; rotZ = 0;
    currentScale = menuData[currentModel].scale;
    applyTransform();
}

function applyTransform() {
    if (!currentModel) return;
    const el = document.getElementById(currentModel);
    if (!el) return;
    el.setAttribute('rotation', `${rotX} ${rotY} ${rotZ}`);
    el.setAttribute('scale', `${currentScale} ${currentScale} ${currentScale}`);
}

// ============================================
// TOAST
// ============================================
function showToast(icon, msg, sub) {
    document.getElementById('toast-icon').innerText = icon;
    document.getElementById('toast-msg').innerText = msg;
    document.getElementById('toast-sub').innerText = sub;
    const toast = document.getElementById('toast');
    toast.style.display = 'block';
    setTimeout(() => { toast.style.display = 'none'; }, 1800);
}

// ============================================
// TOUCH EVENTS
// ============================================
function getPinchDistance(t) {
    const dx = t[0].clientX - t[1].clientX;
    const dy = t[0].clientY - t[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
}

document.addEventListener('touchstart', (e) => {
    if (!currentModel) return;
    e.preventDefault();
    if (e.touches.length === 1) {
        lastTouchX = e.touches[0].clientX;
        lastTouchY = e.touches[0].clientY;
        lastPinchDist = null;
    } else if (e.touches.length === 2) {
        lastPinchDist = getPinchDistance(e.touches);
        lastTouchX = null;
    }
}, { passive: false });

document.addEventListener('touchmove', (e) => {
    if (!currentModel) return;
    e.preventDefault();
    if (e.touches.length === 1 && lastTouchX !== null) {
        const dx = e.touches[0].clientX - lastTouchX;
        const dy = e.touches[0].clientY - lastTouchY;
        rotY += dx * rotateSpeed;
        rotX += dy * rotateSpeed;
        lastTouchX = e.touches[0].clientX;
        lastTouchY = e.touches[0].clientY;
    } else if (e.touches.length === 2 && lastPinchDist !== null) {
        const newDist = getPinchDistance(e.touches);
        const delta = newDist - lastPinchDist;
        currentScale += delta * pinchSpeed;
        if (currentScale < minScale) currentScale = minScale;
        if (currentScale > maxScale) currentScale = maxScale;
        lastPinchDist = newDist;
    }
    applyTransform();
}, { passive: false });

document.addEventListener('touchend', () => {
    lastTouchX = null;
    lastTouchY = null;
    lastPinchDist = null;
});
