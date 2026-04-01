-- 010_report_recipients_rls.sql
-- Add anon RLS policies for report_recipients table
-- (table + Edge Function created by backend team; this enables anon app access)

alter table public.report_recipients enable row level security;

create policy "anon select report_recipients"
  on public.report_recipients for select using (true);

create policy "anon insert report_recipients"
  on public.report_recipients for insert with check (true);

create policy "anon update report_recipients"
  on public.report_recipients for update using (true) with check (true);

create policy "anon delete report_recipients"
  on public.report_recipients for delete using (true);
