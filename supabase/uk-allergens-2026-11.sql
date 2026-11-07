-- ════════════════════════════════════════════════════════════════
-- All 14 UK allergens (November 2026)
--
-- Adds crustaceans, molluscs and lupin to the allergen tags a dish may
-- carry. The older 'shellfish' tag stays valid, and diners who avoid
-- crustaceans or molluscs are also warned about dishes tagged 'shellfish'.
-- Run once in Supabase → SQL Editor. Safe to run again.
-- ════════════════════════════════════════════════════════════════

alter table public.dishes drop constraint if exists dishes_allergens_check;
alter table public.dishes add constraint dishes_allergens_check
  check (allergens <@ array['celery', 'dairy', 'eggs', 'fish', 'gluten', 'mustard', 'nuts', 'peanuts',
    'sesame', 'shellfish', 'soy', 'sulphites', 'wheat', 'crustaceans', 'molluscs', 'lupin']::text[]);

alter table public.dishes drop constraint if exists dishes_may_contain_allergens_check;
alter table public.dishes add constraint dishes_may_contain_allergens_check
  check (may_contain_allergens <@ array['celery', 'dairy', 'eggs', 'fish', 'gluten', 'mustard', 'nuts', 'peanuts',
    'sesame', 'shellfish', 'soy', 'sulphites', 'wheat', 'crustaceans', 'molluscs', 'lupin']::text[]);
