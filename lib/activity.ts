import { fmtDate, fmtDateTime, fmtKg, fmtNum, fmtVolume } from "./format";
import { REJECT_REASONS, type Activity } from "./types";

export type Tone = "info" | "ok" | "warn" | "danger";

const str = (v: unknown) => (typeof v === "string" ? v : "");
const numOf = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0));

/** Kalimat untuk satu baris aktivitas. */
export function describeActivity(a: Activity): { text: string; tone: Tone } {
  const d = a.data;
  const plate = str(d.plate);
  switch (a.kind) {
    case "schedule_new":
      return { text: `Jadwal baru: ETA ${fmtDate(str(d.eta))}, ${fmtVolume(numOf(d.volume_kg))}.`, tone: "info" };
    case "schedule_changed": {
      const parts: string[] = [];
      if (d.eta !== d.old_eta) parts.push(`ETA ${fmtDate(str(d.old_eta))} menjadi ${fmtDate(str(d.eta))}`);
      if (numOf(d.volume_kg) !== numOf(d.old_volume_kg)) {
        parts.push(`volume ${fmtVolume(numOf(d.old_volume_kg))} menjadi ${fmtVolume(numOf(d.volume_kg))}`);
      }
      return { text: `Jadwal diubah: ${parts.join(", ")}.`, tone: "warn" };
    }
    case "schedule_deleted":
      return { text: `Jadwal ETA ${fmtDate(str(d.eta))} (${fmtVolume(numOf(d.volume_kg))}) dihapus.`, tone: "warn" };
    case "proposal_new":
      return {
        text: `Vendor mengusulkan ETA ${fmtDate(str(d.proposed_eta))} (semula ${fmtDate(str(d.eta))}). Alasan: ${str(d.reason)}`,
        tone: "warn",
      };
    case "proposal_decided": {
      const ok = d.status === "approved";
      const note = str(d.note) ? ` Catatan: ${str(d.note)}` : "";
      return {
        text: `Usulan ETA ${fmtDate(str(d.proposed_eta))} ${ok ? "disetujui" : "ditolak"}.${note}`,
        tone: ok ? "ok" : "danger",
      };
    }
    case "truck_registered":
      return {
        text: `Truk ${plate} didaftarkan: ${fmtKg(numOf(d.vendor_net_kg))}, berangkat ${fmtDateTime(str(d.departure_at))}.`,
        tone: "info",
      };
    case "truck_unregistered":
      return { text: `Truk ${plate} datang tanpa didaftarkan vendor. QC mencatatnya langsung.`, tone: "warn" };
    case "truck_cancelled":
      return { text: `Truk ${plate} dibatalkan. Alasan: ${str(d.reason)}`, tone: "warn" };
    case "truck_changed":
      return {
        text: `Data truk ${plate} diubah: ${fmtKg(numOf(d.vendor_net_kg))}, berangkat ${fmtDateTime(str(d.departure_at))}.`,
        tone: "info",
      };
    case "receipt":
    case "receipt_changed": {
      const rejected = numOf(d.rejected_kg);
      const flagged = d.flagged === true;
      let text =
        a.kind === "receipt"
          ? `Truk ${plate} diterima, netto pabrik ${fmtKg(numOf(d.factory_net_kg))}.`
          : `Penerimaan truk ${plate} dikoreksi, netto pabrik ${fmtKg(numOf(d.factory_net_kg))}.`;
      if (rejected > 0) {
        text += ` Ditolak ${fmtKg(rejected)} (${REJECT_REASONS[str(d.reason)] ?? str(d.reason)}).`;
      }
      if (flagged) text += ` Selisih berat ${fmtNum(numOf(d.diff_pct))}% melewati batas.`;
      return { text, tone: rejected > 0 ? "danger" : flagged ? "warn" : "ok" };
    }
    case "reminder_sent":
      return {
        text: `Pengingat email H-3 dikirim ke ${numOf(d.recipients)} akun vendor: jadwal ETA ${fmtDate(str(d.eta))} masih kurang ${fmtVolume(numOf(d.missing_kg))} truk.`,
        tone: "warn",
      };
    case "reminder_no_recipient":
      return {
        text: `Pengingat email H-3 untuk ETA ${fmtDate(str(d.eta))} tidak terkirim: vendor belum punya akun aktif. Buat akun vendor di halaman Kelola.`,
        tone: "danger",
      };
    case "reminder_failed":
      return { text: `Pengingat email H-3 untuk ETA ${fmtDate(str(d.eta))} gagal dikirim: ${str(d.error)}`, tone: "danger" };
    case "po_closed":
      return { text: "PO ditutup. Truk baru tidak bisa didaftarkan.", tone: "info" };
    case "po_reopened":
      return { text: "PO dibuka kembali.", tone: "info" };
    default:
      return { text: a.kind, tone: "info" };
  }
}
