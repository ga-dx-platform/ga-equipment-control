-- 014_system_settings.sql
-- Single-row settings table for manager-controlled feature toggles.
-- Managers can enable/disable borrow signature and return rating/signature
-- requirements via the Settings tab in the UI.

create table if not exists public.system_settings (
  id                        int          primary key default 1,
  require_borrow_signature  boolean      not null default false,
  require_return_rating     boolean      not null default false,
  updated_at                timestamptz  not null default now(),
  constraint single_row check (id = 1)
);

-- Seed the default row (both features OFF — safe fallback matches app default)
insert into public.system_settings (id, require_borrow_signature, require_return_rating)
values (1, false, false)
on conflict (id) do nothing;

-- RLS: anon role can read and update (app uses anon, not Supabase Auth)
alter table public.system_settings enable row level security;

create policy "anon_read_system_settings"
  on public.system_settings for select
  to anon using (true);

create policy "anon_update_system_settings"
  on public.system_settings for update
  to anon using (true) with check (true);
