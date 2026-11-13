"use client";
import { useMemo, useState } from "react";
import { isInternal, useAuth } from "@/components/Shell";
import { Empty, ErrorNote, Field, Loading, useAction, useLoad } from "@/components/ui";
import { vendorReport } from "@/lib/calc";
import { loadPOs } from "@/lib/data";
import { exportExcel } from "@/lib/excel";
import { fmtKg, fmtPct, fmtVolume, todayStr } from "@/lib/format";

export default function ReportPage() {
  const { profile } = useAuth();
  const { data: pos, error, loading } = useLoad(() => loadPOs(), []);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const exporting = useAction();
  const today = todayStr();

  // Periode menyaring jadwal menurut ETA awalnya; truk ikut jadwalnya.
  const filtered = useMemo(
    () =>
      (pos ?? [])
        .map((po) => ({
          ...po,
          schedules: po.schedules.filter((s) => (!from || s.eta_original >= from) && (!to || s.eta_original <= to)),
        }))
        .filter((po) => po.schedules.length > 0 || (!from && !to)),
    [pos, from, to],
  );
  const rows = useMemo(() => vendorReport(filtered, today), [filtered, today]);

  if (!isInternal(profile)) return <Empty title="Halaman ini hanya untuk purchasing, QC, dan admin" />;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="text-xl font-extrabold tracking-tight">Laporan kinerja vendor</h1>
          <p className="text-sm text-muted">Ketepatan waktu dihitung menurut volume dari jadwal yang sudah jatuh tempo.</p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          disabled={exporting.busy || !pos}
          onClick={() => void exporting.run(() => exportExcel(filtered, today))}
        >
          {exporting.busy ? "Menyiapkan file…" : "Unduh Excel"}
        </button>
      </div>

      <div className="card grid gap-3 p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <Field label="ETA awal dari">
          <input id="report-from" className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="Sampai">
          <input id="report-to" className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <button
          type="button"
          className="btn"
          onClick={() => {
            setFrom("");
            setTo("");
          }}
        >
          Semua periode
        </button>
      </div>

      <ErrorNote error={error ?? exporting.error} />
      {loading ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty title="Belum ada data untuk periode ini" />
      ) : (
        <div className="card overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Vendor</th>
                <th className="r">PO</th>
                <th className="r">
                  Tepat waktu
                  <br />
                  thd ETA awal
                </th>
                <th className="r">
                  Tepat waktu
                  <br />
                  thd ETA revisi
                </th>
                <th className="r">
                  Truk
                  <br />
                  diterima
                </th>
                <th className="r">Diterima</th>
                <th className="r">Ditolak</th>
                <th className="r">
                  Selisih
                  <br />
                  berat
                </th>
                <th className="r">
                  Truk lewat
                  <br />
                  batas
                </th>
                <th className="r">
                  Tak
                  <br />
                  terdaftar
                </th>
                <th className="r">Batal</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.vendorId}>
                  <td className="font-semibold">{r.vendor}</td>
                  <td className="r">{r.poCount}</td>
                  <td className={`r ${r.onTimeOriginalPct !== null && r.onTimeOriginalPct < 90 ? "font-semibold text-danger" : ""}`}>
                    {fmtPct(r.onTimeOriginalPct)}
                  </td>
                  <td className="r">{fmtPct(r.onTimeCurrentPct)}</td>
                  <td className="r">{r.receivedTrucks}</td>
                  <td className="r">{fmtVolume(r.acceptedKg)}</td>
                  <td className={`r ${r.rejectedKg > 0 ? "text-danger" : ""}`}>
                    {fmtKg(r.rejectedKg)}
                    {r.rejectedPct ? ` (${fmtPct(r.rejectedPct)})` : ""}
                  </td>
                  <td className="r">
                    {fmtKg(r.diffKg)}
                    {r.diffPct !== null ? ` (${fmtPct(r.diffPct)})` : ""}
                  </td>
                  <td className={`r ${r.flaggedTrucks > 0 ? "font-semibold text-danger" : ""}`}>{r.flaggedTrucks}</td>
                  <td className="r">{r.unregisteredTrucks}</td>
                  <td className="r">{r.cancelledTrucks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-sm text-muted">
        Tepat waktu = bagian volume jadwal yang diterima pada atau sebelum ETA, dibagi volume jadwal yang ETA-nya sudah lewat.
        Angka di bawah 90% terhadap ETA awal ditandai merah. File Excel berisi rincian per PO, jadwal, dan truk.
      </p>
    </div>
  );
}
