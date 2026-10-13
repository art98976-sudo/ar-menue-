-- ════════════════════════════════════════════════════════════════
-- MenuVision Phase 1: dine-in ordering, plus order tracking v2.
-- Run this whole file once in Supabase → SQL Editor. Safe to run again.
--
-- What it adds, in plain English:
--   • Every order has a type: dine_in, delivery or collection.
--   • A list of your tables. Each has a secret code that goes into its QR
--     code, so a dine-in order is only accepted from a real table.
--   • Duplicate-proof ordering, payment and refund tracking, recovery after
--     a reload, and a quiet error log (order tracking v2).
-- ════════════════════════════════════════════════════════════════

-- ── Tables in the restaurant ────────────────────────────────────
-- qr_key is the table's secret. Customers can never read this table; they can
-- only ask check_table() whether a table number and code match.
create table if not exists public.restaurant_tables (
  label      text primary key check (label ~ '^[A-Za-z0-9_-]{1,20}$'),
  qr_key     text not null default replace(gen_random_uuid()::text, '-', '') check (length(qr_key) >= 24),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.restaurant_tables enable row level security;
drop policy if exists "owner: manages tables" on public.restaurant_tables;
create policy "owner: manages tables" on public.restaurant_tables for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

create or replace function public.check_table(p_table text, p_key text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.restaurant_tables t
     where t.label = btrim(p_table) and t.active and t.qr_key = p_key
  );
$$;
revoke all on function public.check_table(text, text) from public;
grant execute on function public.check_table(text, text) to anon, authenticated;

-- ── Order type ──────────────────────────────────────────────────
-- Orders placed before this update were all made at the restaurant.
alter table public.orders add column if not exists order_type text not null default 'dine_in';
alter table public.orders drop constraint if exists orders_order_type_check;
alter table public.orders add constraint orders_order_type_check
  check (order_type in ('dine_in', 'delivery', 'collection'));

-- ── New order columns ───────────────────────────────────────────
-- client_request_id: random id the phone creates for each checkout attempt.
--   Sending the same attempt twice (double tap, retry after a timeout)
--   returns the first order instead of creating a second one.
-- paid_at / refunded_at: set by the owner in the dashboard.
alter table public.orders add column if not exists client_request_id uuid;
alter table public.orders add column if not exists paid_at timestamptz;
alter table public.orders add column if not exists refunded_at timestamptz;
create unique index if not exists orders_client_request_id_key
  on public.orders (client_request_id) where client_request_id is not null;
alter table public.orders drop constraint if exists orders_refund_needs_payment_check;
alter table public.orders add constraint orders_refund_needs_payment_check
  check (refunded_at is null or paid_at is not null);

-- ── Placing an order ────────────────────────────────────────────
-- Duplicate-proof. A dine-in order needs a real table and its secret code;
-- delivery and collection orders need the customer's details. Kept identical to schema.sql.
drop function if exists public.place_order(text, jsonb, text);
drop function if exists public.place_order(text, jsonb, text, jsonb);
drop function if exists public.place_order(text, jsonb, text, jsonb, uuid);
create or replace function public.place_order(
  p_table text,
  p_items jsonb,
  p_note text default null,
  p_bundle jsonb default null,
  p_request_id uuid default null,
  p_order_type text default 'dine_in',
  p_table_key text default null
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
  v_table text;
begin
  -- Same checkout attempt sent again: hand back the order it already created.
  if p_request_id is not null then
    select o.id, o.order_no, o.total, o.bundle_discount
      into v_id, v_no, v_total, v_bundle_discount
      from public.orders o where o.client_request_id = p_request_id;
    if found then
      return jsonb_build_object('id', v_id, 'order_no', v_no, 'total', v_total,
                                'bundle_discount', v_bundle_discount, 'duplicate', true);
    end if;
  end if;

  select accepting_orders, tax_rate, bundles_enabled, bundle_discount_percent
    into v_open, v_rate, v_bundles_enabled, v_discount_percent
    from restaurant where id = 1;
  if not coalesce(v_open, false) then
    raise exception 'NOT_ACCEPTING' using hint = 'The kitchen is not taking orders right now';
  end if;

  if p_order_type not in ('dine_in', 'delivery', 'collection') then
    raise exception 'ORDER_TYPE_UNAVAILABLE' using hint = 'This order type is not available';
  end if;
  if p_order_type = 'dine_in' then
    select t.label into v_table
      from public.restaurant_tables t
     where t.label = btrim(p_table) and t.active and t.qr_key = p_table_key;
    if v_table is null then
      raise exception 'BAD_TABLE' using hint = 'This table code is not recognised';
    end if;
  else
    v_table := null;
    if length(coalesce(btrim(p_note), '')) < 20 then
      raise exception 'CUSTOMER_DETAILS_REQUIRED' using hint = 'Name and contact details are required';
    end if;
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

  begin
    insert into orders (table_label, note, items, subtotal, bundle_discount, tax, total, client_request_id, order_type)
    values (v_table, left(nullif(btrim(p_note), ''), 300),
            v_items, v_sub, v_bundle_discount, v_tax, v_sub - v_bundle_discount + v_tax, p_request_id, p_order_type)
    returning id, order_no, total into v_id, v_no, v_total;
  exception when unique_violation then
    -- Two copies of the same attempt arrived at the same moment: the other one won.
    select o.id, o.order_no, o.total, o.bundle_discount
      into v_id, v_no, v_total, v_bundle_discount
      from public.orders o where o.client_request_id = p_request_id;
    return jsonb_build_object('id', v_id, 'order_no', v_no, 'total', v_total,
                              'bundle_discount', v_bundle_discount, 'duplicate', true);
  end;

  -- The id is unguessable, so it doubles as the customer's private key for order_statuses().
  return jsonb_build_object('id', v_id, 'order_no', v_no, 'total', v_total,
                            'bundle_discount', v_bundle_discount, 'duplicate', false);
end $$;

revoke all on function public.place_order(text, jsonb, text, jsonb, uuid, text, text) from public;
grant execute on function public.place_order(text, jsonb, text, jsonb, uuid, text, text) to anon, authenticated;

-- ── Status of the orders a phone placed ─────────────────────────
-- Customers cannot read the orders table. A phone sends the private ids of
-- its own orders (at most 20) and gets back only those orders.
drop function if exists public.order_statuses(uuid[]);
create or replace function public.order_statuses(p_order_ids uuid[])
returns table (id uuid, order_no bigint, status text, total numeric, paid boolean, refunded boolean,
               updated_at timestamptz, order_type text, table_label text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if coalesce(cardinality(p_order_ids), 0) > 20 then
    raise exception 'TOO_MANY_ORDERS';
  end if;
  return query
    select o.id, o.order_no, o.status, o.total, o.paid_at is not null, o.refunded_at is not null, o.updated_at,
           o.order_type, o.table_label
      from public.orders o
     where o.id = any(coalesce(p_order_ids, array[]::uuid[]))
       and o.created_at > now() - interval '12 hours';
end $$;
revoke all on function public.order_statuses(uuid[]) from public;
grant execute on function public.order_statuses(uuid[]) to anon, authenticated;

-- ── Find an order after the page reloaded mid-checkout ──────────
-- Only the phone that created the random request id can know it.
-- Returns the order type and table too, so a recovered order shows where it was placed.
drop function if exists public.recover_order(uuid);
create or replace function public.recover_order(p_request_id uuid)
returns table (id uuid, order_no bigint, total numeric, status text, order_type text, table_label text)
language sql stable security definer set search_path = public as $$
  select o.id, o.order_no, o.total, o.status, o.order_type, o.table_label
    from public.orders o
   where p_request_id is not null
     and o.client_request_id = p_request_id
     and o.created_at > now() - interval '1 hour';
$$;
revoke all on function public.recover_order(uuid) from public;
grant execute on function public.recover_order(uuid) to anon, authenticated;

-- ── Quiet error log from customer phones ────────────────────────
-- Phones can add a short entry; only the owner can read them.
create table if not exists public.client_errors (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  context    text not null,
  message    text not null,
  page       text,
  user_agent text
);
create index if not exists client_errors_created_at_idx on public.client_errors (created_at desc);
alter table public.client_errors enable row level security;
drop policy if exists "owner: reads client errors" on public.client_errors;
create policy "owner: reads client errors" on public.client_errors for select to authenticated
  using (public.is_owner());

create or replace function public.log_client_error(
  p_context text, p_message text, p_page text default null, p_user_agent text default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  -- Guard against floods: at most 60 entries a minute across all phones.
  if (select count(*) from public.client_errors where created_at > now() - interval '1 minute') >= 60 then
    return;
  end if;
  insert into public.client_errors (context, message, page, user_agent)
  values (left(coalesce(nullif(btrim(p_context), ''), 'unknown'), 60),
          left(coalesce(p_message, ''), 500),
          left(p_page, 200),
          left(p_user_agent, 200));
  delete from public.client_errors where created_at < now() - interval '30 days';
end $$;
revoke all on function public.log_client_error(text, text, text, text) from public;
grant execute on function public.log_client_error(text, text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
