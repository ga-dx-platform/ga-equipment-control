-- 006_fix_audit_trigger.sql
-- Recreate log_equipment_change() as SECURITY DEFINER so the audit INSERT
-- runs as the DB owner and is not blocked by RLS on audit_logs.
-- Without this, any anon-role write to equipment triggers an audit insert
-- that fails (no INSERT policy on audit_logs for anon) and rolls back the
-- entire equipment operation.

create or replace function public.log_equipment_change()
returns trigger
language plpgsql
security definer
set search_path = public
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
