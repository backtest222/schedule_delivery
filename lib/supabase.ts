"use client";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** false bila alamat dan kunci Supabase belum diisi di environment variable. */
export const isConfigured = Boolean(url && key);

let client: SupabaseClient | null = null;

/** Klien browser. Semua baca-tulis lewat sini dibatasi aturan akses (RLS) di database. */
export function db(): SupabaseClient {
  if (!url || !key) throw new Error("Supabase belum dikonfigurasi");
  client ??= createClient(url, key);
  return client;
}

type PgError = { message?: string; code?: string; details?: string };

/** Mengubah pesan error database menjadi kalimat yang bisa dipahami pengguna. */
export function errMsg(e: unknown): string {
  const err = (e ?? {}) as PgError;
  const msg = err.message ?? String(e);
  if (err.code === "23505") {
    if (msg.includes("po_number")) return "Nomor PO itu sudah dipakai.";
    if (msg.includes("one_pending")) return "Jadwal ini masih punya usulan yang menunggu keputusan.";
    if (msg.includes("receipts_pkey")) return "Truk ini sudah punya catatan penerimaan.";
    return "Data dengan nama atau nomor yang sama sudah ada.";
  }
  if (err.code === "23503") return "Data ini masih dipakai di tempat lain, jadi tidak bisa dihapus.";
  if (err.code === "23514") {
    if (msg.includes("receipts_rejected_max")) return "Berat ditolak tidak boleh melebihi netto pabrik.";
    if (msg.includes("receipts_reason_needed")) return "Pilih alasan penolakan.";
    if (msg.includes("trucks_cancel_reason")) return "Isi alasan pembatalan.";
    return "Ada isian yang nilainya tidak diperbolehkan. Periksa kembali angkanya.";
  }
  if (err.code === "42501" || msg.includes("row-level security")) {
    return "Akun Anda tidak punya izin untuk tindakan ini.";
  }
  if (msg.includes("Failed to fetch")) return "Tidak bisa terhubung. Periksa koneksi internet lalu coba lagi.";
  return msg;
}
