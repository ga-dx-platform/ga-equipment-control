-- 001_init.sql
-- Base schema for GA Equipment Control

create extension if not exists pgcrypto;

create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  department_id uuid references public.departments(id) on delete set null,
  employee_code text not null unique,
  full_name text not null,
  email text not null unique,
  role text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_role_check check (role in ('ga', 'mgr'))
);

create table if not exists public.equipment (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  category text,
  quantity integer not null default 0,
  available integer not null default 0,
  is_active boolean not null default true,
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint equipment_quantity_non_negative check (quantity >= 0),
  constraint equipment_available_non_negative check (available >= 0),
  constraint equipment_available_le_quantity check (available <= quantity)
);

create table if not exists public.borrow_records (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references public.equipment(id) on delete restrict,
  borrower_id uuid not null references public.users(id) on delete restrict,
  approver_id uuid references public.users(id) on delete set null,
  qty_borrowed integer not null,
  status text not null default 'borrowed',
  borrowed_at timestamptz not null default now(),
  due_at timestamptz,
  returned_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint borrow_records_qty_borrowed_positive check (qty_borrowed > 0),
  constraint borrow_records_status_check check (status in ('borrowed', 'returned', 'overdue', 'cancelled'))
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.users(id) on delete set null,
  action text not null,
  table_name text not null,
  record_id uuid,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
