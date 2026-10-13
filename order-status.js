/* Order tracking for the customer's phone.

   Privacy model: the phone that places an order receives that order's private,
   unguessable id. Only that id can look the order up, so a phone can track the
   orders it placed itself and nothing else. This module stores those ids (plus
   order number, table, time and last known status) in the browser and holds the
   pure logic for showing them. It never talks to the network itself. */
(function (root) {
  var STORAGE_KEY = 'menuvision.orders.v2';
  var LEGACY_KEY = 'menuvision.active-order.v1';
  var MAX_AGE_MS = 4 * 60 * 60 * 1000;     // forget orders 4 hours after they were placed
  var PENDING_MAX_AGE_MS = 15 * 60 * 1000; // an unconfirmed order attempt is retried or recovered within 15 minutes
  var MAX_ORDERS = 20;
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var STEPS = ['new', 'preparing', 'ready', 'served'];
  var STATUSES = STEPS.concat('cancelled');
  var ORDER_TYPES = ['dine_in', 'delivery', 'collection'];
  var LABELS = { new: 'Received', preparing: 'Preparing', ready: 'Ready', served: 'Served', cancelled: 'Cancelled' };

  // Timings live here so tests can shorten them. Normal values are below.
  var timing = { pollMs: 8000, slowPollMs: 30000, timeoutMs: 10000, troubleAfterFailures: 2 };

  function isUuid(value) { return typeof value === 'string' && UUID.test(value); }

  function makeState(orders, pending) { return { version: 2, orders: orders, pending: pending }; }

  function emptyState() { return makeState([], null); }

  function cleanOrder(order) {
    if (!order || !isUuid(order.id) || !Number.isInteger(order.orderNo) || order.orderNo <= 0 ||
        !Number.isFinite(order.placedAt) || order.placedAt <= 0 ||
        !(order.table === null || (typeof order.table === 'string' && order.table.length <= 20))) return null;
    return {
      id: order.id.toLowerCase(),
      orderNo: order.orderNo,
      table: order.table,
      placedAt: order.placedAt,
      total: Number.isFinite(order.total) && order.total >= 0 ? order.total : null,
      status: STATUSES.indexOf(order.status) !== -1 ? order.status : 'new',
      orderType: ORDER_TYPES.indexOf(order.orderType) !== -1 ? order.orderType : 'dine_in',
      paid: order.paid === true,
      refunded: order.refunded === true
    };
  }

  function cleanPending(pending) {
    if (!pending || !isUuid(pending.requestId) || !Number.isFinite(pending.startedAt) ||
        typeof pending.cartKey !== 'string' || pending.cartKey.length > 2000) return null;
    return { requestId: pending.requestId.toLowerCase(), startedAt: pending.startedAt, cartKey: pending.cartKey };
  }

  // Drops anything older than its limit. Uses absolute timestamps, so midnight,
  // time zones and daylight saving changes do not matter.
  function prune(state, now) {
    now = Number(now);
    var orders = state.orders.filter(function (order) {
      return now - order.placedAt <= MAX_AGE_MS && order.placedAt <= now + 60000;
    });
    var pending = state.pending && now - state.pending.startedAt <= PENDING_MAX_AGE_MS &&
      state.pending.startedAt <= now + 60000 ? state.pending : null;
    return makeState(orders, pending);
  }

  function load(storage, now) {
    var state = emptyState();
    var damaged = false;
    try {
      var raw = storage.getItem(STORAGE_KEY);
      if (raw !== null) {
        var parsed = JSON.parse(raw);
        if (!parsed || parsed.version !== 2 || !Array.isArray(parsed.orders)) throw new Error('Saved orders are damaged');
        parsed.orders.forEach(function (order) {
          var clean = cleanOrder(order);
          if (clean && !state.orders.some(function (o) { return o.id === clean.id; })) state.orders.push(clean);
          else if (!clean) damaged = true;
        });
        state.pending = cleanPending(parsed.pending);
      }
      // One-time move from the single-order format used before multiple orders were supported.
      var legacyRaw = storage.getItem(LEGACY_KEY);
      if (legacyRaw !== null) {
        var legacy = cleanOrder(JSON.parse(legacyRaw));
        if (legacy && !state.orders.some(function (o) { return o.id === legacy.id; })) state.orders.push(legacy);
        storage.removeItem(LEGACY_KEY);
      }
    } catch (error) {
      return { state: emptyState(), ready: false, error: error };
    }
    state = prune(state, now);
    return { state: state, ready: true, damaged: damaged };
  }

  function save(storage, state) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(state));
      return { saved: true };
    } catch (error) {
      return { saved: false, error: error };
    }
  }

  // Adds a newly placed order. An order already known by id is updated, never duplicated,
  // and other orders are never touched.
  function addOrder(state, order) {
    var clean = cleanOrder(order);
    if (!clean) return { state: state, added: false, error: new Error('Order details are invalid') };
    var existing = state.orders.find(function (o) { return o.id === clean.id; });
    var orders = state.orders.map(function (o) {
      return o.id === clean.id ? Object.assign({}, o, { orderNo: clean.orderNo, total: clean.total !== null ? clean.total : o.total }) : o;
    });
    if (!existing) orders.push(clean);
    orders.sort(byPlaced);
    if (orders.length > MAX_ORDERS) orders = orders.slice(orders.length - MAX_ORDERS);
    return { state: makeState(orders, state.pending), added: !existing };
  }

  // Applies one batch of rows from the kitchen. Returns what changed so the screen
  // can announce it, and drops orders the kitchen no longer knows about. Only orders
  // that were part of this check can be dropped: one added while the check was on
  // its way (for example a recovered order) is kept.
  function applyStatuses(state, rows, askedIds) {
    var asked = Array.isArray(askedIds) ? askedIds.map(function (id) { return String(id).toLowerCase(); }) : null;
    var byId = {};
    (Array.isArray(rows) ? rows : []).forEach(function (row) {
      if (row && isUuid(row.id) && STATUSES.indexOf(row.status) !== -1) byId[row.id.toLowerCase()] = row;
    });
    var changes = [];
    var removed = [];
    var orders = [];
    state.orders.forEach(function (order) {
      var row = byId[order.id];
      if (!row && asked && asked.indexOf(order.id) === -1) { orders.push(order); return; }
      if (!row) { removed.push(order); return; }
      var next = Object.assign({}, order, {
        status: row.status,
        paid: row.paid === true,
        refunded: row.refunded === true,
        total: Number.isFinite(Number(row.total)) ? Number(row.total) : order.total,
        orderType: ORDER_TYPES.indexOf(row.order_type) !== -1 ? row.order_type : order.orderType,
        table: typeof row.table_label === 'string' && row.table_label.length <= 20 ? row.table_label : order.table
      });
      if (next.status !== order.status || next.paid !== order.paid || next.refunded !== order.refunded) {
        changes.push({ id: order.id, orderNo: order.orderNo, from: order.status, to: next.status,
          paidChanged: next.paid !== order.paid, refundedChanged: next.refunded !== order.refunded });
      }
      orders.push(next);
    });
    return { state: makeState(orders, state.pending), changes: changes, removed: removed };
  }

  function listNumbers(nos) {
    var tags = nos.map(function (n) { return '#' + n; });
    if (tags.length <= 1) return tags.join('');
    return tags.slice(0, -1).join(', ') + ' and ' + tags[tags.length - 1];
  }

  // One alert for a whole batch of changes. Several orders turning ready at
  // once produce a single combined "ready" alert.
  function alertFor(changes) {
    var ready = changes.filter(function (c) { return c.to === 'ready' && c.from !== 'ready'; });
    if (ready.length > 1) {
      return { kind: 'ready', title: 'Orders ' + listNumbers(ready.map(function (c) { return c.orderNo; })) + ' are ready',
        sub: 'They are on their way to you.', vibrate: true };
    }
    if (ready.length === 1) {
      return { kind: 'ready', title: 'Order #' + ready[0].orderNo + ' is ready', sub: 'It is on its way to you.', vibrate: true };
    }
    var statusChanges = changes.filter(function (c) { return c.from !== c.to; });
    var refunds = changes.filter(function (c) { return c.refundedChanged; });
    var cancelled = statusChanges.filter(function (c) { return c.to === 'cancelled'; });
    if (cancelled.length) {
      return { kind: 'cancelled', title: (cancelled.length > 1 ? 'Orders ' : 'Order ') +
        listNumbers(cancelled.map(function (c) { return c.orderNo; })) + ' cancelled', sub: 'Please check with staff.' };
    }
    if (statusChanges.length === 1) {
      var c = statusChanges[0];
      return { kind: 'status', title: 'Order #' + c.orderNo + ': ' + LABELS[c.to], sub: '' };
    }
    if (statusChanges.length > 1) return { kind: 'status', title: statusChanges.length + ' orders updated', sub: '' };
    if (refunds.length) return { kind: 'refund', title: 'Refund recorded', sub: 'Order ' + listNumbers(refunds.map(function (r) { return r.orderNo; })) };
    return null;
  }

  function describe(order) {
    var status = order && STATUSES.indexOf(order.status) !== -1 ? order.status : 'new';
    var refundDue = status === 'cancelled' && order.paid && !order.refunded;
    var note = {
      new: 'The kitchen has your order.',
      preparing: 'Your food is being prepared.',
      ready: 'Ready and on its way to you.',
      served: 'Served. Enjoy your meal!',
      cancelled: 'This order was cancelled. Please check with staff.'
    }[status];
    if (refundDue) note = 'Cancelled after you paid. A refund is due: please show this screen to staff.';
    else if (status === 'cancelled' && order.refunded) note = 'Cancelled and refunded.';
    return {
      status: status,
      label: LABELS[status],
      note: note,
      step: STEPS.indexOf(status),
      finished: status === 'served' || status === 'cancelled',
      refundDue: refundDue
    };
  }

  // Manual clearing is only for finished orders, and never while a refund is still due.
  function canClear(order) {
    var info = describe(order);
    return info.finished && !info.refundDue;
  }

  function clearOrder(state, id) {
    var order = state.orders.find(function (o) { return o.id === id; });
    if (!order) return { state: state, cleared: null, error: new Error('Order not found') };
    if (!canClear(order)) return { state: state, cleared: null, error: new Error('Only served orders can be cleared') };
    var orders = state.orders.filter(function (o) { return o !== order; });
    return { state: makeState(orders, state.pending), cleared: order };
  }

  function restoreOrder(state, order, now) {
    if (!order || Number(now) - order.placedAt > MAX_AGE_MS) return state;
    if (state.orders.some(function (o) { return o.id === order.id; })) return state;
    var orders = state.orders.concat(order).sort(byPlaced);
    return makeState(orders, state.pending);
  }

  function byPlaced(a, b) { return a.placedAt - b.placedAt || a.orderNo - b.orderNo; }

  // How an order's place is named on screen: 'Dine-in · Table 5', 'Delivery', 'Collection'.
  function placeLabel(order) {
    if (order.orderType === 'delivery') return 'Delivery';
    if (order.orderType === 'collection') return 'Collection';
    return order.table ? 'Dine-in · Table ' + order.table : 'Dine-in';
  }

  function groupByTable(orders) {
    var groups = [];
    orders.forEach(function (order) {
      var label = placeLabel(order);
      var group = groups.find(function (g) { return g.label === label; });
      if (!group) { group = { label: label, orders: [] }; groups.push(group); }
      group.orders.push(order);
    });
    groups.forEach(function (g) {
      var n = g.orders.length;
      g.heading = g.label + ' · ' + n + (n === 1 ? ' order' : ' orders');
    });
    return groups;
  }

  // What the whole table still owes, so they can pay for every order together.
  function billSummary(orders) {
    var unpaid = orders.filter(function (o) { return o.status !== 'cancelled' && !o.paid && o.total !== null; });
    var cents = unpaid.reduce(function (sum, o) { return sum + Math.round(o.total * 100); }, 0);
    return { count: unpaid.length, total: cents / 100, orderNos: unpaid.map(function (o) { return o.orderNo; }) };
  }

  function trackerText(orders, troubled) {
    if (troubled) return 'Please check with staff';
    if (!orders.length) return '';
    if (orders.length === 1) return 'Order #' + orders[0].orderNo + ' · ' + describe(orders[0]).label;
    var groups = groupByTable(orders);
    var ready = orders.filter(function (o) { return o.status === 'ready'; }).length;
    var head = groups.length === 1 ? groups[0].heading : orders.length + ' orders';
    return head + (ready ? ' · ' + ready + ' ready' : '');
  }

  function cartKey(items) {
    return (Array.isArray(items) ? items : []).map(function (item) { return String(item.id) + ':' + Number(item.qty); })
      .sort().join('|');
  }

  // Reuses the same request id when the same basket is sent again after an
  // uncertain failure, so the kitchen gets it once.
  function requestFor(state, items, now, makeId) {
    var key = cartKey(items);
    var pending = state.pending;
    if (pending && pending.cartKey === key && Number(now) - pending.startedAt <= PENDING_MAX_AGE_MS) {
      return { state: state, requestId: pending.requestId, reused: true };
    }
    var requestId = String(makeId()).toLowerCase();
    if (!isUuid(requestId)) throw new Error('Could not create an order request id');
    return {
      state: makeState(state.orders, { requestId: requestId, startedAt: Number(now), cartKey: key }),
      requestId: requestId,
      reused: false
    };
  }

  function clearPending(state) { return makeState(state.orders, null); }

  function isTroubled(failures, online) { return online === false || failures >= timing.troubleAfterFailures; }

  root.MenuOrderStatus = {
    steps: STEPS.slice(),
    labels: Object.assign({}, LABELS),
    timing: timing,
    maxAgeMs: MAX_AGE_MS,
    pendingMaxAgeMs: PENDING_MAX_AGE_MS,
    maxOrders: MAX_ORDERS,
    isUuid: isUuid,
    emptyState: emptyState,
    load: load,
    save: save,
    prune: prune,
    addOrder: addOrder,
    applyStatuses: applyStatuses,
    alertFor: alertFor,
    describe: describe,
    canClear: canClear,
    clearOrder: clearOrder,
    restoreOrder: restoreOrder,
    groupByTable: groupByTable,
    placeLabel: placeLabel,
    billSummary: billSummary,
    trackerText: trackerText,
    cartKey: cartKey,
    requestFor: requestFor,
    clearPending: clearPending,
    isTroubled: isTroubled
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.MenuOrderStatus;
})(typeof window !== 'undefined' ? window : globalThis);
