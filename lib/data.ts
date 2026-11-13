"use client";
import { db } from "./supabase";
import type { Activity, AuditEntry, PO, Product, Profile, Receipt, Schedule, Truck, Vendor } from "./types";

const PO_SELECT =
  "*, vendor:vendors(id,name), product:products(id,name,tolerance_pct), " +
  "schedules(*, trucks(*, receipt:receipts(*)), proposals:schedule_proposals(*))";

type RawTruck = Omit<Truck, "receipt"> & { receipt: Receipt | Receipt[] | null };
type RawSchedule = Omit<Schedule, "trucks"> & { trucks: RawTruck[] | null; proposals: Schedule["proposals"] | null };
type RawPO = Omit<PO, "schedules"> & { schedules: RawSchedule[] | null };

function normalize(raw: RawPO): PO {
  const schedules = (raw.schedules ?? [])
    .map((s) => ({
      ...s,
      proposals: [...(s.proposals ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at)),
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

/** Memanggil rute server pengelola akun dengan token login pengguna. */
export async function callUsersApi(body: Record<string, unknown>): Promise<void> {
  const { data } = await db().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sesi login habis. Silakan login ulang.");
  const res = await fetch("/api/users", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error ?? "Permintaan gagal. Coba lagi.");
  }
}
