/* Hard-case browser tests for order tracking (MenuVision).
   Runs inside Playwright with the menu served at http://localhost:8765/.
   It stands in for the kitchen at the network level, so no real orders are placed.
   Run with Playwright's page.evaluate-style runner, e.g. the Playwright MCP
   browser_run_code tool, or wrap it: test('hard cases', async ({ page }) => console.table(await suite(page))). */
async (page) => {
  const ctx = page.context();
  const results = [];
  try {
  const record = (test, pass, detail) => results.push({ test, result: pass ? 'PASS' : 'FAIL', detail });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
  });

  // ── Fake kitchen: answers the menu's database calls ──────────────
  const kitchen = { orders: [], byRequest: {}, nextNo: 5001, placeCalls: [], statusCalls: 0, logs: [],
    statusMode: 'ok', placeMode: 'ok' };
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
  await ctx.unrouteAll({ behavior: 'ignoreErrors' });
  await ctx.route('**/functions/v1/recommend', (r) => r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '{"dish_ids":[]}' }));
  await ctx.route('**/rest/v1/rpc/**', async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const fn = req.url().split('/rpc/')[1].split('?')[0];
    let body = {}; try { body = JSON.parse(req.postData() || '{}'); } catch (e) {}
    const json = async (data, status = 200) => {
      try { await route.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(data) }); } catch (e) {}
    };
    if (fn === 'place_order') {
      kitchen.placeCalls.push(body.p_request_id);
      let o = body.p_request_id && kitchen.byRequest[body.p_request_id];
      const dup = Boolean(o);
      if (!o) {
        o = { id: uuid(), order_no: kitchen.nextNo++, status: 'new', total: 13.99, paid: false, refunded: false };
        kitchen.orders.push(o);
        if (body.p_request_id) kitchen.byRequest[body.p_request_id] = o;
      }
      if (kitchen.placeMode === 'dropResponse') { kitchen.placeMode = 'ok'; return route.abort('failed'); }
      if (kitchen.placeMode === 'hang') return; // never answers, like a connection that dies mid-order
      return json({ id: o.id, order_no: o.order_no, total: o.total, bundle_discount: 0, duplicate: dup });
    }
    if (fn === 'order_statuses') {
      kitchen.statusCalls++;
      if (kitchen.statusMode === 'fail500') return json({ message: 'server error' }, 500);
      if (kitchen.statusMode === 'slow') await sleep(3000);
      const ids = body.p_order_ids || [];
      return json(kitchen.orders.filter((o) => ids.includes(o.id)).map((o) => ({
        id: o.id, order_no: o.order_no, status: o.status, total: o.total, paid: o.paid, refunded: o.refunded,
        updated_at: new Date().toISOString() })));
    }
    if (fn === 'get_table_board') return json({ session_id: '00000000-0000-4000-8000-000000000001', table: '5', basket: [], orders: [] });
    if (fn === 'check_table') return json(body.p_table === '5' && body.p_key === 'goodkey');
    if (fn === 'recover_order') {
      const o = kitchen.byRequest[body.p_request_id];
      return json(o ? [{ id: o.id, order_no: o.order_no, total: o.total, status: o.status, order_type: 'dine_in', table_label: '5' }] : []);
    }
    if (fn === 'log_client_error') { kitchen.logs.push(body.p_context + ': ' + body.p_message); kitchen.logPages = (kitchen.logPages || []).concat(body.p_page); return route.fulfill({ status: 204, headers: cors }); }
    return route.continue();
  });

  // Short timings so the test runs in seconds instead of minutes.
  await ctx.addInitScript(() => {
    let real;
    Object.defineProperty(window, 'MenuOrderStatus', { configurable: true, get() { return real; },
      set(v) { real = v; Object.assign(v.timing, { pollMs: 600, slowPollMs: 1200, timeoutMs: 1200, troubleAfterFailures: 2 }); } });
    window.__toasts = [];
    document.addEventListener('DOMContentLoaded', () => {
      if (window.__toastWatch) return; // the suite may be run again in the same browser
      window.__toastWatch = true;
      const el = document.getElementById('toast-msg');
      new MutationObserver(() => { if (el.textContent) window.__toasts.push(el.textContent); })
        .observe(el, { childList: true, characterData: true, subtree: true });
    });
  });

  const readState = () => page.evaluate(() => ({
    groups: [...document.querySelectorAll('.order-group')].map((g) => ({
      head: g.querySelector('.og-head').textContent,
      cards: [...g.querySelectorAll('.track-card')].map((c) => ({
        no: c.querySelector('.tc-no').textContent, status: c.dataset.status,
        note: c.querySelector('.tc-note').textContent, clear: Boolean(c.querySelector('[data-clear-order]')),
        refund: c.dataset.refund || null })) })),
    warning: !document.getElementById('order-tracking-warning').hidden,
    pill: document.getElementById('order-tracker').hidden ? null : document.getElementById('order-tracker-text').textContent,
    undo: !document.getElementById('undo-bar').hidden,
    bill: document.getElementById('order-bill').hidden ? null : document.getElementById('order-bill').textContent.replace(/\s+/g, ' ').trim(),
    toasts: window.__toasts.slice()
  }));
  const state = async () => {
    for (let i = 0; i < 25; i++) {
      try { return await readState(); } catch (e) { await sleep(200); }
    }
    return readState();
  };
  const reloadAfter = async (fn, arg) => {
    const nav = page.waitForEvent('load');
    await page.evaluate(fn, arg).catch(() => {});
    await nav;
  };
  const waitFor = async (fn, ms = 7000) => {
    const t = Date.now();
    while (Date.now() - t < ms) { const s = await state(); if (fn(s)) return s; await sleep(200); }
    return state();
  };
  const cards = (s) => s.groups.flatMap((g) => g.cards);
  const placeViaUi = async (dish) => {
    await page.evaluate((d) => { quickAdd(d); openCart(); }, dish);
    await page.click('#place-order-btn');
  };
  const toMenu = () => page.evaluate(() => { if (document.getElementById('order-success').classList.contains('open')) backToMenu(); });

  await page.goto('http://localhost:8765/index.html?table=5&k=goodkey');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await sleep(1500);

  // 1. Double tap
  await page.evaluate(() => { quickAdd('sushi'); openCart(); const b = document.getElementById('place-order-btn'); b.click(); b.click(); });
  let s = await waitFor((x) => cards(x).length === 1);
  record('Double-tapping Place order sends one order', kitchen.placeCalls.length === 1 && kitchen.orders.length === 1 && cards(s).length === 1,
    kitchen.placeCalls.length + ' request(s), ' + kitchen.orders.length + ' kitchen order(s)');

  // 2. Lost reply, then the customer taps again
  await toMenu();
  kitchen.placeMode = 'dropResponse';
  const before = kitchen.orders.length;
  await placeViaUi('pizza');
  await sleep(800);
  await page.evaluate(() => openCart());
  await page.click('#place-order-btn');
  s = await waitFor((x) => cards(x).length === 2);
  const sameAttempt = kitchen.placeCalls.slice(-2);
  record('Retry after a lost reply never creates a second order',
    kitchen.orders.length === before + 1 && sameAttempt[0] === sameAttempt[1] && cards(s).length === 2,
    'kitchen received ' + (kitchen.orders.length - before) + ' new order from 2 sends with the same request id');

  // 3. Two orders from one table at once
  record('Two orders from one table stay separate and are grouped',
    s.groups.length === 1 && s.groups[0].head === 'Dine-in · Table 5 · 2 orders' && new Set(cards(s).map((c) => c.no)).size === 2,
    s.groups.map((g) => g.head).join(' / '));
  await toMenu();
  s = await state();
  record('Menu pill summarises the table', s.pill === 'Dine-in · Table 5 · 2 orders', s.pill);
  record('Bill lets the table pay for all orders together', Boolean(s.bill && s.bill.includes('To pay for all 2 orders') && s.bill.includes('27.98')), s.bill);

  // 4. Both ready in the same moment → one combined alert
  const [A, B] = kitchen.orders;
  A.status = 'ready'; B.status = 'ready';
  s = await waitFor((x) => cards(x).every((c) => c.status === 'ready'));
  await sleep(300);
  s = await state();
  const readyToasts = s.toasts.filter((t) => /ready/i.test(t));
  record('Several orders ready together give one combined alert',
    readyToasts.length === 1 && readyToasts[0] === 'Orders #' + A.order_no + ' and #' + B.order_no + ' are ready', readyToasts.join(' | '));
  record('Pill shows how many are ready', s.pill === 'Dine-in · Table 5 · 2 orders · 2 ready', s.pill);

  // 5. Clear only after Served, with undo
  const clearBefore = cards(s).some((c) => c.clear);
  A.status = 'served';
  s = await waitFor((x) => cards(x).some((c) => c.no === '#' + A.order_no && c.status === 'served'));
  const clearable = cards(s).filter((c) => c.clear).map((c) => c.no);
  record('Clear is only offered once an order is Served', !clearBefore && clearable.length === 1 && clearable[0] === '#' + A.order_no, 'clearable: ' + clearable.join(','));
  await page.evaluate(() => openOrderStatus());
  await page.click('[data-clear-order]');
  s = await state();
  const clearedOk = cards(s).length === 1 && s.undo;
  await page.click('#undo-bar button');
  s = await state();
  record('Clearing shows Undo, and Undo restores the order', clearedOk && cards(s).length === 2 && !s.undo, 'after undo: ' + cards(s).map((c) => c.no).join(','));
  await toMenu();

  // 6. Offline, then back online
  await ctx.setOffline(true);
  s = await waitFor((x) => x.warning && x.pill === 'Please check with staff', 4000);
  record('Offline shows "Please check with staff", never a blank screen', s.warning && s.pill === 'Please check with staff' && cards(s).length === 2,
    'pill: ' + s.pill + ', cards still shown: ' + cards(s).length);
  B.status = 'served';
  await ctx.setOffline(false);
  s = await waitFor((x) => !x.warning && cards(x).find((c) => c.no === '#' + B.order_no).status === 'served');
  record('Back online: recovers and re-syncs changes made while offline', !s.warning && cards(s).find((c) => c.no === '#' + B.order_no).status === 'served',
    'order #' + B.order_no + ' now ' + cards(s).find((c) => c.no === '#' + B.order_no).status);

  // 7. Slow network
  const logsBefore = kitchen.logs.length;
  kitchen.statusMode = 'slow';
  s = await waitFor((x) => x.warning, 9000);
  record('Slow network: times out and shows "Please check with staff"', s.warning && cards(s).length === 2, 'warning shown: ' + s.warning);
  record('Tracking failure is logged quietly for the owner', kitchen.logs.slice(logsBefore).some((l) => l.startsWith('order_tracking')),
    kitchen.logs.slice(logsBefore).join(' | ') || 'nothing logged');
  kitchen.statusMode = 'ok';
  s = await waitFor((x) => !x.warning, 6000);
  record('Slow network: recovers when the connection improves', !s.warning, 'warning shown: ' + s.warning);

  // 8. Server error
  kitchen.statusMode = 'fail500';
  s = await waitFor((x) => x.warning, 5000);
  const errShown = s.warning && cards(s).length === 2;
  kitchen.statusMode = 'ok';
  s = await waitFor((x) => !x.warning, 5000);
  record('Server error: friendly message, keeps last known status, then recovers', errShown && !s.warning, '');

  // 9. Cancelled after payment
  B.paid = true; B.status = 'cancelled';
  s = await waitFor((x) => cards(x).some((c) => c.refund === 'due'));
  const due = cards(s).find((c) => c.no === '#' + B.order_no);
  const refundMsgOk = due && /refund is due/.test(due.note) && !due.clear;
  B.refunded = true;
  s = await waitFor((x) => cards(x).find((c) => c.no === '#' + B.order_no).note === 'Cancelled and refunded.');
  const after = cards(s).find((c) => c.no === '#' + B.order_no);
  record('Cancelled after payment: refund message, cannot be cleared until refunded', Boolean(refundMsgOk && after.clear),
    (due ? due.note : 'no card') + ' → ' + after.note);

  // 10. Kitchen marks ready at the same moment the phone reloads
  const C = { id: uuid(), order_no: kitchen.nextNo++, status: 'preparing', total: 4.99, paid: false, refunded: false };
  kitchen.orders.push(C);
  await reloadAfter((o) => {
    const st = JSON.parse(localStorage.getItem('menuvision.orders.v2'));
    st.orders.push({ id: o.id, orderNo: o.order_no, table: '5', placedAt: Date.now(), total: o.total, status: 'preparing', paid: false, refunded: false });
    localStorage.setItem('menuvision.orders.v2', JSON.stringify(st));
    setTimeout(() => location.reload(), 0);
  }, C);
  C.status = 'ready';
  s = await waitFor((x) => x.toasts.some((t) => t.includes('#' + C.order_no + ' is ready')));
  record('Ready at the moment of reload is still announced', s.toasts.some((t) => t.includes('#' + C.order_no + ' is ready')), s.toasts.join(' | '));

  // 11. Page reload mid-order
  kitchen.placeMode = 'hang';
  const countBefore = kitchen.orders.length;
  await placeViaUi('drink');
  for (let i = 0; i < 50 && kitchen.orders.length === countBefore; i++) await sleep(100);
  const reachedKitchen = kitchen.orders.length === countBefore + 1;
  const D = kitchen.orders[kitchen.orders.length - 1];
  kitchen.placeMode = 'ok';
  await page.reload();
  s = await waitFor((x) => cards(x).some((c) => c.no === '#' + D.order_no));
  record('Reload mid-order: the order is found again, not lost or duplicated',
    reachedKitchen && cards(s).some((c) => c.no === '#' + D.order_no) && kitchen.orders.length === countBefore + 1 &&
    s.toasts.some((t) => t.includes('We found your order #' + D.order_no)), JSON.stringify({ reachedKitchen, newInKitchen: kitchen.orders.length - countBefore, D: D.order_no, cards: cards(s).map((c) => c.no + ':' + c.status), found: s.toasts.filter((t) => t.includes('found')) }));

  // 12. 4-hour forget
  await reloadAfter(() => {
    const st = JSON.parse(localStorage.getItem('menuvision.orders.v2'));
    st.orders.forEach((o) => { o.placedAt = Date.now() - (4 * 60 + 1) * 60 * 1000; });
    localStorage.setItem('menuvision.orders.v2', JSON.stringify(st));
    setTimeout(() => location.reload(), 0);
  });
  await sleep(1500);
  s = await state();
  record('Orders older than 4 hours are forgotten on this phone', cards(s).length === 0 && s.pill === null, cards(s).length + ' order(s) left');

  } catch (error) {
    results.push({ test: 'TEST RUN STOPPED', result: 'ERROR', detail: String(error && error.message || error).slice(0, 300) });
  }
  await ctx.unrouteAll({ behavior: 'ignoreErrors' });
  return results;
}
