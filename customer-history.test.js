const test = require('node:test');
const assert = require('node:assert/strict');
const customerHistory = require('./customer-history.js');

function createStorage() {
  const values = new Map();
  return {
    getItem: function (key) { return values.has(key) ? values.get(key) : null; },
    setItem: function (key, value) { values.set(key, value); },
    removeItem: function (key) { values.delete(key); }
  };
}

test('saves minimal order item IDs and quantities and reloads them', function () {
  const storage = createStorage();
  const saved = customerHistory.recordOrder(storage, [
    { id: 'main', qty: 2 },
    { id: 'drink', qty: 1 }
  ]);
  assert.equal(saved.saved, true);
  assert.deepEqual(customerHistory.load(storage).history.orders, [{
    items: [{ id: 'main', qty: 2 }, { id: 'drink', qty: 1 }],
  }]);
});

test('finds the most frequently repeated exact basket regardless of item order', function () {
  const orders = [
    { items: [{ id: 'main', qty: 1 }, { id: 'drink', qty: 1 }] },
    { items: [{ id: 'drink', qty: 1 }, { id: 'main', qty: 1 }] },
    { items: [{ id: 'dessert', qty: 1 }] }
  ];
  assert.deepEqual(customerHistory.getUsualBasket(orders), {
    items: [{ id: 'drink', qty: 1 }, { id: 'main', qty: 1 }],
    orderCount: 2
  });
  assert.equal(customerHistory.getUsualBasket([orders[0]]), null);
});

test('limits saved history and rejects invalid order data', function () {
  const storage = createStorage();
  for (let index = 0; index < 55; index += 1) {
    assert.equal(customerHistory.recordOrder(storage, [{ id: 'dish-' + index, qty: 1 }]).saved, true);
  }
  assert.equal(customerHistory.load(storage).history.orders.length, 50);
  assert.equal(customerHistory.recordOrder(storage, [{ id: 'bad', qty: 21 }]).saved, false);
});

test('offers taste suggestions no more than once per 24 hours', function () {
  const storage = createStorage();
  const firstOffer = 10 * 24 * 60 * 60 * 1000;
  assert.equal(customerHistory.canShowTasteOffer({ lastTasteOfferAt: 0 }, firstOffer), true);
  assert.equal(customerHistory.markTasteOfferShown(storage, firstOffer).saved, true);
  const history = customerHistory.load(storage).history;
  assert.equal(customerHistory.canShowTasteOffer(history, firstOffer + 1000), false);
  assert.equal(customerHistory.canShowTasteOffer(history, firstOffer + 24 * 60 * 60 * 1000), true);
});

test('fails visibly for malformed or inaccessible history storage and supports clearing', function () {
  const storage = createStorage();
  storage.setItem('menuvision.order-history.v1', '{broken');
  assert.equal(customerHistory.load(storage).ready, false);
  assert.equal(customerHistory.clear(storage).cleared, true);
  assert.equal(customerHistory.load(storage).ready, true);
  const blocked = { getItem: function () { throw new Error('blocked'); } };
  assert.equal(customerHistory.load(blocked).ready, false);
});
