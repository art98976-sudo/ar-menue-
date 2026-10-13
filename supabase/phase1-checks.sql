-- Database checks for ordering (dine-in, delivery, collection) and order tracking. Run AFTER phase1-dine-in.sql.
-- Everything happens inside one block that ends with an error on purpose, so
-- every test table and test order is rolled back and nothing reaches the kitchen.
-- The error message IS the report: each check is listed as PASS or FAIL.
do $$
declare
  good_key text := replace(gen_random_uuid()::text, '-', '');
  rid uuid := gen_random_uuid();
  r1 jsonb; r2 jsonb; r3 jsonb;
  n int; report text := '';
  ok boolean;
  s record;
  items constant jsonb := '[{"id":"sushi","qty":1}]';

  function_result text;
begin
  insert into public.restaurant_tables (label, qr_key, active) values
    ('CHECK1', good_key, true),
    ('CHECK2', replace(gen_random_uuid()::text, '-', ''), false);

  -- 1. A real table with its secret code is accepted and tagged dine-in.
  r1 := public.place_order('CHECK1', items, 'phase1 check', null, rid, 'dine_in', good_key);
  select order_type, table_label into s from public.orders where id = (r1->>'id')::uuid;
  report := report || E'\n' || case when s.order_type = 'dine_in' and s.table_label = 'CHECK1' then 'PASS' else 'FAIL' end
    || ' | real table + code -> dine-in order for that table';

  -- 2-6. Everything that is not a real, active table with its code is refused.
  foreach function_result in array array['wrong code', 'no table', 'switched-off table', 'table typed without code', 'unknown table'] loop
    begin
      case function_result
        when 'wrong code' then perform public.place_order('CHECK1', items, null, null, null, 'dine_in', 'not-the-code');
        when 'no table' then perform public.place_order(null, items, null, null, null, 'dine_in', null);
        when 'switched-off table' then
          perform public.place_order('CHECK2', items, null, null, null, 'dine_in',
            (select qr_key from public.restaurant_tables where label = 'CHECK2'));
        when 'table typed without code' then perform public.place_order('CHECK1', items, null, null, null, 'dine_in', null);
        else perform public.place_order('NOPE99', items, null, null, null, 'dine_in', good_key);
      end case;
      report := report || E'\nFAIL | ' || function_result || ' was accepted';
    exception when others then
      report := report || E'\n' || case when sqlerrm = 'BAD_TABLE' then 'PASS' else 'FAIL (' || sqlerrm || ')' end
        || ' | ' || function_result || ' -> refused';
    end;
  end loop;

  -- 7. Delivery needs the customer's details, and unknown order types are refused.
  begin
    perform public.place_order('CHECK1', items, null, null, null, 'delivery', good_key);
    report := report || E'\nFAIL | delivery accepted without customer details';
  exception when others then
    report := report || E'\n' || case when sqlerrm = 'CUSTOMER_DETAILS_REQUIRED' then 'PASS' else 'FAIL (' || sqlerrm || ')' end
      || ' | delivery without customer details refused';
  end;
  begin
    perform public.place_order('CHECK1', items, null, null, null, 'drive_thru', good_key);
    report := report || E'\nFAIL | unknown order type accepted';
  exception when others then
    report := report || E'\n' || case when sqlerrm = 'ORDER_TYPE_UNAVAILABLE' then 'PASS' else 'FAIL (' || sqlerrm || ')' end
      || ' | unknown order type refused';
  end;

  -- 8. check_table answers only yes or no.
  ok := public.check_table('CHECK1', good_key) and not public.check_table('CHECK1', 'nope')
    and not public.check_table('CHECK2', (select qr_key from public.restaurant_tables where label = 'CHECK2'))
    and not public.check_table(null, null);
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || ' | table check: yes only for a real, active table';

  -- 9. Same checkout attempt sent twice gives one order.
  r2 := public.place_order('CHECK1', items, 'phase1 check', null, rid, 'dine_in', good_key);
  select count(*) into n from public.orders where client_request_id = rid;
  ok := (r1->>'id') = (r2->>'id') and n = 1 and (r2->>'duplicate')::boolean;
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || ' | same attempt twice -> one order';

  -- 10. Two separate orders from the same table stay separate.
  r3 := public.place_order('CHECK1', '[{"id":"pizza","qty":1}]'::jsonb, 'phase1 check', null, gen_random_uuid(), 'dine_in', good_key);
  ok := (r3->>'id') <> (r1->>'id');
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || ' | two orders from one table stay separate';

  -- 11. The phone's lookup returns type and table for its own orders.
  select count(*) into n from public.order_statuses(array[(r1->>'id')::uuid, (r3->>'id')::uuid])
   where order_type = 'dine_in' and table_label = 'CHECK1';
  report := report || E'\n' || case when n = 2 then 'PASS' else 'FAIL' end || ' | lookup returns type and table';

  -- 12. Made-up ids return nothing.
  select count(*) into n from public.order_statuses(array[gen_random_uuid(), gen_random_uuid()]);
  ok := n = 0;
  select count(*) into n from public.recover_order(gen_random_uuid());
  ok := ok and n = 0;
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || ' | made-up order or request ids return nothing';

  -- 13. Recovery after a reload finds the order by its request id.
  select count(*) into n from public.recover_order(rid) where id = (r1->>'id')::uuid;
  report := report || E'\n' || case when n = 1 then 'PASS' else 'FAIL' end || ' | reload mid-order: recover by request id';

  -- 14. More than 20 ids is refused.
  begin
    perform public.order_statuses(array(select gen_random_uuid() from generate_series(1, 21)));
    report := report || E'\nFAIL | 21 ids accepted';
  exception when others then
    report := report || E'\n' || case when sqlerrm like '%TOO_MANY_ORDERS%' then 'PASS' else 'FAIL' end || ' | more than 20 ids refused';
  end;

  -- 15. Paid, then cancelled: refund due.
  update public.orders set paid_at = now() where id = (r1->>'id')::uuid;
  update public.orders set status = 'cancelled' where id = (r1->>'id')::uuid;
  select * into s from public.order_statuses(array[(r1->>'id')::uuid]);
  report := report || E'\n' || case when s.status = 'cancelled' and s.paid and not s.refunded then 'PASS' else 'FAIL' end
    || ' | cancelled after payment shows refund due';

  -- 16. A refund cannot be recorded for an unpaid order.
  begin
    update public.orders set refunded_at = now() where id = (r3->>'id')::uuid;
    report := report || E'\nFAIL | refund without payment accepted';
  exception when check_violation then
    report := report || E'\nPASS | refund without payment refused';
  end;

  -- 17. Error log keeps short entries.
  perform public.log_client_error('phase1_check', repeat('x', 900), '/index.html?table=CHECK1', 'checker');
  select length(message) into n from public.client_errors where context = 'phase1_check' order by id desc limit 1;
  report := report || E'\n' || case when n = 500 then 'PASS' else 'FAIL' end || ' | error log trims entries to 500 characters';

  -- 18. With the customer key: no orders, no error log, and no table secrets.
  perform set_config('role', 'anon', true);
  select count(*) into n from public.orders;
  ok := n = 0;
  select count(*) into n from public.client_errors;
  ok := ok and n = 0;
  select count(*) into n from public.restaurant_tables;
  ok := ok and n = 0;
  perform set_config('role', 'postgres', true);
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end
    || ' | customer key cannot read orders, error log or table codes';

  raise exception 'PHASE 1 CHECKS (all test data rolled back):%', report;
end $$;
