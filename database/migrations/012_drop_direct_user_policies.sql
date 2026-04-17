-- 012_drop_direct_user_policies.sql
-- Follow-up to 011_tighten_rls_and_rpcs.sql.
-- Now that the app has been switched to the SECURITY DEFINER RPCs
-- (update_user_pin / update_user_categories / deactivate_user), we can
-- safely drop the direct anon UPDATE/DELETE policies on public.users.
--
-- INSERT is kept for now because addUser still writes directly (no
-- create_user RPC yet); SELECT is also kept so the login flow can list users.

drop policy if exists "anon update users" on public.users;
drop policy if exists "anon delete users" on public.users;

-- Helpful check after applying:
--   select policyname, cmd from pg_policies
--    where schemaname='public' and tablename='users' order by cmd;
