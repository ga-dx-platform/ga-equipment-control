-- 002_indexes_and_triggers.sql
-- Indexes and trigger helpers

create index if not exists idx_users_department_id on public.users(department_id);
create index if not exists idx_users_role on public.users(role);

create index if not exists idx_equipment_category on public.equipment(category);
create index if not exists idx_equipment_available on public.equipment(available);

create index if not exists idx_borrow_records_equipment_id on public.borrow_records(equipment_id);
create index if not exists idx_borrow_records_borrower_id on public.borrow_records(borrower_id);
create index if not exists idx_borrow_records_status on public.borrow_records(status);
create index if not exists idx_borrow_records_borrowed_at on public.borrow_records(borrowed_at desc);

create index if not exists idx_audit_logs_actor_id on public.audit_logs(actor_id);
create index if not exists idx_audit_logs_table_name on public.audit_logs(table_name);
create index if not exists idx_audit_logs_created_at on public.audit_logs(created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_departments_set_updated_at
before update on public.departments
for each row
execute function public.set_updated_at();

create trigger trg_users_set_updated_at
before update on public.users
for each row
execute function public.set_updated_at();

create trigger trg_equipment_set_updated_at
before update on public.equipment
for each row
execute function public.set_updated_at();

create trigger trg_borrow_records_set_updated_at
before update on public.borrow_records
for each row
execute function public.set_updated_at();

create or replace function public.log_equipment_change()
returns trigger
language plpgsql
as $$
declare
  v_action text;
begin
  v_action := case
    when tg_op = 'INSERT' then 'equipment_created'
    when tg_op = 'UPDATE' then 'equipment_updated'
    else 'equipment_deleted'
  end;

  insert into public.audit_logs(actor_id, action, table_name, record_id, payload)
  values (
    coalesce(new.updated_by, new.created_by, old.updated_by, old.created_by),
    v_action,
    'equipment',
    coalesce(new.id, old.id),
    jsonb_build_object(
      'old', to_jsonb(old),
      'new', to_jsonb(new)
    )
  );

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_equipment_audit on public.equipment;
create trigger trg_equipment_audit
after insert or update or delete on public.equipment
for each row
execute function public.log_equipment_change();
