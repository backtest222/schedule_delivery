import "server-only";
import { fail, getCaller } from "@/lib/server/caller";
import { runReminders } from "@/lib/server/reminders";

/**
 * Pratinjau dan kirim manual pengingat H-3 dari halaman Kelola.
 * Admin dan purchasing (sudah verifikasi dua langkah).
 * Body: { "preview": true } untuk melihat saja.
 */
export async function POST(request: Request) {
  const caller = await getCaller(request);
  if (caller instanceof Response) return caller;
  const body = (await request.json().catch(() => ({}))) as { preview?: boolean };
  try {
    return Response.json(await runReminders(caller.admin, { preview: body.preview === true }));
  } catch (e) {
    return fail(500, e instanceof Error ? e.message : "Pengingat gagal dijalankan.");
  }
}
