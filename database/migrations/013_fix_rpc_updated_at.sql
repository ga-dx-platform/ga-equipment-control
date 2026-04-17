-- 013_fix_rpc_updated_at.sql
-- Fix for 011_tighten_rls_and_rpcs.sql: the live users table does not
-- have an `updated_at` column (only the schema in 001_init.sql does;
-- the live table was created/modified via Dashboard without it),
-- so every call to update_user_pin / update_user_categories errored
-- with Postgres 42703 "column updated_at of relation users does not exist".
--
-- Re-create the RPCs without touching updated_at.
-- deactivate_user was unaffected (already didn't reference updated_at) —
-- re-created here for completeness so all three RPCs live in one place.

create or replace function public.update_user_pin(p_user_id uuid, p_new_hash text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  rows_affected int;
begin
  if p_new_hash is null or length(p_new_hash) < 32 then
    raise exception 'invalid_pin_hash';
  end if;
  update public.users
     set pin_hash = p_new_hash
   where id = p_user_id and is_active = true;
  get diagnostics rows_affected = row_count;
  return rows_affected > 0;
end $$;

revoke all on function public.update_user_pin(uuid, text) from public;
grant execute on function public.update_user_pin(uuid, text) to anon, authenticated;

create or replace function public.update_user_categories(p_name text, p_categories text[])
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  rows_affected int;
begin
  update public.users
     set allowed_categories = p_categories
   where full_name = p_name and role = 'ga';
  get diagnostics rows_affected = row_count;
  return rows_affected > 0;
end $$;

revoke all on function public.update_user_categories(text, text[]) from public;
grant execute on function public.update_user_categories(text, text[]) to anon, authenticated;

-- deactivate_user stays the same (no updated_at), re-declared for completeness.
create or replace function public.deactivate_user(p_name text, p_role text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  rows_affected int;
begin
  update public.users
     set is_active = false
   where full_name = p_name and role = p_role;
  get diagnostics rows_affected = row_count;
  return rows_affected > 0;
end $$;

revoke all on function public.deactivate_user(text, text) from public;
grant execute on function public.deactivate_user(text, text) to anon, authenticated;

-- Reload PostgREST schema cache so the new signatures are visible immediately.
notify pgrst, 'reload schema';
