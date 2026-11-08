-- ════════════════════════════════════════════════════════════════
-- Demo clean-up (November 2026). Safe to run more than once.
-- Run in Supabase → SQL Editor after schema.sql.
--
--  • Restaurant name/tagline that fit a pizza, burger, pasta and sushi menu
--  • "Chef's pick" on one dish only (pizza)
--  • Consistent pricing: burger £10.85 → £10.99
--  • Three photo-only drinks (no 3D model, so no AR button on the menu)
--  • Table 4 for the plain demo link (config.js → MENU_FLAGS.TABLE_LABEL/TABLE_KEY)
-- ════════════════════════════════════════════════════════════════

update public.restaurant
   set name = 'Canongate Kitchen',
       tagline = 'Pizza, burgers, pasta & sushi · Leith Walk, Edinburgh'
 where id = 1;

update public.dishes set promote = (id = 'pizza');

update public.dishes set price = 10.99 where id = 'burger';

-- DRAFT allergen lists, NOT marked verified: confirm with the kitchen and
-- supplier labels, then tick "Allergen information verified" in the dashboard.
insert into public.dishes
  (id, name, description, price, calories, prep_time, rating, size, serves, weight, icon,
   available, sort, category, flavour, dietary, allergens, allergen_info_verified,
   price_band, ingredients, calories_per_100g, portion_grams, promote)
values
  ('latte', 'Caffè Latte', 'Double espresso with silky steamed milk.', 3.99,
   '150 kcal', '4 min', '4.8', '350 ml', '1 person', '350g', '☕',
   true, 6, 'drink', array['creamy','coffee'], array['veg'], array['dairy'], false,
   'budget', array['espresso','whole milk'], 42.86, 350, false),
  ('iced-coffee', 'Iced Coffee', 'Cold brew over ice with a splash of milk.', 4.99,
   '90 kcal', '3 min', '4.7', '400 ml', '1 person', '400g', '🧊',
   true, 7, 'drink', array['coffee','fresh'], array['veg'], array['dairy'], false,
   'budget', array['cold brew coffee','ice','milk'], 22.5, 400, false),
  ('smoothie', 'Berry Smoothie', 'Strawberry, blueberry and banana, blended to order.', 5.99,
   '210 kcal', '5 min', '4.9', '400 ml', '1 person', '400g', '🫐',
   true, 8, 'drink', array['fruity','fresh'], array['vegan','veg'], array[]::text[], false,
   'budget', array['strawberry','blueberry','banana','apple juice'], 52.5, 400, false)
on conflict (id) do nothing;

insert into public.restaurant_tables (label) values ('4') on conflict (label) do nothing;

notify pgrst, 'reload schema';
