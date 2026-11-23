import "server-only";
import { fail, serviceClient } from "@/lib/server/caller";
import { runReminders } from "@/lib/server/reminders";

/**
 * Pengingat email H-3, dipanggil Vercel Cron setiap pagi (lihat vercel.json).
 * Vercel mengirim "Authorization: Bearer <CRON_SECRET>" secara otomatis.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return fail(500, "CRON_SECRET belum diisi di server.");
  if (request.headers.get("authorization") !== `Bearer ${secret}`) return fail(401, "Tidak diizinkan.");
  const admin = serviceClient();
  if (!admin) return fail(500, "SUPABASE_SECRET_KEY belum diisi di server.");
  try {
    return Response.json({ ok: true, ...(await runReminders(admin)) });
  } catch (e) {
    return fail(500, e instanceof Error ? e.message : "Pengingat gagal dijalankan.");
  }
}
