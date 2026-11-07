/* ════════════════════════════════════════════════════════════════
   Anonymous menu analytics for the owner dashboard's Overview.

   Counts three things, with no cookies and no personal data:
     • menu_view  — the menu was opened (once per browser tab session)
     • ar_view    — a "View on table" button was tapped (with the dish id)
     • rec_click  — a recommendation or combo was added (with the dish id)

   It only listens to clicks; it never calls or changes openAR(), so AR
   behaves exactly as before. Needs supabase/dashboard-upgrade-2026-11.sql;
   until that has been run, sends fail silently and nothing else changes.
   ════════════════════════════════════════════════════════════════ */
(function () {
  var cfg = window.MENU_CONFIG;
  if (!cfg || !cfg.supabaseUrl || /^YOUR_/.test(cfg.supabaseUrl) || typeof fetch !== 'function') return;
  var endpoint = cfg.supabaseUrl.replace(/\/+$/, '') + '/rest/v1/rpc/log_menu_event';

  function send(kind, dish) {
    try {
      fetch(endpoint, {
        method: 'POST',
        keepalive: true, // still delivered when the tap opens the AR camera and the page goes away
        headers: { 'content-type': 'application/json', apikey: cfg.supabaseAnonKey },
        body: JSON.stringify({ p_kind: kind, p_dish: dish || null })
      }).catch(function () {});
    } catch (e) { /* analytics must never break the menu */ }
  }

  // One menu view per tab session, so refreshes do not inflate the count.
  var counted = false;
  try {
    counted = sessionStorage.getItem('mv-menu-view') === '1';
    if (!counted) sessionStorage.setItem('mv-menu-view', '1');
  } catch (e) { /* private mode: count every load */ }
  if (!counted) send('menu_view');

  // Capture phase runs before openAR() navigates to the camera.
  document.addEventListener('click', function (event) {
    var el = event.target && event.target.closest ? event.target : null;
    if (!el) return;
    var ar = el.closest('.card-ar-btn');
    if (ar) {
      var card = ar.closest('[data-dish]');
      send('ar_view', card && card.getAttribute('data-dish'));
      return;
    }
    var rec = el.closest('[data-recommendation-add]');
    if (rec) { send('rec_click', rec.getAttribute('data-recommendation-add')); return; }
    if (el.closest('[data-bundle-add]')) send('rec_click', null);
  }, true);
})();
