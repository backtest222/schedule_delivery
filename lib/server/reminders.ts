import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Pengingat H-3: email ke vendor untuk jadwal yang truknya belum lengkap
 * tiga hari (atau kurang) sebelum ETA. Daftar jadwalnya dihitung database
 * (fungsi due_reminders di 004_reminders.sql); di sini email disusun,
 * dikirim lewat Resend, lalu dicatat.
 */

export type DueRow = {
  schedule_id: string;
  po_id: string;
  po_number: string;
  vendor_id: string;
  vendor_name: string;
  product_name: string;
  eta: string;
  volume_kg: number;
  registered_kg: number;
  missing_kg: number;
  buyer_email: string | null;
};

export type VendorResult = {
  vendor: string;
  schedules: number;
  recipients: string[];
  status: "sent" | "failed" | "no_recipient" | "preview";
  error?: string;
};

const num = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 });
const dateFmt = new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const fmtDate = (d: string) => dateFmt.format(new Date(`${d}T00:00:00Z`));
const fmtVol = (kg: number) => (Math.abs(kg) >= 1000 ? `${num.format(kg / 1000)} ton` : `${num.format(kg)} kg`);

/** Semua teks dari database dimasukkan ke HTML email dalam bentuk aman. */
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

function todayWib(): string {
  return new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
}

function daysLeft(eta: string): number {
  return Math.round((Date.parse(`${eta}T00:00:00Z`) - Date.parse(`${todayWib()}T00:00:00Z`)) / 86_400_000);
}

const whenText = (eta: string) => {
  const d = daysLeft(eta);
  return d <= 0 ? "hari ini" : d === 1 ? "besok" : `${d} hari lagi`;
};

export function buildEmail(vendor: string, rows: DueRow[], siteUrl: string) {
  const first = rows[0];
  const subject =
    rows.length === 1
      ? `Pengingat: truk untuk PO ${first.po_number} (ETA ${fmtDate(first.eta)}) belum lengkap`
      : `Pengingat: ${rows.length} jadwal kirim dalam 3 hari belum lengkap truknya`;

  const link = (r: DueRow) => `${siteUrl.replace(/\/$/, "")}/po/${r.po_id}`;

  const tableRows = rows
    .map(
      (r) => `<tr>
  <td style="padding:10px 12px;border-bottom:1px solid #dcc9a8"><strong>${esc(r.po_number)}</strong><br><span style="color:#6e5944">${esc(r.product_name)}</span></td>
  <td style="padding:10px 12px;border-bottom:1px solid #dcc9a8">${esc(fmtDate(r.eta))}<br><span style="color:#a4271c;font-weight:600">${esc(whenText(r.eta))}</span></td>
  <td style="padding:10px 12px;border-bottom:1px solid #dcc9a8;text-align:right;white-space:nowrap">${esc(fmtVol(r.volume_kg))}</td>
  <td style="padding:10px 12px;border-bottom:1px solid #dcc9a8;text-align:right;white-space:nowrap">${esc(fmtVol(r.registered_kg))}</td>
  <td style="padding:10px 12px;border-bottom:1px solid #dcc9a8;text-align:right;white-space:nowrap;color:#a4271c;font-weight:700">${esc(fmtVol(r.missing_kg))}</td>
  <td style="padding:10px 12px;border-bottom:1px solid #dcc9a8"><a href="${esc(link(r))}" style="color:#7a4519;font-weight:700">Isi truk</a></td>
</tr>`,
    )
    .join("");

  const html = `<!doctype html><html lang="id"><body style="margin:0;background:#efe5d2;font-family:Georgia,'Times New Roman',serif;color:#2a1c12">
<div style="max-width:640px;margin:0 auto;padding:24px 16px">
  <div style="background:#3a2617;color:#f6ead3;border-radius:8px 8px 0 0;padding:16px 20px;font-size:20px;font-weight:700">Jadwal Pengiriman</div>
  <div style="background:#fffaf1;border:1px solid #dcc9a8;border-top:0;border-radius:0 0 8px 8px;padding:20px">
    <p style="margin:0 0 12px">Yth. ${esc(vendor)},</p>
    <p style="margin:0 0 16px">Jadwal kirim berikut tinggal tiga hari atau kurang, tetapi truk yang didaftarkan belum memenuhi volume yang diminta. Mohon daftarkan nomor polisi, berat netto, dan jadwal berangkat truk di website.</p>
    <div style="overflow-x:auto">
    <table style="width:100%;border-collapse:collapse;font-size:14px;font-family:Arial,sans-serif">
      <thead><tr style="text-align:left;color:#6e5944;font-size:12px">
        <th style="padding:8px 12px;border-bottom:2px solid #dcc9a8">PO dan produk</th>
        <th style="padding:8px 12px;border-bottom:2px solid #dcc9a8">ETA</th>
        <th style="padding:8px 12px;border-bottom:2px solid #dcc9a8;text-align:right">Diminta</th>
        <th style="padding:8px 12px;border-bottom:2px solid #dcc9a8;text-align:right">Sudah didaftarkan</th>
        <th style="padding:8px 12px;border-bottom:2px solid #dcc9a8;text-align:right">Kurang</th>
        <th style="padding:8px 12px;border-bottom:2px solid #dcc9a8"></th>
      </tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
    </div>
    <p style="margin:20px 0 0"><a href="${esc(siteUrl)}" style="display:inline-block;background:#7a4519;color:#fff8ec;text-decoration:none;font-weight:700;padding:10px 18px;border-radius:6px">Buka Jadwal Pengiriman</a></p>
    <p style="margin:20px 0 0;font-size:13px;color:#6e5944">Bila tanggal tidak bisa dipenuhi, ajukan usul tanggal baru di halaman PO. Email ini dikirim otomatis; balas email ini untuk menghubungi purchasing.</p>
  </div>
</div></body></html>`;

  const text = [
    `Yth. ${vendor},`,
    "",
    "Jadwal kirim berikut tinggal tiga hari atau kurang, tetapi truk yang didaftarkan belum memenuhi volume yang diminta:",
    "",
    ...rows.map(
      (r) =>
        `- PO ${r.po_number} (${r.product_name}), ETA ${fmtDate(r.eta)} (${whenText(r.eta)}): diminta ${fmtVol(r.volume_kg)}, sudah didaftarkan ${fmtVol(r.registered_kg)}, kurang ${fmtVol(r.missing_kg)}. ${link(r)}`,
    ),
    "",
    "Mohon daftarkan nomor polisi, berat netto, dan jadwal berangkat truk di website.",
    "Bila tanggal tidak bisa dipenuhi, ajukan usul tanggal baru di halaman PO.",
    "Email ini dikirim otomatis; balas email ini untuk menghubungi purchasing.",
  ].join("\n");

  return { subject, html, text };
}

async function sendEmail(msg: { to: string[]; replyTo: string[]; subject: string; html: string; text: string }) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) throw new Error("RESEND_API_KEY atau EMAIL_FROM belum diisi di server.");
  const res = await fetch(process.env.RESEND_API_URL ?? "https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      from,
      to: msg.to,
      reply_to: msg.replyTo.length > 0 ? msg.replyTo : undefined,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(`Resend menolak (${res.status}): ${body.message ?? "tanpa keterangan"}`);
  }
}

/** Mencatat hasil per jadwal. Percobaan ulang menaikkan hitungan, bukan menambah baris. */
async function record(admin: SupabaseClient, rows: DueRow[], status: VendorResult["status"], recipients: string[], error?: string) {
  const firstTry: DueRow[] = [];
  for (const r of rows) {
    const { data: existing } = await admin
      .from("schedule_reminders")
      .select("id, attempts")
      .eq("schedule_id", r.schedule_id)
      .eq("eta", r.eta)
      .maybeSingle();
    const row = { status, recipients, missing_kg: r.missing_kg, error: error ?? null, last_try_at: new Date().toISOString() };
    if (existing) {
      await admin.from("schedule_reminders").update({ ...row, attempts: (existing.attempts as number) + 1 }).eq("id", existing.id);
    } else {
      await admin.from("schedule_reminders").insert({ schedule_id: r.schedule_id, eta: r.eta, ...row });
      firstTry.push(r);
    }
  }
  // Aktivitas: setiap pengingat terkirim, dan masalah pengiriman hanya pada percobaan pertama.
  const forActivity = status === "sent" ? rows : firstTry;
  if (forActivity.length === 0) return;
  await admin.from("activity").insert(
    forActivity.map((r) => ({
      kind: status === "sent" ? "reminder_sent" : status === "no_recipient" ? "reminder_no_recipient" : "reminder_failed",
      po_id: r.po_id,
      vendor_id: r.vendor_id,
      data: { po_number: r.po_number, eta: r.eta, missing_kg: r.missing_kg, recipients: recipients.length, error: error ?? null },
      for_vendor: status === "sent",
      for_purchasing: true,
      for_qc: false,
      actor: null,
    })),
  );
}

/**
 * Menjalankan pengingat hari ini. Dengan preview: true hanya menghitung siapa
 * yang akan dikirimi, tanpa mengirim dan tanpa mencatat.
 */
export async function runReminders(admin: SupabaseClient, opts: { preview?: boolean } = {}) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const { data, error } = await admin.rpc("due_reminders");
  if (error) throw new Error(`Daftar pengingat gagal dibaca: ${error.message}`);
  const due = (data ?? []) as DueRow[];

  const byVendor = new Map<string, DueRow[]>();
  for (const r of due) byVendor.set(r.vendor_id, [...(byVendor.get(r.vendor_id) ?? []), r]);

  const results: VendorResult[] = [];
  for (const [vendorId, rows] of byVendor) {
    const vendor = rows[0].vendor_name;
    const { data: accounts } = await admin.from("profiles").select("email").eq("role", "vendor").eq("vendor_id", vendorId).eq("active", true);
    const recipients = [...new Set((accounts ?? []).map((a) => String(a.email).toLowerCase()))];
    const replyTo = [...new Set(rows.map((r) => r.buyer_email).filter((e): e is string => Boolean(e)))];

    if (opts.preview) {
      results.push({ vendor, schedules: rows.length, recipients, status: "preview" });
      continue;
    }
    if (recipients.length === 0) {
      await record(admin, rows, "no_recipient", []);
      results.push({ vendor, schedules: rows.length, recipients, status: "no_recipient" });
      continue;
    }
    try {
      await sendEmail({ to: recipients, replyTo, ...buildEmail(vendor, rows, siteUrl) });
      await record(admin, rows, "sent", recipients);
      results.push({ vendor, schedules: rows.length, recipients, status: "sent" });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await record(admin, rows, "failed", recipients, message);
      results.push({ vendor, schedules: rows.length, recipients, status: "failed", error: message });
    }
  }
  return { today: todayWib(), schedules: due.length, results };
}
