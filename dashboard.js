/* ════════════════════════════════════════════════════════════════
   MenuVision owner dashboard.

   Screens: Overview · Orders · Dishes (+ editor, 3D preview) · Pairings ·
   Tables & QR · Settings. Data lives in Supabase (see supabase/schema.sql
   and supabase/dashboard-upgrade-2026-11.sql). Only accounts listed in
   public.owners can read orders or change anything; the database enforces
   that, this page just shows the right screens.

   This page never touches the customer AR scene: 3D previews here use
   their own model-viewer, loaded only when a preview is opened.
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var cfg = window.MENU_CONFIG;

  var MODEL_VERSION = '?v=25';          // keep in step with MODEL_VERSION in sensory.js
  var MODEL_VIEWER_URL = 'https://ajax.googleapis.com/ajax/libs/model-viewer/3.5.0/model-viewer.min.js';
  var MEDIA_BUCKET = 'menu-media';
  var UPGRADE_FILE = 'supabase/dashboard-upgrade-2026-11.sql';
  var CATEGORY_LABEL = { main: 'Main', side: 'Side', drink: 'Drink', dessert: 'Dessert' };
  var DIETARY_TAGS = [['veg', 'Vegetarian'], ['vegan', 'Vegan'], ['halal', 'Halal']];
  var ALLERGEN_TAGS = [
    ['celery', 'Celery'], ['gluten', 'Gluten'], ['wheat', 'Wheat'], ['crustaceans', 'Crustaceans'],
    ['eggs', 'Eggs'], ['fish', 'Fish'], ['lupin', 'Lupin'], ['dairy', 'Milk'], ['molluscs', 'Molluscs'],
    ['mustard', 'Mustard'], ['nuts', 'Tree nuts'], ['peanuts', 'Peanuts'], ['sesame', 'Sesame'],
    ['soy', 'Soya'], ['sulphites', 'Sulphites'], ['shellfish', 'Shellfish (unspecified)']
  ];
  var SWATCHES = [
    ['#C8A96A', 'Champagne'], ['#D4AF37', 'Gold'], ['#B4693F', 'Terracotta'],
    ['#7D9A78', 'Sage'], ['#8E3B46', 'Bordeaux'], ['#3E4C63', 'Ink blue'], ['#E8E1D4', 'Ivory']
  ];

  /* ── Theme (works before sign-in too) ───────────────────────── */
  function storedTheme() {
    try { var t = localStorage.getItem('mv-theme'); return t === 'light' || t === 'dark' ? t : 'system'; }
    catch (e) { return 'system'; }
  }
  function systemTheme() { return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'; }
  function applyTheme(pref) {
    var t = pref === 'system' ? systemTheme() : pref;
    document.documentElement.setAttribute('data-theme', t);
    $$('[data-theme-toggle]').forEach(function (b) { b.setAttribute('aria-label', t === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'); });
    $$('[data-theme-set]').forEach(function (b) { b.setAttribute('aria-checked', String(b.getAttribute('data-theme-set') === pref)); });
  }
  function setTheme(pref) {
    try { if (pref === 'system') localStorage.removeItem('mv-theme'); else localStorage.setItem('mv-theme', pref); } catch (e) {}
    applyTheme(pref);
  }
  applyTheme(storedTheme());
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', function () { if (storedTheme() === 'system') applyTheme('system'); });
  $$('[data-theme-toggle]').forEach(function (b) {
    b.addEventListener('click', function () { setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); });
  });
  $$('[data-theme-set]').forEach(function (b) {
    b.addEventListener('click', function () { setTheme(b.getAttribute('data-theme-set')); });
  });

  /* ── Small helpers ──────────────────────────────────────────── */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var currency = '£';
  function money(n) { return currency + (Math.round(Number(n) * 100) / 100).toFixed(2); }
  function ago(ts) {
    var m = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + ' min ago';
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  function startOfToday() { var d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); }
  function startOfDaysAgo(n) { var d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - n); return d.toISOString(); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dayKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function lastDays(n, offset) {
    var out = [];
    offset = offset || 0;
    for (var i = n - 1 + offset; i >= offset; i--) {
      var d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - i); out.push(dayKey(d));
    }
    return out;
  }
  function sum(a) { return a.reduce(function (s, v) { return s + v; }, 0); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function hexOk(h) { return /^#[0-9a-f]{6}$/i.test(h || ''); }
  function inkFor(hex) {
    if (!hexOk(hex)) return '#17140D';
    var n = parseInt(hex.slice(1), 16);
    var lum = (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
    return lum > 0.5 ? '#17140D' : '#FFFFFF';
  }
  function initial(name) { return (String(name || 'M').replace(/^the\s+/i, '').trim().charAt(0) || 'M').toUpperCase(); }
  function slugify(s) {
    return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
  }
  function listFrom(value) {
    return String(value || '').split(',').map(function (t) { return t.trim().toLowerCase(); }).filter(Boolean);
  }
  function friendly(err) {
    var msg = (err && (err.message || err.error_description || err.error)) || String(err || 'Something went wrong');
    if (/image_url|logo_url|brand_color|bucket not found|menu-media/i.test(msg)) return 'This needs the one-time database upgrade. Run ' + UPGRADE_FILE + ' in Supabase.';
    if (/failed to fetch|networkerror|load failed/i.test(msg)) return "Can't reach the server. Check your connection and try again.";
    if (/jwt expired|invalid jwt/i.test(msg)) return 'Your session has expired. Sign out and sign in again.';
    if (err && err.code === '23505') return 'That name is already used by another dish.';
    if (/row-level security|permission/i.test(msg)) return 'This account is not allowed to make that change.';
    return msg;
  }

  var ICON = { ok: 'i-check', err: 'i-alert', info: 'i-alert' };
  function toast(msg, kind) {
    kind = kind || 'info';
    var box = $('toasts'), t = document.createElement('div');
    t.className = 'toast toast-' + kind;
    if (kind === 'err') t.setAttribute('role', 'alert');
    t.innerHTML = '<svg class="ic" aria-hidden="true"><use href="#' + ICON[kind] + '"/></svg><span class="toast-msg"></span>';
    t.querySelector('.toast-msg').textContent = msg;
    box.appendChild(t);
    while (box.children.length > 3) box.removeChild(box.firstChild);
    setTimeout(function () {
      t.classList.add('leaving');
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 240);
    }, kind === 'err' ? 6500 : 3600);
  }
  function busy(btn, on) {
    if (!btn) return;
    btn.classList.toggle('is-busy', !!on);
    btn.disabled = !!on;
    if (on) btn.setAttribute('aria-busy', 'true'); else btn.removeAttribute('aria-busy');
  }
  function thumb(d, cls) {
    var url = photoFor(d);
    return url
      ? '<img class="' + (cls || '') + '" src="' + esc(sizedPhoto(url, 200)) + '" alt="" loading="lazy" decoding="async">'
      : '<span class="thumb-ph ' + (cls || '') + '" aria-hidden="true">' + esc(d && d.icon || '🍽️') + '</span>';
  }

  /* ── Setup check ────────────────────────────────────────────── */
  if (!cfg || /^YOUR_/.test(cfg.supabaseUrl) || !window.supabase) {
    $('login').classList.remove('hidden');
    $('login-err').textContent = !window.supabase
      ? 'Could not load the sign-in service. Check your connection and reload.'
      : 'Supabase is not set up yet. Add your project URL and anon key to config.js.';
    $('login-btn').disabled = true;
    return;
  }

  var db = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);

  /* ── State ──────────────────────────────────────────────────── */
  var orders = {};          // id → order (today only)
  var weekOrders = {};      // id → order (last 14 days, for the overview)
  var dishes = [];
  var dishesLoaded = false;
  var restaurant = null;
  var tables = [];
  var tablesLoaded = false;
  var events = null;        // null = loading · false = unavailable · [] = rows
  var eventsNeedUpgrade = false;
  var menuCards = null;     // id → { photo, hasAr } read from index.html
  var modelStatus = {};     // id → { glb, usdz } (true/false/null)
  var channel = null;
  var knownIds = null;      // ids seen at first load, so only truly new orders chime
  var currentView = null;
  var upgrade = { media: true };
  var editing = null;       // dish editor state, see openEditor()

  /* ── New-order chime ────────────────────────────────────────── */
  // Short two-note chime (browsers allow sound after the first tap or click).
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

  /* ── Auth ───────────────────────────────────────────────────── */
  $('login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    unlockAudio();
    var btn = $('login-btn'), email = $('email').value.trim(), pw = $('password').value;
    $('login-err').textContent = '';
    if (!email || !pw) { $('login-err').textContent = 'Enter your email and password.'; (email ? $('password') : $('email')).focus(); return; }
    busy(btn, true);
    db.auth.signInWithPassword({ email: email, password: pw })
      .then(function (res) { if (res.error) throw res.error; return enter(); })
      .catch(function (err) {
        $('login-err').textContent = /invalid login/i.test(err.message || '') ? 'That email and password do not match. Try again.' : friendly(err);
      })
      .then(function () { busy(btn, false); });
  });

  $$('[data-logout]').forEach(function (b) {
    b.addEventListener('click', function () {
      if (channel) db.removeChannel(channel);
      db.auth.signOut().then(function () { location.reload(); });
    });
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
        $('acct-email').textContent = user.email || 'owner';
        $('login').classList.add('hidden');
        $('app').classList.remove('hidden');
        route(true);
        $('main').focus({ preventScroll: true });
        loadClientErrors();
        loadTables();
        loadMenuCards();
        loadWeekOrders();
        loadEvents();
        return Promise.all([loadRestaurant(), loadDishes(), loadOrders()]).then(subscribe);
      });
    });
  }
  function showLogin() { $('app').classList.add('hidden'); $('login').classList.remove('hidden'); }

  db.auth.getSession().then(function (res) {
    if (res.data && res.data.session) enter(); else showLogin();
  });

  /* ── Navigation ─────────────────────────────────────────────── */
  var VIEWS = ['overview', 'orders', 'dishes', 'pairings', 'tables', 'settings'];
  function route(initialLoad) {
    var v = (location.hash || '').replace('#', '');
    if (VIEWS.indexOf(v) === -1) v = 'overview';
    var changed = v !== currentView;
    currentView = v;
    $$('[data-view]').forEach(function (s) { s.classList.toggle('hidden', s.getAttribute('data-view') !== v); });
    $$('[data-nav]').forEach(function (a) {
      if (a.getAttribute('data-nav') === v) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    if (changed && !initialLoad) {
      window.scrollTo(0, 0);
      var h = document.querySelector('[data-view="' + v + '"] h1');
      if (h) h.focus({ preventScroll: true });
    }
    if (v === 'pairings') renderPairings();
    updateUpgradeBanner();
    updateTitle();
  }
  window.addEventListener('hashchange', function () { route(false); });

  function updateTitle() {
    var n = Object.keys(orders).filter(function (k) { return orders[k].status === 'new'; }).length;
    var name = restaurant && restaurant.name ? restaurant.name : 'MenuVision';
    document.title = (n ? '(' + n + ') ' : '') + name + ' · Dashboard';
  }
  function updateUpgradeBanner() {
    var need = (restaurant && !upgrade.media) || eventsNeedUpgrade;
    $('upgrade-banner').classList.toggle('hidden', !need || ['overview', 'dishes', 'settings'].indexOf(currentView) === -1);
  }

  /* ── Orders ─────────────────────────────────────────────────── */
  var NEXT = {
    new:       { to: 'preparing', label: 'Start preparing' },
    preparing: { to: 'ready',     label: 'Mark ready' },
    ready:     { to: 'served',    label: 'Served' }
  };

  function loadOrders() {
    return db.from('orders').select('*').gte('created_at', startOfToday())
      .order('created_at', { ascending: true }).limit(500)
      .then(function (res) {
        if (res.error) { toast('Could not load orders: ' + friendly(res.error), 'err'); return; }
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

  function loadWeekOrders() {
    return db.from('orders').select('id,created_at,total,status,items').gte('created_at', startOfDaysAgo(13))
      .order('created_at', { ascending: true }).limit(3000)
      .then(function (res) {
        if (res.error) return;
        weekOrders = {};
        res.data.forEach(function (o) { weekOrders[o.id] = o; });
        renderOverview();
      });
  }

  // 'Dine-in · Table 5'
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
      (o.refunded_at ? '<span class="pill pill-ok">Refunded</span>'
        : refundDue ? '<span class="pill pill-bad">Refund due</span>' +
            '<button class="btn btn-sm" type="button" data-act="refund" data-id="' + o.id + '">Mark refunded</button>'
        : o.paid_at ? '<span class="pill pill-ok">Paid</span>'
        : o.status !== 'cancelled' ? '<button class="btn btn-sm btn-ghost" type="button" data-act="paid" data-id="' + o.id + '">Mark paid</button>' : '') +
      '</div>';
    var actions = next
      ? '<div class="o-actions">' +
          '<button class="btn btn-primary" type="button" data-act="advance" data-id="' + o.id + '" data-to="' + next.to + '">' + next.label + '</button>' +
          '<button class="btn btn-danger btn-ghost" type="button" data-act="cancel" data-id="' + o.id + '" aria-label="Cancel order ' + o.order_no + '">Cancel</button>' +
        '</div>'
      : '<span class="pill ' + (o.status === 'served' ? 'pill-ok' : o.status === 'cancelled' ? 'pill-bad' : '') + '">' + esc(o.status) + '</span>';
    return '<article class="order' + (fresh ? ' fresh' : '') + (refundDue ? ' refund-due' : '') + '" data-status="' + esc(o.status) + '" aria-label="Order ' + o.order_no + '">' +
      '<div class="o-top"><span class="o-no num">#' + o.order_no + '</span>' +
        '<span class="o-type ' + esc(o.order_type || 'dine_in') + '">' + orderPlace(o) + '</span>' +
        '<span class="o-time" data-ts="' + esc(o.created_at) + '">' + ago(o.created_at) + '</span></div>' +
      '<ul class="o-items">' + items + '</ul>' +
      (o.note ? '<div class="o-note">“' + esc(o.note) + '”</div>' : '') +
      '<div class="o-total"><span>Total</span><span class="num">' + money(o.total) + '</span></div>' +
      actions + payment + '</article>';
  }

  var EMPTY_COL = {
    new: 'All quiet. New orders appear here instantly, with a chime.',
    preparing: 'Nothing on the pass right now.',
    ready: 'Nothing waiting to be served.'
  };

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
        : '<div class="empty empty-sm">' + EMPTY_COL[s] + '</div>';
    });
    done.reverse();
    $('done-list').innerHTML = done.length ? done.map(function (o) { return orderCard(o); }).join('')
      : '<div class="empty full-row"><div class="empty-art"><svg class="ic"><use href="#i-orders"/></svg></div><h3>No completed orders yet today</h3><p>Served and cancelled orders since midnight will be listed here.</p></div>';

    $('st-orders').textContent = counted;
    $('st-revenue').textContent = money(revenue);
    $('st-open').textContent = cols.new.length + cols.preparing.length + cols.ready.length;
    var n = cols.new.length;
    $$('[data-new-count]').forEach(function (el) { el.textContent = n; el.classList.toggle('hidden', !n); });
    updateTitle();
    renderOverview();
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
        toast('Could not save payment. ' + (res.error ? friendly(res.error) : 'No permission.'), 'err');
      } else { orders[id] = res.data; renderOrders(); toast(field === 'paid_at' ? 'Order #' + res.data.order_no + ' marked paid' : 'Refund recorded for #' + res.data.order_no, 'ok'); }
    });
  }

  function setStatus(id, status) {
    var prev = orders[id] && orders[id].status;
    if (!prev) return;
    orders[id].status = status; renderOrders();          // update the screen right away
    db.from('orders').update({ status: status }).eq('id', id).select().maybeSingle().then(function (res) {
      if (res.error || !res.data) {
        orders[id].status = prev; renderOrders();
        toast('Could not update the order. ' + (res.error ? friendly(res.error) : 'No permission.'), 'err');
      } else { orders[id] = res.data; renderOrders(); }
    });
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b) return;
    var id = b.getAttribute('data-id'), act = b.getAttribute('data-act');
    if (!orders[id]) return;
    if (act === 'advance') setStatus(id, b.getAttribute('data-to'));
    if (act === 'cancel') {
      var paid = orders[id].paid_at;
      if (confirm(paid ? 'Order #' + orders[id].order_no + ' has been paid. Cancel it? The customer will be told a refund is due.'
                       : 'Cancel order #' + orders[id].order_no + '?')) setStatus(id, 'cancelled');
    }
    if (act === 'paid') setPayment(id, 'paid_at');
    if (act === 'refund' && confirm('Confirm the refund for order #' + orders[id].order_no + ' has been given?')) setPayment(id, 'refunded_at');
  });

  // Order list tabs (Live / Completed / Phone issues) with arrow-key support
  var orderTabs = $$('[data-orders-tab]');
  function selectOrderTab(tab, focus) {
    orderTabs.forEach(function (t) {
      var on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    });
    $$('[data-orders-panel]').forEach(function (p) { p.classList.toggle('hidden', p.getAttribute('data-orders-panel') !== tab.getAttribute('data-orders-tab')); });
    if (focus) tab.focus();
  }
  orderTabs.forEach(function (t, i) {
    t.addEventListener('click', function () { selectOrderTab(t); });
    t.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      selectOrderTab(orderTabs[(i + (e.key === 'ArrowRight' ? 1 : orderTabs.length - 1)) % orderTabs.length], true);
    });
  });

  setInterval(function () {   // keep "x min ago" and the greeting current
    $$('.o-time[data-ts]').forEach(function (el) { el.textContent = ago(el.getAttribute('data-ts')); });
    if (restaurant) renderGreeting();
  }, 30000);

  // Problems customer phones reported quietly (see log_client_error in schema.sql).
  function loadClientErrors() {
    var box = $('client-errors');
    var since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    db.from('client_errors').select('created_at,context,message,page').gte('created_at', since)
      .order('created_at', { ascending: false }).limit(50).then(function (res) {
        if (res.error) { box.innerHTML = '<p class="muted">The error log is not available yet: ' + esc(friendly(res.error)) + '</p>'; return; }
        $('err-count').textContent = res.data.length ? '(' + res.data.length + ')' : '';
        box.innerHTML = res.data.length ? '<ul class="err-list">' + res.data.map(function (e) {
          return '<li><span class="err-time">' + esc(new Date(e.created_at).toLocaleString()) + '</span>' +
            '<b>' + esc(e.context) + '</b><span>' + esc(e.message) + '</span></li>';
        }).join('') + '</ul>' : '<div class="empty empty-sm"><div class="empty-art"><svg class="ic"><use href="#i-check"/></svg></div><p>No problems reported by customer phones in the last 7 days.</p></div>';
      });
  }

  /* ── Live updates ───────────────────────────────────────────── */
  function subscribe() {
    if (channel) db.removeChannel(channel);
    var firstConnect = true;
    channel = db.channel('owner-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, function (p) {
        var o = p.new; orders[o.id] = o; weekOrders[o.id] = o; knownIds[o.id] = true;
        renderOrders([o.id]); chime(); toast('New order #' + o.order_no + (o.table_label ? ' · Table ' + o.table_label : ''), 'info');
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, function (p) {
        if (weekOrders[p.new.id]) weekOrders[p.new.id] = p.new;
        if (orders[p.new.id]) { orders[p.new.id] = p.new; renderOrders(); }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'restaurant' }, function (p) {
        applyRestaurant(p.new, false);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dishes' }, function (p) {
        if (p.eventType === 'DELETE' && p.old) dishes = dishes.filter(function (d) { return d.id !== p.old.id; });
        else if (p.new && p.new.id) upsertDish(p.new);
        renderDishes(); renderOverview();
        if (currentView === 'pairings') renderPairings();
      })
      .subscribe(function (status) {
        if (status === 'SUBSCRIBED') {
          $('offline').classList.add('hidden');
          if (!firstConnect) { loadOrders(); loadDishes(); }   // catch up on anything missed while offline
          firstConnect = false;
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          $('offline').classList.remove('hidden');
        }
      });
  }

  /* ── Restaurant ─────────────────────────────────────────────── */
  function brandHex() { return restaurant && hexOk(restaurant.brand_color) ? restaurant.brand_color : '#B8975A'; }
  function logoUrl() { return restaurant && /^https:\/\//.test(restaurant.logo_url || '') ? restaurant.logo_url : ''; }
  function setMono(el, name, logo) {
    if (!el) return;
    if (logo) el.innerHTML = '<img src="' + esc(logo) + '" alt="">';
    else el.textContent = initial(name);
  }

  function applyRestaurant(r, fillForm) {
    if (!r) return;
    restaurant = r;
    currency = r.currency || '£';
    upgrade.media = 'logo_url' in r && 'brand_color' in r && (!dishes.length || 'image_url' in dishes[0]);
    var name = r.name || 'Your restaurant';
    $('side-name').textContent = name;
    $('top-name').textContent = name;
    setMono($('side-mono'), name, logoUrl());
    setMono($('top-mono'), name, logoUrl());
    $$('[data-accepting]').forEach(function (box) { box.checked = r.accepting_orders; });
    $$('[data-accepting-label]').forEach(function (l) { l.textContent = r.accepting_orders ? 'Taking orders' : 'Orders paused'; });
    $('top-accept-desc').textContent = r.accepting_orders ? 'Taking orders' : 'Orders paused';
    $('recommendations-enabled').checked = r.recommendations_enabled !== false;
    $('ai-recommendations-enabled').checked = r.ai_recommendations_enabled === true;
    $('bundles-enabled').checked = r.bundles_enabled === true;
    if (document.activeElement !== $('bundle-discount-percent')) $('bundle-discount-percent').value = String(Number(r.bundle_discount_percent || 0));
    if (fillForm !== false) fillSettings(r);
    $$('[data-currency]').forEach(function (s) { s.textContent = currency; });
    renderOrders();
    renderDishes();
    if (tablesLoaded) renderTables();
    if (currentView === 'pairings') renderPairings();
    updateUpgradeBanner();
    updateTitle();
  }

  function loadRestaurant() {
    return db.from('restaurant').select('*').eq('id', 1).maybeSingle().then(function (res) {
      if (res.error) toast('Could not load restaurant info: ' + friendly(res.error), 'err');
      else applyRestaurant(res.data);
    });
  }

  function updateRestaurant(patch) {
    return db.from('restaurant').update(patch).eq('id', 1).select().maybeSingle().then(function (res) {
      if (res.error || !res.data) throw res.error || new Error('No permission');
      applyRestaurant(res.data, false);
      return res.data;
    });
  }

  $$('[data-accepting]').forEach(function (box) {
    box.addEventListener('change', function () {
      var on = box.checked;
      $$('[data-accepting]').forEach(function (b) { b.checked = on; });
      updateRestaurant({ accepting_orders: on }).then(function () {
        toast(on ? 'Customers can order again' : 'Orders paused. Customers can still browse the menu.', on ? 'ok' : 'info');
      }).catch(function (err) {
        $$('[data-accepting]').forEach(function (b) { b.checked = !on; });
        toast('Could not change this. ' + friendly(err), 'err');
      });
    });
  });

  /* ── Menu photos and 3D model files ─────────────────────────── */
  // The hand-built cards in index.html hold each original dish photo and its
  // "View on table" button. Reading them keeps one source of truth.
  function loadMenuCards() {
    return fetch('index.html', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.text() : ''; }).then(function (html) {
      var doc = new DOMParser().parseFromString(html || '', 'text/html');
      menuCards = {};
      $$('.food-card[data-dish]', doc).forEach(function (card) {
        var img = card.querySelector('img');
        menuCards[card.getAttribute('data-dish')] = {
          photo: img ? img.getAttribute('src') || '' : '',
          hasAr: !!card.querySelector('.card-ar-btn')
        };
      });
    }).catch(function () { menuCards = {}; }).then(function () {
      renderDishes(); renderOverview();
      if (currentView === 'pairings') renderPairings();
      if (editing) { renderModelBox(); renderPhotoDrop(); updatePreview(); }
    });
  }
  function photoFor(d) {
    if (!d) return '';
    if (/^https:\/\//.test(d.image_url || '')) return d.image_url;
    return menuCards && menuCards[d.id] ? menuCards[d.id].photo : '';
  }
  function sizedPhoto(url, w) {
    return /images\.unsplash\.com/.test(url) ? url.replace(/([?&])w=\d+/, '$1w=' + w) : url;
  }

  function headOk(url) {
    if (location.protocol === 'file:') return Promise.resolve(null);
    return fetch(url, { method: 'HEAD', cache: 'no-store' }).then(function (r) { return r.ok; }).catch(function () { return null; });
  }
  function checkModel(id) {
    if (!id) return Promise.resolve();
    return Promise.all([headOk(id + '.glb' + MODEL_VERSION), headOk(id + '.usdz' + MODEL_VERSION)]).then(function (r) {
      modelStatus[id] = { glb: r[0], usdz: r[1] };
      renderDishes(); renderOverview();
      if (editing && editorId() === id) { renderModelBox(); updatePreview(); }
    });
  }
  function arState(id) {
    var s = modelStatus[id];
    if (!s) return { cls: 'badge-check', text: 'Checking 3D', live: false };
    if (s.glb === null && s.usdz === null) return { cls: '', text: '3D not checked', live: false };
    var hasAr = menuCards === null ? true : !!(menuCards[id] && menuCards[id].hasAr);
    if (s.glb && s.usdz) return hasAr ? { cls: 'badge-live', text: 'Live in AR', live: true } : { cls: 'badge-warn', text: 'Needs AR button', live: false };
    if (s.glb) return { cls: 'badge-warn', text: 'Android only', live: false };
    if (s.usdz) return { cls: 'badge-warn', text: 'iPhone only', live: false };
    return { cls: 'badge-bad', text: 'Missing model', live: false };
  }

  /* ── Dishes ─────────────────────────────────────────────────── */
  var DISH_TEXT = ['name', 'icon', 'description', 'calories', 'prep_time', 'rating', 'size', 'serves', 'weight'];
  var DISH_NUM = ['price', 'calories_per_100g', 'portion_grams'];
  var dishFilter = { q: '', cat: 'all' };

  function dishById(id) { for (var i = 0; i < dishes.length; i++) if (dishes[i].id === id) return dishes[i]; return null; }
  function upsertDish(d) {
    var i = dishes.indexOf(dishById(d.id));
    if (i === -1) dishes.push(d); else dishes[i] = d;
    dishes.sort(function (a, b) { return (a.sort || 0) - (b.sort || 0); });
  }

  function loadDishes() {
    return db.from('dishes').select('*').order('sort').then(function (res) {
      if (res.error) { toast('Could not load the menu: ' + friendly(res.error), 'err'); return; }
      dishes = res.data;
      dishesLoaded = true;
      if (dishes.length && !('image_url' in dishes[0])) upgrade.media = false;
      updateUpgradeBanner();
      renderDishes(); renderOverview();
      if (currentView === 'pairings') renderPairings();
      dishes.forEach(function (d) { if (!modelStatus[d.id]) checkModel(d.id); });
    });
  }

  function dishCard(d) {
    var ar = arState(d.id), photo = photoFor(d), st = modelStatus[d.id];
    var media = photo
      ? '<img src="' + esc(sizedPhoto(photo, 600)) + '" alt="' + esc(d.name) + '" loading="lazy" decoding="async" width="600" height="450">'
      : '<span class="ph" aria-hidden="true">' + esc(d.icon || '🍽️') + '</span>';
    return '<article class="dish-card' + (d.available ? '' : ' off') + '" data-id="' + esc(d.id) + '">' +
      '<div class="dc-media">' + media +
        '<div class="dc-badges"><span class="badge ' + ar.cls + '">' + ar.text + '</span>' +
          (d.promote ? '<span class="badge badge-accent">Chef\'s pick</span>' : '') + '</div>' +
        (st && st.glb ? '<button class="dc-3d" type="button" data-dish-act="preview" aria-label="Preview ' + esc(d.name) + ' in 3D"><svg class="ic"><use href="#i-cube"/></svg></button>' : '') +
      '</div>' +
      '<div class="dc-body"><span class="dc-cat">' + esc(CATEGORY_LABEL[d.category] || 'Main') + '</span>' +
        '<div class="dc-head"><h3>' + esc(d.name) + '</h3><span class="dc-price">' + money(d.price) + '</span></div>' +
        '<p class="dc-desc">' + esc(d.description || 'No description yet.') + '</p></div>' +
      '<div class="dc-foot">' +
        '<label class="switch"><input type="checkbox" data-avail' + (d.available ? ' checked' : '') + ' aria-label="' + esc(d.name) + ' on the menu">' +
          '<span class="track" aria-hidden="true"></span><span>' + (d.available ? 'On the menu' : 'Sold out') + '</span></label>' +
        '<button class="btn btn-ghost btn-sm" type="button" data-dish-act="edit" aria-label="Edit ' + esc(d.name) + '"><svg class="ic"><use href="#i-edit"/></svg>Edit</button>' +
      '</div></article>';
  }

  function renderDishes() {
    if (!dishesLoaded) return;
    var box = $('dishes');
    if (!dishes.length) {
      box.innerHTML = '<div class="empty full-row"><div class="empty-art"><svg class="ic"><use href="#i-dishes"/></svg></div>' +
        '<h3>Add your first dish to bring your menu to life</h3><p>Give it a name, a price and a beautiful photo. Add a 3D model and guests can place it on their table.</p>' +
        '<button class="btn btn-primary" type="button" data-new-dish><svg class="ic"><use href="#i-plus"/></svg>Add your first dish</button></div>';
      return;
    }
    var q = dishFilter.q.toLowerCase();
    var list = dishes.filter(function (d) {
      return (dishFilter.cat === 'all' || d.category === dishFilter.cat) &&
        (!q || (d.name + ' ' + d.description + ' ' + (d.ingredients || []).join(' ')).toLowerCase().indexOf(q) !== -1);
    });
    box.innerHTML = list.length ? list.map(dishCard).join('')
      : '<div class="empty full-row"><h3>No dishes match</h3><p>Try a different search or category.</p><button class="btn btn-ghost" type="button" data-clear-filter>Show all dishes</button></div>';
  }

  $('dish-search').addEventListener('input', function () { dishFilter.q = this.value.trim(); renderDishes(); });
  $('dish-filter').addEventListener('click', function (e) {
    var b = e.target.closest('[data-cat]'); if (!b) return;
    dishFilter.cat = b.getAttribute('data-cat');
    $$('[data-cat]', this).forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
    renderDishes();
  });
  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-clear-filter]')) {
      dishFilter = { q: '', cat: 'all' }; $('dish-search').value = '';
      $$('#dish-filter [data-cat]').forEach(function (x) { x.setAttribute('aria-pressed', String(x.getAttribute('data-cat') === 'all')); });
      renderDishes();
    }
    if (e.target.closest('[data-new-dish]')) openEditor(null);
  });

  $('dishes').addEventListener('click', function (e) {
    var b = e.target.closest('[data-dish-act]'); if (!b) return;
    var id = b.closest('.dish-card').getAttribute('data-id');
    if (b.getAttribute('data-dish-act') === 'edit') openEditor(id);
    if (b.getAttribute('data-dish-act') === 'preview') previewDish(id);
  });

  function saveDish(id, patch) {
    return db.from('dishes').update(patch).eq('id', id).select().maybeSingle().then(function (res) {
      if (res.error || !res.data) throw res.error || new Error('No permission to change dishes');
      upsertDish(res.data);
      return res.data;
    });
  }

  // Sold-out switch saves immediately — it's the thing a busy kitchen flips most
  $('dishes').addEventListener('change', function (e) {
    if (!e.target.hasAttribute('data-avail')) return;
    var box = e.target, card = box.closest('.dish-card'), id = card.getAttribute('data-id'), on = box.checked;
    var label = box.parentNode.lastChild;
    card.classList.toggle('off', !on); label.textContent = on ? 'On the menu' : 'Sold out';
    saveDish(id, { available: on }).then(function (d) {
      toast(on ? d.name + ' is back on the menu' : d.name + ' marked sold out', 'ok');
      renderOverview();
    }).catch(function (err) {
      box.checked = !on; card.classList.toggle('off', on); label.textContent = !on ? 'On the menu' : 'Sold out';
      toast('Could not save. ' + friendly(err), 'err');
    });
  });

  /* ── Dish editor ────────────────────────────────────────────── */
  function chipsHtml(name, tags, selected, danger) {
    return tags.map(function (t) {
      return '<label class="chip' + (danger ? ' danger' : '') + '"><input type="checkbox" name="' + name + '" value="' + t[0] + '"' +
        (selected.indexOf(t[0]) !== -1 ? ' checked' : '') + '><span>' + t[1] + '</span></label>';
    }).join('');
  }
  function editorId() { return editing ? (editing.isNew ? $('ed-id').value.trim() : editing.id) : ''; }

  function openEditor(id) {
    var d = id ? dishById(id) : null;
    if (id && !d) return;
    var isNew = !d;
    d = d || { name: '', price: '', category: 'main', icon: '🍽️', description: '', available: true, price_band: 'mid',
      meal_part: 'unspecified', promote: false, allergen_info_verified: false, dietary: [], allergens: [],
      may_contain_allergens: [], ingredients: [], flavour: [], calories_per_100g: 0, portion_grams: 0 };
    editing = { id: isNew ? '' : d.id, isNew: isNew, idTouched: false, photoFile: null, photoPreview: '', removePhoto: false,
      modelBlob: '', dirty: false, touched: false, imageUrl: d.image_url || '' };

    $('ed-eyebrow').textContent = isNew ? 'New dish' : 'Edit dish';
    $('ed-title').textContent = isNew ? 'Add a dish' : d.name;
    $('ed-id-field').classList.toggle('hidden', !isNew);
    $('ed-id').value = '';
    DISH_TEXT.forEach(function (f) { $('ed-' + f).value = d[f] == null ? '' : d[f]; });
    $('ed-price').value = d.price === '' || d.price == null ? '' : Number(d.price).toFixed(2);
    $('ed-calories_per_100g').value = Number(d.calories_per_100g) ? d.calories_per_100g : '';
    $('ed-portion_grams').value = Number(d.portion_grams) ? d.portion_grams : '';
    $('ed-category').value = CATEGORY_LABEL[d.category] ? d.category : 'main';
    $('ed-price_band').value = d.price_band || 'mid';
    $('ed-meal_part').value = d.meal_part || 'unspecified';
    $('ed-ingredients').value = (d.ingredients || []).join(', ');
    $('ed-flavour').value = (d.flavour || []).join(', ');
    $('ed-available').checked = d.available !== false;
    $('ed-promote').checked = d.promote === true;
    $('ed-verified').checked = d.allergen_info_verified === true;
    $('ed-dietary').innerHTML = chipsHtml('dietary', DIETARY_TAGS, d.dietary || []);
    $('ed-allergens').innerHTML = chipsHtml('allergens', ALLERGEN_TAGS, d.allergens || [], true);
    $('ed-may').innerHTML = chipsHtml('may', ALLERGEN_TAGS, d.may_contain_allergens || [], true);
    ['ed-name', 'ed-price', 'ed-id'].forEach(function (f) { setErr(f, ''); });
    $('ed-status').textContent = ''; $('ed-status').className = 'status-text';
    busy($('ed-save'), false);
    $('ed-save').querySelector('.btn-label').textContent = isNew ? 'Add dish' : 'Save dish';

    renderPhotoDrop();
    renderModelBox();
    updatePreview();
    $('editor').showModal();
    $('editor').querySelector('.drawer-body').scrollTop = 0;
    (isNew ? $('ed-name') : $('ed-form').querySelector('.drawer-head .icon-btn')).focus();
  }

  function closeEditor(force) {
    if (!editing) { if ($('editor').open) $('editor').close(); return; }
    if (!force && editing.dirty && !confirm('Discard your unsaved changes?')) return;
    if (editing.photoPreview) URL.revokeObjectURL(editing.photoPreview);
    if (editing.modelBlob) URL.revokeObjectURL(editing.modelBlob);
    editing = null;
    if ($('editor').open) $('editor').close();
  }
  $$('[data-close-editor]').forEach(function (b) { b.addEventListener('click', function () { closeEditor(false); }); });
  $('editor').addEventListener('cancel', function (e) { e.preventDefault(); closeEditor(false); });
  $('editor').addEventListener('click', function (e) { if (e.target === this) closeEditor(false); });

  function setErr(id, msg) {
    var el = $(id), out = $(id + '-err');
    if (msg) el.setAttribute('aria-invalid', 'true'); else el.removeAttribute('aria-invalid');
    if (out) out.textContent = msg;
    return !msg;
  }
  function validateEditor(focusFirst) {
    if (!editing) return false;
    var checks = [];
    checks.push(['ed-name', $('ed-name').value.trim() ? '' : 'Give the dish a name.']);
    var p = $('ed-price').value, pn = Number(p);
    checks.push(['ed-price', p === '' ? 'Add a price.' : !(pn >= 0 && pn <= 9999) ? 'Use a price between 0 and 9,999.' : '']);
    if (editing.isNew) {
      var id = $('ed-id').value.trim();
      checks.push(['ed-id', !/^[a-z0-9][a-z0-9-]{0,39}$/.test(id) ? 'Use lower-case letters, numbers and dashes, e.g. lamb-tagine.'
        : dishById(id) ? 'Another dish already uses this name. Choose a different one.' : '']);
    }
    var first = null;
    checks.forEach(function (c) { if (!setErr(c[0], c[1]) && !first) first = c[0]; });
    if (first && focusFirst) $(first).focus();
    return !first;
  }

  function collectEditor() {
    var patch = {};
    DISH_TEXT.forEach(function (f) { patch[f] = $('ed-' + f).value.trim(); });
    DISH_NUM.forEach(function (f) { patch[f] = Math.round(Number($('ed-' + f).value || 0) * 100) / 100; });
    if (!patch.icon) patch.icon = '🍽️';
    patch.category = $('ed-category').value;
    patch.price_band = $('ed-price_band').value;
    patch.meal_part = $('ed-meal_part').value;
    patch.ingredients = listFrom($('ed-ingredients').value);
    patch.flavour = listFrom($('ed-flavour').value);
    patch.dietary = $$('#ed-dietary input:checked').map(function (el) { return el.value; });
    patch.allergens = $$('#ed-allergens input:checked').map(function (el) { return el.value; });
    patch.may_contain_allergens = $$('#ed-may input:checked').map(function (el) { return el.value; });
    patch.allergen_info_verified = $('ed-verified').checked;
    patch.promote = $('ed-promote').checked;
    patch.available = $('ed-available').checked;
    return patch;
  }

  function kcalText() {
    var per = Number($('ed-calories_per_100g').value), g = Number($('ed-portion_grams').value);
    return per && g ? Math.round(per * g / 100) + ' kcal' : ($('ed-calories').value.trim() || '');
  }

  function updatePreview() {
    if (!editing) return;
    var name = $('ed-name').value.trim() || 'Dish name';
    var price = $('ed-price').value === '' ? 0 : Number($('ed-price').value);
    var id = editorId(), ar = arState(id);
    var d = editing.isNew ? null : dishById(editing.id);
    var photo = editing.photoPreview || (editing.removePhoto ? (menuCards && menuCards[id] ? menuCards[id].photo : '') : photoFor(d));
    var accent = restaurant && hexOk(restaurant.brand_color) ? restaurant.brand_color : '#D4AF37';
    $('pv-name').textContent = name;
    $('pv-price').textContent = money(isFinite(price) ? price : 0);
    $('pv-desc').textContent = $('ed-description').value.trim();
    $('pv-facts').textContent = [[$('ed-size').value.trim(), $('ed-serves').value.trim()].filter(Boolean).join(' · '), kcalText()].filter(Boolean).join('  ·  ');
    $('pv-media').innerHTML = (photo ? '<img src="' + esc(sizedPhoto(photo, 600)) + '" alt="">' : '<span aria-hidden="true">' + esc($('ed-icon').value || '🍽️') + '</span>') +
      ($('ed-promote').checked ? '<span class="badge badge-accent">Chef\'s pick</span>' : '');
    $('pv-card').classList.toggle('off', !$('ed-available').checked);
    $('pv-card').style.setProperty('--pv-accent', accent);
    $('pv-card').style.setProperty('--pv-ink', inkFor(accent));
    var arBtn = $('pv-card').querySelector('.pv-ar');
    arBtn.classList.toggle('none', !ar.live);
    arBtn.lastChild.textContent = ar.live ? 'View on table' : 'No AR yet';
    $('ed-kcal-out').textContent = kcalText() || '—';
    $('ed-desc-count').textContent = $('ed-description').value.length + ' / 200';
    $('ed-available-label').textContent = $('ed-available').checked ? 'Available' : 'Sold out';
  }

  var modelCheckTimer = null;
  $('ed-form').addEventListener('input', function (e) {
    if (!editing) return;
    editing.dirty = true;
    if (e.target.id === 'ed-name' && editing.isNew && !editing.idTouched) {
      $('ed-id').value = slugify(e.target.value);
      scheduleModelCheck();
    }
    if (e.target.id === 'ed-id') { editing.idTouched = true; scheduleModelCheck(); }
    if (e.target.id === 'ed-name' && !editing.isNew) $('ed-title').textContent = e.target.value.trim() || 'Dish';
    if (editing.touched) validateEditor(false);
    updatePreview();
  });
  $('ed-form').addEventListener('change', function () { if (editing) { editing.dirty = true; updatePreview(); } });
  ['ed-name', 'ed-price', 'ed-id'].forEach(function (f) {
    $(f).addEventListener('blur', function () { if (editing && (this.value || editing.touched)) { editing.touched = true; validateEditor(false); } });
  });
  function scheduleModelCheck() {
    clearTimeout(modelCheckTimer);
    renderModelBox();
    modelCheckTimer = setTimeout(function () {
      var id = editorId();
      if (/^[a-z0-9][a-z0-9-]{0,39}$/.test(id) && !modelStatus[id]) checkModel(id);
    }, 500);
  }

  function renderModelBox() {
    if (!editing) return;
    var id = editorId(), s = modelStatus[id], ar = arState(id);
    var file = function (ok, label) {
      var cls = ok === true ? 'yes' : ok === false ? 'no' : '';
      var icon = ok === true ? 'i-check' : ok === false ? 'i-close' : 'i-cube';
      return '<span class="model-file ' + cls + '"><svg class="ic" aria-hidden="true"><use href="#' + icon + '"/></svg>' + label +
        '<span class="sr-only">' + (ok === true ? ' found' : ok === false ? ' missing' : ' not checked') + '</span></span>';
    };
    var name = id || 'your-dish';
    var hasAr = menuCards && menuCards[id] ? menuCards[id].hasAr : false;
    $('ed-model-files').innerHTML = file(s ? s.glb : null, esc(name) + '.glb · Android') + file(s ? s.usdz : null, esc(name) + '.usdz · iPhone') +
      (menuCards ? file(hasAr, '“View on table” button') : '');
    $('ed-model-preview').disabled = !(s && s.glb) && !editing.modelBlob;
    var hint;
    if (!id) hint = 'Name the dish first. Its 3D files use the same name.';
    else if (ar.live) hint = 'Live: guests can place this dish on their table. Preview it here before service.';
    else if (s && s.glb === null && s.usdz === null) hint = 'Model files can only be checked once the dashboard is online (not opened from a file).';
    else hint = 'To go live in AR, add ' + name + '.glb (Android) and ' + name + '.usdz (iPhone) to the repository root, next to index.html' +
      (hasAr ? '.' : ', and add a “View on table” button for this dish in index.html.') + ' You can test a .glb here first.';
    $('ed-model-hint').textContent = hint;
  }

  $('ed-model-preview').addEventListener('click', function () {
    if (!editing) return;
    var id = editorId(), name = $('ed-name').value.trim() || 'Dish';
    if (editing.modelBlob) openViewer({ src: editing.modelBlob, title: name, eyebrow: 'Test file · not live yet' });
    else openViewer({ src: id + '.glb' + MODEL_VERSION, title: name, eyebrow: '3D preview' });
  });
  $('ed-model-file').addEventListener('change', function () {
    var f = this.files && this.files[0]; this.value = '';
    if (f) testModelFile(f);
  });
  wireDrop($('ed-model'), function (f) { testModelFile(f); });
  function testModelFile(f) {
    if (!editing) return;
    if (!/\.glb$/i.test(f.name)) { toast('Choose a .glb file to preview. iPhone .usdz files can only be checked on an iPhone.', 'err'); return; }
    if (f.size > 60 * 1024 * 1024) { toast('This model is over 60 MB. It would load far too slowly on phones.', 'err'); return; }
    if (editing.modelBlob) URL.revokeObjectURL(editing.modelBlob);
    editing.modelBlob = URL.createObjectURL(f);
    var id = editorId();
    var notes = [];
    if (f.size > 15 * 1024 * 1024) notes.push('It is ' + (f.size / 1048576).toFixed(1) + ' MB. Aim for under 10 MB so it opens quickly on phones.');
    if (id && f.name.toLowerCase() !== id + '.glb') notes.push('Rename it to ' + id + '.glb before adding it to the repository.');
    renderModelBox();
    if (notes.length) toast(notes.join(' '), 'info');
    openViewer({ src: editing.modelBlob, title: $('ed-name').value.trim() || f.name, eyebrow: 'Test file · not live yet' });
  }

  // Photo
  var IMAGE_TYPES = /^image\/(jpeg|png|webp)$/;
  function renderPhotoDrop() {
    if (!editing) return;
    var zone = $('ed-form').querySelector('[data-drop="photo"]');
    var d = editing.isNew ? null : dishById(editing.id);
    var photo = editing.photoPreview || (editing.removePhoto ? '' : photoFor(d));
    var removable = editing.photoPreview || (!editing.removePhoto && /^https:\/\//.test(editing.imageUrl));
    $('ed-photo-preview').innerHTML = photo ? '<img src="' + esc(sizedPhoto(photo, 900)) + '" alt="">' : '';
    zone.classList.toggle('has-media', !!photo);
    zone.classList.toggle('is-disabled', !upgrade.media);
    $('ed-photo').disabled = !upgrade.media;
    var text = zone.querySelector('.drop-text');
    if (!upgrade.media) {
      text.innerHTML = '<svg class="ic ic-lg" aria-hidden="true"><use href="#i-image"/></svg><p><b>Photo upload is not switched on yet</b></p>' +
        '<p class="hint">Run ' + UPGRADE_FILE + ' in Supabase to upload photos from here.</p>';
    } else if (photo) {
      text.innerHTML = '<label for="ed-photo" class="link">Replace photo</label>' +
        (removable ? '<span aria-hidden="true">·</span><button type="button" class="link link-danger" data-photo-remove>Remove</button>' : '') +
        '<p class="hint">You can also drop a new photo here.</p>';
    } else {
      text.innerHTML = '<svg class="ic ic-lg" aria-hidden="true"><use href="#i-image"/></svg>' +
        '<p><b>Drag a photo here</b> or <label for="ed-photo" class="link">browse</label></p>' +
        '<p class="hint">JPG, PNG or WebP. Landscape works best. It is resized for fast phones.</p>';
    }
  }
  function stagePhoto(f) {
    if (!editing) return;
    if (!upgrade.media) { toast('Photo upload needs the one-time database upgrade first.', 'err'); return; }
    if (!IMAGE_TYPES.test(f.type)) { toast('Use a JPG, PNG or WebP photo.', 'err'); return; }
    if (f.size > 25 * 1024 * 1024) { toast('This photo is over 25 MB. Choose a smaller one.', 'err'); return; }
    if (editing.photoPreview) URL.revokeObjectURL(editing.photoPreview);
    editing.photoFile = f; editing.photoPreview = URL.createObjectURL(f); editing.removePhoto = false; editing.dirty = true;
    renderPhotoDrop(); updatePreview();
  }
  $('ed-photo').addEventListener('change', function () { var f = this.files && this.files[0]; this.value = ''; if (f) stagePhoto(f); });
  wireDrop($('ed-form').querySelector('[data-drop="photo"]'), stagePhoto);
  $('ed-form').addEventListener('click', function (e) {
    if (!e.target.closest('[data-photo-remove]') || !editing) return;
    if (editing.photoPreview) URL.revokeObjectURL(editing.photoPreview);
    editing.photoFile = null; editing.photoPreview = ''; editing.removePhoto = !!editing.imageUrl; editing.dirty = true;
    renderPhotoDrop(); updatePreview();
  });

  $('ed-form').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!editing) return;
    editing.touched = true;
    var st = $('ed-status');
    if (!validateEditor(true)) { st.className = 'status-text err'; st.textContent = 'Check the highlighted fields.'; return; }
    var ctx = editing, id = editorId(), isNew = ctx.isNew, patch = collectEditor(), btn = $('ed-save');
    busy(btn, true); st.className = 'status-text'; st.textContent = ctx.photoFile ? 'Uploading photo…' : 'Saving…';
    var step = ctx.photoFile ? uploadMedia('dishes', id, ctx.photoFile, 1600).then(function (url) { patch.image_url = url; }) : Promise.resolve();
    if (ctx.removePhoto && !ctx.photoFile) patch.image_url = '';
    step.then(function () {
      st.textContent = 'Saving…';
      if (isNew) {
        patch.id = id;
        patch.sort = dishes.reduce(function (m, d) { return Math.max(m, d.sort || 0); }, 0) + 1;
        return db.from('dishes').insert(patch).select().maybeSingle();
      }
      return db.from('dishes').update(patch).eq('id', id).select().maybeSingle();
    }).then(function (res) {
      if (res.error || !res.data) throw res.error || new Error('No permission to save dishes');
      upsertDish(res.data);
      if (editing === ctx) closeEditor(true);
      renderDishes(); renderOverview();
      if (currentView === 'pairings') renderPairings();
      toast(isNew ? res.data.name + ' added. It is now on your menu.' : 'Saved. ' + res.data.name + ' is live on the menu.', 'ok');
      if (!modelStatus[id]) checkModel(id);
    }).catch(function (err) {
      busy(btn, false);
      st.className = 'status-text err';
      st.textContent = friendly(err);
    });
  });

  /* ── Image upload (photos and logo) ─────────────────────────── */
  function compressImage(file, maxSide, quality) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var s = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
        var w = Math.max(1, Math.round(img.naturalWidth * s)), h = Math.max(1, Math.round(img.naturalHeight * s));
        var c = document.createElement('canvas'); c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        c.toBlob(function (b) {
          if (b && b.type === 'image/webp') return resolve({ blob: b, ext: 'webp', type: 'image/webp' });
          c.toBlob(function (j) {
            if (j) resolve({ blob: j, ext: 'jpg', type: 'image/jpeg' }); else reject(new Error('Could not prepare this image.'));
          }, 'image/jpeg', quality);
        }, 'image/webp', quality);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('This file could not be read as an image.')); };
      img.src = url;
    });
  }
  function uploadMedia(folder, name, file, maxSide) {
    return compressImage(file, maxSide, 0.86).then(function (img) {
      var path = folder + '/' + (slugify(name) || 'image') + '-' + Date.now() + '.' + img.ext;
      return db.storage.from(MEDIA_BUCKET).upload(path, img.blob, { contentType: img.type, cacheControl: '31536000', upsert: false })
        .then(function (res) {
          if (res.error) throw res.error;
          return db.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
        });
    });
  }

  function wireDrop(zone, onFile) {
    if (!zone) return;
    ['dragenter', 'dragover'].forEach(function (ev) {
      zone.addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); zone.classList.add('is-over'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      zone.addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); zone.classList.remove('is-over'); });
    });
    zone.addEventListener('drop', function (e) {
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) onFile(f);
    });
  }
  // A file dropped outside a drop zone must not navigate away from the dashboard.
  ['dragover', 'drop'].forEach(function (ev) { window.addEventListener(ev, function (e) { e.preventDefault(); }); });

  /* ── 3D preview ─────────────────────────────────────────────── */
  var mvReady = null, mvEl = null;
  function loadModelViewer() {
    if (window.customElements && customElements.get('model-viewer')) return Promise.resolve();
    if (mvReady) return mvReady;
    mvReady = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.type = 'module'; s.src = MODEL_VIEWER_URL;
      s.onerror = function () { mvReady = null; reject(new Error('The 3D viewer could not load. Check your connection.')); };
      document.head.appendChild(s);
      customElements.whenDefined('model-viewer').then(resolve);
    });
    return mvReady;
  }
  function viewerState(text, kind) {
    var l = $('vw-loading');
    l.classList.toggle('done', kind === 'done');
    l.classList.toggle('error', kind === 'error');
    $('vw-loading-text').textContent = text;
  }
  function openViewer(opts) {
    $('vw-title').textContent = opts.title;
    $('vw-eyebrow').textContent = opts.eyebrow || '3D preview';
    $('vw-dims').innerHTML = '<svg class="ic" aria-hidden="true"><use href="#i-tap"/></svg>Drag to turn, pinch or scroll to zoom.';
    $('vw-spin').setAttribute('aria-pressed', 'true');
    if (mvEl) { mvEl.remove(); mvEl = null; }
    viewerState('Loading 3D model…');
    if (!$('viewer').open) $('viewer').showModal();
    loadModelViewer().then(function () {
      if (!$('viewer').open) return;
      var mv = document.createElement('model-viewer');
      mv.setAttribute('src', opts.src);
      mv.setAttribute('alt', '3D model of ' + opts.title);
      mv.setAttribute('camera-controls', '');
      mv.setAttribute('auto-rotate', '');
      mv.setAttribute('auto-rotate-delay', '800');
      mv.setAttribute('interaction-prompt', 'none');
      mv.setAttribute('touch-action', 'pan-y');
      mv.setAttribute('shadow-intensity', '1');
      mv.setAttribute('loading', 'eager');
      mv.addEventListener('progress', function (e) {
        var p = e.detail && e.detail.totalProgress;
        if (p < 1) viewerState('Loading 3D model… ' + Math.round(p * 100) + '%');
      });
      mv.addEventListener('load', function () {
        viewerState('', 'done');
        try {
          var s = mv.getDimensions(), cm = function (v) { return Math.round(v * 100); };
          $('vw-dims').innerHTML = '<svg class="ic" aria-hidden="true"><use href="#i-cube"/></svg>Real size on the table: ' +
            cm(s.x) + ' × ' + cm(s.z) + ' cm, ' + cm(s.y) + ' cm tall';
        } catch (err) { /* size is a nice extra */ }
      });
      mv.addEventListener('error', function () {
        viewerState('This model could not be opened. Check that the file exists and is a valid .glb.', 'error');
      });
      mvEl = mv;
      $('vw-stage').appendChild(mv);
    }).catch(function (err) { viewerState(err.message, 'error'); });
  }
  function previewDish(id) {
    var d = dishById(id); if (!d) return;
    openViewer({ src: id + '.glb' + MODEL_VERSION, title: d.name, eyebrow: arState(id).live ? 'Live in AR · 3D preview' : '3D preview' });
  }
  $('vw-close').addEventListener('click', function () { $('viewer').close(); });
  $('viewer').addEventListener('close', function () { if (mvEl) { mvEl.remove(); mvEl = null; } });
  $('viewer').addEventListener('click', function (e) { if (e.target === this) this.close(); });
  $('vw-spin').addEventListener('click', function () {
    if (!mvEl) return;
    mvEl.autoRotate = !mvEl.autoRotate;
    this.setAttribute('aria-pressed', String(mvEl.autoRotate));
  });
  $('vw-reset').addEventListener('click', function () {
    if (!mvEl) return;
    mvEl.cameraOrbit = 'auto auto auto'; mvEl.cameraTarget = 'auto auto auto'; mvEl.fieldOfView = 'auto';
    if (mvEl.resetTurntableRotation) mvEl.resetTurntableRotation();
    if (mvEl.jumpCameraToGoal) mvEl.jumpCameraToGoal();
  });

  /* ── Overview ───────────────────────────────────────────────── */
  function renderGreeting() {
    var h = new Date().getHours();
    $('ov-greeting').textContent = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    $('ov-date').textContent = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    $('ov-sub').textContent = restaurant && restaurant.name ? 'Here is how ' + restaurant.name + ' is doing this week.' : 'Here is how your menu is doing this week.';
  }
  function eventSeries(kind, keys) {
    var by = {};
    (events || []).forEach(function (r) {
      if (r.event_kind === kind) by[r.event_day] = (by[r.event_day] || 0) + Number(r.events);
    });
    return keys.map(function (k) { return by[k] || 0; });
  }
  function spark(values) {
    var max = Math.max.apply(null, values.concat([1])), n = values.length;
    var pts = values.map(function (v, i) { return [(i / (n - 1)) * 100, 29 - (v / max) * 25]; });
    var line = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(2) + ' ' + p[1].toFixed(2); }).join(' ');
    return '<svg class="spark" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">' +
      '<path class="area" d="' + line + ' L100 32 L0 32 Z"/><path class="line" d="' + line + '"/></svg>';
  }
  function delta(cur, prev) {
    if (!cur && !prev) return '';
    if (!prev) return '<span class="delta up">New</span>';
    var p = Math.round((cur - prev) / prev * 100);
    return '<span class="delta ' + (p >= 0 ? 'up' : 'down') + '">' + (p >= 0 ? '+' : '−') + Math.abs(p) + '%</span>';
  }
  var SKEL_STAT = '<article class="stat-card skel-card"><span class="skel skel-line w40"></span><span class="skel skel-num"></span><span class="skel skel-chart"></span></article>';
  function statCard(label, kind, keys, prevKeys) {
    if (events === null) return SKEL_STAT;
    if (events === false) {
      return '<article class="stat-card"><span class="label">' + label + '</span><span class="stat-value">—</span>' +
        '<p class="stat-note">' + (eventsNeedUpgrade ? 'Starts counting once the database upgrade has been run.' : 'Could not load analytics right now.') + '</p></article>';
    }
    var series = eventSeries(kind, keys), cur = sum(series), prev = sum(eventSeries(kind, prevKeys));
    return '<article class="stat-card"><span class="label">' + label + '</span>' +
      '<span class="stat-value num">' + cur.toLocaleString('en-GB') + '</span>' +
      '<span class="stat-sub">' + delta(cur, prev) + '<span>last 7 days</span></span>' + spark(series) + '</article>';
  }
  function allRecentOrders() {
    var map = {}, k;
    for (k in weekOrders) map[k] = weekOrders[k];
    for (k in orders) map[k] = orders[k];
    return Object.keys(map).map(function (id) { return map[id]; });
  }
  function orderedCounts(keys) {
    var counts = {};
    allRecentOrders().forEach(function (o) {
      if (o.status === 'cancelled' || keys.indexOf(dayKey(new Date(o.created_at))) === -1) return;
      (o.items || []).forEach(function (it) { if (it.id && it.type !== 'discount') counts[it.id] = (counts[it.id] || 0) + (Number(it.qty) || 1); });
    });
    return counts;
  }
  function topList(counts) {
    return Object.keys(counts).filter(function (id) { return counts[id] > 0 && dishById(id); })
      .sort(function (a, b) { return counts[b] - counts[a]; });
  }

  function renderOverview() {
    if (!restaurant || !dishesLoaded) return;
    renderGreeting();
    var keys = lastDays(7), prevKeys = lastDays(7, 7);

    // Most viewed dish (AR views), or most ordered until analytics has data
    var arCounts = {};
    (events || []).forEach(function (r) {
      if (r.event_kind === 'ar_view' && r.event_dish && keys.indexOf(r.event_day) !== -1) arCounts[r.event_dish] = (arCounts[r.event_dish] || 0) + Number(r.events);
    });
    var basis = topList(arCounts).length ? 'ar' : 'orders';
    var counts = basis === 'ar' ? arCounts : orderedCounts(keys);
    var top = topList(counts);
    var best = top[0] ? dishById(top[0]) : null;
    var bestCard = events === null ? SKEL_STAT
      : '<article class="stat-card"><span class="label">' + (basis === 'ar' ? 'Most viewed dish' : 'Most ordered dish') + '</span>' +
        (best ? '<div class="stat-dish">' + thumb(best) + '<b>' + esc(best.name) + '</b></div>' +
          '<span class="stat-sub"><span class="delta up">' + counts[best.id].toLocaleString('en-GB') + '</span><span>' + (basis === 'ar' ? 'AR views' : 'ordered') + ' this week</span></span>'
          : '<span class="stat-value">—</span>') +
        '<p class="stat-note">' + (best ? (basis === 'ar' ? 'Guests placed it on their table most often.' : 'Based on orders until AR views are counted.') : 'Appears once guests start viewing or ordering.') + '</p></article>';

    $('ov-stats').innerHTML = statCard('AR views', 'ar_view', keys, prevKeys) + bestCard +
      statCard('Recommendation taps', 'rec_click', keys, prevKeys) + statCard('Menu views', 'menu_view', keys, prevKeys);

    // Revenue bars
    var rev = {};
    allRecentOrders().forEach(function (o) {
      if (o.status === 'cancelled') return;
      var k = dayKey(new Date(o.created_at)); rev[k] = (rev[k] || 0) + Number(o.total);
    });
    var vals = keys.map(function (k) { return rev[k] || 0; }), max = Math.max.apply(null, vals.concat([1]));
    var today = dayKey(new Date());
    $('ov-revenue-bars').innerHTML = keys.map(function (k, i) {
      var d = new Date(k + 'T12:00:00');
      return '<div class="bar' + (k === today ? ' today' : '') + '" title="' + esc(money(vals[i])) + '"><i style="height:' + Math.max(2, Math.round(vals[i] / max * 100)) + '%"></i>' +
        '<span>' + d.toLocaleDateString('en-GB', { weekday: 'narrow' }) + '</span></div>';
    }).join('');
    $('ov-revenue-bars').setAttribute('aria-label', 'Revenue for the last 7 days: ' + keys.map(function (k, i) {
      return new Date(k + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short' }) + ' ' + money(vals[i]);
    }).join(', '));
    $('ov-week-revenue').textContent = money(sum(vals));

    // Top dishes
    $('ov-top-basis').textContent = basis === 'ar' ? 'by AR views' : 'by orders';
    var topMax = top.length ? counts[top[0]] : 1;
    $('ov-top').innerHTML = top.length ? top.slice(0, 5).map(function (id, i) {
        var d = dishById(id);
        return '<li><span class="rank">' + (i + 1) + '</span>' + thumb(d) +
          '<div><div class="r-name">' + esc(d.name) + '</div><div class="r-meter"><i style="width:' + Math.round(counts[id] / topMax * 100) + '%"></i></div></div>' +
          '<span class="r-val">' + counts[id].toLocaleString('en-GB') + '</span></li>';
      }).join('')
      : '<li class="empty empty-sm" style="list-style:none">No views or orders yet this week. Put your table QR cards out to get started.</li>';

    renderAttention();
  }

  function renderAttention() {
    var items = [];
    if (restaurant.accepting_orders === false) items.push({ text: 'Orders are paused. Guests can browse but not order.', btn: '<button class="btn btn-sm" type="button" data-attn="resume">Resume orders</button>' });
    if (!dishes.length) items.push({ text: 'Your menu is empty. Add your first dish.', btn: '<button class="btn btn-sm btn-primary" type="button" data-new-dish>Add dish</button>' });
    dishes.filter(function (d) { var a = arState(d.id); return modelStatus[d.id] && !a.live && a.cls !== ''; }).slice(0, 2).forEach(function (d) {
      items.push({ text: d.name + ': ' + arState(d.id).text.toLowerCase() + '.', btn: '<button class="btn btn-sm btn-ghost" type="button" data-attn-edit="' + esc(d.id) + '">Fix</button>' });
    });
    var unverified = dishes.filter(function (d) { return !d.allergen_info_verified; });
    if (unverified.length) items.push({ text: (unverified.length === 1 ? unverified[0].name + ' has' : unverified.length + ' dishes have') + ' unverified allergen information.', btn: '<button class="btn btn-sm btn-ghost" type="button" data-attn-edit="' + esc(unverified[0].id) + '">Review</button>' });
    var sold = dishes.filter(function (d) { return !d.available; });
    if (sold.length) items.push({ text: sold.map(function (d) { return d.name; }).slice(0, 3).join(', ') + (sold.length > 3 ? ' and more' : '') + (sold.length === 1 ? ' is' : ' are') + ' marked sold out.', btn: '<a class="btn btn-sm btn-ghost" href="#dishes">View</a>' });
    var noPhoto = menuCards ? dishes.filter(function (d) { return !photoFor(d); }) : [];
    if (noPhoto.length) items.push({ text: noPhoto[0].name + (noPhoto.length > 1 ? ' and ' + plural(noPhoto.length - 1, 'other dish', 'other dishes') + ' need photos.' : ' needs a photo.'), btn: '<button class="btn btn-sm btn-ghost" type="button" data-attn-edit="' + esc(noPhoto[0].id) + '">Add photo</button>' });
    if (tablesLoaded && !tables.length) items.push({ text: 'No tables yet. Add one to print its QR card.', btn: '<a class="btn btn-sm btn-ghost" href="#tables">Add table</a>' });
    $('ov-attention').innerHTML = items.length ? items.slice(0, 6).map(function (it) {
      return '<li><svg class="ic" aria-hidden="true"><use href="#i-alert"/></svg><span>' + esc(it.text) + '</span>' + it.btn + '</li>';
    }).join('') : '<li class="ok"><svg class="ic" aria-hidden="true"><use href="#i-check"/></svg><span>Everything looks good. Your menu is ready for service.</span></li>';
  }
  $('ov-attention').addEventListener('click', function (e) {
    var ed = e.target.closest('[data-attn-edit]');
    if (ed) openEditor(ed.getAttribute('data-attn-edit'));
    if (e.target.closest('[data-attn="resume"]')) {
      updateRestaurant({ accepting_orders: true }).then(function () { toast('Customers can order again', 'ok'); })
        .catch(function (err) { toast('Could not change this. ' + friendly(err), 'err'); });
    }
  });

  function loadEvents() {
    return db.rpc('menu_event_daily', { p_days: 14 }).then(function (res) {
      if (res.error) {
        events = false;
        eventsNeedUpgrade = res.error.code === 'PGRST202' || /menu_event_daily|could not find the function/i.test(res.error.message || '');
      } else { events = res.data || []; eventsNeedUpgrade = false; }
      updateUpgradeBanner();
      renderOverview();
    });
  }
  setInterval(function () { if (!document.hidden && currentView === 'overview' && events !== false) loadEvents(); }, 5 * 60 * 1000);

  /* ── Pairings ───────────────────────────────────────────────── */
  var pairSelected = null, pairCache = {};
  function loadPairCounts(id) {
    var c = pairCache[id];
    if (c && c.at > Date.now() - 300000) return Promise.resolve(c.counts);
    return db.rpc('popular_dish_pairings', { p_dish_ids: [id], p_limit: 1000 }).then(function (res) {
      var counts = {};
      if (!res.error) (res.data || []).forEach(function (p) { counts[p.dish_id] = Number(p.order_count); });
      pairCache[id] = { counts: counts, at: Date.now() };
      return counts;
    });
  }
  function renderPairings() {
    if (!dishesLoaded) return;
    var picker = $('pair-picker'), detail = $('pair-detail');
    if (!dishes.length) {
      picker.innerHTML = '';
      detail.innerHTML = '<div class="empty"><div class="empty-art"><svg class="ic"><use href="#i-pairings"/></svg></div><h3>Pairings appear once you have dishes</h3><p>Add a few mains, drinks and desserts, and MenuVision will suggest what goes well together.</p><button class="btn btn-primary" type="button" data-new-dish>Add dish</button></div>';
      return;
    }
    if (!pairSelected || !dishById(pairSelected)) pairSelected = (dishes.filter(function (d) { return d.category === 'main'; })[0] || dishes[0]).id;
    picker.innerHTML = dishes.map(function (d) {
      return '<button class="pick" type="button" aria-pressed="' + (d.id === pairSelected) + '" data-pick="' + esc(d.id) + '">' + thumb(d) +
        '<span><b>' + esc(d.name) + '</b><small>' + esc(CATEGORY_LABEL[d.category] || 'Main') + '</small></span></button>';
    }).join('');
    var id = pairSelected;
    loadPairCounts(id).then(function (counts) { if (pairSelected === id) drawPairDetail(id, counts); });
  }
  function drawPairDetail(id, counts) {
    var d = dishById(id), detail = $('pair-detail');
    if (!d) return;
    var menu = dishes.map(function (x) { return Object.assign({}, x, { id: String(x.id) }); });
    var recs = typeof window.recommendDishes === 'function'
      ? window.recommendDishes(menu, { viewedDishId: id, pairCounts: counts, recommendationsEnabled: true, hour: new Date().getHours(), limit: 3 }) : [];
    var bundle = restaurant && restaurant.bundles_enabled && typeof window.buildComboBundle === 'function'
      ? window.buildComboBundle(menu, { bundlesEnabled: true, discountPercent: Number(restaurant.bundle_discount_percent), viewedDishId: id, pairCounts: counts })
      : null;
    if (bundle && typeof window.limitSuggestionSlots === 'function') recs = window.limitSuggestionSlots(recs, true);
    var recsOff = restaurant && restaurant.recommendations_enabled === false;
    var together = Object.keys(counts).filter(function (k) { return k !== id && dishById(k) && counts[k] > 0; })
      .sort(function (a, b) { return counts[b] - counts[a]; }).slice(0, 5);
    var flavours = d.flavour || [];

    detail.innerHTML =
      '<div class="pair-hero">' + thumb(d) + '<div><p class="eyebrow">When a guest views</p><h2>' + esc(d.name) + '</h2>' +
        '<p class="hint">Suggestions also change with the time of day. This shows what guests see right now.</p></div></div>' +
      (recsOff ? '<div class="banner banner-info"><svg class="ic"><use href="#i-alert"/></svg><span>Suggestions are switched off, so guests see none. Turn on “Suggestions on the menu” above.</span></div>' : '') +
      '<h3 class="subhead">Guests are offered</h3>' +
      (recs.length ? '<div class="sugg-grid">' + recs.map(function (r) {
        var p = photoFor(r.dish), pct = Math.round(r.confidence * 100);
        return '<article class="sugg"><div class="sugg-media">' + (p ? '<img src="' + esc(sizedPhoto(p, 400)) + '" alt="" loading="lazy">' : esc(r.dish.icon || '🍽️')) + '</div>' +
          (r.reason ? '<span class="badge badge-plain reason">' + esc(r.reason) + '</span>' : '') +
          '<div class="sugg-body"><b>' + esc(r.dish.name) + '</b><span class="muted">' + money(r.dish.price) + ' · ' + esc(CATEGORY_LABEL[r.dish.category] || '') + '</span>' +
          '<div class="conf"><span>Match</span><i style="--w:' + pct + '%"></i><span class="num">' + pct + '%</span></div></div></article>';
      }).join('') + '</div>'
        : '<div class="empty empty-sm" style="margin-bottom:24px"><p>No strong pairing for this dish yet. Give dishes shared flavours, or mark one as Chef’s pick below.</p></div>') +
      (bundle ? '<div class="combo"><svg class="ic" aria-hidden="true"><use href="#i-pairings"/></svg><span>Combo offered: <b>' +
        bundle.items.map(function (x) { return esc(x.name); }).join(' + ') + '</b> for ' + money(bundle.total) + ' <span class="muted">(saves ' + money(bundle.savings) + ')</span></span></div>' : '') +
      '<h3 class="subhead">Ordered together most</h3>' +
      (together.length ? '<ul class="tune-list" style="margin-bottom:24px">' + together.map(function (k) {
        var x = dishById(k);
        return '<li>' + thumb(x) + '<div><div class="t-name">' + esc(x.name) + '</div><div class="t-meta">' + plural(counts[k], 'order') + ' together</div></div><span></span></li>';
      }).join('') + '</ul>'
        : '<p class="muted" style="font-size:13px;margin-bottom:24px">Not enough orders yet. Real pairings appear once dishes have been ordered together a few times.</p>') +
      '<section class="panel"><h3 class="subhead">Tune what is suggested</h3>' +
      '<p class="hint" style="margin-bottom:8px">Chef’s picks are suggested more often. Shared flavours make dishes pair up. Edit a dish to change its flavours.</p>' +
      '<ul class="tune-list">' + dishes.filter(function (x) { return x.id !== id; }).map(function (x) {
        var shared = (x.flavour || []).filter(function (f) { return flavours.indexOf(f) !== -1; });
        return '<li>' + thumb(x) + '<div><div class="t-name">' + esc(x.name) + (x.available ? '' : ' <span class="muted">· sold out</span>') + '</div>' +
          '<div class="t-meta">' + esc(CATEGORY_LABEL[x.category] || '') + (shared.length ? ' · shares ' + esc(shared.join(', ')) : (x.flavour || []).length ? ' · ' + esc(x.flavour.join(', ')) : ' · no flavours yet') + '</div></div>' +
          '<div class="tune-actions"><label class="switch"><input type="checkbox" data-pick-promote="' + esc(x.id) + '"' + (x.promote ? ' checked' : '') + ' aria-label="Chef’s pick: ' + esc(x.name) + '">' +
          '<span class="track" aria-hidden="true"></span><span>Chef’s pick</span></label>' +
          '<button class="icon-btn" type="button" data-pick-edit="' + esc(x.id) + '" aria-label="Edit ' + esc(x.name) + '"><svg class="ic"><use href="#i-edit"/></svg></button></div></li>';
      }).join('') + '</ul></section>';
  }
  $('pair-picker').addEventListener('click', function (e) {
    var b = e.target.closest('[data-pick]'); if (!b) return;
    pairSelected = b.getAttribute('data-pick');
    $$('[data-pick]', this).forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
    var id = pairSelected;
    loadPairCounts(id).then(function (c) { if (pairSelected === id) drawPairDetail(id, c); });
  });
  $('pair-detail').addEventListener('click', function (e) {
    var b = e.target.closest('[data-pick-edit]');
    if (b) openEditor(b.getAttribute('data-pick-edit'));
  });
  $('pair-detail').addEventListener('change', function (e) {
    var id = e.target.getAttribute('data-pick-promote'); if (!id) return;
    var on = e.target.checked;
    saveDish(id, { promote: on }).then(function (d) {
      toast(on ? d.name + ' is now a Chef’s pick' : d.name + ' is no longer a Chef’s pick', 'ok');
      renderDishes();
      loadPairCounts(pairSelected).then(function (c) { drawPairDetail(pairSelected, c); });
    }).catch(function (err) { e.target.checked = !on; toast('Could not save. ' + friendly(err), 'err'); });
  });

  [['recommendations-enabled', 'recommendations_enabled', 'Suggestions are on', 'Suggestions are off'],
   ['ai-recommendations-enabled', 'ai_recommendations_enabled', 'AI suggestions are on', 'AI suggestions are off'],
   ['bundles-enabled', 'bundles_enabled', 'Combo deals are on', 'Combo deals are off']].forEach(function (s) {
    $(s[0]).addEventListener('change', function () {
      var box = this, on = box.checked, patch = {}; patch[s[1]] = on;
      updateRestaurant(patch).then(function () { toast(on ? s[2] : s[3], 'ok'); })
        .catch(function (err) { box.checked = !on; toast('Could not change this. ' + friendly(err), 'err'); });
    });
  });
  $('combo-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var v = Number($('bundle-discount-percent').value);
    if ($('bundle-discount-percent').value === '' || !(v >= 0 && v <= 100)) { $('bundle-discount-percent').setAttribute('aria-invalid', 'true'); toast('Use a discount between 0 and 100%.', 'err'); return; }
    $('bundle-discount-percent').removeAttribute('aria-invalid');
    var btn = this.querySelector('button'); busy(btn, true);
    updateRestaurant({ bundle_discount_percent: Math.round(v * 100) / 100 })
      .then(function () { toast('Combo discount saved. The database applies it at checkout.', 'ok'); })
      .catch(function (err) { toast('Could not save. ' + friendly(err), 'err'); })
      .then(function () { busy(btn, false); });
  });

  /* ── Tables & QR codes ──────────────────────────────────────── */
  // Each table has a secret code (qr_key). Its QR code opens the menu as
  // index.html?table=5&k=<secret>, and the database only accepts a dine-in
  // order when the table and its secret match.
  function menuLinkFor(t) {
    var url = new URL('index.html', location.href);
    url.searchParams.set('table', t.label);
    url.searchParams.set('k', t.qr_key);
    return url.toString();
  }
  function qrModules(text) {
    var qr = window.qrcode(0, 'M'); qr.addData(text); qr.make();
    var n = qr.getModuleCount(), d = '';
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (qr.isDark(r, c)) d += 'M' + c + ' ' + r + 'h1v1h-1z';
    return { n: n, d: d };
  }
  function qrSvg(text, label) {
    if (typeof window.qrcode !== 'function') return '<p class="hint">The QR library did not load. Check your connection.</p>';
    var q = qrModules(text);
    return '<svg viewBox="0 0 ' + q.n + ' ' + q.n + '" shape-rendering="crispEdges" role="img" aria-label="' + esc(label) + '"><path d="' + q.d + '" fill="#1D1A16"/></svg>';
  }
  function newKey() {
    var bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.prototype.map.call(bytes, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }
  function byLabel(a, b) { return a.label.localeCompare(b.label, undefined, { numeric: true }); }
  function tableByLabel(label) { return tables.filter(function (x) { return x.label === label; })[0]; }

  function loadTables() {
    return db.from('restaurant_tables').select('*').then(function (res) {
      tablesLoaded = true;
      if (res.error) {
        $('tables-list').innerHTML = '<div class="empty full-row"><h3>Tables are not set up yet</h3><p>' + esc(friendly(res.error)) +
          '. Run supabase/phase1-dine-in.sql in Supabase first.</p></div>';
        return;
      }
      tables = res.data.sort(byLabel);
      renderTables(); renderOverview();
    });
  }
  function renderTables() {
    var accent = brandHex(), ink = inkFor(accent), name = restaurant ? restaurant.name : 'Your restaurant', logo = logoUrl();
    $('tables-list').innerHTML = tables.length ? tables.map(function (t) {
      var l = esc(t.label);
      return '<article class="qr-tile' + (t.active ? '' : ' off') + '" data-label="' + l + '" style="--qr-accent:' + accent + ';--qr-ink:' + ink + '">' +
        '<div class="qr-head"><b>Table ' + l + '</b>' +
          '<label class="switch"><input type="checkbox" data-table-act="active"' + (t.active ? ' checked' : '') + ' aria-label="Table ' + l + ' taking orders">' +
          '<span class="track" aria-hidden="true"></span><span>' + (t.active ? 'Taking orders' : 'Switched off') + '</span></label></div>' +
        '<div class="qr-card">' +
          '<span class="qr-mono" aria-hidden="true">' + (logo ? '<img src="' + esc(logo) + '" alt="">' : esc(initial(name))) + '</span>' +
          '<span class="qr-name">' + esc(name) + '</span><span class="qr-table">Table ' + l + '</span>' +
          '<div class="qr-code">' + qrSvg(menuLinkFor(t), 'QR code for table ' + t.label) + '</div>' +
          '<span class="qr-foot">Scan to see our menu in 3D</span>' +
        '</div>' +
        '<div class="qr-actions">' +
          '<button class="btn btn-sm" type="button" data-table-act="png"><svg class="ic"><use href="#i-download"/></svg>Download</button>' +
          '<button class="btn btn-sm" type="button" data-table-act="print"><svg class="ic"><use href="#i-print"/></svg>Print</button>' +
          '<button class="btn btn-sm btn-ghost" type="button" data-table-act="newkey"><svg class="ic"><use href="#i-refresh"/></svg>New code</button>' +
          '<button class="icon-btn danger" type="button" data-table-act="delete" aria-label="Delete table ' + l + '"><svg class="ic"><use href="#i-trash"/></svg></button>' +
        '</div></article>';
    }).join('') : '<div class="empty full-row"><div class="empty-art"><svg class="ic"><use href="#i-qr"/></svg></div><h3>Add your first table</h3>' +
      '<p>Each table gets its own branded QR card. Guests scan it to see your menu in 3D and order from their seat.</p></div>';
  }
  function updateTable(label, patch, done) {
    db.from('restaurant_tables').update(patch).eq('label', label).select().maybeSingle().then(function (res) {
      if (res.error || !res.data) { toast('Could not save the table. ' + (res.error ? friendly(res.error) : 'No permission.'), 'err'); loadTables(); return; }
      tables = tables.map(function (t) { return t.label === label ? res.data : t; });
      renderTables();
      if (done) done(res.data);
    });
  }

  // Printable card, drawn as one SVG so download and print match exactly.
  var logoDataCache = {};
  function logoData() {
    var url = logoUrl();
    if (!url) return Promise.resolve('');
    if (logoDataCache[url]) return Promise.resolve(logoDataCache[url]);
    return fetch(url).then(function (r) { if (!r.ok) throw new Error('logo'); return r.blob(); }).then(function (b) {
      return new Promise(function (resolve) {
        var fr = new FileReader();
        fr.onload = function () { logoDataCache[url] = fr.result; resolve(fr.result); };
        fr.onerror = function () { resolve(''); };
        fr.readAsDataURL(b);
      });
    }).catch(function () { return ''; });
  }
  function cardSvg(t, logo) {
    var accent = brandHex(), ink = inkFor(accent), name = esc(restaurant ? restaurant.name : 'Our menu');
    var q = qrModules(menuLinkFor(t)), scale = 640 / q.n;
    var serif = "Georgia, 'Times New Roman', serif", sans = "'Helvetica Neue', Helvetica, Arial, sans-serif";
    return '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600" viewBox="0 0 1200 1600">' +
      '<defs><clipPath id="lg"><circle cx="600" cy="230" r="78"/></clipPath></defs>' +
      '<rect width="1200" height="1600" fill="#FBF8F2"/>' +
      '<rect x="44" y="44" width="1112" height="1512" rx="32" fill="none" stroke="' + accent + '" stroke-width="3" opacity=".75"/>' +
      '<circle cx="600" cy="230" r="78" fill="' + accent + '"/>' +
      (logo ? '<image href="' + logo + '" x="522" y="152" width="156" height="156" preserveAspectRatio="xMidYMid slice" clip-path="url(#lg)"/>'
        : '<text x="600" y="258" text-anchor="middle" font-family="' + serif + '" font-size="80" fill="' + ink + '">' + esc(initial(restaurant && restaurant.name)) + '</text>') +
      '<text x="600" y="392" text-anchor="middle" font-family="' + serif + '" font-size="58" fill="#1D1A16">' + name + '</text>' +
      '<text x="600" y="452" text-anchor="middle" font-family="' + sans + '" font-size="26" font-weight="700" letter-spacing="9" fill="#6F675B">TABLE ' + esc(String(t.label).toUpperCase()) + '</text>' +
      '<rect x="260" y="510" width="680" height="680" rx="30" fill="#FFFFFF" stroke="#E7E1D6"/>' +
      '<g transform="translate(280 530) scale(' + scale.toFixed(4) + ')" shape-rendering="crispEdges"><path d="' + q.d + '" fill="#1D1A16"/></g>' +
      '<text x="600" y="1290" text-anchor="middle" font-family="' + serif + '" font-style="italic" font-size="46" fill="#3A342C">Scan to see our menu in 3D</text>' +
      '<text x="600" y="1352" text-anchor="middle" font-family="' + sans + '" font-size="26" fill="#6F675B">Then tap “View on table” on any dish</text>' +
      '<line x1="540" y1="1440" x2="660" y2="1440" stroke="' + accent + '" stroke-width="3"/>' +
      '</svg>';
  }
  function downloadCard(t, btn) {
    busy(btn, true);
    logoData().then(function (logo) {
      var img = new Image();
      img.onload = function () {
        var c = document.createElement('canvas'); c.width = 1200; c.height = 1600;
        c.getContext('2d').drawImage(img, 0, 0);
        c.toBlob(function (b) {
          busy(btn, false);
          if (!b) { toast('Could not create the image. Try Print instead.', 'err'); return; }
          var a = document.createElement('a');
          a.href = URL.createObjectURL(b); a.download = 'table-' + t.label + '-qr.png';
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
          toast('Table ' + t.label + ' card downloaded', 'ok');
        }, 'image/png');
      };
      img.onerror = function () { busy(btn, false); toast('Could not create the image. Try Print instead.', 'err'); };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(cardSvg(t, logo));
    });
  }
  function printCard(t) {
    var w = window.open('', '_blank');
    if (!w) { toast('Allow pop-ups to print QR cards', 'err'); return; }
    logoData().then(function (logo) {
      w.document.write('<!doctype html><meta charset="utf-8"><title>Table ' + esc(t.label) + ' QR card</title>' +
        '<style>@page{size:A6 portrait;margin:0}html,body{margin:0;height:100%}body{display:grid;place-items:center;background:#fff}' +
        'svg{width:100%;max-width:105mm;height:auto}</style>' + cardSvg(t, logo) +
        '<script>window.onload=function(){window.print();}<\/script>');
      w.document.close();
    });
  }

  $('table-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var input = $('table-label'), label = input.value.trim(), btn = this.querySelector('button[type=submit]');
    if (!/^[A-Za-z0-9_-]{1,20}$/.test(label)) {
      input.setAttribute('aria-invalid', 'true'); input.focus();
      toast(label ? 'Use letters, numbers, - or _ (up to 20).' : 'Enter a table number first.', 'err');
      return;
    }
    input.removeAttribute('aria-invalid');
    busy(btn, true);
    db.from('restaurant_tables').insert({ label: label }).select().maybeSingle().then(function (res) {
      busy(btn, false);
      if (res.error || !res.data) {
        toast(res.error && res.error.code === '23505' ? 'Table ' + label + ' already exists.' :
          'Could not add the table. ' + (res.error ? friendly(res.error) : 'No permission.'), 'err');
        return;
      }
      input.value = '';
      tables.push(res.data); tables.sort(byLabel); renderTables(); renderOverview();
      toast('Table ' + label + ' added. Download or print its card.', 'ok');
    });
  });
  $('tables-list').addEventListener('click', function (e) {
    var b = e.target.closest('[data-table-act]');
    if (!b || b.getAttribute('data-table-act') === 'active') return;
    var label = b.closest('.qr-tile').getAttribute('data-label'), t = tableByLabel(label);
    if (!t) return;
    var act = b.getAttribute('data-table-act');
    if (act === 'png') downloadCard(t, b);
    if (act === 'print') printCard(t);
    if (act === 'newkey' && confirm('Make a new QR code for table ' + label + '? The old printed card will stop working straight away.')) {
      updateTable(label, { qr_key: newKey() }, function () { toast('New code for table ' + label + '. Print its card again.', 'ok'); });
    }
    if (act === 'delete' && confirm('Delete table ' + label + '? Its QR card will stop working. Past orders are kept.')) {
      db.from('restaurant_tables').delete().eq('label', label).then(function (res) {
        if (res.error) { toast('Could not delete. ' + friendly(res.error), 'err'); return; }
        tables = tables.filter(function (x) { return x.label !== label; }); renderTables(); renderOverview();
        toast('Table ' + label + ' deleted', 'ok');
      });
    }
  });
  $('tables-list').addEventListener('change', function (e) {
    if (e.target.getAttribute('data-table-act') !== 'active') return;
    var label = e.target.closest('.qr-tile').getAttribute('data-label'), on = e.target.checked;
    updateTable(label, { active: on }, function () { toast(on ? 'Table ' + label + ' is taking orders' : 'Table ' + label + ' switched off', 'ok'); });
  });

  /* ── Settings ───────────────────────────────────────────────── */
  var settingsLogo = { file: null, preview: '', remove: false };
  $('swatches').innerHTML = SWATCHES.map(function (s) {
    return '<button type="button" class="swatch" style="--c:' + s[0] + '" data-swatch="' + s[0] + '" aria-pressed="false" aria-label="' + s[1] + '"></button>';
  }).join('');

  function currentColor() { var h = $('r-color-hex').value.trim(); if (h && h[0] !== '#') h = '#' + h; return h; }
  function fillSettings(r) {
    $('r-name').value = r.name || ''; $('r-tagline').value = r.tagline || ''; $('r-badge').value = r.badge || '';
    $('r-currency').value = r.currency || '£'; $('r-tax').value = +(Number(r.tax_rate) * 100).toFixed(2);
    var hex = hexOk(r.brand_color) ? r.brand_color.toUpperCase() : '#D4AF37';
    $('r-color').value = hex; $('r-color-hex').value = hex;
    if (settingsLogo.preview) URL.revokeObjectURL(settingsLogo.preview);
    settingsLogo = { file: null, preview: '', remove: false };
    setErr('r-name', ''); setErr('r-color-hex', '');
    var off = !upgrade.media;
    $('r-color').disabled = off; $('r-color-hex').disabled = off; $('logo-file').disabled = off;
    $$('.swatch').forEach(function (s) { s.disabled = off; });
    $('r-color-err').textContent = off ? 'Logo and brand colour need the database upgrade (' + UPGRADE_FILE + ').' : '';
    renderBrandPreview();
  }
  function renderBrandPreview() {
    var hex = hexOk(currentColor()) ? currentColor() : '#D4AF37';
    var logo = settingsLogo.preview || (settingsLogo.remove ? '' : logoUrl());
    var name = $('r-name').value.trim() || 'Your restaurant';
    var bp = $('brand-preview');
    bp.style.setProperty('--bp', hex); bp.style.setProperty('--bp-ink', inkFor(hex));
    $('bp-name').textContent = name; $('bp-tag').textContent = $('r-tagline').value.trim();
    setMono($('bp-mono'), name, logo);
    $('logo-preview').innerHTML = logo ? '<img src="' + esc(logo) + '" alt="">' : esc(initial(name));
    $('logo-remove').classList.toggle('hidden', !logo || !upgrade.media);
    $$('.swatch').forEach(function (s) { s.setAttribute('aria-pressed', String(s.getAttribute('data-swatch').toLowerCase() === hex.toLowerCase())); });
  }
  $('r-color').addEventListener('input', function () { $('r-color-hex').value = this.value.toUpperCase(); setErr('r-color-hex', ''); renderBrandPreview(); });
  $('r-color-hex').addEventListener('input', function () {
    var h = currentColor();
    if (hexOk(h)) { $('r-color').value = h; setErr('r-color-hex', ''); }
    renderBrandPreview();
  });
  $('r-color-hex').addEventListener('blur', function () { var h = currentColor(); if (upgrade.media) setErr('r-color-hex', h && !hexOk(h) ? 'Use a hex colour like #C8A96A.' : ''); });
  $('swatches').addEventListener('click', function (e) {
    var s = e.target.closest('[data-swatch]'); if (!s || s.disabled) return;
    $('r-color').value = s.getAttribute('data-swatch'); $('r-color-hex').value = s.getAttribute('data-swatch').toUpperCase();
    setErr('r-color-hex', ''); renderBrandPreview();
  });
  ['r-name', 'r-tagline'].forEach(function (f) { $(f).addEventListener('input', renderBrandPreview); });
  function stageLogo(f) {
    if (!upgrade.media) { toast('Logo upload needs the one-time database upgrade first.', 'err'); return; }
    if (!IMAGE_TYPES.test(f.type)) { toast('Use a PNG, JPG or WebP logo.', 'err'); return; }
    if (f.size > 10 * 1024 * 1024) { toast('This logo is over 10 MB. Choose a smaller file.', 'err'); return; }
    if (settingsLogo.preview) URL.revokeObjectURL(settingsLogo.preview);
    settingsLogo = { file: f, preview: URL.createObjectURL(f), remove: false };
    renderBrandPreview();
    $('info-status').className = 'status-text'; $('info-status').textContent = 'Save to publish your new logo.';
  }
  $('logo-file').addEventListener('change', function () { var f = this.files && this.files[0]; this.value = ''; if (f) stageLogo(f); });
  wireDrop(document.querySelector('[data-drop="logo"]'), stageLogo);
  $('logo-remove').addEventListener('click', function () {
    if (settingsLogo.preview) URL.revokeObjectURL(settingsLogo.preview);
    settingsLogo = { file: null, preview: '', remove: true };
    renderBrandPreview();
    $('info-status').className = 'status-text'; $('info-status').textContent = 'Save to remove the logo.';
  });

  $('info-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var st = $('info-status'), btn = $('info-save');
    setErr('r-name', $('r-name').value.trim() ? '' : 'Your restaurant needs a name.');
    var hex = currentColor();
    if (upgrade.media) setErr('r-color-hex', hexOk(hex) ? '' : 'Use a hex colour like #C8A96A.');
    var tax = Number($('r-tax').value);
    if ($('r-tax').value === '' || !(tax >= 0 && tax < 100)) $('r-tax').setAttribute('aria-invalid', 'true'); else $('r-tax').removeAttribute('aria-invalid');
    if (!$('r-currency').value.trim()) $('r-currency').setAttribute('aria-invalid', 'true'); else $('r-currency').removeAttribute('aria-invalid');
    var first = $('info-form').querySelector('[aria-invalid="true"]');
    if (first) { st.className = 'status-text err'; st.textContent = 'Check the highlighted fields.'; first.focus(); return; }
    var patch = {
      name: $('r-name').value.trim(), tagline: $('r-tagline').value.trim(), badge: $('r-badge').value.trim(),
      currency: $('r-currency').value.trim(), tax_rate: Math.round(tax * 100) / 10000
    };
    if (upgrade.media) patch.brand_color = hex.toUpperCase();
    busy(btn, true); st.className = 'status-text'; st.textContent = settingsLogo.file ? 'Uploading logo…' : 'Saving…';
    var step = settingsLogo.file ? uploadMedia('branding', 'logo', settingsLogo.file, 512).then(function (url) { patch.logo_url = url; }) : Promise.resolve();
    if (settingsLogo.remove && upgrade.media) patch.logo_url = '';
    step.then(function () { return updateRestaurant(patch); }).then(function (r) {
      fillSettings(r);
      st.className = 'status-text ok'; st.textContent = 'Saved. Your menu has been updated.';
      toast('Settings saved', 'ok');
    }).catch(function (err) {
      st.className = 'status-text err'; st.textContent = friendly(err);
    }).then(function () { busy(btn, false); });
  });

  route(true);
})();
