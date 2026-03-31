-- 005_fix_rls_policies.sql
-- Fix RLS policies to allow anon role access
-- App uses Supabase anon key with its own PIN-based auth (no Supabase Auth),
-- so requests arrive as 'anon' role. Previous policies only allowed 'authenticated'.

-- Equipment: replace SELECT-only authenticated policy with full CRUD for all roles
drop policy if exists "authenticated read equipment" on public.equipment;

create policy "anon read equipment"
on public.equipment for select
using (true);

create policy "anon insert equipment"
on public.equipment for insert
with check (true);

create policy "anon update equipment"
on public.equipment for update
using (true) with check (true);

create policy "anon delete equipment"
on public.equipment for delete
using (true);

-- Borrow records: replace authenticated-only policy with all roles
drop policy if exists "authenticated manage borrow records" on public.borrow_records;

create policy "anon manage borrow records"
on public.borrow_records for all
using (true) with check (true);

-- Departments: allow anon to read
drop policy if exists "authenticated read departments" on public.departments;

create policy "anon read departments"
on public.departments for select
using (true);

-- Users: allow anon to read (app manages auth via PIN)
drop policy if exists "authenticated read users" on public.users;

create policy "anon read users"
on public.users for select
using (true);

-- Audit logs: allow anon to read
drop policy if exists "authenticated read audit logs" on public.audit_logs;

create policy "anon read audit logs"
on public.audit_logs for select
using (true);
