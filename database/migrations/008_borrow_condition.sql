-- 008_borrow_condition.sql
-- Add condition_on_return and condition_note to borrow_records so GA staff
-- can record equipment condition when returning (normal / damaged / lost).
-- Uses ALTER TABLE ... ADD COLUMN IF NOT EXISTS for idempotent execution.

alter table public.borrow_records
  add column if not exists condition_on_return text
    check (condition_on_return in ('normal','damaged','lost')),
  add column if not exists condition_note text;
