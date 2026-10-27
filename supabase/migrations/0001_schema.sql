-- 0001_schema.sql
-- Skema inti Winata Egg Position v1 (PRD §4-§5, ARCHITECTURE §3).
-- Semua tabel memakai id uuid, created_at, created_by, deleted_at (soft delete).
-- Kuantitas numeric(14,3) kg, Rupiah numeric(18,2). Tidak ada float.

-- ---------------------------------------------------------------------------
-- Identitas & auth shim
-- Di Supabase: auth.users disediakan platform. Skema auth di sini adalah shim
-- untuk PGlite/lokal (ARCHITECTURE §5) dan dibuat hanya bila belum ada agar
-- objek auth milik Supabase tidak ditimpa saat `supabase db push`.
-- ---------------------------------------------------------------------------
create schema if not exists auth;

-- Di dalam DO agar tidak diperiksa hak CREATE di schema auth bila tabel sudah
-- ada (Supabase: role postgres tidak punya CREATE di schema auth).
do $$
begin
  if to_regclass('auth.users') is null then
    create table auth.users (
      id uuid primary key default gen_random_uuid(),
      email text not null unique,
      password_hash text,
      created_at timestamptz not null default now()
    );
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'auth' and p.proname = 'uid'
  ) then
    execute $f$
      create function auth.uid() returns uuid language sql stable as $body$
        select nullif(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub', '')::uuid
      $body$;
    $f$;
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'auth' and p.proname = 'role'
  ) then
    execute $f$
      create function auth.role() returns text language sql stable as $body$
        select coalesce(
          nullif(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role', ''),
          current_setting('role', true)
        )
      $body$;
    $f$;
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'auth' and p.proname = 'email'
  ) then
    execute $f$
      create function auth.email() returns text language sql stable as $body$
        select nullif(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'email', '')
      $body$;
    $f$;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Master data (PRD §4)
-- ---------------------------------------------------------------------------
create table app_user (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  name text not null,
  role text not null check (role in ('kandang','manager','accounting','marketing','bod','admin')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index app_user_email_key on app_user (lower(email)) where deleted_at is null;
create index app_user_role_idx on app_user (role) where active and deleted_at is null;

create table location (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  kind text not null check (kind in ('kandang','gudang')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index location_code_key on location (code) where deleted_at is null;

create table user_location (
  user_id uuid not null references app_user(id) on delete cascade,
  location_id uuid not null references location(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  primary key (user_id, location_id)
);

create table house (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references location(id),
  code text not null,
  name text not null,
  capacity_birds integer,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index house_code_key on house (lower(code)) where deleted_at is null;
create index house_location_idx on house (location_id) where deleted_at is null;

create table flock (
  id uuid primary key default gen_random_uuid(),
  house_id uuid not null references house(id),
  code text not null,
  strain text not null,
  chick_in_date date not null,
  initial_birds integer not null check (initial_birds >= 0),
  status text not null default 'grower' check (status in ('grower','layer','afkir')),
  production_start_date date,
  cull_date date,
  note text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index flock_code_key on flock (code) where deleted_at is null;
create index flock_house_idx on flock (house_id) where deleted_at is null;

create table flock_depletion (
  id uuid primary key default gen_random_uuid(),
  flock_id uuid not null references flock(id),
  date date not null,
  dead integer not null default 0 check (dead >= 0),
  culled integer not null default 0 check (culled >= 0),
  reason text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index flock_depletion_key on flock_depletion (flock_id, date) where deleted_at is null;

create table grade (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  sort integer not null default 0,
  is_saleable boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index grade_code_key on grade (code) where deleted_at is null;

create table unit_conversion (
  id uuid primary key default gen_random_uuid(),
  grade_id uuid not null references grade(id),
  valid_from date not null,
  kg_per_crate numeric(14,3),
  kg_per_tray numeric(14,3),
  eggs_per_kg numeric(14,3),
  source text not null default 'manual' check (source in ('opname','fisik','manual')),
  note text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index unit_conversion_key on unit_conversion (grade_id, valid_from) where deleted_at is null;

create table customer (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  kind text not null check (kind in ('bakul','agen','grup','lain')),
  is_related_party boolean not null default false,
  payment_terms_days integer not null default 0 check (payment_terms_days >= 0),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index customer_code_key on customer (code) where deleted_at is null;

create table parameter (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  value jsonb not null,
  valid_from date not null default current_date,
  note text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index parameter_key on parameter (key, valid_from) where deleted_at is null;

create table hdp_standard (
  id uuid primary key default gen_random_uuid(),
  strain text not null,
  age_week integer not null check (age_week between 1 and 120),
  hdp_pct numeric(6,3) not null check (hdp_pct >= 0 and hdp_pct <= 100),
  egg_weight_g numeric(6,2) not null check (egg_weight_g > 0),
  source text not null default 'standar strain, seed',
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index hdp_standard_key on hdp_standard (strain, age_week) where deleted_at is null;

create table item_map (
  id uuid primary key default gen_random_uuid(),
  accurate_item_code text not null,
  grade_id uuid not null references grade(id),
  accurate_unit text not null default 'kg',
  factor_to_kg numeric(14,6) not null default 1,
  note text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index item_map_code_key on item_map (accurate_item_code) where deleted_at is null;

-- ---------------------------------------------------------------------------
-- Status hari, antrean rebuild, hasil hitung
-- ---------------------------------------------------------------------------
create table day_status (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references location(id),
  date date not null,
  status text not null default 'open' check (status in ('open','submitted','approved','locked')),
  submitted_by uuid references app_user(id),
  submitted_at timestamptz,
  approved_by uuid references app_user(id),
  approved_at timestamptz,
  locked_by uuid references app_user(id),
  locked_at timestamptz,
  return_reason text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index day_status_key on day_status (location_id, date) where deleted_at is null;

create table rebuild_queue (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references location(id),
  from_date date not null,
  status text not null default 'queued' check (status in ('queued','running','done')),
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index rebuild_queue_location_key on rebuild_queue (location_id);
create index rebuild_queue_status_idx on rebuild_queue (status, from_date);

create table position_daily (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references location(id) on delete cascade,
  grade_id uuid not null references grade(id) on delete cascade,
  date date not null,
  opening numeric(14,3) not null default 0,
  production numeric(14,3) not null default 0,
  transfer_in numeric(14,3) not null default 0,
  outbound numeric(14,3) not null default 0,
  transfer_out numeric(14,3) not null default 0,
  shrinkage numeric(14,3) not null default 0,
  correction numeric(14,3) not null default 0,
  closing numeric(14,3) not null default 0,
  in_transit numeric(14,3) not null default 0,
  age_b1 numeric(14,3) not null default 0,
  age_b2 numeric(14,3) not null default 0,
  age_b3 numeric(14,3) not null default 0,
  age_b4 numeric(14,3) not null default 0,
  days_of_stock numeric(10,3),
  value_rp numeric(18,2) not null default 0,
  computed_at timestamptz not null default now(),
  inputs_hash text
);
create unique index position_daily_key on position_daily (location_id, grade_id, date);
create index position_daily_date_idx on position_daily (date);

create table projection_daily (
  id uuid primary key default gen_random_uuid(),
  house_id uuid not null references house(id) on delete cascade,
  flock_id uuid references flock(id),
  grade_id uuid not null references grade(id) on delete cascade,
  date date not null,
  kg_proj numeric(14,3) not null default 0,
  calibration_factor numeric(6,4),
  flag text,
  source text not null default 'engine',
  computed_at timestamptz not null default now()
);
create unique index projection_daily_key on projection_daily (house_id, grade_id, date);
create index projection_daily_date_idx on projection_daily (date);

create table control_result (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  date date not null,
  location_id uuid not null references location(id) on delete cascade,
  status text not null check (status in ('ok','warn','fail')),
  detail jsonb not null default '{}'::jsonb,
  computed_at timestamptz not null default now()
);
create unique index control_result_key on control_result (code, date, location_id);

-- ---------------------------------------------------------------------------
-- Transaksi (PRD §5)
-- location_id didenormalisasi pada tabel yang butuh RLS & rebuild per lokasi.
-- ---------------------------------------------------------------------------
create table opname (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references location(id),
  date date not null,
  cutoff_time time,
  last_do_before text,
  first_do_after text,
  counter_id uuid references app_user(id),
  witness_id uuid references app_user(id),
  manager_id uuid references app_user(id),
  signed_counter_at timestamptz,
  signed_witness_at timestamptz,
  signed_manager_at timestamptz,
  photo_note text,
  status text not null default 'draft' check (status in ('draft','signed')),
  note text,
  source text not null default 'app' check (source in ('app','import')),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index opname_key on opname (location_id, date) where deleted_at is null;

create table opname_line (
  id uuid primary key default gen_random_uuid(),
  opname_id uuid not null references opname(id) on delete cascade,
  grade_id uuid not null references grade(id),
  crates numeric(14,3) not null default 0,
  trays numeric(14,3) not null default 0,
  loose_eggs integer not null default 0,
  sample_crates numeric(14,3) not null default 0,
  sample_kg numeric(14,3) not null default 0,
  sample_eggs_per_tray numeric(14,3),
  kg numeric(14,3) not null default 0,
  eggs integer not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index opname_line_key on opname_line (opname_id, grade_id) where deleted_at is null;

create table production (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references location(id),
  house_id uuid not null references house(id),
  date date not null,
  grade_id uuid not null references grade(id),
  qty numeric(14,3) not null,
  unit text not null default 'kg' check (unit in ('kg','peti','tray','btr')),
  kg numeric(14,3) not null,
  source text not null default 'app' check (source in ('app','import')),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index production_key on production (house_id, date, grade_id) where deleted_at is null;
create index production_location_date_idx on production (location_id, date);

create table outbound (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references location(id),
  do_number text not null,
  customer_id uuid not null references customer(id),
  date date not null,
  status text not null default 'draft' check (status in ('draft','dikirim','diterima')),
  delivered_at timestamptz,
  delivered_by uuid references app_user(id),
  note text,
  source text not null default 'app' check (source in ('app','import')),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index outbound_do_key on outbound (location_id, do_number) where deleted_at is null;
create index outbound_location_date_idx on outbound (location_id, date);

create table outbound_line (
  id uuid primary key default gen_random_uuid(),
  outbound_id uuid not null references outbound(id) on delete cascade,
  grade_id uuid not null references grade(id),
  qty numeric(14,3) not null default 0,
  unit text not null default 'kg' check (unit in ('kg','peti','tray','btr')),
  kg_doc numeric(14,3) not null default 0,
  kg_delivered numeric(14,3),
  price_per_kg numeric(18,2),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index outbound_line_parent_idx on outbound_line (outbound_id);

create table transfer (
  id uuid primary key default gen_random_uuid(),
  from_location_id uuid not null references location(id),
  to_location_id uuid not null references location(id),
  grade_id uuid not null references grade(id),
  kg numeric(14,3) not null check (kg > 0),
  sent_date date not null,
  received_date date,
  status text not null default 'in_transit' check (status in ('in_transit','received')),
  note text,
  source text not null default 'app' check (source in ('app','import')),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint transfer_distinct_locations check (from_location_id <> to_location_id)
);
create index transfer_from_idx on transfer (from_location_id, sent_date);
create index transfer_to_idx on transfer (to_location_id, received_date);

create table shrinkage (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references location(id),
  date date not null,
  grade_id uuid not null references grade(id),
  kg numeric(14,3) not null check (kg > 0),
  kind text not null check (kind in ('pecah','afkir_telur','konsumsi','sampel','lain')),
  reason text,
  source text not null default 'app' check (source in ('app','import')),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index shrinkage_location_date_idx on shrinkage (location_id, date);

create table physical_count (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references location(id),
  date date not null,
  note text,
  counted_by uuid references app_user(id),
  checked_by uuid references app_user(id),
  status text not null default 'draft' check (status in ('draft','checked')),
  source text not null default 'app' check (source in ('app','import')),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index physical_count_key on physical_count (location_id, date) where deleted_at is null;

create table physical_count_line (
  id uuid primary key default gen_random_uuid(),
  physical_count_id uuid not null references physical_count(id) on delete cascade,
  grade_id uuid not null references grade(id),
  crates numeric(14,3) not null default 0,
  trays numeric(14,3) not null default 0,
  loose_eggs integer not null default 0,
  sample_crates numeric(14,3) not null default 0,
  sample_kg numeric(14,3) not null default 0,
  sample_eggs_per_tray numeric(14,3),
  kg numeric(14,3) not null default 0,
  eggs integer not null default 0,
  computed_kg numeric(14,3),
  diff_kg numeric(14,3),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index physical_count_line_key on physical_count_line (physical_count_id, grade_id) where deleted_at is null;

create table correction (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references location(id),
  effective_date date not null,
  grade_id uuid not null references grade(id),
  kg numeric(14,3) not null default 0,
  amount_rp numeric(18,2) not null default 0,
  reason text not null,
  attachment_path text,
  status text not null default 'draft' check (status in ('draft','approved','posted')),
  approved_by uuid references app_user(id),
  approved_at timestamptz,
  posted_at timestamptz,
  ref text,
  source text not null default 'app' check (source in ('app','import')),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index correction_location_date_idx on correction (location_id, effective_date);

create table sales_plan (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customer(id),
  date date not null,
  grade_id uuid not null references grade(id),
  kg numeric(14,3) not null default 0,
  price_per_kg numeric(18,2),
  kind text not null default 'forecast' check (kind in ('order','forecast')),
  note text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index sales_plan_key on sales_plan (customer_id, date, grade_id, kind) where deleted_at is null;
create index sales_plan_date_idx on sales_plan (date);

create table market_price (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  region text not null default 'Tasikmalaya',
  price_per_kg numeric(18,2) not null,
  note text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index market_price_key on market_price (date, region) where deleted_at is null;

create table cash_plan (
  id uuid primary key default gen_random_uuid(),
  week_start date not null,
  category text not null,
  direction text not null check (direction in ('in','out')),
  amount_rp numeric(18,2) not null,
  note text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index cash_plan_week_idx on cash_plan (week_start);

create table cash_balance (
  id uuid primary key default gen_random_uuid(),
  as_of date not null,
  amount_rp numeric(18,2) not null,
  note text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index cash_balance_key on cash_balance (as_of) where deleted_at is null;

-- ---------------------------------------------------------------------------
-- Rekonsiliasi Accurate (M5)
-- ---------------------------------------------------------------------------
create table accurate_upload (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('sales','stock')),
  period text not null,
  file_path text,
  rows integer not null default 0,
  status text not null default 'parsed' check (status in ('parsed','rejected','applied')),
  note text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table accurate_sales_line (
  id uuid primary key default gen_random_uuid(),
  upload_id uuid not null references accurate_upload(id) on delete cascade,
  date date not null,
  item_code text not null,
  item_name text,
  qty numeric(14,3) not null default 0,
  unit text,
  amount_rp numeric(18,2) not null default 0,
  kg numeric(14,3) not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  deleted_at timestamptz
);
create index accurate_sales_line_upload_idx on accurate_sales_line (upload_id);

create table accurate_stock_line (
  id uuid primary key default gen_random_uuid(),
  upload_id uuid not null references accurate_upload(id) on delete cascade,
  item_code text not null,
  item_name text,
  qty numeric(14,3) not null default 0,
  unit text,
  kg numeric(14,3) not null default 0,
  amount_rp numeric(18,2) not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  deleted_at timestamptz
);
create index accurate_stock_line_upload_idx on accurate_stock_line (upload_id);

create table reconciliation_item (
  id uuid primary key default gen_random_uuid(),
  period text not null,
  grade_id uuid references grade(id),
  kind text not null check (kind in ('kg','rp','stock')),
  app_value numeric(18,3) not null default 0,
  accurate_value numeric(18,3) not null default 0,
  diff numeric(18,3) not null default 0,
  status text not null default 'open' check (status in ('open','explained','corrected')),
  note text,
  correction_id uuid references correction(id),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index reconciliation_item_key on reconciliation_item (period, kind, grade_id) where deleted_at is null;

-- ---------------------------------------------------------------------------
-- Audit (PRD §5: semua transaksi & master, nilai lama/baru, siapa, kapan)
-- ---------------------------------------------------------------------------
create table audit_log (
  id bigserial primary key,
  table_name text not null,
  row_id uuid,
  action text not null,
  actor uuid,
  actor_email text,
  at timestamptz not null default now(),
  old jsonb,
  new jsonb
);
create index audit_log_table_idx on audit_log (table_name, row_id);
create index audit_log_at_idx on audit_log (at desc);

-- ---------------------------------------------------------------------------
-- Fungsi versi skema
-- ---------------------------------------------------------------------------
create or replace function schema_version()
returns text
language sql
immutable
as $$ select '1.0.0'::text $$;

-- ---------------------------------------------------------------------------
-- updated_at & audit triggers
-- ---------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function audit_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row_id uuid;
  v_old jsonb;
  v_new jsonb;
  v_actor uuid := auth.uid();
  v_email text;
begin
  if tg_op = 'DELETE' then
    v_old := to_jsonb(old);
    v_row_id := nullif(v_old ->> 'id', '')::uuid;
  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    v_row_id := coalesce(nullif(v_new ->> 'id', '')::uuid, nullif(v_old ->> 'id', '')::uuid);
  else
    v_new := to_jsonb(new);
    v_row_id := nullif(v_new ->> 'id', '')::uuid;
  end if;

  select email into v_email from app_user where id = v_actor;

  insert into audit_log (table_name, row_id, action, actor, actor_email, old, new)
  values (tg_table_name, v_row_id, tg_op, v_actor, v_email, v_old, v_new);

  return coalesce(new, old);
end;
$$;

-- Pasang trigger updated_at + audit pada semua tabel yang punya kolom id/created_at.
do $$
declare
  t text;
  tables text[] := array[
    'app_user','location','user_location','house','flock','flock_depletion','grade',
    'unit_conversion','customer','parameter','hdp_standard','item_map','day_status',
    'opname','opname_line','production','outbound','outbound_line','transfer','shrinkage',
    'physical_count','physical_count_line','correction','sales_plan','market_price',
    'cash_plan','cash_balance','accurate_upload','reconciliation_item','rebuild_queue'
  ];
begin
  foreach t in array tables loop
    execute format('drop trigger if exists %I_audit on %I', t, t);
    execute format(
      'create trigger %I_audit after insert or update or delete on %I for each row execute function audit_row()',
      t, t
    );
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'updated_at'
    ) then
      execute format('drop trigger if exists %I_updated_at on %I', t, t);
      execute format(
        'create trigger %I_updated_at before update on %I for each row execute function set_updated_at()',
        t, t
      );
    end if;
  end loop;
end;
$$;
