const test = require('node:test');
const assert = require('node:assert/strict');
const recommendDishes = require('./recommendations.js');
const safetyPreferences = require('./safety-preferences.js');

const menu = [
  { id: 'main', category: 'main', flavour: ['spicy'], dietary: [], meal_part: 'lunch' },
  { id: 'drink', category: 'drink', flavour: ['citrus', 'spicy'], dietary: ['vegan'], available: true },
  { id: 'side', category: 'side', flavour: ['spicy'], dietary: ['vegan'], available: true },
  { id: 'dessert', category: 'dessert', flavour: ['sweet', 'spicy'], dietary: ['vegan'], available: true },
  { id: 'sold-out', category: 'drink', flavour: [], dietary: ['vegan'], available: false }
];

test('returns tag-selected drink, side and dessert suggestions with a maximum of three', function () {
  const results = recommendDishes(menu, { viewedDishId: 'main', hour: 14 });
  assert.deepEqual(results.map(function (result) { return result.id; }), ['drink', 'side', 'dessert']);
});

test('excludes items that fail any active dietary filter', function () {
  const results = recommendDishes(menu, {
    viewedDishId: 'main',
    dietaryFilters: ['vegan', 'halal'],
    hour: 14
  });
  assert.equal(results.length, 0);
});

test('never recommends sold-out dishes', function () {
  const results = recommendDishes(menu, { viewedDishId: 'main', hour: 14 });
  assert.equal(results.some(function (result) { return result.id === 'sold-out'; }), false);
});

test('does not suggest a drink already present in the cart', function () {
  const results = recommendDishes(menu, {
    cartIds: ['main', 'drink'],
    hour: 14
  });
  assert.equal(results.some(function (result) { return result.dish.category === 'drink'; }), false);
  assert.equal(results.some(function (result) { return result.id === 'dessert'; }), true);
});

test('uses meal-part tags for morning recommendations', function () {
  const breakfastMenu = menu.concat([
    { id: 'breakfast', category: 'main', flavour: [], dietary: [], meal_part: 'breakfast' }
  ]);
  const results = recommendDishes(breakfastMenu, { viewedDishId: 'main', hour: 8 });
  assert.equal(results[0].id, 'breakfast');
  assert.equal(results[0].reason, 'Fits this time of day');
});

test('gives evening mains a time-aware boost', function () {
  const eveningMenu = menu.concat([
    { id: 'evening-main', category: 'main', flavour: [], dietary: [], meal_part: 'dinner' }
  ]);
  const results = recommendDishes(eveningMenu, { viewedDishId: 'main', hour: 19 });
  const ids = results.map(function (result) { return result.id; });
  assert.ok(ids.indexOf('evening-main') !== -1);
  assert.ok(ids.indexOf('evening-main') < ids.indexOf('side'));
});

test('uses frequent pairs to rank results without bypassing dietary filters', function () {
  const results = recommendDishes(menu, {
    viewedDishId: 'main',
    hour: 14,
    pairCounts: { dessert: 12, side: 1 }
  });
  assert.equal(results[0].id, 'dessert');
  assert.equal(results[0].reason, 'Popular choice');
  assert.equal(results[0].orderCount, 12);
  assert.ok(results[0].confidence >= 0.6);

  const filtered = recommendDishes(menu, {
    viewedDishId: 'main',
    hour: 14,
    dietaryFilters: ['halal'],
    pairCounts: { drink: 500, side: 500, dessert: 500 }
  });
  assert.equal(filtered.length, 0);
});

test('hides weak guesses and labels suggestions using their strongest evidence', function () {
  const confidenceMenu = [
    { id: 'main', category: 'main', flavour: [], dietary: [] },
    { id: 'weak-drink', category: 'drink', flavour: [], dietary: [] },
    { id: 'pairing-side', category: 'side', flavour: ['savory'], dietary: [] },
    { id: 'chef-dessert', category: 'dessert', flavour: [], dietary: [], promote: true },
    { id: 'popular-dessert', category: 'dessert', flavour: [], dietary: [] }
  ];
  const results = recommendDishes(confidenceMenu, {
    viewedDishId: 'main',
    hour: 14,
    pairCounts: { 'popular-dessert': 2, 'weak-drink': 1 }
  });
  assert.deepEqual(results.map(function (item) { return item.id; }), ['popular-dessert', 'chef-dessert']);
  assert.equal(results[0].reason, 'Popular choice');
  assert.equal(results[1].reason, "Chef's pick");
  assert.ok(results.every(function (item) { return item.confidence >= 0.6; }));
});

test('accepts only unique AI dish IDs from the safe rule candidate list', function () {
  const candidates = recommendDishes(menu, { viewedDishId: 'main', hour: 14 });
  const selected = recommendDishes.selectAiRecommendations(candidates, [
    'dessert',
    'not-a-candidate',
    'dessert',
    'side',
    'drink'
  ]);
  assert.deepEqual(selected.map(function (item) { return item.id; }), ['dessert', 'side', 'drink']);
});

test('allergen filters exclude direct, may-contain and unverified dishes', function () {
  const allergyMenu = [
    { id: 'main', category: 'main', flavour: ['savory'], dietary: [], allergens: [], may_contain_allergens: [], allergen_info_verified: true },
    { id: 'safe', category: 'drink', flavour: ['savory'], dietary: [], allergens: [], may_contain_allergens: [], allergen_info_verified: true },
    { id: 'contains', category: 'drink', flavour: ['savory'], dietary: [], allergens: ['nuts'], may_contain_allergens: [], allergen_info_verified: true },
    { id: 'cross-contact', category: 'side', flavour: ['savory'], dietary: [], allergens: [], may_contain_allergens: ['nuts'], allergen_info_verified: true },
    { id: 'unknown', category: 'dessert', flavour: ['savory'], dietary: [], allergens: [], may_contain_allergens: [], allergen_info_verified: false }
  ];
  const results = recommendDishes(allergyMenu, {
    viewedDishId: 'main',
    allergenFilters: ['nuts'],
    hour: 14
  });
  assert.deepEqual(results.map(function (item) { return item.id; }), ['safe']);
});

test('requires every saved dietary and allergy need at the same time', function () {
  const restrictedMenu = [
    { id: 'main', category: 'main', flavour: ['savory'], dietary: ['veg', 'vegan', 'halal'], allergens: [], may_contain_allergens: [], allergen_info_verified: true },
    { id: 'safe', category: 'drink', flavour: ['savory'], dietary: ['veg', 'vegan', 'halal'], allergens: [], may_contain_allergens: [], allergen_info_verified: true },
    { id: 'wrong-diet', category: 'side', flavour: ['savory'], dietary: ['veg', 'vegan'], allergens: [], may_contain_allergens: [], allergen_info_verified: true },
    { id: 'wrong-allergen', category: 'dessert', flavour: ['savory'], dietary: ['veg', 'vegan', 'halal'], allergens: ['dairy'], may_contain_allergens: [], allergen_info_verified: true }
  ];
  const results = recommendDishes(restrictedMenu, {
    viewedDishId: 'main',
    dietaryFilters: ['veg', 'vegan', 'halal'],
    allergenFilters: ['dairy', 'nuts'],
    hour: 14
  });
  assert.deepEqual(results.map(function (item) { return item.id; }), ['safe']);
});

test('AI selections are checked against safety needs again', function () {
  const candidates = [
    { id: 'safe', dish: { dietary: ['vegan'], allergens: [], may_contain_allergens: [], allergen_info_verified: true } },
    { id: 'unsafe', dish: { dietary: ['vegan'], allergens: ['dairy'], may_contain_allergens: [], allergen_info_verified: true } },
    { id: 'unknown', dish: { dietary: ['vegan'], allergens: [], may_contain_allergens: [], allergen_info_verified: false } }
  ];
  const selected = recommendDishes.selectAiRecommendations(candidates, ['unsafe', 'unknown', 'safe'], {
    dietary: ['vegan'],
    allergens: ['dairy']
  });
  assert.deepEqual(selected.map(function (item) { return item.id; }), ['safe']);
});

test('builds a discounted combo from category tags and ranks it with pairing history', function () {
  const comboMenu = [
    { id: 'main', name: 'Tagged main', category: 'main', price: 9.99, dietary: [], allergens: [], may_contain_allergens: [], allergen_info_verified: true },
    { id: 'drink-a', name: 'Less popular drink', category: 'drink', price: 3, dietary: [], allergens: [], may_contain_allergens: [], allergen_info_verified: true },
    { id: 'drink-b', name: 'Popular drink', category: 'drink', price: 4, dietary: [], allergens: [], may_contain_allergens: [], allergen_info_verified: true },
    { id: 'dessert-a', name: 'Less popular dessert', category: 'dessert', price: 5, dietary: [], allergens: [], may_contain_allergens: [], allergen_info_verified: true },
    { id: 'dessert-b', name: 'Popular dessert', category: 'dessert', price: 6, dietary: [], allergens: [], may_contain_allergens: [], allergen_info_verified: true }
  ];
  const bundle = recommendDishes.buildComboBundle(comboMenu, {
    viewedDishId: 'main',
    pairCounts: { 'drink-b': 9, 'dessert-b': 7 },
    preferences: { dietary: [], allergens: [] },
    bundlesEnabled: true,
    discountPercent: 10
  });
  assert.deepEqual(bundle.ids, ['main', 'drink-b', 'dessert-b']);
  assert.equal(bundle.baseTotal, 19.99);
  assert.equal(bundle.savings, 2);
  assert.equal(bundle.total, 17.99);
});

test('does not form bundles when a component violates saved safety needs', function () {
  const comboMenu = [
    { id: 'main', category: 'main', price: 10, dietary: ['vegan'], allergens: [], may_contain_allergens: [], allergen_info_verified: true },
    { id: 'drink', category: 'drink', price: 3, dietary: ['vegan'], allergens: [], may_contain_allergens: [], allergen_info_verified: true },
    { id: 'dessert', category: 'dessert', price: 5, dietary: ['vegan'], allergens: [], may_contain_allergens: ['nuts'], allergen_info_verified: true }
  ];
  const bundle = recommendDishes.buildComboBundle(comboMenu, {
    viewedDishId: 'main',
    preferences: { dietary: ['vegan'], allergens: ['nuts'] },
    bundlesEnabled: true,
    discountPercent: 10
  });
  assert.equal(bundle, null);
});

test('honors the bundle switch and discount validation', function () {
  const comboMenu = [
    { id: 'main', category: 'main', price: 10, dietary: [] },
    { id: 'drink', category: 'drink', price: 3, dietary: [] },
    { id: 'dessert', category: 'dessert', price: 5, dietary: [] }
  ];
  const options = { viewedDishId: 'main', preferences: { dietary: [], allergens: [] }, discountPercent: 10 };
  assert.equal(recommendDishes.buildComboBundle(comboMenu, Object.assign({}, options, { bundlesEnabled: false })), null);
  assert.equal(recommendDishes.buildComboBundle(comboMenu, Object.assign({}, options, { bundlesEnabled: true, discountPercent: 0 })), null);
  assert.equal(recommendDishes.buildComboBundle(comboMenu, Object.assign({}, options, { bundlesEnabled: true, discountPercent: 101 })), null);
});

test('keeps the combo plus individual recommendations within three slots', function () {
  const suggestions = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(recommendDishes.limitSuggestionSlots(suggestions, true), suggestions.slice(0, 2));
  assert.deepEqual(recommendDishes.limitSuggestionSlots(suggestions, false), suggestions);
});

test('builds combos efficiently from a 300-dish menu', function () {
  const largeMenu = [];
  for (let index = 0; index < 100; index += 1) {
    largeMenu.push({ id: 'main-' + index, category: 'main', price: 10, flavour: [], dietary: [], allergens: [], may_contain_allergens: [], allergen_info_verified: true });
    largeMenu.push({ id: 'drink-' + index, category: 'drink', price: 3, flavour: [], dietary: [], allergens: [], may_contain_allergens: [], allergen_info_verified: true });
    largeMenu.push({ id: 'dessert-' + index, category: 'dessert', price: 5, flavour: [], dietary: [], allergens: [], may_contain_allergens: [], allergen_info_verified: true });
  }
  const start = Date.now();
  const bundle = recommendDishes.buildComboBundle(largeMenu, {
    viewedDishId: 'main-0',
    preferences: { dietary: [], allergens: [] },
    bundlesEnabled: true,
    discountPercent: 10
  });
  const elapsed = Date.now() - start;
  assert.equal(bundle.ids[0], 'main-0');
  assert.equal(bundle.ids.length, 3);
  assert.ok(elapsed < 250, 'bundle pass took ' + elapsed + 'ms');
});

test('stores and reloads customer safety preferences on the device', function () {
  const values = new Map();
  const storage = {
    getItem: function (key) { return values.has(key) ? values.get(key) : null; },
    setItem: function (key, value) { values.set(key, value); }
  };
  const initial = safetyPreferences.load(storage);
  assert.equal(initial.ready, true);
  assert.deepEqual(initial.preferences, { allergens: [], dietary: [] });

  const saved = safetyPreferences.save(storage, {
    allergens: ['nuts', 'dairy', 'nuts', 'unknown'],
    dietary: ['vegan', 'halal']
  });
  assert.equal(saved.saved, true);
  assert.deepEqual(safetyPreferences.load(storage).preferences, {
    allergens: ['nuts', 'dairy'],
    dietary: ['vegan', 'halal']
  });
});

test('fails closed for damaged saved preference data and unavailable storage', function () {
  const invalidStorage = { getItem: function () { return '{broken'; } };
  const invalid = safetyPreferences.load(invalidStorage);
  assert.equal(invalid.ready, false);
  const blockedStorage = { getItem: function () { throw new Error('blocked'); } };
  assert.equal(safetyPreferences.load(blockedStorage).ready, false);
});

test('master switch disables all suggestions', function () {
  const results = recommendDishes(menu, {
    viewedDishId: 'main',
    hour: 14,
    recommendationsEnabled: false
  });
  assert.equal(results.length, 0);
});

test('handles a 250-dish menu within the local recommendation pass', function () {
  const largeMenu = menu.concat(Array.from({ length: 250 }, function (_, index) {
    return {
      id: 'dessert-' + index,
      category: 'dessert',
      flavour: ['spicy'],
      dietary: [],
      meal_part: 'any',
      available: true
    };
  }));
  const start = Date.now();
  const results = recommendDishes(largeMenu, { viewedDishId: 'main', hour: 14 });
  const elapsed = Date.now() - start;
  assert.equal(results.length, 3);
  assert.ok(elapsed < 250, 'recommendation pass took ' + elapsed + 'ms');
});
