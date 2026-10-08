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
  updated_at       timestamptz not null default now()
);

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
  available   boolean not null default true,
  sort        int not null default 0,
  updated_at  timestamptz not null default now()
);

create table if not exists public.orders (
  id          uuid primary key default gen_random_uuid(),
  order_no    bigint generated always as identity (start with 1001) unique,
  table_label text,
  note        text,
  items       jsonb not null,                -- [{id, name, price, qty}] — prices frozen at order time
  subtotal    numeric(10,2) not null,
  tax         numeric(10,2) not null,
  total       numeric(10,2) not null,
  status      text not null default 'new'
              check (status in ('new','preparing','ready','served','cancelled')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists orders_created_at_idx on public.orders (created_at desc);

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

-- ── Owner check ─────────────────────────────────────────────────
create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.owners where user_id = auth.uid());
$$;

-- ── Row level security ──────────────────────────────────────────
alter table public.restaurant enable row level security;
alter table public.dishes     enable row level security;
alter table public.orders     enable row level security;
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
-- p_items: [{"id":"pizza","qty":2}, ...]. Prices, names and tax come from
-- the database, so a customer can't change what they pay.
create or replace function public.place_order(p_table text, p_items jsonb, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_open  boolean;
  v_rate  numeric;
  v_req   int;
  v_ok    int;
  v_items jsonb;
  v_sub   numeric;
  v_tax   numeric;
  v_no    bigint;
  v_total numeric;
begin
  select accepting_orders, tax_rate into v_open, v_rate from restaurant where id = 1;
  if not coalesce(v_open, false) then
    raise exception 'NOT_ACCEPTING' using hint = 'The kitchen is not taking orders right now';
  end if;

  if jsonb_typeof(p_items) is distinct from 'array'
     or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 50 then
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

  v_tax := round(v_sub * v_rate, 2);

  insert into orders (table_label, note, items, subtotal, tax, total)
  values (left(nullif(btrim(p_table), ''), 20), left(nullif(btrim(p_note), ''), 300),
          v_items, v_sub, v_tax, v_sub + v_tax)
  returning order_no, total into v_no, v_total;

  return jsonb_build_object('order_no', v_no, 'total', v_total);
end $$;

revoke all on function public.place_order(text, jsonb, text) from public;
grant execute on function public.place_order(text, jsonb, text) to anon, authenticated;

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

-- ── Make yourself the owner ─────────────────────────────────────
-- 1. Supabase → Authentication → Users → Add user (email + password).
-- 2. Then run this, with that email:
--    insert into public.owners (user_id)
--    select id from auth.users where email = 'owner@example.com';
