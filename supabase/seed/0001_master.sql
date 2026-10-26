-- Seed master: lokasi, kandang, grade, konversi awal, pelanggan, parameter.
-- K3: lokasi awal SLP, CKL, TSK. Q-1: SLP 2 kandang, CKL 1.
-- Q-2/K4: grade default UB, US, UK, RT, PC.

insert into location (id, code, name, kind) values
  ('11111111-1111-1111-1111-111111111101', 'SLP', 'Salopa', 'kandang'),
  ('11111111-1111-1111-1111-111111111102', 'CKL', 'Cikaleker', 'kandang'),
  ('11111111-1111-1111-1111-111111111103', 'TSK', 'Gudang Tasik', 'gudang')
on conflict (id) do nothing;

insert into house (id, location_id, code, name, capacity_birds) values
  ('22222222-2222-2222-2222-222222222201', '11111111-1111-1111-1111-111111111101', 'SLP-1', 'Kandang Salopa 1', null),
  ('22222222-2222-2222-2222-222222222202', '11111111-1111-1111-1111-111111111101', 'SLP-2', 'Kandang Salopa 2', null),
  ('22222222-2222-2222-2222-222222222203', '11111111-1111-1111-1111-111111111102', 'CKL-1', 'Kandang Cikaleker 1', null)
on conflict (id) do nothing;

insert into grade (id, code, name, sort, is_saleable) values
  ('33333333-3333-3333-3333-333333333301', 'UB', 'Utuh Besar', 1, true),
  ('33333333-3333-3333-3333-333333333302', 'US', 'Utuh Sedang', 2, true),
  ('33333333-3333-3333-3333-333333333303', 'UK', 'Utuh Kecil', 3, true),
  ('33333333-3333-3333-3333-333333333304', 'RT', 'Retak', 4, true),
  ('33333333-3333-3333-3333-333333333305', 'PC', 'Pecah', 5, false)
on conflict (id) do nothing;

-- K5: satuan dasar kg. Nilai awal dari timbang sampel opname T0 (Q-7).
insert into unit_conversion (id, grade_id, valid_from, kg_per_crate, kg_per_tray, eggs_per_kg, source, note) values
  ('88888888-8888-8888-8888-888888888801', '33333333-3333-3333-3333-333333333301', '2026-07-01', 15.000, 1.900, 16.400, 'opname', 'sampel timbang T0'),
  ('88888888-8888-8888-8888-888888888802', '33333333-3333-3333-3333-333333333302', '2026-07-01', 14.600, 1.820, 16.700, 'opname', 'sampel timbang T0'),
  ('88888888-8888-8888-8888-888888888803', '33333333-3333-3333-3333-333333333303', '2026-07-01', 13.800, 1.700, 18.200, 'opname', 'sampel timbang T0'),
  ('88888888-8888-8888-8888-888888888804', '33333333-3333-3333-3333-333333333304', '2026-07-01', 15.000, 1.900, 16.400, 'opname', 'sampel timbang T0'),
  ('88888888-8888-8888-8888-888888888805', '33333333-3333-3333-3333-333333333305', '2026-07-01', 14.000, 1.800, 17.000, 'opname', 'sampel timbang T0')
on conflict (id) do nothing;

insert into customer (id, code, name, kind, is_related_party, payment_terms_days) values
  ('55555555-5555-5555-5555-555555555501', 'BKL-01', 'Bakul Ciawi', 'bakul', false, 0),
  ('55555555-5555-5555-5555-555555555502', 'BKL-02', 'Bakul Singaparna', 'bakul', false, 0),
  ('55555555-5555-5555-5555-555555555503', 'AGN-01', 'Agen Tasik', 'agen', false, 7),
  ('55555555-5555-5555-5555-555555555504', 'GRP-01', 'RM Saung Gunung Jati', 'grup', true, 14),
  ('55555555-5555-5555-5555-555555555505', 'GRP-02', 'Backyard', 'grup', true, 14),
  ('55555555-5555-5555-5555-555555555506', 'GRP-03', 'BJJ', 'grup', true, 14),
  ('55555555-5555-5555-5555-555555555507', 'GRP-04', 'GJP', 'grup', true, 14),
  ('55555555-5555-5555-5555-555555555508', 'LAIN-01', 'Umum', 'lain', false, 0)
on conflict (id) do nothing;

-- Parameter default v1 (PRD §9) + parameter rekonstruksi (M6).
insert into parameter (key, value, valid_from, note) values
  ('input_deadline', '"20:00"'::jsonb, '2026-07-01', 'jam batas submit harian WIB'),
  ('tolerance_pct', '0.01'::jsonb, '2026-07-01', 'K4 selisih fisik'),
  ('tolerance_kg', '50'::jsonb, '2026-07-01', 'K4 selisih fisik'),
  ('transit_days_alert', '1'::jsonb, '2026-07-01', 'K5'),
  ('age_buckets_days', '[3,7,14]'::jsonb, '2026-07-01', 'R-11, K6'),
  ('days_of_stock_alert', '5'::jsonb, '2026-07-01', 'K7, R-34'),
  ('bod_threshold_rp', '10000000'::jsonb, '2026-07-01', 'K9'),
  ('bod_threshold_pct', '0.02'::jsonb, '2026-07-01', 'K9'),
  ('hpp_per_kg', '17419'::jsonb, '2026-07-01', 'HPP sementara'),
  ('production_start_age_weeks', '18'::jsonb, '2026-07-01', 'Q-4'),
  ('calibration_window_days', '14'::jsonb, '2026-07-01', 'R-32'),
  ('default_grade_mix', '{"UB":55,"US":30,"UK":10,"RT":3,"PC":2}'::jsonb, '2026-07-01', 'R-32'),
  ('feed_g_per_bird', '115'::jsonb, '2026-07-01', 'R-37'),
  ('feed_price_per_kg', '7100'::jsonb, '2026-07-01', 'R-37'),
  ('cull_value_per_bird', '35000'::jsonb, '2026-07-01', 'R-37'),
  ('collection_profile', '{"bakul":[1.0],"agen":[0.5,0.5],"grup":[0.0,0.0,1.0],"lain":[1.0]}'::jsonb, '2026-07-01', 'R-36'),
  ('opname_t0_date', '"2026-07-01"'::jsonb, '2026-07-01', 'Q-7 jangkar posisi (K6)'),
  ('tb_egg_whole_rp', '383582877'::jsonb, '2026-07-01', 'R-43 TB telur utuh'),
  ('tb_egg_broken_rp', '6209446'::jsonb, '2026-07-01', 'R-43 TB telur pecah'),
  ('tb_hpp_per_kg', '17419'::jsonb, '2026-07-01', 'R-43 HPP sementara'),
  ('reconstruction_target_date', '"2026-06-30"'::jsonb, '2026-07-01', 'R-43')
on conflict do nothing;
