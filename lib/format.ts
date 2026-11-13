const num = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 });
const ton = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 3 });
const dateFmt = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("id-ID", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export const fmtNum = (n: number) => num.format(n);
export const fmtKg = (n: number) => `${num.format(n)} kg`;
export const fmtTon = (kg: number) => `${ton.format(kg / 1000)} ton`;
/** Volume besar ditulis dalam ton, kecil dalam kg. */
export const fmtVolume = (kg: number) => (Math.abs(kg) >= 1000 ? fmtTon(kg) : fmtKg(kg));
export const fmtPct = (n: number | null) => (n === null ? "-" : `${num.format(n)}%`);

/** "2026-12-01" -> "1 Des 2026" tanpa bergeser karena zona waktu. */
export function fmtDate(d: string | null | undefined) {
  if (!d) return "-";
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  return dateFmt.format(new Date(y, m - 1, day));
}

export function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return "-";
  return dateTimeFmt.format(new Date(iso));
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Tanggal hari ini menurut jam perangkat, format YYYY-MM-DD. */
export function todayStr(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** ISO -> nilai untuk <input type="datetime-local"> menurut jam perangkat. */
export function toLocalInput(iso: string | Date) {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Selisih hari antara dua tanggal YYYY-MM-DD (b - a). */
export function daysBetween(a: string, b: string) {
  const p = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((p(b) - p(a)) / 86_400_000);
}

/** Angka dari kolom isian: menerima "25.300", "25300", "25,5". */
export function parseNumber(text: string): number {
  const cleaned = text.trim().replace(/\s/g, "");
  if (!cleaned) return NaN;
  // Format Indonesia: titik = ribuan, koma = desimal.
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(cleaned)) return Number(cleaned.replace(/\./g, "").replace(",", "."));
  return Number(cleaned.replace(",", "."));
}
