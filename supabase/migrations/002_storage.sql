-- =====================================================================
-- Jadwal Pengiriman — penyimpanan foto bukti penerimaan
-- Jalankan SETELAH 001_schema.sql, juga satu kali.
-- Foto disimpan privat dengan nama "<id PO>/<id truk>/<nama file>".
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipt-photos', 'receipt-photos', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Melihat foto: orang internal, atau vendor pemilik PO tersebut
create policy "foto: lihat" on storage.objects for select to authenticated
  using (bucket_id = 'receipt-photos' and public.can_see_photo(name));

-- Mengunggah dan menghapus foto: hanya QC dan admin
create policy "foto: unggah" on storage.objects for insert to authenticated
  with check (bucket_id = 'receipt-photos' and (select public.my_role()) in ('qc', 'admin'));

create policy "foto: hapus" on storage.objects for delete to authenticated
  using (bucket_id = 'receipt-photos' and (select public.my_role()) in ('qc', 'admin'));
