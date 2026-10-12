-- Live order status. Paste all of this into Supabase SQL Editor and click Run.

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

notify pgrst, 'reload schema';
