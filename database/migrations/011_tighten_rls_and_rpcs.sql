-- 011_tighten_rls_and_rpcs.sql
-- Tighten the overly-permissive `using (true)` policies introduced in
-- 005_fix_rls_policies.sql / 009_recreate_borrow_records.sql / 010_report_recipients_rls.sql.
--
-- Strategy (minimum disruption — does NOT require changing the app today):
--   1. Make append-only tables truly append-only (no DELETE/UPDATE).
--   2. Provide SECURITY DEFINER RPCs for sensitive user-table mutations so
--      a follow-up app PR can drop direct anon UPDATE/DELETE on `users`.
--   3. Leave `equipment`, `categories`, `report_recipients` open for now
--      (the app actively uses CRUD on these); plan to gate them via RPCs
--      in a later migration.
--
-- After applying this migration the app continues to work unchanged.
-- A follow-up app PR can then switch users.update / users.delete calls
-- to the new RPCs and we can drop those direct policies.

------------------------------------------------------------------------------
-- 1. borrow_records: append-only after creation. Block DELETE entirely.
--    (Returns are recorded via UPDATE, never DELETE.)
------------------------------------------------------------------------------

drop policy if exists "anon delete borrow_records" on public.borrow_records;
drop policy if exists "anon manage borrow records" on public.borrow_records;

-- Re-create granular SELECT/INSERT/UPDATE if the catch-all was the only one.
do $$ begin
  if not exists (select 1 from pg_policies where tablename='borrow_records' and policyname='anon select borrow_records') then
    create policy "anon select borrow_records" on public.borrow_records for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='borrow_records' and policyname='anon insert borrow_records') then
    create policy "anon insert borrow_records" on public.borrow_records for insert with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='borrow_records' and policyname='anon update borrow_records') then
    create policy "anon update borrow_records" on public.borrow_records for update using (true) with check (true);
  end if;
end $$;
-- DELETE: no policy = denied by default with RLS enabled.

------------------------------------------------------------------------------
-- 2. app_audit_logs: audit trail must be immutable. Block UPDATE and DELETE.
------------------------------------------------------------------------------

drop policy if exists "anon update app_audit_logs"  on public.app_audit_logs;
drop policy if exists "anon delete app_audit_logs"  on public.app_audit_logs;
drop policy if exists "anon manage app audit logs"  on public.app_audit_logs;
-- Existing SELECT/INSERT policies from 007 stay in place.

------------------------------------------------------------------------------
-- 3. audit_logs (DB trigger table from 001_init): also append-only.
------------------------------------------------------------------------------

drop policy if exists "anon update audit_logs" on public.audit_logs;
drop policy if exists "anon delete audit_logs" on public.audit_logs;

------------------------------------------------------------------------------
-- 4. RPCs for sensitive `users` mutations.
--    SECURITY DEFINER lets us validate input and run as table owner,
--    bypassing the anon RLS for mutations we explicitly approve.
------------------------------------------------------------------------------

-- Update PIN hash by user id (only column we let the app change).
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
     set pin_hash = p_new_hash, updated_at = now()
   where id = p_user_id and is_active = true;
  get diagnostics rows_affected = row_count;
  return rows_affected > 0;
end $$;

revoke all on function public.update_user_pin(uuid, text) from public;
grant execute on function public.update_user_pin(uuid, text) to anon, authenticated;

-- Update allowed_categories for a GA user (manager-only operation —
-- the app already gates this UI behind the manager view, but this RPC
-- at least centralises the write so we can add a manager-PIN check later).
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
     set allowed_categories = p_categories, updated_at = now()
   where full_name = p_name and role = 'ga';
  get diagnostics rows_affected = row_count;
  return rows_affected > 0;
end $$;

revoke all on function public.update_user_categories(text, text[]) from public;
grant execute on function public.update_user_categories(text, text[]) to anon, authenticated;

-- Delete user (soft) — flips is_active false instead of hard DELETE,
-- preserving audit trail integrity.
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
     set is_active = false, updated_at = now()
   where full_name = p_name and role = p_role;
  get diagnostics rows_affected = row_count;
  return rows_affected > 0;
end $$;

revoke all on function public.deactivate_user(text, text) from public;
grant execute on function public.deactivate_user(text, text) to anon, authenticated;

------------------------------------------------------------------------------
-- 5. (NOT YET) — once the app PR migrates to the RPCs above, run:
--
--      drop policy if exists "anon update users" on public.users;
--      drop policy if exists "anon delete users" on public.users;
--      drop policy if exists "anon insert users" on public.users;  -- if addUser also moves to RPC
--
--    Leaving them in place for now to avoid breaking the live app.
------------------------------------------------------------------------------

------------------------------------------------------------------------------
-- 6. Helpful checks (run manually after applying):
--    select schemaname, tablename, policyname, cmd
--      from pg_policies where schemaname = 'public' order by tablename, cmd;
------------------------------------------------------------------------------
