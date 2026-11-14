-- =====================================================================
-- Jadwal Pengiriman — pengaman tambahan
-- Jalankan SETELAH 001_schema.sql dan 002_storage.sql. Aman dijalankan ulang.
--   1. Admin dan purchasing wajib verifikasi dua langkah (2FA).
--   2. Tempat penyimpanan cadangan data mingguan.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. WAJIB 2FA UNTUK ADMIN DAN PURCHASING
--    Token login menyimpan tingkat verifikasi: "aal1" = password saja,
--    "aal2" = password + kode dari aplikasi autentikator.
--    Admin dan purchasing yang baru sampai aal1 dianggap belum punya peran,
--    sehingga semua aturan akses menolak mereka. Pembatasan ini ada di
--    database, jadi tidak bisa dilewati dengan memanggil database langsung.
--    Vendor dan QC tetap cukup dengan password.
-- ---------------------------------------------------------------------
create or replace function public.my_role()
returns public.user_role
language sql stable security definer set search_path = ''
as $$
  select role from public.profiles
  where id = (select auth.uid())
    and active
    and (
      role in ('vendor', 'qc')
      or coalesce((select auth.jwt()) ->> 'aal', 'aal1') = 'aal2'
    );
$$;

-- ---------------------------------------------------------------------
-- 2. CADANGAN DATA
--    Bucket privat tanpa policy: hanya server website (kunci rahasia)
--    yang bisa menulis dan membacanya.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('backups', 'backups', false)
on conflict (id) do nothing;
