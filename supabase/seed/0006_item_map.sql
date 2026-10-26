-- Seed item Accurate -> grade (R-40). Kode item sintetis untuk pengembangan;
-- pemilik mengganti dengan kode ekspor Accurate asli (tercatat di QUESTIONS).

insert into item_map (accurate_item_code, grade_id, accurate_unit, factor_to_kg, note) values
  ('EGG-UB', '33333333-3333-3333-3333-333333333301', 'kg', 1, 'Telur Utuh Besar'),
  ('EGG-US', '33333333-3333-3333-3333-333333333302', 'kg', 1, 'Telur Utuh Sedang'),
  ('EGG-UK', '33333333-3333-3333-3333-333333333303', 'kg', 1, 'Telur Utuh Kecil'),
  ('EGG-RT', '33333333-3333-3333-3333-333333333304', 'kg', 1, 'Telur Retak'),
  ('EGG-PC', '33333333-3333-3333-3333-333333333305', 'kg', 1, 'Telur Pecah')
on conflict do nothing;
