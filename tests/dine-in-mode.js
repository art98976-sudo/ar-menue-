/* Browser tests: does each way of opening the menu (table QR, home) route correctly?
   Runs inside Playwright with the menu served at http://localhost:8765/.
   It stands in for the kitchen at the network level, so no real orders are placed.
   The fake kitchen knows one real table: table 5 with secret code "goodkey". */
async (page) => {
  const ctx = page.context();
  const results = [];
  const record = (test, pass, detail) => results.push({ test, result: pass ? 'PASS' : 'FAIL', detail });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const kitchen = { placeBodies: [], homeBodies: [], checks: [], logs: [], revoked: false, nextNo: 7001 };
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
  try {
    await ctx.unrouteAll({ behavior: 'ignoreErrors' });
    await ctx.route('**/functions/v1/recommend', (r) => r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '{"dish_ids":[]}' }));
    await ctx.route('**/rest/v1/rpc/**', async (route) => {
      const req = route.request();
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      const fn = req.url().split('/rpc/')[1].split('?')[0];
      let body = {}; try { body = JSON.parse(req.postData() || '{}'); } catch (e) {}
      const json = (data, status = 200) => route.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(data) }).catch(() => {});
      const realTable = (t, k) => t === '5' && k === 'goodkey' && !kitchen.revoked;
      if (fn === 'check_table') { kitchen.checks.push(body); return json(realTable(body.p_table, body.p_key)); }
      if (fn === 'place_order') {
        kitchen.placeBodies.push(body);
        if (body.p_order_type !== 'dine_in') return json({ code: 'P0001', message: 'ORDER_TYPE_UNAVAILABLE' }, 400);
        if (!realTable(body.p_table, body.p_table_key)) return json({ code: 'P0001', message: 'BAD_TABLE' }, 400);
        return json({ id: '3f2b8c1e-9a4d-4e2f-8b6a-' + String(100000000000 + kitchen.nextNo).slice(-12), order_no: kitchen.nextNo++, total: 13.99, bundle_discount: 0, duplicate: false });
      }
      if (fn === 'place_order_home') {
        kitchen.homeBodies.push(body);
        return json({ id: '3f2b8c1e-9a4d-4e2f-8b6a-' + String(100000000000 + kitchen.nextNo).slice(-12), order_no: kitchen.nextNo++, total: 13.99, bundle_discount: 0, duplicate: false });
      }
      if (fn === 'get_table_board') return json({ session_id: '00000000-0000-4000-8000-000000000001', table: '5', basket: [], orders: [] });
      if (fn === 'order_statuses') return json([]);
      if (fn === 'log_client_error') { kitchen.logs.push(body); return route.fulfill({ status: 204, headers: cors }); }
      return route.continue();
    });

    const view = () => page.evaluate(() => ({
      chip: [...document.querySelectorAll('[data-table]')].filter((e) => !e.hidden).map((e) => e.textContent)[0] || null,
      banner: document.getElementById('mode-banner').hidden ? null : document.getElementById('mode-banner').textContent,
      note: document.getElementById('order-mode-note').hidden ? null : document.getElementById('order-mode-note').textContent,
      buttonDisabled: document.getElementById('place-order-btn').disabled,
      mode: window.orderingMode && window.orderingMode.status,
      toast: document.getElementById('toast-msg').textContent
    }));
    const open = async (query) => {
      await page.goto('http://localhost:8765/index.html' + query);
      await page.evaluate(() => localStorage.clear());
      await page.reload();
      for (let i = 0; i < 30; i++) { const v = await view(); if (v.mode !== 'checking') break; await sleep(100); }
      await page.evaluate(() => { quickAdd('sushi'); openCart(); });
      await sleep(200);
      return view();
    };
    const tryToOrder = async () => {
      const before = kitchen.placeBodies.length;
      await page.evaluate(() => placeOrder()); // also covers a button that is somehow still tapped
      await sleep(600);
      return kitchen.placeBodies.length - before;
    };

    // 1. Scanned at a real table
    let v = await open('?table=5&k=goodkey');
    record('Real table QR: shows "Dine-in · Table 5" and allows ordering', v.chip === 'Dine-in · Table 5' && !v.buttonDisabled && v.banner === null,
      'chip: ' + v.chip + ', button enabled: ' + !v.buttonDisabled);
    let sent = await tryToOrder();
    const last = kitchen.placeBodies[kitchen.placeBodies.length - 1] || {};
    record('Real table QR: order goes to the kitchen tagged dine-in for table 5',
      sent === 1 && last.p_order_type === 'dine_in' && last.p_table === '5' && last.p_table_key === 'goodkey',
      'type ' + last.p_order_type + ', table ' + last.p_table);
    v = await view();
    record('Real table QR: order is accepted', /Sent to the kitchen/.test(await page.textContent('#ok-h')), await page.textContent('#ok-h'));

    // 2. Forged or old code
    v = await open('?table=5&k=forged');
    record('Wrong table code: friendly message, ordering switched off',
      v.mode === 'bad_table' && v.buttonDisabled && /don't recognise this table code/.test(v.banner || ''), v.banner);
    sent = await tryToOrder();
    record('Wrong table code: nothing is sent to the kitchen', sent === 0, sent + ' order(s) sent');

    // 3. Table number typed into the address bar, no code
    v = await open('?table=5');
    record('Table typed by hand (no code): refused', v.mode === 'bad_table' && v.buttonDisabled, 'mode: ' + v.mode);

    // 4. Opened from home: collection or delivery, with the customer's details
    const checksBefore = kitchen.checks.length;
    v = await open('');
    const homeFields = await page.evaluate(() => !document.getElementById('home-order-fields').hidden);
    record('Opened from home: offers collection or delivery',
      v.mode === 'home' && !v.buttonDisabled && v.chip === null && homeFields && /collection or delivery/.test(v.banner || ''), v.banner);
    sent = await tryToOrder();
    v = await view();
    record('Opened from home: missing details are explained and nothing is sent',
      sent === 0 && kitchen.homeBodies.length === 0 && /Complete your order details/.test(v.toast), sent + ' order(s), toast: ' + v.toast);
    await page.fill('#customer-name', 'Sam Test');
    await page.fill('#customer-phone', '07700900123');
    const homeBefore = kitchen.homeBodies.length;
    await page.evaluate(() => placeOrder());
    await sleep(600);
    const home = kitchen.homeBodies[kitchen.homeBodies.length - 1] || {};
    record('Opened from home: a collection order with details goes to the kitchen without a table check',
      kitchen.homeBodies.length === homeBefore + 1 && home.p_order_type === 'collection' && /Sam Test/.test(home.p_note || '') &&
      kitchen.checks.length === checksBefore && /Sent to the kitchen/.test(await page.textContent('#ok-h')),
      'type ' + home.p_order_type + ', table checks ' + (kitchen.checks.length - checksBefore));

    // 5. Code replaced by the owner while the customer is sitting there
    await open('?table=5&k=goodkey');
    kitchen.revoked = true;
    sent = await tryToOrder();
    v = await view();
    record('Code replaced mid-visit: database refuses, customer told to ask staff',
      sent === 1 && v.mode === 'bad_table' && v.buttonDisabled && /Table not recognised/.test(v.toast), 'toast: ' + v.toast);
    kitchen.revoked = false;

    // 6. The secret code never goes into the error log
    await open('?table=5&k=goodkey');
    await page.evaluate(() => window.logClientError('test_probe', 'checking the logged page'));
    await sleep(400);
    const pages = kitchen.logs.map((l) => l.p_page);
    record('Secret table code is never written to the error log',
      pages.length > 0 && pages.every((p) => !String(p).includes('goodkey')), pages.join(' | '));
  } catch (error) {
    results.push({ test: 'TEST RUN STOPPED', result: 'ERROR', detail: String(error && error.message || error).slice(0, 300) });
  }
  await ctx.unrouteAll({ behavior: 'ignoreErrors' });
  return results;
}
