-- 0003_transactions.sql
-- Integritas transaksi, antrean rebuild posisi (R-15), dan klaim atomik.
-- Trigger mengantre (lokasi, from_date) setiap ada perubahan transaksi.

-- ---------------------------------------------------------------------------
-- Antrean rebuild
-- ---------------------------------------------------------------------------
create or replace function enqueue_rebuild(p_location uuid, p_from date)
returns void
language sql
security definer
set search_path = public
as $$
  insert into rebuild_queue (location_id, from_date, status, claimed_at)
  values (p_location, p_from, 'queued', null)
  on conflict (location_id) do update
    set from_date = least(rebuild_queue.from_date, excluded.from_date),
        status = 'queued',
        claimed_at = null,
        updated_at = now()
$$;

-- Klaim atomik: dua pemanggil tidak pernah mendapat baris yang sama.
create or replace function claim_rebuild(p_limit integer default 5)
returns table (location_id uuid, from_date date)
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
        order by from_date asc
        limit greatest(0, least(coalesce(p_limit, 5), 50))
        for update skip locked
     )
    returning q.location_id, q.from_date
  )
  select claimed.location_id, claimed.from_date from claimed
$$;

create or replace function mark_rebuild_done(p_location uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update rebuild_queue
     set status = 'done', updated_at = now()
   where location_id = p_location;
$$;

revoke all on function claim_rebuild(integer) from public;
revoke all on function enqueue_rebuild(uuid, date) from public;
revoke all on function mark_rebuild_done(uuid) from public;
grant execute on function claim_rebuild(integer) to service_role;
grant execute on function enqueue_rebuild(uuid, date) to service_role;
grant execute on function mark_rebuild_done(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Trigger antre rebuild pada tabel transaksi
-- ---------------------------------------------------------------------------
create or replace function txn_enqueue_rebuild()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_location uuid;
  v_date date;
  v_parent record;
begin
  if tg_table_name = 'outbound_line' then
    select o.location_id, o.date into v_parent
      from outbound o
     where o.id = coalesce(new.outbound_id, old.outbound_id);
    if v_parent.location_id is not null then
      perform enqueue_rebuild(v_parent.location_id, v_parent.date);
    end if;
    return coalesce(new, old);
  end if;

  if tg_table_name = 'opname_line' then
    select o.location_id, o.date into v_parent
      from opname o
     where o.id = coalesce(new.opname_id, old.opname_id);
    if v_parent.location_id is not null then
      perform enqueue_rebuild(v_parent.location_id, v_parent.date);
    end if;
    return coalesce(new, old);
  end if;

  if tg_table_name = 'transfer' then
    v_location := coalesce(new.from_location_id, old.from_location_id);
    v_date := coalesce(new.sent_date, old.sent_date);
    perform enqueue_rebuild(v_location, v_date);
    v_location := coalesce(new.to_location_id, old.to_location_id);
    v_date := coalesce(new.received_date, old.received_date, new.sent_date, old.sent_date);
    perform enqueue_rebuild(v_location, v_date);
    return coalesce(new, old);
  end if;

  if tg_table_name = 'correction' then
    -- Koreksi draft belum mengubah posisi; baru saat posted.
    if (tg_op = 'DELETE' and old.status = 'posted')
       or (tg_op = 'UPDATE' and (old.status = 'posted' or new.status = 'posted'))
       or (tg_op = 'INSERT' and new.status = 'posted') then
      perform enqueue_rebuild(
        coalesce(new.location_id, old.location_id),
        coalesce(new.effective_date, old.effective_date)
      );
    end if;
    return coalesce(new, old);
  end if;

  -- production, shrinkage, outbound, opname
  if tg_op = 'DELETE' then
    v_location := old.location_id;
    v_date := old.date;
  else
    v_location := new.location_id;
    v_date := new.date;
  end if;
  if v_location is not null and v_date is not null then
    perform enqueue_rebuild(v_location, v_date);
  end if;
  return coalesce(new, old);
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['production','shrinkage','outbound','outbound_line','transfer','correction','opname','opname_line'] loop
    execute format('drop trigger if exists %I_enqueue on %I', t, t);
    execute format(
      'create trigger %I_enqueue after insert or update or delete on %I for each row execute function txn_enqueue_rebuild()',
      t, t
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Konsistensi & index tambahan
-- ---------------------------------------------------------------------------
create index if not exists production_house_date_idx on production (house_id, date) where deleted_at is null;
create index if not exists outbound_status_idx on outbound (status) where deleted_at is null;
create index if not exists transfer_status_idx on transfer (status) where deleted_at is null;
create index if not exists correction_status_idx on correction (status) where deleted_at is null;
create index if not exists opname_date_idx on opname (date) where deleted_at is null;

-- Harga per kg DO tidak boleh negatif; kg baris DO tidak boleh negatif.
alter table outbound_line drop constraint if exists outbound_line_price_check;
alter table outbound_line add constraint outbound_line_price_check check (price_per_kg is null or price_per_kg >= 0);
alter table outbound_line drop constraint if exists outbound_line_kg_check;
alter table outbound_line add constraint outbound_line_kg_check check (kg_doc >= 0 and (kg_delivered is null or kg_delivered >= 0));

-- Mutasi terkirim harus punya tanggal terima bila status received (R-2).
alter table transfer drop constraint if exists transfer_received_check;
alter table transfer add constraint transfer_received_check check (
  (status = 'in_transit' and received_date is null)
  or (status = 'received' and received_date is not null and received_date >= sent_date)
);

-- Outbound dikirim harus punya delivered_at.
alter table outbound drop constraint if exists outbound_delivered_check;
alter table outbound add constraint outbound_delivered_check check (
  status = 'draft' or delivered_at is not null
);
