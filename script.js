/* ════════════════════════════════════════════════════════════════
   Customer menu — dish data, cart, order page, desktop dish preview.
   data.js (loaded after this) replaces menuData/currency/taxRate with the
   owner's live values and sends orders to the kitchen.
   ════════════════════════════════════════════════════════════════ */
const menuData = {
    pizza:  { icon:'🍕', name:'Margherita Pizza', price:8.99, desc:'Fresh tomato sauce, mozzarella cheese and aromatic basil.', calories:'320 kcal', time:'15 min', rating:'4.8', model:'./pizza.glb',  size:'12 inch', serves:'2-3 people', weight:'400g', category:'main', flavour:['savory','tomato','cheesy'], dietary:[], price_band:'mid', meal_part:'unspecified', promote:false },
    burger: { icon:'🍔', name:'Classic Burger',   price:11.99, desc:'Juicy beef patty with melted cheese and crisp lettuce.',   calories:'540 kcal', time:'10 min', rating:'4.7', model:'./burger.glb', size:'5 inch',  serves:'1 person',   weight:'250g', category:'main', flavour:['savory','cheesy'], dietary:[], price_band:'premium', meal_part:'unspecified', promote:false },
    drink:  { icon:'🥤', name:'Fresh Lemonade',   price:4.99,  desc:'Cold pressed lemonade with fresh mint and lime.',          calories:'85 kcal',  time:'5 min',  rating:'4.9', model:'./drink.glb',  size:'350 ml',   serves:'1 person',  weight:'350g', category:'drink', flavour:['citrus','fresh'], dietary:[], price_band:'budget', meal_part:'unspecified', promote:false },
    pasta:  { icon:'🍝', name:'Creamy Pasta',     price:9.99, desc:'Rich creamy pasta with herbs, garlic and parmesan cheese.', calories:'480 kcal', time:'12 min', rating:'4.6', model:'./pasta.glb',  size:'300g',     serves:'1 person',  weight:'300g', category:'main', flavour:['savory','creamy','herby'], dietary:[], price_band:'mid', meal_part:'unspecified', promote:false },
    sushi:  { icon:'🍣', name:'Sushi Platter',    price:13.99, desc:'Fresh sushi rolls with premium ingredients and wasabi.',    calories:'310 kcal', time:'8 min',  rating:'4.9', model:'./sushi.glb',  size:'5 pieces',  serves:'1 person',  weight:'200g', category:'main', flavour:['savory','umami','fresh'], dietary:[], price_band:'premium', meal_part:'unspecified', promote:false },
};
Object.assign(menuData.pizza,{ingredients:['wheat flour','tomato','mozzarella','basil','olive oil'],caloriesPer100g:80,portionGrams:400,exactCalories:'320 kcal'});
Object.assign(menuData.burger,{ingredients:['beef','brioche bun','cheddar','lettuce','tomato','sauce'],caloriesPer100g:216,portionGrams:250,exactCalories:'540 kcal'});
Object.assign(menuData.drink,{ingredients:['lemon','lime','mint','water','sugar'],caloriesPer100g:24.29,portionGrams:350,exactCalories:'85 kcal'});
Object.assign(menuData.pasta,{ingredients:['wheat pasta','cream','parmesan','garlic','herbs'],caloriesPer100g:160,portionGrams:300,exactCalories:'480 kcal'});
Object.assign(menuData.sushi,{ingredients:['rice','nori','salmon','avocado','cucumber','wasabi'],caloriesPer100g:155,portionGrams:200,exactCalories:'310 kcal'});

let cart={}, currentModel=null, arQty=1, viewerMode=null, recommendationDishId=null, activeBundle=null;
let recommendationBundles=new Map();
let popularPairCounts={}, popularPairRequestKey=null, popularPairPendingKey=null, popularPairFetchedAt=0;
let aiRecommendationKey=null, aiRecommendationPendingKey=null, aiSelectedIds=null;
window.recommendationsEnabled=true;
window.aiRecommendationsEnabled=false;
window.bundlesEnabled=false;
window.bundleDiscountPercent=0;
// Overwritten by data.js with the owner's settings from the dashboard
let currency='£', taxRate=0.05;
const safetyPreferenceStorage=window.MenuSafetyPreferences;
const customerHistoryStorage=window.MenuCustomerHistory;
let safetyPreferenceLoad;
try{
    safetyPreferenceLoad=safetyPreferenceStorage.load(window.localStorage);
}catch(error){
    safetyPreferenceLoad={preferences:{allergens:[],dietary:[]},ready:false,stored:false,error};
}
let safetyPreferences=safetyPreferenceLoad.preferences;
let safetyPreferencesReady=safetyPreferenceLoad.ready;
window.safetyPreferences=safetyPreferences;
window.safetyPreferencesReady=safetyPreferencesReady;

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
function addItemToCart(id,qty){if(!isAvailable(id)){showToast('—',menuData[id].name+' is sold out','');return false;}cart[id]?cart[id].qty+=qty:cart[id]={qty};recommendationDishId=id;updateCartBar();renderRecommendations();return true;}
function removeFromCart(id){if(!cart[id])return;cart[id].qty--;if(cart[id].qty<=0)delete cart[id];renderCartPage();updateCartBar();renderRecommendations();}
function addFromCart(id){if(cart[id])cart[id].qty++;renderCartPage();updateCartBar();renderRecommendations();}
function getCartCount(){return Object.values(cart).reduce((s,v)=>s+v.qty,0);}
function getCartSubtotal(){return Object.entries(cart).reduce((s,[id,v])=>s+menuData[id].price*v.qty,0);}
function getActiveBundle(){
    if(!activeBundle||window.bundlesEnabled!==true||Number(window.bundleDiscountPercent)<=0)return null;
    const items=activeBundle.ids.map(id=>menuData[id]);
    if(items.some((dish,index)=>!dish||!cart[activeBundle.ids[index]]||
        !isAvailable(activeBundle.ids[index])||
        !window.isDishSafeForPreferences(dish,safetyPreferences)))return null;
    return {
        id:activeBundle.id,
        ids:activeBundle.ids.slice(),
        items:items,
        discountPercent:Number(window.bundleDiscountPercent)
    };
}
function getBundleSavings(){
    const bundle=getActiveBundle();
    if(!bundle)return 0;
    const totalCents=getBundleBaseTotalCents(bundle);
    return Math.round(totalCents*bundle.discountPercent/100)/100;
}
function getBundleBaseTotalCents(bundle){
    return bundle.items.reduce((sum,dish)=>sum+Math.round(Number(dish.price)*100),0);
}
function getCartTotal(){return Math.max(0,getCartSubtotal()-getBundleSavings());}

function updateCartBar(){
    const n=getCartCount(),b=$id('cart-bar');
    setText('cart-count',n);
    setText('cart-total',money(getCartTotal()));
    b.classList.toggle('visible',n>0&&$id('menu-page').style.display!=='none');
    updateOrderTracker();
    // quantity bubble on each dish card
    document.querySelectorAll('.food-card[data-dish]').forEach(card=>{
        const q=cart[card.dataset.dish]?cart[card.dataset.dish].qty:0;
        card.classList.toggle('in-cart',q>0);
        const badge=card.querySelector('.in-cart-qty');if(badge)badge.textContent=q;
    });
}

function updateSafetyPreferenceSummary(){
    const summary=$id('safety-preference-summary');
    if(!summary)return;
    const allergenNames=safetyPreferences.allergens.map(name=>name.replace(/_/g,' '));
    const dietaryNames=safetyPreferences.dietary.map(name=>name==='veg'?'vegetarian':name);
    const labels=[];
    if(allergenNames.length)labels.push('Avoid: '+allergenNames.join(', '));
    if(dietaryNames.length)labels.push(dietaryNames.join(', '));
    summary.textContent=labels.length?labels.join(' · '):'Not set';
}

function loadSafetyPreferencesIntoForm(){
    document.querySelectorAll('[data-allergen]').forEach(input=>{
        input.checked=safetyPreferences.allergens.includes(input.dataset.allergen);
    });
    document.querySelectorAll('[data-dietary-preference]').forEach(input=>{
        input.checked=safetyPreferences.dietary.includes(input.dataset.dietaryPreference);
    });
    const status=$id('safety-preference-status');
    if(status){
        status.textContent=safetyPreferencesReady
            ?'Your choices are stored only in this browser.'
            :'Saved preferences could not be read. Review and reselect your needs before using recommendations.';
    }
    updateSafetyPreferenceSummary();
}

function saveSafetyPreferencesFromForm(){
    const preferences={
        allergens:[...document.querySelectorAll('[data-allergen]:checked')].map(input=>input.dataset.allergen),
        dietary:[...document.querySelectorAll('[data-dietary-preference]:checked')].map(input=>input.dataset.dietaryPreference)
    };
    let saved;
    try{
        saved=safetyPreferenceStorage.save(window.localStorage,preferences);
    }catch(error){
        saved={preferences:safetyPreferenceStorage.normalize(preferences),saved:false,error};
    }
    safetyPreferences=saved.preferences;
    safetyPreferencesReady=true;
    window.safetyPreferences=safetyPreferences;
    window.safetyPreferencesReady=true;
    const status=$id('safety-preference-status');
    if(status)status.textContent=saved.saved
        ?'Saved on this device. Recommendations now use these as strict safety requirements.'
        :'These choices apply for this visit, but could not be saved on this device.';
    updateSafetyPreferenceSummary();
    updateAllergenWarnings();
    renderRecommendations();
    updateCartBar();
    if($id('cart-page').classList.contains('open'))renderCartPage();
    renderCustomerHistory();
}

function readCustomerHistory(){
    try{
        return customerHistoryStorage.load(window.localStorage);
    }catch(error){
        return {ready:false,history:{orders:[],lastTasteOfferAt:0},error:error};
    }
}

function renderCustomerHistory(){
    const section=$id('customer-history');
    if(!section)return;
    const usualSummary=$id('usual-order-summary');
    const usualButton=$id('usual-order-add');
    const tastePanel=$id('usual-taste-suggestion');
    const clearButton=$id('clear-order-history');
    const saved=readCustomerHistory();
    if(!saved.ready){
        section.hidden=false;
        setText('customer-history-status','Saved order history could not be read. You can clear it from this browser and start again.');
        usualSummary.hidden=true;
        usualButton.hidden=true;
        tastePanel.hidden=true;
        clearButton.hidden=false;
        console.error('Could not load local order history:',saved.error);
        return;
    }
    if(!saved.history.orders.length){
        section.hidden=true;
        return;
    }
    section.hidden=false;
    clearButton.hidden=false;
    const usual=customerHistoryStorage.getUsualBasket(saved.history.orders);
    if(!usual){
        setText('customer-history-status','Repeat the same basket at least twice and it will be ready here.');
        usualSummary.hidden=true;
        usualButton.hidden=true;
        tastePanel.hidden=true;
        return;
    }
    const usualItems=usual.items.map(item=>menuData[item.id]?
        (item.qty>1?item.qty+'× ':'')+menuData[item.id].name:item.id);
    setText('usual-order-summary','Your usual, ordered '+usual.orderCount+' times: '+usualItems.join(', '));
    usualSummary.hidden=false;
    const unsafeUsual=usual.items.some(item=>!menuData[item.id]||!isAvailable(item.id)||
        !safetyPreferencesReady||!window.isDishSafeForPreferences(menuData[item.id],safetyPreferences));
    usualButton.hidden=unsafeUsual;
    tastePanel.hidden=true;
    if(unsafeUsual){
        setText('customer-history-status','Your usual is unavailable or does not meet your current saved needs.');
        return;
    }
    setText('customer-history-status','Saved only on this device. Review your basket before checkout.');
    const tasteCandidates=window.recommendDishes(menuData,{
        cartIds:usual.items.map(item=>item.id),
        dietaryFilters:safetyPreferences.dietary,
        allergenFilters:safetyPreferences.allergens,
        safetyPreferencesReady:safetyPreferencesReady,
        pairCounts:popularPairCounts,
        hour:new Date().getHours(),
        limit:500
    });
    const taste=tasteCandidates.find(item=>isAvailable(item.id)&&
        window.isDishSafeForPreferences(menuData[item.id],safetyPreferences));
    if(!taste||!customerHistoryStorage.canShowTasteOffer(saved.history,Date.now()))return;
    let marked;
    try{
        marked=customerHistoryStorage.markTasteOfferShown(window.localStorage,Date.now());
    }catch(error){
        marked={saved:false,error:error};
    }
    if(!marked.saved){
        console.error('Could not save the taste-offer cooldown:',marked.error);
        setText('customer-history-status','Your usual is ready, but the occasional new-item offer could not be saved on this device.');
        return;
    }
    setText('usual-taste-name',taste.dish.name);
    $id('usual-taste-add').dataset.tasteAdd=taste.id;
    tastePanel.hidden=false;
}

function addUsualOrder(){
    const saved=readCustomerHistory();
    const usual=saved.ready?customerHistoryStorage.getUsualBasket(saved.history.orders):null;
    if(!usual)return;
    const canAdd=usual.items.every(item=>menuData[item.id]&&isAvailable(item.id)&&
        safetyPreferencesReady&&window.isDishSafeForPreferences(menuData[item.id],safetyPreferences)&&
        (cart[item.id]?cart[item.id].qty:0)+item.qty<=20);
    if(!canAdd){
        showToast('—','Your usual is not available','Check your saved needs, availability, or cart quantities.');
        renderCustomerHistory();
        return;
    }
    usual.items.forEach(item=>{
        cart[item.id]?cart[item.id].qty+=item.qty:cart[item.id]={qty:item.qty};
    });
    recommendationDishId=usual.items.find(item=>menuData[item.id].category==='main')?.id||usual.items[0].id;
    updateCartBar();
    renderRecommendations();
    if($id('cart-page').classList.contains('open'))renderCartPage();
    else openCart();
    showToast('✓','Your usual is in the cart','Review it before placing your order.');
}

function addTasteSuggestion(id){
    const dish=menuData[id];
    if(!dish||!isAvailable(id)||!safetyPreferencesReady||
        !window.isDishSafeForPreferences(dish,safetyPreferences)){
        renderCustomerHistory();
        return;
    }
    quickAdd(id);
    renderCustomerHistory();
}

function clearCustomerHistory(){
    let result;
    try{
        result=customerHistoryStorage.clear(window.localStorage);
    }catch(error){
        result={cleared:false,error:error};
    }
    if(!result.cleared){
        console.error('Could not clear local order history:',result.error);
        setText('customer-history-status','Could not clear saved history from this browser.');
        return;
    }
    renderCustomerHistory();
    showToast('✓','Saved history cleared','Order history was removed from this browser.');
}

loadSafetyPreferencesIntoForm();
renderCustomerHistory();
const safetyPreferencesDisclosure=$id('safety-preferences');
if(safetyPreferencesDisclosure&&(!safetyPreferenceLoad.stored||!safetyPreferencesReady)){
    safetyPreferencesDisclosure.open=true;
}

function renderRecommendations(){
    const panel=$id('recommendations');if(!panel)return;
    if(window.recommendationsEnabled===false){
        panel.hidden=true;
        $id('recommendation-list').innerHTML='';
        aiRecommendationKey=null;aiRecommendationPendingKey=null;aiSelectedIds=null;
        return;
    }
    if(!window.recommendDishes)return;
    const ids=[...new Set([recommendationDishId,...Object.keys(cart)].filter(Boolean).map(String))].slice(0,50);
    const requestKey=ids.slice().sort().join('\u001f');
    const historyExpired=Date.now()-popularPairFetchedAt>=300000;
    if(requestKey!==popularPairRequestKey||(historyExpired&&popularPairPendingKey!==requestKey)){
        popularPairRequestKey=requestKey;
        popularPairCounts={};
        if(ids.length&&typeof window.loadPopularPairings==='function'){
            popularPairPendingKey=requestKey;
            window.loadPopularPairings(ids).then(function(counts){
                if(popularPairRequestKey!==requestKey)return;
                popularPairPendingKey=null;
                popularPairFetchedAt=Date.now();
                popularPairCounts=counts;
                drawRecommendations();
            }).catch(function(error){
                if(popularPairRequestKey===requestKey){
                    popularPairRequestKey=null;
                    popularPairPendingKey=null;
                }
                console.error('Could not load order-pairing history:',error);
            });
        }
    }
    drawRecommendations();
}

function drawRecommendations(){
    const panel=$id('recommendations');if(!panel)return;
    if(window.recommendationsEnabled===false){
        panel.hidden=true;
        $id('recommendation-list').innerHTML='';
        aiRecommendationKey=null;aiRecommendationPendingKey=null;aiSelectedIds=null;
        return;
    }
    if(!window.recommendDishes)return;
    const ruleSuggestions=window.recommendDishes(menuData,{
        viewedDishId:recommendationDishId,
        cartIds:Object.keys(cart),
        dietaryFilters:safetyPreferences.dietary,
        allergenFilters:safetyPreferences.allergens,
        safetyPreferencesReady:safetyPreferencesReady,
        pairCounts:popularPairCounts,
        recommendationsEnabled:window.recommendationsEnabled!==false,
        limit:500
    });
    const active=getActiveBundle();
    const bundle=active||window.buildComboBundle(menuData,{
        viewedDishId:recommendationDishId,
        cartIds:Object.keys(cart),
        pairCounts:popularPairCounts,
        preferences:safetyPreferences,
        safetyPreferencesReady:safetyPreferencesReady,
        bundlesEnabled:window.bundlesEnabled===true,
        discountPercent:window.bundleDiscountPercent,
        bundleAlreadyActive:false
    });
    const bundleIds=new Set(bundle&&!active?bundle.ids:[]);
    const independentSuggestions=ruleSuggestions.filter(item=>!bundleIds.has(item.id));
    recommendationBundles.clear();
    if(bundle&&!active)recommendationBundles.set(bundle.id,bundle);
    const historyIds=[...new Set([recommendationDishId,...Object.keys(cart)].filter(Boolean).map(String))].slice(0,50);
    const historyKey=historyIds.slice().sort().join('\u001f');
    const aiEnabled=window.aiRecommendationsEnabled===true&&typeof window.requestAiRecommendations==='function';
    if(aiEnabled&&independentSuggestions.length&&popularPairPendingKey!==historyKey){
        const payload={
            viewed_dish_id:recommendationDishId,
            cart_dish_ids:Object.keys(cart).slice(0,50),
            candidate_ids:independentSuggestions.slice(0,120).map(item=>item.id),
            dietary_filters:safetyPreferences.dietary,
            allergen_filters:safetyPreferences.allergens,
            local_hour:new Date().getHours()
        };
        const sentCandidateIds=new Set(payload.candidate_ids);
        const requestKey=JSON.stringify([
            payload,
            historyIds.map(id=>{
                const dish=menuData[id];
                return dish&&[
                    dish.id,dish.name,dish.category,dish.flavour,dish.dietary,
                    dish.allergens,dish.may_contain_allergens,dish.allergen_info_verified,
                    dish.price_band,dish.meal_part,dish.promote,dish.available
                ];
            }),
            independentSuggestions.slice(0,120).map(item=>[
                item.id,item.dish.name,item.dish.category,item.dish.flavour,item.dish.dietary,
                item.dish.allergens,item.dish.may_contain_allergens,item.dish.allergen_info_verified,
                item.dish.price_band,item.dish.meal_part,item.dish.promote,item.dish.available,item.orderCount
            ]),
            popularPairCounts
        ]);
        if(requestKey!==aiRecommendationKey&&requestKey!==aiRecommendationPendingKey){
            aiRecommendationKey=requestKey;
            aiRecommendationPendingKey=requestKey;
            aiSelectedIds=null;
            window.requestAiRecommendations(payload).then(function(ids){
                if(aiRecommendationKey!==requestKey)return;
                aiRecommendationPendingKey=null;
                const sentCandidates=independentSuggestions.filter(item=>sentCandidateIds.has(item.id));
                aiSelectedIds=window.selectAiRecommendations(sentCandidates,ids,safetyPreferences);
                if(!aiSelectedIds.length)aiSelectedIds=null;
                drawRecommendations();
            }).catch(function(error){
                if(aiRecommendationKey===requestKey)aiRecommendationPendingKey=null;
                console.error('AI recommendations unavailable; keeping rule suggestions:',error);
            });
        }
    }else if(!aiEnabled){
        aiRecommendationKey=null;
        aiRecommendationPendingKey=null;
        aiSelectedIds=null;
    }
    const candidatesById=new Map(independentSuggestions.map(item=>[item.id,item]));
    // aiSelectedIds holds suggestion objects; re-check each against the current safe candidates.
    const aiSuggestions=aiSelectedIds
        ?aiSelectedIds.map(item=>candidatesById.get(item.id)).filter(Boolean)
        :[];
    const rankedSuggestions=aiSuggestions.length?aiSuggestions:independentSuggestions;
    const suggestions=window.limitSuggestionSlots(rankedSuggestions,Boolean(bundle));
    panel.hidden=!recommendationDishId&&!Object.keys(cart).length;
    const context=menuData[recommendationDishId];
    setText('recommendation-context',context?'Picked to go with '+context.name:'Picked for your order');
    const bundlePanel=$id('recommendation-bundle');
    bundlePanel.innerHTML=bundle?`<article class="combo-card">
        <h3 class="combo-title">${active?'Combo deal applied':'Build a combo and save'}</h3>
        <p class="combo-items">${bundle.items.map(dish=>esc(dish.name)).join(' + ')}</p>
        <div class="combo-pricing"><span class="combo-original">${money(bundle.items.reduce((sum,dish)=>sum+Number(dish.price),0))}</span>
        <span class="combo-price">${money(getBundleBaseTotalCents(bundle)/100-getBundleSavingsFor(bundle))}</span>
        <span class="combo-saving">Save ${money(getBundleSavingsFor(bundle))} (${esc(bundle.discountPercent)}%)</span></div>
        ${active?'<button class="combo-action" type="button" disabled>Added to your order</button>':
          '<button class="combo-action" type="button" data-bundle-add="'+esc(bundle.id)+'">Add combo · save '+money(getBundleSavingsFor(bundle))+'</button>'}
        </article>`:'';
    $id('recommendation-list').innerHTML=suggestions.map(function(item){
        return `<article class="recommendation-card">
            <span class="recommendation-icon" aria-hidden="true">${esc(item.dish.icon||'🍽️')}</span>
            <span class="recommendation-info"><span class="recommendation-name">${esc(item.dish.name)}</span>
            <span class="recommendation-reason">${esc(item.reason)}</span>
            ${item.dish.promote?'<span class="chef-pick-label">Chef&#39;s pick</span>':''}</span>
            <span class="recommendation-price">${money(item.dish.price)}</span>
            <button class="recommendation-add" data-recommendation-add="${esc(item.id)}" aria-label="Add ${esc(item.dish.name)} to order">+</button>
        </article>`;
    }).join('');
    $id('recommendation-empty').hidden=suggestions.length>0||Boolean(bundle);
    if(!suggestions.length){
        const hasSafetyNeeds=safetyPreferences.allergens.length||safetyPreferences.dietary.length;
        setText('recommendation-empty',!safetyPreferencesReady
            ?'Review your saved allergy and dietary needs above before recommendations can be shown.'
            :hasSafetyNeeds
                ?'No dishes have verified tags that meet all your saved allergy and dietary needs.'
                :'No matching menu suggestions available right now.');
    }
}

window.onDishViewed=function(id){recommendationDishId=id;renderRecommendations();};
window.renderRecommendations=renderRecommendations;
function getBundleSavingsFor(bundle){
    if(getActiveBundle()&&getActiveBundle().id===bundle.id)return getBundleSavings();
    return Math.round(getBundleBaseTotalCents(bundle)*Number(bundle.discountPercent)/100)/100;
}
function addBundleToCart(bundle){
    if(!bundle||window.bundlesEnabled!==true||Number(bundle.discountPercent)!==Number(window.bundleDiscountPercent))return;
    if(bundle.items.length!==3||bundle.items.some(dish=>!menuData[dish.id]||
        !isAvailable(dish.id)||!window.isDishSafeForPreferences(menuData[dish.id],safetyPreferences)))return;
    bundle.ids.forEach(id=>{if(!cart[id])cart[id]={qty:1};});
    activeBundle={id:bundle.id,ids:bundle.ids.slice()};
    recommendationDishId=bundle.ids.find(id=>menuData[id].category==='main')||recommendationDishId;
    updateCartBar();
    renderRecommendations();
    if($id('cart-page').classList.contains('open'))renderCartPage();
    showToast('✓','Combo added','You save '+money(getBundleSavings()));
}

window.updateAllergenWarnings=function(onlyCard){
    const selected=safetyPreferences.allergens;
    const cards=onlyCard?[onlyCard]:document.querySelectorAll('.food-card[data-dish]');
    cards.forEach(card=>{
        const dish=menuData[card.dataset.dish]||{};
        let warning=card.querySelector('.allergen-warning');
        if(!warning){
            warning=document.createElement('p');
            warning.className='allergen-warning';
            warning.hidden=true;
            card.querySelector('.card-body').insertBefore(warning,card.querySelector('.card-btns'));
        }
        const contains=selected.filter(tag=>(dish.allergens||[]).includes(tag));
        const mayContain=selected.filter(tag=>(dish.may_contain_allergens||[]).includes(tag));
        const displayTags=tags=>tags.map(tag=>tag.replace(/_/g,' ')).join(', ');
        if(!selected.length){
            warning.hidden=true;
            warning.textContent='';
        }else if(contains.length){
            warning.textContent='Contains: '+displayTags(contains);
            warning.hidden=false;
        }else if(mayContain.length){
            warning.textContent='May contain: '+displayTags(mayContain);
            warning.hidden=false;
        }else if(dish.allergen_info_verified!==true){
            warning.textContent='Allergen information is not verified for your selected allergies.';
            warning.hidden=false;
        }else{
            warning.hidden=true;
            warning.textContent='';
        }
    });
};
updateAllergenWarnings();

document.addEventListener('change',function(event){
    if(event.target.matches('[data-allergen],[data-dietary-preference]'))saveSafetyPreferencesFromForm();
});
window.addEventListener('storage',function(event){
    if(event.key==='menuvision.order-history.v1'){
        renderCustomerHistory();
        return;
    }
    if(event.key!=='menuvision.safety-preferences.v1')return;
    safetyPreferenceLoad=safetyPreferenceStorage.load(window.localStorage);
    safetyPreferences=safetyPreferenceLoad.preferences;
    safetyPreferencesReady=safetyPreferenceLoad.ready;
    window.safetyPreferences=safetyPreferences;
    window.safetyPreferencesReady=safetyPreferencesReady;
    loadSafetyPreferencesIntoForm();
    updateAllergenWarnings();
    renderRecommendations();
    renderCustomerHistory();
});
window.refreshCustomerHistory=renderCustomerHistory;
document.addEventListener('click',function(event){
    const target=event.target.closest('#usual-order-add,#clear-order-history,[data-taste-add],[data-bundle-add],[data-recommendation-add],[data-dish-add],[data-cart-remove],[data-cart-add]');
    if(!target)return;
    if(target.id==='usual-order-add')addUsualOrder();
    else if(target.id==='clear-order-history')clearCustomerHistory();
    else if(target.hasAttribute('data-taste-add'))addTasteSuggestion(target.dataset.tasteAdd);
    else if(target.hasAttribute('data-bundle-add'))addBundleToCart(recommendationBundles.get(target.dataset.bundleAdd));
    else if(target.hasAttribute('data-cart-remove'))removeFromCart(target.dataset.cartRemove);
    else if(target.hasAttribute('data-cart-add'))addFromCart(target.dataset.cartAdd);
    else quickAdd(target.dataset.recommendationAdd||target.dataset.dishAdd);
});

let tableBoardTimer=null,tableBoardLoading=null;
window.getCurrentCartItems=function(){return Object.keys(cart).map(id=>({id:id,qty:cart[id].qty}));};
window.renderTableBoard=function(board){
    const section=$id('table-board'),content=$id('table-board-content');
    if(!section||!content)return;
    const dineIn=window.orderingMode&&window.orderingMode.status==='ready';
    section.hidden=!dineIn;
    if(!dineIn||!board)return;
    const basket=Array.isArray(board.basket)?board.basket:[],orders=Array.isArray(board.orders)?board.orders:[];
    const basketHtml=basket.length?'<div class="table-board-block"><b>Shared basket</b><ul>'+basket.map(item=>'<li><span>'+esc(item.qty)+'× '+esc(item.name)+'</span><span>'+money(Number(item.price)*Number(item.qty))+'</span></li>').join('')+'</ul></div>':'<p class="sub">No items in the shared basket yet.</p>';
    const ordersHtml=orders.length?'<div class="table-board-block"><b>Sent to kitchen</b><ul>'+orders.map(order=>'<li><span>Order #'+esc(order.order_no)+' · '+esc(order.status)+'</span><span>'+money(order.total)+'</span></li>').join('')+'</ul></div>':'';
    content.innerHTML=basketHtml+ordersHtml;
    const add=$id('table-board-add');if(add)add.disabled=!getCartCount();
};
window.refreshTableBoard=function(){
    if(!window.tableBoard||typeof window.tableBoard.load!=='function')return Promise.resolve(null);
    if(!tableBoardLoading)tableBoardLoading=window.tableBoard.load().then(window.renderTableBoard).catch(function(){ }).then(function(){tableBoardLoading=null;});
    return tableBoardLoading;
};
function openCart(){renderCartPage();$id('cart-page').classList.add('open');document.body.classList.add('sheet-open');history.pushState({page:'cart'},'');window.refreshTableBoard();clearInterval(tableBoardTimer);tableBoardTimer=setInterval(function(){if(!document.hidden&&$id('cart-page').classList.contains('open'))window.refreshTableBoard();},8000);}
document.addEventListener('click',function(event){
    if(event.target.closest('#table-board-refresh')){window.refreshTableBoard();return;}
    if(!event.target.closest('#table-board-add'))return;
    const items=window.getCurrentCartItems();
    if(!items.length||!window.tableBoard||typeof window.tableBoard.add!=='function')return;
    const button=$id('table-board-add');button.disabled=true;button.textContent='Adding to table...';
    window.tableBoard.add(items).then(window.renderTableBoard).then(function(){showToast('✓','Added to shared table order','Everyone at the table can see it.');})
        .catch(function(error){showToast('!','Could not update table order',error.message||'Try again.');})
        .then(function(){button.textContent='Add my basket to the table order';button.disabled=!getCartCount();});
});
function closeCart(){clearInterval(tableBoardTimer);$id('cart-page').classList.remove('open');document.body.classList.remove('sheet-open');}

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
                <button class="qty-btn" data-cart-remove="${esc(id)}" aria-label="One less">−</button>
                <span class="qty-num">${q}</span>
                <button class="qty-btn" data-cart-add="${esc(id)}" aria-label="One more">+</button>
            </div>
            <div class="cart-line-total">${money(m.price*q)}</div>
        </li>`;}).join('');
    const s=getCartTotal(),tax=cartTax(s);
    const subtotal=getCartSubtotal(),discount=getBundleSavings();
    setText('summary-subtotal',money(subtotal));
    const discountRow=$id('bundle-discount-row');
    discountRow.hidden=discount<=0;
    setText('bundle-discount-amount','−'+money(discount));
    setText('summary-tax-label','Service & tax ('+(+(taxRate*100).toFixed(2))+'%)');
    setText('summary-tax',money(tax));
    setText('summary-total',money(s+tax));
    window.refreshOrderButton();
}

// Without a database (config.js not filled in) this just shows the confirmation.
// data.js replaces it with the real one that sends the order to the kitchen.
// data.js decides whether this visit may order (a real table, or home mode later).
window.canPlaceOrder=function(){return true;};
window.refreshOrderButton=function(){const b=$id('place-order-btn');if(b)b.disabled=!getCartCount()||!window.canPlaceOrder();};
function placeOrder(){if(!getCartCount())return;showOrderSuccess(Math.floor(1000+Math.random()*9000));}
function showOrderSuccess(orderNo,orderId,total){
    const orderedItems=window.getCurrentCartItems();
    let savedHistory;
    try{
        savedHistory=customerHistoryStorage.recordOrder(window.localStorage,orderedItems);
    }catch(error){
        savedHistory={saved:false,error:error};
    }
    if(!savedHistory.saved){
        console.error('Could not save this completed order to local history:',savedHistory.error);
    }else{
        renderCustomerHistory();
    }
    setText('order-id-text','#'+orderNo);
    setStatusScreenMode(true);
    startOrderTracking(orderNo,orderId,total);
    cart={};activeBundle=null;updateCartBar();
    const note=$id('order-note');if(note)note.value='';
    closeCart();
    $id('order-success').classList.add('open');
}
function backToMenu(){$id('order-success').classList.remove('open');showMenu();updateOrderTracker();}
function showMenu(){$id('menu-page').style.display='flex';updateCartBar();}
/* ── Live order status ───────────────────────────────────────────
   A phone tracks only the orders it placed, using each order's private id
   (see order-status.js). Several orders are kept side by side, grouped by
   table, and checked together every few seconds while the page is open. */
const orderStatusStore=window.MenuOrderStatus;
let orderState=orderStatusStore?orderStatusStore.emptyState():null;
let orderPollTimer=null,orderPollBusy=false,orderFailures=0,orderTroubleReported=false;
let recoveryArmed=false,undoTimer=null,lastCleared=null;
function safeStorage(){try{return window.localStorage;}catch(error){return null;}}
function reportQuietly(context,error){
    console.error('['+context+']',error);
    if(typeof window.logClientError==='function')window.logClientError(context,error);
}
function persistOrders(){
    const storage=safeStorage();
    if(!storage||!orderStatusStore)return;
    const result=orderStatusStore.save(storage,orderState);
    if(!result.saved)reportQuietly('save_orders',result.error);
}
function makeRequestId(){
    if(window.crypto&&typeof crypto.randomUUID==='function')return crypto.randomUUID();
    const b=crypto.getRandomValues(new Uint8Array(16));
    b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;
    const h=[...b].map(x=>x.toString(16).padStart(2,'0')).join('');
    return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);
}
function currentTable(){return (window.orderingMode&&window.orderingMode.table)||null;}

// Called by data.js just before an order is sent, and after it is confirmed or refused.
window.beginOrderRequest=function(items){
    if(!orderStatusStore)return null;
    try{
        const request=orderStatusStore.requestFor(orderState,items,Date.now(),makeRequestId);
        orderState=request.state;
        recoveryArmed=false; // this page is sending it, so it will hear the answer itself
        persistOrders();
        return request.requestId;
    }catch(error){
        reportQuietly('order_request',error);
        return null;
    }
};
window.endOrderRequest=function(){
    if(!orderStatusStore)return;
    orderState=orderStatusStore.clearPending(orderState);
    persistOrders();
};

function startOrderTracking(orderNo,orderId,total){
    if(!orderStatusStore||!orderId){renderOrders();return;}
    const result=orderStatusStore.addOrder(orderState,{
        id:String(orderId).toLowerCase(),orderNo:Number(orderNo),table:currentTable(),
        placedAt:Date.now(),total:Number.isFinite(total)?total:null,status:'new',
        orderType:(window.orderingMode&&window.orderingMode.type)||'dine_in'
    });
    if(result.error)reportQuietly('track_order',result.error);
    orderState=result.state;
    persistOrders();
    renderOrders();
    scheduleOrderPoll(0);
}

function isTrackingTroubled(){
    return orderStatusStore.isTroubled(orderFailures,navigator.onLine!==false);
}
function hasTrackedOrders(){return Boolean(orderState&&orderState.orders.length);}
function scheduleOrderPoll(delay){
    clearTimeout(orderPollTimer);orderPollTimer=null;
    if(!orderStatusStore||(!hasTrackedOrders()&&!(recoveryArmed&&orderState.pending)))return;
    orderPollTimer=setTimeout(pollOrders,delay);
}
function nextPollDelay(){
    const t=orderStatusStore.timing;
    const busy=orderState.orders.some(o=>{const d=orderStatusStore.describe(o);return !d.finished||d.refundDue;});
    return busy?t.pollMs:t.slowPollMs;
}
function pollOrders(){
    orderPollTimer=null;
    if(orderPollBusy||document.hidden)return; // a hidden page resumes when it is shown again
    if(navigator.onLine===false){renderOrders();scheduleOrderPoll(orderStatusStore.timing.pollMs);return;}
    orderPollBusy=true;
    const jobs=[];
    if(recoveryArmed&&orderState.pending&&typeof window.recoverOrder==='function')jobs.push(recoverPendingOrder());
    if(hasTrackedOrders()&&typeof window.fetchOrderStatuses==='function'){
        const ids=orderState.orders.map(o=>o.id);
        jobs.push(window.fetchOrderStatuses(ids).then(rows=>applyOrderRows(rows,ids)));
    }
    Promise.all(jobs).then(function(){
        orderFailures=0;orderTroubleReported=false;
    }).catch(function(error){
        orderFailures++;
        if(isTrackingTroubled()&&!orderTroubleReported){orderTroubleReported=true;reportQuietly('order_tracking',error);}
        else console.warn('Order status check failed, retrying:',error);
    }).then(function(){
        orderPollBusy=false;
        renderOrders();
        scheduleOrderPoll(orderFailures?orderStatusStore.timing.pollMs:nextPollDelay());
    });
}
function applyOrderRows(rows,askedIds){
    const before=JSON.stringify(orderState);
    const result=orderStatusStore.applyStatuses(orderState,rows,askedIds);
    orderState=result.state;
    if(result.removed.length)console.warn('Forgetting orders the kitchen no longer lists:',result.removed.map(o=>o.orderNo));
    if(JSON.stringify(orderState)!==before)persistOrders();
    const alert=orderStatusStore.alertFor(result.changes);
    if(alert){
        showToast(alert.kind==='ready'?'✓':alert.kind==='cancelled'?'!':'•',alert.title,alert.sub,5000);
        if(alert.vibrate&&navigator.vibrate){try{navigator.vibrate([120,80,120]);}catch(error){}}
    }
}
// The page reloaded while an order was being sent. Ask the kitchen whether it arrived.
function recoverPendingOrder(){
    const pending=orderState.pending;
    return window.recoverOrder(pending.requestId).then(function(row){
        if(orderState.pending!==pending)return;
        if(row){
            const added=orderStatusStore.addOrder(orderState,{
                id:String(row.id).toLowerCase(),orderNo:Number(row.order_no),
                table:row.table_label!==undefined?row.table_label:currentTable(),
                placedAt:pending.startedAt,total:Number(row.total),status:row.status,
                orderType:row.order_type||(window.orderingMode&&window.orderingMode.type)||'dine_in'
            });
            orderState=added.state;
            if(added.added)showToast('✓','We found your order #'+row.order_no,'It reached the kitchen before the page reloaded.',5000);
        }
        orderState=orderStatusStore.clearPending(orderState);
        recoveryArmed=false;
        persistOrders();
    });
}

function orderCardHtml(order){
    const info=orderStatusStore.describe(order);
    const steps=orderStatusStore.steps.map(function(step,index){
        const cls=info.step>index?'done':info.step===index?'current':'';
        const label=orderStatusStore.labels[step];
        return '<li class="'+cls+'"'+(info.step===index?' aria-current="step"':'')+'><span class="ok-dot"></span>'+label+'</li>';
    }).join('');
    return '<article class="track-card" data-status="'+info.status+'"'+(info.refundDue?' data-refund="due"':'')+'>'+
        '<div class="tc-top"><span class="tc-no">#'+esc(order.orderNo)+'</span>'+
        '<span class="tc-label">'+esc(info.label)+'</span>'+
        (order.paid?'<span class="tc-paid">Paid</span>':'')+
        (order.total!==null?'<span class="tc-total">'+money(order.total)+'</span>':'')+'</div>'+
        '<ol class="ok-steps'+(info.status==='cancelled'?' cancelled':'')+'" aria-label="Progress of order '+esc(order.orderNo)+'">'+steps+'</ol>'+
        '<p class="tc-note">'+esc(info.note)+'</p>'+
        (orderStatusStore.canClear(order)?'<button type="button" class="tc-clear" data-clear-order="'+esc(order.id)+'">Clear from this phone</button>':'')+
        '</article>';
}
function renderOrders(){
    if(!orderStatusStore)return;
    const troubled=hasTrackedOrders()&&isTrackingTroubled();
    const warning=$id('order-tracking-warning');
    if(warning)warning.hidden=!troubled;
    const groupsEl=$id('order-groups');
    if(groupsEl){
        groupsEl.innerHTML=orderStatusStore.groupByTable(orderState.orders).map(function(group){
            return '<section class="order-group"><h3 class="og-head">'+esc(group.heading)+'</h3>'+
                group.orders.map(orderCardHtml).join('')+'</section>';
        }).join('');
    }
    const billEl=$id('order-bill');
    if(billEl){
        const bill=orderStatusStore.billSummary(orderState.orders);
        billEl.hidden=bill.count<1;
        if(bill.count){
            billEl.innerHTML='<div class="ob-row"><span>'+(bill.count>1?'To pay for all '+bill.count+' orders':'To pay')+'</span>'+
                '<b>'+money(bill.total)+'</b></div>'+
                '<p>Orders '+bill.orderNos.map(n=>'#'+esc(n)).join(', ')+'. Pay at the table: staff can take payment for all of them at once.</p>';
        }
    }
    updateOrderTracker();
}
function updateOrderTracker(){
    const pill=$id('order-tracker');if(!pill||!orderStatusStore)return;
    const onMenu=$id('menu-page').style.display!=='none'&&!$id('order-success').classList.contains('open')&&
        !$id('cart-page').classList.contains('open');
    if(!hasTrackedOrders()||!onMenu){pill.hidden=true;return;}
    const troubled=isTrackingTroubled();
    setText('order-tracker-text',orderStatusStore.trackerText(orderState.orders,troubled));
    pill.dataset.status=troubled?'trouble':orderState.orders.some(o=>o.status==='ready')?'ready':
        orderStatusStore.describe(orderState.orders[orderState.orders.length-1]).status;
    pill.classList.toggle('lifted',$id('cart-bar').classList.contains('visible'));
    pill.hidden=false;
}
function setStatusScreenMode(fresh){
    $id('order-success').classList.toggle('status-mode',!fresh);
    setText('ok-kicker',fresh?'Order received':'Live status');
    setText('ok-h',fresh?'Sent to the kitchen':'Your orders');
}
function openOrderStatus(){
    if(!hasTrackedOrders())return;
    setStatusScreenMode(false);
    $id('order-success').classList.add('open');
    renderOrders();
    scheduleOrderPoll(0);
}
function showUndo(order){
    lastCleared=order;
    setText('undo-text','Order #'+order.orderNo+' cleared');
    const bar=$id('undo-bar');bar.hidden=false;
    clearTimeout(undoTimer);
    undoTimer=setTimeout(function(){bar.hidden=true;lastCleared=null;},6000);
}
function undoClear(){
    if(!lastCleared)return;
    orderState=orderStatusStore.restoreOrder(orderState,lastCleared,Date.now());
    lastCleared=null;clearTimeout(undoTimer);
    $id('undo-bar').hidden=true;
    persistOrders();renderOrders();scheduleOrderPoll(0);
}
document.addEventListener('click',function(e){
    const btn=e.target.closest('[data-clear-order]');
    if(!btn||!orderStatusStore)return;
    const result=orderStatusStore.clearOrder(orderState,btn.getAttribute('data-clear-order'));
    if(!result.cleared){renderOrders();return;}
    orderState=result.state;
    persistOrders();renderOrders();showUndo(result.cleared);
    if(!hasTrackedOrders()&&$id('order-success').classList.contains('status-mode'))backToMenu();
});
document.addEventListener('visibilitychange',function(){
    if(document.hidden)return;
    scheduleOrderPoll(0);
    if($id('cart-page').classList.contains('open'))window.refreshTableBoard();
});
window.addEventListener('online',function(){scheduleOrderPoll(0);});
window.addEventListener('offline',renderOrders);
// Quietly report unexpected script errors for the owner to review later.
window.addEventListener('error',function(e){
    if(e.message)reportQuietly('page_error',e.message+' @ '+String(e.filename||'').split('/').pop()+':'+e.lineno);
});
window.addEventListener('unhandledrejection',function(e){reportQuietly('unhandled_promise',e.reason);});
// Resume after a reload, once data.js has connected to the kitchen.
document.addEventListener('DOMContentLoaded',function(){
    if(!orderStatusStore)return;
    const storage=safeStorage();
    if(!storage)return;
    const loaded=orderStatusStore.load(storage,Date.now());
    if(!loaded.ready)reportQuietly('load_orders',loaded.error);
    else if(loaded.damaged)reportQuietly('load_orders','Some saved orders were unreadable and were skipped');
    orderState=loaded.state;
    recoveryArmed=Boolean(orderState.pending);
    persistOrders();
    renderOrders();
    scheduleOrderPoll(0);
});
window.getBundleOrderPayload=function(){
    const bundle=getActiveBundle();
    return bundle?{
        ids:bundle.ids,
        dietary_filters:safetyPreferences.dietary,
        allergen_filters:safetyPreferences.allergens
    }:null;
};
window.refreshBundlePricing=function(){
    updateCartBar();
    if($id('cart-page').classList.contains('open'))renderCartPage();
};

let toastTimer;
function showToast(icon,msg,sub,ms){
    setText('toast-icon',icon);setText('toast-msg',msg);setText('toast-sub',sub||'');
    const t=$id('toast');t.classList.add('show');
    clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),ms||2000);
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
