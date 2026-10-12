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
  /* ── Ordering mode ────────────────────────────────────────────
     A table QR code opens the menu as  index.html?table=5&k=<secret>  → DINE-IN.
     Opened with no table → HOME. Until delivery and collection exist (Phase 2),
     home visitors can browse but not order. The database makes the final
     decision, so a table typed in by hand is refused there too. */
  var params = new URLSearchParams(location.search);
  var table = (params.get('table') || '').trim().slice(0, 20);
  var tableKey = (params.get('k') || '').trim().slice(0, 64);
  var MODE_TEXT = {
    checking: 'Checking your table…',
    bad_table: "We don't recognise this table code. Please ask a member of staff for help.",
    home: "You're browsing from home. Delivery and collection are coming soon. To order now, scan the QR code on your table."
  };
  // status: 'checking' | 'ready' | 'bad_table' | 'home'
  window.orderingMode = { type: table ? 'dine_in' : 'home', table: table || null, status: table ? 'checking' : 'home' };
  function setOrderingStatus(status) {
    window.orderingMode.status = status;
    var dineIn = status === 'ready';
    document.querySelectorAll('[data-table]').forEach(function (el) {
      el.textContent = 'Dine-in · Table ' + table;
      el.hidden = !dineIn;
    });
    document.querySelectorAll('[data-table-num]').forEach(function (el) { el.textContent = table; });
    document.querySelectorAll('[data-table-row]').forEach(function (el) { el.hidden = !table; });
    var banner = document.getElementById('mode-banner');
    if (banner) {
      banner.textContent = status === 'checking' ? '' : (MODE_TEXT[status] || '');
      banner.hidden = !(status === 'bad_table' || status === 'home');
      banner.dataset.mode = status;
    }
    var note = document.getElementById('order-mode-note');
    if (note) { note.textContent = MODE_TEXT[status] || ''; note.hidden = dineIn; }
    if (typeof window.refreshOrderButton === 'function') window.refreshOrderButton();
  }
  window.canPlaceOrder = function () { return window.orderingMode.status === 'ready'; };
  setOrderingStatus(window.orderingMode.status);

  var cfg = window.MENU_CONFIG;
  if (!cfg || !window.supabase || /^YOUR_/.test(cfg.supabaseUrl)) {
    console.warn('Supabase not configured — menu is using built-in data, orders are not sent.');
    window.canPlaceOrder = function () { return true; };
    return;
  }
  var db = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);

  var tableBoardSessionId = null;
  window.tableBoard = {
    load: function () {
      if (!table || !tableKey) return Promise.resolve(null);
      return db.rpc('get_table_board', { p_table: table, p_key: tableKey }).then(function (res) {
        if (res.error) throw res.error;
        tableBoardSessionId = res.data && res.data.session_id;
        window.tableBoardSessionId = tableBoardSessionId;
        return res.data;
      });
    },
    add: function (items) {
      if (!tableBoardSessionId) return Promise.reject(new Error('Table board is not ready'));
      return db.rpc('add_table_board_items', { p_table: table, p_key: tableKey, p_session_id: tableBoardSessionId, p_items: items }).then(function (res) {
        if (res.error) throw res.error;
        return res.data;
      });
    },
    consume: function (items) {
      if (!tableBoardSessionId) return Promise.resolve(null);
      return db.rpc('consume_table_board_items', { p_table: table, p_key: tableKey, p_session_id: tableBoardSessionId, p_items: items }).then(function (res) {
        if (res.error) throw res.error;
        return res.data;
      });
    }
  };

  // Ask the database whether this table and its secret code are real.
  if (table) {
    db.rpc('check_table', { p_table: table, p_key: tableKey }).then(function (res) {
      if (res.error) throw res.error;
      setOrderingStatus(res.data === true ? 'ready' : 'bad_table');
      window.tableBoard.load().then(function (board) {
        if (typeof window.renderTableBoard === 'function') window.renderTableBoard(board);
      }).catch(function (error) {
        if (typeof window.logClientError === 'function') window.logClientError('table_board', error);
      });
    }).catch(function (error) {
      // Could not check (e.g. offline). Let the customer try: the database still
      // refuses a wrong table when the order is sent.
      setOrderingStatus('ready');
      if (typeof window.logClientError === 'function') window.logClientError('check_table', error);
    });
  }
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
  // Gives up on a slow request after `ms` so the screen never waits forever.
  function withTimeout(request, ms) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, ms);
    return request.abortSignal(controller.signal).then(function (res) {
      clearTimeout(timer);
      return res;
    }, function (error) {
      clearTimeout(timer);
      throw error;
    });
  }
  function trackingTimeout() {
    return (window.MenuOrderStatus && window.MenuOrderStatus.timing.timeoutMs) || 10000;
  }

  // Status of the orders this phone placed. Their private ids are the only key.
  window.fetchOrderStatuses = function (orderIds) {
    return withTimeout(db.rpc('order_statuses', { p_order_ids: orderIds }), trackingTimeout()).then(function (res) {
      if (res.error) throw res.error;
      return Array.isArray(res.data) ? res.data : [];
    });
  };
  // After a reload mid-checkout: did the kitchen receive the order this phone was sending?
  window.recoverOrder = function (requestId) {
    return withTimeout(db.rpc('recover_order', { p_request_id: requestId }), trackingTimeout()).then(function (res) {
      if (res.error) throw res.error;
      return Array.isArray(res.data) && res.data.length ? res.data[0] : null;
    });
  };

  // Quiet error log for the owner. Never shows anything to the customer and never
  // sends order ids. At most 15 reports per page load, no repeats within a minute.
  var reported = Object.create(null), reportCount = 0;
  window.logClientError = function (context, error) {
    try {
      var message = String(error && (error.message || error.details) || error || '').slice(0, 500);
      var key = context + '|' + message;
      var now = Date.now();
      if (reportCount >= 15 || (reported[key] && now - reported[key] < 60000)) return;
      reported[key] = now; reportCount++;
      db.rpc('log_client_error', {
        p_context: String(context).slice(0, 60),
        p_message: message,
        p_page: (location.pathname + (table ? '?table=' + encodeURIComponent(table) : '')).slice(0, 200),
        p_user_agent: String(navigator.userAgent || '').slice(0, 200)
      }).then(function () {}, function () {});
    } catch (e) { /* logging must never break the page */ }
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
    m.ingredients = Array.isArray(d.ingredients) && d.ingredients.length ? d.ingredients : (m.ingredients || []);
    m.caloriesPer100g = Number(d.calories_per_100g) || Number(m.caloriesPer100g) || 0;
    m.portionGrams = Number(d.portion_grams) || Number(m.portionGrams) || 0;
    m.exactCalories = m.caloriesPer100g && m.portionGrams
      ? Math.round(m.caloriesPer100g * m.portionGrams / 100) + ' kcal'
      : d.calories || m.exactCalories;
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
    card.querySelector('.card-cal').textContent = m.exactCalories;
    var ingredients = card.querySelector('.card-ingredients');
    if (!ingredients) {
      ingredients = document.createElement('p');
      ingredients.className = 'card-ingredients';
      card.querySelector('.card-body').insertBefore(ingredients, card.querySelector('.card-btns'));
    }
    ingredients.textContent = m.ingredients.length ? 'Ingredients: ' + m.ingredients.join(', ') : '';
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
  // Double taps are ignored while an order is being sent. Each checkout attempt
  // also carries a request id: if the same basket is sent again after a timeout,
  // the kitchen returns the first order instead of making a second one.
  var sending = false;
  // Longer codes first: 'UNAVAILABLE' is also part of the other two names.
  var REJECTIONS = ['NOT_ACCEPTING', 'BAD_TABLE', 'ORDER_TYPE_UNAVAILABLE', 'BUNDLE_UNAVAILABLE', 'UNAVAILABLE', 'BAD_ITEMS', 'BAD_BUNDLE'];
  window.placeOrder = function () {
    if (!getCartCount() || sending) return;
    if (!window.canPlaceOrder()) {
      var why = window.orderingMode.status;
      showToast('!', why === 'home' ? 'Ordering from home is coming soon' : why === 'checking' ? 'Checking your table…' : 'Table not recognised',
        why === 'home' ? 'Scan the QR code on your table to order' : why === 'checking' ? 'One moment, please' : 'Please ask a member of staff', 4000);
      return;
    }
    sending = true;
    var btn = document.getElementById('place-order-btn');
    var label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Sending to the kitchen…';
    var note = document.getElementById('order-note');

    var items = Object.keys(cart).map(function (id) { return { id: id, qty: cart[id].qty }; });
    var requestId = typeof window.beginOrderRequest === 'function' ? window.beginOrderRequest(items) : null;
    withTimeout(db.rpc('place_order', {
      p_table: table || null,
      p_items: items,
      p_note: note ? note.value : null,
      p_bundle: typeof window.getBundleOrderPayload === 'function' ? window.getBundleOrderPayload() : null,
      p_request_id: requestId,
      p_order_type: 'dine_in',
      p_table_key: tableKey || null
    }), 20000)
      .then(function (res) {
        if (res.error) throw res.error;
        if (typeof window.endOrderRequest === 'function') window.endOrderRequest();
        showOrderSuccess(res.data.order_no, res.data.id, Number(res.data.total));
        if (window.tableBoard && typeof window.tableBoard.consume === 'function') {
          window.tableBoard.consume(items).then(function (board) {
            if (typeof window.renderTableBoard === 'function') window.renderTableBoard(board);
          }).catch(function (error) { if (typeof window.logClientError === 'function') window.logClientError('table_board_consume', error); });
        }
      })
      .catch(function (e) {
        var msg = String(e && e.message || '');
        var rejection = REJECTIONS.filter(function (code) { return msg.indexOf(code) !== -1; })[0];
        if (rejection) {
          // The kitchen definitely refused this basket, so a retry is a fresh attempt.
          if (typeof window.endOrderRequest === 'function') window.endOrderRequest();
          if (rejection === 'NOT_ACCEPTING') showToast('!', 'Not taking orders right now', 'Please ask a member of staff');
          else if (rejection === 'BAD_TABLE') { setOrderingStatus('bad_table'); showToast('!', 'Table not recognised', 'Please ask a member of staff', 5000); }
          else if (rejection === 'ORDER_TYPE_UNAVAILABLE') showToast('!', 'This kind of order is not available yet', 'Please ask a member of staff', 5000);
          else if (rejection === 'BUNDLE_UNAVAILABLE') { showToast('!', 'Combo deal changed', 'Please review your basket and try again'); loadAll(); }
          else if (rejection === 'UNAVAILABLE') { showToast('!', 'Something in your order sold out', 'Please check your order'); loadAll(); }
          else showToast('!', 'Order not sent', 'Please check your order and try again');
        } else {
          // Unknown outcome (offline, timeout): the kitchen may or may not have it.
          // Tapping again re-sends the same attempt, which can never create a second order.
          showToast('!', "We couldn't confirm your order", "Tap Place order again. It won't be sent twice.", 5000);
          window.logClientError('place_order', e);
        }
        console.error('Order failed:', e);
      })
      .then(function () { sending = false; btn.textContent = label; btn.disabled = !getCartCount() || !window.canPlaceOrder(); });
  };
})();
