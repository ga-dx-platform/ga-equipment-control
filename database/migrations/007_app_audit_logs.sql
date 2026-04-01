-- 007_app_audit_logs.sql
-- App-level audit log table for tracking user actions (borrow, return,
-- equipment CRUD, member management). Separate from the existing audit_logs
-- table which is used by the DB trigger on equipment changes.
-- Uses actor_name (text) instead of actor_id FK because the app uses
-- name-based PIN auth, not Supabase Auth UUIDs.
-- Uses target_id as text to support both UUID equipment IDs and text
-- borrow record IDs (format: 'BR' + timestamp).

create table if not exists public.app_audit_logs (
  id uuid primary key default gen_random_uuid(),
  action_type text not null,
  target_table text,
  target_id text,
  actor_name text,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_app_audit_action_type on public.app_audit_logs(action_type);
create index if not exists idx_app_audit_actor_name  on public.app_audit_logs(actor_name);
create index if not exists idx_app_audit_created_at  on public.app_audit_logs(created_at desc);

alter table public.app_audit_logs enable row level security;

create policy "anon read app audit logs"
  on public.app_audit_logs for select
  using (true);

create policy "anon insert app audit logs"
  on public.app_audit_logs for insert
  with check (true);
