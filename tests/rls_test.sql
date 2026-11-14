-- Uji aturan akses. Jalankan di database uji yang sudah diisi
-- tests/local_stub.sql lalu ketiga file di supabase/migrations/ secara berurutan:
--   psql -v ON_ERROR_STOP=1 -f tests/rls_test.sql
-- Semua perubahan dibatalkan di akhir (rollback). Bila ada aturan yang bocor, skrip berhenti dengan "FAIL".
\set ON_ERROR_STOP on
begin;

-- ---------- Data awal (sebagai pemilik database) ----------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@test'),
  ('00000000-0000-0000-0000-00000000000b', 'buyer@test'),
  ('00000000-0000-0000-0000-00000000000c', 'qc@test'),
  ('00000000-0000-0000-0000-0000000000a1', 'vendor-a@test'),
  ('00000000-0000-0000-0000-0000000000b1', 'vendor-b@test'),
  ('00000000-0000-0000-0000-0000000000a2', 'vendor-a-nonaktif@test');

insert into public.vendors (id, name) values
  ('10000000-0000-0000-0000-00000000000a', 'Vendor A'),
  ('10000000-0000-0000-0000-00000000000b', 'Vendor B');
insert into public.products (id, name, tolerance_pct) values
  ('20000000-0000-0000-0000-000000000001', 'Jagung', 0.5),
  ('20000000-0000-0000-0000-000000000002', 'Bungkil kedelai', 0.5);

insert into public.profiles (id, full_name, email, role, vendor_id, active) values
  ('00000000-0000-0000-0000-00000000000a', 'Admin', 'admin@test', 'admin', null, true),
  ('00000000-0000-0000-0000-00000000000b', 'Buyer', 'buyer@test', 'purchasing', null, true),
  ('00000000-0000-0000-0000-00000000000c', 'QC', 'qc@test', 'qc', null, true),
  ('00000000-0000-0000-0000-0000000000a1', 'Staf A', 'vendor-a@test', 'vendor', '10000000-0000-0000-0000-00000000000a', true),
  ('00000000-0000-0000-0000-0000000000b1', 'Staf B', 'vendor-b@test', 'vendor', '10000000-0000-0000-0000-00000000000b', true),
  ('00000000-0000-0000-0000-0000000000a2', 'Staf A lama', 'vendor-a-nonaktif@test', 'vendor', '10000000-0000-0000-0000-00000000000a', false);

create function pg_temp.expect(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if p_ok is not true then raise exception 'FAIL: %', p_label; end if;
  raise notice 'ok: %', p_label;
end $$;

-- Menjalankan perintah yang HARUS ditolak database.
create function pg_temp.must_fail(p_sql text, p_label text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    raise notice 'ok (ditolak): % -- %', p_label, sqlerrm;
    return;
  end;
  raise exception 'FAIL: seharusnya ditolak: %', p_label;
end $$;

-- Menjalankan UPDATE/DELETE yang HARUS tidak mengenai baris apa pun (tersaring RLS).
create function pg_temp.must_touch(p_sql text, p_rows int, p_label text) returns void language plpgsql as $$
declare v int;
begin
  execute p_sql;
  get diagnostics v = row_count;
  if v <> p_rows then raise exception 'FAIL: % (baris terkena: %, harapan: %)', p_label, v, p_rows; end if;
  raise notice 'ok: %', p_label;
end $$;

-- ---------- Belum login ----------
set local role anon;
select pg_temp.must_fail('select 1 from public.purchase_orders', 'anon tidak bisa membaca PO');
select pg_temp.must_fail('select 1 from public.vendors', 'anon tidak bisa membaca vendor');
reset role;

-- ---------- Purchasing tanpa 2FA (password saja) ----------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","aal":"aal1"}', true);
select pg_temp.expect((select count(*) = 0 from public.vendors), 'purchasing tanpa 2FA tidak melihat vendor');
select pg_temp.expect((select count(*) = 1 from public.profiles), 'purchasing tanpa 2FA hanya melihat profilnya sendiri');
select pg_temp.must_fail($$insert into public.purchase_orders (po_number, vendor_id, product_id, volume_kg) values ('PO-NO2FA', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-000000000001', 1)$$, 'purchasing tanpa 2FA tidak bisa membuat PO');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a"}', true);
select pg_temp.expect((select count(*) = 0 from public.vendors), 'admin tanpa 2FA tidak melihat vendor');
reset role;

-- ---------- Purchasing ----------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","aal":"aal2"}', true);

insert into public.purchase_orders (id, po_number, vendor_id, product_id, volume_kg) values
  ('30000000-0000-0000-0000-00000000000a', 'PO-A-001', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-000000000001', 100000),
  ('30000000-0000-0000-0000-00000000000b', 'PO-B-001', '10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-000000000002', 50000);
insert into public.schedules (id, po_id, eta_original, volume_kg) values
  ('40000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-00000000000a', '2026-12-01', 60000),
  ('40000000-0000-0000-0000-0000000000a2', '30000000-0000-0000-0000-00000000000a', '2026-12-15', 40000),
  ('40000000-0000-0000-0000-00000000000b', '30000000-0000-0000-0000-00000000000b', '2026-12-05', 50000);
select pg_temp.expect((select eta_current = eta_original from public.schedules where id = '40000000-0000-0000-0000-00000000000a'), 'ETA berlaku awalnya sama dengan ETA awal');
select pg_temp.expect((select created_by = '00000000-0000-0000-0000-00000000000b' from public.purchase_orders where po_number = 'PO-A-001'), 'pembuat PO tercatat otomatis');
select pg_temp.must_fail($$insert into public.purchase_orders (po_number, vendor_id, product_id, volume_kg) values ('PO-A-001', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-000000000001', 1)$$, 'nomor PO tidak boleh ganda');
select pg_temp.must_fail($$insert into public.trucks (schedule_id, plate_number, vendor_net_kg, departure_at) values ('40000000-0000-0000-0000-00000000000a', 'BE 1 AA', 1000, now())$$, 'purchasing tidak mengisi data truk');
select pg_temp.must_fail($$insert into public.receipts (truck_id, arrived_at, factory_net_kg) values (gen_random_uuid(), current_date, 1000)$$, 'purchasing tidak mengisi penerimaan');

-- ---------- Vendor A ----------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1"}', true);
select pg_temp.expect((select count(*) = 1 from public.purchase_orders), 'vendor A hanya melihat 1 PO');
select pg_temp.expect((select count(*) = 0 from public.purchase_orders where po_number = 'PO-B-001'), 'vendor A tidak melihat PO vendor B');
select pg_temp.expect((select count(*) = 2 from public.schedules), 'vendor A hanya melihat jadwal PO miliknya');
select pg_temp.expect((select count(*) = 1 from public.vendors), 'vendor A hanya melihat data vendornya sendiri');
select pg_temp.expect((select count(*) = 1 from public.products), 'vendor A hanya melihat produk di PO miliknya');
select pg_temp.expect((select count(*) = 1 from public.profiles), 'vendor A hanya melihat profilnya sendiri');
select pg_temp.expect((select count(*) = 2 from public.activity), 'vendor A melihat aktivitas jadwal baru miliknya saja');
select pg_temp.expect((select count(*) = 0 from public.audit_log), 'vendor tidak melihat riwayat perubahan');
select pg_temp.must_fail($$insert into public.purchase_orders (po_number, vendor_id, product_id, volume_kg) values ('PO-X', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-000000000001', 1)$$, 'vendor tidak bisa membuat PO');
select pg_temp.must_fail($$insert into public.schedules (po_id, eta_original, volume_kg) values ('30000000-0000-0000-0000-00000000000a', '2027-01-01', 1)$$, 'vendor tidak bisa membuat jadwal');
select pg_temp.must_touch($$update public.schedules set volume_kg = 1 where id = '40000000-0000-0000-0000-00000000000a'$$, 0, 'vendor tidak bisa mengubah jadwal');
select pg_temp.must_touch($$update public.purchase_orders set status = 'closed'$$, 0, 'vendor tidak bisa menutup PO');

insert into public.trucks (id, schedule_id, plate_number, vendor_net_kg, departure_at) values
  ('50000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-00000000000a', ' be  1234  ab ', 25000, '2026-11-30 08:00+07'),
  ('50000000-0000-0000-0000-0000000000a2', '40000000-0000-0000-0000-00000000000a', 'BE 5678 CD', 26000, '2026-11-30 09:00+07'),
  ('50000000-0000-0000-0000-0000000000a3', '40000000-0000-0000-0000-00000000000a', 'BE 9999 ZZ', 24000, '2026-11-30 10:00+07');
select pg_temp.expect((select po_id = '30000000-0000-0000-0000-00000000000a' and not registered_by_qc and plate_number = 'BE 1234 AB' and status = 'planned' from public.trucks where id = '50000000-0000-0000-0000-0000000000a1'), 'truk vendor: PO terisi otomatis, nopol dirapikan, bukan tak terdaftar');
select pg_temp.must_fail($$insert into public.trucks (schedule_id, plate_number, vendor_net_kg, departure_at) values ('40000000-0000-0000-0000-00000000000b', 'BE 1 X', 1000, now())$$, 'vendor A tidak bisa mendaftarkan truk di jadwal vendor B');
select pg_temp.must_fail($$insert into public.trucks (schedule_id, po_id, plate_number, vendor_net_kg, departure_at) values ('40000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-00000000000b', 'BE 1 X', 1000, now())$$, 'vendor tidak bisa menentukan sendiri kolom PO');
select pg_temp.must_touch($$update public.trucks set plate_number = 'be 1234 ac', vendor_net_kg = 25500 where id = '50000000-0000-0000-0000-0000000000a1'$$, 1, 'vendor boleh mengoreksi truk yang belum diterima');
select pg_temp.must_fail($$update public.trucks set status = 'received' where id = '50000000-0000-0000-0000-0000000000a1'$$, 'vendor tidak bisa menandai truk diterima');
select pg_temp.must_fail($$update public.trucks set status = 'cancelled' where id = '50000000-0000-0000-0000-0000000000a3'$$, 'pembatalan wajib beralasan');
select pg_temp.must_touch($$update public.trucks set status = 'cancelled', cancel_reason = 'Truk rusak' where id = '50000000-0000-0000-0000-0000000000a3'$$, 1, 'vendor boleh membatalkan truknya');
select pg_temp.must_touch($$update public.trucks set status = 'planned' where id = '50000000-0000-0000-0000-0000000000a3'$$, 0, 'vendor tidak bisa menghidupkan lagi truk yang batal');
select pg_temp.must_fail($$update public.trucks set schedule_id = '40000000-0000-0000-0000-00000000000b' where id = '50000000-0000-0000-0000-0000000000a1'$$, 'truk tidak bisa dipindah ke PO lain');
select pg_temp.must_fail($$insert into public.receipts (truck_id, arrived_at, factory_net_kg) values ('50000000-0000-0000-0000-0000000000a1', current_date, 25000)$$, 'vendor tidak bisa mengisi penerimaan');

insert into public.schedule_proposals (id, schedule_id, proposed_eta, reason) values
  ('60000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-0000000000a2', '2026-12-20', 'Panen mundur');
select pg_temp.must_fail($$insert into public.schedule_proposals (schedule_id, proposed_eta, reason) values ('40000000-0000-0000-0000-0000000000a2', '2026-12-22', 'Lagi')$$, 'satu jadwal hanya satu usulan menunggu');
select pg_temp.must_fail($$insert into public.schedule_proposals (schedule_id, proposed_eta, reason) values ('40000000-0000-0000-0000-00000000000b', '2026-12-22', 'x')$$, 'vendor A tidak bisa mengusulkan untuk jadwal vendor B');
select pg_temp.must_touch($$update public.schedule_proposals set status = 'approved'$$, 0, 'vendor tidak bisa menyetujui usulannya sendiri');

-- ---------- Vendor B ----------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1"}', true);
select pg_temp.expect((select count(*) = 0 from public.trucks), 'vendor B tidak melihat truk vendor A');
select pg_temp.expect((select count(*) = 0 from public.schedule_proposals), 'vendor B tidak melihat usulan vendor A');
select pg_temp.expect((select count(*) = 1 from public.activity), 'vendor B hanya melihat aktivitas miliknya');
select pg_temp.must_touch($$update public.trucks set plate_number = 'X' where id = '50000000-0000-0000-0000-0000000000a1'$$, 0, 'vendor B tidak bisa mengubah truk vendor A');

-- ---------- Akun vendor yang dinonaktifkan ----------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2"}', true);
select pg_temp.expect((select count(*) = 0 from public.purchase_orders), 'akun nonaktif tidak melihat PO');
select pg_temp.expect((select count(*) = 0 from public.trucks), 'akun nonaktif tidak melihat truk');
select pg_temp.must_fail($$insert into public.trucks (schedule_id, plate_number, vendor_net_kg, departure_at) values ('40000000-0000-0000-0000-00000000000a', 'BE 1 X', 1000, now())$$, 'akun nonaktif tidak bisa mendaftarkan truk');

-- ---------- QC ----------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c"}', true);
select pg_temp.expect((select count(*) = 2 from public.purchase_orders), 'QC melihat semua PO');
select pg_temp.must_fail($$insert into public.purchase_orders (po_number, vendor_id, product_id, volume_kg) values ('PO-Q', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-000000000001', 1)$$, 'QC tidak bisa membuat PO');
select pg_temp.must_fail($$insert into public.receipts (truck_id, arrived_at, factory_net_kg, rejected_kg) values ('50000000-0000-0000-0000-0000000000a1', '2026-12-01', 25300, 500)$$, 'penolakan wajib beralasan');
select pg_temp.must_fail($$insert into public.receipts (truck_id, arrived_at, factory_net_kg, rejected_kg, reject_reason) values ('50000000-0000-0000-0000-0000000000a1', '2026-12-01', 25300, 99999, 'kualitas')$$, 'berat ditolak tidak boleh melebihi netto pabrik');
select pg_temp.must_fail($$insert into public.receipts (truck_id, arrived_at, factory_net_kg) values ('50000000-0000-0000-0000-0000000000a3', '2026-12-01', 24000)$$, 'truk batal tidak bisa diterima');

insert into public.receipts (truck_id, arrived_at, factory_net_kg, rejected_kg, reject_reason, delivery_note_number)
values ('50000000-0000-0000-0000-0000000000a1', '2026-12-01', 25300, 500, 'kadar_air', 'SJ-001');
select pg_temp.expect((select status = 'received' from public.trucks where id = '50000000-0000-0000-0000-0000000000a1'), 'penerimaan mengubah status truk menjadi diterima');
select pg_temp.must_fail($$insert into public.receipts (truck_id, arrived_at, factory_net_kg) values ('50000000-0000-0000-0000-0000000000a1', '2026-12-01', 25300)$$, 'satu truk hanya satu penerimaan');
select pg_temp.must_fail($$update public.trucks set plate_number = 'BE 1 QC' where id = '50000000-0000-0000-0000-0000000000a1'$$, 'QC tidak bisa mengubah data truk yang sudah diterima');
select pg_temp.must_touch($$update public.receipts set factory_net_kg = 25350 where truck_id = '50000000-0000-0000-0000-0000000000a1'$$, 1, 'QC boleh mengoreksi penerimaan');
select pg_temp.must_touch($$delete from public.receipts where truck_id = '50000000-0000-0000-0000-0000000000a1'$$, 0, 'QC tidak bisa menghapus penerimaan');

insert into public.trucks (id, schedule_id, plate_number, vendor_net_kg, departure_at) values
  ('50000000-0000-0000-0000-0000000000b9', '40000000-0000-0000-0000-00000000000b', 'B 9000 XY', 20000, now());
select pg_temp.expect((select registered_by_qc from public.trucks where id = '50000000-0000-0000-0000-0000000000b9'), 'truk yang dicatat QC ditandai tak terdaftar');

-- ---------- Vendor A setelah penerimaan ----------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1"}', true);
select pg_temp.must_touch($$update public.trucks set vendor_net_kg = 30000 where id = '50000000-0000-0000-0000-0000000000a1'$$, 0, 'vendor tidak bisa mengubah truk setelah QC mengisi');
select pg_temp.expect((select count(*) = 1 from public.receipts), 'vendor A melihat hasil penerimaan truknya');
select pg_temp.expect((select count(*) = 2 from public.activity where kind in ('receipt', 'receipt_changed')), 'vendor A mendapat aktivitas penerimaan');
select pg_temp.expect((select (data ->> 'flagged')::boolean from public.activity where kind = 'receipt_changed'), 'selisih 0,59% melewati batas 0,5% dan ditandai');

-- ---------- Vendor B ----------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1"}', true);
select pg_temp.expect((select count(*) = 0 from public.receipts), 'vendor B tidak melihat penerimaan vendor A');
select pg_temp.expect((select count(*) = 1 from public.activity where kind = 'truck_unregistered'), 'vendor B diberi tahu truknya datang tanpa didaftarkan');

-- ---------- Purchasing: usulan, penutupan, perubahan vendor ----------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","aal":"aal2"}', true);
select pg_temp.expect((select count(*) = 1 from public.activity where kind = 'proposal_new'), 'purchasing melihat usulan baru');
update public.schedule_proposals set status = 'approved', decision_note = 'Setuju' where id = '60000000-0000-0000-0000-00000000000a';
select pg_temp.expect((select eta_current = '2026-12-20' and eta_original = '2026-12-15' from public.schedules where id = '40000000-0000-0000-0000-0000000000a2'), 'persetujuan mengubah ETA revisi, ETA awal tetap');
select pg_temp.must_fail($$update public.schedule_proposals set status = 'rejected' where id = '60000000-0000-0000-0000-00000000000a'$$, 'usulan yang sudah diputuskan tidak bisa diubah');
select pg_temp.must_fail($$update public.schedules set eta_original = '2026-12-02' where id = '40000000-0000-0000-0000-00000000000a'$$, 'ETA awal terkunci setelah ada truk');
select pg_temp.must_touch($$update public.schedules set eta_original = '2026-12-16' where id = '40000000-0000-0000-0000-0000000000a2'$$, 1, 'ETA awal masih bisa dikoreksi selama belum ada truk');
select pg_temp.must_fail($$update public.purchase_orders set vendor_id = '10000000-0000-0000-0000-00000000000b' where id = '30000000-0000-0000-0000-00000000000a'$$, 'vendor PO tidak bisa diganti setelah ada truk');
select pg_temp.must_fail($$delete from public.purchase_orders where id = '30000000-0000-0000-0000-00000000000a'$$, 'PO yang sudah punya truk tidak bisa dihapus');
select pg_temp.must_touch($$update public.trucks set status = 'planned' where id = '50000000-0000-0000-0000-0000000000a3'$$, 1, 'purchasing boleh menghidupkan lagi truk yang batal');
update public.purchase_orders set status = 'closed' where id = '30000000-0000-0000-0000-00000000000a';
select pg_temp.expect((select closed_at is not null and closed_by = '00000000-0000-0000-0000-00000000000b' from public.purchase_orders where id = '30000000-0000-0000-0000-00000000000a'), 'penutupan PO mencatat waktu dan pelaku');
select pg_temp.expect((select count(*) > 10 from public.audit_log), 'riwayat perubahan terisi');
select pg_temp.expect((select count(*) = 1 from public.audit_log where table_name = 'receipts' and action = 'UPDATE' and changed_by = '00000000-0000-0000-0000-00000000000c'), 'koreksi QC tercatat di riwayat beserta pelakunya');

-- ---------- PO ditutup ----------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1"}', true);
select pg_temp.must_fail($$insert into public.trucks (schedule_id, plate_number, vendor_net_kg, departure_at) values ('40000000-0000-0000-0000-00000000000a', 'BE 1 X', 1000, now())$$, 'PO ditutup menolak truk baru');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c"}', true);
insert into public.receipts (truck_id, arrived_at, factory_net_kg) values ('50000000-0000-0000-0000-0000000000a2', '2026-12-02', 25950);
select pg_temp.expect((select status = 'received' from public.trucks where id = '50000000-0000-0000-0000-0000000000a2'), 'truk yang sudah terdaftar tetap bisa diterima setelah PO ditutup');

-- ---------- Admin ----------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","aal":"aal2"}', true);
select pg_temp.must_touch($$delete from public.receipts where truck_id = '50000000-0000-0000-0000-0000000000a2'$$, 1, 'admin boleh menghapus penerimaan');
select pg_temp.expect((select status = 'planned' from public.trucks where id = '50000000-0000-0000-0000-0000000000a2'), 'menghapus penerimaan mengembalikan status truk');


-- ---------- Foto dan cadangan ----------
reset role;
insert into storage.objects (bucket_id, name) values
  ('receipt-photos', '30000000-0000-0000-0000-00000000000a/50000000-0000-0000-0000-0000000000a1/1.jpg'),
  ('backups', 'backup-2026-12-01.json');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1"}', true);
select pg_temp.expect((select count(*) = 1 from storage.objects), 'vendor A melihat foto truknya, tidak melihat cadangan');
select pg_temp.must_fail($$insert into storage.objects (bucket_id, name) values ('receipt-photos', '30000000-0000-0000-0000-00000000000a/x/2.jpg')$$, 'vendor tidak bisa mengunggah foto');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1"}', true);
select pg_temp.expect((select count(*) = 0 from storage.objects), 'vendor B tidak melihat foto vendor A maupun cadangan');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c"}', true);
select pg_temp.expect((select count(*) = 1 from storage.objects), 'QC melihat foto tetapi tidak melihat cadangan');
insert into storage.objects (bucket_id, name) values ('receipt-photos', '30000000-0000-0000-0000-00000000000a/50000000-0000-0000-0000-0000000000a2/1.jpg');
select pg_temp.must_fail($$insert into storage.objects (bucket_id, name) values ('backups', 'x.json')$$, 'QC tidak bisa menulis ke tempat cadangan');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","aal":"aal2"}', true);
select pg_temp.expect((select count(*) = 0 from storage.objects where bucket_id = 'backups'), 'admin pun tidak membaca cadangan lewat browser, hanya server');

reset role;
rollback;
\echo 'SEMUA UJI AKSES LULUS'
