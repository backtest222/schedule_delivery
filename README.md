# Jadwal Pengiriman

Website untuk komunikasi jadwal dan realisasi pengiriman barang setelah PO, antara purchasing, vendor, dan QC.

**Mulai dari sini: [PANDUAN.md](PANDUAN.md)** (setup Supabase, admin pertama, Vercel, dan checklist uji).

## Alur

1. **Purchasing** membuat PO (satu vendor, satu produk) dan memecahnya menjadi jadwal: tanggal ETA dan volume.
2. **Vendor** mendaftarkan truk untuk jadwal itu: nopol, netto timbangan vendor, jadwal berangkat. Jumlah truk bebas. Vendor juga bisa mengusulkan tanggal baru, yang berlaku setelah disetujui purchasing.
3. **QC** mencatat penerimaan saat truk tiba: tanggal masuk, netto timbangan pabrik, berat ditolak dan alasannya, nomor surat jalan, foto.
4. Sistem menghitung selisih berat dan menandai yang melewati batas. Purchasing menutup PO secara manual.

## Aturan utama

- Vendor hanya melihat PO milik vendornya sendiri. Pembatasan ini ada di database (RLS), bukan hanya di tampilan.
- Selisih berat = netto vendor − netto pabrik. Berat diterima = netto pabrik − berat ditolak.
- Truk bisa diubah vendor sampai QC mencatat penerimaan, lalu terkunci.
- Truk yang datang tanpa didaftarkan dicatat QC dan ditandai "tak terdaftar".
- ETA awal tetap disimpan saat jadwal direvisi. Ketepatan waktu dilaporkan terhadap keduanya, menurut volume.
- PO yang ditutup menolak truk baru; truk yang sudah terdaftar tetap bisa diterima.
- Setiap perubahan tercatat di riwayat (siapa, kapan, dari apa menjadi apa).

## Struktur

```
app/                  Halaman: login, beranda per peran, detail PO, laporan, kelola, aktivitas
app/api/users/        Rute server untuk membuat dan mengubah akun
components/           Kerangka halaman, formulir, beranda per peran
lib/                  Perhitungan, format, akses data, export Excel
supabase/migrations/  SQL: tabel, aturan, hak akses (RLS), penyimpanan foto
tests/                Uji perhitungan dan uji aturan akses
```

## Perintah

```bash
npm install     # pasang dependensi
npm run dev     # jalankan di komputer/Codespaces
npm test        # uji perhitungan (selisih, ketepatan waktu, total PO)
npm run build   # periksa bahwa website siap di-deploy
```

Uji aturan akses (`tests/rls_test.sql`) dijalankan di Postgres biasa setelah `tests/local_stub.sql` dan `supabase/migrations/001_schema.sql`.

## Teknologi

Next.js (App Router), TypeScript, Tailwind CSS, Supabase (Postgres + Auth + Storage), Vercel.
