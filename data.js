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

  /* ── Apply data to the page ─────────────────────────────────── */
  function applyRestaurant(r) {
    if (!r) return;
    currency = r.currency || currency;
    taxRate = Number(r.tax_rate);
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
    if (!m) return;                        // no 3D model for this dish on the menu
    m.name = d.name; m.desc = d.description; m.price = Number(d.price);
    m.calories = d.calories; m.time = d.prep_time; m.rating = d.rating;
    m.size = d.size; m.serves = d.serves; m.weight = d.weight; m.icon = d.icon;
    m.available = d.available;

    var card = document.querySelector('.food-card[data-dish="' + d.id + '"]');
    if (!card) return;
    card.querySelector('.card-name').textContent = d.name;
    card.querySelector('.card-desc').textContent = d.description;
    card.querySelector('.card-size').textContent = [d.size, d.serves].filter(Boolean).join(' · ');
    card.querySelector('.card-cal').textContent = d.calories;
    card.querySelector('.card-price').textContent = money(d.price);
    card.classList.toggle('sold-out', !d.available);
    card.querySelector('.card-add-btn').disabled = !d.available;
  }

  function refreshOpenViews() {
    updateCartBar();
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
      refreshOpenViews();
    }).catch(function (e) { console.error('Menu load failed:', e); });
  }
  loadAll();

  // Owner edits show up live on customers' phones
  db.channel('menu-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'dishes' }, function (p) {
      if (p.new && p.new.id) { applyDish(p.new); refreshOpenViews(); }
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
    db.rpc('place_order', { p_table: table || null, p_items: items, p_note: note ? note.value : null })
      .then(function (res) {
        if (res.error) throw res.error;
        showOrderSuccess(res.data.order_no);
      })
      .catch(function (e) {
        var msg = String(e && e.message || '');
        if (msg.indexOf('NOT_ACCEPTING') !== -1) showToast('!', 'Not taking orders right now', 'Please ask a member of staff');
        else if (msg.indexOf('UNAVAILABLE') !== -1) { showToast('!', 'Something in your order sold out', 'Please check your order'); loadAll(); }
        else showToast('!', 'Order not sent', 'Check your connection and try again');
        console.error('Order failed:', e);
      })
      .then(function () { sending = false; btn.textContent = label; btn.disabled = !getCartCount(); });
  };
})();
