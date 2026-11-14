import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Tabel yang dicadangkan dan kolom pengurutnya (agar pembacaan per halaman konsisten).
const TABLES: [name: string, orderBy: string][] = [
  ["vendors", "created_at"],
  ["products", "created_at"],
  ["profiles", "created_at"],
  ["purchase_orders", "created_at"],
  ["schedules", "created_at"],
  ["schedule_proposals", "created_at"],
  ["trucks", "created_at"],
  ["receipts", "created_at"],
  ["activity", "id"],
  ["audit_log", "id"],
];

const PAGE = 1000;

export type Backup = {
  version: 1;
  created_at: string;
  counts: Record<string, number>;
  tables: Record<string, unknown[]>;
};

/** Membaca seluruh isi tabel menjadi satu berkas cadangan. Foto tidak ikut; hanya lokasinya. */
export async function exportAll(admin: SupabaseClient): Promise<Backup> {
  const tables: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};
  for (const [name, orderBy] of TABLES) {
    const rows: unknown[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await admin
        .from(name)
        .select("*")
        .order(orderBy, { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`Tabel ${name} gagal dibaca: ${error.message}`);
      rows.push(...(data ?? []));
      if (!data || data.length < PAGE) break;
    }
    tables[name] = rows;
    counts[name] = rows.length;
  }
  return { version: 1, created_at: new Date().toISOString(), counts, tables };
}
