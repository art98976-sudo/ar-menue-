-- Enable customer delivery and collection orders without weakening the QR-only
-- dine-in function. Run once in Supabase SQL Editor.
create or replace function public.place_order_home(
  p_items jsonb,
  p_note text,
  p_request_id uuid default null,
  p_order_type text default 'collection'
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_open boolean;
  v_rate numeric;
  v_req int;
  v_ok int;
  v_items jsonb;
  v_sub numeric;
  v_tax numeric;
  v_id uuid;
  v_no bigint;
  v_total numeric;
begin
  if p_request_id is not null then
    select id, order_no, total into v_id, v_no, v_total
      from public.orders where client_request_id = p_request_id;
    if found then
      return jsonb_build_object('id', v_id, 'order_no', v_no, 'total', v_total, 'duplicate', true);
    end if;
  end if;
  select accepting_orders, tax_rate into v_open, v_rate from public.restaurant where id = 1;
  if not coalesce(v_open, false) then raise exception 'NOT_ACCEPTING'; end if;
  if p_order_type not in ('delivery', 'collection') then raise exception 'ORDER_TYPE_UNAVAILABLE'; end if;
  if length(coalesce(btrim(p_note), '')) < 20 then raise exception 'CUSTOMER_DETAILS_REQUIRED'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 50 then
    raise exception 'BAD_ITEMS';
  end if;
  with req as (
    select x.id, sum(x.qty)::int qty from jsonb_to_recordset(p_items) as x(id text, qty int) group by x.id
  )
  select count(*), count(d.id) filter (where d.available and req.qty between 1 and 20),
         coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'price', d.price, 'qty', req.qty) order by d.sort), '[]'::jsonb),
         coalesce(sum(d.price * req.qty), 0)
    into v_req, v_ok, v_items, v_sub
    from req left join public.dishes d on d.id = req.id;
  if v_ok <> v_req then raise exception 'UNAVAILABLE'; end if;
  v_tax := round(v_sub * v_rate, 2);
  begin
    insert into public.orders (table_label, note, items, subtotal, bundle_discount, tax, total, client_request_id, order_type)
    values (null, left(nullif(btrim(p_note), ''), 300), v_items, v_sub, 0, v_tax, v_sub + v_tax, p_request_id, p_order_type)
    returning id, order_no, total into v_id, v_no, v_total;
  exception when unique_violation then
    select id, order_no, total into v_id, v_no, v_total from public.orders where client_request_id = p_request_id;
    return jsonb_build_object('id', v_id, 'order_no', v_no, 'total', v_total, 'duplicate', true);
  end;
  return jsonb_build_object('id', v_id, 'order_no', v_no, 'total', v_total, 'duplicate', false);
end $$;
revoke all on function public.place_order_home(jsonb, text, uuid, text) from public;
grant execute on function public.place_order_home(jsonb, text, uuid, text) to anon, authenticated;
