import { test } from "node:test";
import assert from "node:assert/strict";
import { acceptedKg, isOverdue, nextSchedule, poTotals, scheduleTotals, vendorReport, weightDiff } from "../lib/calc.ts";
import { daysBetween, parseNumber } from "../lib/format.ts";
import type { PO, Schedule, Truck } from "../lib/types.ts";

let n = 0;
function truck(p: Partial<Truck> & { vendor_net_kg: number }): Truck {
  n += 1;
  return {
    id: `t${n}`, schedule_id: "s", po_id: "po", plate_number: `BE ${n} AA`, departure_at: "2026-11-30T01:00:00Z",
    status: "planned", registered_by_qc: false, cancel_reason: null, created_at: "", updated_at: "", receipt: null, ...p,
  };
}
function received(vendorNet: number, factoryNet: number, rejected: number, arrived: string, extra: Partial<Truck> = {}): Truck {
  return truck({
    vendor_net_kg: vendorNet, status: "received", ...extra,
    receipt: {
      truck_id: "", arrived_at: arrived, factory_net_kg: factoryNet, rejected_kg: rejected, reject_reason: rejected ? "kualitas" : null,
      reject_note: null, delivery_note_number: null, photos: [], received_by: null, created_at: "", updated_at: "",
    },
  });
}
function schedule(etaOriginal: string, etaCurrent: string, volume: number, trucks: Truck[]): Schedule {
  return { id: `s${etaOriginal}`, po_id: "po", eta_original: etaOriginal, eta_current: etaCurrent, volume_kg: volume, created_at: "", trucks, proposals: [] };
}
function po(volume: number, schedules: Schedule[], vendor = "A"): PO {
  return {
    id: `po-${vendor}`, po_number: `PO-${vendor}`, vendor_id: vendor, product_id: "p", volume_kg: volume, status: "open", note: null,
    created_at: "", closed_at: null, vendor: { id: vendor, name: `Vendor ${vendor}` }, product: { id: "p", name: "Jagung", tolerance_pct: 0.5 }, schedules,
  };
}

test("selisih berat: netto vendor dikurangi netto pabrik, penolakan tidak ikut", () => {
  assert.deepEqual(weightDiff(25000, 24900, 0.5), { diffKg: 100, diffPct: 0.4, flagged: false });
  assert.deepEqual(weightDiff(25000, 24800, 0.5), { diffKg: 200, diffPct: 0.8, flagged: true });
  // Pabrik lebih berat dari vendor juga ditandai bila melewati batas.
  assert.equal(weightDiff(25000, 25300, 0.5).flagged, true);
  // Tepat di batas belum ditandai.
  assert.equal(weightDiff(20000, 19900, 0.5).flagged, false);
});

test("berat diterima = netto pabrik dikurangi berat ditolak", () => {
  assert.equal(acceptedKg({ factory_net_kg: 24900, rejected_kg: 400 }), 24500);
});

test("total jadwal memisahkan tepat waktu terhadap ETA awal dan ETA revisi", () => {
  const s = schedule("2026-12-01", "2026-12-05", 60000, [
    received(25000, 24900, 400, "2026-12-01"), // tepat waktu thd keduanya, diterima 24.500
    received(25000, 25000, 0, "2026-12-04"),   // terlambat thd awal, tepat thd revisi
    received(10000, 10000, 0, "2026-12-07"),   // terlambat thd keduanya
    truck({ vendor_net_kg: 8000 }),            // dalam rencana
    truck({ vendor_net_kg: 9000, status: "cancelled", cancel_reason: "x" }),
  ]);
  assert.deepEqual(scheduleTotals(s), {
    acceptedKg: 59500, rejectedKg: 400, plannedKg: 8000, onTimeOriginalKg: 24500, onTimeCurrentKg: 49500,
  });
});

test("total PO: sisa, kelebihan rencana, kelebihan jadwal", () => {
  const p = po(50000, [
    schedule("2026-12-01", "2026-12-01", 30000, [received(25000, 24900, 400, "2026-12-01"), truck({ vendor_net_kg: 20000 })]),
    schedule("2026-12-10", "2026-12-10", 25000, [truck({ vendor_net_kg: 10000 })]),
  ]);
  const t = poTotals(p);
  assert.equal(t.acceptedKg, 24500);
  assert.equal(t.plannedKg, 30000);
  assert.equal(t.remainingKg, 25500);
  assert.equal(t.overPlanned, true);   // 24.500 + 30.000 > 50.000
  assert.equal(t.overScheduled, true); // 55.000 > 50.000
  assert.equal(t.pct, 49);
});

test("truk terlambat: masih dalam rencana lebih dari 3 hari setelah berangkat", () => {
  const now = new Date("2026-12-04T02:00:00Z");
  assert.equal(isOverdue({ status: "planned", departure_at: "2026-11-30T01:00:00Z" }, now), true);
  assert.equal(isOverdue({ status: "planned", departure_at: "2026-12-02T01:00:00Z" }, now), false);
  assert.equal(isOverdue({ status: "received", departure_at: "2026-11-30T01:00:00Z" }, now), false);
});

test("jadwal berikutnya: terdekat yang belum lewat, atau yang terakhir", () => {
  const p = po(1, [schedule("2026-12-01", "2026-12-01", 1, []), schedule("2026-12-10", "2026-12-10", 1, [])]);
  assert.equal(nextSchedule(p, "2026-12-05")?.eta_current, "2026-12-10");
  assert.equal(nextSchedule(p, "2026-12-20")?.eta_current, "2026-12-10");
  assert.equal(nextSchedule(po(1, []), "2026-12-05"), null);
});

test("laporan vendor: ketepatan waktu menurut volume, dibatasi volume jadwal", () => {
  const a = po(100000, [
    // Jatuh tempo; 24.500 dari 60.000 tepat waktu thd ETA awal, 49.500 thd revisi.
    schedule("2026-12-01", "2026-12-05", 60000, [
      received(25000, 24900, 400, "2026-12-01"),
      received(25000, 25000, 0, "2026-12-04"),
      truck({ vendor_net_kg: 5000, status: "cancelled", cancel_reason: "x" }),
    ]),
    // Kiriman melebihi jadwal: hanya dihitung sampai volume jadwal.
    schedule("2026-12-02", "2026-12-02", 10000, [received(12000, 12000, 0, "2026-12-02", { registered_by_qc: true })]),
    // Belum jatuh tempo: tidak masuk penyebut.
    schedule("2026-12-20", "2026-12-20", 30000, []),
  ]);
  const [row] = vendorReport([a], "2026-12-10");
  assert.equal(row.dueOriginalKg, 70000);
  assert.equal(row.onTimeOriginalKg, 34500);
  assert.equal(row.onTimeOriginalPct, 49.29);
  assert.equal(row.onTimeCurrentKg, 59500);
  assert.equal(row.onTimeCurrentPct, 85);
  assert.equal(row.receivedTrucks, 3);
  assert.equal(row.rejectedKg, 400);
  assert.equal(row.rejectedTrucks, 1);
  assert.equal(row.diffKg, 100);
  assert.equal(row.flaggedTrucks, 0);
  assert.equal(row.unregisteredTrucks, 1);
  assert.equal(row.cancelledTrucks, 1);
});

test("laporan vendor: tanpa jadwal jatuh tempo persentasenya kosong, bukan 0%", () => {
  const [row] = vendorReport([po(1000, [schedule("2027-01-01", "2027-01-01", 1000, [])])], "2026-12-10");
  assert.equal(row.onTimeOriginalPct, null);
  assert.equal(row.diffPct, null);
});

test("angka isian: format Indonesia dan biasa", () => {
  assert.equal(parseNumber("25.300"), 25300);
  assert.equal(parseNumber("25300"), 25300);
  assert.equal(parseNumber("25,5"), 25.5);
  assert.equal(parseNumber("1.250.000,75"), 1250000.75);
  assert.equal(parseNumber("0.5"), 0.5);
  assert.ok(Number.isNaN(parseNumber("")));
  assert.ok(Number.isNaN(parseNumber("abc")));
});

test("selisih hari antar tanggal", () => {
  assert.equal(daysBetween("2026-12-01", "2026-12-05"), 4);
  assert.equal(daysBetween("2026-12-05", "2026-12-01"), -4);
  assert.equal(daysBetween("2026-02-28", "2026-03-01"), 1);
});
