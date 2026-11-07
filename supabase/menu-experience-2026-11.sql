-- ════════════════════════════════════════════════════════════════
-- MenuVision customer menu: "Most viewed in AR" badges (November 2026)
--
-- Run in Supabase → SQL Editor AFTER supabase/dashboard-upgrade-2026-11.sql
-- (which creates public.menu_events). Safe to run again.
--
-- Returns only the ids of the most-viewed dishes, never counts or any
-- personal data. A dish needs at least 5 AR views in the period to qualify.
-- ════════════════════════════════════════════════════════════════

create or replace function public.top_ar_dishes(p_days int default 14, p_limit int default 2)
returns table (dish_id text)
language sql stable security definer set search_path = public as $$
  select e.dish_id
    from public.menu_events e
    join public.dishes d on d.id = e.dish_id and d.available
   where e.kind = 'ar_view'
     and e.created_at >= now() - make_interval(days => least(greatest(coalesce(p_days, 14), 1), 90))
   group by e.dish_id
  having count(*) >= 5
   order by count(*) desc, e.dish_id
   limit least(greatest(coalesce(p_limit, 2), 1), 5);
$$;
revoke all on function public.top_ar_dishes(int, int) from public;
grant execute on function public.top_ar_dishes(int, int) to anon, authenticated;
