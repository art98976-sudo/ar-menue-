(function (root) {
  var STORAGE_KEY = 'menuvision.order-history.v1';
  var MAX_ORDERS = 50;
  var MAX_ITEMS = 50;
  var MAX_QUANTITY = 20;
  var TASTE_OFFER_COOLDOWN = 24 * 60 * 60 * 1000;

  function emptyHistory() {
    return { version: 1, orders: [], lastTasteOfferAt: 0 };
  }

  function normalizeItems(items) {
    if (!Array.isArray(items) || !items.length || items.length > MAX_ITEMS) return null;
    var seen = new Set();
    var normalized = [];
    for (var i = 0; i < items.length; i += 1) {
      var item = items[i];
      if (!item || typeof item.id !== 'string' || !item.id.trim() ||
          !Number.isInteger(item.qty) || item.qty < 1 || item.qty > MAX_QUANTITY ||
          seen.has(item.id)) return null;
      seen.add(item.id);
      normalized.push({ id: item.id, qty: item.qty });
    }
    return normalized;
  }

  function load(storage) {
    try {
      var raw = storage.getItem(STORAGE_KEY);
      if (raw === null) return { ready: true, history: emptyHistory() };
      var parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.orders) ||
          !Number.isFinite(parsed.lastTasteOfferAt) || parsed.lastTasteOfferAt < 0) {
        return { ready: false, history: emptyHistory(), error: new Error('Saved order history is invalid') };
      }
      var orders = [];
      for (var i = 0; i < parsed.orders.length; i += 1) {
        var order = parsed.orders[i];
        var items = order && normalizeItems(order.items);
        if (!items) {
          return { ready: false, history: emptyHistory(), error: new Error('Saved order history is invalid') };
        }
        orders.push({ items: items });
      }
      return {
        ready: true,
        history: {
          version: 1,
          orders: orders.slice(0, MAX_ORDERS),
          lastTasteOfferAt: parsed.lastTasteOfferAt
        }
      };
    } catch (error) {
      return { ready: false, history: emptyHistory(), error: error };
    }
  }

  function write(storage, history) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(history));
      return { saved: true };
    } catch (error) {
      return { saved: false, error: error };
    }
  }

  function recordOrder(storage, items) {
    var current = load(storage);
    if (!current.ready) return { saved: false, error: current.error };
    var normalized = normalizeItems(items);
    if (!normalized) {
      return { saved: false, error: new Error('Order history entry is invalid') };
    }
    current.history.orders.unshift({ items: normalized });
    current.history.orders = current.history.orders.slice(0, MAX_ORDERS);
    var result = write(storage, current.history);
    return result.saved ? { saved: true, history: current.history } : result;
  }

  function getUsualBasket(orders) {
    var baskets = new Map();
    (Array.isArray(orders) ? orders : []).forEach(function (order, index) {
      var items = normalizeItems(order && order.items);
      if (!items) return;
      var sortedItems = items.slice().sort(function (a, b) { return a.id.localeCompare(b.id); });
      var key = JSON.stringify(sortedItems);
      var basket = baskets.get(key);
      if (!basket) {
        basket = { items: sortedItems, orderCount: 0, mostRecentOrderIndex: index };
        baskets.set(key, basket);
      }
      basket.orderCount += 1;
      basket.mostRecentOrderIndex = Math.min(basket.mostRecentOrderIndex, index);
    });
    var usual = Array.from(baskets.values()).sort(function (a, b) {
      return b.orderCount - a.orderCount || a.mostRecentOrderIndex - b.mostRecentOrderIndex;
    })[0];
    return usual && usual.orderCount >= 2
      ? { items: usual.items, orderCount: usual.orderCount }
      : null;
  }

  function markTasteOfferShown(storage, now) {
    var current = load(storage);
    if (!current.ready) return { saved: false, error: current.error };
    var timestamp = Number(now);
    if (!Number.isFinite(timestamp) || timestamp < 0) {
      return { saved: false, error: new Error('Taste-offer timestamp is invalid') };
    }
    current.history.lastTasteOfferAt = timestamp;
    return write(storage, current.history);
  }

  function canShowTasteOffer(history, now) {
    var current = Number(now);
    var lastShown = Number(history && history.lastTasteOfferAt) || 0;
    return Number.isFinite(current) && current >= lastShown &&
      current - lastShown >= TASTE_OFFER_COOLDOWN;
  }

  function clear(storage) {
    try {
      storage.removeItem(STORAGE_KEY);
      return { cleared: true };
    } catch (error) {
      return { cleared: false, error: error };
    }
  }

  root.MenuCustomerHistory = {
    canShowTasteOffer: canShowTasteOffer,
    clear: clear,
    getUsualBasket: getUsualBasket,
    load: load,
    markTasteOfferShown: markTasteOfferShown,
    recordOrder: recordOrder
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = root.MenuCustomerHistory;
  }
})(typeof window !== 'undefined' ? window : globalThis);
