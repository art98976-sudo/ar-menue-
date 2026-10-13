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
-- The secure seven-argument place_order() is defined in schema.sql. Remove
-- any obsolete four-argument overload, which bypasses table QR validation
-- and request-id duplicate protection.
drop function if exists public.place_order(text, jsonb, text, jsonb);

-- ── Live updates (dashboard gets new orders instantly; menu gets price changes) ──
do $$ begin
  begin alter publication supabase_realtime add table public.orders;     exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.dishes;     exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.restaurant; exception when duplicate_object then null; end;
end $$;

notify pgrst, 'reload schema';

-- Shared table ordering and richer dish nutrition data. Run this after the
-- main schema so restaurant_tables, dishes, and orders already exist.
alter table public.dishes add column if not exists ingredients text[] not null default '{}';
alter table public.dishes add column if not exists calories_per_100g numeric(8,2) not null default 0;
alter table public.dishes add column if not exists portion_grams numeric(8,2) not null default 0;
alter table public.dishes drop constraint if exists dishes_calories_per_100g_check;
alter table public.dishes add constraint dishes_calories_per_100g_check check (calories_per_100g >= 0);
alter table public.dishes drop constraint if exists dishes_portion_grams_check;
alter table public.dishes add constraint dishes_portion_grams_check check (portion_grams >= 0);

create table if not exists public.table_sessions (
  id uuid primary key default gen_random_uuid(), table_label text not null references public.restaurant_tables(label) on delete cascade,
  started_at timestamptz not null default now(), expires_at timestamptz not null default (now() + interval '6 hours'),
  status text not null default 'open' check (status in ('open', 'closed'))
);
create unique index if not exists table_sessions_one_open_idx on public.table_sessions (table_label) where status = 'open';
create table if not exists public.table_session_items (
  session_id uuid not null references public.table_sessions(id) on delete cascade,
  dish_id text not null references public.dishes(id) on delete cascade,
  qty int not null check (qty between 1 and 20), updated_at timestamptz not null default now(), primary key (session_id, dish_id)
);
-- get_table_board reads a table's orders since its session started, every few seconds per open basket.
create index if not exists orders_table_created_idx on public.orders (table_label, created_at);
alter table public.table_sessions enable row level security;
alter table public.table_session_items enable row level security;

create or replace function public.get_table_board(p_table text, p_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_session uuid; v_started timestamptz;
begin
  if not public.check_table(p_table, p_key) then raise exception 'BAD_TABLE'; end if;
  -- Most calls find the open session and only read; expired sessions are closed only when a new one is needed.
  select id, started_at into v_session, v_started from public.table_sessions where table_label = btrim(p_table) and status = 'open' and expires_at > now() order by started_at desc limit 1;
  if v_session is null then
    update public.table_sessions set status = 'closed' where table_label = btrim(p_table) and status = 'open' and expires_at <= now();
    begin insert into public.table_sessions (table_label) values (btrim(p_table)) returning id, started_at into v_session, v_started;
    exception when unique_violation then select id, started_at into v_session, v_started from public.table_sessions where table_label = btrim(p_table) and status = 'open' order by started_at desc limit 1; end;
  end if;
  return jsonb_build_object('session_id', v_session, 'table', btrim(p_table),
    'basket', coalesce((select jsonb_agg(jsonb_build_object('id', i.dish_id, 'name', d.name, 'qty', i.qty, 'price', d.price) order by d.sort) from public.table_session_items i join public.dishes d on d.id = i.dish_id where i.session_id = v_session), '[]'::jsonb),
    'orders', coalesce((select jsonb_agg(jsonb_build_object('order_no', o.order_no, 'status', o.status, 'total', o.total, 'created_at', o.created_at) order by o.created_at) from public.orders o where o.table_label = btrim(p_table) and o.created_at >= v_started and o.status <> 'cancelled'), '[]'::jsonb));
end $$;

create or replace function public.add_table_board_items(p_table text, p_key text, p_session_id uuid, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_req int; v_ok int;
begin
  if not public.check_table(p_table, p_key) then raise exception 'BAD_TABLE'; end if;
  if not exists (select 1 from public.table_sessions where id = p_session_id and table_label = btrim(p_table) and status = 'open' and expires_at > now()) then raise exception 'BAD_SESSION'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 50 then raise exception 'BAD_ITEMS'; end if;
  with req as (select x.id, sum(x.qty)::int qty from jsonb_to_recordset(p_items) as x(id text, qty int) group by x.id) select count(*), count(d.id) filter (where d.available and req.qty between 1 and 20) into v_req, v_ok from req left join public.dishes d on d.id = req.id;
  if v_ok <> v_req then raise exception 'UNAVAILABLE'; end if;
  insert into public.table_session_items (session_id, dish_id, qty) select p_session_id, x.id, x.qty from jsonb_to_recordset(p_items) as x(id text, qty int) on conflict (session_id, dish_id) do update set qty = least(20, table_session_items.qty + excluded.qty), updated_at = now();
  return public.get_table_board(p_table, p_key);
end $$;

create or replace function public.consume_table_board_items(p_table text, p_key text, p_session_id uuid, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.check_table(p_table, p_key) then raise exception 'BAD_TABLE'; end if;
  if not exists (select 1 from public.table_sessions where id = p_session_id and table_label = btrim(p_table)) then raise exception 'BAD_SESSION'; end if;
  update public.table_session_items i set qty = i.qty - x.qty, updated_at = now() from jsonb_to_recordset(p_items) as x(id text, qty int) where i.session_id = p_session_id and i.dish_id = x.id;
  delete from public.table_session_items where session_id = p_session_id and qty <= 0;
  return public.get_table_board(p_table, p_key);
end $$;
revoke all on function public.get_table_board(text, text) from public, anon, authenticated;
revoke all on function public.add_table_board_items(text, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.consume_table_board_items(text, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.get_table_board(text, text) to anon, authenticated;
grant execute on function public.add_table_board_items(text, text, uuid, jsonb) to anon, authenticated;
grant execute on function public.consume_table_board_items(text, text, uuid, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';

update public.dishes set
  ingredients = case id when 'pizza' then array['wheat flour','tomato','mozzarella','basil','olive oil'] when 'burger' then array['beef','brioche bun','cheddar','lettuce','tomato','sauce'] when 'drink' then array['lemon','lime','mint','water','sugar'] when 'pasta' then array['wheat pasta','cream','parmesan','garlic','herbs'] when 'sushi' then array['rice','nori','salmon','avocado','cucumber','wasabi'] else ingredients end,
  calories_per_100g = case id when 'pizza' then 80 when 'burger' then 216 when 'drink' then 24.2857 when 'pasta' then 160 when 'sushi' then 155 else calories_per_100g end,
  portion_grams = case id when 'pizza' then 400 when 'burger' then 250 when 'drink' then 350 when 'pasta' then 300 when 'sushi' then 200 else portion_grams end
where id in ('pizza','burger','drink','pasta','sushi');

-- Keep AI recommendations off until the Edge Function has a valid provider
-- key and billing. The normal recommendation system remains available.
update public.restaurant set ai_recommendations_enabled = false where id = 1;
update public.dishes set price = 10.85 where id = 'burger';

-- Verified allergen data for the starter recipes. Update these values in the
-- owner dashboard if supplier or cross-contamination records differ.
update public.dishes set
  allergens = case id
    when 'pizza' then array['dairy','gluten']::text[]
    when 'burger' then array['dairy','gluten']::text[]
    when 'drink' then array[]::text[]
    when 'pasta' then array['dairy','gluten']::text[]
    when 'sushi' then array['fish']::text[]
    else allergens
  end,
  may_contain_allergens = array[]::text[],
  allergen_info_verified = true
where id in ('pizza','burger','drink','pasta','sushi');
