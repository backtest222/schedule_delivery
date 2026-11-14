import "server-only";
import { fail, serviceClient } from "@/lib/server/caller";
import { exportAll } from "@/lib/server/export";

const BUCKET = "backups";
/** Jumlah cadangan mingguan yang disimpan (sekitar 3 bulan). */
const KEEP = 12;

/**
 * Cadangan mingguan, dipanggil oleh Vercel Cron (lihat vercel.json).
 * Vercel mengirim "Authorization: Bearer <CRON_SECRET>" secara otomatis.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return fail(500, "CRON_SECRET belum diisi di server.");
  if (request.headers.get("authorization") !== `Bearer ${secret}`) return fail(401, "Tidak diizinkan.");

  const admin = serviceClient();
  if (!admin) return fail(500, "SUPABASE_SECRET_KEY belum diisi di server.");

  try {
    const backup = await exportAll(admin);
    const name = `backup-${backup.created_at.slice(0, 10)}.json`;
    const { error: uploadError } = await admin.storage
      .from(BUCKET)
      .upload(name, JSON.stringify(backup), { contentType: "application/json", upsert: true });
    if (uploadError) return fail(500, `Cadangan gagal disimpan: ${uploadError.message}`);

    // Buang cadangan paling lama bila sudah lebih dari KEEP.
    const { data: files } = await admin.storage.from(BUCKET).list("", { limit: 1000 });
    const old = (files ?? [])
      .map((f) => f.name)
      .filter((n) => /^backup-\d{4}-\d{2}-\d{2}\.json$/.test(n))
      .sort()
      .reverse()
      .slice(KEEP);
    if (old.length > 0) await admin.storage.from(BUCKET).remove(old);

    return Response.json({ ok: true, file: name, counts: backup.counts, removed: old.length });
  } catch (e) {
    return fail(500, e instanceof Error ? e.message : "Cadangan gagal dibuat.");
  }
}
