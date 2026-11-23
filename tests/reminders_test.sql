-- Uji pengingat H-3. Jalankan setelah local_stub.sql dan keempat migrasi:
--   psql -v ON_ERROR_STOP=1 -f tests/reminders_test.sql
\set ON_ERROR_STOP on
begin;
create function pg_temp.expect(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if p_ok is not true then raise exception 'FAIL: %', p_label; end if;
  raise notice 'ok: %', p_label;
end $$;
create function pg_temp.must_fail(p_sql text, p_label text) returns void language plpgsql as $$
begin
  begin execute p_sql; exception when others then raise notice 'ok (ditolak): %', p_label; return; end;
  raise exception 'FAIL: seharusnya ditolak: %', p_label;
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000b', 'buyer@test'),
  ('00000000-0000-0000-0000-0000000000a1', 'a@test'),
  ('00000000-0000-0000-0000-0000000000b1', 'b@test');
insert into public.vendors (id, name) values
  ('10000000-0000-0000-0000-00000000000a', 'Vendor A'),
  ('10000000-0000-0000-0000-00000000000b', 'Vendor B');
insert into public.products (id, name) values ('20000000-0000-0000-0000-000000000001', 'Jagung');
insert into public.profiles (id, full_name, email, role, vendor_id) values
  ('00000000-0000-0000-0000-00000000000b', 'Buyer', 'buyer@test', 'purchasing', null),
  ('00000000-0000-0000-0000-0000000000a1', 'A', 'a@test', 'vendor', '10000000-0000-0000-0000-00000000000a'),
  ('00000000-0000-0000-0000-0000000000b1', 'B', 'b@test', 'vendor', '10000000-0000-0000-0000-00000000000b');
-- Pembuat PO diisi trigger dari login yang aktif.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b"}', true);
insert into public.purchase_orders (id, po_number, vendor_id, product_id, volume_kg) values
  ('30000000-0000-0000-0000-00000000000a', 'PO-A', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-000000000001', 500000),
  ('30000000-0000-0000-0000-00000000000b', 'PO-B', '10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-000000000001', 500000),
  ('30000000-0000-0000-0000-0000000000c0', 'PO-TUTUP', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-000000000001', 500000);
select set_config('request.jwt.claims', '{}', true);
-- Hari ini dianggap 2026-12-10.
insert into public.schedules (id, po_id, eta_original, volume_kg) values
  ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-00000000000a', '2026-12-13', 50000), -- H-3, belum ada truk
  ('40000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-00000000000a', '2026-12-11', 50000), -- H-1, sebagian
  ('40000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-00000000000a', '2026-12-12', 50000), -- truk lengkap
  ('40000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-00000000000a', '2026-12-14', 50000), -- H-4, belum waktunya
  ('40000000-0000-0000-0000-000000000005', '30000000-0000-0000-0000-00000000000a', '2026-12-09', 50000), -- sudah lewat
  ('40000000-0000-0000-0000-000000000006', '30000000-0000-0000-0000-00000000000b', '2026-12-10', 30000), -- vendor B, hari ini, truk batal
  ('40000000-0000-0000-0000-000000000007', '30000000-0000-0000-0000-0000000000c0', '2026-12-12', 50000); -- PO ditutup
insert into public.trucks (schedule_id, plate_number, vendor_net_kg, departure_at, status, cancel_reason) values
  ('40000000-0000-0000-0000-000000000002', 'BE 1 A', 20000, now(), 'planned', null),
  ('40000000-0000-0000-0000-000000000003', 'BE 2 A', 25000, now(), 'planned', null),
  ('40000000-0000-0000-0000-000000000003', 'BE 3 A', 25000, now(), 'planned', null),
  ('40000000-0000-0000-0000-000000000006', 'BE 4 B', 30000, now(), 'planned', null);
update public.trucks set status = 'cancelled', cancel_reason = 'rusak' where plate_number = 'BE 4 B';
update public.purchase_orders set status = 'closed' where po_number = 'PO-TUTUP';

select pg_temp.expect(
  (select array_agg(schedule_id::text order by schedule_id) from public.due_reminders('2026-12-10'))
  = array['40000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000006'],
  'yang diingatkan: H-3 tanpa truk, H-1 sebagian, dan hari ini dengan truk batal');
select pg_temp.expect((select missing_kg = 30000 and registered_kg = 20000 from public.due_reminders('2026-12-10') where schedule_id = '40000000-0000-0000-0000-000000000002'), 'kekurangan dihitung dari truk yang tidak batal');
select pg_temp.expect((select missing_kg = 30000 from public.due_reminders('2026-12-10') where schedule_id = '40000000-0000-0000-0000-000000000006'), 'truk batal tidak dihitung');
select pg_temp.expect((select buyer_email = 'buyer@test' from public.due_reminders('2026-12-10') limit 1), 'email purchasing pembuat PO ikut untuk balasan');
select pg_temp.expect((select count(*) = 0 from public.due_reminders('2026-12-10') where schedule_id in ('40000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000004','40000000-0000-0000-0000-000000000005','40000000-0000-0000-0000-000000000007')), 'tidak diingatkan: truk lengkap, H-4, sudah lewat, PO ditutup');

insert into public.schedule_reminders (schedule_id, eta, status, recipients, missing_kg) values
  ('40000000-0000-0000-0000-000000000001', '2026-12-13', 'sent', '{a@test}', 50000),
  ('40000000-0000-0000-0000-000000000002', '2026-12-11', 'failed', '{a@test}', 30000);
select pg_temp.expect((select count(*) = 2 from public.due_reminders('2026-12-10')), 'yang sudah terkirim tidak diingatkan lagi; yang gagal dicoba lagi');
update public.schedules set eta_current = '2026-12-12' where id = '40000000-0000-0000-0000-000000000001';
select pg_temp.expect((select count(*) = 1 from public.due_reminders('2026-12-10') where schedule_id = '40000000-0000-0000-0000-000000000001'), 'ETA berubah: diingatkan lagi untuk tanggal baru');
select pg_temp.expect((select count(*) = 1 from public.due_reminders('2026-12-09') where schedule_id = '40000000-0000-0000-0000-000000000004') is false
  and (select count(*) = 1 from public.due_reminders('2026-12-11') where schedule_id = '40000000-0000-0000-0000-000000000004'), 'H-4 masuk daftar keesokan harinya (H-3)');

-- Hak akses
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1"}', true);
select pg_temp.must_fail($$select * from public.due_reminders('2026-12-10')$$, 'vendor tidak bisa memanggil daftar pengingat');
select pg_temp.expect((select count(*) = 2 from public.schedule_reminders), 'vendor A melihat catatan pengingat miliknya');
select pg_temp.must_fail($$insert into public.schedule_reminders (schedule_id, eta, status, missing_kg) values ('40000000-0000-0000-0000-000000000004', '2026-12-14', 'sent', 1)$$, 'vendor tidak bisa menulis catatan pengingat');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1"}', true);
select pg_temp.expect((select count(*) = 0 from public.schedule_reminders), 'vendor B tidak melihat catatan pengingat vendor A');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","aal":"aal2"}', true);
select pg_temp.expect((select count(*) = 2 from public.schedule_reminders), 'purchasing melihat semua catatan pengingat');
select pg_temp.must_fail($$select * from public.due_reminders('2026-12-10')$$, 'purchasing pun tidak memanggil fungsi langsung, hanya lewat server');
reset role;
rollback;
\echo 'SEMUA UJI PENGINGAT LULUS'
