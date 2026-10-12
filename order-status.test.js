const test = require('node:test');
const assert = require('node:assert/strict');
const orderStatus = require('./order-status.js');

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    raw: data
  };
}

const order = {
  id: '3f2b8c1e-9a4d-4e2f-8b6a-1c2d3e4f5a6b',
  orderNo: 1004,
  table: '12',
  placedAt: 1_000_000
};

test('saves and reloads the active order on this device', function () {
  const storage = memoryStorage();
  assert.equal(orderStatus.save(storage, order).saved, true);
  assert.deepEqual(orderStatus.load(storage, order.placedAt + 60_000), order);
});

test('forgets orders older than four hours', function () {
  const storage = memoryStorage();
  orderStatus.save(storage, order);
  assert.equal(orderStatus.load(storage, order.placedAt + orderStatus.maxAgeMs + 1), null);
  assert.equal(storage.raw.size, 0);
});

test('rejects invalid or damaged saved data', function () {
  const storage = memoryStorage();
  assert.equal(orderStatus.save(storage, { ...order, id: 'not-a-uuid' }).saved, false);
  assert.equal(orderStatus.save(storage, { ...order, orderNo: 0 }).saved, false);
  storage.setItem('menuvision.active-order.v1', '{broken');
  assert.equal(orderStatus.load(storage, order.placedAt), null);
  storage.setItem('menuvision.active-order.v1', JSON.stringify({ ...order, table: 5 }));
  assert.equal(orderStatus.load(storage, order.placedAt), null);
});

test('survives storage that throws', function () {
  const broken = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
    removeItem() { throw new Error('blocked'); }
  };
  assert.equal(orderStatus.load(broken, order.placedAt), null);
  assert.equal(orderStatus.save(broken, order).saved, false);
  assert.doesNotThrow(() => orderStatus.clear(broken));
});

test('describes each kitchen status in order', function () {
  assert.deepEqual(
    orderStatus.steps.map((status) => [orderStatus.describe(status).label, orderStatus.describe(status).step]),
    [['Received', 0], ['Preparing', 1], ['Ready', 2], ['Served', 3]]
  );
  assert.equal(orderStatus.describe('served').finished, true);
  assert.equal(orderStatus.describe('cancelled').finished, true);
  assert.equal(orderStatus.describe('cancelled').step, -1);
  assert.equal(orderStatus.describe('preparing').finished, false);
  assert.equal(orderStatus.describe('something-else').label, 'Received');
});
