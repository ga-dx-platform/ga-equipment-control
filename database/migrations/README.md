# Database migrations

Apply SQL files in ascending order:

1. `001_init.sql` - creates base schema (`departments`, `users`, `equipment`, `borrow_records`, `audit_logs`) and core constraints.
2. `002_indexes_and_triggers.sql` - adds common indexes, `updated_at` trigger, and equipment audit trigger.
3. `003_rls_policies.sql` - enables RLS and creates starter policies for authenticated users.
4. `004_seed.sql` - inserts minimal bootstrap seed data.

## Notes

- Every table uses `uuid` as its primary key.
- Core checks included:
  - `equipment.available >= 0`
  - `equipment.available <= equipment.quantity`
  - `borrow_records.qty_borrowed > 0`
  - `users.role IN ('ga', 'mgr')`
  - `borrow_records.status IN ('borrowed', 'returned', 'overdue', 'cancelled')`
