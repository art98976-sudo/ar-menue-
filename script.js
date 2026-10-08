const menuData = {
    pizza:  { icon:'🍕', name:'Margherita Pizza', price:8.99, desc:'Fresh tomato sauce, mozzarella cheese and aromatic basil.', calories:'320 kcal', time:'15 min', rating:'4.8', model:'./pizza.glb',  arId:'ar-pizza',  arScale:2.0, size:'12 inch', serves:'2-3 people', weight:'400g' },
    burger: { icon:'🍔', name:'Classic Burger',   price:11.99, desc:'Juicy beef patty with melted cheese and crisp lettuce.',   calories:'540 kcal', time:'10 min', rating:'4.7', model:'./burger.glb', arId:'ar-burger', arScale:1.5, size:'5 inch',  serves:'1 person',   weight:'250g' },
    drink:  { icon:'🥤', name:'Fresh Lemonade',   price:4.99,  desc:'Cold pressed lemonade with fresh mint and lime.',          calories:'85 kcal',  time:'5 min',  rating:'4.9', model:'./drink.glb',  arId:'ar-drink',  arScale:1.2, size:'350 ml',   serves:'1 person',  weight:'350g' },
    pasta:  { icon:'🍝', name:'Creamy Pasta',     price:9.99, desc:'Rich creamy pasta with herbs, garlic and parmesan cheese.', calories:'480 kcal', time:'12 min', rating:'4.6', model:'./pasta.glb',  arId:'ar-pasta',  arScale:2.0, size:'300g',     serves:'1 person',  weight:'300g' },
    sushi:  { icon:'🍣', name:'Sushi Platter',    price:13.99, desc:'Fresh sushi rolls with premium ingredients and wasabi.',    calories:'310 kcal', time:'8 min',  rating:'4.9', model:'./sushi.glb',  arId:'ar-sushi',  arScale:1.8, size:'5 pieces',  serves:'1 person',  weight:'200g' },
};

let cart={}, currentModel=null, arQty=1, viewerMode=null;
// Overwritten by data.js with the owner's settings from the dashboard
let currency='£', taxRate=0.05;
function money(n){return currency+(Math.round(Number(n)*100)/100).toFixed(2);}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function isAvailable(id){return menuData[id]&&menuData[id].available!==false;}
function cartTax(s){return Math.round(s*taxRate*100)/100;}

function updateViewerUI(id){
    const item=menuData[id];arQty=1;
    document.getElementById('ar-qty-num').innerText='1';
    document.getElementById('ar-food-name').innerText=item.name;
    document.getElementById('ar-food-price').innerText=money(item.price);
    document.getElementById('ar-detail-name').innerText=item.name;
    document.getElementById('ar-detail-price').innerText=money(item.price);
    document.getElementById('ar-detail-desc').innerText=item.desc;
    document.getElementById('ar-cal-row').innerHTML=`<div class="cal-badge">🔥 ${esc(item.calories)}</div><div class="cal-badge">⏱️ ${esc(item.time)}</div><div class="cal-badge">⭐ ${esc(item.rating)}</div>`;
    const sr=document.getElementById('ar-size-row');if(sr)sr.innerHTML=`<div class="size-badge">📏 ${esc(item.size)}</div><div class="size-badge">👥 ${esc(item.serves)}</div><div class="size-badge">⚖️ ${esc(item.weight)}</div>`;
    document.getElementById('menu-page').style.display='none';document.getElementById('bottom-nav').style.display='none';
    document.getElementById('cart-bar').classList.remove('visible');document.getElementById('ar-topbar').style.display='flex';
    document.getElementById('ar-bottombar').style.display='flex';document.getElementById('back-btn').classList.add('visible');
}

function closeViewer(){
    currentModel=null;viewerMode=null;
    document.getElementById('viewer-3d').style.display='none';document.getElementById('viewer-ar').style.display='none';
    document.getElementById('ar-topbar').style.display='none';document.getElementById('ar-bottombar').style.display='none';
    document.getElementById('back-btn').classList.remove('visible');
    document.getElementById('menu-page').style.display='flex';document.getElementById('bottom-nav').style.display='flex';
    updateCartBar();
}

function quickAdd(id){if(!addItemToCart(id,1))return;showToast('✅',menuData[id].name+' added!',money(menuData[id].price));}
function addToCart(){if(!currentModel||!addItemToCart(currentModel,arQty))return;showToast('🛒',menuData[currentModel].name+' ×'+arQty,money(menuData[currentModel].price*arQty));}
function addItemToCart(id,qty){if(!isAvailable(id)){showToast('⛔',menuData[id].name+' is sold out','');return false;}cart[id]?cart[id].qty+=qty:cart[id]={qty};updateCartBar();return true;}
function removeFromCart(id){if(!cart[id])return;cart[id].qty--;if(cart[id].qty<=0)delete cart[id];renderCartPage();updateCartBar();}
function addFromCart(id){if(cart[id])cart[id].qty++;renderCartPage();updateCartBar();}
function getCartCount(){return Object.values(cart).reduce((s,v)=>s+v.qty,0);}
function getCartTotal(){return Object.entries(cart).reduce((s,[id,v])=>s+menuData[id].price*v.qty,0);}
function updateCartBar(){
    const n=getCartCount(),t=getCartTotal(),b=document.getElementById('cart-bar');
    if(n>0){b.classList.add('visible');document.getElementById('cart-count').innerText=n+' item'+(n>1?'s':'');document.getElementById('cart-total').innerText=money(t);}
    else b.classList.remove('visible');
}
function changeQty(d){arQty=Math.max(1,Math.min(10,arQty+d));document.getElementById('ar-qty-num').innerText=arQty;}
function orderNow(){if(!currentModel||!addItemToCart(currentModel,arQty))return;closeViewer();setTimeout(placeOrder,300);}
function openCart(){renderCartPage();document.getElementById('cart-page').classList.add('open');history.pushState({page:'cart'},'');}
function closeCart(){document.getElementById('cart-page').classList.remove('open');}
function renderCartPage(){
    const c=document.getElementById('cart-items'),e=document.getElementById('empty-cart'),k=Object.keys(cart);
    if(!k.length){c.innerHTML='';e.style.display='flex';}
    else{e.style.display='none';c.innerHTML=k.map(id=>{const m=menuData[id],q=cart[id].qty;return `<div class="cart-item"><div class="cart-item-icon">${esc(m.icon)}</div><div class="cart-item-info"><div class="cart-item-name">${esc(m.name)}</div><div class="cart-item-price">${money(m.price)} × ${q} = ${money(m.price*q)}</div></div><div class="qty-controls"><button class="qty-btn" onclick="removeFromCart('${id}')">−</button><div class="qty-num">${q}</div><button class="qty-btn" onclick="addFromCart('${id}')">+</button></div></div>`;}).join('');}
    const s=getCartTotal(),tax=cartTax(s);
    document.getElementById('summary-subtotal').innerText=money(s);document.getElementById('summary-tax').innerText=money(tax);document.getElementById('summary-total').innerText=money(s+tax);
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
