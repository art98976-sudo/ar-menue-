/* ════════════════════════════════════════════════════════════════
   Live menu data — connects the customer menu to Supabase.

   • Prices, dish details, sold-out state and restaurant info come from
     the owner dashboard, and update on open phones without a reload.
   • "Place Order" sends the order to the kitchen dashboard.
   • Table number comes from the QR code link: index.html?table=12

   If config.js still has the placeholder values, the menu keeps working
   from the built-in data in script.js (orders are then not sent anywhere).
   ════════════════════════════════════════════════════════════════ */
(function () {
  var table = (new URLSearchParams(location.search).get('table') || '').trim().slice(0, 20);
  document.querySelectorAll('[data-table]').forEach(function (el) {
    el.textContent = 'Table ' + table;
    el.hidden = !table;
  });
  document.querySelectorAll('[data-table-num]').forEach(function (el) { el.textContent = table; });
  document.querySelectorAll('[data-table-row]').forEach(function (el) { el.hidden = !table; });

  var cfg = window.MENU_CONFIG;
  if (!cfg || !window.supabase || /^YOUR_/.test(cfg.supabaseUrl)) {
    console.warn('Supabase not configured — menu is using built-in data, orders are not sent.');
    return;
  }
  var db = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  var pairingCache = Object.create(null);
  window.requestAiRecommendations = function (payload) {
    return db.functions.invoke('recommend', { body: payload }).then(function (res) {
      if (res.error) throw res.error;
      if (!res.data || !Array.isArray(res.data.dish_ids)) {
        throw new Error('AI recommendation function returned an invalid response');
      }
      return res.data.dish_ids;
    });
  };
  window.loadPopularPairings = function (dishIds) {
    var ids = Array.from(new Set(dishIds.map(String))).slice(0, 50);
    var key = ids.slice().sort().join('\u001f');
    var cached = pairingCache[key];
    if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.counts);
    return db.rpc('popular_dish_pairings', { p_dish_ids: ids, p_limit: 1000 }).then(function (res) {
      if (res.error) throw res.error;
      var counts = Object.create(null);
      (res.data || []).forEach(function (pair) {
        counts[pair.dish_id] = Number(pair.order_count);
      });
      pairingCache[key] = { counts: counts, expiresAt: Date.now() + 300000 };
      return counts;
    });
  };

  /* ── Apply data to the page ─────────────────────────────────── */
  function applyRestaurant(r) {
    if (!r) return;
    currency = r.currency || currency;
    taxRate = Number(r.tax_rate);
    window.recommendationsEnabled = r.recommendations_enabled !== false;
    window.aiRecommendationsEnabled = r.ai_recommendations_enabled === true;
    window.bundlesEnabled = r.bundles_enabled === true;
    window.bundleDiscountPercent = Number(r.bundle_discount_percent) || 0;
    if (typeof window.renderRecommendations === 'function') window.renderRecommendations();
    if (typeof window.refreshBundlePricing === 'function') window.refreshBundlePricing();
    var h1 = document.getElementById('r-name');
    if (h1 && r.name) {
      // last word in gold italics, like the original design
      var words = r.name.trim().split(/\s+/), last = words.pop();
      h1.innerHTML = (words.length ? esc(words.join(' ')) + ' ' : '') + '<em>' + esc(last) + '</em>';
    }
    var mono = document.getElementById('r-mono');
    if (mono && r.name) mono.textContent = r.name.replace(/^the\s+/i, '').charAt(0).toUpperCase();
    var p = document.getElementById('r-tagline'); if (p) p.textContent = r.tagline;
    var b = document.getElementById('r-badge'); if (b) b.textContent = r.badge;
    if (r.name) document.title = r.name + ' — Menu';
  }

  function applyDish(d) {
    var m = menuData[d.id];
    if (!m) {
      m = menuData[d.id] = { model: '' };
    }
    m.id = d.id;
    m.name = d.name; m.desc = d.description; m.price = Number(d.price);
    m.calories = d.calories; m.time = d.prep_time; m.rating = d.rating;
    m.size = d.size; m.serves = d.serves; m.weight = d.weight; m.icon = d.icon;
    m.category = d.category;
    m.flavour = d.flavour || [];
    m.dietary = d.dietary || [];
    m.allergens = d.allergens;
    m.may_contain_allergens = d.may_contain_allergens;
    m.allergen_info_verified = d.allergen_info_verified === true;
    m.price_band = d.price_band;
    m.meal_part = d.meal_part;
    m.promote = d.promote;
    m.available = d.available;

    var card = Array.prototype.find.call(document.querySelectorAll('.food-card[data-dish]'), function (el) {
      return el.dataset.dish === String(d.id);
    });
    if (!card) card = createDishCard(d, m);
    card.querySelector('.card-name').textContent = d.name;
    card.querySelector('.card-desc').textContent = d.description;
    card.querySelector('.card-size').textContent = [d.size, d.serves].filter(Boolean).join(' · ');
    card.querySelector('.card-cal').textContent = d.calories;
    card.querySelector('.card-price').textContent = money(d.price);
    card.classList.toggle('sold-out', !d.available);
    card.querySelector('.card-add-btn').disabled = !d.available;
    var pick = card.querySelector('.chef-pick-pill');
    if (d.promote && !pick) {
      pick = document.createElement('span');
      pick.className = 'chef-pick-pill';
      pick.textContent = "Chef's pick";
      card.querySelector('.card-media').appendChild(pick);
    } else if (!d.promote && pick) {
      pick.remove();
    }
    if (typeof window.updateAllergenWarnings === 'function') window.updateAllergenWarnings(card);
  }

  function menuCategory(category) {
    var definitions = {
      main: { id: 'mains', label: 'Mains', intro: 'Freshly made to order' },
      side: { id: 'sides', label: 'Sides', intro: 'A little something extra' },
      drink: { id: 'drinks', label: 'Drinks', intro: 'Pressed and poured fresh' },
      dessert: { id: 'desserts', label: 'Desserts', intro: 'Something sweet to finish' }
    };
    var definition = definitions[category] || definitions.main;
    var grid = document.querySelector('.grid[data-category="' + category + '"]');
    if (grid) return grid;

    var section = document.createElement('section');
    section.className = 'menu-section';
    section.id = definition.id;
    section.setAttribute('aria-labelledby', definition.id + '-h');
    section.innerHTML = '<div class="section-head"><h2 id="' + definition.id + '-h">' + definition.label +
      '</h2><p>' + definition.intro + '</p></div><div class="grid" data-category="' + category + '"></div>';
    document.querySelector('.menu-foot').before(section);

    var link = document.createElement('a');
    link.className = 'cat-link';
    link.href = '#' + definition.id;
    link.textContent = definition.label + ' ';
    var count = document.createElement('span');
    count.textContent = '0';
    link.appendChild(count);
    document.querySelector('.cats').appendChild(link);
    return section.querySelector('.grid');
  }

  function createDishCard(d, m) {
    var category = ['main', 'side', 'drink', 'dessert'].indexOf(d.category) === -1 ? 'main' : d.category;
    var grid = menuCategory(category);
    var card = document.createElement('article');
    card.className = 'food-card';
    card.dataset.dish = d.id;
    card.innerHTML = '<div class="card-media"><div class="dish-placeholder" aria-hidden="true">' + esc(m.icon || '🍽️') +
      '</div><span class="sold-pill">Sold out</span></div><div class="card-body">' +
      '<div class="card-head"><h3 class="card-name">' + esc(m.name) + '</h3><span class="card-price">' + money(m.price) +
      '</span></div><p class="card-desc">' + esc(m.desc) + '</p><p class="card-facts"><span class="card-size">' +
      esc([m.size, m.serves].filter(Boolean).join(' · ')) + '</span><span class="card-cal">' + esc(m.calories) +
      '</span></p><p class="allergen-warning" hidden></p><div class="card-btns"><button class="card-add-btn" data-dish-add="' + esc(d.id) +
      '" aria-label="Add ' + esc(m.name) + ' to order"><svg><use href="#i-plus"/></svg>' +
      '<span class="in-cart-qty">0</span></button></div></div>';
    grid.appendChild(card);
    return card;
  }

  function refreshCategoryCounts() {
    document.querySelectorAll('.cats .cat-link').forEach(function (link) {
      var section = document.querySelector(link.getAttribute('href'));
      var count = link.querySelector('span');
      if (section && count) count.textContent = section.querySelectorAll('.food-card').length;
    });
  }

  function refreshOpenViews() {
    updateCartBar();
    renderRecommendations();
    if (typeof window.refreshCustomerHistory === 'function') window.refreshCustomerHistory();
    if (document.getElementById('cart-page').classList.contains('open')) renderCartPage();
    if (currentModel) updateViewerUI(currentModel);
  }

  function loadAll() {
    return Promise.all([
      db.from('restaurant').select('*').eq('id', 1).maybeSingle(),
      db.from('dishes').select('*').order('sort')
    ]).then(function (res) {
      if (res[0].error || res[1].error) throw res[0].error || res[1].error;
      applyRestaurant(res[0].data);
      res[1].data.forEach(applyDish);
      refreshCategoryCounts();
      refreshOpenViews();
    }).catch(function (e) { console.error('Menu load failed:', e); });
  }
  loadAll();

  // Owner edits show up live on customers' phones
  db.channel('menu-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'dishes' }, function (p) {
      if (p.new && p.new.id) { applyDish(p.new); refreshCategoryCounts(); refreshOpenViews(); }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'restaurant' }, function (p) {
      if (p.new) { applyRestaurant(p.new); refreshOpenViews(); }
    })
    .subscribe();

  /* ── Send orders to the kitchen ─────────────────────────────── */
  var sending = false;
  window.placeOrder = function () {
    if (!getCartCount() || sending) return;
    sending = true;
    var btn = document.getElementById('place-order-btn');
    var label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Sending to the kitchen…';
    var note = document.getElementById('order-note');

    var items = Object.keys(cart).map(function (id) { return { id: id, qty: cart[id].qty }; });
    db.rpc('place_order', {
      p_table: table || null,
      p_items: items,
      p_note: note ? note.value : null,
      p_bundle: typeof window.getBundleOrderPayload === 'function' ? window.getBundleOrderPayload() : null
    })
      .then(function (res) {
        if (res.error) throw res.error;
        showOrderSuccess(res.data.order_no);
      })
      .catch(function (e) {
        var msg = String(e && e.message || '');
        if (msg.indexOf('NOT_ACCEPTING') !== -1) showToast('!', 'Not taking orders right now', 'Please ask a member of staff');
        else if (msg.indexOf('UNAVAILABLE') !== -1) { showToast('!', 'Something in your order sold out', 'Please check your order'); loadAll(); }
        else if (msg.indexOf('BUNDLE_UNAVAILABLE') !== -1) {
          showToast('!', 'Combo deal changed', 'Please review your basket and try again');
          loadAll();
        }
        else showToast('!', 'Order not sent', 'Check your connection and try again');
        console.error('Order failed:', e);
      })
      .then(function () { sending = false; btn.textContent = label; btn.disabled = !getCartCount(); });
  };
})();
