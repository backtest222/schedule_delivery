"use client";
import { db } from "./supabase";
import type { Activity, AuditEntry, PO, Product, Profile, Receipt, Schedule, Truck, Vendor } from "./types";

const PO_SELECT =
  "*, vendor:vendors(id,name), product:products(id,name,tolerance_pct), " +
  "schedules(*, trucks(*, receipt:receipts(*)), proposals:schedule_proposals(*), reminders:schedule_reminders(*))";

type RawTruck = Omit<Truck, "receipt"> & { receipt: Receipt | Receipt[] | null };
type RawSchedule = Omit<Schedule, "trucks" | "reminders"> & {
  trucks: RawTruck[] | null;
  proposals: Schedule["proposals"] | null;
  reminders: Schedule["reminders"] | null;
};
type RawPO = Omit<PO, "schedules"> & { schedules: RawSchedule[] | null };

function normalize(raw: RawPO): PO {
  const schedules = (raw.schedules ?? [])
    .map((s) => ({
      ...s,
      proposals: [...(s.proposals ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at)),
      reminders: [...(s.reminders ?? [])].sort((a, b) => b.last_try_at.localeCompare(a.last_try_at)),
      trucks: (s.trucks ?? [])
        .map((t) => ({ ...t, receipt: Array.isArray(t.receipt) ? (t.receipt[0] ?? null) : t.receipt }))
        .sort((a, b) => a.departure_at.localeCompare(b.departure_at)),
    }))
    .sort((a, b) => a.eta_current.localeCompare(b.eta_current) || a.created_at.localeCompare(b.created_at));
  return { ...raw, schedules };
}

export async function loadPOs(status?: "open" | "closed"): Promise<PO[]> {
  let q = db().from("purchase_orders").select(PO_SELECT).order("created_at", { ascending: false });
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) throw error;
  return (data as unknown as RawPO[]).map(normalize);
}

export async function loadPO(id: string): Promise<PO | null> {
  const { data, error } = await db().from("purchase_orders").select(PO_SELECT).eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? normalize(data as unknown as RawPO) : null;
}

export async function loadVendors(): Promise<Vendor[]> {
  const { data, error } = await db().from("vendors").select("id,name").order("name");
  if (error) throw error;
  return data as Vendor[];
}

export async function loadProducts(): Promise<Product[]> {
  const { data, error } = await db().from("products").select("id,name,tolerance_pct").order("name");
  if (error) throw error;
  return data as Product[];
}

export async function loadProfiles(): Promise<Profile[]> {
  const { data, error } = await db().from("profiles").select("*").order("full_name");
  if (error) throw error;
  return data as Profile[];
}

export async function loadActivity(limit = 100): Promise<Activity[]> {
  const { data, error } = await db()
    .from("activity")
    .select("id,created_at,kind,po_id,vendor_id,data,actor")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data as Activity[];
}

/** Jumlah aktivitas baru sejak terakhir dibuka, tidak termasuk tindakan sendiri. */
export async function countUnread(profile: Profile): Promise<number> {
  const { count, error } = await db()
    .from("activity")
    .select("id", { count: "exact", head: true })
    .gt("created_at", profile.activity_seen_at)
    .or(`actor.is.null,actor.neq.${profile.id}`);
  if (error) return 0;
  return count ?? 0;
}

export async function loadAudit(poId: string): Promise<AuditEntry[]> {
  const { data, error } = await db()
    .from("audit_log")
    .select("id,changed_at,changed_by,table_name,row_id,action,old_data,new_data")
    .eq("po_id", poId)
    .order("changed_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return data as AuditEntry[];
}

async function bearer(): Promise<string> {
  const { data } = await db().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sesi login habis. Silakan login ulang.");
  return token;
}

/** Memanggil rute server pengelola akun dengan token login pengguna. */
export async function callUsersApi<T = { ok: true }>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/users", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${await bearer()}` },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? "Permintaan gagal. Coba lagi.");
  return json;
}

export type AccountInfo = Record<string, { last_sign_in_at: string | null; mfa: boolean }>;

/** Login terakhir dan status verifikasi dua langkah tiap akun yang boleh dikelola pemanggil. */
export async function loadAccountInfo(): Promise<AccountInfo> {
  return (await callUsersApi<{ users: AccountInfo }>({ action: "overview" })).users;
}

export type ReminderRun = {
  today: string;
  schedules: number;
  results: { vendor: string; schedules: number; recipients: string[]; status: "sent" | "failed" | "no_recipient" | "preview"; error?: string }[];
};

/** Pratinjau (preview: true) atau kirim sekarang pengingat email H-3. */
export async function callRemindersApi(preview: boolean): Promise<ReminderRun> {
  const res = await fetch("/api/reminders", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${await bearer()}` },
    body: JSON.stringify({ preview }),
  });
  const json = (await res.json().catch(() => ({}))) as ReminderRun & { error?: string };
  if (!res.ok) throw new Error(json.error ?? "Pengingat gagal dijalankan.");
  return json;
}

export type ReminderLog = {
  id: number;
  eta: string;
  status: "sent" | "failed" | "no_recipient";
  recipients: string[];
  missing_kg: number;
  error: string | null;
  attempts: number;
  last_try_at: string;
  schedule: { po: { id: string; po_number: string; vendor: { name: string } } } | null;
};

/** Catatan pengingat terakhir, untuk halaman Kelola. */
export async function loadReminderLog(limit = 50): Promise<ReminderLog[]> {
  const { data, error } = await db()
    .from("schedule_reminders")
    .select("id, eta, status, recipients, missing_kg, error, attempts, last_try_at, schedule:schedules(po:purchase_orders(id, po_number, vendor:vendors(name)))")
    .order("last_try_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data as unknown as ReminderLog[];
}

/** Mengunduh cadangan seluruh data (hanya admin). */
export async function downloadBackup(): Promise<void> {
  const res = await fetch("/api/backup", { headers: { authorization: `Bearer ${await bearer()}` } });
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(json.error ?? "Cadangan gagal diunduh.");
  }
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `cadangan-jadwal-pengiriman-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
