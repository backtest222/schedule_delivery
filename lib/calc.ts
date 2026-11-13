import type { PO, Schedule, Truck } from "./types";

/** Truk yang belum tiba lebih dari sekian hari setelah jadwal berangkat dianggap terlambat. */
export const OVERDUE_DAYS = 3;

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Selisih berat = netto vendor - netto pabrik.
 * Berat yang ditolak TIDAK ikut dihitung di sini: penolakan adalah soal kualitas,
 * selisih adalah soal timbangan.
 */
export function weightDiff(vendorNetKg: number, factoryNetKg: number, tolerancePct: number) {
  const diffKg = round2(vendorNetKg - factoryNetKg);
  const diffPct = vendorNetKg > 0 ? round2((diffKg / vendorNetKg) * 100) : 0;
  return { diffKg, diffPct, flagged: Math.abs(diffPct) > tolerancePct };
}

/** Berat diterima = netto pabrik - berat ditolak. */
export function acceptedKg(r: { factory_net_kg: number; rejected_kg: number }) {
  return round2(r.factory_net_kg - r.rejected_kg);
}

export function scheduleTotals(s: Schedule) {
  let accepted = 0;
  let rejected = 0;
  let planned = 0;
  let onTimeOriginal = 0;
  let onTimeCurrent = 0;
  for (const t of s.trucks) {
    if (t.status === "received" && t.receipt) {
      const a = acceptedKg(t.receipt);
      accepted += a;
      rejected += t.receipt.rejected_kg;
      if (t.receipt.arrived_at <= s.eta_original) onTimeOriginal += a;
      if (t.receipt.arrived_at <= s.eta_current) onTimeCurrent += a;
    } else if (t.status === "planned") {
      planned += t.vendor_net_kg;
    }
  }
  return {
    acceptedKg: round2(accepted),
    rejectedKg: round2(rejected),
    plannedKg: round2(planned),
    onTimeOriginalKg: round2(onTimeOriginal),
    onTimeCurrentKg: round2(onTimeCurrent),
  };
}

export function poTotals(po: PO) {
  let accepted = 0;
  let rejected = 0;
  let planned = 0;
  for (const s of po.schedules) {
    const t = scheduleTotals(s);
    accepted += t.acceptedKg;
    rejected += t.rejectedKg;
    planned += t.plannedKg;
  }
  const scheduled = po.schedules.reduce((sum, s) => sum + s.volume_kg, 0);
  return {
    acceptedKg: round2(accepted),
    rejectedKg: round2(rejected),
    plannedKg: round2(planned),
    scheduledKg: round2(scheduled),
    remainingKg: round2(Math.max(0, po.volume_kg - accepted)),
    /** Diterima + truk dalam rencana sudah melebihi volume PO. */
    overPlanned: accepted + planned > po.volume_kg,
    /** Jumlah volume semua jadwal melebihi volume PO. */
    overScheduled: scheduled > po.volume_kg,
    pct: po.volume_kg > 0 ? Math.min(100, round2((accepted / po.volume_kg) * 100)) : 0,
  };
}

export function isOverdue(t: Pick<Truck, "status" | "departure_at">, now: Date) {
  if (t.status !== "planned") return false;
  return now.getTime() - new Date(t.departure_at).getTime() > OVERDUE_DAYS * 86_400_000;
}

/** Jadwal terdekat yang masih berjalan; bila semua sudah lewat, jadwal terakhir. */
export function nextSchedule(po: PO, today: string): Schedule | null {
  const sorted = [...po.schedules].sort((a, b) => a.eta_current.localeCompare(b.eta_current));
  return sorted.find((s) => s.eta_current >= today) ?? sorted[sorted.length - 1] ?? null;
}

export type VendorRow = {
  vendorId: string;
  vendor: string;
  poCount: number;
  /** Volume jadwal yang ETA awalnya sudah lewat, dan bagian yang tiba tepat waktu. */
  dueOriginalKg: number;
  onTimeOriginalKg: number;
  onTimeOriginalPct: number | null;
  dueCurrentKg: number;
  onTimeCurrentKg: number;
  onTimeCurrentPct: number | null;
  receivedTrucks: number;
  vendorNetKg: number;
  factoryNetKg: number;
  acceptedKg: number;
  rejectedKg: number;
  rejectedPct: number | null;
  diffKg: number;
  diffPct: number | null;
  flaggedTrucks: number;
  rejectedTrucks: number;
  unregisteredTrucks: number;
  cancelledTrucks: number;
};

const pct = (part: number, whole: number) => (whole > 0 ? round2((part / whole) * 100) : null);

/**
 * Kinerja per vendor.
 * Ketepatan waktu diukur menurut volume: dari volume jadwal yang sudah jatuh tempo,
 * berapa persen yang diterima pada atau sebelum ETA. Volume di atas jadwal tidak dihitung lebih.
 */
export function vendorReport(pos: PO[], today: string): VendorRow[] {
  const rows = new Map<string, VendorRow>();
  for (const po of pos) {
    let row = rows.get(po.vendor_id);
    if (!row) {
      row = {
        vendorId: po.vendor_id,
        vendor: po.vendor.name,
        poCount: 0,
        dueOriginalKg: 0,
        onTimeOriginalKg: 0,
        onTimeOriginalPct: null,
        dueCurrentKg: 0,
        onTimeCurrentKg: 0,
        onTimeCurrentPct: null,
        receivedTrucks: 0,
        vendorNetKg: 0,
        factoryNetKg: 0,
        acceptedKg: 0,
        rejectedKg: 0,
        rejectedPct: null,
        diffKg: 0,
        diffPct: null,
        flaggedTrucks: 0,
        rejectedTrucks: 0,
        unregisteredTrucks: 0,
        cancelledTrucks: 0,
      };
      rows.set(po.vendor_id, row);
    }
    row.poCount += 1;
    for (const s of po.schedules) {
      const t = scheduleTotals(s);
      if (s.eta_original <= today) {
        row.dueOriginalKg += s.volume_kg;
        row.onTimeOriginalKg += Math.min(s.volume_kg, t.onTimeOriginalKg);
      }
      if (s.eta_current <= today) {
        row.dueCurrentKg += s.volume_kg;
        row.onTimeCurrentKg += Math.min(s.volume_kg, t.onTimeCurrentKg);
      }
      for (const truck of s.trucks) {
        if (truck.status === "cancelled") {
          row.cancelledTrucks += 1;
          continue;
        }
        if (truck.registered_by_qc) row.unregisteredTrucks += 1;
        if (truck.status !== "received" || !truck.receipt) continue;
        row.receivedTrucks += 1;
        row.vendorNetKg += truck.vendor_net_kg;
        row.factoryNetKg += truck.receipt.factory_net_kg;
        row.acceptedKg += acceptedKg(truck.receipt);
        row.rejectedKg += truck.receipt.rejected_kg;
        if (truck.receipt.rejected_kg > 0) row.rejectedTrucks += 1;
        if (weightDiff(truck.vendor_net_kg, truck.receipt.factory_net_kg, po.product.tolerance_pct).flagged) {
          row.flaggedTrucks += 1;
        }
      }
    }
  }
  const out = [...rows.values()];
  for (const r of out) {
    r.onTimeOriginalPct = pct(r.onTimeOriginalKg, r.dueOriginalKg);
    r.onTimeCurrentPct = pct(r.onTimeCurrentKg, r.dueCurrentKg);
    r.rejectedPct = pct(r.rejectedKg, r.factoryNetKg);
    r.diffKg = round2(r.vendorNetKg - r.factoryNetKg);
    r.diffPct = pct(r.diffKg, r.vendorNetKg);
    for (const k of ["dueOriginalKg", "onTimeOriginalKg", "dueCurrentKg", "onTimeCurrentKg", "vendorNetKg", "factoryNetKg", "acceptedKg", "rejectedKg"] as const) {
      r[k] = round2(r[k]);
    }
  }
  return out.sort((a, b) => a.vendor.localeCompare(b.vendor));
}
