-- Live order status. Paste all of this into Supabase SQL Editor and click Run.

drop function if exists public.place_order(text, jsonb, text);
-- The old four-argument place_order() skipped the table QR check and duplicate
-- protection. It is removed here; the secure version lives in schema.sql.
drop function if exists public.place_order(text, jsonb, text, jsonb);

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
