(function (root) {
  var MIN_RECOMMENDATION_CONFIDENCE = 0.6;

  function recommendDishes(menu, options) {
    options = options || {};
    if (options.recommendationsEnabled === false) return [];
    var dishes = Array.isArray(menu) ? menu : Object.keys(menu || {}).map(function (id) {
      var dish = menu[id];
      return Object.assign({ id: id }, dish);
    });
    var byId = new Map(dishes.map(function (dish) { return [String(dish.id), dish]; }));
    var cartIds = new Set((options.cartIds || []).map(String));
    var viewedId = options.viewedDishId == null ? null : String(options.viewedDishId);
    var context = [];
    if (viewedId && byId.has(viewedId)) context.push(byId.get(viewedId));
    cartIds.forEach(function (id) {
      if (byId.has(id) && id !== viewedId) context.push(byId.get(id));
    });
    if (!context.length) return [];

    var filters = options.dietaryFilters || [];
    var allergenFilters = options.allergenFilters || [];
    var preferencesReady = options.safetyPreferencesReady !== false;
    var hasDrinkInCart = Array.from(cartIds).some(function (id) {
      return byId.has(id) && byId.get(id).category === 'drink';
    });
    var contextHasMain = context.some(function (dish) { return dish.category === 'main'; });
    var contextHasOrder = cartIds.size > 0;
    var reasons = new Map();

    function isSafeForPreferences(dish) {
      return preferencesReady && isDishSafeForPreferences(dish, {
        dietary: filters,
        allergens: allergenFilters
      });
    }

    function addCandidate(dish, priority) {
      var id = String(dish.id);
      if (id === viewedId || cartIds.has(id) || dish.available === false) return;
      if (!isSafeForPreferences(dish)) return;
      var current = reasons.get(id);
      if (!current || priority > current.priority) reasons.set(id, { priority: priority });
    }

    function request(category, priority, predicate) {
      dishes.forEach(function (dish) {
        if (dish.category !== category || (predicate && !predicate(dish))) return;
        addCandidate(dish, priority);
      });
    }

    function requestMatching(priority, predicate) {
      dishes.forEach(function (dish) {
        if (predicate(dish)) addCandidate(dish, priority);
      });
    }

    if (contextHasMain && !hasDrinkInCart) request('drink', 30);
    if (contextHasMain) request('side', 20);
    if (contextHasOrder || viewedId) request('dessert', 10);

    var hour = Number.isInteger(options.hour) ? options.hour : new Date().getHours();
    if (hour >= 5 && hour < 11) {
      requestMatching(40, function (dish) { return dish.meal_part === 'breakfast'; });
    } else if (hour >= 17) {
      request('main', 15);
    }

    var contextFlavours = new Set();
    context.forEach(function (dish) {
      (dish.flavour || []).forEach(function (flavour) { contextFlavours.add(flavour); });
    });

    return Array.from(reasons.entries()).map(function (entry) {
      var dish = byId.get(entry[0]);
      var orderCount = Number((options.pairCounts || {})[entry[0]]) || 0;
      var flavourMatches = (dish.flavour || []).filter(function (flavour) {
        return contextFlavours.has(flavour);
      }).length;
      var hourMatch = (hour >= 5 && hour < 11 && dish.meal_part === 'breakfast') ||
        (hour >= 17 && dish.category === 'main');
      var confidence = Math.max(
        orderCount >= 2 ? Math.min(0.95, 0.7 + Math.log2(orderCount / 2 + 1) * 0.1) : 0,
        flavourMatches ? Math.min(0.85, 0.6 + flavourMatches * 0.1) : 0,
        dish.promote ? 0.8 : 0,
        hourMatch ? 0.65 : 0
      );
      var reason = orderCount >= 2 ? 'Popular choice' :
        dish.promote ? "Chef's pick" :
        flavourMatches ? 'Pairs well' :
        hourMatch ? 'Fits this time of day' : '';
      return {
        id: entry[0],
        dish: dish,
        reason: reason,
        orderCount: orderCount,
        confidence: confidence,
        score: entry[1].priority + flavourMatches * 3 + (dish.promote ? 5 : 0) +
          (hourMatch ? 12 : 0) + Math.min(30, Math.log2(orderCount + 1) * 8)
      };
    }).filter(function (item) {
      return item.confidence >= MIN_RECOMMENDATION_CONFIDENCE;
    }).sort(function (a, b) {
      return b.score - a.score || String(a.dish.name).localeCompare(String(b.dish.name));
    }).slice(0, Number.isInteger(options.limit) ? Math.max(0, Math.min(options.limit, 500)) : 3);
  }

  function isDishSafeForPreferences(dish, preferences) {
    preferences = preferences || {};
    var dietary = preferences.dietary || [];
    if (dietary.length && (!Array.isArray(dish.dietary) ||
        !dietary.every(function (need) {
          return dish.dietary.indexOf(need) !== -1;
        }))) return false;
    var allergens = preferences.allergens || [];
    if (!allergens.length) return true;
    if (dish.allergen_info_verified !== true ||
        !Array.isArray(dish.allergens) || !Array.isArray(dish.may_contain_allergens)) return false;
    return !allergens.some(function (allergen) {
      return dish.allergens.indexOf(allergen) !== -1 ||
        dish.may_contain_allergens.indexOf(allergen) !== -1;
    });
  }

  function selectAiRecommendations(candidates, ids, preferences) {
    var byId = new Map(candidates.filter(function (item) {
      return isDishSafeForPreferences(item.dish, preferences);
    }).map(function (item) { return [String(item.id), item]; }));
    var selected = [];
    (Array.isArray(ids) ? ids : []).forEach(function (id) {
      var key = String(id);
      if (selected.length < 3 && byId.has(key) && !selected.some(function (item) { return item.id === key; })) {
        selected.push(byId.get(key));
      }
    });
    return selected;
  }

  function limitSuggestionSlots(suggestions, hasBundle) {
    return suggestions.slice(0, hasBundle ? 2 : 3);
  }

  function buildComboBundle(menu, options) {
    options = options || {};
    var discountPercent = Number(options.discountPercent);
    if (options.bundlesEnabled !== true || options.bundleAlreadyActive === true ||
        !Number.isFinite(discountPercent) || discountPercent <= 0 || discountPercent > 100 ||
        options.safetyPreferencesReady === false) return null;
    var dishes = Array.isArray(menu) ? menu : Object.keys(menu || {}).map(function (id) {
      return Object.assign({ id: id }, menu[id]);
    });
    var byId = new Map(dishes.map(function (dish) { return [String(dish.id), dish]; }));
    var viewedId = options.viewedDishId == null ? null : String(options.viewedDishId);
    var cartIds = new Set((options.cartIds || []).map(String));
    var mainIds = Array.from(new Set([viewedId].concat(Array.from(cartIds)).filter(Boolean)));
    var main = mainIds.map(function (id) { return byId.get(id); }).find(function (dish) {
      return dish && dish.category === 'main' && dish.available !== false &&
        isDishSafeForPreferences(dish, options.preferences);
    });
    if (!main) return null;

    function extras(category) {
      var mainFlavours = new Set(main.flavour || []);
      return dishes.filter(function (dish) {
        return dish.category === category && dish.id !== main.id &&
          dish.available !== false && isDishSafeForPreferences(dish, options.preferences);
      }).map(function (dish) {
        var orderCount = Number((options.pairCounts || {})[dish.id]) || 0;
        var sharedFlavours = (dish.flavour || []).filter(function (flavour) {
          return mainFlavours.has(flavour);
        }).length;
        return {
          dish: dish,
          orderCount: orderCount,
          score: Math.min(30, Math.log2(orderCount + 1) * 8) +
            sharedFlavours * 3 + (dish.promote ? 5 : 0)
        };
      }).sort(function (a, b) {
        return b.score - a.score || String(a.dish.name).localeCompare(String(b.dish.name));
      }).slice(0, 12);
    }

    var drinks = extras('drink');
    var desserts = extras('dessert');
    if (!drinks.length || !desserts.length) return null;

    var best = null;
    drinks.forEach(function (drink) {
      desserts.forEach(function (dessert) {
        var items = [main, drink.dish, dessert.dish];
        var baseTotalCents = items.reduce(function (sum, dish) {
          return sum + Math.round(Number(dish.price) * 100);
        }, 0);
        var savingsCents = Math.round(baseTotalCents * discountPercent / 100);
        var baseTotal = baseTotalCents / 100;
        var savings = savingsCents / 100;
        var candidate = {
          id: items.map(function (dish) { return String(dish.id); }).sort().join('|'),
          items: items,
          ids: items.map(function (dish) { return String(dish.id); }),
          baseTotal: baseTotal,
          savings: savings,
          total: (baseTotalCents - savingsCents) / 100,
          discountPercent: discountPercent,
          orderCount: drink.orderCount + dessert.orderCount,
          score: drink.score + dessert.score
        };
        if (!best || candidate.score > best.score ||
            (candidate.score === best.score && candidate.baseTotal < best.baseTotal)) best = candidate;
      });
    });
    return best;
  }

  root.recommendDishes = recommendDishes;
  root.selectAiRecommendations = selectAiRecommendations;
  root.limitSuggestionSlots = limitSuggestionSlots;
  root.buildComboBundle = buildComboBundle;
  root.isDishSafeForPreferences = isDishSafeForPreferences;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = recommendDishes;
    module.exports.selectAiRecommendations = selectAiRecommendations;
    module.exports.limitSuggestionSlots = limitSuggestionSlots;
    module.exports.buildComboBundle = buildComboBundle;
    module.exports.isDishSafeForPreferences = isDishSafeForPreferences;
  }
})(typeof window !== 'undefined' ? window : globalThis);
