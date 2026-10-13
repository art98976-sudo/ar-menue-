const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('./order-status.js');

function memoryStorage(initial) {
  const data = new Map(Object.entries(initial || {}));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    raw: data
  };
}

const T0 = Date.UTC(2026, 9, 12, 12, 0, 0);
const ID_A = '3f2b8c1e-9a4d-4e2f-8b6a-1c2d3e4f5a6b';
const ID_B = '7d1e2f3a-4b5c-4d6e-8f70-81a2b3c4d5e6';
const ID_C = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const order = (id, no, extra) => Object.assign({ id, orderNo: no, table: '5', placedAt: T0, total: 10 }, extra);

function stateWith(...orders) {
  let s = os.emptyState();
  orders.forEach((o) => { s = os.addOrder(s, o).state; });
  return s;
}

test('saves several orders and reloads them unchanged', () => {
  const storage = memoryStorage();
  const s = stateWith(order(ID_A, 1001), order(ID_B, 1002, { placedAt: T0 + 1000 }));
  assert.equal(os.save(storage, s).saved, true);
  const loaded = os.load(storage, T0 + 60000);
  assert.equal(loaded.ready, true);
  assert.deepEqual(loaded.state.orders.map((o) => o.orderNo), [1001, 1002]);
});

test('two orders from one table stay separate and are never overwritten', () => {
  let s = stateWith(order(ID_A, 1001));
  s = os.addOrder(s, order(ID_B, 1002)).state;
  const again = os.addOrder(s, order(ID_A, 1001, { total: 99 }));
  assert.equal(again.added, false);
  assert.equal(again.state.orders.length, 2);
  assert.deepEqual(again.state.orders.map((o) => o.id), [ID_A, ID_B]);
  assert.equal(again.state.orders.find((o) => o.id === ID_B).total, 10);
});

test('groups a table\'s orders under one heading', () => {
  const s = stateWith(order(ID_A, 1001), order(ID_B, 1002), order(ID_C, 1003, { table: null }));
  const groups = os.groupByTable(s.orders);
  assert.deepEqual(groups.map((g) => g.heading), ['Dine-in · Table 5 · 2 orders', 'Dine-in · 1 order']);
  assert.equal(os.trackerText(s.orders.slice(0, 2), false), 'Dine-in · Table 5 · 2 orders');
  assert.equal(os.trackerText(s.orders.slice(0, 1), false), 'Order #1001 · Received');
});

test('several orders turning ready at once give one combined alert', () => {
  const s = stateWith(order(ID_A, 1001, { status: 'preparing' }), order(ID_B, 1002, { status: 'preparing' }));
  const applied = os.applyStatuses(s, [
    { id: ID_A, status: 'ready', paid: false, refunded: false },
    { id: ID_B, status: 'ready', paid: false, refunded: false }
  ]);
  assert.equal(applied.changes.length, 2);
  const alert = os.alertFor(applied.changes);
  assert.equal(alert.kind, 'ready');
  assert.equal(alert.title, 'Orders #1001 and #1002 are ready');
  assert.equal(os.trackerText(applied.state.orders, false), 'Dine-in · Table 5 · 2 orders · 2 ready');
});

test('no alert when nothing changed', () => {
  const s = stateWith(order(ID_A, 1001, { status: 'preparing' }));
  const applied = os.applyStatuses(s, [{ id: ID_A, status: 'preparing', paid: false, refunded: false }]);
  assert.equal(applied.changes.length, 0);
  assert.equal(os.alertFor(applied.changes), null);
});

test('orders the kitchen no longer knows are dropped, others kept', () => {
  const s = stateWith(order(ID_A, 1001), order(ID_B, 1002));
  const applied = os.applyStatuses(s, [{ id: ID_B, status: 'new' }]);
  assert.deepEqual(applied.state.orders.map((o) => o.id), [ID_B]);
  assert.deepEqual(applied.removed.map((o) => o.id), [ID_A]);
});

test('an order added while a status check was on its way is not dropped', () => {
  let s = stateWith(order(ID_A, 1001));
  const asked = s.orders.map((o) => o.id);
  s = os.addOrder(s, order(ID_B, 1002)).state; // e.g. recovered after a reload
  const applied = os.applyStatuses(s, [{ id: ID_A, status: 'preparing' }], asked);
  assert.deepEqual(applied.state.orders.map((o) => o.orderNo), [1001, 1002]);
  assert.equal(applied.removed.length, 0);
});

test('manual clear is only allowed once an order is served', () => {
  let s = stateWith(order(ID_A, 1001, { status: 'ready' }));
  assert.equal(os.canClear(s.orders[0]), false);
  assert.equal(os.clearOrder(s, ID_A).cleared, null);
  s = os.applyStatuses(s, [{ id: ID_A, status: 'served' }]).state;
  const cleared = os.clearOrder(s, ID_A);
  assert.equal(cleared.cleared.orderNo, 1001);
  assert.equal(cleared.state.orders.length, 0);
});

test('undo puts a cleared order back exactly once', () => {
  let s = stateWith(order(ID_A, 1001, { status: 'served' }), order(ID_B, 1002));
  const { state, cleared } = os.clearOrder(s, ID_A);
  s = os.restoreOrder(state, cleared, T0 + 1000);
  s = os.restoreOrder(s, cleared, T0 + 1000);
  assert.deepEqual(s.orders.map((o) => o.orderNo), [1001, 1002]);
});

test('cancelled after payment shows a refund message and cannot be cleared until refunded', () => {
  let s = stateWith(order(ID_A, 1001, { status: 'preparing' }));
  s = os.applyStatuses(s, [{ id: ID_A, status: 'cancelled', paid: true, refunded: false }]).state;
  const info = os.describe(s.orders[0]);
  assert.equal(info.refundDue, true);
  assert.match(info.note, /refund is due/);
  assert.equal(os.canClear(s.orders[0]), false);
  const refunded = os.applyStatuses(s, [{ id: ID_A, status: 'cancelled', paid: true, refunded: true }]);
  assert.equal(os.alertFor(refunded.changes).kind, 'refund');
  assert.equal(os.describe(refunded.state.orders[0]).note, 'Cancelled and refunded.');
  assert.equal(os.canClear(refunded.state.orders[0]), true);
});

test('the bill adds up unpaid, non-cancelled orders so a table can pay together', () => {
  const s = stateWith(order(ID_A, 1001, { total: 12.4 }), order(ID_B, 1002, { total: 7.35 }),
    order(ID_C, 1003, { total: 5, status: 'cancelled' }));
  assert.deepEqual(os.billSummary(s.orders), { count: 2, total: 19.75, orderNos: [1001, 1002] });
  const paid = os.applyStatuses(s, [
    { id: ID_A, status: 'served', paid: true }, { id: ID_B, status: 'served', paid: false },
    { id: ID_C, status: 'cancelled' }
  ]).state;
  assert.deepEqual(os.billSummary(paid.orders), { count: 1, total: 7.35, orderNos: [1002] });
});

test('4-hour forget works across midnight', () => {
  const placed = new Date(2026, 9, 12, 22, 30).getTime();
  const storage = memoryStorage();
  os.save(storage, stateWith(order(ID_A, 1001, { placedAt: placed })));
  const justBefore = new Date(2026, 9, 13, 2, 29).getTime();
  const justAfter = new Date(2026, 9, 13, 2, 31).getTime();
  assert.equal(os.load(storage, justBefore).state.orders.length, 1);
  assert.equal(os.load(storage, justAfter).state.orders.length, 0);
});

test('orders dated in the future (wrong clock) are dropped', () => {
  const storage = memoryStorage();
  os.save(storage, stateWith(order(ID_A, 1001, { placedAt: T0 + 2 * 60 * 60 * 1000 })));
  assert.equal(os.load(storage, T0).state.orders.length, 0);
});

test('the same basket sent again reuses its request id, so it is never ordered twice', () => {
  let n = 0;
  const ids = [ID_A, ID_B, ID_C];
  const make = () => ids[n++];
  const items = [{ id: 'pizza', qty: 1 }, { id: 'drink', qty: 2 }];
  const first = os.requestFor(os.emptyState(), items, T0, make);
  const retry = os.requestFor(first.state, [{ id: 'drink', qty: 2 }, { id: 'pizza', qty: 1 }], T0 + 5000, make);
  assert.equal(retry.requestId, first.requestId);
  assert.equal(retry.reused, true);
  const changed = os.requestFor(first.state, [{ id: 'pizza', qty: 2 }], T0 + 5000, make);
  assert.notEqual(changed.requestId, first.requestId);
  const stale = os.requestFor(first.state, items, T0 + os.pendingMaxAgeMs + 1, make);
  assert.equal(stale.reused, false);
});

test('a pending order attempt survives a reload so it can be recovered', () => {
  const storage = memoryStorage();
  const req = os.requestFor(os.emptyState(), [{ id: 'sushi', qty: 1 }], T0, () => ID_C);
  os.save(storage, req.state);
  assert.equal(os.load(storage, T0 + 30000).state.pending.requestId, ID_C);
  assert.equal(os.load(storage, T0 + os.pendingMaxAgeMs + 1).state.pending, null);
});

test('moves an order saved in the old single-order format', () => {
  const storage = memoryStorage({
    'menuvision.active-order.v1': JSON.stringify({ id: ID_A, orderNo: 1001, table: '5', placedAt: T0 })
  });
  const loaded = os.load(storage, T0 + 1000);
  assert.deepEqual(loaded.state.orders.map((o) => o.orderNo), [1001]);
  assert.equal(storage.raw.has('menuvision.active-order.v1'), false);
});

test('damaged or blocked storage never crashes', () => {
  const damaged = memoryStorage({ 'menuvision.orders.v2': '{broken' });
  const loaded = os.load(damaged, T0);
  assert.equal(loaded.ready, false);
  assert.deepEqual(loaded.state.orders, []);
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() {} };
  assert.equal(os.load(blocked, T0).ready, false);
  assert.equal(os.save(blocked, os.emptyState()).saved, false);
  const partly = memoryStorage({ 'menuvision.orders.v2': JSON.stringify({ version: 2, orders: [{ id: 'nope' }, order(ID_A, 1001)] }) });
  const partial = os.load(partly, T0);
  assert.equal(partial.damaged, true);
  assert.deepEqual(partial.state.orders.map((o) => o.orderNo), [1001]);
});

test('order type is kept and labelled for each kind of order', () => {
  let s = stateWith(order(ID_A, 1001), order(ID_B, 1002, { table: null, orderType: 'collection' }));
  assert.deepEqual(s.orders.map((o) => os.placeLabel(o)), ['Dine-in · Table 5', 'Collection']);
  s = os.applyStatuses(s, [{ id: ID_A, status: 'new', order_type: 'dine_in', table_label: '7' },
    { id: ID_B, status: 'new', order_type: 'collection', table_label: null }]).state;
  assert.equal(os.placeLabel(s.orders[0]), 'Dine-in · Table 7');
  assert.equal(os.addOrder(os.emptyState(), order(ID_C, 1003, { orderType: 'teleport' })).state.orders[0].orderType, 'dine_in');
});

test('only valid private ids are accepted', () => {
  assert.equal(os.isUuid(ID_A), true);
  assert.equal(os.isUuid('1001'), false);
  assert.equal(os.addOrder(os.emptyState(), order('1001', 1001)).added, false);
});

test('tracking trouble is reported when offline or after repeated failures', () => {
  assert.equal(os.isTroubled(0, false), true);
  assert.equal(os.isTroubled(os.timing.troubleAfterFailures - 1, true), false);
  assert.equal(os.isTroubled(os.timing.troubleAfterFailures, true), true);
  assert.equal(os.trackerText([], true), 'Please check with staff');
});
