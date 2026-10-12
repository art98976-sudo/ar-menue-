/* Remembers the customer's latest order on this device so its kitchen status
   can be shown live, even after a page reload. Only the order's private id,
   its number, the table and the time it was placed are stored. */
(function (root) {
  var STORAGE_KEY = 'menuvision.active-order.v1';
  var MAX_AGE_MS = 4 * 60 * 60 * 1000;
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var STEPS = ['new', 'preparing', 'ready', 'served'];
  var LABELS = {
    new: 'Received',
    preparing: 'Preparing',
    ready: 'Ready',
    served: 'Served',
    cancelled: 'Cancelled'
  };
  var NOTES = {
    new: 'The kitchen has your order.',
    preparing: 'Your food is being prepared.',
    ready: 'Your order is ready and on its way to you.',
    served: 'Enjoy your meal!',
    cancelled: 'This order was cancelled. Please ask a member of staff.'
  };

  function isValid(order) {
    return Boolean(order && typeof order.id === 'string' && UUID.test(order.id) &&
      Number.isInteger(order.orderNo) && order.orderNo > 0 &&
      Number.isFinite(order.placedAt) && order.placedAt > 0 &&
      (order.table === null || (typeof order.table === 'string' && order.table.length <= 20)));
  }

  function load(storage, now) {
    try {
      var raw = storage.getItem(STORAGE_KEY);
      if (raw === null) return null;
      var order = JSON.parse(raw);
      if (!isValid(order) || Number(now) - order.placedAt > MAX_AGE_MS || order.placedAt > Number(now) + 60000) {
        storage.removeItem(STORAGE_KEY);
        return null;
      }
      return { id: order.id, orderNo: order.orderNo, table: order.table, placedAt: order.placedAt };
    } catch (error) {
      return null;
    }
  }

  function save(storage, order) {
    if (!isValid(order)) return { saved: false, error: new Error('Order tracking details are invalid') };
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify({
        id: order.id, orderNo: order.orderNo, table: order.table, placedAt: order.placedAt
      }));
      return { saved: true };
    } catch (error) {
      return { saved: false, error: error };
    }
  }

  function clear(storage) {
    try { storage.removeItem(STORAGE_KEY); } catch (error) { /* nothing to clear */ }
  }

  function describe(status) {
    var known = Object.prototype.hasOwnProperty.call(LABELS, status);
    return {
      status: known ? status : 'new',
      label: known ? LABELS[status] : LABELS.new,
      note: known ? NOTES[status] : NOTES.new,
      step: STEPS.indexOf(known ? status : 'new'),
      finished: status === 'served' || status === 'cancelled'
    };
  }

  root.MenuOrderStatus = {
    steps: STEPS.slice(),
    describe: describe,
    load: load,
    save: save,
    clear: clear,
    maxAgeMs: MAX_AGE_MS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.MenuOrderStatus;
})(typeof window !== 'undefined' ? window : globalThis);
