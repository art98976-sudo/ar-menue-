// Supabase connection — used by both the customer menu and the owner dashboard.
// Find both values in Supabase → Project Settings → API.
// The publishable (anon) key is meant to be public; the database rules in supabase/schema.sql
// decide what it can do. NEVER put the service_role key here.
window.MENU_CONFIG = {
  supabaseUrl: 'https://vmhqwevrmofrkwuyrhyu.supabase.co',
  supabaseAnonKey: 'sb_publishable_39qKzxnw781aghZIdePn-w_12dUEIhb'
};

// Menu presentation switches. Every feature still exists in the code:
// flip a flag back to turn it on again.
window.MENU_FLAGS = {
  // Restaurant name and tagline shown on the menu. These win over the
  // dashboard values. Set to '' to use the name saved in the dashboard.
  RESTAURANT_NAME: 'Canongate Kitchen',
  RESTAURANT_TAGLINE: 'Pizza, burgers, pasta & sushi · Leith Walk, Edinburgh',

  // Which kinds of order the menu offers: any of 'dine_in', 'collection', 'delivery'.
  // ['dine_in'] = dine-in only: no collection/delivery choice, no address field.
  ORDER_MODES: ['dine_in'],

  // Dine-in only: the table used when the link has no ?table=… (e.g. the plain demo link).
  // A table QR code (index.html?table=5&k=…) always wins over this.
  // TABLE_KEY must match that table's qr_key in Supabase (restaurant_tables).
  TABLE_LABEL: '4',
  TABLE_KEY: '69d78d24fa6840d2a9e26978ac6016ea',

  // Mood chips (Comfort, Light, …) only appear once the menu has at least this many dishes.
  MOOD_FILTER_MIN_DISHES: 10,

  // Need a database function first. Run the SQL file in Supabase, then set to true.
  ANALYTICS: false,        // menu/AR view counts for the dashboard → supabase/dashboard-upgrade-2026-11.sql
  MOST_VIEWED_AR: false    // "Most viewed in AR" badge         → supabase/menu-experience-2026-11.sql
};
