-- =====================================================================
-- Jadwal Pengiriman — skema database (Supabase / Postgres)
-- Cara pakai: Supabase Dashboard > SQL Editor > tempel seluruh isi > Run
-- Jalankan SATU KALI pada proyek Supabase baru.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. JENIS DATA
-- ---------------------------------------------------------------------
create type public.user_role       as enum ('admin', 'purchasing', 'qc', 'vendor');
create type public.po_status       as enum ('open', 'closed');
create type public.truck_status    as enum ('planned', 'received', 'cancelled');
create type public.proposal_status as enum ('pending', 'approved', 'rejected');

-- ---------------------------------------------------------------------
-- 2. TABEL
--    Semua berat disimpan dalam kg.
-- ---------------------------------------------------------------------

-- Data induk vendor
create table public.vendors (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique check (btrim(name) <> ''),
  created_at timestamptz not null default now()
);

-- Data induk produk. tolerance_pct = batas selisih berat (persen) sebelum ditandai merah.
create table public.products (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique check (btrim(name) <> ''),
  tolerance_pct numeric(5,2) not null default 0.5 check (tolerance_pct >= 0 and tolerance_pct <= 100),
  created_at    timestamptz not null default now()
);

-- Profil pengguna: peran dan (untuk vendor) perusahaan vendornya.
create table public.profiles (
  id               uuid primary key references auth.users (id) on delete cascade,
  full_name        text not null check (btrim(full_name) <> ''),
  email            text not null,
  role             public.user_role not null,
  vendor_id        uuid references public.vendors (id),
  active           boolean not null default true,
  activity_seen_at timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  -- Akun vendor wajib terhubung ke satu vendor; akun internal tidak boleh.
  constraint profiles_vendor_link check ((role = 'vendor') = (vendor_id is not null))
);
create index profiles_vendor_idx on public.profiles (vendor_id);

-- PO: satu PO = satu vendor + satu produk
create table public.purchase_orders (
  id         uuid primary key default gen_random_uuid(),
  po_number  text not null unique check (btrim(po_number) <> ''),
  vendor_id  uuid not null references public.vendors (id),
  product_id uuid not null references public.products (id),
  volume_kg  numeric(14,2) not null check (volume_kg > 0),
  status     public.po_status not null default 'open',
  note       text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  closed_at  timestamptz,
  closed_by  uuid references public.profiles (id)
);
create index purchase_orders_vendor_idx on public.purchase_orders (vendor_id);
create index purchase_orders_status_idx on public.purchase_orders (status, created_at desc);

-- Jadwal: satu PO dipecah menjadi beberapa jadwal (ETA + volume).
-- eta_original = permintaan awal, tidak berubah setelah ada truk.
-- eta_current  = tanggal yang berlaku sekarang (berubah bila ada revisi).
create table public.schedules (
  id           uuid primary key default gen_random_uuid(),
  po_id        uuid not null references public.purchase_orders (id) on delete cascade,
  eta_original date not null,
  eta_current  date not null,
  volume_kg    numeric(14,2) not null check (volume_kg > 0),
  created_by   uuid references public.profiles (id),
  created_at   timestamptz not null default now()
);
create index schedules_po_idx on public.schedules (po_id, eta_current);

-- Usulan tanggal baru dari vendor
create table public.schedule_proposals (
  id            uuid primary key default gen_random_uuid(),
  schedule_id   uuid not null references public.schedules (id) on delete cascade,
  proposed_eta  date not null,
  reason        text not null check (btrim(reason) <> ''),
  status        public.proposal_status not null default 'pending',
  proposed_by   uuid references public.profiles (id),
  created_at    timestamptz not null default now(),
  decided_by    uuid references public.profiles (id),
  decided_at    timestamptz,
  decision_note text
);
create index schedule_proposals_schedule_idx on public.schedule_proposals (schedule_id);
-- Satu jadwal hanya boleh punya satu usulan yang masih menunggu.
create unique index schedule_proposals_one_pending
  on public.schedule_proposals (schedule_id) where status = 'pending';

-- Truk: didaftarkan vendor (atau QC bila truk datang tanpa didaftarkan).
create table public.trucks (
  id               uuid primary key default gen_random_uuid(),
  schedule_id      uuid not null references public.schedules (id) on delete restrict,
  po_id            uuid not null references public.purchase_orders (id) on delete restrict,
  plate_number     text not null check (btrim(plate_number) <> ''),
  vendor_net_kg    numeric(12,2) not null check (vendor_net_kg > 0),  -- netto timbangan vendor
  departure_at     timestamptz not null,                              -- jadwal keberangkatan
  status           public.truck_status not null default 'planned',
  registered_by_qc boolean not null default false,                    -- true = tidak didaftarkan vendor
  cancel_reason    text,
  created_by       uuid references public.profiles (id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint trucks_cancel_reason check (status <> 'cancelled' or btrim(coalesce(cancel_reason, '')) <> '')
);
create index trucks_schedule_idx on public.trucks (schedule_id);
create index trucks_po_idx       on public.trucks (po_id);
create index trucks_status_idx   on public.trucks (status, departure_at);

-- Penerimaan di pabrik: satu baris per truk, diisi QC.
--   netto pabrik  = hasil timbangan pabrik
--   berat ditolak = bagian dari netto pabrik yang ditolak
--   berat diterima = netto pabrik - berat ditolak
--   selisih       = netto vendor - netto pabrik (dihitung di aplikasi)
create table public.receipts (
  truck_id             uuid primary key references public.trucks (id) on delete cascade,
  arrived_at           date not null,
  factory_net_kg       numeric(12,2) not null check (factory_net_kg > 0),
  rejected_kg          numeric(12,2) not null default 0 check (rejected_kg >= 0),
  reject_reason        text,
  reject_note          text,
  delivery_note_number text,
  photos               text[] not null default '{}',
  received_by          uuid references public.profiles (id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint receipts_rejected_max check (rejected_kg <= factory_net_kg),
  constraint receipts_reason_needed check (rejected_kg = 0 or btrim(coalesce(reject_reason, '')) <> '')
);
create index receipts_arrived_idx on public.receipts (arrived_at desc);

-- Aktivitas: bahan penanda "perlu dilihat" di dashboard (pengganti notifikasi).
create table public.activity (
  id             bigint generated always as identity primary key,
  created_at     timestamptz not null default now(),
  kind           text not null,
  po_id          uuid not null references public.purchase_orders (id) on delete cascade,
  vendor_id      uuid not null,
  data           jsonb not null default '{}',
  for_vendor     boolean not null default false,
  for_purchasing boolean not null default false,
  for_qc         boolean not null default false,
  actor          uuid
);
create index activity_created_idx on public.activity (created_at desc);
create index activity_vendor_idx  on public.activity (vendor_id, created_at desc);

-- Riwayat perubahan: siapa mengubah apa dan kapan.
create table public.audit_log (
  id         bigint generated always as identity primary key,
  changed_at timestamptz not null default now(),
  changed_by uuid,
  table_name text not null,
  row_id     text not null,
  po_id      uuid,
  action     text not null,
  old_data   jsonb,
  new_data   jsonb
);
create index audit_log_po_idx on public.audit_log (po_id, changed_at desc);

-- ---------------------------------------------------------------------
-- 3. FUNGSI BANTU HAK AKSES
-- ---------------------------------------------------------------------

-- Peran pengguna yang sedang login (null bila tidak punya profil atau nonaktif)
create function public.my_role()
returns public.user_role
language sql stable security definer set search_path = ''
as $$
  select role from public.profiles where id = (select auth.uid()) and active;
$$;

create function public.my_vendor_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select vendor_id from public.profiles where id = (select auth.uid()) and active;
$$;

create function public.is_internal()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(public.my_role() in ('admin', 'purchasing', 'qc'), false);
$$;

create function public.is_buyer()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(public.my_role() in ('admin', 'purchasing'), false);
$$;

-- Inti pembatasan vendor: orang internal melihat semua PO,
-- vendor hanya PO yang vendor_id-nya sama dengan vendornya sendiri.
create function public.can_see_po(p_po_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_internal() or exists (
    select 1 from public.purchase_orders
    where id = p_po_id and vendor_id = public.my_vendor_id()
  );
$$;

create function public.can_see_schedule(p_schedule_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_internal() or exists (
    select 1 from public.schedules s
    join public.purchase_orders p on p.id = s.po_id
    where s.id = p_schedule_id and p.vendor_id = public.my_vendor_id()
  );
$$;

create function public.can_see_truck(p_truck_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_internal() or exists (
    select 1 from public.trucks t
    join public.purchase_orders p on p.id = t.po_id
    where t.id = p_truck_id and p.vendor_id = public.my_vendor_id()
  );
$$;

-- Foto disimpan dengan nama "<id PO>/<id truk>/<nama file>".
create function public.can_see_photo(p_object_name text)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_first text := split_part(p_object_name, '/', 1);
begin
  if v_first !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return public.can_see_po(v_first::uuid);
end;
$$;

-- ---------------------------------------------------------------------
-- 4. FUNGSI PENCATAT (aktivitas dan riwayat)
-- ---------------------------------------------------------------------
create function public.log_activity(
  p_kind text, p_po_id uuid, p_data jsonb,
  p_vendor boolean, p_purchasing boolean, p_qc boolean
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_vendor uuid;
  v_number text;
begin
  select vendor_id, po_number into v_vendor, v_number
  from public.purchase_orders where id = p_po_id;
  if v_vendor is null then
    return;  -- PO sedang dihapus
  end if;
  insert into public.activity (kind, po_id, vendor_id, data, for_vendor, for_purchasing, for_qc, actor)
  values (p_kind, p_po_id, v_vendor, p_data || jsonb_build_object('po_number', v_number),
          p_vendor, p_purchasing, p_qc, (select auth.uid()));
end;
$$;

create function public.audit_row()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_row jsonb;
  v_po  uuid;
begin
  if tg_op <> 'INSERT' then v_old := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then v_new := to_jsonb(new); end if;
  v_row := coalesce(v_new, v_old);

  if tg_table_name = 'purchase_orders' then
    v_po := (v_row ->> 'id')::uuid;
  elsif tg_table_name in ('schedules', 'trucks') then
    v_po := (v_row ->> 'po_id')::uuid;
  elsif tg_table_name = 'schedule_proposals' then
    select po_id into v_po from public.schedules where id = (v_row ->> 'schedule_id')::uuid;
  elsif tg_table_name = 'receipts' then
    select po_id into v_po from public.trucks where id = (v_row ->> 'truck_id')::uuid;
  end if;

  insert into public.audit_log (changed_by, table_name, row_id, po_id, action, old_data, new_data)
  values ((select auth.uid()), tg_table_name, coalesce(v_row ->> 'id', v_row ->> 'truck_id'),
          v_po, tg_op, v_old, v_new);
  return null;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. ATURAN PO
-- ---------------------------------------------------------------------
create function public.po_before_write()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.po_number := btrim(new.po_number);
  if tg_op = 'INSERT' then
    new.created_by := (select auth.uid());
    new.status := 'open';
    new.closed_at := null;
    new.closed_by := null;
    return new;
  end if;

  new.created_by := old.created_by;
  new.created_at := old.created_at;

  -- Vendor atau produk tidak boleh diganti setelah ada truk:
  -- mengganti vendor akan memperlihatkan data truk ke vendor lain.
  if (new.vendor_id <> old.vendor_id or new.product_id <> old.product_id)
     and exists (select 1 from public.trucks where po_id = old.id) then
    raise exception 'Vendor dan produk tidak bisa diganti karena PO ini sudah punya truk';
  end if;

  if new.status = 'closed' and old.status = 'open' then
    new.closed_at := now();
    new.closed_by := (select auth.uid());
  elsif new.status = 'open' and old.status = 'closed' then
    new.closed_at := null;
    new.closed_by := null;
  else
    new.closed_at := old.closed_at;
    new.closed_by := old.closed_by;
  end if;
  return new;
end;
$$;

create function public.po_after_update()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.status <> old.status then
    perform public.log_activity(
      case when new.status = 'closed' then 'po_closed' else 'po_reopened' end,
      new.id, '{}'::jsonb, true, false, true);
  end if;
  return null;
end;
$$;

create trigger po_before_write before insert or update on public.purchase_orders
  for each row execute function public.po_before_write();
create trigger po_after_update after update on public.purchase_orders
  for each row execute function public.po_after_update();

-- ---------------------------------------------------------------------
-- 6. ATURAN JADWAL
-- ---------------------------------------------------------------------
create function public.schedule_before_write()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if (select status from public.purchase_orders where id = new.po_id) = 'closed' then
      raise exception 'PO sudah ditutup. Buka kembali PO untuk menambah jadwal';
    end if;
    new.eta_current := new.eta_original;
    new.created_by := (select auth.uid());
    return new;
  end if;

  new.po_id := old.po_id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  -- ETA awal adalah dasar penilaian ketepatan waktu, jadi dikunci setelah ada truk.
  if new.eta_original <> old.eta_original
     and exists (select 1 from public.trucks where schedule_id = old.id) then
    raise exception 'ETA awal tidak bisa diubah karena jadwal ini sudah punya truk. Ubah ETA revisi saja';
  end if;
  return new;
end;
$$;

create function public.schedule_after_write()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_activity('schedule_new', new.po_id,
      jsonb_build_object('eta', new.eta_current, 'volume_kg', new.volume_kg), true, false, false);
  elsif tg_op = 'UPDATE' then
    -- pg_trigger_depth() > 1 berarti perubahan datang dari persetujuan usulan,
    -- yang sudah punya catatan aktivitasnya sendiri.
    if pg_trigger_depth() = 1
       and (new.eta_current <> old.eta_current or new.volume_kg <> old.volume_kg) then
      perform public.log_activity('schedule_changed', new.po_id,
        jsonb_build_object('eta', new.eta_current, 'old_eta', old.eta_current,
                           'volume_kg', new.volume_kg, 'old_volume_kg', old.volume_kg),
        true, false, false);
    end if;
  else
    perform public.log_activity('schedule_deleted', old.po_id,
      jsonb_build_object('eta', old.eta_current, 'volume_kg', old.volume_kg), true, false, false);
  end if;
  return null;
end;
$$;

create trigger schedule_before_write before insert or update on public.schedules
  for each row execute function public.schedule_before_write();
create trigger schedule_after_write after insert or update or delete on public.schedules
  for each row execute function public.schedule_after_write();

-- ---------------------------------------------------------------------
-- 7. ATURAN USULAN TANGGAL
-- ---------------------------------------------------------------------
create function public.proposal_before_write()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_eta    date;
  v_status public.po_status;
begin
  if tg_op = 'INSERT' then
    select s.eta_current, p.status into v_eta, v_status
    from public.schedules s join public.purchase_orders p on p.id = s.po_id
    where s.id = new.schedule_id;
    if v_status = 'closed' then
      raise exception 'PO sudah ditutup';
    end if;
    if new.proposed_eta = v_eta then
      raise exception 'Tanggal usulan sama dengan ETA yang berlaku';
    end if;
    new.status := 'pending';
    new.proposed_by := (select auth.uid());
    new.decided_by := null;
    new.decided_at := null;
    new.decision_note := null;
    return new;
  end if;

  if old.status <> 'pending' then
    raise exception 'Usulan ini sudah diputuskan';
  end if;
  new.schedule_id := old.schedule_id;
  new.proposed_eta := old.proposed_eta;
  new.reason := old.reason;
  new.proposed_by := old.proposed_by;
  new.created_at := old.created_at;
  if new.status <> 'pending' then
    new.decided_by := (select auth.uid());
    new.decided_at := now();
  end if;
  return new;
end;
$$;

create function public.proposal_after_write()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_po  uuid;
  v_eta date;
begin
  select po_id, eta_current into v_po, v_eta from public.schedules where id = new.schedule_id;
  if tg_op = 'INSERT' then
    perform public.log_activity('proposal_new', v_po,
      jsonb_build_object('eta', v_eta, 'proposed_eta', new.proposed_eta, 'reason', new.reason),
      false, true, false);
  elsif new.status <> old.status then
    if new.status = 'approved' then
      update public.schedules set eta_current = new.proposed_eta where id = new.schedule_id;
    end if;
    perform public.log_activity('proposal_decided', v_po,
      jsonb_build_object('status', new.status, 'proposed_eta', new.proposed_eta,
                         'note', new.decision_note),
      true, false, false);
  end if;
  return null;
end;
$$;

create trigger proposal_before_write before insert or update on public.schedule_proposals
  for each row execute function public.proposal_before_write();
create trigger proposal_after_write after insert or update on public.schedule_proposals
  for each row execute function public.proposal_after_write();

-- ---------------------------------------------------------------------
-- 8. ATURAN TRUK
-- ---------------------------------------------------------------------
create function public.truck_before_write()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_role   public.user_role := public.my_role();
  v_po     uuid;
  v_status public.po_status;
begin
  new.plate_number := upper(regexp_replace(btrim(new.plate_number), '\s+', ' ', 'g'));

  if tg_op = 'INSERT' then
    select s.po_id, p.status into v_po, v_status
    from public.schedules s join public.purchase_orders p on p.id = s.po_id
    where s.id = new.schedule_id;
    if v_po is null then
      raise exception 'Jadwal tidak ditemukan';
    end if;
    if v_status = 'closed' then
      raise exception 'PO sudah ditutup, truk baru tidak bisa didaftarkan';
    end if;
    new.po_id := v_po;
    new.status := 'planned';
    new.cancel_reason := null;
    new.created_by := (select auth.uid());
    -- Truk yang dicatat orang internal berarti vendor tidak mendaftarkannya.
    new.registered_by_qc := coalesce(v_role <> 'vendor', false);
    return new;
  end if;

  new.po_id := old.po_id;
  new.registered_by_qc := old.registered_by_qc;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.updated_at := now();

  -- Perubahan status dari pencatatan penerimaan QC (lihat receipt_after_write).
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  if old.status = 'received' then
    if new.status <> 'received' then
      raise exception 'Truk sudah diterima. Hapus penerimaannya dulu bila ingin mengubah status';
    end if;
    if v_role is distinct from 'admin' then
      raise exception 'Truk sudah diterima QC, datanya terkunci';
    end if;
  elsif new.status = 'received' then
    raise exception 'Status diterima hanya bisa lewat pencatatan penerimaan QC';
  end if;

  if v_role = 'vendor' and old.status <> 'planned' then
    raise exception 'Data truk ini sudah terkunci';
  end if;

  if new.schedule_id <> old.schedule_id and not exists (
    select 1 from public.schedules where id = new.schedule_id and po_id = old.po_id
  ) then
    raise exception 'Truk hanya bisa dipindah ke jadwal lain dalam PO yang sama';
  end if;

  if new.status = 'planned' then
    new.cancel_reason := null;
  end if;
  return new;
end;
$$;

create function public.truck_after_write()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.registered_by_qc then
      perform public.log_activity('truck_unregistered', new.po_id,
        jsonb_build_object('plate', new.plate_number, 'vendor_net_kg', new.vendor_net_kg),
        true, true, false);
    else
      perform public.log_activity('truck_registered', new.po_id,
        jsonb_build_object('plate', new.plate_number, 'vendor_net_kg', new.vendor_net_kg,
                           'departure_at', new.departure_at),
        false, true, true);
    end if;
  elsif pg_trigger_depth() = 1 then
    if new.status = 'cancelled' and old.status <> 'cancelled' then
      perform public.log_activity('truck_cancelled', new.po_id,
        jsonb_build_object('plate', new.plate_number, 'reason', new.cancel_reason),
        true, true, true);
    elsif new.plate_number <> old.plate_number or new.vendor_net_kg <> old.vendor_net_kg
       or new.departure_at <> old.departure_at or new.schedule_id <> old.schedule_id
       or new.status <> old.status then
      perform public.log_activity('truck_changed', new.po_id,
        jsonb_build_object('plate', new.plate_number, 'vendor_net_kg', new.vendor_net_kg,
                           'departure_at', new.departure_at),
        false, true, true);
    end if;
  end if;
  return null;
end;
$$;

create trigger truck_before_write before insert or update on public.trucks
  for each row execute function public.truck_before_write();
create trigger truck_after_write after insert or update on public.trucks
  for each row execute function public.truck_after_write();

-- ---------------------------------------------------------------------
-- 9. ATURAN PENERIMAAN
-- ---------------------------------------------------------------------
create function public.receipt_before_write()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_status public.truck_status;
begin
  if tg_op = 'INSERT' then
    select status into v_status from public.trucks where id = new.truck_id for update;
    if v_status is null then
      raise exception 'Truk tidak ditemukan';
    end if;
    if v_status <> 'planned' then
      raise exception 'Truk ini sudah diterima atau dibatalkan';
    end if;
    new.received_by := (select auth.uid());
    return new;
  end if;
  new.truck_id := old.truck_id;
  new.received_by := old.received_by;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;

create function public.receipt_after_write()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_row       public.receipts;
  v_po        uuid;
  v_plate     text;
  v_vendor_kg numeric;
  v_tolerance numeric;
  v_diff_pct  numeric;
begin
  if tg_op = 'DELETE' then
    update public.trucks set status = 'planned' where id = old.truck_id;
    return null;
  end if;

  v_row := new;
  if tg_op = 'INSERT' then
    update public.trucks set status = 'received' where id = new.truck_id;
  end if;

  select t.po_id, t.plate_number, t.vendor_net_kg, pr.tolerance_pct
    into v_po, v_plate, v_vendor_kg, v_tolerance
  from public.trucks t
  join public.purchase_orders p on p.id = t.po_id
  join public.products pr on pr.id = p.product_id
  where t.id = v_row.truck_id;

  v_diff_pct := round((v_vendor_kg - v_row.factory_net_kg) / v_vendor_kg * 100, 2);

  perform public.log_activity(
    case when tg_op = 'INSERT' then 'receipt' else 'receipt_changed' end,
    v_po,
    jsonb_build_object(
      'plate', v_plate,
      'factory_net_kg', v_row.factory_net_kg,
      'rejected_kg', v_row.rejected_kg,
      'reason', v_row.reject_reason,
      'diff_pct', v_diff_pct,
      'flagged', abs(v_diff_pct) > v_tolerance),
    true, true, false);
  return null;
end;
$$;

create trigger receipt_before_write before insert or update on public.receipts
  for each row execute function public.receipt_before_write();
create trigger receipt_after_write after insert or update or delete on public.receipts
  for each row execute function public.receipt_after_write();

-- ---------------------------------------------------------------------
-- 10. RIWAYAT PERUBAHAN
-- ---------------------------------------------------------------------
create trigger audit_purchase_orders after insert or update or delete on public.purchase_orders
  for each row execute function public.audit_row();
create trigger audit_schedules after insert or update or delete on public.schedules
  for each row execute function public.audit_row();
create trigger audit_schedule_proposals after insert or update or delete on public.schedule_proposals
  for each row execute function public.audit_row();
create trigger audit_trucks after insert or update or delete on public.trucks
  for each row execute function public.audit_row();
create trigger audit_receipts after insert or update or delete on public.receipts
  for each row execute function public.audit_row();

-- ---------------------------------------------------------------------
-- 11. HAK AKSES (GRANT)
--     Cabut semua dulu, lalu beri hanya yang diperlukan.
--     anon          = belum login: tidak bisa apa-apa
--     authenticated = sudah login: dibatasi lagi oleh RLS di bagian 12
--     service_role  = server website (untuk membuat akun)
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

grant select on public.vendors, public.products, public.profiles, public.purchase_orders,
                public.schedules, public.schedule_proposals, public.trucks, public.receipts,
                public.activity, public.audit_log
  to authenticated;

grant insert (name), update (name), delete on public.vendors to authenticated;
grant insert (name, tolerance_pct), update (name, tolerance_pct), delete on public.products to authenticated;
grant update (activity_seen_at) on public.profiles to authenticated;

grant insert (id, po_number, vendor_id, product_id, volume_kg, note),
      update (po_number, vendor_id, product_id, volume_kg, note, status),
      delete
  on public.purchase_orders to authenticated;

grant insert (id, po_id, eta_original, volume_kg),
      update (eta_original, eta_current, volume_kg),
      delete
  on public.schedules to authenticated;

grant insert (id, schedule_id, proposed_eta, reason),
      update (status, decision_note),
      delete
  on public.schedule_proposals to authenticated;

grant insert (id, schedule_id, plate_number, vendor_net_kg, departure_at),
      update (schedule_id, plate_number, vendor_net_kg, departure_at, status, cancel_reason)
  on public.trucks to authenticated;

grant insert (truck_id, arrived_at, factory_net_kg, rejected_kg, reject_reason, reject_note,
              delivery_note_number, photos),
      update (arrived_at, factory_net_kg, rejected_kg, reject_reason, reject_note,
              delivery_note_number, photos),
      delete
  on public.receipts to authenticated;

grant all on all tables in schema public to service_role;

grant execute on function public.my_role(), public.my_vendor_id(), public.is_internal(),
                          public.is_buyer(), public.can_see_po(uuid), public.can_see_schedule(uuid),
                          public.can_see_truck(uuid), public.can_see_photo(text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 12. ROW LEVEL SECURITY
--     Semua pembatasan "vendor hanya melihat miliknya" ada di sini,
--     di dalam database, bukan hanya di tampilan website.
-- ---------------------------------------------------------------------
alter table public.vendors            enable row level security;
alter table public.products           enable row level security;
alter table public.profiles           enable row level security;
alter table public.purchase_orders    enable row level security;
alter table public.schedules          enable row level security;
alter table public.schedule_proposals enable row level security;
alter table public.trucks             enable row level security;
alter table public.receipts           enable row level security;
alter table public.activity           enable row level security;
alter table public.audit_log          enable row level security;

-- Vendor (data induk)
create policy "vendors: lihat" on public.vendors for select to authenticated
  using ((select public.is_internal()) or id = (select public.my_vendor_id()));
create policy "vendors: tambah" on public.vendors for insert to authenticated
  with check ((select public.is_buyer()));
create policy "vendors: ubah" on public.vendors for update to authenticated
  using ((select public.is_buyer())) with check ((select public.is_buyer()));
create policy "vendors: hapus" on public.vendors for delete to authenticated
  using ((select public.is_buyer()));

-- Produk: vendor hanya melihat produk yang ada di PO miliknya
create policy "products: lihat" on public.products for select to authenticated
  using (
    (select public.is_internal())
    or exists (
      select 1 from public.purchase_orders p
      where p.product_id = products.id and p.vendor_id = (select public.my_vendor_id())
    )
  );
create policy "products: tambah" on public.products for insert to authenticated
  with check ((select public.is_buyer()));
create policy "products: ubah" on public.products for update to authenticated
  using ((select public.is_buyer())) with check ((select public.is_buyer()));
create policy "products: hapus" on public.products for delete to authenticated
  using ((select public.is_buyer()));

-- Profil: tiap orang melihat profilnya sendiri; orang internal melihat semua
create policy "profiles: lihat" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_internal()));
create policy "profiles: tandai aktivitas dibaca" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- PO
create policy "po: lihat" on public.purchase_orders for select to authenticated
  using (
    (select public.is_internal()) or vendor_id = (select public.my_vendor_id())
  );
create policy "po: tambah" on public.purchase_orders for insert to authenticated
  with check ((select public.is_buyer()));
create policy "po: ubah" on public.purchase_orders for update to authenticated
  using ((select public.is_buyer())) with check ((select public.is_buyer()));
create policy "po: hapus" on public.purchase_orders for delete to authenticated
  using ((select public.is_buyer()));

-- Jadwal
create policy "jadwal: lihat" on public.schedules for select to authenticated
  using (public.can_see_po(po_id));
create policy "jadwal: tambah" on public.schedules for insert to authenticated
  with check ((select public.is_buyer()));
create policy "jadwal: ubah" on public.schedules for update to authenticated
  using ((select public.is_buyer())) with check ((select public.is_buyer()));
create policy "jadwal: hapus" on public.schedules for delete to authenticated
  using ((select public.is_buyer()));

-- Usulan tanggal: vendor mengusulkan untuk jadwal miliknya, purchasing memutuskan
create policy "usulan: lihat" on public.schedule_proposals for select to authenticated
  using (public.can_see_schedule(schedule_id));
create policy "usulan: vendor mengusulkan" on public.schedule_proposals for insert to authenticated
  with check ((select public.my_role()) = 'vendor' and public.can_see_schedule(schedule_id));
create policy "usulan: purchasing memutuskan" on public.schedule_proposals for update to authenticated
  using ((select public.is_buyer())) with check ((select public.is_buyer()));
create policy "usulan: vendor menarik" on public.schedule_proposals for delete to authenticated
  using ((select public.my_role()) = 'vendor' and status = 'pending'
         and proposed_by = (select auth.uid()));

-- Truk: vendor mendaftarkan dan mengubah truk miliknya selama belum diterima;
-- QC mencatat truk tak terdaftar; purchasing boleh membatalkan atau memindahkan.
create policy "truk: lihat" on public.trucks for select to authenticated
  using (public.can_see_po(po_id));
create policy "truk: tambah" on public.trucks for insert to authenticated
  with check (
    ((select public.my_role()) = 'vendor' and public.can_see_schedule(schedule_id))
    or (select public.my_role()) in ('qc', 'admin')
  );
create policy "truk: ubah" on public.trucks for update to authenticated
  using (
    ((select public.my_role()) = 'vendor' and status = 'planned' and public.can_see_po(po_id))
    or (select public.is_internal())
  )
  with check (
    ((select public.my_role()) = 'vendor' and public.can_see_po(po_id))
    or (select public.is_internal())
  );

-- Penerimaan: hanya QC (dan admin) yang mengisi
create policy "penerimaan: lihat" on public.receipts for select to authenticated
  using (public.can_see_truck(truck_id));
create policy "penerimaan: tambah" on public.receipts for insert to authenticated
  with check ((select public.my_role()) in ('qc', 'admin'));
create policy "penerimaan: ubah" on public.receipts for update to authenticated
  using ((select public.my_role()) in ('qc', 'admin'))
  with check ((select public.my_role()) in ('qc', 'admin'));
create policy "penerimaan: hapus" on public.receipts for delete to authenticated
  using ((select public.my_role()) = 'admin');

-- Aktivitas: tiap pihak hanya melihat yang ditujukan kepadanya
create policy "aktivitas: lihat" on public.activity for select to authenticated
  using (
    ((select public.my_role()) = 'vendor' and for_vendor and vendor_id = (select public.my_vendor_id()))
    or ((select public.is_buyer()) and for_purchasing)
    or ((select public.my_role()) = 'qc' and for_qc)
  );

-- Riwayat perubahan: hanya orang internal
create policy "riwayat: lihat" on public.audit_log for select to authenticated
  using ((select public.is_internal()));

-- =====================================================================
-- 13. MENDAFTARKAN ADMIN PERTAMA (jalankan nanti, SETELAH membuat akun
--     lewat Dashboard > Authentication > Users > Add user)
--     Ganti nama dan email di bawah, lalu hapus tanda "--".
-- =====================================================================
-- insert into public.profiles (id, full_name, email, role)
-- select id, 'GANTI_DENGAN_NAMA', email, 'admin'
-- from auth.users where email = 'GANTI_DENGAN_EMAIL_ADMIN';
