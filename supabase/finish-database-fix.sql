-- Remaining database fix (steps 4 and 5). Paste all of this into Supabase SQL Editor and click Run.

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
  returning order_no, total into v_no, v_total;

  return jsonb_build_object('order_no', v_no, 'total', v_total, 'bundle_discount', v_bundle_discount);
end $$;

revoke all on function public.place_order(text, jsonb, text, jsonb) from public;
grant execute on function public.place_order(text, jsonb, text, jsonb) to anon, authenticated;

-- ── Live updates (dashboard gets new orders instantly; menu gets price changes) ──
do $$ begin
  begin alter publication supabase_realtime add table public.orders;     exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.dishes;     exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.restaurant; exception when duplicate_object then null; end;
end $$;

notify pgrst, 'reload schema';
