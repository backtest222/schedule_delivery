-- =====================================================================
-- Jadwal Pengiriman — pengingat email H-3 untuk vendor
-- Jalankan SETELAH 001, 002, dan 003. Aman dijalankan ulang.
--
-- Aturan: setiap pagi, jadwal yang
--   - PO-nya masih buka,
--   - ETA berlakunya tinggal 0 sampai 3 hari lagi (tanggal WIB), dan
--   - volume truk yang sudah didaftarkan (tidak termasuk yang batal)
--     masih kurang dari volume jadwal,
-- dikirimi email pengingat ke semua akun vendor yang aktif.
-- Satu jadwal hanya diingatkan sekali untuk satu tanggal ETA. Bila ETA
-- berubah (misalnya usulan vendor disetujui), pengingat berlaku lagi
-- untuk tanggal yang baru.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. CATATAN PENGINGAT
--    status: sent = terkirim; failed = gagal dikirim (dicoba lagi besok);
--    no_recipient = vendor belum punya akun aktif (dicoba lagi besok).
-- ---------------------------------------------------------------------
create table if not exists public.schedule_reminders (
  id            bigint generated always as identity primary key,
  schedule_id   uuid not null references public.schedules (id) on delete cascade,
  eta           date not null,
  status        text not null check (status in ('sent', 'failed', 'no_recipient')),
  recipients    text[] not null default '{}',
  missing_kg    numeric(14,2) not null,
  error         text,
  attempts      integer not null default 1,
  first_try_at  timestamptz not null default now(),
  last_try_at   timestamptz not null default now(),
  unique (schedule_id, eta)
);
create index if not exists schedule_reminders_schedule_idx on public.schedule_reminders (schedule_id);

alter table public.schedule_reminders enable row level security;
revoke all on public.schedule_reminders from anon, authenticated;
grant select on public.schedule_reminders to authenticated;
grant all on public.schedule_reminders to service_role;

-- Orang internal melihat semua catatan; vendor hanya untuk jadwal miliknya.
drop policy if exists "pengingat: lihat" on public.schedule_reminders;
create policy "pengingat: lihat" on public.schedule_reminders for select to authenticated
  using (public.can_see_schedule(schedule_id));

-- ---------------------------------------------------------------------
-- 2. DAFTAR JADWAL YANG PERLU DIINGATKAN HARI INI
--    Dipanggil hanya oleh server (rute /api/cron/reminders).
-- ---------------------------------------------------------------------
create or replace function public.due_reminders(p_today date default null, p_days integer default 3)
returns table (
  schedule_id   uuid,
  po_id         uuid,
  po_number     text,
  vendor_id     uuid,
  vendor_name   text,
  product_name  text,
  eta           date,
  volume_kg     numeric,
  registered_kg numeric,
  missing_kg    numeric,
  buyer_email   text
)
language sql stable security definer set search_path = ''
as $$
  with today as (
    select coalesce(p_today, (now() at time zone 'Asia/Jakarta')::date) as d
  )
  select s.id, p.id, p.po_number, v.id, v.name, pr.name, s.eta_current, s.volume_kg,
         coalesce(t.kg, 0),
         s.volume_kg - coalesce(t.kg, 0),
         b.email
  from public.schedules s
  join public.purchase_orders p on p.id = s.po_id
  join public.vendors v on v.id = p.vendor_id
  join public.products pr on pr.id = p.product_id
  left join public.profiles b on b.id = p.created_by and b.active
  left join lateral (
    select sum(vendor_net_kg) as kg
    from public.trucks
    where schedule_id = s.id and status <> 'cancelled'
  ) t on true
  cross join today
  where p.status = 'open'
    and s.eta_current between today.d and today.d + p_days
    and s.volume_kg - coalesce(t.kg, 0) > 0
    and not exists (
      select 1 from public.schedule_reminders r
      where r.schedule_id = s.id and r.eta = s.eta_current and r.status = 'sent'
    )
  order by v.name, s.eta_current, p.po_number;
$$;

revoke execute on function public.due_reminders(date, integer) from public, anon, authenticated;
grant execute on function public.due_reminders(date, integer) to service_role;
