"use client";
import { acceptedKg, poTotals, scheduleTotals, vendorReport, weightDiff } from "./calc";
import { REJECT_REASONS, type PO } from "./types";

/** Tanggal YYYY-MM-DD -> Date yang tampil sama di Excel (Excel tidak mengenal zona waktu). */
function xlDate(d: string | null | undefined): Date | null {
  if (!d) return null;
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

/** Waktu ISO -> Date yang di Excel tampil sebagai jam perangkat pengguna. */
function xlDateTime(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()));
}

const TRUCK_STATUS = { planned: "Dalam rencana", received: "Diterima", cancelled: "Batal" } as const;

type Cell = string | number | boolean | Date | null;
type Col = { header: string; width: number; fmt?: string };

/** Menyusun file Excel berisi PO, jadwal, truk, dan kinerja vendor, lalu mengunduhnya. */
export async function exportExcel(pos: PO[], today: string): Promise<void> {
  const mod = await import("exceljs");
  const ExcelJS = (mod as unknown as { default?: typeof import("exceljs") }).default ?? mod;
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();

  const KG = "#,##0.##";
  const PCT = '0.00"%"';
  const DATE = "dd/mm/yyyy";
  const DATETIME = "dd/mm/yyyy hh:mm";

  const sheet = (name: string, cols: Col[], rows: Cell[][]) => {
    const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = cols.map((c) => ({ header: c.header, width: c.width, style: c.fmt ? { numFmt: c.fmt } : {} }));
    ws.getRow(1).font = { bold: true };
    for (const r of rows) ws.addRow(r);
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  };

  sheet(
    "PO",
    [
      { header: "No PO", width: 18 },
      { header: "Vendor", width: 26 },
      { header: "Produk", width: 22 },
      { header: "Volume PO (kg)", width: 16, fmt: KG },
      { header: "Total jadwal (kg)", width: 16, fmt: KG },
      { header: "Diterima (kg)", width: 15, fmt: KG },
      { header: "Ditolak (kg)", width: 14, fmt: KG },
      { header: "Dalam rencana (kg)", width: 18, fmt: KG },
      { header: "Sisa (kg)", width: 14, fmt: KG },
      { header: "Status", width: 10 },
      { header: "Dibuat", width: 12, fmt: DATE },
      { header: "Ditutup", width: 12, fmt: DATE },
    ],
    pos.map((po) => {
      const t = poTotals(po);
      return [
        po.po_number, po.vendor.name, po.product.name, po.volume_kg, t.scheduledKg, t.acceptedKg,
        t.rejectedKg, t.plannedKg, t.remainingKg, po.status === "open" ? "Buka" : "Tutup",
        xlDateTime(po.created_at), xlDateTime(po.closed_at),
      ];
    }),
  );

  sheet(
    "Jadwal",
    [
      { header: "No PO", width: 18 },
      { header: "Vendor", width: 26 },
      { header: "Produk", width: 22 },
      { header: "ETA awal", width: 12, fmt: DATE },
      { header: "ETA berlaku", width: 12, fmt: DATE },
      { header: "Volume (kg)", width: 14, fmt: KG },
      { header: "Diterima (kg)", width: 15, fmt: KG },
      { header: "Tepat waktu thd ETA awal (kg)", width: 28, fmt: KG },
      { header: "Tepat waktu thd ETA berlaku (kg)", width: 30, fmt: KG },
      { header: "Dalam rencana (kg)", width: 18, fmt: KG },
    ],
    pos.flatMap((po) =>
      po.schedules.map((s) => {
        const t = scheduleTotals(s);
        return [
          po.po_number, po.vendor.name, po.product.name, xlDate(s.eta_original), xlDate(s.eta_current),
          s.volume_kg, t.acceptedKg, t.onTimeOriginalKg, t.onTimeCurrentKg, t.plannedKg,
        ];
      }),
    ),
  );

  sheet(
    "Truk",
    [
      { header: "No PO", width: 18 },
      { header: "Vendor", width: 26 },
      { header: "Produk", width: 22 },
      { header: "ETA jadwal", width: 12, fmt: DATE },
      { header: "Nopol", width: 14 },
      { header: "Status", width: 14 },
      { header: "Tak terdaftar", width: 13 },
      { header: "Berangkat", width: 17, fmt: DATETIME },
      { header: "Netto vendor (kg)", width: 17, fmt: KG },
      { header: "Tanggal masuk", width: 14, fmt: DATE },
      { header: "Netto pabrik (kg)", width: 17, fmt: KG },
      { header: "Selisih (kg)", width: 13, fmt: KG },
      { header: "Selisih (%)", width: 12, fmt: PCT },
      { header: "Batas (%)", width: 10, fmt: PCT },
      { header: "Melewati batas", width: 14 },
      { header: "Ditolak (kg)", width: 13, fmt: KG },
      { header: "Diterima (kg)", width: 14, fmt: KG },
      { header: "Alasan penolakan", width: 30 },
      { header: "Catatan penolakan", width: 30 },
      { header: "No surat jalan", width: 16 },
      { header: "Alasan batal", width: 26 },
    ],
    pos.flatMap((po) =>
      po.schedules.flatMap((s) =>
        s.trucks.map((t) => {
          const r = t.receipt;
          const diff = r ? weightDiff(t.vendor_net_kg, r.factory_net_kg, po.product.tolerance_pct) : null;
          return [
            po.po_number, po.vendor.name, po.product.name, xlDate(s.eta_current), t.plate_number,
            TRUCK_STATUS[t.status], t.registered_by_qc ? "Ya" : "Tidak", xlDateTime(t.departure_at),
            t.vendor_net_kg, xlDate(r?.arrived_at), r?.factory_net_kg ?? null, diff?.diffKg ?? null,
            diff?.diffPct ?? null, po.product.tolerance_pct, diff ? (diff.flagged ? "Ya" : "Tidak") : null,
            r?.rejected_kg ?? null, r ? acceptedKg(r) : null,
            r?.reject_reason ? (REJECT_REASONS[r.reject_reason] ?? r.reject_reason) : null,
            r?.reject_note ?? null, r?.delivery_note_number ?? null, t.cancel_reason,
          ];
        }),
      ),
    ),
  );

  sheet(
    "Kinerja vendor",
    [
      { header: "Vendor", width: 26 },
      { header: "Jumlah PO", width: 11 },
      { header: "Jatuh tempo thd ETA awal (kg)", width: 28, fmt: KG },
      { header: "Tepat waktu thd ETA awal (%)", width: 28, fmt: PCT },
      { header: "Jatuh tempo thd ETA berlaku (kg)", width: 30, fmt: KG },
      { header: "Tepat waktu thd ETA berlaku (%)", width: 30, fmt: PCT },
      { header: "Truk diterima", width: 13 },
      { header: "Netto vendor (kg)", width: 17, fmt: KG },
      { header: "Netto pabrik (kg)", width: 17, fmt: KG },
      { header: "Selisih (kg)", width: 13, fmt: KG },
      { header: "Selisih (%)", width: 12, fmt: PCT },
      { header: "Truk melewati batas", width: 19 },
      { header: "Ditolak (kg)", width: 13, fmt: KG },
      { header: "Ditolak (%)", width: 12, fmt: PCT },
      { header: "Truk ada penolakan", width: 18 },
      { header: "Truk tak terdaftar", width: 17 },
      { header: "Truk batal", width: 11 },
    ],
    vendorReport(pos, today).map((v) => [
      v.vendor, v.poCount, v.dueOriginalKg, v.onTimeOriginalPct, v.dueCurrentKg, v.onTimeCurrentPct,
      v.receivedTrucks, v.vendorNetKg, v.factoryNetKg, v.diffKg, v.diffPct, v.flaggedTrucks,
      v.rejectedKg, v.rejectedPct, v.rejectedTrucks, v.unregisteredTrucks, v.cancelledTrucks,
    ]),
  );

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `jadwal-pengiriman-${today}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
