-- ════════════════════════════════════════════════════════════════
-- MenuVision dashboard upgrade (November 2026)
--
-- Run once in Supabase → SQL Editor. Safe to run again.
-- Adds:
--   1. Dish photos, restaurant logo and brand colour.
--   2. A public "menu-media" storage bucket that only owners can write to.
--   3. Anonymous menu analytics: menu opens, "View on table" taps and
--      recommendation taps. No personal data is stored.
--
-- The dashboard and customer menu keep working without this file; the new
-- features just show a "run the upgrade" message until it has been applied.
-- ════════════════════════════════════════════════════════════════

-- ── 1. Photos and branding ──────────────────────────────────────
alter table public.dishes add column if not exists image_url text not null default '';
alter table public.restaurant add column if not exists logo_url text not null default '';
alter table public.restaurant add column if not exists brand_color text not null default '#D4AF37';

alter table public.restaurant drop constraint if exists restaurant_brand_color_hex;
alter table public.restaurant add constraint restaurant_brand_color_hex
  check (brand_color ~ '^#[0-9A-Fa-f]{6}$');

alter table public.dishes drop constraint if exists dishes_image_url_https;
alter table public.dishes add constraint dishes_image_url_https
  check (image_url = '' or image_url ~ '^https://');

alter table public.restaurant drop constraint if exists restaurant_logo_url_https;
alter table public.restaurant add constraint restaurant_logo_url_https
  check (logo_url = '' or logo_url ~ '^https://');

-- ── 2. Storage for photos and logos ─────────────────────────────
-- Public read (customer phones load the images), owner-only write.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('menu-media', 'menu-media', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "menu-media: owners upload" on storage.objects;
create policy "menu-media: owners upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'menu-media' and public.is_owner());

drop policy if exists "menu-media: owners replace" on storage.objects;
create policy "menu-media: owners replace" on storage.objects for update to authenticated
  using (bucket_id = 'menu-media' and public.is_owner())
  with check (bucket_id = 'menu-media' and public.is_owner());

drop policy if exists "menu-media: owners delete" on storage.objects;
create policy "menu-media: owners delete" on storage.objects for delete to authenticated
  using (bucket_id = 'menu-media' and public.is_owner());

-- ── 3. Menu analytics ───────────────────────────────────────────
create table if not exists public.menu_events (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  kind       text not null check (kind in ('menu_view', 'ar_view', 'rec_click')),
  dish_id    text
);
create index if not exists menu_events_created_at_idx on public.menu_events (created_at desc);

-- No table policies: phones write only through log_menu_event and owners
-- read only through menu_event_daily.
alter table public.menu_events enable row level security;

create or replace function public.log_menu_event(p_kind text, p_dish text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_kind is null or p_kind not in ('menu_view', 'ar_view', 'rec_click') then return; end if;
  -- Guard against floods: at most 600 events a minute across all phones.
  if (select count(*) from public.menu_events where created_at > now() - interval '1 minute') >= 600 then
    return;
  end if;
  insert into public.menu_events (kind, dish_id)
  values (p_kind, nullif(left(btrim(coalesce(p_dish, '')), 60), ''));
end $$;
revoke all on function public.log_menu_event(text, text) from public;
grant execute on function public.log_menu_event(text, text) to anon, authenticated;

-- Daily totals per event type and dish, in UK time, for the owner dashboard.
create or replace function public.menu_event_daily(p_days int default 14)
returns table (event_day date, event_kind text, event_dish text, events bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'NOT_OWNER'; end if;
  return query
    select (e.created_at at time zone 'Europe/London')::date,
           e.kind,
           e.dish_id,
           count(*)
      from public.menu_events e
     where e.created_at >= now() - make_interval(days => least(greatest(coalesce(p_days, 14), 1), 90))
     group by 1, 2, 3;
end $$;
revoke all on function public.menu_event_daily(int) from public;
grant execute on function public.menu_event_daily(int) to authenticated;
