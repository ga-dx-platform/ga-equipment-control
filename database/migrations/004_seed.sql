-- 004_seed.sql
-- Baseline seed data

insert into public.departments (code, name)
values
  ('GA', 'General Affairs'),
  ('OPS', 'Operations')
on conflict (code) do nothing;

insert into public.users (department_id, employee_code, full_name, email, role)
select d.id, 'EMP-GA-001', 'GA Manager', 'ga.manager@example.com', 'mgr'
from public.departments d
where d.code = 'GA'
on conflict (employee_code) do nothing;

insert into public.users (department_id, employee_code, full_name, email, role)
select d.id, 'EMP-GA-002', 'GA Staff', 'ga.staff@example.com', 'ga'
from public.departments d
where d.code = 'GA'
on conflict (employee_code) do nothing;

insert into public.equipment (code, name, category, quantity, available)
values
  ('EQ-LAP-001', 'Laptop Dell 14"', 'IT', 10, 10),
  ('EQ-PROJ-001', 'Projector Epson', 'AV', 3, 3),
  ('EQ-CAM-001', 'Conference Camera', 'AV', 5, 5)
on conflict (code) do nothing;
