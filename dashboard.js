/* ════════════════════════════════════════════════════════════════
   Owner dashboard — live orders, menu & prices, restaurant info.
   Data lives in Supabase (see supabase/schema.sql). Only accounts listed
   in public.owners can read orders or change anything; the database
   enforces that, this page just shows the right screens.
   ════════════════════════════════════════════════════════════════ */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var cfg = window.MENU_CONFIG;

  if (!cfg || /^YOUR_/.test(cfg.supabaseUrl)) {
    $('login').classList.remove('hidden');
    $('login-err').textContent = 'Supabase is not set up yet — add your project URL and anon key to config.js.';
    $('login-btn').disabled = true;
    return;
  }

  var db = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  var orders = {};          // id → order (today only)
  var dishes = [];
  var restaurant = null;
  var currency = '£';
  var channel = null;
  var knownIds = null;      // ids seen at first load, so only truly new orders beep

  /* ── Helpers ─────────────────────────────────────────────── */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) { return currency + (Math.round(Number(n) * 100) / 100).toFixed(2); }
  function ago(ts) {
    var m = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + ' min ago';
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  function startOfToday() { var d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); }
  var toastTimer;
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.add('hidden'); }, 2600);
  }

  // Short two-note chime for new orders (browsers allow sound after the sign-in click)
  var audio = null;
  function unlockAudio() {
    try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === 'suspended') audio.resume(); } catch (e) {}
  }
  document.addEventListener('pointerdown', unlockAudio, { once: true });
  function chime() {
    if (!audio) return;
    [880, 1320].forEach(function (f, i) {
      var o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime + i * 0.18;
      o.frequency.value = f; o.type = 'sine';
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      o.connect(g); g.connect(audio.destination); o.start(t); o.stop(t + 0.4);
    });
  }

  /* ── Auth ────────────────────────────────────────────────── */
  $('login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    unlockAudio();
    var btn = $('login-btn'); btn.disabled = true; $('login-err').textContent = '';
    db.auth.signInWithPassword({ email: $('email').value.trim(), password: $('password').value })
      .then(function (res) {
        if (res.error) throw res.error;
        return enter();
      })
      .catch(function (err) { $('login-err').textContent = err.message || 'Sign in failed'; })
      .then(function () { btn.disabled = false; });
  });

  $('logout').addEventListener('click', function () {
    if (channel) db.removeChannel(channel);
    db.auth.signOut().then(function () { location.reload(); });
  });

  function enter() {
    return db.auth.getUser().then(function (res) {
      var user = res.data && res.data.user;
      if (!user) { showLogin(); return; }
      return db.from('owners').select('user_id').eq('user_id', user.id).maybeSingle().then(function (o) {
        if (o.error || !o.data) {
          return db.auth.signOut().then(function () {
            showLogin();
            $('login-err').textContent = 'This account is not an owner. Add it to the owners table in Supabase.';
          });
        }
        $('login').classList.add('hidden');
        $('app').classList.remove('hidden');
        loadClientErrors();
        loadTables();
        return Promise.all([loadRestaurant(), loadDishes(), loadOrders()]).then(subscribe);
      });
    });
  }
  function showLogin() { $('app').classList.add('hidden'); $('login').classList.remove('hidden'); }

  db.auth.getSession().then(function (res) {
    if (res.data && res.data.session) enter(); else showLogin();
  });

  /* ── Tabs ────────────────────────────────────────────────── */
  document.querySelectorAll('nav.tabs button').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('nav.tabs button').forEach(function (x) { x.setAttribute('aria-selected', x === b); });
      document.querySelectorAll('[data-panel]').forEach(function (p) {
        p.classList.toggle('hidden', p.getAttribute('data-panel') !== b.getAttribute('data-tab'));
      });
    });
  });

  /* ── Orders ──────────────────────────────────────────────── */
  var NEXT = {
    new:       { to: 'preparing', label: 'Start preparing' },
    preparing: { to: 'ready',     label: 'Mark ready' },
    ready:     { to: 'served',    label: 'Served' }
  };

  function loadOrders() {
    return db.from('orders').select('*').gte('created_at', startOfToday())
      .order('created_at', { ascending: true }).limit(500)
      .then(function (res) {
        if (res.error) { toast('Could not load orders: ' + res.error.message); return; }
        var fresh = [];
        orders = {};
        res.data.forEach(function (o) {
          orders[o.id] = o;
          if (knownIds && !knownIds[o.id] && o.status === 'new') fresh.push(o.id);
        });
        if (!knownIds) knownIds = {};
        res.data.forEach(function (o) { knownIds[o.id] = true; });
        renderOrders(fresh);
        if (fresh.length) chime();   // orders that arrived while the connection was down
      });
  }

  /* ── Tables & QR codes ───────────────────────────────────── */
  // Each table has a secret code (qr_key). Its QR code opens the menu as
  // index.html?table=5&k=<secret>, and the database only accepts a dine-in
  // order when the table and its secret match.
  var tables = [];
  function menuLinkFor(t) {
    var url = new URL('index.html', location.href);
    url.searchParams.set('table', t.label);
    url.searchParams.set('k', t.qr_key);
    return url.toString();
  }
  function qrSvg(text) {
    if (typeof window.qrcode !== 'function') return '<p class="sub">QR code library did not load. Check your connection.</p>';
    var qr = window.qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }
  function newKey() {
    var bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.prototype.map.call(bytes, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }
  function byLabel(a, b) { return a.label.localeCompare(b.label, undefined, { numeric: true }); }

  function loadTables() {
    return db.from('restaurant_tables').select('*').then(function (res) {
      if (res.error) {
        $('tables-list').innerHTML = '<p class="sub">Tables are not set up yet: ' + esc(res.error.message) +
          '. Run supabase/phase1-dine-in.sql in Supabase first.</p>';
        return;
      }
      tables = res.data.sort(byLabel);
      renderTables();
    });
  }
  function renderTables() {
    $('tables-list').innerHTML = tables.length ? tables.map(function (t) {
      return '<article class="table-card' + (t.active ? '' : ' off') + '" data-label="' + esc(t.label) + '">' +
        '<div class="tc-head"><b>Table ' + esc(t.label) + '</b>' +
          '<label class="switch"><input type="checkbox" data-table-act="active"' + (t.active ? ' checked' : '') + '>' +
          '<span class="track"></span><span>' + (t.active ? 'Taking orders' : 'Switched off') + '</span></label></div>' +
        '<div class="tc-qr">' + qrSvg(menuLinkFor(t)) + '</div>' +
        '<div class="tc-actions">' +
          '<button class="btn" data-table-act="print">Print QR</button>' +
          '<button class="btn" data-table-act="newkey">New code</button>' +
          '<button class="btn danger" data-table-act="delete">Delete</button>' +
        '</div></article>';
    }).join('') : '<p class="sub">No tables yet. Add your first table above.</p>';
  }
  function updateTable(label, patch, done) {
    db.from('restaurant_tables').update(patch).eq('label', label).select().maybeSingle().then(function (res) {
      if (res.error || !res.data) { toast('Could not save table — ' + (res.error ? res.error.message : 'no permission')); loadTables(); return; }
      tables = tables.map(function (t) { return t.label === label ? res.data : t; });
      renderTables();
      if (done) done(res.data);
    });
  }
  function printTable(t) {
    var w = window.open('', '_blank');
    if (!w) { toast('Allow pop-ups to print QR codes'); return; }
    w.document.write('<!doctype html><meta charset="utf-8"><title>Table ' + esc(t.label) + ' QR code</title>' +
      '<style>body{font-family:system-ui,sans-serif;text-align:center;padding:40px}svg{width:320px;height:320px}' +
      'h1{font-size:40px;margin:0 0 4px}p{font-size:18px;color:#444}</style>' +
      '<h1>Table ' + esc(t.label) + '</h1><p>Scan to see the menu and order</p>' + qrSvg(menuLinkFor(t)) +
      '<script>window.onload=function(){window.print();}<\/script>');
    w.document.close();
  }
  $('table-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var label = $('table-label').value.trim();
    if (!/^[A-Za-z0-9_-]{1,20}$/.test(label)) { toast('Use letters, numbers, - or _ (up to 20)'); return; }
    db.from('restaurant_tables').insert({ label: label }).select().maybeSingle().then(function (res) {
      if (res.error || !res.data) {
        toast(res.error && res.error.code === '23505' ? 'Table ' + label + ' already exists' :
          'Could not add table — ' + (res.error ? res.error.message : 'no permission'));
        return;
      }
      $('table-label').value = '';
      tables.push(res.data); tables.sort(byLabel); renderTables();
      toast('Table ' + label + ' added — print its QR code');
    });
  });
  $('tables-list').addEventListener('click', function (e) {
    var b = e.target.closest('[data-table-act]');
    if (!b || b.getAttribute('data-table-act') === 'active') return;
    var label = b.closest('.table-card').getAttribute('data-label');
    var t = tables.filter(function (x) { return x.label === label; })[0];
    if (!t) return;
    var act = b.getAttribute('data-table-act');
    if (act === 'print') printTable(t);
    if (act === 'newkey' && confirm('Make a new QR code for table ' + label + '? The old printed code will stop working straight away.')) {
      updateTable(label, { qr_key: newKey() }, function () { toast('New code for table ' + label + ' — print it again'); });
    }
    if (act === 'delete' && confirm('Delete table ' + label + '? Its QR code will stop working. Past orders are kept.')) {
      db.from('restaurant_tables').delete().eq('label', label).then(function (res) {
        if (res.error) { toast('Could not delete — ' + res.error.message); return; }
        tables = tables.filter(function (x) { return x.label !== label; }); renderTables();
      });
    }
  });
  $('tables-list').addEventListener('change', function (e) {
    if (e.target.getAttribute('data-table-act') !== 'active') return;
    var label = e.target.closest('.table-card').getAttribute('data-label');
    updateTable(label, { active: e.target.checked });
  });

  // Problems customer phones reported quietly (see log_client_error in schema.sql).
  function loadClientErrors() {
    var box = $('client-errors');
    if (!box) return;
    var since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    db.from('client_errors').select('created_at,context,message,page').gte('created_at', since)
      .order('created_at', { ascending: false }).limit(50).then(function (res) {
        if (res.error) { box.innerHTML = '<p class="sub">Error log not available yet: ' + esc(res.error.message) + '</p>'; return; }
        $('err-count').textContent = res.data.length ? '(' + res.data.length + ')' : '(none)';
        box.innerHTML = res.data.length ? '<ul class="err-list">' + res.data.map(function (e) {
          return '<li><span class="err-time">' + esc(new Date(e.created_at).toLocaleString()) + '</span>' +
            '<b>' + esc(e.context) + '</b><span>' + esc(e.message) + '</span></li>';
        }).join('') + '</ul>' : '<p class="sub">No problems reported in the last 7 days.</p>';
      });
  }

  // 'Dine-in · Table 5'. Delivery and collection arrive in Phase 2.
  function orderPlace(o) {
    var type = o.order_type || 'dine_in';
    if (type === 'delivery') return 'Delivery';
    if (type === 'collection') return 'Collection';
    return 'Dine-in · ' + (o.table_label ? 'Table ' + esc(o.table_label) : 'no table');
  }

  function orderCard(o, fresh) {
    var items = (o.items || []).map(function (it) {
      if (it.type === 'discount') {
        return '<li class="order-discount"><span>' + esc(it.name) + '</span>' +
          '<span class="p num">−' + money(it.amount) + '</span></li>';
      }
      return '<li><span class="q num">' + esc(it.qty) + '×</span><span>' + esc(it.name) + '</span>' +
             '<span class="p num">' + money(it.price * it.qty) + '</span></li>';
    }).join('');
    var next = NEXT[o.status];
    var refundDue = o.status === 'cancelled' && o.paid_at && !o.refunded_at;
    var payment = '<div class="o-pay">' +
      (o.refunded_at ? '<span class="pay-pill refunded">Refunded</span>'
        : refundDue ? '<span class="pay-pill refund-due">Refund due</span>' +
            '<button class="btn" data-act="refund" data-id="' + o.id + '">Mark refunded</button>'
        : o.paid_at ? '<span class="pay-pill paid">Paid</span>'
        : o.status !== 'cancelled' ? '<button class="btn" data-act="paid" data-id="' + o.id + '">Mark paid</button>' : '') +
      '</div>';
    var actions = next
      ? '<div class="o-actions">' +
          '<button class="btn primary" data-act="advance" data-id="' + o.id + '" data-to="' + next.to + '">' + next.label + '</button>' +
          '<button class="btn danger" data-act="cancel" data-id="' + o.id + '" aria-label="Cancel order ' + o.order_no + '">Cancel</button>' +
        '</div>'
      : '<span class="status-pill ' + o.status + '">' + o.status + '</span>';
    return '<article class="order' + (fresh ? ' fresh' : '') + '" data-status="' + o.status + '">' +
      '<div class="o-top"><span class="o-no num">#' + o.order_no + '</span>' +
        '<span class="o-type ' + esc(o.order_type || 'dine_in') + '">' + orderPlace(o) + '</span>' +
        '<span class="o-time" data-ts="' + o.created_at + '">' + ago(o.created_at) + '</span></div>' +
      '<ul class="o-items">' + items + '</ul>' +
      (o.note ? '<div class="o-note">“' + esc(o.note) + '”</div>' : '') +
      '<div class="o-total"><span>Total</span><span class="num">' + money(o.total) + '</span></div>' +
      actions + payment + '</article>';
  }

  function renderOrders(freshIds) {
    freshIds = freshIds || [];
    var list = Object.keys(orders).map(function (k) { return orders[k]; })
      .sort(function (a, b) { return new Date(a.created_at) - new Date(b.created_at); });
    var cols = { new: [], preparing: [], ready: [] }, done = [];
    var revenue = 0, counted = 0;
    list.forEach(function (o) {
      if (cols[o.status]) cols[o.status].push(o); else done.push(o);
      if (o.status !== 'cancelled') { revenue += Number(o.total); counted++; }
    });
    ['new', 'preparing', 'ready'].forEach(function (s) {
      $('col-' + s).innerHTML = cols[s].length
        ? cols[s].map(function (o) { return orderCard(o, freshIds.indexOf(o.id) !== -1); }).join('')
        : '<div class="empty">Nothing here</div>';
    });
    done.reverse();
    $('done-list').innerHTML = done.length ? done.map(function (o) { return orderCard(o); }).join('')
      : '<div class="empty" style="color:var(--mute)">No completed orders yet today.</div>';

    $('st-orders').textContent = counted;
    $('st-revenue').textContent = money(revenue);
    $('st-open').textContent = cols.new.length + cols.preparing.length + cols.ready.length;
    var n = cols.new.length;
    $('new-count').textContent = n;
    $('new-count').classList.toggle('hidden', !n);
    document.title = (n ? '(' + n + ') ' : '') + 'Kitchen Dashboard';
  }

  // Payment is recorded separately from kitchen status, so a paid order that is
  // later cancelled shows "Refund due" until staff mark the refund.
  function setPayment(id, field) {
    var o = orders[id];
    if (!o) return;
    var prev = o[field];
    var patch = {}; patch[field] = new Date().toISOString();
    o[field] = patch[field]; renderOrders();
    db.from('orders').update(patch).eq('id', id).select().maybeSingle().then(function (res) {
      if (res.error || !res.data) {
        o[field] = prev; renderOrders();
        toast('Could not save payment — ' + (res.error ? res.error.message : 'no permission'));
      } else { orders[id] = res.data; renderOrders(); }
    });
  }

  function setStatus(id, status) {
    var prev = orders[id] && orders[id].status;
    if (!prev) return;
    orders[id].status = status; renderOrders();          // update the screen right away
    db.from('orders').update({ status: status }).eq('id', id).select().maybeSingle().then(function (res) {
      if (res.error || !res.data) {
        orders[id].status = prev; renderOrders();
        toast('Could not update order — ' + (res.error ? res.error.message : 'no permission'));
      } else { orders[id] = res.data; renderOrders(); }
    });
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b) return;
    var id = b.getAttribute('data-id');
    if (b.getAttribute('data-act') === 'advance') setStatus(id, b.getAttribute('data-to'));
    if (b.getAttribute('data-act') === 'cancel') {
      var paid = orders[id].paid_at;
      if (confirm(paid ? 'Order #' + orders[id].order_no + ' has been paid. Cancel it? The customer will be told a refund is due.'
                       : 'Cancel order #' + orders[id].order_no + '?')) setStatus(id, 'cancelled');
    }
    if (b.getAttribute('data-act') === 'paid') setPayment(id, 'paid_at');
    if (b.getAttribute('data-act') === 'refund' &&
        confirm('Confirm the refund for order #' + orders[id].order_no + ' has been given?')) setPayment(id, 'refunded_at');
  });

  setInterval(function () {   // keep "x min ago" current
    document.querySelectorAll('.o-time[data-ts]').forEach(function (el) { el.textContent = ago(el.getAttribute('data-ts')); });
  }, 30000);

  /* ── Live updates ────────────────────────────────────────── */
  function subscribe() {
    if (channel) db.removeChannel(channel);
    var firstConnect = true;
    channel = db.channel('owner-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, function (p) {
        var o = p.new; orders[o.id] = o; knownIds[o.id] = true;
        renderOrders([o.id]); chime(); toast('New order #' + o.order_no + (o.table_label ? ' — Table ' + o.table_label : ''));
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, function (p) {
        if (orders[p.new.id]) { orders[p.new.id] = p.new; renderOrders(); }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'restaurant' }, function (p) {
        applyRestaurant(p.new, false);
      })
      .subscribe(function (status) {
        if (status === 'SUBSCRIBED') {
          $('offline').classList.add('hidden');
          if (!firstConnect) loadOrders();     // catch up on anything missed while offline
          firstConnect = false;
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          $('offline').classList.remove('hidden');
        }
      });
  }

  /* ── Restaurant ──────────────────────────────────────────── */
  function applyRestaurant(r, fillForm) {
    if (!r) return;
    restaurant = r;
    currency = r.currency || '£';
    $('brand').innerHTML = esc(r.name) + '<small>Owner</small>';
    $('accepting').checked = r.accepting_orders;
    $('accepting-label').textContent = r.accepting_orders ? 'Taking orders' : 'Orders paused';
    $('recommendations-enabled').checked = r.recommendations_enabled !== false;
    $('ai-recommendations-enabled').checked = r.ai_recommendations_enabled === true;
    $('bundles-enabled').checked = r.bundles_enabled === true;
    $('bundle-discount-percent').value = Number(r.bundle_discount_percent || 0).toFixed(2);
    if (fillForm !== false) {
      $('r-name').value = r.name; $('r-tagline').value = r.tagline; $('r-badge').value = r.badge;
      $('r-currency').value = r.currency; $('r-tax').value = +(Number(r.tax_rate) * 100).toFixed(2);
    }
    renderOrders();
    document.querySelectorAll('.price-wrap span').forEach(function (s) { s.textContent = currency; });
  }

  function loadRestaurant() {
    return db.from('restaurant').select('*').eq('id', 1).maybeSingle().then(function (res) {
      if (res.error) toast('Could not load restaurant info: ' + res.error.message);
      else applyRestaurant(res.data);
    });
  }

  $('accepting').addEventListener('change', function () {
    var on = this.checked, box = this;
    db.from('restaurant').update({ accepting_orders: on }).eq('id', 1).select().maybeSingle().then(function (res) {
      if (res.error || !res.data) { box.checked = !on; toast('Could not change — ' + (res.error ? res.error.message : 'no permission')); return; }
      applyRestaurant(res.data, false);
      toast(on ? 'Customers can order again' : 'Orders paused — customers can still browse the menu');
    });
  });

  $('info-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var st = $('info-status'); st.className = 'saved'; st.textContent = 'Saving…';
    var tax = Number($('r-tax').value);
    db.from('restaurant').update({
      name: $('r-name').value.trim(), tagline: $('r-tagline').value.trim(), badge: $('r-badge').value.trim(),
      currency: $('r-currency').value.trim(), tax_rate: Math.round(tax * 100) / 10000,
      recommendations_enabled: $('recommendations-enabled').checked,
      ai_recommendations_enabled: $('ai-recommendations-enabled').checked,
      bundles_enabled: $('bundles-enabled').checked,
      bundle_discount_percent: Math.round(Number($('bundle-discount-percent').value) * 100) / 100
    }).eq('id', 1).select().maybeSingle().then(function (res) {
      if (res.error || !res.data) { st.className = 'saved err'; st.textContent = res.error ? res.error.message : 'No permission'; return; }
      applyRestaurant(res.data); renderDishes();
      st.textContent = 'Saved ✓';
    });
  });

  /* ── Menu & prices ───────────────────────────────────────── */
  var FIELDS = ['name', 'icon', 'description', 'price', 'calories', 'prep_time', 'rating', 'size', 'serves', 'weight', 'calories_per_100g', 'portion_grams'];

  function loadDishes() {
    return db.from('dishes').select('*').order('sort').then(function (res) {
      if (res.error) { toast('Could not load menu: ' + res.error.message); return; }
      dishes = res.data; renderDishes();
    });
  }

  function input(d, f, label, attrs) {
    return '<div class="field"><label for="' + d.id + '-' + f + '">' + label + '</label>' +
      '<input id="' + d.id + '-' + f + '" data-f="' + f + '" value="' + esc(d[f]) + '" ' + (attrs || '') + '></div>';
  }

  function select(d, f, label, options) {
    return '<div class="field"><label for="' + d.id + '-' + f + '">' + label + '</label><select id="' + d.id + '-' + f + '" data-f="' + f + '">' +
      options.map(function (value) {
        return '<option value="' + value + '"' + (d[f] === value ? ' selected' : '') + '>' +
          value.charAt(0).toUpperCase() + value.slice(1) + '</option>';
      }).join('') + '</select></div>';
  }

  function dietaryOptions(d) {
    return '<fieldset class="field"><legend>Dietary tags</legend><div class="tag-options">' +
      ['veg', 'vegan', 'halal'].map(function (tag) {
        return '<label><input type="checkbox" data-dietary value="' + tag + '"' +
          ((d.dietary || []).indexOf(tag) !== -1 ? ' checked' : '') + '>' + tag + '</label>';
      }).join('') + '</div></fieldset>';
  }

  var ALLERGEN_TAGS = [
    ['celery', 'Celery'], ['dairy', 'Dairy'], ['eggs', 'Eggs'], ['fish', 'Fish'],
    ['gluten', 'Gluten'], ['mustard', 'Mustard'], ['nuts', 'Nuts'],
    ['peanuts', 'Peanuts'], ['sesame', 'Sesame'], ['shellfish', 'Shellfish'],
    ['soy', 'Soy'], ['sulphites', 'Sulphites'], ['wheat', 'Wheat']
  ];

  function allergenOptions(d, field, label) {
    var selected = d[field] || [];
    return '<fieldset class="field"><legend>' + label + '</legend><div class="tag-options">' +
      ALLERGEN_TAGS.map(function (tag) {
        return '<label><input type="checkbox" data-' + field + ' value="' + tag[0] + '"' +
          (selected.indexOf(tag[0]) !== -1 ? ' checked' : '') + '>' + tag[1] + '</label>';
      }).join('') + '</div></fieldset>';
  }

  function renderDishes() {
    $('dishes').innerHTML = dishes.map(function (d) {
      return '<form class="dish' + (d.available ? '' : ' off') + '" data-id="' + esc(d.id) + '">' +
        '<div class="dish-head"><span class="ic">' + esc(d.icon) + '</span><span class="nm">' + esc(d.name) + '</span>' +
          '<label class="switch"><input type="checkbox" data-avail ' + (d.available ? 'checked' : '') + '>' +
          '<span class="track"></span><span>' + (d.available ? 'Available' : 'Sold out') + '</span></label></div>' +
        '<div class="grid2">' +
          '<div class="field"><label for="' + d.id + '-price">Price</label><div class="price-wrap"><span>' + esc(currency) + '</span>' +
            '<input id="' + d.id + '-price" data-f="price" type="number" min="0" step="0.01" inputmode="decimal" required value="' + esc(Number(d.price).toFixed(2)) + '"></div></div>' +
          input(d, 'icon', 'Icon', 'maxlength="4"') +
        '</div>' +
        input(d, 'name', 'Name', 'maxlength="60" required') +
        '<div class="field"><label for="' + d.id + '-description">Description</label>' +
          '<textarea id="' + d.id + '-description" data-f="description" maxlength="200">' + esc(d.description) + '</textarea></div>' +
        '<div class="grid3">' +
          input(d, 'calories', 'Calories', 'maxlength="20"') + input(d, 'prep_time', 'Prep time', 'maxlength="20"') + input(d, 'rating', 'Rating', 'maxlength="6"') +
          input(d, 'size', 'Size', 'maxlength="20"') + input(d, 'serves', 'Serves', 'maxlength="20"') + input(d, 'weight', 'Weight', 'maxlength="20"') +
        '</div>' +
        input({ id: d.id, ingredients: (d.ingredients || []).join(', ') }, 'ingredients', 'Ingredients (comma-separated)', 'maxlength="300" placeholder="e.g. tomato, basil, mozzarella"') +
        '<div class="grid2">' +
          input(d, 'calories_per_100g', 'Calories per 100g', 'type="number" min="0" step="0.01" inputmode="decimal"') +
          input(d, 'portion_grams', 'Portion size (grams)', 'type="number" min="0" step="0.01" inputmode="decimal"') +
        '</div>' +
        '<div class="grid3">' +
          select(d, 'category', 'Category', ['main', 'side', 'drink', 'dessert']) +
          select(d, 'price_band', 'Price band', ['budget', 'mid', 'premium']) +
          select(d, 'meal_part', 'Meal part', ['breakfast', 'lunch', 'dinner', 'any', 'unspecified']) +
        '</div>' +
        input({ id: d.id, flavour: (d.flavour || []).join(', ') }, 'flavour', 'Flavours (comma-separated)', 'maxlength="160" placeholder="e.g. citrus, spicy, creamy"') +
        dietaryOptions(d) +
        allergenOptions(d, 'allergens', 'Contains these allergens') +
        allergenOptions(d, 'may_contain_allergens', 'May contain (cross-contact)') +
        '<div class="field"><label><input type="checkbox" data-allergen-verified' +
          (d.allergen_info_verified ? ' checked' : '') +
          ' style="width:auto;margin-right:8px">Allergen information checked with the kitchen or supplier</label>' +
          '<p class="sub">Leave unchecked until ingredients and cross-contact information have been verified. Customers with selected allergies will not receive unverified dishes as recommendations.</p></div>' +
        '<div class="field"><label><input type="checkbox" data-promote' + (d.promote ? ' checked' : '') +
          ' style="width:auto;margin-right:8px">Chef&#39;s pick</label></div>' +
        '<div class="dish-foot"><span class="saved" role="status"></span>' +
          '<button class="btn primary" type="submit" disabled>Save</button></div>' +
      '</form>';
    }).join('');
  }

  function dishById(id) { for (var i = 0; i < dishes.length; i++) if (dishes[i].id === id) return dishes[i]; }

  function saveDish(form, patch, onDone) {
    var id = form.getAttribute('data-id'), st = form.querySelector('.saved');
    st.className = 'saved'; st.textContent = 'Saving…';
    db.from('dishes').update(patch).eq('id', id).select().maybeSingle().then(function (res) {
      if (res.error || !res.data) {
        st.className = 'saved err'; st.textContent = res.error ? res.error.message : 'No permission';
        onDone && onDone(false); return;
      }
      var i = dishes.indexOf(dishById(id)); dishes[i] = res.data;
      onDone && onDone(true, res.data);
    });
  }

  // Enable "Save" only when something changed
  $('dishes').addEventListener('input', function (e) {
    var form = e.target.closest('form.dish');
    if (!form || e.target.hasAttribute('data-avail')) return;
    form.querySelector('button[type=submit]').disabled = false;
    form.querySelector('.saved').textContent = '';
  });
  $('dishes').addEventListener('change', function (e) {
    var form = e.target.closest('form.dish');
    if (!form || e.target.hasAttribute('data-avail')) return;
    form.querySelector('button[type=submit]').disabled = false;
    form.querySelector('.saved').textContent = '';
  });

  $('dishes').addEventListener('submit', function (e) {
    e.preventDefault();
    var form = e.target, patch = {};
    FIELDS.forEach(function (f) {
      var el = form.querySelector('[data-f="' + f + '"]'); if (!el) return;
      patch[f] = ['price', 'calories_per_100g', 'portion_grams'].indexOf(f) !== -1 ? Math.round(Number(el.value) * 100) / 100 : el.value.trim();
    });
    patch.ingredients = form.querySelector('[data-f="ingredients"]').value.split(',').map(function (tag) {
      return tag.trim().toLowerCase();
    }).filter(Boolean);
    patch.category = form.querySelector('[data-f="category"]').value;
    patch.flavour = form.querySelector('[data-f="flavour"]').value.split(',').map(function (tag) {
      return tag.trim().toLowerCase();
    }).filter(Boolean);
    patch.dietary = Array.prototype.map.call(form.querySelectorAll('[data-dietary]:checked'), function (el) {
      return el.value;
    });
    patch.allergens = Array.prototype.map.call(form.querySelectorAll('[data-allergens]:checked'), function (el) {
      return el.value;
    });
    patch.may_contain_allergens = Array.prototype.map.call(form.querySelectorAll('[data-may_contain_allergens]:checked'), function (el) {
      return el.value;
    });
    patch.allergen_info_verified = form.querySelector('[data-allergen-verified]').checked;
    patch.price_band = form.querySelector('[data-f="price_band"]').value;
    patch.meal_part = form.querySelector('[data-f="meal_part"]').value;
    patch.promote = form.querySelector('[data-promote]').checked;
    if (!(patch.price >= 0) || !patch.name) { form.querySelector('.saved').textContent = 'Check the name and price'; return; }
    var btn = form.querySelector('button[type=submit]'); btn.disabled = true;
    saveDish(form, patch, function (ok, d) {
      if (!ok) { btn.disabled = false; return; }
      form.querySelector('.nm').textContent = d.name;
      form.querySelector('.ic').textContent = d.icon;
      form.querySelector('.saved').textContent = 'Saved ✓ — live on the menu';
    });
  });

  // Sold-out switch saves immediately — it's the thing a busy kitchen flips most
  $('dishes').addEventListener('change', function (e) {
    if (!e.target.hasAttribute('data-avail')) return;
    var box = e.target, form = box.closest('form.dish'), on = box.checked;
    saveDish(form, { available: on }, function (ok) {
      if (!ok) { box.checked = !on; return; }
      form.classList.toggle('off', !on);
      box.parentNode.lastChild.textContent = on ? 'Available' : 'Sold out';
      form.querySelector('.saved').textContent = on ? 'Back on the menu ✓' : 'Marked sold out ✓';
    });
  });
})();
