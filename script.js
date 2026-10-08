/* ════════════════════════════════════════════════════════════════
   Customer menu — dish data, cart, order page, desktop dish preview.
   data.js (loaded after this) replaces menuData/currency/taxRate with the
   owner's live values and sends orders to the kitchen.
   ════════════════════════════════════════════════════════════════ */
const menuData = {
    pizza:  { icon:'🍕', name:'Margherita Pizza', price:8.99, desc:'Fresh tomato sauce, mozzarella cheese and aromatic basil.', calories:'320 kcal', time:'15 min', rating:'4.8', model:'./pizza.glb',  size:'12 inch', serves:'2-3 people', weight:'400g' },
    burger: { icon:'🍔', name:'Classic Burger',   price:11.99, desc:'Juicy beef patty with melted cheese and crisp lettuce.',   calories:'540 kcal', time:'10 min', rating:'4.7', model:'./burger.glb', size:'5 inch',  serves:'1 person',   weight:'250g' },
    drink:  { icon:'🥤', name:'Fresh Lemonade',   price:4.99,  desc:'Cold pressed lemonade with fresh mint and lime.',          calories:'85 kcal',  time:'5 min',  rating:'4.9', model:'./drink.glb',  size:'350 ml',   serves:'1 person',  weight:'350g' },
    pasta:  { icon:'🍝', name:'Creamy Pasta',     price:9.99, desc:'Rich creamy pasta with herbs, garlic and parmesan cheese.', calories:'480 kcal', time:'12 min', rating:'4.6', model:'./pasta.glb',  size:'300g',     serves:'1 person',  weight:'300g' },
    sushi:  { icon:'🍣', name:'Sushi Platter',    price:13.99, desc:'Fresh sushi rolls with premium ingredients and wasabi.',    calories:'310 kcal', time:'8 min',  rating:'4.9', model:'./sushi.glb',  size:'5 pieces',  serves:'1 person',  weight:'200g' },
};

let cart={}, currentModel=null, arQty=1, viewerMode=null;
// Overwritten by data.js with the owner's settings from the dashboard
let currency='£', taxRate=0.05;

const $id=id=>document.getElementById(id);
function money(n){return currency+(Math.round(Number(n)*100)/100).toFixed(2);}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function setText(id,v){const e=$id(id);if(e)e.textContent=v;}
function isAvailable(id){return menuData[id]&&menuData[id].available!==false;}
function cartTax(s){return Math.round(s*taxRate*100)/100;}
function dishImage(id){const img=document.querySelector('.food-card[data-dish="'+id+'"] img');return img?img.currentSrc||img.src:'';}

/* ── Desktop dish preview (phones go straight to the AR camera) ── */
function updateViewerUI(id){
    const item=menuData[id];arQty=1;
    setText('ar-detail-name',item.name);
    setText('ar-detail-price',money(item.price));
    setText('ar-detail-meta',[item.size,item.serves,item.calories].filter(Boolean).join(' · '));
    const add=$id('ar-cart-btn');if(add)add.disabled=!isAvailable(id);
    $id('menu-page').style.display='none';
    $id('cart-bar').classList.remove('visible');
    $id('ar-bottombar').style.display='flex';$id('back-btn').classList.add('visible');
}

function closeViewer(){
    currentModel=null;viewerMode=null;
    $id('viewer-ar').style.display='none';$id('ar-bottombar').style.display='none';
    $id('back-btn').classList.remove('visible');
    $id('menu-page').style.display='flex';
    updateCartBar();
}

/* ── Cart ─────────────────────────────────────────────────────── */
function quickAdd(id){if(!addItemToCart(id,1))return;showToast('✓',menuData[id].name+' added',money(menuData[id].price));}
function addToCart(){if(!currentModel||!addItemToCart(currentModel,arQty))return;showToast('✓',menuData[currentModel].name+' added',money(menuData[currentModel].price*arQty));}
function addItemToCart(id,qty){if(!isAvailable(id)){showToast('—',menuData[id].name+' is sold out','');return false;}cart[id]?cart[id].qty+=qty:cart[id]={qty};updateCartBar();return true;}
function removeFromCart(id){if(!cart[id])return;cart[id].qty--;if(cart[id].qty<=0)delete cart[id];renderCartPage();updateCartBar();}
function addFromCart(id){if(cart[id])cart[id].qty++;renderCartPage();updateCartBar();}
function getCartCount(){return Object.values(cart).reduce((s,v)=>s+v.qty,0);}
function getCartTotal(){return Object.entries(cart).reduce((s,[id,v])=>s+menuData[id].price*v.qty,0);}

function updateCartBar(){
    const n=getCartCount(),b=$id('cart-bar');
    setText('cart-count',n);
    setText('cart-total',money(getCartTotal()));
    b.classList.toggle('visible',n>0&&$id('menu-page').style.display!=='none');
    // quantity bubble on each dish card
    document.querySelectorAll('.food-card[data-dish]').forEach(card=>{
        const q=cart[card.dataset.dish]?cart[card.dataset.dish].qty:0;
        card.classList.toggle('in-cart',q>0);
        const badge=card.querySelector('.in-cart-qty');if(badge)badge.textContent=q;
    });
}

function openCart(){renderCartPage();$id('cart-page').classList.add('open');document.body.classList.add('sheet-open');history.pushState({page:'cart'},'');}
function closeCart(){$id('cart-page').classList.remove('open');document.body.classList.remove('sheet-open');}

function renderCartPage(){
    const list=$id('cart-items'),empty=$id('empty-cart'),ids=Object.keys(cart);
    $id('cart-page').classList.toggle('is-empty',!ids.length);
    empty.style.display=ids.length?'none':'flex';
    list.innerHTML=ids.map(id=>{
        const m=menuData[id],q=cart[id].qty,img=dishImage(id);
        return `<li class="cart-item">
            <div class="cart-thumb">${img?`<img src="${esc(img)}" alt="">`:esc(m.icon)}</div>
            <div class="cart-item-info">
                <div class="cart-item-name">${esc(m.name)}</div>
                <div class="cart-item-price">${money(m.price)} each</div>
            </div>
            <div class="qty-controls" role="group" aria-label="Quantity of ${esc(m.name)}">
                <button class="qty-btn" onclick="removeFromCart('${id}')" aria-label="One less">−</button>
                <span class="qty-num">${q}</span>
                <button class="qty-btn" onclick="addFromCart('${id}')" aria-label="One more">+</button>
            </div>
            <div class="cart-line-total">${money(m.price*q)}</div>
        </li>`;}).join('');
    const s=getCartTotal(),tax=cartTax(s);
    setText('summary-subtotal',money(s));
    setText('summary-tax-label','Service & tax ('+(+(taxRate*100).toFixed(2))+'%)');
    setText('summary-tax',money(tax));
    setText('summary-total',money(s+tax));
    $id('place-order-btn').disabled=!ids.length;
}

// Without a database (config.js not filled in) this just shows the confirmation.
// data.js replaces it with the real one that sends the order to the kitchen.
function placeOrder(){if(!getCartCount())return;showOrderSuccess(Math.floor(1000+Math.random()*9000));}
function showOrderSuccess(orderNo){
    setText('order-id-text','#'+orderNo);
    cart={};updateCartBar();
    const note=$id('order-note');if(note)note.value='';
    closeCart();
    $id('order-success').classList.add('open');
}
function backToMenu(){$id('order-success').classList.remove('open');showMenu();}
function showMenu(){$id('menu-page').style.display='flex';updateCartBar();}

let toastTimer;
function showToast(icon,msg,sub){
    setText('toast-icon',icon);setText('toast-msg',msg);setText('toast-sub',sub||'');
    const t=$id('toast');t.classList.add('show');
    clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),2000);
}

window.addEventListener('popstate',function(){
    if($id('viewer-ar').style.display==='block'){closeViewer();return;}
    if($id('cart-page').classList.contains('open')){closeCart();return;}
    if($id('order-success').classList.contains('open')){backToMenu();return;}
});
history.pushState({page:'menu'},'');

/* ── Category bar: highlight the section you're looking at ───── */
(function(){
    const links=[...document.querySelectorAll('.cat-link')];
    if(!links.length||!('IntersectionObserver' in window))return;
    const byId={};links.forEach(a=>byId[a.getAttribute('href').slice(1)]=a);
    const io=new IntersectionObserver(entries=>{
        entries.forEach(e=>{
            if(!e.isIntersecting)return;
            links.forEach(a=>a.classList.toggle('active',a===byId[e.target.id]));
        });
    },{rootMargin:'-45% 0px -50% 0px'});
    document.querySelectorAll('.menu-section').forEach(s=>io.observe(s));
})();
