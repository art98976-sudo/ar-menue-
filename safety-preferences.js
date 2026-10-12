(function (root) {
  var STORAGE_KEY = 'menuvision.safety-preferences.v1';
  var ALLERGENS = [
    'celery', 'dairy', 'eggs', 'fish', 'gluten', 'mustard', 'nuts',
    'peanuts', 'sesame', 'shellfish', 'soy', 'sulphites', 'wheat'
  ];
  var DIETARY_NEEDS = ['veg', 'vegan', 'halal'];

  function cleanList(value, allowed) {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value.filter(function (tag) {
      return typeof tag === 'string' && allowed.indexOf(tag) !== -1;
    })));
  }

  function normalize(value) {
    value = value && typeof value === 'object' ? value : {};
    return {
      allergens: cleanList(value.allergens, ALLERGENS),
      dietary: cleanList(value.dietary, DIETARY_NEEDS)
    };
  }

  function validList(value, allowed) {
    return value === undefined || (Array.isArray(value) && value.every(function (tag) {
      return typeof tag === 'string' && allowed.indexOf(tag) !== -1;
    }));
  }

  function load(storage) {
    try {
      var stored = storage.getItem(STORAGE_KEY);
      if (stored === null) return { preferences: normalize(null), ready: true, stored: false };
      var parsed = JSON.parse(stored);
      if (!parsed || typeof parsed !== 'object' ||
          !validList(parsed.allergens, ALLERGENS) || !validList(parsed.dietary, DIETARY_NEEDS)) {
        return { preferences: normalize(null), ready: false, stored: true };
      }
      return { preferences: normalize(parsed), ready: true, stored: true };
    } catch (error) {
      return { preferences: normalize(null), ready: false, stored: false, error: error };
    }
  }

  function save(storage, preferences) {
    var normalized = normalize(preferences);
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(normalized));
      return { preferences: normalized, saved: true };
    } catch (error) {
      return { preferences: normalized, saved: false, error: error };
    }
  }

  root.MenuSafetyPreferences = {
    allergens: ALLERGENS.slice(),
    dietaryNeeds: DIETARY_NEEDS.slice(),
    normalize: normalize,
    load: load,
    save: save
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = root.MenuSafetyPreferences;
  }
})(typeof window !== 'undefined' ? window : globalThis);
