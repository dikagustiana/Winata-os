-- 0008_hardening.sql
-- v1.1 hardening (PRD-v1.1 §2-§3, ARCHITECTURE-v1.1 §4-§6).
-- Menutup F-1…F-6, F-8…F-11 di database: R-60…R-69, R-71/R-73 (parameter),
-- R-64 (tautan Auth), schema_version 1.1.0.
--
-- Semua penjaga memeriksa current_app_role(): bila null (postgres/service_role,
-- worker, seed, importer server-side, GoTrue) penjaga tidak membatasi.
-- Idempoten: create or replace / if exists / if not exists, aman dijalankan di
-- PGlite (tes, lokal) maupun Supabase.

-- ---------------------------------------------------------------------------
-- 0. Versi skema
-- ---------------------------------------------------------------------------
create or replace function schema_version()
returns text
language sql
immutable
as $$ select '1.1.0'::text $$;

-- ---------------------------------------------------------------------------
-- 1. Kolom baru
-- ---------------------------------------------------------------------------
alter table rebuild_queue add column if not exists generation bigint not null default 0;

alter table user_location add column if not exists id uuid not null default gen_random_uuid();
alter table user_location add column if not exists updated_at timestamptz not null default now();
alter table user_location add column if not exists deleted_at timestamptz;

do $$
begin
  -- user_location: PK (user_id, location_id) → id, agar penugasan bisa dibatalkan
  -- (soft delete) lalu ditugaskan ulang tanpa bentrok kunci.
  if not exists (
    select 1 from pg_constraint
    where conname = 'user_location_pkey'
      and conrelid = 'public.user_location'::regclass
      and pg_get_constraintdef(oid) = 'PRIMARY KEY (id)'
  ) then
    alter table user_location drop constraint if exists user_location_pkey;
    alter table user_location add constraint user_location_pkey primary key (id);
  end if;
end;
$$;
create unique index if not exists user_location_active_key
  on user_location (user_id, location_id) where deleted_at is null;

drop trigger if exists user_location_updated_at on user_location;
create trigger user_location_updated_at before update on user_location
for each row execute function set_updated_at();

do $$
declare
  t text;
begin
  foreach t in array array[
    'opname','opname_line','production','outbound','outbound_line','transfer','shrinkage',
    'physical_count','physical_count_line','correction','sales_plan','market_price','cash_plan',
    'cash_balance','flock','flock_depletion','location','house','grade','unit_conversion','customer',
    'parameter','item_map','app_user','user_location','hdp_standard','day_status'
  ] loop
    execute format('alter table %I add column if not exists delete_reason text', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Format angka Indonesia untuk pesan galat (tanpa kode di teks pengguna)
-- ---------------------------------------------------------------------------
create or replace function fmt_num(p numeric)
returns text
language sql
immutable
as $$
  select case
    when p is null then '—'
    when p = trunc(p) then trunc(p)::text
    else replace(round(p, 1)::text, '.', ',')
  end
$$;

-- ---------------------------------------------------------------------------
-- 3. R-62 / K12 — jejak aktor tidak bisa dipalsukan
-- tg_argv[0]: daftar kolom aktor lain (dipisah koma) yang hanya boleh diisi
-- auth.uid() atau dikosongkan.
-- ---------------------------------------------------------------------------
create or replace function enforce_actor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_cols text[] := case when tg_nargs > 0 and tg_argv[0] <> '' then string_to_array(tg_argv[0], ',') else '{}'::text[] end;
  v_col text;
  v_new text;
  v_old text;
begin
  if current_app_role() is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.created_by := v_uid;
  elsif new.created_by is distinct from old.created_by then
    raise exception 'created_by tidak boleh diubah.' using errcode = '42501';
  end if;

  foreach v_col in array v_cols loop
    v_new := to_jsonb(new) ->> v_col;
    v_old := case when tg_op = 'UPDATE' then to_jsonb(old) ->> v_col else null end;
    if v_new is not null and v_new is distinct from v_old and v_new <> v_uid::text then
      raise exception 'Kolom aktor % hanya boleh diisi dengan akun Anda sendiri.', v_col
        using errcode = '42501';
    end if;
  end loop;
  return new;
end;
$$;

do $$
declare
  spec text[];
begin
  foreach spec slice 1 in array array[
    array['production', ''],
    array['shrinkage', ''],
    array['outbound', 'delivered_by'],
    array['outbound_line', ''],
    array['transfer', ''],
    array['opname', 'counter_id,witness_id,manager_id'],
    array['opname_line', ''],
    array['physical_count', 'counted_by,checked_by'],
    array['physical_count_line', ''],
    array['correction', ''],
    array['day_status', 'submitted_by,approved_by,locked_by'],
    array['sales_plan', ''],
    array['market_price', ''],
    array['cash_plan', ''],
    array['cash_balance', ''],
    array['flock', ''],
    array['flock_depletion', '']
  ] loop
    execute format('drop trigger if exists %I on %I', spec[1] || '_actor', spec[1]);
    execute format(
      'create trigger %I before insert or update on %I for each row execute function enforce_actor(%L)',
      spec[1] || '_actor', spec[1], spec[2]
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. R-60 / R-61 / K11 — status koreksi hanya lewat RPC
-- ---------------------------------------------------------------------------
create or replace function correction_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rpc boolean := coalesce(current_setting('winata.rpc', true), '') = 'correction';
  v_keep text[] := array['deleted_at', 'delete_reason', 'updated_at'];
begin
  if current_app_role() is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'draft' or new.approved_by is not null or new.approved_at is not null or new.posted_at is not null then
      raise exception 'Status koreksi hanya berubah lewat tombol Setujui (BoD) dan Posting (Accounting).'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if old.status = 'posted' and not v_rpc then
    if (to_jsonb(new) - v_keep) is distinct from (to_jsonb(old) - v_keep) then
      raise exception 'Koreksi yang sudah diposting tidak bisa diubah. Batalkan dengan alasan, lalu buat koreksi baru.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if not v_rpc and (
    new.status is distinct from old.status
    or new.approved_by is distinct from old.approved_by
    or new.approved_at is distinct from old.approved_at
    or new.posted_at is distinct from old.posted_at
  ) then
    raise exception 'Status koreksi hanya berubah lewat tombol Setujui (BoD) dan Posting (Accounting).'
      using errcode = '42501';
  end if;

  -- Isi berubah setelah disetujui BoD: persetujuan gugur.
  if not v_rpc and old.status = 'approved' and (
    new.kg is distinct from old.kg
    or new.amount_rp is distinct from old.amount_rp
    or new.grade_id is distinct from old.grade_id
    or new.location_id is distinct from old.location_id
    or new.effective_date is distinct from old.effective_date
  ) then
    new.status := 'draft';
    new.approved_by := null;
    new.approved_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists correction_guard on correction;
create trigger correction_guard before insert or update on correction
for each row execute function correction_guard();

drop policy if exists correction_write on correction;
drop policy if exists correction_insert on correction;
create policy correction_insert on correction for insert to authenticated
  with check (is_accounting());
drop policy if exists correction_update on correction;
create policy correction_update on correction for update to authenticated
  using (is_accounting() and deleted_at is null)
  with check (is_accounting());

create or replace function approve_correction(p_correction uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row correction;
begin
  if coalesce(current_app_role(), '') <> 'bod' then
    raise exception 'Hanya BoD yang boleh menyetujui koreksi di atas batas' using errcode = '42501';
  end if;
  select * into v_row from correction where id = p_correction and deleted_at is null for update;
  if not found then
    raise exception 'Koreksi tidak ditemukan' using errcode = 'P0002';
  end if;
  if v_row.status = 'posted' then
    raise exception 'Koreksi sudah diposting' using errcode = '42501';
  end if;
  perform set_config('winata.rpc', 'correction', true);
  update correction
     set status = 'approved', approved_by = auth.uid(), approved_at = now(), updated_at = now()
   where id = v_row.id;
  perform set_config('winata.rpc', '', true);
  return 'approved';
end;
$$;

create or replace function post_correction(p_correction uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := current_app_role();
  v_row correction;
  v_threshold_rp numeric := param_numeric('bod_threshold_rp', 10000000);
  v_threshold_pct numeric := param_numeric('bod_threshold_pct', 0.02);
  v_stock numeric;
  v_bod_ok boolean;
begin
  if coalesce(v_role, '') not in ('accounting', 'admin') then
    raise exception 'Hanya accounting yang boleh memposting koreksi' using errcode = '42501';
  end if;

  select * into v_row from correction where id = p_correction and deleted_at is null for update;
  if not found then
    raise exception 'Koreksi tidak ditemukan' using errcode = 'P0002';
  end if;
  if v_row.status = 'posted' then
    return 'posted';
  end if;

  -- R-61: batas dihitung dari nilai saat ini; persetujuan BoD hanya sah bila
  -- status masih 'approved' (R-60 menggugurkannya saat isi berubah).
  v_stock := abs(location_stock_kg(v_row.location_id, v_row.effective_date));
  v_bod_ok := v_row.status = 'approved' and exists (
    select 1 from app_user
     where id = v_row.approved_by and role = 'bod' and active and deleted_at is null
  ) and v_row.approved_at is not null;

  if (abs(v_row.amount_rp) > v_threshold_rp
      or (v_stock > 0 and abs(v_row.kg) > v_threshold_pct * v_stock))
     and not v_bod_ok then
    raise exception 'Melebihi batas BoD (Rp % jt / % %% stok). Menunggu persetujuan BoD.',
      fmt_num(v_threshold_rp / 1000000), fmt_num(v_threshold_pct * 100) using errcode = '42501';
  end if;

  perform set_config('winata.rpc', 'correction', true);
  update correction
     set status = 'posted', posted_at = now(),
         approved_by = coalesce(approved_by, auth.uid()),
         approved_at = coalesce(approved_at, now()),
         updated_at = now()
   where id = v_row.id;
  perform set_config('winata.rpc', '', true);
  return 'posted';
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. R-63 / K13 — tidak ada hard delete; batalkan = deleted_at dengan jejak
-- ---------------------------------------------------------------------------
create or replace function soft_delete_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := current_app_role();
  v_keep text[] := array['deleted_at', 'delete_reason', 'updated_at'];
  v_new jsonb := to_jsonb(new);
  v_old jsonb := to_jsonb(old);
  v_location uuid;
  v_date date;
  v_day text;
  v_reason_required boolean := false;
begin
  if v_role is null then
    return new;
  end if;

  if old.deleted_at is not null then
    raise exception 'Data yang sudah dibatalkan tidak bisa diubah atau dihidupkan lagi.' using errcode = '42501';
  end if;
  if new.deleted_at is null then
    return new;
  end if;

  -- Pembatalan: hanya deleted_at + delete_reason yang berubah.
  if (v_new - v_keep) is distinct from (v_old - v_keep) then
    raise exception 'Pembatalan hanya mengisi waktu dan alasan pembatalan; ubah data lain secara terpisah.'
      using errcode = '42501';
  end if;

  if tg_table_name = 'opname' and old.status = 'signed' then
    if v_role not in ('accounting', 'admin') then
      raise exception 'Hanya Accounting yang boleh membatalkan BA opname yang sudah ditandatangani.' using errcode = '42501';
    end if;
    v_reason_required := true;
  end if;

  if tg_table_name = 'correction' and old.status = 'posted' then
    if v_role not in ('accounting', 'admin') then
      raise exception 'Hanya Accounting yang boleh membatalkan koreksi yang sudah diposting.' using errcode = '42501';
    end if;
    v_reason_required := true;
  end if;

  if v_old ? 'location_id' and v_old ? 'date' then
    v_location := (v_old ->> 'location_id')::uuid;
    v_date := (v_old ->> 'date')::date;
    v_day := day_status_of(v_location, v_date);
    if tg_table_name = 'outbound' and v_day = 'locked' then
      raise exception 'DO di hari yang sudah dikunci tidak bisa dibatalkan. Buat koreksi lewat Accounting.'
        using errcode = '42501';
    end if;
    if v_day = 'approved' then
      v_reason_required := true;
    end if;
  end if;

  if v_reason_required and (new.delete_reason is null or length(trim(new.delete_reason)) < 10) then
    raise exception 'Alasan pembatalan wajib diisi (minimal 10 karakter). Posisi akan dibangun ulang dari tanggal ini.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'opname','opname_line','production','outbound','outbound_line','transfer','shrinkage',
    'physical_count','physical_count_line','correction','sales_plan','market_price','cash_plan',
    'cash_balance','flock','flock_depletion','location','house','grade','unit_conversion','customer',
    'parameter','item_map','app_user','user_location','hdp_standard','day_status'
  ] loop
    execute format('drop trigger if exists %I on %I', t || '_soft_delete', t);
    execute format(
      'create trigger %I before update on %I for each row execute function soft_delete_guard()',
      t || '_soft_delete', t
    );
  end loop;
end;
$$;

-- Hak DELETE dicabut; anon tidak punya hak tabel sama sekali (semua akses lewat login).
do $$
declare
  t text;
begin
  foreach t in array array[
    'opname','opname_line','production','outbound','outbound_line','transfer','shrinkage',
    'physical_count','physical_count_line','correction','sales_plan','market_price','cash_plan',
    'cash_balance','flock','flock_depletion','location','house','grade','unit_conversion','customer',
    'parameter','item_map','app_user','user_location','hdp_standard','day_status','audit_log',
    'rebuild_queue','position_daily','projection_daily','control_result'
  ] loop
    execute format('revoke delete on table %I from authenticated, anon', t);
  end loop;
end;
$$;
revoke all on all tables in schema public from anon;

drop policy if exists opname_delete on opname;
drop policy if exists outbound_delete on outbound;
drop policy if exists transfer_delete on transfer;

-- BA opname bertanda tangan immutable (K13): hanya pembatalan oleh accounting
-- dan lampiran foto. Baris opname dari BA bertanda tangan tidak bisa diubah.
create or replace function opname_signed_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_keep text[] := array['deleted_at', 'delete_reason', 'updated_at', 'photo_note'];
  v_status text;
begin
  if current_app_role() is null then
    return new;
  end if;
  if tg_table_name = 'opname' then
    if old.status = 'signed' and (to_jsonb(new) - v_keep) is distinct from (to_jsonb(old) - v_keep) then
      raise exception 'BA opname yang sudah ditandatangani tidak bisa diubah. Batalkan lewat Accounting bila perlu dihitung ulang.'
        using errcode = '42501';
    end if;
    return new;
  end if;
  select status into v_status from opname where id = new.opname_id;
  if v_status = 'signed' then
    raise exception 'BA opname yang sudah ditandatangani tidak bisa diubah. Batalkan lewat Accounting bila perlu dihitung ulang.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists opname_signed_guard on opname;
create trigger opname_signed_guard before update on opname
for each row execute function opname_signed_guard();
drop trigger if exists opname_line_signed_guard on opname_line;
create trigger opname_line_signed_guard before insert or update on opname_line
for each row execute function opname_signed_guard();

-- Manager menandatangani BA: kolom tanda tangan, id manager, dan status.
drop trigger if exists opname_guard on opname;
create trigger opname_guard before update on opname
for each row execute function guard_changed_columns('signed_manager_at,manager_id,status', 'manager');

-- ---------------------------------------------------------------------------
-- 6. R-68 / K14 — konfirmasi serah DO hanya oleh kandang
-- ---------------------------------------------------------------------------
create or replace function outbound_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := current_app_role();
  v_keep text[] := array['status', 'delivered_at', 'delivered_by', 'updated_at'];
  v_changed boolean;
begin
  if v_role is null or v_role in ('accounting', 'admin') then
    return new;
  end if;
  v_changed := new.status is distinct from old.status
    or new.delivered_at is distinct from old.delivered_at
    or new.delivered_by is distinct from old.delivered_by;

  if v_role = 'marketing' then
    if v_changed and not (
      old.status = 'dikirim' and new.status = 'diterima'
      and new.delivered_at is not distinct from old.delivered_at
      and new.delivered_by is not distinct from old.delivered_by
    ) then
      raise exception 'Serah DO dikonfirmasi oleh petugas kandang di layar Hari. Marketing hanya membuat dan menerima DO.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if v_role = 'kandang' then
    if (to_jsonb(new) - v_keep) is distinct from (to_jsonb(old) - v_keep) then
      raise exception 'Kolom DO selain status serah tidak boleh diubah oleh petugas kandang.' using errcode = '42501';
    end if;
    if v_changed and not (
      old.status = 'draft' and new.status = 'dikirim' and new.delivered_by = auth.uid() and new.delivered_at is not null
    ) then
      raise exception 'Petugas kandang hanya mengonfirmasi serah DO draft atas nama sendiri.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists outbound_guard on outbound;
create trigger outbound_guard before update on outbound
for each row execute function outbound_guard();

-- ---------------------------------------------------------------------------
-- 7. R-69 — WITH CHECK memeriksa status hari
-- ---------------------------------------------------------------------------
drop policy if exists physical_count_write on physical_count;
create policy physical_count_write on physical_count for all to authenticated
  using (
    (current_app_role() in ('kandang','manager') and has_location(location_id)
      and day_status_of(location_id, date) in ('open','submitted'))
    or (is_accounting() and day_status_of(location_id, date) <> 'locked')
  )
  with check (
    (current_app_role() in ('kandang','manager') and has_location(location_id)
      and day_status_of(location_id, date) in ('open','submitted'))
    or (is_accounting() and day_status_of(location_id, date) <> 'locked')
  );

drop policy if exists physical_count_line_write on physical_count_line;
create policy physical_count_line_write on physical_count_line for all to authenticated
  using (exists (
    select 1 from physical_count pc
    where pc.id = physical_count_line.physical_count_id
      and ((current_app_role() in ('kandang','manager') and has_location(pc.location_id)
            and day_status_of(pc.location_id, pc.date) in ('open','submitted'))
           or (is_accounting() and day_status_of(pc.location_id, pc.date) <> 'locked'))
  ))
  with check (exists (
    select 1 from physical_count pc
    where pc.id = physical_count_line.physical_count_id
      and ((current_app_role() in ('kandang','manager') and has_location(pc.location_id)
            and day_status_of(pc.location_id, pc.date) in ('open','submitted'))
           or (is_accounting() and day_status_of(pc.location_id, pc.date) <> 'locked'))
  ));

drop policy if exists opname_update on opname;
create policy opname_update on opname for update to authenticated
  using (
    is_accounting()
    or (current_app_role() in ('kandang','manager') and has_location(location_id)
        and day_status_of(location_id, date) in ('open','submitted'))
  )
  with check (
    (is_accounting() and day_status_of(location_id, date) <> 'locked')
    or (current_app_role() in ('kandang','manager') and has_location(location_id)
        and day_status_of(location_id, date) in ('open','submitted'))
  );

drop policy if exists transfer_update on transfer;
create policy transfer_update on transfer for update to authenticated
  using (
    is_accounting()
    or (current_app_role() = 'kandang' and (
      (has_location(from_location_id) and day_status_of(from_location_id, sent_date) in ('open','submitted'))
      or has_location(to_location_id)
    ))
  )
  with check (
    (is_accounting()
      and day_status_of(from_location_id, sent_date) <> 'locked'
      and (received_date is null or day_status_of(to_location_id, received_date) <> 'locked'))
    or (current_app_role() = 'kandang' and (
      (has_location(from_location_id) and status = 'in_transit'
        and day_status_of(from_location_id, sent_date) in ('open','submitted'))
      or (has_location(to_location_id) and received_date is not null
        and day_status_of(to_location_id, received_date) in ('open','submitted'))
    ))
  );

-- ---------------------------------------------------------------------------
-- 8. R-67 — K4 di lock_day: OR per grade, catatan minimal 10 karakter
-- ---------------------------------------------------------------------------
create or replace function lock_day(p_location uuid, p_date date)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := current_app_role();
  v_row day_status;
  v_tolerance_pct numeric := param_numeric('tolerance_pct', 0.01);
  v_tolerance_kg numeric := param_numeric('tolerance_kg', 50);
  v_bad record;
  v_pct text;
begin
  if coalesce(v_role, '') not in ('accounting', 'admin') then
    raise exception 'Hanya accounting yang boleh mengunci hari' using errcode = '42501';
  end if;

  select * into v_row from day_status
   where location_id = p_location and date = p_date and deleted_at is null
   for update;
  if not found or v_row.status <> 'approved' then
    raise exception 'Hari harus disetujui manager sebelum dikunci (status: %)', coalesce(v_row.status, 'open')
      using errcode = '42501';
  end if;

  select pc.date, pc.note, g.code as grade_code, l.diff_kg, l.computed_kg
    into v_bad
    from physical_count pc
    join physical_count_line l on l.physical_count_id = pc.id and l.deleted_at is null
    join grade g on g.id = l.grade_id
   where pc.location_id = p_location and pc.deleted_at is null
     and pc.date between p_date - 7 and p_date
     and (
       abs(coalesce(l.diff_kg, 0)) > v_tolerance_kg
       or (coalesce(l.computed_kg, 0) <> 0
           and abs(coalesce(l.diff_kg, 0)) > v_tolerance_pct * abs(l.computed_kg))
     )
     and (pc.note is null or length(trim(pc.note)) < 10)
   order by abs(coalesce(l.diff_kg, 0)) desc
   limit 1;
  if found then
    v_pct := case
      when coalesce(v_bad.computed_kg, 0) = 0 then '—'
      else fmt_num(abs(v_bad.diff_kg) / abs(v_bad.computed_kg) * 100) || ' %'
    end;
    raise exception 'Selisih hitung fisik % % kg (%) melebihi toleransi (% kg atau % %%). Isi penjelasan minimal 10 karakter di hitung fisik tanggal %.',
      v_bad.grade_code,
      case when v_bad.diff_kg > 0 then '+' else '' end || fmt_num(v_bad.diff_kg),
      v_pct,
      fmt_num(v_tolerance_kg),
      fmt_num(v_tolerance_pct * 100),
      to_char(v_bad.date, 'DD-MM-YYYY')
      using errcode = '23514';
  end if;

  update day_status
     set status = 'locked', locked_by = auth.uid(), locked_at = now(), updated_at = now()
   where id = v_row.id;
  return 'locked';
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. R-65 — antrean rebuild bergenerasi
-- ---------------------------------------------------------------------------
create or replace function enqueue_rebuild(p_location uuid, p_from date)
returns void
language sql
security definer
set search_path = public
as $$
  insert into rebuild_queue (location_id, from_date, status, claimed_at, generation)
  values (p_location, p_from, 'queued', null, 1)
  on conflict (location_id) do update
    set from_date = case
          when rebuild_queue.status = 'done' then excluded.from_date
          else least(rebuild_queue.from_date, excluded.from_date)
        end,
        status = case when rebuild_queue.status = 'running' then 'running' else 'queued' end,
        claimed_at = case when rebuild_queue.status = 'running' then rebuild_queue.claimed_at else null end,
        generation = rebuild_queue.generation + 1,
        updated_at = now()
$$;

drop function if exists claim_rebuild(integer);
-- Klaim atomik: dua pemanggil tidak pernah mendapat baris yang sama. Baris
-- 'running' yang macet > 15 menit (worker mati) boleh diklaim ulang.
create function claim_rebuild(p_limit integer default 5)
returns table (location_id uuid, from_date date, generation bigint)
language sql
security definer
set search_path = public
as $$
  with claimed as (
    update rebuild_queue q
       set status = 'running', claimed_at = now(), updated_at = now()
     where q.id in (
       select id from rebuild_queue
        where status = 'queued'
           or (status = 'running' and claimed_at < now() - interval '15 minutes')
        order by from_date asc
        limit greatest(0, least(coalesce(p_limit, 5), 50))
        for update skip locked
     )
    returning q.location_id, q.from_date, q.generation
  )
  select claimed.location_id, claimed.from_date, claimed.generation from claimed
$$;

create or replace function mark_rebuild_done(p_location uuid, p_generation bigint)
returns void
language sql
security definer
set search_path = public
as $$
  update rebuild_queue
     set status = case when generation = p_generation then 'done' else 'queued' end,
         claimed_at = null,
         updated_at = now()
   where location_id = p_location;
$$;

-- Tanda tangan lama dipertahankan: tanpa generation selalu kembali 'queued'
-- (aman: worker berikutnya membangun ulang). Pemanggil baru memakai versi (uuid, bigint).
create or replace function mark_rebuild_done(p_location uuid)
returns void
language sql
security definer
set search_path = public
as $$ select mark_rebuild_done(p_location, -1::bigint) $$;

-- ---------------------------------------------------------------------------
-- 10. R-66 — trigger antre memakai nilai lama DAN baru
-- ---------------------------------------------------------------------------
create or replace function txn_enqueue_rebuild()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent record;
begin
  if tg_table_name in ('outbound_line', 'opname_line') then
    if tg_op <> 'DELETE' then
      if tg_table_name = 'outbound_line' then
        select o.location_id, o.date into v_parent from outbound o where o.id = new.outbound_id;
      else
        select o.location_id, o.date into v_parent from opname o where o.id = new.opname_id;
      end if;
      if v_parent.location_id is not null then
        perform enqueue_rebuild(v_parent.location_id, v_parent.date);
      end if;
    end if;
    if tg_op <> 'INSERT' then
      if tg_table_name = 'outbound_line' then
        select o.location_id, o.date into v_parent from outbound o where o.id = old.outbound_id;
      else
        select o.location_id, o.date into v_parent from opname o where o.id = old.opname_id;
      end if;
      if v_parent.location_id is not null then
        perform enqueue_rebuild(v_parent.location_id, v_parent.date);
      end if;
    end if;
    return coalesce(new, old);
  end if;

  if tg_table_name = 'transfer' then
    if tg_op <> 'DELETE' then
      perform enqueue_rebuild(new.from_location_id, new.sent_date);
      perform enqueue_rebuild(new.to_location_id, coalesce(new.received_date, new.sent_date));
    end if;
    if tg_op <> 'INSERT' then
      perform enqueue_rebuild(old.from_location_id, old.sent_date);
      perform enqueue_rebuild(old.to_location_id, coalesce(old.received_date, old.sent_date));
    end if;
    return coalesce(new, old);
  end if;

  if tg_table_name = 'correction' then
    -- Koreksi draft/approved belum mengubah posisi; hanya posted (lama atau baru).
    if tg_op <> 'DELETE' and new.status = 'posted' then
      perform enqueue_rebuild(new.location_id, new.effective_date);
    end if;
    if tg_op <> 'INSERT' and old.status = 'posted' then
      perform enqueue_rebuild(old.location_id, old.effective_date);
    end if;
    return coalesce(new, old);
  end if;

  -- production, shrinkage, outbound, opname
  if tg_op <> 'DELETE' and new.location_id is not null and new.date is not null then
    perform enqueue_rebuild(new.location_id, new.date);
  end if;
  if tg_op <> 'INSERT' and old.location_id is not null and old.date is not null then
    perform enqueue_rebuild(old.location_id, old.date);
  end if;
  return coalesce(new, old);
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. R-64 — akun Auth tertaut ke app_user (FK on update cascade)
-- ---------------------------------------------------------------------------
do $$
declare
  c record;
begin
  for c in
    select con.conname, con.conrelid::regclass::text as tbl, pg_get_constraintdef(con.oid) as def
      from pg_constraint con
     where con.contype = 'f'
       and con.confrelid = 'public.app_user'::regclass
       and con.confupdtype <> 'c'
  loop
    execute format('alter table %s drop constraint %I', c.tbl, c.conname);
    execute format('alter table %s add constraint %I %s on update cascade', c.tbl, c.conname, c.def);
  end loop;
end;
$$;

create or replace function auth_users_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old uuid;
  t text;
begin
  select id into v_old
    from public.app_user
   where lower(email) = lower(new.email) and deleted_at is null and id <> new.id
   limit 1;
  if v_old is null then
    return new;
  end if;

  update public.app_user set id = new.id where id = v_old;

  for t in
    select c.table_name
      from information_schema.columns c
      join information_schema.tables tb
        on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
     where c.table_schema = 'public' and c.column_name = 'created_by'
  loop
    execute format('update public.%I set created_by = $1 where created_by = $2', t) using new.id, v_old;
  end loop;
  return new;
end;
$$;

drop trigger if exists auth_users_link on auth.users;
create trigger auth_users_link
after insert on auth.users
for each row execute function auth_users_link();

-- Shim lokal: login dibuat dengan id = app_user.id (tidak perlu ditautkan ulang).
create or replace function set_login_password(p_email text, p_password text)
returns void
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_has_encrypted boolean;
  v_user_id uuid;
begin
  select id into v_user_id from app_user
   where lower(email) = lower(p_email) and active and deleted_at is null;
  if v_user_id is null then
    raise exception 'Email % tidak ada di allow-list', p_email using errcode = '42501';
  end if;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'auth' and table_name = 'users' and column_name = 'encrypted_password'
  ) into v_has_encrypted;

  if v_has_encrypted then
    execute 'update auth.users set encrypted_password = extensions.crypt($1, extensions.gen_salt(''bf'')), updated_at = now() where lower(email) = lower($2)'
      using p_password, p_email;
  else
    update auth.users
       set password_hash = encode(sha256(convert_to(p_password || '::winata-local', 'UTF8')), 'hex')
     where lower(email) = lower(p_email);
    if not found then
      insert into auth.users (id, email, password_hash)
      values (v_user_id, lower(p_email), encode(sha256(convert_to(p_password || '::winata-local', 'UTF8')), 'hex'));
    end if;
  end if;
end;
$$;

-- Admin pertama & akun lewat SQL (service_role / SQL Editor / MCP execute_sql).
create or replace function create_login(p_email text, p_password text)
returns uuid
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_user app_user;
  v_auth uuid;
  v_supabase boolean;
begin
  if p_password is null or length(p_password) < 8 then
    raise exception 'Kata sandi minimal 8 karakter.' using errcode = '23514';
  end if;
  select * into v_user from app_user
   where lower(email) = lower(p_email) and active and deleted_at is null;
  if not found then
    raise exception 'Email % tidak ada di allow-list', p_email using errcode = '42501';
  end if;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'auth' and table_name = 'users' and column_name = 'encrypted_password'
  ) into v_supabase;

  if not v_supabase then
    perform set_login_password(p_email, p_password);
    select id into v_auth from auth.users where lower(email) = lower(p_email);
    return v_auth;
  end if;

  execute 'select id from auth.users where lower(email) = lower($1)' into v_auth using p_email;
  if v_auth is not null then
    execute 'update auth.users set encrypted_password = extensions.crypt($1, extensions.gen_salt(''bf'')), updated_at = now() where id = $2'
      using p_password, v_auth;
    return v_auth;
  end if;

  v_auth := v_user.id;
  execute $sql$
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', lower($2),
      extensions.crypt($3, extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('name', $4::text), now(), now(),
      '', '', '', ''
    )
  $sql$ using v_auth, p_email, p_password, v_user.name;
  execute $sql$
    insert into auth.identities (
      id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(), $1, $1::text,
      jsonb_build_object('sub', $1::text, 'email', lower($2), 'email_verified', true),
      'email', now(), now(), now()
    )
  $sql$ using v_auth, p_email;
  return v_auth;
end;
$$;

-- user_location: penugasan yang dibatalkan tidak lagi memberi akses.
create or replace function my_locations()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select ul.location_id
  from user_location ul
  join app_user u on u.id = ul.user_id and u.active and u.deleted_at is null
  where ul.user_id = auth.uid() and ul.deleted_at is null
$$;

-- ---------------------------------------------------------------------------
-- 12. Parameter baru (R-70, R-71, R-73). Default; pemilik mengganti di Admin.
-- ---------------------------------------------------------------------------
insert into parameter (key, value, valid_from, note) values
  ('tb_total_rp', '389792323'::jsonb, '2026-07-01', 'Nilai buku pembanding rekonstruksi = 383.582.877 + 6.209.446 (Q-21)'),
  ('coa_inventory_egg', '"<isi dari CoA Winata> Persediaan Telur"'::jsonb, '2026-07-01', 'Akun jurnal persediaan telur (Q-22)'),
  ('coa_inventory_variance', '"<isi dari CoA Winata> Selisih Persediaan (Pending RS-05)"'::jsonb, '2026-07-01', 'Akun jurnal selisih persediaan (Q-22)'),
  ('reconstruct_missing_basis', '{"production":"june_avg","outbound":"period_avg"}'::jsonb, '2026-07-01', 'Basis estimasi hari bolong rekonstruksi')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 13. Hak eksekusi fungsi. Di Supabase, default privileges memberi EXECUTE ke
-- anon/authenticated untuk setiap fungsi baru; "revoke from public" saja tidak
-- cukup. Cabut semua, lalu beri hanya yang dipakai policy/RPC.
-- ---------------------------------------------------------------------------
do $$
declare
  f record;
begin
  for f in
    select format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end;
$$;

grant execute on function schema_version() to anon, authenticated;
grant execute on function is_app_user() to authenticated;
grant execute on function current_app_role() to authenticated;
grant execute on function my_locations() to authenticated;
grant execute on function has_location(uuid) to authenticated;
grant execute on function is_bod() to authenticated;
grant execute on function can_read_all() to authenticated;
grant execute on function is_accounting() to authenticated;
grant execute on function day_status_of(uuid, date) to authenticated;
grant execute on function txn_write_allowed(uuid, date) to authenticated;
grant execute on function outbound_write_allowed(uuid, date) to authenticated;
grant execute on function can_read_location(uuid) to authenticated;
grant execute on function submit_day(uuid, date) to authenticated;
grant execute on function approve_day(uuid, date) to authenticated;
grant execute on function return_day(uuid, date, text) to authenticated;
grant execute on function lock_day(uuid, date) to authenticated;
grant execute on function approve_correction(uuid) to authenticated;
grant execute on function post_correction(uuid) to authenticated;
-- guard_changed_columns adalah fungsi trigger biasa (bukan security definer).
grant execute on function guard_changed_columns() to authenticated;
