/* ════════════════════════════════════════════════════════════════
   MenuVision — diner experience layer (experience.js)

   Adds, on top of the existing menu (script.js, data.js, sensory.js):
     • a short welcome intro            • dish detail bottom sheet
     • a friendly AR guide before AR    • in-page 3D viewer + dish compare
     • "Most viewed in AR" badges       • smart filters and moods
     • My Selection (hearted dishes)    • "Pairs beautifully with…" cards
     • a shareable card after viewing a dish in AR

   It never changes AR itself. Every AR button keeps its own
   onclick="openAR(id)"; this file only shows a guide the first time and
   then calls that same window.openAR(id) from sensory.js. If this file
   fails to load, the menu and AR keep working exactly as before.
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var MODEL_VERSION = '?v=25';               // keep in step with MODEL_VERSION in sensory.js
  var ua = navigator.userAgent;
  var isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var isPhone = isIOS || /Android/.test(ua);
  var reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── Small helpers ──────────────────────────────────────────── */
  function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt(n) { try { return money(n); } catch (e) { return '£' + Number(n).toFixed(2); } }
  function dish(id) { try { return menuData[id] || null; } catch (e) { return null; } }
  function allIds() { return $$('.food-card[data-dish]').map(function (c) { return c.dataset.dish; }); }
  function has(list, v) { return Array.isArray(list) && list.indexOf(v) !== -1; }
  function photo(id) {
    var img = document.querySelector('.food-card[data-dish="' + id + '"] .card-media img');
    return img ? (img.currentSrc || img.src) : '';
  }
  function hasAr(id) { return !!document.querySelector('.food-card[data-dish="' + id + '"] .card-ar-btn'); }
  function restaurantName() {
    var h = $('r-name'); return h ? h.textContent.replace(/\s+/g, ' ').trim() : 'our restaurant';
  }
  function store(kind) {
    return {
      get: function (k, d) { try { var v = window[kind].getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
      set: function (k, v) { try { window[kind].setItem(k, JSON.stringify(v)); } catch (e) {} }
    };
  }
  var local = store('localStorage'), session = store('sessionStorage');
  function toast(icon, msg, sub) { try { showToast(icon, msg, sub || '', 2400); } catch (e) {} }
  function kcalNumber(d) { var m = String(d.exactCalories || d.calories || '').match(/\d+/); return m ? Number(m[0]) : 0; }
  function spiceLevel(d) {
    var f = (d.flavour || []).map(String);
    if (has(f, 'very spicy') || has(f, 'extra hot') || has(f, 'fiery')) return 3;
    if (has(f, 'hot') || has(f, 'spicy') || has(f, 'chilli') || has(f, 'chili')) return 2;
    if (has(f, 'mild')) return 1;
    return 0;
  }
  function icon(name) { return '<svg aria-hidden="true"><use href="#i-' + name + '"/></svg>'; }

  /* ── Bottom sheets: one at a time, Esc / back button / swipe down ── */
  var openSheetEl = null, lastFocus = null, sheetFromHistory = false;
  function openSheet(el) {
    if (openSheetEl && openSheetEl !== el) closeSheet(true);
    lastFocus = document.activeElement;
    el.hidden = false;
    $('sheet-backdrop').hidden = false;
    requestAnimationFrame(function () { el.classList.add('open'); $('sheet-backdrop').classList.add('open'); });
    document.body.classList.add('sheet-open');
    openSheetEl = el;
    try { history.pushState({ page: 'mv-sheet' }, ''); sheetFromHistory = true; } catch (e) { sheetFromHistory = false; }
    var focusTarget = el.querySelector('[data-autofocus]') || el.querySelector('.bsheet-close');
    if (focusTarget) setTimeout(function () { focusTarget.focus({ preventScroll: true }); }, 60);
    layoutDock();
  }
  function closeSheet(viaHistory) {
    var el = openSheetEl; if (!el) return;
    openSheetEl = null;
    el.classList.remove('open'); $('sheet-backdrop').classList.remove('open');
    setTimeout(function () { if (openSheetEl !== el) el.hidden = true; if (!openSheetEl) $('sheet-backdrop').hidden = true; }, reduceMotion ? 0 : 260);
    if (!$('cart-page').classList.contains('open')) document.body.classList.remove('sheet-open');
    if (el.id === 'view3d') stop3D();
    if (sheetFromHistory && viaHistory !== true) { sheetFromHistory = false; try { history.back(); } catch (e) {} }
    sheetFromHistory = false;
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
    layoutDock();
  }
  window.addEventListener('popstate', function () { if (openSheetEl) { sheetFromHistory = false; closeSheet(true); } });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && openSheetEl) { e.preventDefault(); closeSheet(); }
    if (e.key === 'Tab' && openSheetEl) {             // keep focus inside the open sheet
      var f = $$('button:not([disabled]),[href],input,select,textarea,[tabindex]:not([tabindex="-1"])', openSheetEl)
        .filter(function (n) { return n.offsetParent !== null; });
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  });
  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-close-sheet]') || e.target.id === 'sheet-backdrop') closeSheet();
  });
  // Swipe a sheet down by its handle or header to close it
  (function () {
    var startY = 0, dy = 0, dragging = null;
    document.addEventListener('touchstart', function (e) {
      var grab = e.target.closest('.bsheet-grab, .bsheet-top');
      if (!grab || !openSheetEl || !openSheetEl.contains(grab)) return;
      dragging = openSheetEl; startY = e.touches[0].clientY; dy = 0;
      dragging.style.transition = 'none';
    }, { passive: true });
    document.addEventListener('touchmove', function (e) {
      if (!dragging) return;
      dy = Math.max(0, e.touches[0].clientY - startY);
      dragging.style.transform = 'translateY(' + dy + 'px)';
    }, { passive: true });
    document.addEventListener('touchend', function () {
      if (!dragging) return;
      var el = dragging; dragging = null;
      el.style.transition = ''; el.style.transform = '';
      if (dy > 90) closeSheet();
    });
  })();

  /* ── 1. Welcome intro ───────────────────────────────────────── */
  function welcome() {
    var root = document.documentElement, w = $('welcome');
    if (!w || !root.classList.contains('mv-welcome')) return;
    try { sessionStorage.setItem('mv-welcomed', '1'); } catch (e) {}
    var sync = function () {
      $('welcome-name').textContent = restaurantName();
      var mono = $('r-mono'); if (mono) $('welcome-mono').innerHTML = mono.innerHTML;
    };
    sync();
    var watch = new MutationObserver(sync);
    if ($('r-name')) watch.observe($('r-name'), { childList: true, subtree: true, characterData: true });
    if ($('r-mono')) watch.observe($('r-mono'), { childList: true, subtree: true });
    var done = false;
    var end = function () {
      if (done) return; done = true; watch.disconnect();
      w.classList.add('leaving');
      setTimeout(function () { root.classList.remove('mv-welcome'); }, reduceMotion ? 0 : 420);
    };
    setTimeout(end, reduceMotion ? 900 : 1750);
    w.addEventListener('click', end);
    document.addEventListener('keydown', function k(e) { if (e.key === 'Escape' || e.key === 'Enter') { end(); document.removeEventListener('keydown', k); } });
  }

  /* ── 2. Cards: badges, heart, detail entry, image skeleton ─── */
  var topAr = [];
  function enhanceCard(card) {
    var id = card.dataset.dish, d = dish(id), media = card.querySelector('.card-media');
    if (!d || !media) return;
    var badges = media.querySelector('.card-badges');
    if (!badges) { badges = document.createElement('div'); badges.className = 'card-badges'; media.appendChild(badges); }
    $$('.chef-pick-pill, .sold-pill', media).forEach(function (p) { if (p.parentNode !== badges) badges.appendChild(p); });
    var mv = badges.querySelector('.mv-badge'), isTop = topAr.indexOf(id) !== -1;
    if (isTop && !mv) { mv = document.createElement('span'); mv.className = 'mv-badge'; mv.innerHTML = icon('eye') + 'Most viewed in AR'; badges.appendChild(mv); }
    else if (!isTop && mv) mv.remove();

    if (!media.querySelector('.card-open')) {
      var open = document.createElement('button');
      open.type = 'button'; open.className = 'card-open'; open.dataset.open = id;
      media.insertBefore(open, media.firstChild);
    }
    media.querySelector('.card-open').setAttribute('aria-label', 'More about ' + d.name);

    var fav = media.querySelector('.card-fav');
    if (!fav) {
      fav = document.createElement('button'); fav.type = 'button'; fav.className = 'card-fav'; fav.dataset.fav = id;
      fav.innerHTML = icon('heart'); media.appendChild(fav);
    }
    var saved = isSaved(id);
    fav.setAttribute('aria-pressed', String(saved));
    fav.setAttribute('aria-label', (saved ? 'Remove ' : 'Save ') + d.name + (saved ? ' from' : ' to') + ' my selection');

    var img = media.querySelector('img');
    if (img && !img.dataset.mvWatched) {
      img.dataset.mvWatched = '1';
      if (!img.complete) {
        media.classList.add('is-loading');
        var clear = function () { media.classList.remove('is-loading'); };
        img.addEventListener('load', clear, { once: true });
        img.addEventListener('error', clear, { once: true });
      }
    }
    var spicy = spiceLevel(d), facts = card.querySelector('.card-facts');
    if (facts) {
      var chip = facts.querySelector('.card-spice');
      if (spicy && !chip) { chip = document.createElement('span'); chip.className = 'card-spice'; facts.appendChild(chip); }
      if (chip) { if (spicy) chip.textContent = new Array(spicy + 1).join('🌶'); else chip.remove(); }
      if (chip && spicy) chip.setAttribute('aria-label', ['', 'Mild', 'Spicy', 'Very spicy'][spicy]);
    }
  }
  function enhanceAll() { $$('.food-card[data-dish]').forEach(enhanceCard); }

  /* ── 3. Smart filters and moods ─────────────────────────────── */
  var FILTERS = {
    veg: function (d) { return has(d.dietary, 'veg') || has(d.dietary, 'vegan'); },
    vegan: function (d) { return has(d.dietary, 'vegan'); },
    gf: function (d) {
      return d.allergen_info_verified === true && !['gluten', 'wheat'].some(function (a) {
        return has(d.allergens, a) || has(d.may_contain_allergens, a);
      });
    },
    halal: function (d) { return has(d.dietary, 'halal'); },
    spicy: function (d) { return spiceLevel(d) >= 2; },
    under10: function (d) { return Number(d.price) < 10; }
  };
  var seen = local.get('mv-seen', []);
  var MOODS = {
    comfort: function (d) {
      return d.category !== 'drink' && ['creamy', 'cheesy', 'rich', 'savory', 'savoury', 'smoky', 'hearty', 'warm'].some(function (f) { return has(d.flavour, f); });
    },
    light: function (d) {
      var k = kcalNumber(d);
      return ['fresh', 'citrus', 'light', 'zesty', 'herby'].some(function (f) { return has(d.flavour, f); }) ||
        d.category === 'side' || (k > 0 && k < 400);
    },
    share: function (d) { return /([2-9]|share|sharing|group)/i.test(String(d.serves || '') + ' ' + String(d.size || '')); },
    new: function (d, id) { return seen.indexOf(id) === -1; }
  };
  var active = { filters: [], mood: null };

  function applyFilters() {
    var count = 0;
    $$('.food-card[data-dish]').forEach(function (card) {
      var id = card.dataset.dish, d = dish(id) || {};
      var ok = active.filters.every(function (f) { return FILTERS[f](d, id); }) && (!active.mood || MOODS[active.mood](d, id));
      card.classList.toggle('is-filtered', !ok);
      if (ok) count++;
    });
    $$('.menu-section').forEach(function (s) {
      var any = s.querySelector('.food-card:not(.is-filtered)');
      s.classList.toggle('is-filtered', !any);
      var link = document.querySelector('.cat-link[href="#' + s.id + '"]');
      if (link) link.classList.toggle('is-filtered', !any);
    });
    var on = active.filters.length || active.mood;
    $('filter-empty').hidden = !on || count > 0;
    $('filter-status').textContent = on ? (count ? count + (count === 1 ? ' dish matches' : ' dishes match') : 'No dishes match these choices') : '';
    $('filter-clear').hidden = !on;
  }
  function clearFilters() {
    active = { filters: [], mood: null };
    $$('[data-filter],[data-mood]').forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
    applyFilters();
  }
  document.addEventListener('click', function (e) {
    var f = e.target.closest('[data-filter]'), m = e.target.closest('[data-mood]');
    if (f) {
      var key = f.dataset.filter, i = active.filters.indexOf(key);
      if (i === -1) active.filters.push(key); else active.filters.splice(i, 1);
      f.setAttribute('aria-pressed', String(i === -1));
      applyFilters();
    } else if (m) {
      var mood = m.dataset.mood;
      active.mood = active.mood === mood ? null : mood;
      $$('[data-mood]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.mood === active.mood)); });
      applyFilters();
      if (active.mood) {
        var first = document.querySelector('.menu-section:not(.is-filtered)');
        if (first) first.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
      }
    } else if (e.target.closest('[data-clear-filters]')) clearFilters();
  });
  function refreshFilterLabels() {
    var u = document.querySelector('[data-filter="under10"]');
    if (u) { var c = (fmt(10).match(/^[^\d]*/) || ['£'])[0] || '£'; u.textContent = 'Under ' + c + '10'; }
  }

  /* ── 4. My Selection (hearted dishes) ───────────────────────── */
  var SEL_KEY = 'mv-selection';
  function selection() {
    var s = local.get(SEL_KEY, null);
    if (!s || !Array.isArray(s.ids) || Date.now() - (s.at || 0) > 8 * 3600 * 1000) return [];
    return s.ids.filter(function (id) { return dish(id); });
  }
  function isSaved(id) { return selection().indexOf(id) !== -1; }
  function setSelection(ids) { local.set(SEL_KEY, { ids: ids, at: Date.now() }); renderSelection(); }
  function toggleSaved(id) {
    var ids = selection(), i = ids.indexOf(id), d = dish(id);
    if (i === -1) { ids.push(id); toast('♥', 'Saved to your selection', d ? d.name : ''); }
    else { ids.splice(i, 1); toast('♡', 'Removed from your selection', d ? d.name : ''); }
    setSelection(ids);
    var btn = document.querySelector('.card-fav[data-fav="' + id + '"]');
    if (btn && !reduceMotion) { btn.classList.remove('pop'); void btn.offsetWidth; btn.classList.add('pop'); }
  }
  function renderSelection() {
    var ids = selection(), n = ids.length;
    $('fav-count').textContent = n;
    $('fav-fab').hidden = !n;
    $('fav-fab').setAttribute('aria-label', 'My selection, ' + n + (n === 1 ? ' dish' : ' dishes'));
    $$('[data-fav]').forEach(function (b) {
      var on = ids.indexOf(b.dataset.fav) !== -1, d = dish(b.dataset.fav);
      b.setAttribute('aria-pressed', String(on));
      if (d && b.classList.contains('card-fav')) b.setAttribute('aria-label', (on ? 'Remove ' : 'Save ') + d.name + (on ? ' from' : ' to') + ' my selection');
    });
    var total = 0;
    $('fav-list').innerHTML = ids.map(function (id) {
      var d = dish(id); total += Number(d.price) || 0;
      var p = photo(id);
      return '<li class="fav-item">' +
        '<span class="fav-thumb">' + (p ? '<img src="' + escHtml(p) + '" alt="" loading="lazy">' : escHtml(d.icon || '🍽️')) + '</span>' +
        '<span class="fav-info"><b>' + escHtml(d.name) + '</b><small>' + fmt(d.price) + (d.available === false ? ' · Sold out' : '') + '</small></span>' +
        '<button type="button" class="fav-remove" data-fav="' + escHtml(id) + '" aria-pressed="true" aria-label="Remove ' + escHtml(d.name) + '">' + icon('heart') + '</button>' +
        '</li>';
    }).join('');
    $('fav-total').textContent = n ? fmt(total) : '';
    $('fav-empty').hidden = n > 0;
    $('fav-actions').hidden = !n;
    $('waiter-list').innerHTML = ids.map(function (id) { return '<li>' + escHtml(dish(id).name) + '</li>'; }).join('');
    var table = window.orderingMode && window.orderingMode.status === 'ready' ? window.orderingMode.table : '';
    $('waiter-table').textContent = table ? 'Table ' + table : restaurantName();
    if (openSheetEl === $('fav-sheet') && !n) closeSheet();
    layoutDock();
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-fav]');
    if (b) { e.preventDefault(); toggleSaved(b.dataset.fav); return; }
    if (e.target.closest('#fav-fab')) { $('fav-sheet').classList.remove('waiter'); openSheet($('fav-sheet')); return; }
    if (e.target.closest('#fav-show')) { $('fav-sheet').classList.add('waiter'); $('waiter-back').focus(); return; }
    if (e.target.closest('#waiter-back')) { $('fav-sheet').classList.remove('waiter'); $('fav-show').focus(); return; }
    if (e.target.closest('#fav-order')) {
      var added = 0, skipped = 0;
      selection().forEach(function (id) {
        if (typeof addItemToCart === 'function' && isAvailable(id) && addItemToCart(id, 1)) added++;
        else skipped++;
      });
      closeSheet();
      if (added) toast('✓', added + (added === 1 ? ' dish' : ' dishes') + ' added to your order', skipped ? skipped + ' sold out' : 'Review it before sending');
      else toast('—', 'Nothing could be added', 'These dishes are sold out');
    }
  });

  // Keep the heart button clear of the order bar and live order pill
  function layoutDock() {
    var fab = $('fav-fab'); if (!fab) return;
    var cartVis = $('cart-bar').classList.contains('visible');
    var tracker = $('order-tracker'), trackVis = tracker && !tracker.hidden;
    var onMenu = $('menu-page').style.display !== 'none' && !$('cart-page').classList.contains('open') &&
      !$('order-success').classList.contains('open') && !openSheetEl;
    var bottom = 16 + (cartVis ? 76 : 0) + (trackVis ? 56 : 0);
    fab.style.bottom = 'calc(' + bottom + 'px + env(safe-area-inset-bottom, 0px))';
    fab.classList.toggle('away', !onMenu);
  }

  /* ── 5. Pairings ("Pairs beautifully with…") ────────────────── */
  function pairingsFor(id) {
    var d = dish(id);
    if (!d || window.recommendationsEnabled === false || typeof window.recommendDishes !== 'function') return [];
    var prefs = { allergens: [], dietary: [] }, ready = true, counts = {};
    try { prefs = safetyPreferences; ready = safetyPreferencesReady; } catch (e) {}
    try { counts = popularPairCounts || {}; } catch (e) {}
    try {
      return window.recommendDishes(menuData, {
        viewedDishId: id, dietaryFilters: prefs.dietary, allergenFilters: prefs.allergens,
        safetyPreferencesReady: ready, pairCounts: counts, recommendationsEnabled: true, limit: 3
      }).filter(function (r) { return r.dish && r.dish.available !== false; }).slice(0, 3);
    } catch (e) { return []; }
  }
  function pairsHtml(id) {
    var list = pairingsFor(id);
    if (!list.length) return '';
    return '<section class="pairs" aria-label="Pairs beautifully with"><p class="eyebrow">Pairs beautifully with</p><ul class="pairs-list">' +
      list.map(function (r) {
        var p = photo(r.id);
        return '<li class="pair">' +
          '<span class="pair-thumb">' + (p ? '<img src="' + escHtml(p) + '" alt="" loading="lazy">' : escHtml(r.dish.icon || '🍽️')) + '</span>' +
          '<span class="pair-info"><b>' + escHtml(r.dish.name) + '</b><small>' + escHtml(r.reason || 'A natural match') + ' · ' + fmt(r.dish.price) + '</small></span>' +
          '<button type="button" class="pair-add" data-recommendation-add="' + escHtml(r.id) + '" aria-label="Add ' + escHtml(r.dish.name) + ' to order">' + icon('plus') + '</button>' +
          '</li>';
      }).join('') + '</ul></section>';
  }

  /* ── 6. Dish detail sheet ───────────────────────────────────── */
  var ALLERGEN_LABEL = {
    celery: 'Celery', dairy: 'Dairy', eggs: 'Eggs', fish: 'Fish', gluten: 'Gluten', mustard: 'Mustard', nuts: 'Nuts',
    peanuts: 'Peanuts', sesame: 'Sesame', shellfish: 'Shellfish', soy: 'Soy', sulphites: 'Sulphites', wheat: 'Wheat'
  };
  var ALLERGEN_ICON = { gluten: 'grain', wheat: 'grain', dairy: 'drop', eggs: 'egg', fish: 'fish', shellfish: 'fish', nuts: 'nut', peanuts: 'nut', sesame: 'seed', soy: 'seed' };
  function allergensHtml(d) {
    var mine = [];
    try { mine = safetyPreferences.allergens || []; } catch (e) {}
    var chip = function (tag, kind) {
      var warn = mine.indexOf(tag) !== -1;
      return '<li class="al-chip' + (warn ? ' warn' : '') + (kind === 'may' ? ' may' : '') + '">' + icon(ALLERGEN_ICON[tag] || 'dot') +
        escHtml(ALLERGEN_LABEL[tag] || tag) + (warn ? '<span class="sr-only"> (one of your allergies)</span>' : '') + '</li>';
    };
    var contains = d.allergens || [], may = d.may_contain_allergens || [];
    var out = '<section class="ds-allergens" aria-label="Allergens">';
    if (contains.length) out += '<p class="ds-label">Contains</p><ul class="al-list">' + contains.map(function (t) { return chip(t); }).join('') + '</ul>';
    if (may.length) out += '<p class="ds-label">May contain</p><ul class="al-list">' + may.map(function (t) { return chip(t, 'may'); }).join('') + '</ul>';
    if (!contains.length && !may.length && d.allergen_info_verified === true) out += '<p class="ds-label">Allergens</p><p class="ds-note">No major allergens listed for this dish.</p>';
    var conflict = mine.filter(function (t) { return has(contains, t) || has(may, t); });
    if (conflict.length) out += '<p class="ds-alert" role="note">' + icon('alert') + '<span>Contains or may contain your allergy: ' + escHtml(conflict.map(function (t) { return ALLERGEN_LABEL[t] || t; }).join(', ')) + '.</span></p>';
    if (d.allergen_info_verified !== true) out += '<p class="ds-alert soft" role="note">' + icon('alert') + '<span>Allergen details are not verified yet. Please ask a member of staff.</span></p>';
    out += '<p class="ds-note">Always confirm allergies with staff before ordering.</p></section>';
    return out;
  }
  function factsHtml(d) {
    var rows = [];
    if (d.size) rows.push(['ruler', 'Real size', d.size]);
    if (d.serves) rows.push(['people', 'Serves', d.serves]);
    var kcal = d.exactCalories || d.calories; if (kcal) rows.push(['flame', 'Energy', kcal]);
    if (d.time) rows.push(['clock', 'Ready in', d.time]);
    var s = spiceLevel(d);
    rows.push(['chili', 'Spice', s ? ['', 'Mild', 'Spicy', 'Very spicy'][s] : 'Not spicy']);
    return rows.map(function (r) {
      return '<div>' + icon(r[0]) + '<dt>' + r[1] + '</dt><dd>' + escHtml(r[2]) + '</dd></div>';
    }).join('');
  }
  var detailId = null;
  function openDetail(id) {
    var d = dish(id); if (!d) return;
    detailId = id; markSeen(id);
    var sheet = $('dish-sheet'), p = photo(id);
    sheet.dataset.dish = id;
    $('ds-media').innerHTML = p ? '<img src="' + escHtml(p.replace(/([?&])w=\d+/, '$1w=1200')) + '" alt="' + escHtml(d.name) + '">' : '<span class="ds-ph" aria-hidden="true">' + escHtml(d.icon || '🍽️') + '</span>';
    var badges = [];
    if (d.promote) badges.push('<span class="chef-pick-pill">Chef\'s pick</span>');
    if (topAr.indexOf(id) !== -1) badges.push('<span class="mv-badge">' + icon('eye') + 'Most viewed in AR</span>');
    if (d.available === false) badges.push('<span class="sold-pill">Sold out</span>');
    $('ds-badges').innerHTML = badges.join('');
    $('ds-name').textContent = d.name;
    $('ds-price').textContent = fmt(d.price);
    $('ds-desc').textContent = d.desc || '';
    $('ds-facts').innerHTML = factsHtml(d);
    $('ds-allergen-box').innerHTML = allergensHtml(d);
    var ingredients = (d.ingredients || []).join(', ');
    $('ds-ingredients').hidden = !ingredients;
    $('ds-ingredients-text').textContent = ingredients;
    $('ds-pairs').innerHTML = pairsHtml(id);
    $('ds-ar').hidden = !hasAr(id);
    $('ds-3d').hidden = !hasAr(id);
    var add = $('ds-add');
    add.dataset.dishAdd = id;
    add.disabled = d.available === false;
    add.querySelector('span').textContent = d.available === false ? 'Sold out' : 'Add · ' + fmt(d.price);
    var fav = $('ds-fav'); fav.dataset.fav = id; fav.setAttribute('aria-pressed', String(isSaved(id)));
    fav.setAttribute('aria-label', 'Save ' + d.name + ' to my selection');
    sheet.querySelector('.bsheet-scroll').scrollTop = 0;
    openSheet(sheet);
    try { if (typeof window.onDishViewed === 'function') window.onDishViewed(id); } catch (e) {}
  }
  function markSeen(id) { if (seen.indexOf(id) === -1) { seen.push(id); local.set('mv-seen', seen.slice(-100)); } }
  document.addEventListener('click', function (e) {
    var o = e.target.closest('[data-open]');
    if (o) { openDetail(o.dataset.open); return; }
    var name = e.target.closest('.food-card .card-name');
    if (name) openDetail(name.closest('.food-card').dataset.dish);
  });
  // After adding from a sheet, close it so the order bar is visible
  document.addEventListener('click', function (e) {
    if (e.target.closest('#ds-add,#aa-add') && openSheetEl) setTimeout(closeSheet, 250);
  });

  /* ── 7. AR: guide first, then the unchanged openAR() ────────── */
  var guideId = null, pendingAfter = null, lastDesktopDish = null;
  function guideSeen() { return session.get('mv-ar-guided', false); }
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('.card-ar-btn');
    if (!btn) return;
    var holder = btn.closest('[data-dish]');
    var id = holder && holder.dataset.dish;
    if (!id) return;
    // Take over from the inline onclick so the guide can show first.
    e.preventDefault(); e.stopPropagation();
    markSeen(id);
    if (isPhone && !guideSeen()) { showGuide(id); return; }
    if (openSheetEl) closeSheet(true);   // no history.back(): it could race the AR hand-off
    launchAR(id);
  }, true);

  function showGuide(id) {
    var d = dish(id); guideId = id;
    $('ag-dish').textContent = d ? d.name : '';
    $('ag-size').textContent = d && d.size ? 'It appears at its real size: ' + d.size + '.' : 'It appears at its real size.';
    openSheet($('ar-guide'));
  }
  function launchAR(id) {
    session.set('mv-ar-guided', true);
    if (isPhone) pendingAfter = { id: id, at: Date.now(), away: false };
    else lastDesktopDish = id;
    if (typeof window.openAR === 'function') window.openAR(id);
  }
  document.addEventListener('click', function (e) {
    if (e.target.closest('#ag-start')) {
      // Call openAR inside this same tap: iPhone only opens AR Quick Look from a direct tap
      var id = guideId; closeSheet(true); launchAR(id); return;
    }
    if (e.target.closest('#ag-3d')) { session.set('mv-ar-guided', true); open3D([guideId]); return; }
    if (e.target.closest('#ag-compare')) { session.set('mv-ar-guided', true); open3D([guideId], true); return; }
    if (e.target.closest('#ds-3d')) open3D([detailId]);
  });

  // Spot the diner returning from Quick Look / Scene Viewer
  function maybeAfterAR() {
    if (!pendingAfter || !pendingAfter.away) return;
    var p = pendingAfter; pendingAfter = null;
    if (Date.now() - p.at > 20 * 60 * 1000) return;
    setTimeout(function () { showAfter(p.id); }, 350);
  }
  window.addEventListener('blur', function () { if (pendingAfter) pendingAfter.away = true; });
  window.addEventListener('pagehide', function () { if (pendingAfter) pendingAfter.away = true; });
  document.addEventListener('visibilitychange', function () {
    if (!pendingAfter) return;
    if (document.hidden) pendingAfter.away = true; else maybeAfterAR();
  });
  window.addEventListener('focus', maybeAfterAR);
  window.addEventListener('pageshow', maybeAfterAR);
  document.addEventListener('pointerdown', function () {     // Quick Look sometimes reports nothing
    if (pendingAfter && Date.now() - pendingAfter.at > 6000) { pendingAfter.away = true; maybeAfterAR(); }
  }, true);
  // Desktop: the existing turnable preview closes through closeViewer()
  var prevClose = window.closeViewer;
  if (typeof prevClose === 'function') {
    window.closeViewer = function () {
      var r = prevClose.apply(this, arguments);
      var id = lastDesktopDish; lastDesktopDish = null;
      if (id) setTimeout(function () { showAfter(id); }, 300);
      return r;
    };
  }

  /* ── 8. After AR: add, pairings, share card ─────────────────── */
  var afterId = null, shareBlob = null, shareUrl = null;
  function showAfter(id) {
    var d = dish(id); if (!d) return;
    afterId = id; shareBlob = null;
    $('after-ar').dataset.dish = id;
    $('aa-title').textContent = d.name;
    var add = $('aa-add'); add.dataset.dishAdd = id; add.disabled = d.available === false;
    add.querySelector('span').textContent = d.available === false ? 'Sold out' : 'Add to order · ' + fmt(d.price);
    var fav = $('aa-fav'); fav.dataset.fav = id; fav.setAttribute('aria-pressed', String(isSaved(id)));
    $('aa-pairs').innerHTML = pairsHtml(id);
    $('aa-share-preview').innerHTML = '<span class="skel-box" aria-hidden="true"></span>';
    $('aa-share').disabled = true;
    openSheet($('after-ar'));
    buildShareCard(id).then(function (blob) {
      if (afterId !== id) return;
      shareBlob = blob;
      if (shareUrl) URL.revokeObjectURL(shareUrl);
      shareUrl = URL.createObjectURL(blob);
      $('aa-share-preview').innerHTML = '<img src="' + shareUrl + '" alt="Share card: I saw my ' + escHtml(d.name) + ' on the table before I ordered it">';
    }).catch(function () {
      $('aa-share-preview').innerHTML = '';
    }).then(function () { $('aa-share').disabled = false; });
  }
  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      if (!src) return reject(new Error('no image'));
      var im = new Image(); im.crossOrigin = 'anonymous'; im.decoding = 'async';
      im.onload = function () { resolve(im); }; im.onerror = reject;
      im.src = src;
    });
  }
  function wrap(ctx, text, maxW) {
    var words = text.split(' '), lines = [], line = '';
    words.forEach(function (w) {
      var t = line ? line + ' ' + w : w;
      if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
    });
    if (line) lines.push(line);
    return lines;
  }
  function accentColour() {
    var v = getComputedStyle(document.documentElement).getPropertyValue('--gold').trim();
    return /^#|^rgb/.test(v) ? v : '#D4AF37';
  }
  function buildShareCard(id) {
    var d = dish(id), W = 1080, H = 1350;
    var c = document.createElement('canvas'); c.width = W; c.height = H;
    var ctx = c.getContext('2d'), accent = accentColour();
    var fontsReady = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    var src = (photo(id) || '').replace(/([?&])w=\d+/, '$1w=1200');
    return fontsReady.then(function () { return loadImage(src).catch(function () { return null; }); }).then(function (im) {
      ctx.fillStyle = '#14110F'; ctx.fillRect(0, 0, W, H);
      if (im) {
        var s = Math.max(W / im.naturalWidth, (H * 0.74) / im.naturalHeight);
        var w = im.naturalWidth * s, h = im.naturalHeight * s;
        ctx.drawImage(im, (W - w) / 2, 0, w, h);
      } else {
        ctx.font = '300px serif'; ctx.textAlign = 'center'; ctx.fillText(d.icon || '🍽️', W / 2, 560);
      }
      var g = ctx.createLinearGradient(0, H * 0.36, 0, H);
      g.addColorStop(0, 'rgba(20,17,15,0)'); g.addColorStop(0.45, 'rgba(20,17,15,.92)'); g.addColorStop(1, '#14110F');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.textAlign = 'left';
      ctx.fillStyle = accent; ctx.fillRect(84, 840, 72, 4);
      ctx.fillStyle = '#F4ECE0';
      ctx.font = '500 68px Fraunces, Georgia, serif';
      var lines = wrap(ctx, 'I saw my ' + d.name + ' on the table before I ordered it.', W - 168).slice(0, 4);
      lines.forEach(function (l, i) { ctx.fillText(l, 84, 940 + i * 82); });
      ctx.font = '600 32px Inter, Helvetica, Arial, sans-serif';
      ctx.fillStyle = accent;
      ctx.fillText(('at ' + restaurantName()).toUpperCase(), 84, Math.min(H - 110, 940 + lines.length * 82 + 36));
      ctx.font = '500 26px Inter, Helvetica, Arial, sans-serif';
      ctx.fillStyle = 'rgba(244,236,224,.6)';
      ctx.fillText('Seen in AR at its real size', 84, H - 56);
      return new Promise(function (resolve, reject) {
        try { c.toBlob(function (b) { if (b) resolve(b); else reject(new Error('no blob')); }, 'image/jpeg', 0.9); }
        catch (e) { reject(e); }   // a photo without CORS headers taints the canvas
      });
    });
  }
  function publicMenuUrl() { return location.origin + location.pathname; } // never share the table's secret code
  document.addEventListener('click', function (e) {
    if (!e.target.closest('#aa-share')) return;
    var d = dish(afterId); if (!d) return;
    var text = 'I saw my ' + d.name + ' on the table before I ordered it, at ' + restaurantName() + '.';
    var file = shareBlob && typeof File === 'function' ? new File([shareBlob], 'menuvision-' + afterId + '.jpg', { type: 'image/jpeg' }) : null;
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], text: text }).catch(function () {});
    } else if (navigator.share) {
      navigator.share({ title: restaurantName(), text: text, url: publicMenuUrl() }).catch(function () {});
    } else if (shareBlob) {
      var a = document.createElement('a'); a.href = shareUrl; a.download = 'menuvision-' + afterId + '.jpg';
      document.body.appendChild(a); a.click(); a.remove();
      toast('✓', 'Image saved', 'Share it from your photos');
    }
  });

  /* ── 9. In-page 3D viewer and compare (no AR needed) ────────── */
  var v3 = { ids: [] };
  function open3D(ids, chooseSecond) {
    v3.ids = ids.filter(Boolean).slice(0, 2);
    if (openSheetEl !== $('view3d')) openSheet($('view3d'));
    render3D(!!chooseSecond);
  }
  function stop3D() { $('v3-stage').innerHTML = ''; }
  function render3D(highlightPicker) {
    var ids = v3.ids, stage = $('v3-stage');
    $('v3-title').textContent = ids.length === 2 ? 'Compare dishes' : (dish(ids[0]) ? dish(ids[0]).name : '3D view');
    stage.className = 'v3-stage' + (ids.length === 2 ? ' two' : '');
    stage.innerHTML = ids.map(function (id) {
      var d = dish(id);
      return '<figure class="v3-cell" data-id="' + escHtml(id) + '">' +
        '<div class="v3-loading"><span class="spinner" aria-hidden="true"></span><span>Loading 3D…</span></div>' +
        '<model-viewer src="' + escHtml(id) + '.glb' + MODEL_VERSION + '" alt="3D model of ' + escHtml(d ? d.name : id) + '"' +
        ' camera-controls touch-action="pan-y" interaction-prompt="none" shadow-intensity="1" loading="eager"' +
        (ids.length === 2 ? ' disable-zoom field-of-view="28deg"' : ' auto-rotate auto-rotate-delay="600"') + '></model-viewer>' +
        '<figcaption><b>' + escHtml(d ? d.name : id) + '</b><span class="v3-size"></span></figcaption></figure>';
    }).join('');
    var dims = {};
    $$('model-viewer', stage).forEach(function (mv) {
      var cell = mv.closest('.v3-cell'), id = cell.dataset.id;
      mv.addEventListener('load', function () {
        cell.classList.add('ready');
        try {
          var s = mv.getDimensions(); dims[id] = s;
          cell.querySelector('.v3-size').textContent = Math.round(s.x * 100) + ' × ' + Math.round(s.z * 100) + ' cm';
        } catch (e) {}
        if (ids.length === 2 && Object.keys(dims).length === 2) {
          // Same camera distance and lens for both, so their sizes compare truthfully
          var r = Math.max.apply(null, ids.map(function (k) { var s = dims[k]; return Math.max(s.x, s.y, s.z); })) * 1.55;
          $$('model-viewer', stage).forEach(function (m) {
            m.cameraOrbit = '25deg 62deg ' + r.toFixed(3) + 'm';
            m.minCameraOrbit = 'auto auto ' + r.toFixed(3) + 'm';
            m.maxCameraOrbit = 'auto auto ' + r.toFixed(3) + 'm';
            m.fieldOfView = '28deg';
            if (m.jumpCameraToGoal) m.jumpCameraToGoal();
          });
        }
      });
      mv.addEventListener('error', function () {
        cell.classList.add('ready', 'failed');
        cell.querySelector('.v3-loading').textContent = 'This dish has no 3D model yet.';
      });
    });
    var others = allIds().filter(function (id) { return hasAr(id) && ids.indexOf(id) === -1; });
    $('v3-note').textContent = ids.length === 2 ? 'Shown at true relative size. Drag either dish to turn it.'
      : 'Drag to turn, pinch to zoom.';
    $('v3-picker-label').textContent = ids.length === 2 ? 'Swap the second dish' : 'Compare with another dish';
    $('v3-picker').innerHTML = others.map(function (id) {
      return '<button type="button" class="chip" data-compare="' + escHtml(id) + '">' + escHtml(dish(id).name) + '</button>';
    }).join('');
    $('v3-compare-box').hidden = !others.length;
    $('v3-compare-box').classList.toggle('highlight', !!highlightPicker);
    $('v3-ar').hidden = !isPhone || !hasAr(ids[0]);
    $('v3-ar').dataset.arFor = ids[0];
  }
  document.addEventListener('click', function (e) {
    var c = e.target.closest('[data-compare]');
    if (c) { v3.ids = [v3.ids[0], c.dataset.compare]; render3D(false); return; }
    var arBtn = e.target.closest('#v3-ar');
    if (arBtn) { var id = arBtn.dataset.arFor; closeSheet(true); launchAR(id); }
  });

  /* ── 10. Sticky category bar: active highlight for every section ── */
  var catObserver = null;
  function watchSections() {
    if (!('IntersectionObserver' in window)) return;
    if (catObserver) catObserver.disconnect();
    var bar = document.querySelector('.cats');
    catObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var link = document.querySelector('.cat-link[href="#' + en.target.id + '"]');
        if (!link) return;
        $$('.cat-link').forEach(function (a) {
          a.classList.toggle('active', a === link);
          if (a === link) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
        });
        if (bar && bar.scrollWidth > bar.clientWidth) bar.scrollTo({ left: Math.max(0, link.offsetLeft - 16), behavior: reduceMotion ? 'auto' : 'smooth' });
      });
    }, { rootMargin: '-40% 0px -55% 0px' });
    $$('.menu-section').forEach(function (s) { catObserver.observe(s); });
  }

  /* ── 11. "Most viewed in AR" (needs supabase/menu-experience-2026-11.sql) ── */
  function loadTopAr() {
    var cfg = window.MENU_CONFIG;
    if (!cfg || !cfg.supabaseUrl || /^YOUR_/.test(cfg.supabaseUrl) || typeof fetch !== 'function') return;
    fetch(cfg.supabaseUrl.replace(/\/+$/, '') + '/rest/v1/rpc/top_ar_dishes', {
      method: 'POST', headers: { 'content-type': 'application/json', apikey: cfg.supabaseAnonKey },
      body: JSON.stringify({ p_days: 14, p_limit: 2 })
    }).then(function (r) { return r.ok ? r.json() : []; }).then(function (rows) {
      topAr = (Array.isArray(rows) ? rows : []).map(function (r) { return typeof r === 'string' ? r : r && r.dish_id; }).filter(Boolean);
      enhanceAll();
    }).catch(function () {});
  }

  /* ── Wire up ────────────────────────────────────────────────── */
  function refresh() {
    enhanceAll(); applyFilters(); renderSelection(); refreshFilterLabels(); watchSections();
  }
  window.onMenuDataChanged = refresh;          // called by data.js after live menu updates
  welcome();
  refresh();
  loadTopAr();
  ['cart-bar', 'order-tracker', 'cart-page', 'order-success', 'menu-page'].forEach(function (id) {
    var el = $(id); if (el) new MutationObserver(layoutDock).observe(el, { attributes: true, attributeFilter: ['class', 'hidden', 'style'] });
  });
  layoutDock();
})();
