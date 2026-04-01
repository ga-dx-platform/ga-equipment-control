-- 009_recreate_borrow_records.sql
-- The original borrow_records schema (001_init.sql) used normalized UUIDs
-- (equipment_id FK, borrower_id FK) which require Supabase Auth user IDs.
-- The app uses PIN-based name auth and inserts denormalized text fields instead.
-- This migration drops the old schema and recreates the table to match the app.

-- Drop old table (CASCADE removes indexes, triggers, and dependent objects)
drop table if exists public.borrow_records cascade;

-- Recreate with app-compatible schema
create table public.borrow_records (
  record_id         text primary key,           -- 'BR' + timestamp e.g. BR1712345678901
  eq_id             text not null,              -- equipment UUID or legacy eq_id text
  eq_name           text not null,
  qty_borrowed      integer not null check (qty_borrowed > 0),
  borrower_name     text not null,
  borrower_dept     text,
  ga_staff          text,                       -- GA staff who processed the borrow
  borrowed_at       timestamptz not null default now(),
  due_date          date,
  returned_at       timestamptz,
  sign_img          text default '',            -- borrower signature (base64 data URL)
  return_sign_img   text default '',            -- return signature
  note              text default '',
  status            text not null default 'borrowed'
                    check (status in ('borrowed', 'returned', 'overdue', 'cancelled')),
  condition_on_return text
                    check (condition_on_return in ('normal', 'damaged', 'lost')),
  condition_note    text
);

-- Indexes for common query patterns
create index idx_borrow_records_eq_id       on public.borrow_records(eq_id);
create index idx_borrow_records_ga_staff    on public.borrow_records(ga_staff);
create index idx_borrow_records_status      on public.borrow_records(status);
create index idx_borrow_records_borrowed_at on public.borrow_records(borrowed_at desc);

-- Enable RLS
alter table public.borrow_records enable row level security;

-- Allow anon full access (app uses PIN-based auth, not Supabase Auth)
create policy "anon select borrow_records"
  on public.borrow_records for select using (true);

create policy "anon insert borrow_records"
  on public.borrow_records for insert with check (true);

create policy "anon update borrow_records"
  on public.borrow_records for update using (true) with check (true);

create policy "anon delete borrow_records"
  on public.borrow_records for delete using (true);
