-- 0002_security.sql
-- Peran, helper RLS, allow-list login, policy per tabel, penjaga kolom.
-- K1: pemisahan tugas ditegakkan di database (approve_day memeriksa pengisi).

-- ---------------------------------------------------------------------------
-- Role Postgres (di Supabase sudah ada; DO block membuat saat PGlite)
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end;
$$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- ---------------------------------------------------------------------------
-- Helper peran & lokasi
-- ---------------------------------------------------------------------------
create or replace function is_app_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from app_user
    where id = auth.uid() and active and deleted_at is null
  )
$$;

create or replace function current_app_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from app_user
  where id = auth.uid() and active and deleted_at is null
$$;

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
  where ul.user_id = auth.uid()
$$;

create or replace function has_location(p_location uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from my_locations() l where l = p_location)
$$;

create or replace function is_bod()
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select current_app_role() = 'bod' $$;

create or replace function can_read_all()
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select current_app_role() in ('accounting','admin','bod') $$;

create or replace function is_accounting()
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select current_app_role() in ('accounting','admin') $$;

create or replace function day_status_of(p_location uuid, p_date date)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select status from day_status
    where location_id = p_location and date = p_date and deleted_at is null
  ), 'open')
$$;

-- K1/R-20: siapa yang boleh menulis transaksi pada (lokasi, tanggal).
create or replace function txn_write_allowed(p_location uuid, p_date date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case current_app_role()
    when 'accounting' then day_status_of(p_location, p_date) <> 'locked'
    when 'admin' then day_status_of(p_location, p_date) <> 'locked'
    when 'kandang' then has_location(p_location) and day_status_of(p_location, p_date) in ('open','submitted')
    when 'marketing' then day_status_of(p_location, p_date) <> 'locked'
    when 'manager' then has_location(p_location) and day_status_of(p_location, p_date) in ('open','submitted')
    else false
  end
$$;

create or replace function outbound_write_allowed(p_location uuid, p_date date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case current_app_role()
    when 'accounting' then day_status_of(p_location, p_date) <> 'locked'
    when 'admin' then day_status_of(p_location, p_date) <> 'locked'
    when 'marketing' then day_status_of(p_location, p_date) <> 'locked'
    when 'kandang' then has_location(p_location) and day_status_of(p_location, p_date) in ('open','submitted')
    else false
  end
$$;

create or replace function can_read_location(p_location uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select is_app_user() and (
    can_read_all() or has_location(p_location)
  )
$$;

-- ---------------------------------------------------------------------------
-- Penjaga kolom: peran tertentu hanya boleh mengubah kolom yang diizinkan.
-- tg_argv[0] = daftar kolom dipisah koma; tg_argv[1] = daftar peran dipisah koma.
-- ---------------------------------------------------------------------------
create or replace function guard_changed_columns()
returns trigger
language plpgsql
as $$
declare
  v_allowed text[] := string_to_array(tg_argv[0], ',');
  v_roles text[] := string_to_array(tg_argv[1], ',');
  v_changed text[];
begin
  if current_app_role() = any(v_roles) then
    select coalesce(array_agg(coalesce(n.key, o.key)), '{}')
      into v_changed
    from jsonb_each(to_jsonb(new)) n
    full outer join jsonb_each(to_jsonb(old)) o on n.key = o.key
    where n.value is distinct from o.value
      and coalesce(n.key, o.key) <> 'updated_at';

    if exists (
      select 1 from unnest(v_changed) c where c <> all(v_allowed)
    ) then
      raise exception 'Kolom % tidak boleh diubah oleh peran %',
        array_to_string(array(select unnest(v_changed) except select unnest(v_allowed)), ', '),
        current_app_role()
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Allow-list login (K2): pendaftaran mandiri ditolak.
-- Admin membuat baris app_user lebih dulu; trigger hanya mengizinkan email itu.
-- ---------------------------------------------------------------------------
create or replace function enforce_login_allowlist()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from app_user
    where lower(email) = lower(new.email) and active and deleted_at is null
  ) then
    raise exception 'Pendaftaran mandiri ditolak: % tidak ada di allow-list', new.email
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists auth_users_allowlist on auth.users;
create trigger auth_users_allowlist
before insert on auth.users
for each row execute function enforce_login_allowlist();

-- ---------------------------------------------------------------------------
-- RLS: aktifkan di semua tabel
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'app_user','location','user_location','house','flock','flock_depletion','grade',
    'unit_conversion','customer','parameter','hdp_standard','item_map','day_status',
    'opname','opname_line','production','outbound','outbound_line','transfer','shrinkage',
    'physical_count','physical_count_line','correction','sales_plan','market_price',
    'cash_plan','cash_balance','accurate_upload','accurate_sales_line','accurate_stock_line',
    'reconciliation_item','audit_log','rebuild_queue','position_daily','projection_daily',
    'control_result'
  ] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- app_user / user_location
-- ---------------------------------------------------------------------------
drop policy if exists app_user_select on app_user;
create policy app_user_select on app_user for select to authenticated
  using (id = auth.uid() or is_accounting());

drop policy if exists app_user_write on app_user;
create policy app_user_write on app_user for all to authenticated
  using (current_app_role() = 'admin') with check (current_app_role() = 'admin');

drop policy if exists user_location_select on user_location;
create policy user_location_select on user_location for select to authenticated
  using (user_id = auth.uid() or is_accounting());

drop policy if exists user_location_write on user_location;
create policy user_location_write on user_location for all to authenticated
  using (current_app_role() = 'admin') with check (current_app_role() = 'admin');

-- ---------------------------------------------------------------------------
-- Master data: baca semua pengguna aktif; tulis accounting/admin
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'location','house','grade','unit_conversion','parameter','hdp_standard','item_map'
  ] loop
    execute format('drop policy if exists %I_select on %I', t, t);
    execute format(
      'create policy %I_select on %I for select to authenticated using (is_app_user())', t, t);
    execute format('drop policy if exists %I_write on %I', t, t);
    execute format(
      'create policy %I_write on %I for all to authenticated using (is_accounting()) with check (is_accounting())',
      t, t);
  end loop;
end;
$$;

drop policy if exists customer_select on customer;
create policy customer_select on customer for select to authenticated using (is_app_user());
drop policy if exists customer_write on customer;
create policy customer_write on customer for all to authenticated
  using (is_accounting() or current_app_role() = 'marketing')
  with check (is_accounting() or current_app_role() = 'marketing');

drop policy if exists flock_select on flock;
create policy flock_select on flock for select to authenticated using (is_app_user());
drop policy if exists flock_write on flock;
create policy flock_write on flock for all to authenticated
  using (
    is_accounting()
    or (current_app_role() = 'manager' and exists (
      select 1 from house h where h.id = flock.house_id and has_location(h.location_id)
    ))
  )
  with check (
    is_accounting()
    or (current_app_role() = 'manager' and exists (
      select 1 from house h where h.id = flock.house_id and has_location(h.location_id)
    ))
  );

drop policy if exists flock_depletion_select on flock_depletion;
create policy flock_depletion_select on flock_depletion for select to authenticated using (is_app_user());
drop policy if exists flock_depletion_write on flock_depletion;
create policy flock_depletion_write on flock_depletion for all to authenticated
  using (
    is_accounting()
    or (current_app_role() = 'manager' and exists (
      select 1 from flock f join house h on h.id = f.house_id
      where f.id = flock_depletion.flock_id and has_location(h.location_id)
    ))
  )
  with check (
    is_accounting()
    or (current_app_role() = 'manager' and exists (
      select 1 from flock f join house h on h.id = f.house_id
      where f.id = flock_depletion.flock_id and has_location(h.location_id)
    ))
  );

-- ---------------------------------------------------------------------------
-- day_status: baca semua; tulis hanya lewat fungsi (security definer)
-- ---------------------------------------------------------------------------
drop policy if exists day_status_select on day_status;
create policy day_status_select on day_status for select to authenticated using (is_app_user());

-- ---------------------------------------------------------------------------
-- Opname
-- ---------------------------------------------------------------------------
drop policy if exists opname_select on opname;
create policy opname_select on opname for select to authenticated
  using (can_read_location(location_id));

drop policy if exists opname_insert on opname;
create policy opname_insert on opname for insert to authenticated
  with check (
    is_accounting()
    or (current_app_role() in ('kandang','manager') and has_location(location_id)
        and day_status_of(location_id, date) in ('open','submitted'))
  );

drop policy if exists opname_update on opname;
create policy opname_update on opname for update to authenticated
  using (
    is_accounting()
    or (current_app_role() in ('kandang','manager') and has_location(location_id)
        and day_status_of(location_id, date) in ('open','submitted'))
  )
  with check (
    is_accounting()
    or (current_app_role() in ('kandang','manager') and has_location(location_id))
  );

drop policy if exists opname_delete on opname;
create policy opname_delete on opname for delete to authenticated using (is_accounting());

drop trigger if exists opname_guard on opname;
create trigger opname_guard before update on opname
for each row execute function guard_changed_columns('signed_manager_at', 'manager');

drop policy if exists opname_line_select on opname_line;
create policy opname_line_select on opname_line for select to authenticated
  using (exists (select 1 from opname o where o.id = opname_line.opname_id and can_read_location(o.location_id)));

drop policy if exists opname_line_write on opname_line;
create policy opname_line_write on opname_line for all to authenticated
  using (
    exists (
      select 1 from opname o
      where o.id = opname_line.opname_id
        and (is_accounting() or (current_app_role() in ('kandang','manager')
             and has_location(o.location_id)
             and day_status_of(o.location_id, o.date) in ('open','submitted')))
    )
  )
  with check (
    exists (
      select 1 from opname o
      where o.id = opname_line.opname_id
        and (is_accounting() or (current_app_role() in ('kandang','manager')
             and has_location(o.location_id)
             and day_status_of(o.location_id, o.date) in ('open','submitted')))
    )
  );

-- ---------------------------------------------------------------------------
-- Produksi & susut: kandang (lokasi sendiri, hari open/submitted), accounting/admin
-- ---------------------------------------------------------------------------
drop policy if exists production_select on production;
create policy production_select on production for select to authenticated
  using (can_read_location(location_id));

drop policy if exists production_write on production;
create policy production_write on production for all to authenticated
  using (
    (current_app_role() = 'kandang' and txn_write_allowed(location_id, date))
    or (is_accounting() and txn_write_allowed(location_id, date))
  )
  with check (
    (current_app_role() = 'kandang' and txn_write_allowed(location_id, date))
    or (is_accounting() and txn_write_allowed(location_id, date))
  );

drop policy if exists shrinkage_select on shrinkage;
create policy shrinkage_select on shrinkage for select to authenticated
  using (can_read_location(location_id));

drop policy if exists shrinkage_write on shrinkage;
create policy shrinkage_write on shrinkage for all to authenticated
  using (
    (current_app_role() = 'kandang' and txn_write_allowed(location_id, date))
    or (is_accounting() and txn_write_allowed(location_id, date))
  )
  with check (
    (current_app_role() = 'kandang' and txn_write_allowed(location_id, date))
    or (is_accounting() and txn_write_allowed(location_id, date))
  );

-- ---------------------------------------------------------------------------
-- Outbound (marketing dokumen; kandang konfirmasi serah)
-- ---------------------------------------------------------------------------
drop policy if exists outbound_select on outbound;
create policy outbound_select on outbound for select to authenticated
  using (can_read_location(location_id) or current_app_role() = 'marketing');

drop policy if exists outbound_insert on outbound;
create policy outbound_insert on outbound for insert to authenticated
  with check (outbound_write_allowed(location_id, date));

drop policy if exists outbound_update on outbound;
create policy outbound_update on outbound for update to authenticated
  using (outbound_write_allowed(location_id, date))
  with check (outbound_write_allowed(location_id, date));

drop policy if exists outbound_delete on outbound;
create policy outbound_delete on outbound for delete to authenticated
  using (is_accounting() or current_app_role() = 'marketing');

drop trigger if exists outbound_guard on outbound;
create trigger outbound_guard before update on outbound
for each row execute function guard_changed_columns('status,delivered_at,delivered_by', 'kandang');

drop policy if exists outbound_line_select on outbound_line;
create policy outbound_line_select on outbound_line for select to authenticated
  using (exists (
    select 1 from outbound o
    where o.id = outbound_line.outbound_id
      and (can_read_location(o.location_id) or current_app_role() = 'marketing')
  ));

drop policy if exists outbound_line_write on outbound_line;
create policy outbound_line_write on outbound_line for all to authenticated
  using (exists (
    select 1 from outbound o
    where o.id = outbound_line.outbound_id and outbound_write_allowed(o.location_id, o.date)
  ))
  with check (exists (
    select 1 from outbound o
    where o.id = outbound_line.outbound_id and outbound_write_allowed(o.location_id, o.date)
  ));

drop trigger if exists outbound_line_guard on outbound_line;
create trigger outbound_line_guard before update on outbound_line
for each row execute function guard_changed_columns('kg_delivered', 'kandang');

-- ---------------------------------------------------------------------------
-- Mutasi: asal (kirim) dan tujuan (terima)
-- ---------------------------------------------------------------------------
drop policy if exists transfer_select on transfer;
create policy transfer_select on transfer for select to authenticated
  using (can_read_location(from_location_id) or can_read_location(to_location_id));

drop policy if exists transfer_insert on transfer;
create policy transfer_insert on transfer for insert to authenticated
  with check (
    is_accounting()
    or (current_app_role() = 'kandang' and has_location(from_location_id)
        and day_status_of(from_location_id, sent_date) in ('open','submitted'))
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
    is_accounting()
    or (current_app_role() = 'kandang' and (
      has_location(from_location_id) or has_location(to_location_id)
    ))
  );

drop policy if exists transfer_delete on transfer;
create policy transfer_delete on transfer for delete to authenticated using (is_accounting());

drop trigger if exists transfer_guard on transfer;
create trigger transfer_guard before update on transfer
for each row execute function guard_changed_columns('status,received_date,note', 'kandang');

-- ---------------------------------------------------------------------------
-- Hitung fisik
-- ---------------------------------------------------------------------------
drop policy if exists physical_count_select on physical_count;
create policy physical_count_select on physical_count for select to authenticated
  using (can_read_location(location_id));

drop policy if exists physical_count_write on physical_count;
create policy physical_count_write on physical_count for all to authenticated
  using (
    (current_app_role() in ('kandang','manager') and has_location(location_id)
      and day_status_of(location_id, date) in ('open','submitted'))
    or (is_accounting() and day_status_of(location_id, date) <> 'locked')
  )
  with check (
    (current_app_role() in ('kandang','manager') and has_location(location_id))
    or (is_accounting() and day_status_of(location_id, date) <> 'locked')
  );

drop trigger if exists physical_count_guard on physical_count;
create trigger physical_count_guard before update on physical_count
for each row execute function guard_changed_columns('checked_by,status', 'manager');

drop policy if exists physical_count_line_select on physical_count_line;
create policy physical_count_line_select on physical_count_line for select to authenticated
  using (exists (
    select 1 from physical_count pc
    where pc.id = physical_count_line.physical_count_id and can_read_location(pc.location_id)
  ));

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
      and ((current_app_role() in ('kandang','manager') and has_location(pc.location_id))
           or (is_accounting() and day_status_of(pc.location_id, pc.date) <> 'locked'))
  ));

-- ---------------------------------------------------------------------------
-- Koreksi (R-20, K9). Posting lewat fungsi post_correction.
-- ---------------------------------------------------------------------------
drop policy if exists correction_select on correction;
create policy correction_select on correction for select to authenticated
  using (can_read_location(location_id));

drop policy if exists correction_write on correction;
create policy correction_write on correction for all to authenticated
  using (is_accounting() and status <> 'posted')
  with check (is_accounting());

-- ---------------------------------------------------------------------------
-- Rencana jual & harga acuan
-- ---------------------------------------------------------------------------
drop policy if exists sales_plan_select on sales_plan;
create policy sales_plan_select on sales_plan for select to authenticated using (is_app_user());

drop policy if exists sales_plan_write on sales_plan;
create policy sales_plan_write on sales_plan for all to authenticated
  using (is_accounting() or current_app_role() = 'marketing')
  with check (is_accounting() or current_app_role() = 'marketing');

drop policy if exists market_price_select on market_price;
create policy market_price_select on market_price for select to authenticated using (is_app_user());

drop policy if exists market_price_write on market_price;
create policy market_price_write on market_price for all to authenticated
  using (is_accounting() or current_app_role() = 'marketing')
  with check (is_accounting() or current_app_role() = 'marketing');

-- ---------------------------------------------------------------------------
-- Kas
-- ---------------------------------------------------------------------------
drop policy if exists cash_plan_select on cash_plan;
create policy cash_plan_select on cash_plan for select to authenticated using (is_accounting() or is_bod());

drop policy if exists cash_plan_write on cash_plan;
create policy cash_plan_write on cash_plan for all to authenticated
  using (is_accounting()) with check (is_accounting());

drop policy if exists cash_balance_select on cash_balance;
create policy cash_balance_select on cash_balance for select to authenticated using (is_accounting() or is_bod());

drop policy if exists cash_balance_write on cash_balance;
create policy cash_balance_write on cash_balance for all to authenticated
  using (is_accounting()) with check (is_accounting());

-- ---------------------------------------------------------------------------
-- Rekonsiliasi
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'accurate_upload','accurate_sales_line','accurate_stock_line','reconciliation_item'
  ] loop
    execute format('drop policy if exists %I_select on %I', t, t);
    execute format(
      'create policy %I_select on %I for select to authenticated using (is_accounting())', t, t);
    execute format('drop policy if exists %I_write on %I', t, t);
    execute format(
      'create policy %I_write on %I for all to authenticated using (is_accounting()) with check (is_accounting())',
      t, t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Hasil hitung: baca semua peran aktif; tulis hanya worker (service role)
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['position_daily','projection_daily','control_result'] loop
    execute format('drop policy if exists %I_select on %I', t, t);
    execute format(
      'create policy %I_select on %I for select to authenticated using (is_app_user())', t, t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Audit & antrean rebuild
-- ---------------------------------------------------------------------------
drop policy if exists audit_log_select on audit_log;
create policy audit_log_select on audit_log for select to authenticated using (is_accounting());

drop policy if exists rebuild_queue_select on rebuild_queue;
create policy rebuild_queue_select on rebuild_queue for select to authenticated using (is_accounting());

-- ---------------------------------------------------------------------------
-- Admin membuat/mengatur kata sandi login.
-- Di Supabase memakai kolom encrypted_password (pgcrypto tersedia di schema
-- extensions); di PGlite/lokal memakai password_hash shim dengan sha256.
-- Fungsi ini TIDAK di-grant ke API (PLAN: dijalankan admin di SQL Editor).
-- ---------------------------------------------------------------------------
create or replace function set_login_password(p_email text, p_password text)
returns void
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_has_encrypted boolean;
begin
  if not exists (
    select 1 from app_user
    where lower(email) = lower(p_email) and active and deleted_at is null
  ) then
    raise exception 'Email % tidak ada di allow-list', p_email using errcode = '42501';
  end if;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'auth' and table_name = 'users' and column_name = 'encrypted_password'
  ) into v_has_encrypted;

  if v_has_encrypted then
    execute 'update auth.users set encrypted_password = crypt($1, gen_salt(''bf'')) where lower(email) = lower($2)'
      using p_password, p_email;
  else
    update auth.users
       set password_hash = encode(sha256(convert_to(p_password || '::winata-local', 'UTF8')), 'hex')
     where lower(email) = lower(p_email);
    if not found then
      insert into auth.users (email, password_hash)
      values (lower(p_email), encode(sha256(convert_to(p_password || '::winata-local', 'UTF8')), 'hex'));
    end if;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Hak eksekusi fungsi
-- ---------------------------------------------------------------------------
revoke all on function set_login_password(text, text) from public;
revoke all on function schema_version() from public;
grant execute on function schema_version() to authenticated, anon;
grant execute on function set_login_password(text, text) to service_role;
