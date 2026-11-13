# Panduan Setup Jadwal Pengiriman

Urutannya sama dengan SaySomething: Supabase, lalu Vercel. Perkiraan waktu 30 sampai 45 menit.

## 1. Buat proyek Supabase baru

Pakai proyek **baru**, jangan digabung dengan SaySomething.

1. Buka supabase.com → **New project**. Pilih region yang sama seperti sebelumnya (Tokyo).
2. Buka **SQL Editor**, tempel seluruh isi `supabase/migrations/001_schema.sql`, klik **Run**.
   Hasil yang benar: "Success. No rows returned". Jalankan satu kali saja.
3. Buat query baru, tempel seluruh isi `supabase/migrations/002_storage.sql`, klik **Run**.
   Ini menyiapkan tempat foto bukti penerimaan.
4. Buka **Authentication → Sign In / Providers**, matikan **Allow new users to sign up**.
   Akun hanya boleh dibuat lewat halaman Kelola di website.

## 2. Buat admin pertama

1. **Authentication → Users → Add user → Create new user**. Isi email dan password Wang, centang **Auto Confirm User**.
2. Buka **SQL Editor**, jalankan (ganti nama dan email):

```sql
insert into public.profiles (id, full_name, email, role)
select id, 'Wang', email, 'admin'
from auth.users where email = 'email-wang@contoh.com';
```

3. Periksa: `select full_name, role from public.profiles;` harus menampilkan satu baris dengan peran `admin`.

Akun lain (purchasing, QC, vendor) dibuat dari website, bukan dari sini.

## 3. Ambil tiga nilai dari Supabase

**Project Settings → API Keys** dan **Data API**:

| Nama variabel | Diambil dari |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key (`sb_publishable_...`) |
| `SUPABASE_SECRET_KEY` | Secret key (`sb_secret_...`). Jangan pernah dibagikan atau di-screenshot. |

## 4. Deploy ke Vercel

1. Vercel → **Add New → Project** → pilih repo `schedule_delivery` → **Deploy**.
2. **Settings → Environment Variables**: tambahkan tiga variabel di atas.
3. **Deployments → titik tiga → Redeploy**.
4. Buka alamat `.vercel.app` yang diberikan, login dengan akun admin.

Bila ingin memakai domain sendiri (misalnya subdomain `jadwal.` dari domain yang sudah ada), tambahkan di **Settings → Domains** seperti sebelumnya.

## 5. Isi data awal (sebagai admin)

1. **Kelola → Vendor**: tambahkan vendor.
2. **Kelola → Produk**: tambahkan produk dan batas selisih beratnya (bawaan 0,5%).
3. **Kelola → Akun pengguna**: buat akun purchasing dan QC. Akun vendor boleh dibuat admin atau purchasing.
   Password awal ditampilkan sekali saat akun dibuat. Catat dan kirimkan ke orangnya.

## 6. Cara kerja per peran

**Purchasing**
- Beranda → **Buat PO** → isi nomor PO, vendor, produk, volume.
- Di halaman PO → **Tambah jadwal** untuk tiap tahap pengiriman (ETA dan volume).
- "Perlu perhatian" di Beranda menampilkan usulan tanggal, jadwal lewat ETA, truk yang belum tiba lebih dari 3 hari, penolakan, selisih berat melewati batas, dan truk tak terdaftar.
- **Tutup PO** bila pengiriman dianggap selesai. Truk baru ditolak; truk yang sudah terdaftar tetap bisa diterima.

**Vendor**
- Hanya melihat PO miliknya.
- **Daftarkan truk**: pilih jadwal, isi nopol, netto timbangan vendor, jadwal berangkat. Satu jadwal boleh banyak truk.
- Data truk bisa diubah atau dibatalkan sampai QC mencatat penerimaan.
- **Usul tanggal baru** bila ETA sulit dipenuhi. Tanggal berubah setelah purchasing menyetujui.

**QC**
- Beranda menampilkan truk yang akan datang. **Catat penerimaan**: tanggal masuk, netto timbangan pabrik, berat ditolak dan alasannya, nomor surat jalan, foto.
- Truk datang tanpa terdaftar: **Catat truk tak terdaftar**, pilih PO-nya, lalu lanjut ke penerimaan.
- Koreksi penerimaan boleh dilakukan dan tercatat di riwayat perubahan.

**Semua peran**
- Menu **Aktivitas** adalah pengganti notifikasi. Angka merah di menu menunjukkan kejadian baru. Website belum mengirim email atau WhatsApp.

## 7. Rumus yang dipakai

- Selisih berat = netto vendor − netto pabrik. Ditandai merah bila persentasenya melewati batas produk.
- Berat diterima = netto pabrik − berat ditolak. Hanya berat diterima yang mengurangi sisa PO.
- Ketepatan waktu = volume diterima pada atau sebelum ETA, dibagi volume jadwal yang ETA-nya sudah lewat. Dilaporkan terhadap ETA awal dan ETA revisi.

## 8. Checklist uji setelah online

- [ ] Login admin berhasil; login dengan password salah ditolak.
- [ ] Buat 2 vendor, 1 produk, akun purchasing, QC, dan satu akun untuk tiap vendor.
- [ ] Purchasing membuat PO untuk vendor pertama dan menambah 2 jadwal.
- [ ] Vendor pertama melihat PO itu, mendaftarkan truk, mengusulkan tanggal.
- [ ] **Vendor kedua tidak melihat PO itu sama sekali**, termasuk saat alamat halaman PO ditempel langsung.
- [ ] QC mencatat penerimaan dengan penolakan sebagian dan **mengunggah foto**, lalu foto bisa dibuka lagi.
- [ ] Vendor pertama bisa melihat foto itu; vendor kedua tidak.
- [ ] QC mencatat truk tak terdaftar.
- [ ] Purchasing melihat semuanya di "Perlu perhatian", menyetujui usulan, mengunduh Excel, menutup PO.
- [ ] Setelah PO ditutup, vendor tidak bisa mendaftarkan truk baru.

Dua butir soal foto perlu perhatian khusus, karena penyimpanan foto adalah satu-satunya bagian yang belum bisa diuji sebelum tersambung ke Supabase asli.

## 9. Bila ada masalah

| Gejala | Penyebab yang paling mungkin |
|---|---|
| "Website belum tersambung ke database" | Variabel `NEXT_PUBLIC_...` belum diisi, atau belum Redeploy setelah mengisinya. |
| Login berhasil tetapi muncul "Akun ini belum punya peran" | Langkah 2 (insert ke `profiles`) belum dijalankan, atau emailnya berbeda. |
| "SUPABASE_SECRET_KEY belum diisi di server" saat membuat akun | Variabel itu belum ada di Vercel, atau belum Redeploy. |
| "Akun Anda tidak punya izin untuk tindakan ini" | Peran akun memang tidak boleh melakukannya. Lihat pembagian peran di bagian 6. |
| Foto gagal diunggah | `002_storage.sql` belum dijalankan, atau ukuran foto di atas 5 MB. |
| SQL kedua kali dijalankan muncul "already exists" | Tidak berbahaya. Skema sudah terpasang dari jalan pertama. |
