/* ════════════════════════════════════════════════════════════════
   MenuVision — diner experience layer (experience.js)

   Adds, on top of the existing menu (script.js, data.js, sensory.js):
     • a short welcome intro          • "My needs": a personal allergen check
     • dish detail bottom sheet       • a friendly AR guide before AR
     • in-page 3D viewer + compare    • mood chips, "Most viewed in AR"
     • "Pairs beautifully with…"      • a shareable card after AR

   It never changes AR itself. Every AR button keeps its own
   onclick="openAR(id)"; this file only shows a guide the first time and
   then calls that same window.openAR(id) from sensory.js.
   Allergy choices are saved through the original form and script.js, so
   storage and the recommendation safety rules stay exactly as they were.
   Wording rule: never say "safe" or "free from"; always point to staff.
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var MODEL_VERSION = '?v=25';               // keep in step with MODEL_VERSION in sensory.js
  var PREF_KEY = 'menuvision.safety-preferences.v1';
  var ua = navigator.userAgent;
  var isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var isPhone = isIOS || /Android/.test(ua);
  var reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* The 14 UK allergens, mapped to the tags dishes carry in the database.
     'shellfish' is an older tag that may mean either crustaceans or molluscs. */
  var UK = [
    { key: 'celery', label: 'Celery', tags: ['celery'] },
    { key: 'gluten', label: 'Cereals with gluten', name: 'gluten', tags: ['gluten', 'wheat'] },
    { key: 'crustaceans', label: 'Crustaceans', tags: ['crustaceans', 'shellfish'] },
    { key: 'eggs', label: 'Eggs', tags: ['eggs'] },
    { key: 'fish', label: 'Fish', tags: ['fish'] },
    { key: 'lupin', label: 'Lupin', tags: ['lupin'] },
    { key: 'milk', label: 'Milk', tags: ['dairy'] },
    { key: 'molluscs', label: 'Molluscs', tags: ['molluscs', 'shellfish'] },
    { key: 'mustard', label: 'Mustard', tags: ['mustard'] },
    { key: 'nuts', label: 'Tree nuts', tags: ['nuts'] },
    { key: 'peanuts', label: 'Peanuts', tags: ['peanuts'] },
    { key: 'sesame', label: 'Sesame', tags: ['sesame'] },
    { key: 'soya', label: 'Soya', tags: ['soy'] },
    { key: 'sulphites', label: 'Sulphites', tags: ['sulphites'] }
  ];
  var DIETS = [['veg', 'Vegetarian'], ['vegan', 'Vegan'], ['halal', 'Halal']];

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
  function hitsAny(list, tags) { return tags.some(function (t) { return has(list, t); }); }
  function photo(id) {
    var img = document.querySelector('.food-card[data-dish="' + id + '"] .card-media img');
    return img ? (img.currentSrc || img.src) : '';
  }
  function hasAr(id) { return !!document.querySelector('.food-card[data-dish="' + id + '"] .card-ar-btn'); }
  function restaurantName() { var h = $('r-name'); return h ? h.textContent.replace(/\s+/g, ' ').trim() : 'our restaurant'; }
  function store(kind) {
    return {
      get: function (k, d) { try { var v = window[kind].getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
      set: function (k, v) { try { window[kind].setItem(k, JSON.stringify(v)); } catch (e) {} }
    };
  }
  var local = store('localStorage'), session = store('sessionStorage');
  function toast(icon, msg, sub) { try { showToast(icon, msg, sub || '', 2600); } catch (e) {} }
  function kcalNumber(d) { var m = String(d.exactCalories || d.calories || '').match(/\d+/); return m ? Number(m[0]) : 0; }
  function spiceLevel(d) {
    var f = (d.flavour || []).map(String);
    if (has(f, 'very spicy') || has(f, 'extra hot') || has(f, 'fiery')) return 3;
    if (has(f, 'hot') || has(f, 'spicy') || has(f, 'chilli') || has(f, 'chili')) return 2;
    if (has(f, 'mild')) return 1;
    return 0;
  }
  function icon(name) { return '<svg aria-hidden="true"><use href="#' + (name.indexOf('a-') === 0 ? name : 'i-' + name) + '"/></svg>'; }
  function lower(s) { return s.charAt(0).toLowerCase() + s.slice(1); }

  /* ── Bottom sheets: one at a time, Esc / back button / swipe down ── */
  var openSheetEl = null, lastFocus = null, sheetFromHistory = false;
  function openSheet(el) {
    if (openSheetEl && openSheetEl !== el) closeSheet(true);
    lastFocus = document.activeElement;
    el.hidden = false;
    $('sheet-backdrop').hidden = false;
    requestAnimationFrame(function () { requestAnimationFrame(function () { el.classList.add('open'); $('sheet-backdrop').classList.add('open'); }); });
    document.body.classList.add('sheet-open');
    openSheetEl = el;
    try { history.pushState({ page: 'mv-sheet' }, ''); sheetFromHistory = true; } catch (e) { sheetFromHistory = false; }
    var focusTarget = el.querySelector('[data-autofocus]') || el.querySelector('.bsheet-close');
    if (focusTarget) setTimeout(function () { focusTarget.focus({ preventScroll: true }); }, 80);
  }
  function closeSheet(viaHistory) {
    var el = openSheetEl; if (!el) return;
    openSheetEl = null;
    el.classList.remove('open'); $('sheet-backdrop').classList.remove('open');
    setTimeout(function () { if (openSheetEl !== el) el.hidden = true; if (!openSheetEl) $('sheet-backdrop').hidden = true; }, reduceMotion ? 0 : 320);
    if (!$('cart-page').classList.contains('open')) document.body.classList.remove('sheet-open');
    if (el.id === 'view3d') stop3D();
    if (sheetFromHistory && viaHistory !== true) { sheetFromHistory = false; try { history.back(); } catch (e) {} }
    sheetFromHistory = false;
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
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
  (function () {                                       // swipe a sheet down by its top area to close
    var startY = 0, dy = 0, dragging = null;
    document.addEventListener('touchstart', function (e) {
      var grab = e.target.closest('.bsheet-grab, .bsheet-top');
      if (!grab || !openSheetEl || !openSheetEl.contains(grab)) return;
      var scroller = openSheetEl.querySelector('.bsheet-scroll');
      if (scroller && scroller.scrollTop > 0) return;
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

  /* ── 1. Welcome intro (under 1.5 s) ─────────────────────────── */
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
      setTimeout(function () { root.classList.remove('mv-welcome'); }, reduceMotion ? 0 : 300);
    };
    setTimeout(end, reduceMotion ? 600 : 1100);
    w.addEventListener('click', end);
  }

  /* ── 2. My needs: preferences, summary pill, gentle prompt ──── */
  function prefs() {
    var p = window.safetyPreferences || { allergens: [], dietary: [] };
    return { allergens: p.allergens || [], dietary: p.dietary || [] };
  }
  function prefsReady() { return window.safetyPreferencesReady !== false; }
  function chosenItems(p) {
    var a = p.allergens, explicitShell = has(a, 'crustaceans') || has(a, 'molluscs');
    return UK.filter(function (u) {
      if (has(a, u.tags[0])) return true;
      if (u.key === 'gluten' && has(a, 'wheat')) return true;
      if ((u.key === 'crustaceans' || u.key === 'molluscs') && has(a, 'shellfish') && !explicitShell) return true;
      return false;
    });
  }
  function needsSet() { var p = prefs(); return p.allergens.length > 0 || p.dietary.length > 0; }
  function needsSummary() {
    if (!prefsReady()) return 'Check';
    var p = prefs(), n = chosenItems(p).length, parts = [];
    if (n) parts.push(n + (n === 1 ? ' allergy' : ' allergies'));
    p.dietary.forEach(function (d) { var x = DIETS.filter(function (y) { return y[0] === d; })[0]; if (x) parts.push(x[1]); });
    return parts.length ? parts.join(' · ') : 'Not set';
  }
  function renderPill() {
    var v = needsSummary();
    $('needs-pill-value').textContent = v;
    $('needs-pill').classList.toggle('is-set', v !== 'Not set');
    $('needs-pill').setAttribute('aria-label', 'My needs: ' + v);
    var stored = false;
    try { stored = localStorage.getItem(PREF_KEY) !== null; } catch (e) {}
    var dismissed = local.get('mv-needs-prompt', '') === 'dismissed';
    var promptHidden = stored || dismissed || needsSet();
    $('needs-prompt').hidden = promptHidden;
    // The header chip appears once needs are set. If the prompt card is gone
    // (dismissed or cleared), the chip stays as the way back in.
    $('needs-pill').hidden = v === 'Not set' && !promptHidden;
  }
  $('needs-prompt-close').addEventListener('click', function () { local.set('mv-needs-prompt', 'dismissed'); renderPill(); });

  // Sheet: chips are buttons, so nothing is saved until "Save"
  function openNeeds() {
    var p = prefs(), chosen = chosenItems(p).map(function (u) { return u.key; });
    $('needs-allergens').innerHTML = UK.map(function (u) {
      var on = chosen.indexOf(u.key) !== -1;
      return '<button type="button" class="need-chip" data-need="' + u.key + '" aria-pressed="' + on + '">' + icon('a-' + u.key) + '<span>' + u.label + '</span></button>';
    }).join('');
    $('needs-diet').innerHTML = DIETS.map(function (d) {
      return '<button type="button" class="need-chip diet" data-diet="' + d[0] + '" aria-pressed="' + has(p.dietary, d[0]) + '">' + d[1] + '</button>';
    }).join('');
    openSheet($('needs-sheet'));
  }
  document.addEventListener('click', function (e) {
    if (e.target.closest('#needs-pill, [data-open-needs]')) { openNeeds(); return; }
    var chip = e.target.closest('#needs-sheet .need-chip');
    if (chip) chip.setAttribute('aria-pressed', String(chip.getAttribute('aria-pressed') !== 'true'));
    if (e.target.closest('#needs-clear')) $$('#needs-sheet .need-chip').forEach(function (c) { c.setAttribute('aria-pressed', 'false'); });
    if (e.target.closest('#needs-save')) saveNeeds();
  });
  function saveNeeds() {
    var tags = [];
    $$('#needs-allergens .need-chip[aria-pressed="true"]').forEach(function (c) {
      UK.filter(function (u) { return u.key === c.dataset.need; })[0].tags.forEach(function (t) { if (tags.indexOf(t) === -1) tags.push(t); });
    });
    var diets = $$('#needs-diet .need-chip[aria-pressed="true"]').map(function (c) { return c.dataset.diet; });
    // Fill the original form and let script.js save it the way it always has
    var inputs = $$('#safety-preferences [data-allergen]');
    inputs.forEach(function (i) { i.checked = tags.indexOf(i.dataset.allergen) !== -1; });
    $$('#safety-preferences [data-dietary-preference]').forEach(function (i) { i.checked = diets.indexOf(i.dataset.dietaryPreference) !== -1; });
    if (inputs[0]) inputs[0].dispatchEvent(new Event('change', { bubbles: true }));
    local.set('mv-needs-prompt', 'dismissed');
    closeSheet();
    refreshNeeds();
    var any = tags.length || diets.length;
    toast('✓', any ? 'Your needs are saved' : 'Needs cleared', any ? 'Each dish now shows a check. Always confirm with staff.' : '');
  }

  /* ── 3. Personal check for one dish ─────────────────────────── */
  function dishCheck(d) {
    if (!d || !needsSet()) return null;
    var p = prefs(), items = chosenItems(p);
    var contains = items.filter(function (u) { return hitsAny(d.allergens, u.tags); });
    var may = items.filter(function (u) { return !hitsAny(d.allergens, u.tags) && hitsAny(d.may_contain_allergens, u.tags); });
    var dietMiss = p.dietary.filter(function (n) { return !has(d.dietary, n); });
    var name = function (u) { return lower(u.name || u.label); };
    var dietName = function (n) { var x = DIETS.filter(function (y) { return y[0] === n; })[0]; return x ? x[1] : n; };
    if (contains.length) return { tone: 'bad', miss: true, text: 'Contains ' + contains.map(name).join(', ') };
    if (dietMiss.length) return { tone: 'warn', miss: true, text: 'Not marked ' + dietMiss.map(dietName).join(' or ') };
    if (may.length) return { tone: 'warn', miss: false, text: 'May contain ' + may.map(name).join(', ') + ' – ask staff' };
    if (items.length && d.allergen_info_verified !== true) return { tone: 'warn', miss: false, text: 'Allergen info not verified – ask staff' };
    if (items.length) return { tone: 'ok', miss: false, text: "Doesn't contain your allergens" };
    return { tone: 'ok', miss: false, text: 'Marked ' + p.dietary.map(dietName).join(' · ') };
  }
  function badgeHtml(c, big) {
    return '<p class="needs-badge ' + c.tone + (big ? ' big' : '') + '">' + icon(c.tone === 'ok' ? 'check' : 'alert') + '<span>' + escHtml(c.text) + '</span></p>';
  }

  // Badges on cards; dishes that don't match fade, move down and fold away
  var showMisses = {};
  function refreshNeeds() {
    renderPill();
    $$('.grid').forEach(function (grid, gi) {
      var cards = $$('.food-card[data-dish]', grid);
      cards.forEach(function (card, i) { if (!card.dataset.order) card.dataset.order = String(gi * 1000 + i); });
      var misses = 0;
      cards.forEach(function (card) {
        var c = dishCheck(dish(card.dataset.dish)), body = card.querySelector('.card-body');
        var old = card.querySelector('.needs-badge'); if (old) old.remove();
        card.classList.toggle('needs-miss', !!(c && c.miss));
        if (c && body) body.insertBefore(document.createRange().createContextualFragment(badgeHtml(c)), card.querySelector('.card-btns'));
        if (c && c.miss) misses++;
      });
      cards.sort(function (a, b) {
        var am = a.classList.contains('needs-miss') ? 1 : 0, bm = b.classList.contains('needs-miss') ? 1 : 0;
        return am - bm || Number(a.dataset.order) - Number(b.dataset.order);
      }).forEach(function (card) { grid.appendChild(card); });
      var key = grid.dataset.category || String(gi);
      grid.classList.toggle('fold-misses', misses > 0 && !showMisses[key]);
      var btn = grid.parentNode.querySelector('.needs-more');
      if (misses && !btn) {
        btn = document.createElement('button'); btn.type = 'button'; btn.className = 'needs-more';
        grid.parentNode.insertBefore(btn, grid.nextSibling);
      }
      if (btn) {
        btn.hidden = !misses;
        btn.dataset.grid = key;
        btn.setAttribute('aria-expanded', String(!!showMisses[key]));
        btn.textContent = showMisses[key] ? 'Hide dishes that don\'t match your needs'
          : 'Show all dishes (' + misses + ' more that ' + (misses === 1 ? "doesn't" : "don't") + ' match your needs)';
      }
    });
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('.needs-more'); if (!b) return;
    showMisses[b.dataset.grid] = !showMisses[b.dataset.grid];
    refreshNeeds();
  });
  window.addEventListener('storage', function (e) { if (e.key === PREF_KEY) setTimeout(refreshNeeds, 0); });

  /* ── 4. Cards: badges, detail entry, image skeleton ─────────── */
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
      if (chip) {
        if (spicy) { chip.innerHTML = new Array(spicy + 1).join(icon('chili')); chip.setAttribute('aria-label', ['', 'Mild', 'Spicy', 'Very spicy'][spicy]); chip.setAttribute('role', 'img'); }
        else chip.remove();
      }
    }
  }
  function enhanceAll() { $$('.food-card[data-dish]').forEach(enhanceCard); }
  // Tap anywhere on a card (except its buttons) to open the detail sheet
  document.addEventListener('click', function (e) {
    var o = e.target.closest('[data-open]');
    if (o) { openDetail(o.dataset.open); return; }
    var card = e.target.closest('.food-card');
    if (card && !e.target.closest('button, a, input, label')) openDetail(card.dataset.dish);
  });

  /* ── 5. Moods ───────────────────────────────────────────────── */
  var seen = local.get('mv-seen', []);
  var MOODS = {
    comfort: function (d) {
      return d.category !== 'drink' && ['creamy', 'cheesy', 'rich', 'savory', 'savoury', 'smoky', 'hearty', 'warm'].some(function (f) { return has(d.flavour, f); });
    },
    light: function (d) {
      var k = kcalNumber(d);
      return ['fresh', 'citrus', 'light', 'zesty', 'herby'].some(function (f) { return has(d.flavour, f); }) || d.category === 'side' || (k > 0 && k < 400);
    },
    share: function (d) { return /([2-9]|share|sharing|group)/i.test(String(d.serves || '') + ' ' + String(d.size || '')); },
    new: function (d, id) { return seen.indexOf(id) === -1; }
  };
  var mood = null;
  function applyMood() {
    var count = 0;
    $$('.food-card[data-dish]').forEach(function (card) {
      var id = card.dataset.dish, ok = !mood || MOODS[mood](dish(id) || {}, id);
      card.classList.toggle('is-filtered', !ok);
      if (ok) count++;
    });
    $$('.menu-section').forEach(function (s) {
      var any = s.querySelector('.food-card:not(.is-filtered)');
      s.classList.toggle('is-filtered', !any);
      var link = document.querySelector('.cat-link[href="#' + s.id + '"]');
      if (link) link.classList.toggle('is-filtered', !any);
    });
    $('filter-empty').hidden = !mood || count > 0;
    $('filter-status').textContent = mood ? (count ? count + (count === 1 ? ' dish' : ' dishes') + ' for this mood' : '') : '';
  }
  document.addEventListener('click', function (e) {
    var m = e.target.closest('[data-mood]');
    if (m) {
      mood = mood === m.dataset.mood ? null : m.dataset.mood;
      $$('[data-mood]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.mood === mood)); });
      applyMood();
    } else if (e.target.closest('[data-clear-filters]')) {
      mood = null; $$('[data-mood]').forEach(function (b) { b.setAttribute('aria-pressed', 'false'); }); applyMood();
    }
  });

  /* ── 6. Pairings (respect the diner's saved needs) ──────────── */
  function pairingsFor(id) {
    var d = dish(id);
    if (!d || window.recommendationsEnabled === false || typeof window.recommendDishes !== 'function') return [];
    var p = prefs(), counts = {};
    try { counts = popularPairCounts || {}; } catch (e) {}
    try {
      return window.recommendDishes(menuData, {
        viewedDishId: id, dietaryFilters: p.dietary, allergenFilters: p.allergens,
        safetyPreferencesReady: prefsReady(), pairCounts: counts, recommendationsEnabled: true, limit: 3
      }).filter(function (r) { return r.dish && r.dish.available !== false; }).slice(0, 3);
    } catch (e) { return []; }
  }
  function pairsHtml(id) {
    var list = pairingsFor(id);
    if (!list.length) return '';
    return '<section class="pairs" aria-label="Pairs beautifully with"><h3 class="pairs-h">Pairs beautifully with…</h3><ul class="pairs-list">' +
      list.map(function (r) {
        var p = photo(r.id);
        return '<li class="pair">' +
          '<span class="pair-thumb">' + (p ? '<img src="' + escHtml(p) + '" alt="" loading="lazy">' : escHtml(r.dish.icon || '🍽️')) + '</span>' +
          '<span class="pair-info"><b>' + escHtml(r.dish.name) + '</b><small>' + escHtml(r.reason || 'A natural match') + ' · ' + fmt(r.dish.price) + '</small></span>' +
          '<button type="button" class="pair-add" data-recommendation-add="' + escHtml(r.id) + '" aria-label="Add ' + escHtml(r.dish.name) + ' to order">' + icon('plus') + '</button>' +
          '</li>';
      }).join('') + '</ul></section>';
  }

  /* ── 7. Dish detail sheet ───────────────────────────────────── */
  function allergenGrid(d) {
    var mine = chosenItems(prefs()).map(function (u) { return u.key; });
    var verified = d.allergen_info_verified === true;
    $('ds-al-note').className = 'ds-al-note' + (verified ? '' : ' warn');
    $('ds-al-note').innerHTML = verified
      ? 'Highlighted: listed by the kitchen. Grey: not listed.'
      : icon('alert') + '<span>The kitchen hasn\'t verified this dish\'s allergens yet. Please ask staff.</span>';
    $('ds-al-grid').innerHTML = UK.map(function (u) {
      var state = hitsAny(d.allergens, u.tags) ? 'contains' : hitsAny(d.may_contain_allergens, u.tags) ? 'may' : 'none';
      var isMine = mine.indexOf(u.key) !== -1 && state !== 'none';
      var word = state === 'contains' ? 'Contains' : state === 'may' ? 'May contain' : 'Not listed';
      return '<li class="al-item ' + state + (isMine ? ' mine' : '') + '">' + icon('a-' + u.key) +
        '<span class="al-name">' + u.label + '</span><span class="al-state">' + word + (isMine ? ' · yours' : '') + '</span></li>';
    }).join('');
  }
  function factsHtml(d) {
    var rows = [];
    if (d.serves) rows.push(['people', 'Serves', escHtml(d.serves)]);
    var kcal = d.exactCalories || d.calories; if (kcal) rows.push(['flame', 'Energy', escHtml(kcal)]);
    if (d.weight) rows.push(['ruler', 'Portion', escHtml(d.weight)]);
    if (d.time) rows.push(['clock', 'Ready in', escHtml(d.time)]);
    var s = spiceLevel(d);
    rows.push(['chili', 'Spice', s ? new Array(s + 1).join(icon('chili')) + ' ' + ['', 'Mild', 'Spicy', 'Very spicy'][s] : 'Not spicy']);
    var diets = (d.dietary || []).map(function (n) { var x = DIETS.filter(function (y) { return y[0] === n; })[0]; return x ? x[1] : n; });
    if (diets.length) rows.push(['leaf', 'Dietary', escHtml(diets.join(' · '))]);
    return rows.map(function (r) { return '<div>' + icon(r[0]) + '<dt>' + r[1] + '</dt><dd>' + r[2] + '</dd></div>'; }).join('');
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
    $('ds-real').hidden = !d.size;
    $('ds-real').innerHTML = d.size ? icon('ruler') + '<span><b>Real size: ' + escHtml(d.size) + '</b>' + (hasAr(id) ? ', see it on your table' : '') + '</span>' : '';
    var check = dishCheck(d);
    $('ds-match').innerHTML = check ? badgeHtml(check, true) : '';
    $('ds-facts').innerHTML = factsHtml(d);
    allergenGrid(d);
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
    sheet.querySelector('.bsheet-scroll').scrollTop = 0;
    openSheet(sheet);
    try { if (typeof window.onDishViewed === 'function') window.onDishViewed(id); } catch (e) {}
  }
  function markSeen(id) { if (seen.indexOf(id) === -1) { seen.push(id); local.set('mv-seen', seen.slice(-100)); } }
  document.addEventListener('click', function (e) {          // after adding from a sheet, show the order bar
    if (e.target.closest('#ds-add,#aa-add') && openSheetEl) setTimeout(closeSheet, 250);
  });

  /* ── 8. AR: guide first, then the unchanged openAR() ────────── */
  var guideId = null, pendingAfter = null, lastDesktopDish = null;
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('.card-ar-btn');
    if (!btn) return;
    var holder = btn.closest('[data-dish]');
    var id = holder && holder.dataset.dish;
    if (!id) return;
    e.preventDefault(); e.stopPropagation();       // take over from the inline onclick so the guide can show first
    markSeen(id);
    if (isPhone && !session.get('mv-ar-guided', false)) { showGuide(id); return; }
    if (openSheetEl) closeSheet(true);              // no history.back(): it could race the AR hand-off
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
    if (e.target.closest('#ag-start')) { var id = guideId; closeSheet(true); launchAR(id); return; } // same tap: iPhone needs it
    if (e.target.closest('#ag-3d')) { session.set('mv-ar-guided', true); open3D([guideId]); return; }
    if (e.target.closest('#ag-compare')) { session.set('mv-ar-guided', true); open3D([guideId], true); return; }
    if (e.target.closest('#ds-3d')) open3D([detailId]);
  });
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
  document.addEventListener('pointerdown', function () {
    if (pendingAfter && Date.now() - pendingAfter.at > 6000) { pendingAfter.away = true; maybeAfterAR(); }
  }, true);
  var prevClose = window.closeViewer;              // desktop: the existing preview closes through closeViewer()
  if (typeof prevClose === 'function') {
    window.closeViewer = function () {
      var r = prevClose.apply(this, arguments);
      var id = lastDesktopDish; lastDesktopDish = null;
      if (id) setTimeout(function () { showAfter(id); }, 300);
      return r;
    };
  }

  /* ── 9. After AR: add, pairings, share card ─────────────────── */
  var afterId = null, shareBlob = null, shareUrl = null;
  function showAfter(id) {
    var d = dish(id); if (!d) return;
    afterId = id; shareBlob = null;
    $('after-ar').dataset.dish = id;
    $('aa-title').textContent = d.name;
    var add = $('aa-add'); add.dataset.dishAdd = id; add.disabled = d.available === false;
    add.querySelector('span').textContent = d.available === false ? 'Sold out' : 'Add to order · ' + fmt(d.price);
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
    }).catch(function () { $('aa-share-preview').innerHTML = ''; })
      .then(function () { $('aa-share').disabled = false; });
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
  function buildShareCard(id) {
    var d = dish(id), W = 1080, H = 1350;
    var c = document.createElement('canvas'); c.width = W; c.height = H;
    var ctx = c.getContext('2d');
    var accent = getComputedStyle(document.documentElement).getPropertyValue('--gold').trim() || '#8B6A30';
    var fontsReady = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    var src = (photo(id) || '').replace(/([?&])w=\d+/, '$1w=1200');
    return fontsReady.then(function () { return loadImage(src).catch(function () { return null; }); }).then(function (im) {
      ctx.fillStyle = '#FAF7F2'; ctx.fillRect(0, 0, W, H);
      var ph = 860;
      if (im) {
        var s = Math.max((W - 120) / im.naturalWidth, ph / im.naturalHeight);
        ctx.save(); ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(60, 60, W - 120, ph, 36); else ctx.rect(60, 60, W - 120, ph);
        ctx.clip();
        ctx.drawImage(im, 60 + (W - 120 - im.naturalWidth * s) / 2, 60 + (ph - im.naturalHeight * s) / 2, im.naturalWidth * s, im.naturalHeight * s);
        ctx.restore();
      }
      ctx.fillStyle = accent; ctx.fillRect(84, 990, 64, 4);
      ctx.fillStyle = '#1C1917';
      ctx.font = '500 58px Fraunces, Georgia, serif';
      var lines = wrap(ctx, 'I saw my ' + d.name + ' on the table before I ordered it.', W - 168).slice(0, 3);
      lines.forEach(function (l, i) { ctx.fillText(l, 84, 1075 + i * 70); });
      ctx.font = '600 28px Inter, Helvetica, Arial, sans-serif';
      ctx.fillStyle = '#7D5F2A';
      ctx.fillText(('at ' + restaurantName()).toUpperCase(), 84, Math.min(H - 60, 1075 + lines.length * 70 + 22));
      return new Promise(function (resolve, reject) {
        try { c.toBlob(function (b) { if (b) resolve(b); else reject(new Error('no blob')); }, 'image/jpeg', 0.9); }
        catch (e) { reject(e); }
      });
    });
  }
  function publicMenuUrl() { return location.origin + location.pathname; } // never share the table's secret code
  document.addEventListener('click', function (e) {
    if (!e.target.closest('#aa-share')) return;
    var d = dish(afterId); if (!d) return;
    var text = 'I saw my ' + d.name + ' on the table before I ordered it, at ' + restaurantName() + '.';
    var file = shareBlob && typeof File === 'function' ? new File([shareBlob], 'menuvision-' + afterId + '.jpg', { type: 'image/jpeg' }) : null;
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) navigator.share({ files: [file], text: text }).catch(function () {});
    else if (navigator.share) navigator.share({ title: restaurantName(), text: text, url: publicMenuUrl() }).catch(function () {});
    else if (shareBlob) {
      var a = document.createElement('a'); a.href = shareUrl; a.download = 'menuvision-' + afterId + '.jpg';
      document.body.appendChild(a); a.click(); a.remove();
      toast('✓', 'Image saved', 'Share it from your photos');
    }
  });

  /* ── 10. In-page 3D viewer and compare (AR fallback) ────────── */
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
    $('v3-note').textContent = ids.length === 2 ? 'Shown at true relative size. Drag either dish to turn it.' : 'Drag to turn, pinch to zoom.';
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

  /* ── 11. Sticky category bar: active highlight for every section ── */
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

  /* ── 12. "Most viewed in AR" (needs supabase/menu-experience-2026-11.sql) ── */
  function loadTopAr() {
    var cfg = window.MENU_CONFIG;
    // config.js → MENU_FLAGS.MOST_VIEWED_AR: off until the database function exists (no 404s).
    if ((window.MENU_FLAGS || {}).MOST_VIEWED_AR !== true) return;
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
  // config.js → MENU_FLAGS.MOOD_FILTER_MIN_DISHES: mood chips only on a bigger menu.
  function syncMoodRow() {
    var flags = window.MENU_FLAGS || {};
    var min = Number(flags.MOOD_FILTER_MIN_DISHES) || 0;
    var show = $$('.food-card[data-dish]').length >= min;
    var row = document.querySelector('.mood-row');
    if (row) row.hidden = !show;
    if (!show && mood) { mood = null; $$('[data-mood]').forEach(function (b) { b.setAttribute('aria-pressed', 'false'); }); }
  }
  function refresh() { enhanceAll(); refreshNeeds(); syncMoodRow(); applyMood(); watchSections(); }
  window.onMenuDataChanged = refresh;          // called by data.js after live menu updates
  // script.js re-reads preferences on change; refresh our badges right after it
  document.addEventListener('change', function (e) {
    if (e.target.matches('[data-allergen],[data-dietary-preference]')) setTimeout(refreshNeeds, 0);
  });
  welcome();
  refresh();
  loadTopAr();
})();
