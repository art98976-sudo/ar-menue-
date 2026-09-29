/* ════════════════════════════════════════════════════════════════════
   MenuVision — SENSORY LAYER  (sensory.js)
   Load this LAST in index.html. It adds, without touching your other code:
     1. Realistic sound when the dish appears (made live with Web Audio,
        so there are no sound files to upload)
     2. Sensory description under the dish
     3. Living visuals: steam on hot dishes, gentle "breathing", real shadows
     4. Light haptic feedback when the food is tapped, dragged or pinched
     5. Clear instructions + loading screen with the dish name
     6. "Real size" badge and easy rotate buttons
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var mv = document.getElementById('ar-mv');
  if (!mv) return;

  var MODEL_VERSION = '?v=25'; // keep in step with your model cache number
  var SHOW_DESCRIPTION = false; // description card switched off

  // iPhone sound inside AR: add a dish here once you've made its .reality
  // file (Reality Composer) and uploaded it next to index.html, e.g. ['burger']
  var REALITY_FILES = [];

  /* ── 1. Dish content ─────────────────────────────────────────────── */
  var SENSORY = {
    burger: {
      text: 'Juicy double beef, melted cheddar dripping down the sides, crisp fresh lettuce and tomato. Smoky and rich.',
      tags: ['Smoky', 'Juicy', 'Crisp'],
      sound: 'sizzle', hot: true
    },
    pizza: {
      text: 'Blistered, crispy crust with bubbling mozzarella, sweet tomato and fresh basil. Warm and fragrant from the oven.',
      tags: ['Fresh from the oven', 'Cheesy', 'Crisp'],
      sound: 'oven', hot: true
    },
    drink: {
      text: 'Ice-cold and zesty. Freshly squeezed lemon, cool mint and a sharp twist of lime, with ice clinking in the glass.',
      tags: ['Ice-cold', 'Zesty', 'Refreshing'],
      sound: 'pour', hot: false
    },
    pasta: {
      text: 'Silky cream sauce clinging to every strand, with roasted garlic, fresh herbs and nutty parmesan. Rich and comforting.',
      tags: ['Creamy', 'Garlicky', 'Comforting'],
      sound: 'stir', hot: true
    },
    sushi: {
      text: 'Delicate rolls of soft seasoned rice and fresh fish, with a gentle kick of wasabi. Clean, light and cool.',
      tags: ['Fresh', 'Delicate', 'Light'],
      sound: 'plate', hot: false
    }
  };

  function dishName(id) {
    try { return (menuData[id] && menuData[id].name) || id; } catch (e) { return id; }
  }
  function dishIcon(id) {
    try { return (menuData[id] && menuData[id].icon) || '🍽️'; } catch (e) { return '🍽️'; }
  }

  /* ── 2. Styles ───────────────────────────────────────────────────── */
  var css = [
    '.sv-layer{position:absolute;z-index:5;font-family:inherit;color:#f5efe8}',
    '.sv-hide{opacity:0!important;pointer-events:none!important;transform:translateY(6px)}',

    /* loading screen */
    '#sv-loading{position:absolute;inset:0;z-index:20;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;background:#0f0e0d;transition:opacity .4s ease}',
    '#sv-loading .sv-icon{font-size:54px;animation:svBob 1.4s ease-in-out infinite}',
    '#sv-loading .sv-name{font-size:20px;font-weight:700;letter-spacing:.2px}',
    '#sv-loading .sv-sub{font-size:13px;color:#b8aea4}',
    '#sv-loading .sv-bar{width:170px;height:4px;border-radius:4px;background:#2b2623;overflow:hidden}',
    '#sv-loading .sv-fill{height:100%;width:0;background:#ff6b35;transition:width .2s ease}',

    /* sensory description */
    '#sv-desc{top:calc(env(safe-area-inset-top,0px) + 64px);left:14px;right:14px;max-width:520px;margin:0 auto;padding:14px 16px 12px;border-radius:18px;background:rgba(18,15,13,.78);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.08);transition:opacity .5s ease,transform .5s ease}',
    '#sv-desc .sv-kicker{font-size:11px;text-transform:uppercase;letter-spacing:1.6px;color:#ff9a6b;margin-bottom:6px}',
    '#sv-desc .sv-text{font-size:14.5px;line-height:1.5;margin:0}',
    '#sv-desc .sv-tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}',
    '#sv-desc .sv-tag{font-size:11.5px;padding:4px 10px;border-radius:100px;background:rgba(255,107,53,.16);color:#ffb08c}',
    '#sv-desc.sv-small .sv-text,#sv-desc.sv-small .sv-tags{display:none}',

    /* real size badge */
    '#sv-real{top:calc(env(safe-area-inset-top,0px) + 14px);left:50%;transform:translateX(-50%);padding:8px 16px;border-radius:100px;background:#ff6b35;color:#fff;font-size:13px;font-weight:700;box-shadow:0 6px 18px rgba(0,0,0,.35);transition:opacity .4s ease,transform .4s ease}',
    '#sv-real.sv-hide{transform:translateX(-50%) translateY(-6px)}',

    /* rotate + sound buttons */
    '#sv-rotate{right:12px;top:42%;display:flex;flex-direction:column;gap:10px}',
    '.sv-btn{width:46px;height:46px;border-radius:50%;border:1px solid rgba(255,255,255,.25);background:rgba(18,15,13,.72);color:#fff;font-size:20px;display:flex;align-items:center;justify-content:center;cursor:pointer;-webkit-tap-highlight-color:transparent}',
    '.sv-btn:active{transform:scale(.92)}',
    '#sv-sound{right:12px;top:calc(env(safe-area-inset-top,0px) + 12px);width:42px;height:42px;font-size:17px}',

    /* AR instructions (shown by model-viewer while it looks for the table) */
    '#sv-prompt{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:250px;padding:18px 18px 16px;border-radius:20px;text-align:center;background:rgba(18,15,13,.8);color:#fff}',
    '#sv-prompt .sv-phone{width:34px;height:56px;margin:0 auto 12px;border:3px solid #fff;border-radius:9px;animation:svScan 2s ease-in-out infinite}',
    '#sv-prompt .sv-big{font-size:17px;font-weight:700;margin-bottom:4px}',
    '#sv-prompt .sv-small{font-size:12.5px;color:#cfc6bd}',

    /* steam (anchored to the top of hot dishes) */
    '.sv-steam{width:1px;height:1px;pointer-events:none;border:none;background:none;padding:0}',
    '.sv-steam span{position:absolute;bottom:0;width:26px;height:26px;margin-left:-13px;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.55) 0%,rgba(255,255,255,0) 70%);opacity:0;animation:svSteam 3s ease-out infinite}',
    '.sv-steam span:nth-child(2){left:-12px;animation-delay:1s;width:22px;height:22px}',
    '.sv-steam span:nth-child(3){left:12px;animation-delay:2s;width:20px;height:20px}',

    '@keyframes svSteam{0%{opacity:0;transform:translateY(0) scale(.6)}20%{opacity:.8}100%{opacity:0;transform:translateY(-70px) scale(1.8)}}',
    '@keyframes svBob{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}',
    '@keyframes svScan{0%,100%{transform:translateX(-26px) rotate(-8deg)}50%{transform:translateX(26px) rotate(8deg)}}',
    '@media (prefers-reduced-motion:reduce){.sv-steam span,#sv-loading .sv-icon,#sv-prompt .sv-phone{animation:none}}'
  ].join('\n');
  var styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  /* ── 3. Build the overlay pieces (all inside model-viewer, so they also
         show during in-browser AR on Android) ───────────────────────── */
  function el(tag, attrs, html) {
    var n = document.createElement(tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (html) n.innerHTML = html;
    return n;
  }

  var loading = el('div', { id: 'sv-loading', 'class': 'sv-hide' },
    '<div class="sv-icon"></div><div class="sv-name"></div>' +
    '<div class="sv-sub">Preparing your dish…</div>' +
    '<div class="sv-bar"><div class="sv-fill"></div></div>');

  var desc = el('div', { id: 'sv-desc', 'class': 'sv-layer sv-hide' },
    '<div class="sv-kicker">Taste · Smell · Texture</div>' +
    '<p class="sv-text"></p><div class="sv-tags"></div>');

  var realBadge = el('div', { id: 'sv-real', 'class': 'sv-layer sv-hide' }, '📏 Real size');

  var rotate = el('div', { id: 'sv-rotate', 'class': 'sv-layer sv-hide' },
    '<button class="sv-btn" data-rot="-30" aria-label="Rotate left">⟲</button>' +
    '<button class="sv-btn" data-rot="30" aria-label="Rotate right">⟳</button>');

  var soundBtn = el('button', { id: 'sv-sound', 'class': 'sv-layer sv-btn sv-hide', 'aria-label': 'Sound on or off' }, '🔊');

  var prompt = el('div', { id: 'sv-prompt', slot: 'ar-prompt' },
    '<div class="sv-phone"></div>' +
    '<div class="sv-big">Point your phone at the table</div>' +
    '<div class="sv-small">Move it slowly side to side until your dish appears</div>');

  var steam = el('div', { 'class': 'sv-steam sv-hide', slot: 'hotspot-steam',
    'data-position': '0m 0.1m 0m', 'data-normal': '0m 1m 0m' },
    '<span></span><span></span><span></span>');

  [loading, desc, realBadge, rotate, soundBtn, prompt, steam].forEach(function (n) { mv.appendChild(n); });

  function show(n) { n.classList.remove('sv-hide'); }
  function hide(n) { n.classList.add('sv-hide'); }

  /* ── 4. Model-viewer settings: grounded shadows + in-browser AR first ── */
  mv.setAttribute('shadow-intensity', '1');
  mv.setAttribute('shadow-softness', '0.7');
  // webxr first = Android stays inside the web page, so sound, text, steam
  // and haptics keep working in AR. Scene Viewer / Quick Look are fallbacks.
  mv.setAttribute('ar-modes', 'webxr scene-viewer quick-look');
  mv.setAttribute('autoplay', ''); // plays any animation baked into a model

  /* ── 5. Sound (generated live — no files needed) ──────────────────── */
  var AC = window.AudioContext || window.webkitAudioContext;
  var ctx = null, soundOn = true, bus = null;

  function unlockAudio() {
    if (!AC) return;
    try {
      if (!ctx) ctx = new AC();
      if (ctx.state === 'suspended') ctx.resume();
    } catch (e) {}
  }
  // Browsers only allow sound after a tap — unlock on the first one.
  document.addEventListener('pointerdown', unlockAudio, true);
  document.addEventListener('touchstart', unlockAudio, true);

  function noiseBuffer(seconds, fill) {
    var len = Math.floor(ctx.sampleRate * seconds);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    fill(d, ctx.sampleRate);
    return buf;
  }
  function out(vol, t0, dur) {
    var g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.08);
    g.gain.setValueAtTime(vol, t0 + dur - 0.5);
    g.gain.linearRampToValueAtTime(0, t0 + dur);
    g.connect(bus);
    return g;
  }
  function tone(freq, t0, dur, vol) {
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(bus);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  var SOUNDS = {
    // burger: crackling fat on a hot grill
    sizzle: function (t) {
      var dur = 2.4;
      var src = ctx.createBufferSource();
      src.buffer = noiseBuffer(dur, function (d, sr) {
        var pop = 0;
        for (var i = 0; i < d.length; i++) {
          if (Math.random() < 0.0009) pop = 0.9 * Math.random();
          pop *= 0.985;
          d[i] = (Math.random() * 2 - 1) * (0.12 + pop);
        }
      });
      var hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2200;
      src.connect(hp); hp.connect(out(0.5, t, dur));
      src.start(t);
    },
    // lemonade: pouring, then ice clinks
    pour: function (t) {
      var dur = 1.5;
      var src = ctx.createBufferSource();
      src.buffer = noiseBuffer(dur, function (d) {
        for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      });
      var bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 3;
      bp.frequency.setValueAtTime(700, t);
      bp.frequency.linearRampToValueAtTime(1700, t + dur);
      src.connect(bp); bp.connect(out(0.35, t, dur));
      src.start(t);
      [1.55, 1.75, 2.05].forEach(function (s, i) {
        tone(2600 + i * 450, t + s, 0.35, 0.12);
        tone(3900 + i * 300, t + s, 0.2, 0.05);
      });
    },
    // pizza: soft warm oven rumble
    oven: function (t) {
      var dur = 2.4;
      var src = ctx.createBufferSource();
      src.buffer = noiseBuffer(dur, function (d) {
        var last = 0;
        for (var i = 0; i < d.length; i++) {
          last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; // brown noise
          d[i] = last * 3.5;
        }
      });
      var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
      src.connect(lp); lp.connect(out(0.6, t, dur));
      src.start(t);
      tone(110, t + 0.05, 0.25, 0.08); // gentle tray "thunk"
    },
    // pasta: slow creamy stir
    stir: function (t) {
      var dur = 2.4;
      var src = ctx.createBufferSource();
      src.buffer = noiseBuffer(dur, function (d, sr) {
        for (var i = 0; i < d.length; i++) {
          var swirl = 0.5 + 0.5 * Math.sin(2 * Math.PI * 1.6 * (i / sr));
          d[i] = (Math.random() * 2 - 1) * swirl;
        }
      });
      var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
      src.connect(lp); lp.connect(out(0.4, t, dur));
      src.start(t);
    },
    // sushi: light ceramic plate set down
    plate: function (t) {
      tone(150, t, 0.12, 0.12);
      tone(1850, t + 0.01, 0.6, 0.1);
      tone(2780, t + 0.01, 0.45, 0.06);
      tone(4150, t + 0.01, 0.3, 0.03);
    }
  };

  function stopSound() {
    if (bus) { try { bus.disconnect(); } catch (e) {} bus = null; }
  }

  function playDishSound(id) {
    if (!soundOn || !ctx || !SENSORY[id]) return;
    try {
      if (ctx.state === 'suspended') ctx.resume();
      stopSound();
      bus = ctx.createGain();
      bus.connect(ctx.destination);
      SOUNDS[SENSORY[id].sound](ctx.currentTime + 0.05);
    } catch (e) {}
  }

  soundBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    soundOn = !soundOn;
    soundBtn.textContent = soundOn ? '🔊' : '🔇';
    if (soundOn) playDishSound(currentDish); else stopSound();
  });

  /* ── 6. Haptics (Android — iPhone browsers don't allow vibration) ──── */
  var lastBuzz = 0;
  function buzz(pattern, gap) {
    if (!navigator.vibrate) return;
    var now = Date.now();
    if (now - lastBuzz < (gap || 120)) return;
    lastBuzz = now;
    try { navigator.vibrate(pattern); } catch (e) {}
  }
  mv.addEventListener('touchstart', function (e) {
    if (e.touches.length === 2) buzz([12, 40, 12], 200);   // pinch starts
    else buzz(10, 150);                                    // tap / drag starts
  }, { passive: true });
  mv.addEventListener('touchmove', function (e) {
    if (e.touches.length === 2) buzz(6, 180);              // light ticks while pinching
  }, { passive: true });

  /* ── 7. Rotate buttons ───────────────────────────────────────────── */
  var yaw = 0;
  rotate.addEventListener('click', function (e) {
    var b = e.target.closest('[data-rot]');
    if (!b) return;
    e.stopPropagation();
    yaw += parseFloat(b.getAttribute('data-rot'));
    mv.setAttribute('orientation', '0deg 0deg ' + yaw + 'deg');
    buzz(8, 60);
  });

  /* ── 8. Living visuals: steam + gentle breathing ─────────────────── */
  var breathing = false, lastScaleSet = 0;
  var reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  function placeSteam(id) {
    if (!SENSORY[id] || !SENSORY[id].hot) { hide(steam); return; }
    try {
      var dims = mv.getDimensions();
      var h = Math.max(0.03, dims.y * 0.9);
      mv.updateHotspot({ name: 'hotspot-steam', position: '0m ' + h.toFixed(3) + 'm 0m' });
    } catch (e) {}
    show(steam);
  }

  function breathe(ts) {
    if (!breathing) return;
    requestAnimationFrame(breathe);
    if (ts - lastScaleSet < 80) return;          // ~12 updates a second is plenty
    lastScaleSet = ts;
    var s = 1 + 0.012 * Math.sin(ts / 1000 * 2 * Math.PI / 3.5); // slow 3.5s breath
    mv.setAttribute('scale', s.toFixed(4) + ' ' + s.toFixed(4) + ' ' + s.toFixed(4));
  }
  function startBreathing() {
    if (reduceMotion || breathing) return;
    breathing = true;
    requestAnimationFrame(breathe);
  }
  function stopBreathing() {
    breathing = false;
    mv.setAttribute('scale', '1 1 1');
  }

  /* ── 9. Description card ─────────────────────────────────────────── */
  function fillDesc(id) {
    var s = SENSORY[id];
    if (!s || !SHOW_DESCRIPTION) { hide(desc); return; }
    desc.querySelector('.sv-text').textContent = s.text;
    desc.querySelector('.sv-tags').innerHTML = s.tags.map(function (t) {
      return '<span class="sv-tag">' + t + '</span>';
    }).join('');
    desc.classList.remove('sv-small');
  }
  desc.addEventListener('click', function (e) {   // tap to fold / unfold
    e.stopPropagation();
    desc.classList.toggle('sv-small');
  });

  var realTimer = null;
  function flashRealSize() {
    show(realBadge);
    clearTimeout(realTimer);
    realTimer = setTimeout(function () { hide(realBadge); }, 3500);
  }

  /* ── 10. The moment the dish appears ─────────────────────────────── */
  var currentDish = null;

  function dishAppeared() {
    if (!currentDish) return;
    hide(loading);
    fillDesc(currentDish);
    if (SHOW_DESCRIPTION) show(desc);
    show(rotate); show(soundBtn);
    placeSteam(currentDish);
    startBreathing();
    playDishSound(currentDish);
    buzz([20, 40, 20], 0);
  }

  mv.addEventListener('progress', function (e) {
    var p = e.detail && e.detail.totalProgress;
    if (typeof p === 'number') loading.querySelector('.sv-fill').style.width = Math.round(p * 100) + '%';
  });
  mv.addEventListener('load', function () { dishAppeared(); });

  // AR session events (Android in-browser AR)
  mv.addEventListener('ar-status', function (e) {
    var status = e.detail && e.detail.status;
    if (status === 'session-started') {
      hide(desc); hide(steam); hide(realBadge);    // instructions take over
    } else if (status === 'object-placed') {
      if (SHOW_DESCRIPTION) show(desc);
      placeSteam(currentDish);
      flashRealSize();
      playDishSound(currentDish);
      buzz([20, 40, 20], 0);
    } else if (status === 'not-presenting') {
      if (SHOW_DESCRIPTION) show(desc);
      placeSteam(currentDish);
    } else if (status === 'failed') {
      var m = document.getElementById('ar-msg');
      if (m) m.textContent = 'AR could not start on this phone — you can still turn the dish here.';
    }
  });

  /* ── 11. New openAR — shows the sensory preview, then "Place on your table" ── */
  window.openAR = function (id) {
    unlockAudio();

    var ua = navigator.userAgent;
    var iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    // iPhone AR only works from Safari — move other iOS browsers across
    if (iOS && /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua)) {
      var target = location.href.split('#')[0], jumped = false;
      var t = setTimeout(function () {
        if (!jumped) alert('Please open this page in Safari to view dishes on your table.');
      }, 1200);
      window.addEventListener('pagehide', function () { jumped = true; clearTimeout(t); });
      location.href = 'x-safari-' + target;
      return;
    }

    var android = /Android/.test(ua);
    var base = location.href.split('#')[0].split('?')[0].replace(/[^/]*$/, '');

    // iPhone: straight into the camera with AR Quick Look
    if (iOS) {
      playDishSound(id); // experiment: may keep playing as Quick Look opens
      var useReality = REALITY_FILES.indexOf(id) !== -1;
      var file = base + id + (useReality ? '.reality' : '.usdz') + MODEL_VERSION;
      if (window.__arLink) {
        window.__arLink.href = file + '#allowsContentScaling=0';
        window.__arLink.click();
      } else {
        location.href = file;
      }
      return;
    }

    // Android: straight into the camera with Google Scene Viewer
    if (android) {
      buzz([20, 40, 20], 0);
      var glb = base + id + '.glb' + MODEL_VERSION;
      location.href = 'intent://arvr.google.com/scene-viewer/1.0?file='
        + encodeURIComponent(glb)
        + '&mode=ar_only&resizable=false&title=' + encodeURIComponent(dishName(id))
        + '#Intent;scheme=https;package=com.google.ar.core;'
        + 'action=android.intent.action.VIEW;'
        + 'S.browser_fallback_url=' + encodeURIComponent(location.href) + ';end;';
      return;
    }

    // Laptop / desktop (no AR camera): turnable preview
    currentDish = id;
    try { currentModel = id; viewerMode = 'ar'; } catch (e) {}
    try { if (typeof stopRendering === 'function') stopRendering(); } catch (e) {}
    try { if (typeof updateViewerUI === 'function') updateViewerUI(id); } catch (e) {}

    var v3 = document.getElementById('viewer-3d'); if (v3) v3.style.display = 'none';
    var va = document.getElementById('viewer-ar'); if (va) va.style.display = 'block';
    var back = document.getElementById('back-btn'); if (back) back.classList.add('visible');

    // loading screen with the dish name
    loading.querySelector('.sv-icon').textContent = dishIcon(id);
    loading.querySelector('.sv-name').textContent = dishName(id);
    loading.querySelector('.sv-fill').style.width = '0%';
    hide(desc); hide(steam); hide(realBadge); hide(rotate); hide(soundBtn);
    stopBreathing();
    yaw = 0; mv.setAttribute('orientation', '0deg 0deg 0deg');

    var src = id + '.glb' + MODEL_VERSION;
    mv.dataset.dish = id;
    mv.setAttribute('ios-src', id + '.usdz' + MODEL_VERSION);

    if (mv.getAttribute('src') !== src) {
      show(loading);
      mv.setAttribute('src', src);             // 'load' event fires dishAppeared()
    } else {
      dishAppeared();                          // same dish again — already loaded
    }

    try { history.pushState({ page: 'ar' }, ''); } catch (e) {}
  };

  /* ── 12. Clean up when leaving the dish ──────────────────────────── */
  var prevClose = window.closeViewer;
  window.closeViewer = function () {
    stopBreathing();
    hide(desc); hide(steam); hide(realBadge); hide(rotate); hide(soundBtn); hide(loading);
    currentDish = null;
    stopSound();
    if (typeof prevClose === 'function') return prevClose.apply(this, arguments);
  };
})();
