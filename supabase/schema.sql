-- ════════════════════════════════════════════════════════════════
-- AR Menu — Supabase database
--
-- Run this whole file once in Supabase → SQL Editor → New query → Run.
-- It is safe to run again: tables are only created if missing and the
-- starter dishes are only inserted if they don't exist yet.
--
-- Who can do what (enforced by the database, not by the web pages):
--   • Customers (anon key)  read the menu + restaurant info, and place
--                           orders ONLY through place_order(), which looks
--                           up the real prices itself.
--   • Owner (logged in AND listed in public.owners)  reads/updates orders,
--                           edits dishes and restaurant info.
-- ════════════════════════════════════════════════════════════════

-- ── Tables ──────────────────────────────────────────────────────
create table if not exists public.restaurant (
  id               int primary key default 1 check (id = 1),  -- single row
  name             text    not null default 'The Cozy Cup',
  tagline          text    not null default 'Coffee & kitchen · Leith Walk, Edinburgh',
  badge            text    not null default 'Point your phone at the table — every dish appears at its real size',
  currency         text    not null default '£',
  tax_rate         numeric(5,4) not null default 0.05 check (tax_rate >= 0 and tax_rate < 1),
  accepting_orders boolean not null default true,
  recommendations_enabled boolean not null default true,
  ai_recommendations_enabled boolean not null default false,
  bundles_enabled boolean not null default false,
  bundle_discount_percent numeric(5,2) not null default 10,
  updated_at       timestamptz not null default now()
);
alter table public.restaurant add column if not exists recommendations_enabled boolean not null default true;
alter table public.restaurant add column if not exists ai_recommendations_enabled boolean not null default false;
alter table public.restaurant add column if not exists bundles_enabled boolean not null default false;
alter table public.restaurant add column if not exists bundle_discount_percent numeric(5,2) not null default 10;
alter table public.restaurant drop constraint if exists restaurant_bundle_discount_percent_check;
alter table public.restaurant add constraint restaurant_bundle_discount_percent_check
  check (bundle_discount_percent >= 0 and bundle_discount_percent <= 100);

create table if not exists public.dishes (
  id          text primary key,              -- matches the model file: pizza → pizza.glb
  name        text not null,
  description text not null default '',
  price       numeric(8,2) not null check (price >= 0),
  calories    text not null default '',
  prep_time   text not null default '',
  rating      text not null default '',
  size        text not null default '',
  serves      text not null default '',
  weight      text not null default '',
  icon        text not null default '🍽️',
  category    text not null default 'main',
  flavour     text[] not null default '{}',
  dietary     text[] not null default '{}',
  allergens   text[] not null default '{}',
  may_contain_allergens text[] not null default '{}',
  allergen_info_verified boolean not null default false,
  price_band  text not null default 'mid',
  meal_part   text not null default 'unspecified',
  promote     boolean not null default false,
  available   boolean not null default true,
  sort        int not null default 0,
  updated_at  timestamptz not null default now()
);

-- Safe migration for databases created before dish recommendation tags existed.
alter table public.dishes add column if not exists category text not null default 'main';
alter table public.dishes add column if not exists flavour text[] not null default '{}';
alter table public.dishes add column if not exists dietary text[] not null default '{}';
alter table public.dishes add column if not exists allergens text[] not null default '{}';
alter table public.dishes add column if not exists may_contain_allergens text[] not null default '{}';
alter table public.dishes add column if not exists allergen_info_verified boolean not null default false;
alter table public.dishes add column if not exists price_band text not null default 'mid';
alter table public.dishes add column if not exists meal_part text not null default 'unspecified';
alter table public.dishes add column if not exists promote boolean not null default false;

alter table public.dishes drop constraint if exists dishes_category_check;
alter table public.dishes add constraint dishes_category_check
  check (category in ('main', 'side', 'drink', 'dessert'));
alter table public.dishes drop constraint if exists dishes_dietary_check;
alter table public.dishes add constraint dishes_dietary_check
  check (dietary <@ array['veg', 'vegan', 'halal']::text[]);
alter table public.dishes drop constraint if exists dishes_allergens_check;
alter table public.dishes add constraint dishes_allergens_check
  check (allergens <@ array['celery', 'dairy', 'eggs', 'fish', 'gluten', 'mustard', 'nuts', 'peanuts', 'sesame', 'shellfish', 'soy', 'sulphites', 'wheat']::text[]);
alter table public.dishes drop constraint if exists dishes_may_contain_allergens_check;
alter table public.dishes add constraint dishes_may_contain_allergens_check
  check (may_contain_allergens <@ array['celery', 'dairy', 'eggs', 'fish', 'gluten', 'mustard', 'nuts', 'peanuts', 'sesame', 'shellfish', 'soy', 'sulphites', 'wheat']::text[]);
alter table public.dishes drop constraint if exists dishes_price_band_check;
alter table public.dishes add constraint dishes_price_band_check
  check (price_band in ('budget', 'mid', 'premium'));
alter table public.dishes drop constraint if exists dishes_meal_part_check;
alter table public.dishes add constraint dishes_meal_part_check
  check (meal_part in ('breakfast', 'lunch', 'dinner', 'any', 'unspecified'));

create table if not exists public.orders (
  id          uuid primary key default gen_random_uuid(),
  order_no    bigint generated always as identity (start with 1001) unique,
  table_label text,
  note        text,
  items       jsonb not null,                -- [{id, name, price, qty}] — prices frozen at order time
  subtotal    numeric(10,2) not null,
  bundle_discount numeric(10,2) not null default 0 check (bundle_discount >= 0),
  tax         numeric(10,2) not null,
  total       numeric(10,2) not null,
  status      text not null default 'new'
              check (status in ('new','preparing','ready','served','cancelled')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.orders add column if not exists bundle_discount numeric(10,2) not null default 0;
alter table public.orders drop constraint if exists orders_bundle_discount_check;
alter table public.orders add constraint orders_bundle_discount_check check (bundle_discount >= 0);
create index if not exists orders_created_at_idx on public.orders (created_at desc);

-- Store one row per pair of dishes in each served order, plus indexed totals.
create table if not exists public.order_dish_pairs (
  order_id uuid not null references public.orders (id) on delete cascade,
  dish_a   text not null references public.dishes (id) on delete cascade,
  dish_b   text not null references public.dishes (id) on delete cascade,
  primary key (order_id, dish_a, dish_b),
  check (dish_a < dish_b)
);

create table if not exists public.dish_pair_counts (
  dish_a      text not null references public.dishes (id) on delete cascade,
  dish_b      text not null references public.dishes (id) on delete cascade,
  order_count bigint not null check (order_count > 0),
  primary key (dish_a, dish_b),
  check (dish_a < dish_b)
);
create index if not exists dish_pair_counts_a_idx
  on public.dish_pair_counts (dish_a, order_count desc);
create index if not exists dish_pair_counts_b_idx
  on public.dish_pair_counts (dish_b, order_count desc);

create table if not exists public.ai_recommendation_cache (
  cache_key       text primary key,
  recommended_ids text[] not null default '{}',
  expires_at      timestamptz not null,
  created_at      timestamptz not null default now(),
  check (cardinality(recommended_ids) <= 3)
);
create index if not exists ai_recommendation_cache_expires_idx
  on public.ai_recommendation_cache (expires_at);

-- Owner accounts. Add a row here for each person allowed into the dashboard.
create table if not exists public.owners (
  user_id uuid primary key references auth.users (id) on delete cascade
);

-- ── updated_at bookkeeping ──────────────────────────────────────
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

drop trigger if exists restaurant_touch on public.restaurant;
create trigger restaurant_touch before update on public.restaurant for each row execute function public.touch_updated_at();
drop trigger if exists dishes_touch on public.dishes;
create trigger dishes_touch before update on public.dishes for each row execute function public.touch_updated_at();
drop trigger if exists orders_touch on public.orders;
create trigger orders_touch before update on public.orders for each row execute function public.touch_updated_at();

create or replace function public.update_dish_pair_count() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.dish_pair_counts as counts (dish_a, dish_b, order_count)
    values (new.dish_a, new.dish_b, 1)
    on conflict (dish_a, dish_b) do update
      set order_count = counts.order_count + 1;
    return new;
  end if;

  update public.dish_pair_counts
     set order_count = order_count - 1
   where dish_a = old.dish_a and dish_b = old.dish_b;
  delete from public.dish_pair_counts
   where dish_a = old.dish_a and dish_b = old.dish_b and order_count <= 0;
  return old;
end $$;

drop trigger if exists order_dish_pairs_count_insert on public.order_dish_pairs;
create trigger order_dish_pairs_count_insert after insert on public.order_dish_pairs
  for each row execute function public.update_dish_pair_count();
drop trigger if exists order_dish_pairs_count_delete on public.order_dish_pairs;
create trigger order_dish_pairs_count_delete after delete on public.order_dish_pairs
  for each row execute function public.update_dish_pair_count();
revoke all on function public.update_dish_pair_count() from public, anon, authenticated;

create or replace function public.populate_order_dish_pairs(p_order_id uuid, p_items jsonb)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if jsonb_typeof(p_items) is distinct from 'array' then return; end if;
  with order_items as (
    select distinct item.value ->> 'id' as dish_id
    from jsonb_array_elements(p_items) as item(value)
    join public.dishes d on d.id = item.value ->> 'id'
    where jsonb_typeof(item.value) = 'object'
      and nullif(item.value ->> 'id', '') is not null
  )
  insert into public.order_dish_pairs (order_id, dish_a, dish_b)
  select p_order_id, first_item.dish_id, second_item.dish_id
  from order_items first_item
  join order_items second_item on first_item.dish_id < second_item.dish_id
  on conflict (order_id, dish_a, dish_b) do nothing;
  return;
end $$;

create or replace function public.sync_order_dish_pairs() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'served' then
      perform public.populate_order_dish_pairs(new.id, new.items);
    end if;
    return new;
  end if;

  if old.status = 'served'
     and (new.status <> 'served' or old.items is distinct from new.items) then
    delete from public.order_dish_pairs where order_id = old.id;
  end if;
  if new.status = 'served'
     and (old.status <> 'served' or old.items is distinct from new.items) then
    perform public.populate_order_dish_pairs(new.id, new.items);
  end if;
  return new;
end $$;
revoke all on function public.populate_order_dish_pairs(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.sync_order_dish_pairs() from public, anon, authenticated;

drop trigger if exists orders_sync_dish_pairs on public.orders;
create trigger orders_sync_dish_pairs after insert or update of status, items on public.orders
  for each row execute function public.sync_order_dish_pairs();

-- Include past served orders on the first run; the unique keys make this safe to rerun.
with order_items as (
  select o.id as order_id, item.value ->> 'id' as dish_id
  from public.orders o
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(o.items) = 'array' then o.items else '[]'::jsonb end
  ) as item(value)
  join public.dishes d on d.id = item.value ->> 'id'
  where o.status = 'served'
    and jsonb_typeof(o.items) = 'array'
    and jsonb_typeof(item.value) = 'object'
    and nullif(item.value ->> 'id', '') is not null
  group by o.id, item.value ->> 'id'
)
insert into public.order_dish_pairs (order_id, dish_a, dish_b)
select first_item.order_id, first_item.dish_id, second_item.dish_id
from order_items first_item
join order_items second_item
  on first_item.order_id = second_item.order_id
 and first_item.dish_id < second_item.dish_id
on conflict (order_id, dish_a, dish_b) do nothing;

create or replace function public.popular_dish_pairings(p_dish_ids text[], p_limit int default 1000)
returns table (dish_id text, order_count bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(cardinality(p_dish_ids), 0) > 50 then
    raise exception 'TOO_MANY_DISH_IDS';
  end if;
  return query
    select case
             when pairs.dish_a = any(coalesce(p_dish_ids, array[]::text[])) then pairs.dish_b
             else pairs.dish_a
           end as related_dish_id,
           pairs.order_count
    from public.dish_pair_counts pairs
    where pairs.dish_a = any(coalesce(p_dish_ids, array[]::text[]))
       or pairs.dish_b = any(coalesce(p_dish_ids, array[]::text[]))
    order by pairs.order_count desc, related_dish_id
    limit greatest(1, least(coalesce(p_limit, 1000), 1000));
end $$;
revoke all on function public.popular_dish_pairings(text[], int) from public;
grant execute on function public.popular_dish_pairings(text[], int) to anon, authenticated;

-- ── Owner check ─────────────────────────────────────────────────
create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.owners where user_id = auth.uid());
$$;

-- ── Row level security ──────────────────────────────────────────
alter table public.restaurant enable row level security;
alter table public.dishes     enable row level security;
alter table public.orders     enable row level security;
alter table public.order_dish_pairs enable row level security;
alter table public.dish_pair_counts enable row level security;
alter table public.ai_recommendation_cache enable row level security;
alter table public.owners     enable row level security;

drop policy if exists "menu: anyone reads restaurant" on public.restaurant;
create policy "menu: anyone reads restaurant" on public.restaurant for select using (true);
drop policy if exists "owner: updates restaurant" on public.restaurant;
create policy "owner: updates restaurant" on public.restaurant for update to authenticated
  using (public.is_owner()) with check (public.is_owner());

drop policy if exists "menu: anyone reads dishes" on public.dishes;
create policy "menu: anyone reads dishes" on public.dishes for select using (true);
drop policy if exists "owner: manages dishes" on public.dishes;
create policy "owner: manages dishes" on public.dishes for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- No insert policy on orders: customers can only create them via place_order().
drop policy if exists "owner: reads orders" on public.orders;
create policy "owner: reads orders" on public.orders for select to authenticated using (public.is_owner());
drop policy if exists "owner: updates orders" on public.orders;
create policy "owner: updates orders" on public.orders for update to authenticated
  using (public.is_owner()) with check (public.is_owner());

drop policy if exists "owner: sees own owner row" on public.owners;
create policy "owner: sees own owner row" on public.owners for select to authenticated using (user_id = auth.uid());

-- ── Placing an order (called by the customer menu) ──────────────
-- Prices and discounts are recalculated in the database, not trusted from the browser.
drop function if exists public.place_order(text, jsonb, text);
create or replace function public.place_order(
  p_table text,
  p_items jsonb,
  p_note text default null,
  p_bundle jsonb default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_open  boolean;
  v_rate  numeric;
  v_bundles_enabled boolean;
  v_discount_percent numeric;
  v_req   int;
  v_ok    int;
  v_items jsonb;
  v_sub   numeric;
  v_bundle_sub numeric := 0;
  v_bundle_discount numeric := 0;
  v_bundle_ids text[] := '{}'::text[];
  v_dietary_filters text[] := '{}'::text[];
  v_allergen_filters text[] := '{}'::text[];
  v_bundle_count int;
  v_main_count int;
  v_drink_count int;
  v_dessert_count int;
  v_cart_bundle_count int;
  v_tax   numeric;
  v_id    uuid;
  v_no    bigint;
  v_total numeric;
begin
  select accepting_orders, tax_rate, bundles_enabled, bundle_discount_percent
    into v_open, v_rate, v_bundles_enabled, v_discount_percent
    from restaurant where id = 1;
  if not coalesce(v_open, false) then
    raise exception 'NOT_ACCEPTING' using hint = 'The kitchen is not taking orders right now';
  end if;

  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'BAD_ITEMS';
  end if;
  if jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 50 then
    raise exception 'BAD_ITEMS';
  end if;

  with req as (
    select x.id, sum(x.qty)::int as qty
    from jsonb_to_recordset(p_items) as x(id text, qty int)
    group by x.id
  )
  select count(*),
         count(d.id) filter (where d.available and req.qty between 1 and 20),
         coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'price', d.price, 'qty', req.qty)
                  order by d.sort) filter (where d.id is not null), '[]'::jsonb),
         coalesce(sum(d.price * req.qty), 0)
    into v_req, v_ok, v_items, v_sub
  from req left join dishes d on d.id = req.id;

  if v_ok <> v_req then
    raise exception 'UNAVAILABLE' using hint = 'Some dishes are sold out';
  end if;

  if p_bundle is not null then
    if jsonb_typeof(p_bundle) is distinct from 'object' then
      raise exception 'BAD_BUNDLE';
    end if;
    if jsonb_typeof(p_bundle -> 'ids') is distinct from 'array'
       or jsonb_typeof(p_bundle -> 'dietary_filters') is distinct from 'array'
       or jsonb_typeof(p_bundle -> 'allergen_filters') is distinct from 'array' then
      raise exception 'BAD_BUNDLE';
    end if;
    if jsonb_array_length(p_bundle -> 'ids') <> 3 then
      raise exception 'BAD_BUNDLE';
    end if;
    if exists (
      select 1 from jsonb_array_elements(p_bundle -> 'ids') as item(value)
      where jsonb_typeof(item.value) is distinct from 'string'
    ) then
      raise exception 'BAD_BUNDLE';
    end if;

    v_bundle_ids := array(select jsonb_array_elements_text(p_bundle -> 'ids'));
    if (select count(distinct id) from unnest(v_bundle_ids) as ids(id)) <> 3 then
      raise exception 'BAD_BUNDLE';
    end if;
    v_dietary_filters := array(select jsonb_array_elements_text(p_bundle -> 'dietary_filters'));
    v_allergen_filters := array(select jsonb_array_elements_text(p_bundle -> 'allergen_filters'));
    if not (v_dietary_filters <@ array['veg', 'vegan', 'halal']::text[])
       or not (v_allergen_filters <@ array['celery', 'dairy', 'eggs', 'fish', 'gluten', 'mustard', 'nuts', 'peanuts', 'sesame', 'shellfish', 'soy', 'sulphites', 'wheat']::text[]) then
      raise exception 'BAD_BUNDLE';
    end if;
    if not coalesce(v_bundles_enabled, false) or coalesce(v_discount_percent, 0) <= 0 then
      raise exception 'BUNDLE_UNAVAILABLE';
    end if;

    select count(*),
           count(*) filter (where category = 'main'),
           count(*) filter (where category = 'drink'),
           count(*) filter (where category = 'dessert'),
           coalesce(sum(price), 0)
      into v_bundle_count, v_main_count, v_drink_count, v_dessert_count, v_bundle_sub
      from public.dishes
     where id = any(v_bundle_ids) and available;
    if v_bundle_count <> 3 or v_main_count <> 1 or v_drink_count <> 1 or v_dessert_count <> 1 then
      raise exception 'BUNDLE_UNAVAILABLE';
    end if;

    select count(distinct item.id)
      into v_cart_bundle_count
      from jsonb_to_recordset(p_items) as item(id text, qty int)
     where item.id = any(v_bundle_ids) and item.qty >= 1;
    if v_cart_bundle_count <> 3 then
      raise exception 'BUNDLE_UNAVAILABLE';
    end if;

    if exists (
      select 1
        from public.dishes dish
       where dish.id = any(v_bundle_ids)
         and (
           (cardinality(v_dietary_filters) > 0 and not (v_dietary_filters <@ dish.dietary))
           or (cardinality(v_allergen_filters) > 0 and (
             not dish.allergen_info_verified
             or dish.allergens && v_allergen_filters
             or dish.may_contain_allergens && v_allergen_filters
           ))
         )
    ) then
      raise exception 'BUNDLE_UNAVAILABLE';
    end if;

    v_bundle_discount := round(v_bundle_sub * v_discount_percent / 100, 2);
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'type', 'discount',
      'name', 'Combo deal (' || v_discount_percent::text || '%)',
      'amount', v_bundle_discount,
      'bundle_ids', to_jsonb(v_bundle_ids)
    ));
  end if;

  v_tax := round((v_sub - v_bundle_discount) * v_rate, 2);

  insert into orders (table_label, note, items, subtotal, bundle_discount, tax, total)
  values (left(nullif(btrim(p_table), ''), 20), left(nullif(btrim(p_note), ''), 300),
          v_items, v_sub, v_bundle_discount, v_tax, v_sub - v_bundle_discount + v_tax)
  returning id, order_no, total into v_id, v_no, v_total;

  -- The id is unguessable, so it doubles as the customer's private key for order_status().
  return jsonb_build_object('id', v_id, 'order_no', v_no, 'total', v_total, 'bundle_discount', v_bundle_discount);
end $$;

revoke all on function public.place_order(text, jsonb, text, jsonb) from public;
grant execute on function public.place_order(text, jsonb, text, jsonb) to anon, authenticated;

-- ── Order status for the customer who placed it ─────────────────
-- Customers cannot read the orders table. Knowing an order's private id
-- (returned only to the phone that placed it) reveals just its number and status.
create or replace function public.order_status(p_order_id uuid)
returns table (order_no bigint, status text, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select o.order_no, o.status, o.updated_at
    from public.orders o
   where o.id = p_order_id
     and o.created_at > now() - interval '12 hours';
$$;
revoke all on function public.order_status(uuid) from public;
grant execute on function public.order_status(uuid) to anon, authenticated;

-- ── Live updates (dashboard gets new orders instantly; menu gets price changes) ──
do $$ begin
  begin alter publication supabase_realtime add table public.orders;     exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.dishes;     exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.restaurant; exception when duplicate_object then null; end;
end $$;

-- ── Starter data (matches the current menu) ─────────────────────
insert into public.restaurant (id) values (1) on conflict (id) do nothing;

insert into public.dishes (id, name, description, price, calories, prep_time, rating, size, serves, weight, icon, sort) values
  ('pizza',  'Margherita Pizza', 'Fresh tomato sauce, mozzarella cheese and aromatic basil.', 8.99,  '320 kcal', '15 min', '4.8', '12 inch',  '2-3 people', '400g', '🍕', 1),
  ('burger', 'Classic Burger',   'Juicy beef patty with melted cheese and crisp lettuce.',    11.99, '540 kcal', '10 min', '4.7', '5 inch',   '1 person',   '250g', '🍔', 2),
  ('drink',  'Fresh Lemonade',   'Cold pressed lemonade with fresh mint and lime.',           4.99,  '85 kcal',  '5 min',  '4.9', '350 ml',   '1 person',   '350g', '🥤', 3),
  ('pasta',  'Creamy Pasta',     'Rich creamy pasta with herbs, garlic and parmesan cheese.', 9.99,  '480 kcal', '12 min', '4.6', '300g',     '1 person',   '300g', '🍝', 4),
  ('sushi',  'Sushi Platter',    'Fresh sushi rolls with premium ingredients and wasabi.',    13.99, '310 kcal', '8 min',  '4.9', '5 pieces', '1 person',   '200g', '🍣', 5)
on conflict (id) do nothing;

-- Explicit starter tags. Dietary tags and meal timing are left unconfirmed
-- unless the source menu provides evidence; owners can verify them in the dashboard.
update public.dishes set
  category = case id when 'drink' then 'drink' else 'main' end,
  flavour = case id
    when 'pizza' then array['savory', 'tomato', 'cheesy']
    when 'burger' then array['savory', 'cheesy']
    when 'drink' then array['citrus', 'fresh']
    when 'pasta' then array['savory', 'creamy', 'herby']
    when 'sushi' then array['savory', 'umami', 'fresh']
    else flavour
  end,
  dietary = array[]::text[],
  price_band = case id
    when 'drink' then 'budget'
    when 'pizza' then 'mid'
    when 'pasta' then 'mid'
    else 'premium'
  end,
  meal_part = 'unspecified'
where id in ('pizza', 'burger', 'drink', 'pasta', 'sushi');

-- ── Make yourself the owner ─────────────────────────────────────
-- 1. Supabase → Authentication → Users → Add user (email + password).
-- 2. Then run this, with that email:
--    insert into public.owners (user_id)
--    select id from auth.users where email = 'owner@example.com';
