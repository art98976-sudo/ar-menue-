// Supabase connection — used by both the customer menu and the owner dashboard.
// Find both values in Supabase → Project Settings → API.
// The publishable (anon) key is meant to be public; the database rules in supabase/schema.sql
// decide what it can do. NEVER put the service_role key here.
window.MENU_CONFIG = {
  supabaseUrl: 'https://vmhqwevrmofrkwuyrhyu.supabase.co',
  supabaseAnonKey: 'sb_publishable_39qKzxnw781aghZIdePn-w_12dUEIhb'
};
