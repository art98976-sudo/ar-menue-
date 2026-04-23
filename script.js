const menuData = {
    pizza:  { icon:'🍕', name:'Margherita Pizza', price:150, desc:'Fresh tomato sauce, mozzarella cheese and aromatic basil.', calories:'320 kcal', time:'15 min', rating:'4.8', model:'./pizza.glb',  arId:'ar-pizza',  arScale:1,  size:'12 inch', serves:'2-3 people', weight:'400g' },
    burger: { icon:'🍔', name:'Classic Burger',   price:200, desc:'Juicy beef patty with melted cheese and crisp lettuce.',   calories:'540 kcal', time:'10 min', rating:'4.7', model:'./burger.glb', arId:'ar-burger', arScale:1,  size:'5 inch',  serves:'1 person',   weight:'250g' },
    drink:  { icon:'🥤', name:'Fresh Lemonade',   price:80,  desc:'Cold pressed lemonade with fresh mint and lime.',          calories:'85 kcal',  time:'5 min',  rating:'4.9', model:'./drink.glb',  arId:'ar-drink',  arScale:1, size:'350 ml',   serves:'1 person',  weight:'350g' },
    pasta:  { icon:'🍝', name:'Creamy Pasta',     price:180, desc:'Rich creamy pasta with herbs, garlic and parmesan cheese.', calories:'480 kcal', time:'12 min', rating:'4.6', model:'./pasta.glb',  arId:'ar-pasta',  arScale:1, size:'300g',     serves:'1 person',  weight:'300g' },
    sushi:  { icon:'🍣', name:'Sushi Platter',    price:250, desc:'Fresh sushi rolls with premium ingredients and wasabi.',    calories:'310 kcal', time:'8 min',  rating:'4.9', model:'./sushi.glb',  arId:'ar-sushi',  arScale:1, size:'5 pieces',  serves:'1 person',  weight:'200g' },
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
    threeScene.background=new THREE.Color(0x0f0f0f);
    threeCamera=new THREE.PerspectiveCamera(40,container.clientWidth/container.clientHeight,0.1,100);
    threeCamera.position.set(0,0.5,3);

    // ── PREMIUM LIGHTING ──
    // Soft ambient — removes dark areas, warm restaurant feel
    threeScene.add(new THREE.AmbientLight(0xfff5e8, 0.8));

    // Main sun light — top right like photography studio
    const kl=new THREE.DirectionalLight(0xfff8f0, 1.8);
    kl.position.set(4,8,4); kl.castShadow=true;
    kl.shadow.mapSize.width=2048; kl.shadow.mapSize.height=2048;
    kl.shadow.radius=8; kl.shadow.bias=-0.001;
    threeScene.add(kl);

    // Soft fill from opposite — no harsh dark areas
    const fl=new THREE.DirectionalLight(0xe8f4ff, 0.5);
    fl.position.set(-4,4,-2); threeScene.add(fl);

    // Warm rim light from behind — adds depth and glow
    const rl=new THREE.DirectionalLight(0xffe0a0, 0.4);
    rl.position.set(0,2,-6); threeScene.add(rl);

    // Soft bounce light from below — like light off table
    const bl=new THREE.PointLight(0xfff0e0, 0.3, 8);
    bl.position.set(0,-1,0); threeScene.add(bl);

    // Soft shadow ground
    const ground=new THREE.Mesh(new THREE.PlaneGeometry(20,20),new THREE.ShadowMaterial({opacity:0.15}));
    ground.rotation.x=-Math.PI/2;ground.position.y=-1.5;ground.receiveShadow=true;threeScene.add(ground);
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
    document.getElementById('ar-food-price').innerText='Rs.'+item.price;
    document.getElementById('ar-detail-name').innerText=item.name;
    document.getElementById('ar-detail-price').innerText='Rs.'+item.price;
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
    if(navigator.vibrate)navigator.vibrate([100,50,200]);
}
function onLost(){document.getElementById('scan-overlay').classList.remove('hidden');}

function fixVideo(){
    document.querySelectorAll('video').forEach(v=>{v.style.cssText='position:fixed!important;top:0!important;left:0!important;width:100vw!important;height:100vh!important;object-fit:cover!important;z-index:1!important;display:block!important;';});
    document.querySelectorAll('#viewer-ar canvas').forEach(c=>{c.style.cssText='position:fixed!important;top:0!important;left:0!important;width:100vw!important;height:100vh!important;z-index:2!important;background:transparent!important;';});
}
setInterval(()=>{if(document.getElementById('viewer-ar').style.display==='block')fixVideo();},1000);

function closeViewer(){
    currentModel=null;viewerMode=null;stopRendering();
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

function quickAdd(id){addItemToCart(id,1);showToast('✅',menuData[id].name+' added!','Rs.'+menuData[id].price);}
function addToCart(){if(!currentModel)return;addItemToCart(currentModel,arQty);showToast('🛒',menuData[currentModel].name+' ×'+arQty,'Rs.'+(menuData[currentModel].price*arQty));}
function addItemToCart(id,qty){cart[id]?cart[id].qty+=qty:cart[id]={qty};updateCartBar();}
function removeFromCart(id){if(!cart[id])return;cart[id].qty--;if(cart[id].qty<=0)delete cart[id];renderCartPage();updateCartBar();}
function addFromCart(id){if(cart[id])cart[id].qty++;renderCartPage();updateCartBar();}
function getCartCount(){return Object.values(cart).reduce((s,v)=>s+v.qty,0);}
function getCartTotal(){return Object.entries(cart).reduce((s,[id,v])=>s+menuData[id].price*v.qty,0);}
function updateCartBar(){
    const n=getCartCount(),t=getCartTotal(),b=document.getElementById('cart-bar');
    if(n>0){b.classList.add('visible');document.getElementById('cart-count').innerText=n+' item'+(n>1?'s':'');document.getElementById('cart-total').innerText='Rs.'+t;}
    else b.classList.remove('visible');
}
function changeQty(d){arQty=Math.max(1,Math.min(10,arQty+d));document.getElementById('ar-qty-num').innerText=arQty;}
function orderNow(){if(!currentModel)return;addItemToCart(currentModel,arQty);closeViewer();setTimeout(placeOrder,300);}
function openCart(){renderCartPage();document.getElementById('cart-page').classList.add('open');history.pushState({page:'cart'},'');}
function closeCart(){document.getElementById('cart-page').classList.remove('open');}
function renderCartPage(){
    const c=document.getElementById('cart-items'),e=document.getElementById('empty-cart'),k=Object.keys(cart);
    if(!k.length){c.innerHTML='';e.style.display='flex';}
    else{e.style.display='none';c.innerHTML=k.map(id=>{const m=menuData[id],q=cart[id].qty;return `<div class="cart-item"><div class="cart-item-icon">${m.icon}</div><div class="cart-item-info"><div class="cart-item-name">${m.name}</div><div class="cart-item-price">Rs.${m.price} × ${q} = Rs.${m.price*q}</div></div><div class="qty-controls"><button class="qty-btn" onclick="removeFromCart('${id}')">−</button><div class="qty-num">${q}</div><button class="qty-btn" onclick="addFromCart('${id}')">+</button></div></div>`;}).join('');}
    const s=getCartTotal(),tax=Math.round(s*0.05);
    document.getElementById('summary-subtotal').innerText='Rs.'+s;document.getElementById('summary-tax').innerText='Rs.'+tax;document.getElementById('summary-total').innerText='Rs.'+(s+tax);
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
        arRotY+=e.touches[0].clientX-arLastX;arRotX+=e.touches[0].clientY-arLastY;
        el.setAttribute('rotation',`${arRotX} ${arRotY} 0`);
        arLastX=e.touches[0].clientX;arLastY=e.touches[0].clientY;
    }else if(e.touches.length===2&&arLastPinch!==null){
        const nd=pd(e.touches);arScale=Math.max(0.05,Math.min(4,arScale+(nd-arLastPinch)*0.008));
        arScale=Math.max(0.05,Math.min(arMaxScale,arScale+(nd-arLastPinch)*0.015)); // faster zoom
        el.setAttribute('scale',`${arScale} ${arScale} ${arScale}`);arLastPinch=nd;
    }
},{passive:true});
document.addEventListener('touchend',()=>{arLastX=null;arLastY=null;arLastPinch=null;});
