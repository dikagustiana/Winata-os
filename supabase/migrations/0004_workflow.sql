-- 0004_workflow.sql
-- Status hari (R-20), pemisahan tugas K1, K2, K4, K9 sebagai fungsi SQL
-- security definer dengan cek peran di dalamnya (ARCHITECTURE §1/§3).

-- ---------------------------------------------------------------------------
-- Helper parameter & stok
-- ---------------------------------------------------------------------------
create or replace function param_numeric(p_key text, p_default numeric)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case jsonb_typeof(value)
      when 'number' then (value #>> '{}')::numeric
      when 'string' then (value #>> '{}')::numeric
      else null
    end
    from parameter
    where key = p_key and deleted_at is null and valid_from <= current_date
    order by valid_from desc limit 1
  ), p_default)
$$;

create or replace function location_stock_kg(p_location uuid, p_date date)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(closing), 0)
  from position_daily
  where location_id = p_location
    and date = (
      select max(date) from position_daily
      where location_id = p_location and date <= p_date
    )
$$;

create or replace function day_has_negative_closing(p_location uuid, p_date date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from position_daily
    where location_id = p_location and date = p_date and closing < 0
  )
$$;

-- ---------------------------------------------------------------------------
-- day_status: dibuat lazy saat pertama dibutuhkan
-- ---------------------------------------------------------------------------
create or replace function ensure_day_status(p_location uuid, p_date date)
returns day_status
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row day_status;
begin
  select * into v_row from day_status
   where location_id = p_location and date = p_date and deleted_at is null
   for update;
  if found then
    return v_row;
  end if;
  insert into day_status (location_id, date, status)
  values (p_location, p_date, 'open')
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function current_user_has_input(p_location uuid, p_date date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from production
     where location_id = p_location and date = p_date and created_by = auth.uid() and deleted_at is null
    union all
    select 1 from shrinkage
     where location_id = p_location and date = p_date and created_by = auth.uid() and deleted_at is null
    union all
    select 1 from transfer
     where (from_location_id = p_location and sent_date = p_date
            or to_location_id = p_location and coalesce(received_date, sent_date) = p_date)
       and created_by = auth.uid() and deleted_at is null
    union all
    select 1 from outbound
     where location_id = p_location and date = p_date
       and (created_by = auth.uid() or delivered_by = auth.uid()) and deleted_at is null
    union all
    select 1 from physical_count
     where location_id = p_location and date = p_date and created_by = auth.uid() and deleted_at is null
    union all
    select 1 from opname
     where location_id = p_location and date = p_date and created_by = auth.uid() and deleted_at is null
  )
$$;

-- ---------------------------------------------------------------------------
-- Transisi status
-- ---------------------------------------------------------------------------
create or replace function submit_day(p_location uuid, p_date date)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := current_app_role();
  v_row day_status;
begin
  if v_role not in ('kandang', 'accounting', 'admin') then
    raise exception 'Peran % tidak boleh menyelesaikan hari', v_role using errcode = '42501';
  end if;
  if v_role = 'kandang' and not has_location(p_location) then
    raise exception 'Lokasi bukan penugasan Anda' using errcode = '42501';
  end if;

  v_row := ensure_day_status(p_location, p_date);
  if v_row.status = 'submitted' then
    return 'submitted';
  end if;
  if v_row.status <> 'open' then
    raise exception 'Hari berstatus % tidak bisa diselesaikan', v_row.status using errcode = '42501';
  end if;
  if day_has_negative_closing(p_location, p_date) then
    raise exception 'Stok akhir negatif pada %. Periksa produksi, DO, atau susut sebelum menyelesaikan hari.', p_date
      using errcode = '23514';
  end if;

  update day_status
     set status = 'submitted', submitted_by = auth.uid(), submitted_at = now(),
         return_reason = null, updated_at = now()
   where id = v_row.id;
  return 'submitted';
end;
$$;

create or replace function approve_day(p_location uuid, p_date date)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := current_app_role();
  v_row day_status;
begin
  if v_role not in ('manager', 'admin') then
    raise exception 'Hanya manager yang boleh menyetujui hari' using errcode = '42501';
  end if;
  if v_role = 'manager' and not has_location(p_location) then
    raise exception 'Lokasi bukan penugasan Anda' using errcode = '42501';
  end if;

  select * into v_row from day_status
   where location_id = p_location and date = p_date and deleted_at is null
   for update;
  if not found or v_row.status <> 'submitted' then
    raise exception 'Hari belum berstatus submitted (status: %)', coalesce(v_row.status, 'open')
      using errcode = '42501';
  end if;

  -- K1: penginput tidak boleh menjadi penyetuju hari yang sama di lokasi yang sama.
  if current_user_has_input(p_location, p_date) then
    raise exception 'Anda menginput transaksi hari ini di lokasi ini, jadi tidak boleh menyetujuinya (pemisahan tugas).'
      using errcode = '42501';
  end if;
  if v_row.submitted_by = auth.uid() then
    raise exception 'Anda yang menyelesaikan hari ini, jadi tidak boleh menyetujuinya (pemisahan tugas).'
      using errcode = '42501';
  end if;

  -- K2
  if day_has_negative_closing(p_location, p_date) then
    raise exception 'Stok akhir negatif; hari tidak bisa disetujui sampai dikoreksi.' using errcode = '23514';
  end if;

  update day_status
     set status = 'approved', approved_by = auth.uid(), approved_at = now(), updated_at = now()
   where id = v_row.id;
  return 'approved';
end;
$$;

create or replace function return_day(p_location uuid, p_date date, p_reason text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := current_app_role();
  v_row day_status;
begin
  if v_role not in ('manager', 'admin') then
    raise exception 'Hanya manager yang boleh mengembalikan hari' using errcode = '42501';
  end if;
  if v_role = 'manager' and not has_location(p_location) then
    raise exception 'Lokasi bukan penugasan Anda' using errcode = '42501';
  end if;
  if p_reason is null or length(trim(p_reason)) < 5 then
    raise exception 'Alasan pengembalian wajib diisi (minimal 5 karakter)' using errcode = '23514';
  end if;

  select * into v_row from day_status
   where location_id = p_location and date = p_date and deleted_at is null
   for update;
  if not found or v_row.status <> 'submitted' then
    raise exception 'Hanya hari berstatus submitted yang bisa dikembalikan' using errcode = '42501';
  end if;

  update day_status
     set status = 'open', submitted_by = null, submitted_at = null,
         return_reason = p_reason, updated_at = now()
   where id = v_row.id;
  return 'open';
end;
$$;

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
begin
  if v_role not in ('accounting', 'admin') then
    raise exception 'Hanya accounting yang boleh mengunci hari' using errcode = '42501';
  end if;

  select * into v_row from day_status
   where location_id = p_location and date = p_date and deleted_at is null
   for update;
  if not found or v_row.status <> 'approved' then
    raise exception 'Hari harus disetujui manager sebelum dikunci (status: %)', coalesce(v_row.status, 'open')
      using errcode = '42501';
  end if;

  -- K4: selisih hitung fisik melebihi toleransi wajib punya penjelasan.
  select pc.id, pc.date, pc.note, l.grade_id, l.diff_kg
    into v_bad
    from physical_count pc
    join physical_count_line l on l.physical_count_id = pc.id and l.deleted_at is null
   where pc.location_id = p_location and pc.deleted_at is null
     and pc.date between p_date - 7 and p_date
     and abs(coalesce(l.diff_kg, 0)) > v_tolerance_kg
     and abs(coalesce(l.diff_kg, 0)) > v_tolerance_pct * greatest(
       coalesce((select sum(closing) from position_daily
                  where location_id = p_location and date = pc.date), 0), 0
     )
     and (pc.note is null or length(trim(pc.note)) < 3)
   limit 1;
  if found then
    raise exception 'Selisih hitung fisik tanggal % melebihi toleransi dan belum ada penjelasan. Isi catatan hitung fisik dulu.',
      v_bad.date using errcode = '23514';
  end if;

  update day_status
     set status = 'locked', locked_by = auth.uid(), locked_at = now(), updated_at = now()
   where id = v_row.id;
  return 'locked';
end;
$$;

-- ---------------------------------------------------------------------------
-- Koreksi (K9) dan approval BoD
-- ---------------------------------------------------------------------------
create or replace function approve_correction(p_correction uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row correction;
begin
  if current_app_role() <> 'bod' then
    raise exception 'Hanya BoD yang boleh menyetujui koreksi di atas batas' using errcode = '42501';
  end if;
  select * into v_row from correction where id = p_correction and deleted_at is null for update;
  if not found then
    raise exception 'Koreksi tidak ditemukan' using errcode = 'P0002';
  end if;
  if v_row.status = 'posted' then
    raise exception 'Koreksi sudah diposting' using errcode = '42501';
  end if;
  update correction
     set status = 'approved', approved_by = auth.uid(), approved_at = now(), updated_at = now()
   where id = v_row.id;
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
  if v_role not in ('accounting', 'admin') then
    raise exception 'Hanya accounting yang boleh memposting koreksi' using errcode = '42501';
  end if;

  select * into v_row from correction where id = p_correction and deleted_at is null for update;
  if not found then
    raise exception 'Koreksi tidak ditemukan' using errcode = 'P0002';
  end if;
  if v_row.status = 'posted' then
    return 'posted';
  end if;

  v_stock := abs(location_stock_kg(v_row.location_id, v_row.effective_date));
  v_bod_ok := exists (
    select 1 from app_user where id = v_row.approved_by and role = 'bod' and active
  );

  -- K9: di atas batas Rp atau % stok lokasi wajib disetujui BoD.
  if (abs(v_row.amount_rp) > v_threshold_rp
      or (v_stock > 0 and abs(v_row.kg) > v_threshold_pct * v_stock))
     and not v_bod_ok then
    raise exception 'Koreksi melebihi batas BoD (Rp % atau % stok) dan belum disetujui BoD.',
      v_threshold_rp, v_threshold_pct using errcode = '42501';
  end if;

  update correction
     set status = 'posted', posted_at = now(),
         approved_by = coalesce(approved_by, auth.uid()),
         approved_at = coalesce(approved_at, now()),
         updated_at = now()
   where id = v_row.id;
  return 'posted';
end;
$$;

revoke all on function submit_day(uuid, date) from public;
revoke all on function approve_day(uuid, date) from public;
revoke all on function return_day(uuid, date, text) from public;
revoke all on function lock_day(uuid, date) from public;
revoke all on function approve_correction(uuid) from public;
revoke all on function post_correction(uuid) from public;
grant execute on function submit_day(uuid, date) to authenticated;
grant execute on function approve_day(uuid, date) to authenticated;
grant execute on function return_day(uuid, date, text) to authenticated;
grant execute on function lock_day(uuid, date) to authenticated;
grant execute on function approve_correction(uuid) to authenticated;
grant execute on function post_correction(uuid) to authenticated;
