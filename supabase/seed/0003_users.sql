-- Seed pengguna: admin pemilik + satu akun contoh per peran (sufiks @winata.test).
-- K2: allow-list; pendaftaran mandiri ditolak trigger.
-- Kata sandi lokal: winata123 (mock auth tidak memakai kata sandi cloud).

insert into app_user (id, email, name, role, active) values
  ('44444444-4444-4444-4444-444444444401', 'dika.g.irawan@gmail.com', 'Dika (Group Controller)', 'admin', true),
  ('44444444-4444-4444-4444-444444444402', 'kandang.slp@winata.test', 'Rahmat (Kandang Salopa)', 'kandang', true),
  ('44444444-4444-4444-4444-444444444403', 'manager@winata.test', 'Yayan (Manager Kandang)', 'manager', true),
  ('44444444-4444-4444-4444-444444444404', 'accounting@winata.test', 'Neng (Accounting)', 'accounting', true),
  ('44444444-4444-4444-4444-444444444405', 'marketing@winata.test', 'Iwan (Marketing)', 'marketing', true),
  ('44444444-4444-4444-4444-444444444406', 'bod@winata.test', 'BoD', 'bod', true),
  ('44444444-4444-4444-4444-444444444407', 'kandang.ckl@winata.test', 'Asep (Kandang Cikaleker)', 'kandang', true),
  ('44444444-4444-4444-4444-444444444408', 'admin@winata.test', 'Admin Uji', 'admin', true),
  ('44444444-4444-4444-4444-444444444409', 'gudang.tsk@winata.test', 'Ujang (Gudang Tasik)', 'kandang', true)
on conflict (id) do nothing;

insert into user_location (user_id, location_id) values
  ('44444444-4444-4444-4444-444444444402', '11111111-1111-1111-1111-111111111101'),
  ('44444444-4444-4444-4444-444444444407', '11111111-1111-1111-1111-111111111102'),
  ('44444444-4444-4444-4444-444444444409', '11111111-1111-1111-1111-111111111103'),
  ('44444444-4444-4444-4444-444444444403', '11111111-1111-1111-1111-111111111101'),
  ('44444444-4444-4444-4444-444444444403', '11111111-1111-1111-1111-111111111102')
on conflict do nothing;

select set_login_password('dika.g.irawan@gmail.com', 'winata123');
select set_login_password('kandang.slp@winata.test', 'winata123');
select set_login_password('manager@winata.test', 'winata123');
select set_login_password('accounting@winata.test', 'winata123');
select set_login_password('marketing@winata.test', 'winata123');
select set_login_password('bod@winata.test', 'winata123');
select set_login_password('kandang.ckl@winata.test', 'winata123');
select set_login_password('admin@winata.test', 'winata123');
select set_login_password('gudang.tsk@winata.test', 'winata123');
