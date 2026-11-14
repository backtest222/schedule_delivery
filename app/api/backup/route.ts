import "server-only";
import { fail, getCaller } from "@/lib/server/caller";
import { exportAll } from "@/lib/server/export";

/** Unduh cadangan seluruh data saat ini. Hanya admin. */
export async function GET(request: Request) {
  const caller = await getCaller(request);
  if (caller instanceof Response) return caller;
  if (caller.role !== "admin") return fail(403, "Hanya admin yang boleh mengunduh cadangan.");
  try {
    const backup = await exportAll(caller.admin);
    return new Response(JSON.stringify(backup), {
      headers: {
        "content-type": "application/json",
        "content-disposition": `attachment; filename="cadangan-jadwal-pengiriman-${backup.created_at.slice(0, 10)}.json"`,
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    return fail(500, e instanceof Error ? e.message : "Cadangan gagal dibuat.");
  }
}
