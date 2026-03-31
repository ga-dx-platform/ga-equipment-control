-- 003_rls_policies.sql
-- Row Level Security and policies

alter table public.departments enable row level security;
alter table public.users enable row level security;
alter table public.equipment enable row level security;
alter table public.borrow_records enable row level security;
alter table public.audit_logs enable row level security;

-- Simplified bootstrap policies
create policy if not exists "authenticated read departments"
on public.departments
for select
to authenticated
using (true);

create policy if not exists "authenticated read users"
on public.users
for select
to authenticated
using (true);

create policy if not exists "authenticated read equipment"
on public.equipment
for select
to authenticated
using (true);

create policy if not exists "authenticated manage borrow records"
on public.borrow_records
for all
to authenticated
using (true)
with check (true);

create policy if not exists "authenticated read audit logs"
on public.audit_logs
for select
to authenticated
using (true);
