"use client";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { useAuth } from "@/components/Shell";
import { Empty, ErrorNote, Loading, Pill, useLoad } from "@/components/ui";
import { describeActivity } from "@/lib/activity";
import { loadActivity } from "@/lib/data";
import { fmtDateTime } from "@/lib/format";

export default function ActivityPage() {
  const { profile, markSeen } = useAuth();
  const { data, error, loading } = useLoad(() => loadActivity(150), []);
  // Batas "baru" diambil sekali saat halaman dibuka, sebelum ditandai sudah dilihat.
  const seenAt = useRef(profile.activity_seen_at);
  const marked = useRef(false);

  useEffect(() => {
    if (data && !marked.current) {
      marked.current = true;
      void markSeen();
    }
  }, [data, markSeen]);

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-xl font-extrabold tracking-tight">Aktivitas</h1>
        <p className="text-sm text-muted">
          Kejadian yang perlu Anda ketahui. Website ini belum mengirim email atau WhatsApp, jadi halaman ini adalah tempat
          memeriksanya.
        </p>
      </div>
      <ErrorNote error={error} />
      {loading ? (
        <Loading />
      ) : !data || data.length === 0 ? (
        <Empty title="Belum ada aktivitas">Jadwal baru, pendaftaran truk, usulan tanggal, dan hasil penerimaan akan tercatat di sini.</Empty>
      ) : (
        <ul className="card">
          {data.map((a) => {
            const { text, tone } = describeActivity(a);
            const fresh = a.created_at > seenAt.current && a.actor !== profile.id;
            return (
              <li key={a.id} className="border-b border-line last:border-b-0">
                <Link href={`/po/${a.po_id}`} className="grid gap-1 px-4 py-3 hover:bg-hover">
                  <span className="flex flex-wrap items-center gap-2 text-xs text-muted">
                    <span className="po-no text-ink">{String(a.data.po_number ?? "")}</span>
                    {fmtDateTime(a.created_at)}
                    {fresh ? <Pill tone="danger">Baru</Pill> : null}
                    {a.actor === profile.id ? <Pill>Oleh Anda</Pill> : null}
                  </span>
                  <span className={`text-sm ${tone === "danger" ? "text-danger" : ""}`}>{text}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
