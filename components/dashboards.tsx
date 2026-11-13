"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { isOverdue, nextSchedule, poTotals, scheduleTotals, weightDiff } from "@/lib/calc";
import { loadPO, loadPOs, loadProducts, loadVendors } from "@/lib/data";
import { fmtDate, fmtDateTime, fmtKg, fmtNum, fmtVolume, todayStr } from "@/lib/format";
import type { Tone } from "@/lib/activity";
import type { PO, Truck } from "@/lib/types";
import { POForm, ReceiptForm, TruckForm } from "./forms";
import { useAuth } from "./Shell";
import { Empty, ErrorNote, Loading, Modal, Pill, Plate, ProgressBar, useLoad } from "./ui";

type Attention = { key: string; tone: Tone; text: string; href: string };

const TONE_ORDER: Record<Tone, number> = { danger: 0, warn: 1, info: 2, ok: 3 };

/** Tanggal YYYY-MM-DD sekian hari sebelum atau sesudah hari ini. */
function shiftDay(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return todayStr(d);
}

const matches = (po: PO, q: string) =>
  `${po.po_number} ${po.vendor.name} ${po.product.name}`.toLowerCase().includes(q.trim().toLowerCase());

function AttentionList({ items }: { items: Attention[] }) {
  const [all, setAll] = useState(false);
  const sorted = [...items].sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone]);
  const shown = all ? sorted : sorted.slice(0, 6);
  return (
    <section aria-labelledby="attention-title" className="card">
      <h2 id="attention-title" className="flex items-center gap-2 px-4 pt-3 text-base font-bold">
        Perlu perhatian
        {items.length > 0 ? <Pill tone="danger">{items.length}</Pill> : null}
      </h2>
      {items.length === 0 ? (
        <p className="px-4 pt-1 pb-4 text-sm text-muted">Tidak ada yang perlu ditindaklanjuti saat ini.</p>
      ) : (
        <ul className="mt-2">
          {shown.map((a) => (
            <li key={a.key} className="border-t border-line">
              <Link href={a.href} className="flex items-start gap-2 px-4 py-2.5 text-sm hover:bg-bg">
                <span
                  aria-hidden="true"
                  className={`mt-1.5 size-2 shrink-0 rounded-full ${
                    a.tone === "danger" ? "bg-danger" : a.tone === "warn" ? "bg-warn" : "bg-brand"
                  }`}
                />
                <span>{a.text}</span>
              </Link>
            </li>
          ))}
          {sorted.length > 6 ? (
            <li className="border-t border-line px-4 py-2">
              <button type="button" className="btn-link text-sm" onClick={() => setAll((v) => !v)}>
                {all ? "Tampilkan lebih sedikit" : `Tampilkan semua (${sorted.length})`}
              </button>
            </li>
          ) : null}
        </ul>
      )}
    </section>
  );
}

function PoCard({ po, today }: { po: PO; today: string }) {
  const t = poTotals(po);
  const next = nextSchedule(po, today);
  const pending = po.schedules.some((s) => s.proposals.some((p) => p.status === "pending"));
  const late = po.status === "open" && po.schedules.some((s) => s.eta_current < today && scheduleTotals(s).acceptedKg < s.volume_kg);
  return (
    <li>
      <Link href={`/po/${po.id}`} className="card grid gap-2 p-4 hover:border-muted">
        <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
          <div className="mr-auto min-w-0">
            <p className="mono font-semibold break-words">{po.po_number}</p>
            <p className="text-sm text-muted">
              {po.vendor.name} · {po.product.name}
            </p>
          </div>
          {po.status === "closed" ? <Pill>Ditutup</Pill> : null}
          {pending ? <Pill tone="warn">Usulan menunggu</Pill> : null}
          {late ? <Pill tone="danger">Lewat ETA</Pill> : null}
          {t.overPlanned ? <Pill tone="warn">Melebihi volume</Pill> : null}
        </div>
        <ProgressBar doneKg={t.acceptedKg} plannedKg={t.plannedKg} totalKg={po.volume_kg} />
        <p className="text-sm">
          <span className="num font-semibold">{fmtVolume(t.acceptedKg)}</span> diterima dari{" "}
          <span className="num">{fmtVolume(po.volume_kg)}</span>
          {t.plannedKg > 0 ? (
            <>
              {" "}
              · <span className="num">{fmtVolume(t.plannedKg)}</span> dalam rencana
            </>
          ) : null}
          {next ? ` · ETA berikutnya ${fmtDate(next.eta_current)}` : " · belum ada jadwal"}
        </p>
      </Link>
    </li>
  );
}

function PoList({
  pos,
  today,
  showClosed,
  setShowClosed,
  emptyHint,
}: {
  pos: PO[];
  today: string;
  showClosed: boolean;
  setShowClosed: (v: boolean) => void;
  emptyHint: string;
}) {
  const [q, setQ] = useState("");
  const shown = pos.filter((po) => matches(po, q));
  return (
    <section className="grid gap-3" aria-labelledby="po-list-title">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="po-list-title" className="mr-auto text-base font-bold">
          Daftar PO
        </h2>
        <label className="flex items-center gap-2 text-sm">
          <input id="show-closed" type="checkbox" className="size-4" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
          Tampilkan PO yang ditutup
        </label>
      </div>
      <input
        id="po-search"
        className="input"
        type="search"
        aria-label="Cari PO"
        placeholder="Cari nomor PO, vendor, atau produk"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {shown.length === 0 ? (
        <Empty title={pos.length === 0 ? "Belum ada PO" : "Tidak ada PO yang cocok"}>{pos.length === 0 ? emptyHint : "Coba kata pencarian lain."}</Empty>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {shown.map((po) => (
            <PoCard key={po.id} po={po} today={today} />
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------- Purchasing ----------------------------
export function BuyerDashboard() {
  const router = useRouter();
  const [showClosed, setShowClosed] = useState(false);
  const [creating, setCreating] = useState(false);
  const { data: pos, error, loading } = useLoad(() => loadPOs(showClosed ? undefined : "open"), [showClosed]);
  const master = useLoad(async () => ({ vendors: await loadVendors(), products: await loadProducts() }), []);
  const today = todayStr();

  const attention = useMemo(() => {
    const items: Attention[] = [];
    const recent = shiftDay(-14);
    const now = new Date();
    for (const po of pos ?? []) {
      if (po.status !== "open") continue;
      const href = `/po/${po.id}`;
      if (poTotals(po).overPlanned) {
        items.push({ key: `over-${po.id}`, tone: "warn", href, text: `${po.po_number}: diterima dan rencana truk melebihi volume PO.` });
      }
      for (const s of po.schedules) {
        const pending = s.proposals.find((p) => p.status === "pending");
        if (pending) {
          items.push({
            key: `prop-${pending.id}`,
            tone: "warn",
            href,
            text: `${po.po_number}: ${po.vendor.name} mengusulkan ETA ${fmtDate(pending.proposed_eta)} (sekarang ${fmtDate(s.eta_current)}).`,
          });
        }
        const st = scheduleTotals(s);
        if (s.eta_current < today && st.acceptedKg < s.volume_kg) {
          items.push({
            key: `late-${s.id}`,
            tone: "danger",
            href,
            text: `${po.po_number}: jadwal ETA ${fmtDate(s.eta_current)} sudah lewat, masih kurang ${fmtVolume(s.volume_kg - st.acceptedKg)}.`,
          });
        }
        for (const t of s.trucks) {
          if (isOverdue(t, now)) {
            items.push({
              key: `od-${t.id}`,
              tone: "danger",
              href,
              text: `${po.po_number}: truk ${t.plate_number} belum tiba sejak berangkat ${fmtDateTime(t.departure_at)}.`,
            });
          }
          const r = t.receipt;
          if (!r || r.arrived_at < recent) continue;
          if (r.rejected_kg > 0) {
            items.push({ key: `rej-${t.id}`, tone: "danger", href, text: `${po.po_number}: truk ${t.plate_number} ditolak ${fmtKg(r.rejected_kg)}.` });
          }
          const d = weightDiff(t.vendor_net_kg, r.factory_net_kg, po.product.tolerance_pct);
          if (d.flagged) {
            items.push({
              key: `diff-${t.id}`,
              tone: "danger",
              href,
              text: `${po.po_number}: selisih berat truk ${t.plate_number} ${fmtNum(d.diffPct)}% melewati batas ${fmtNum(po.product.tolerance_pct)}%.`,
            });
          }
          if (t.registered_by_qc) {
            items.push({ key: `unreg-${t.id}`, tone: "warn", href, text: `${po.po_number}: truk ${t.plate_number} datang tanpa didaftarkan vendor.` });
          }
        }
      }
    }
    return items;
  }, [pos, today]);

  const noMaster = master.data && (master.data.vendors.length === 0 || master.data.products.length === 0);

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-xl font-extrabold tracking-tight">Beranda purchasing</h1>
        <button type="button" className="btn btn-primary" onClick={() => setCreating(true)} disabled={!master.data || Boolean(noMaster)}>
          Buat PO
        </button>
      </div>
      {noMaster ? (
        <p className="note note-info">
          Sebelum membuat PO, isi dulu daftar vendor dan produk di halaman{" "}
          <Link href="/kelola" className="btn-link">
            Kelola
          </Link>
          .
        </p>
      ) : null}
      <ErrorNote error={error ?? master.error} />
      {loading && !pos ? (
        <Loading />
      ) : (
        <>
          <AttentionList items={attention} />
          <PoList
            pos={pos ?? []}
            today={today}
            showClosed={showClosed}
            setShowClosed={setShowClosed}
            emptyHint="Buat PO pertama, lalu tambahkan jadwal ETA dan volumenya."
          />
        </>
      )}
      {creating && master.data ? (
        <POForm
          vendors={master.data.vendors}
          products={master.data.products}
          onClose={() => setCreating(false)}
          onDone={(id) => router.push(`/po/${id}`)}
        />
      ) : null}
    </div>
  );
}

// ------------------------------ Vendor ------------------------------
export function VendorDashboard() {
  const [showClosed, setShowClosed] = useState(false);
  const { data: pos, error, loading } = useLoad(() => loadPOs(showClosed ? undefined : "open"), [showClosed]);
  const today = todayStr();

  const attention = useMemo(() => {
    const items: Attention[] = [];
    const soon = shiftDay(7);
    const recent = shiftDay(-14);
    for (const po of pos ?? []) {
      if (po.status !== "open") continue;
      const href = `/po/${po.id}`;
      for (const s of po.schedules) {
        const st = scheduleTotals(s);
        const missing = s.volume_kg - st.acceptedKg - st.plannedKg;
        if (missing > 0 && s.eta_current <= soon) {
          items.push({
            key: `need-${s.id}`,
            tone: s.eta_current < today ? "danger" : "warn",
            href,
            text: `${po.po_number}: jadwal ETA ${fmtDate(s.eta_current)} masih kurang ${fmtVolume(missing)} yang belum didaftarkan truknya.`,
          });
        }
        for (const t of s.trucks) {
          const r = t.receipt;
          if (r && r.arrived_at >= recent && r.rejected_kg > 0) {
            items.push({ key: `rej-${t.id}`, tone: "danger", href, text: `${po.po_number}: truk ${t.plate_number} ditolak ${fmtKg(r.rejected_kg)}.` });
          }
        }
      }
    }
    return items;
  }, [pos, today]);

  return (
    <div className="grid gap-5">
      <h1 className="text-xl font-extrabold tracking-tight">PO Anda</h1>
      <ErrorNote error={error} />
      {loading && !pos ? (
        <Loading />
      ) : (
        <>
          <AttentionList items={attention} />
          <PoList
            pos={pos ?? []}
            today={today}
            showClosed={showClosed}
            setShowClosed={setShowClosed}
            emptyHint="PO akan muncul di sini setelah purchasing membuatnya untuk perusahaan Anda."
          />
        </>
      )}
    </div>
  );
}

// -------------------------------- QC --------------------------------
type QcModal =
  | { t: "pickPo" }
  | { t: "truck"; po: PO }
  | { t: "receipt"; po: PO; truck: Truck }
  | null;

export function QcDashboard() {
  const { refreshUnread } = useAuth();
  const { data: pos, error, loading, reload } = useLoad(() => loadPOs(), []);
  const [modal, setModal] = useState<QcModal>(null);
  const [q, setQ] = useState("");
  const [pickQ, setPickQ] = useState("");
  const now = new Date();

  const rows = useMemo(() => (pos ?? []).flatMap((po) => po.schedules.flatMap((s) => s.trucks.map((truck) => ({ po, truck })))), [pos]);
  const find = (r: { po: PO; truck: Truck }) =>
    `${r.truck.plate_number} ${r.po.po_number} ${r.po.vendor.name} ${r.po.product.name}`.toLowerCase().includes(q.trim().toLowerCase());
  const incoming = rows.filter((r) => r.truck.status === "planned" && find(r)).sort((a, b) => a.truck.departure_at.localeCompare(b.truck.departure_at));
  const received = rows
    .filter((r) => r.truck.status === "received" && r.truck.receipt && find(r))
    .sort((a, b) => (b.truck.receipt?.created_at ?? "").localeCompare(a.truck.receipt?.created_at ?? ""))
    .slice(0, 15);

  const done = () => {
    setModal(null);
    void reload();
    refreshUnread();
  };

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-xl font-extrabold tracking-tight">Penerimaan QC</h1>
        <button type="button" className="btn" onClick={() => setModal({ t: "pickPo" })}>
          Catat truk tak terdaftar
        </button>
      </div>
      <input
        id="qc-search"
        className="input"
        type="search"
        aria-label="Cari truk"
        placeholder="Cari nopol, nomor PO, vendor, atau produk"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <ErrorNote error={error} />
      {loading && !pos ? (
        <Loading />
      ) : (
        <>
          <section className="grid gap-3" aria-labelledby="incoming-title">
            <h2 id="incoming-title" className="flex items-center gap-2 text-base font-bold">
              Truk yang akan datang <Pill tone="info">{incoming.length}</Pill>
            </h2>
            {incoming.length === 0 ? (
              <Empty title="Tidak ada truk dalam perjalanan">
                Truk muncul di sini setelah vendor mendaftarkannya. Bila ada truk datang tanpa terdaftar, pakai tombol Catat truk tak terdaftar.
              </Empty>
            ) : (
              <ul className="grid gap-3 md:grid-cols-2">
                {incoming.map(({ po, truck }) => (
                  <li key={truck.id} className="card grid gap-2 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Plate>{truck.plate_number}</Plate>
                      {truck.registered_by_qc ? <Pill tone="warn">Tak terdaftar</Pill> : null}
                      {isOverdue(truck, now) ? <Pill tone="danger">Terlambat</Pill> : null}
                    </div>
                    <p className="text-sm">
                      {po.vendor.name} · {po.product.name}
                      <br />
                      <span className="text-muted">
                        PO <span className="mono">{po.po_number}</span> · berangkat {fmtDateTime(truck.departure_at)}
                      </span>
                    </p>
                    <p className="text-sm">
                      Netto vendor <strong className="num">{fmtKg(truck.vendor_net_kg)}</strong>
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className="btn btn-primary" onClick={() => setModal({ t: "receipt", po, truck })}>
                        Catat penerimaan
                      </button>
                      <Link href={`/po/${po.id}`} className="btn">
                        Lihat PO
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="grid gap-3" aria-labelledby="received-title">
            <h2 id="received-title" className="text-base font-bold">
              Penerimaan terakhir
            </h2>
            {received.length === 0 ? (
              <p className="text-sm text-muted">Belum ada penerimaan.</p>
            ) : (
              <div className="card overflow-x-auto">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Nopol</th>
                      <th>Vendor dan produk</th>
                      <th>Masuk</th>
                      <th className="r">Netto pabrik</th>
                      <th className="r">Selisih</th>
                      <th className="r">Ditolak</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {received.map(({ po, truck }) => {
                      const r = truck.receipt;
                      if (!r) return null;
                      const d = weightDiff(truck.vendor_net_kg, r.factory_net_kg, po.product.tolerance_pct);
                      return (
                        <tr key={truck.id}>
                          <td>
                            <Plate>{truck.plate_number}</Plate>
                          </td>
                          <td>
                            {po.vendor.name}
                            <br />
                            <span className="text-muted">{po.product.name}</span>
                          </td>
                          <td className="whitespace-nowrap">{fmtDate(r.arrived_at)}</td>
                          <td className="r">{fmtKg(r.factory_net_kg)}</td>
                          <td className={`r ${d.flagged ? "font-semibold text-danger" : ""}`}>{fmtNum(d.diffPct)}%</td>
                          <td className={`r ${r.rejected_kg > 0 ? "font-semibold text-danger" : ""}`}>{fmtKg(r.rejected_kg)}</td>
                          <td>
                            <button type="button" className="btn btn-sm" onClick={() => setModal({ t: "receipt", po, truck })}>
                              Koreksi
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {modal?.t === "pickPo" ? (
        <Modal title="Truk ini untuk PO yang mana?" onClose={() => setModal(null)}>
          <div className="grid gap-3">
            <input
              id="pick-po-search"
              className="input"
              type="search"
              aria-label="Cari PO"
              placeholder="Cari nomor PO, vendor, atau produk"
              value={pickQ}
              onChange={(e) => setPickQ(e.target.value)}
            />
            <ul className="grid gap-2">
              {(pos ?? [])
                .filter((po) => po.status === "open" && po.schedules.length > 0 && matches(po, pickQ))
                .map((po) => (
                  <li key={po.id}>
                    <button type="button" className="card w-full p-3 text-left hover:border-muted" onClick={() => setModal({ t: "truck", po })}>
                      <span className="mono font-semibold">{po.po_number}</span>
                      <br />
                      <span className="text-sm text-muted">
                        {po.vendor.name} · {po.product.name}
                      </span>
                    </button>
                  </li>
                ))}
            </ul>
            <p className="text-sm text-muted">Hanya PO yang masih buka dan sudah punya jadwal yang tampil di sini.</p>
          </div>
        </Modal>
      ) : null}
      {modal?.t === "truck" ? (
        <TruckForm
          po={modal.po}
          unregistered
          onClose={() => setModal(null)}
          onDone={(truckId) => {
            // Setelah truk tercatat, langsung lanjut ke pencatatan penerimaannya.
            void loadPO(modal.po.id).then((fresh) => {
              const truck = fresh?.schedules.flatMap((s) => s.trucks).find((t) => t.id === truckId);
              void reload();
              setModal(fresh && truck ? { t: "receipt", po: fresh, truck } : null);
            });
          }}
        />
      ) : null}
      {modal?.t === "receipt" ? <ReceiptForm po={modal.po} truck={modal.truck} onClose={() => setModal(null)} onDone={done} /> : null}
    </div>
  );
}
