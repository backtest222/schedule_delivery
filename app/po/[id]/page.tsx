"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { canReceive, isBuyer, isInternal, useAuth } from "@/components/Shell";
import { POForm, ProposalForm, ReasonForm, ReceiptForm, ScheduleForm, TruckForm } from "@/components/forms";
import { Empty, ErrorNote, Loading, Modal, Pill, Plate, ProgressBar, useAction, useLoad } from "@/components/ui";
import { acceptedKg, isOverdue, OVERDUE_DAYS, poTotals, scheduleTotals, weightDiff } from "@/lib/calc";
import { loadAudit, loadPO, loadProducts, loadProfiles, loadVendors } from "@/lib/data";
import { daysBetween, fmtDate, fmtDateTime, fmtKg, fmtNum, fmtVolume, todayStr } from "@/lib/format";
import { photoUrls } from "@/lib/photos";
import { db } from "@/lib/supabase";
import { REJECT_REASONS, type AuditEntry, type PO, type Proposal, type Reminder, type Schedule, type Truck } from "@/lib/types";

type ModalState =
  | { t: "editPo" }
  | { t: "schedule"; schedule?: Schedule }
  | { t: "proposal"; schedule: Schedule }
  | { t: "truck"; scheduleId?: string; truck?: Truck; unregistered?: boolean }
  | { t: "receipt"; truck: Truck }
  | { t: "cancelTruck"; truck: Truck }
  | { t: "decide"; proposal: Proposal; approve: boolean }
  | { t: "photos"; truck: Truck }
  | null;

export default function PoPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { profile, refreshUnread } = useAuth();
  const { data: po, error, loading, reload } = useLoad(() => loadPO(id), [id]);
  const [modal, setModal] = useState<ModalState>(null);
  const action = useAction();

  const buyer = isBuyer(profile);
  const vendor = profile.role === "vendor";
  const receiver = canReceive(profile);
  const today = todayStr();

  if (loading) return <Loading />;
  if (error) return <ErrorNote error={error} />;
  if (!po) {
    return (
      <Empty title="PO tidak ditemukan">
        PO ini tidak ada, atau akun Anda tidak punya akses ke PO ini. <Link href="/" className="btn-link">Kembali ke Beranda</Link>
      </Empty>
    );
  }

  const totals = poTotals(po);
  const open = po.status === "open";
  const truckCount = po.schedules.reduce((n, s) => n + s.trucks.length, 0);
  const plannedCount = po.schedules.reduce((n, s) => n + s.trucks.filter((t) => t.status === "planned").length, 0);

  const done = () => {
    setModal(null);
    void reload();
    refreshUnread();
  };

  /** Menjalankan perubahan langsung (tanpa formulir) lalu memuat ulang. */
  const act = (fn: () => Promise<void>) =>
    void action.run(async () => {
      await fn();
      await reload();
    });

  const setPoStatus = (status: "open" | "closed") => {
    if (status === "closed") {
      const extra = plannedCount > 0 ? ` Masih ada ${plannedCount} truk dalam rencana; truk itu tetap bisa diterima QC.` : "";
      if (!window.confirm(`Tutup PO ${po.po_number}? Vendor tidak bisa lagi mendaftarkan truk baru.${extra}`)) return;
    }
    act(async () => {
      const { error: err } = await db().from("purchase_orders").update({ status }).eq("id", po.id);
      if (err) throw err;
    });
  };

  const deletePo = () => {
    if (!window.confirm(`Hapus PO ${po.po_number} beserta semua jadwalnya? Tindakan ini tidak bisa dibatalkan.`)) return;
    void action.run(async () => {
      const { error: err } = await db().from("purchase_orders").delete().eq("id", po.id);
      if (err) throw err;
      router.replace("/");
    });
  };

  const deleteSchedule = (s: Schedule) => {
    if (!window.confirm(`Hapus jadwal ETA ${fmtDate(s.eta_current)}?`)) return;
    act(async () => {
      const { error: err } = await db().from("schedules").delete().eq("id", s.id);
      if (err) throw err;
    });
  };

  const withdrawProposal = (p: Proposal) =>
    act(async () => {
      const { error: err } = await db().from("schedule_proposals").delete().eq("id", p.id);
      if (err) throw err;
    });

  const reviveTruck = (t: Truck) =>
    act(async () => {
      const { error: err } = await db().from("trucks").update({ status: "planned" }).eq("id", t.id);
      if (err) throw err;
    });

  const deleteReceipt = (t: Truck) => {
    if (!window.confirm(`Hapus catatan penerimaan truk ${t.plate_number}? Truk kembali berstatus dalam rencana.`)) return;
    act(async () => {
      const { error: err } = await db().from("receipts").delete().eq("truck_id", t.id);
      if (err) throw err;
    });
  };

  return (
    <div className="grid gap-5">
      <div>
        <Link href="/" className="text-sm font-semibold text-muted hover:text-ink">
          ← Semua PO
        </Link>
        <div className="mt-2 flex flex-wrap items-start gap-x-3 gap-y-2">
          <div className="min-w-0 flex-1">
            <h1 className="po-no text-2xl break-words">{po.po_number}</h1>
            <p className="text-muted">
              {po.vendor.name} · {po.product.name}
            </p>
          </div>
          <Pill tone={open ? "ok" : "plain"}>{open ? "Buka" : "Ditutup"}</Pill>
        </div>
        {po.note ? <p className="mt-2 text-sm">{po.note}</p> : null}
        {buyer ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="btn btn-sm" onClick={() => setModal({ t: "editPo" })}>
              Ubah PO
            </button>
            {open ? (
              <button type="button" className="btn btn-sm" onClick={() => setPoStatus("closed")} disabled={action.busy}>
                Tutup PO
              </button>
            ) : (
              <button type="button" className="btn btn-sm" onClick={() => setPoStatus("open")} disabled={action.busy}>
                Buka kembali
              </button>
            )}
            {truckCount === 0 ? (
              <button type="button" className="btn btn-sm btn-danger" onClick={deletePo} disabled={action.busy}>
                Hapus PO
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <ErrorNote error={action.error} />

      <section className="card grid gap-3 p-4" aria-label="Ringkasan PO">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-5">
          {[
            ["Volume PO", fmtVolume(po.volume_kg)],
            ["Diterima", fmtVolume(totals.acceptedKg)],
            ["Dalam rencana", fmtVolume(totals.plannedKg)],
            ["Ditolak", fmtVolume(totals.rejectedKg)],
            ["Sisa", fmtVolume(totals.remainingKg)],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs font-semibold text-muted">{k}</dt>
              <dd className="num text-base font-bold">{v}</dd>
            </div>
          ))}
        </dl>
        <ProgressBar doneKg={totals.acceptedKg} plannedKg={totals.plannedKg} totalKg={po.volume_kg} />
        {totals.overPlanned ? (
          <p className="note note-warn">
            Diterima ditambah truk dalam rencana ({fmtVolume(totals.acceptedKg + totals.plannedKg)}) melebihi volume PO{" "}
            {fmtVolume(po.volume_kg)}.
          </p>
        ) : null}
        {totals.overScheduled ? (
          <p className="note note-warn">
            Jumlah volume semua jadwal ({fmtVolume(totals.scheduledKg)}) melebihi volume PO {fmtVolume(po.volume_kg)}.
          </p>
        ) : null}
      </section>

      <section className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto text-base font-bold">Jadwal dan truk</h2>
          {buyer && open ? (
            <button type="button" className="btn btn-sm btn-primary" onClick={() => setModal({ t: "schedule" })}>
              Tambah jadwal
            </button>
          ) : null}
          {vendor && open && po.schedules.length > 0 ? (
            <button type="button" className="btn btn-sm btn-primary" onClick={() => setModal({ t: "truck" })}>
              Daftarkan truk
            </button>
          ) : null}
          {receiver && open && po.schedules.length > 0 ? (
            <button type="button" className="btn btn-sm" onClick={() => setModal({ t: "truck", unregistered: true })}>
              Catat truk tak terdaftar
            </button>
          ) : null}
        </div>

        {po.schedules.length === 0 ? (
          <Empty title="Belum ada jadwal">
            {buyer
              ? "Tambahkan jadwal berisi tanggal ETA dan volume yang diminta. Vendor baru bisa mendaftarkan truk setelah ada jadwal."
              : "Purchasing belum menetapkan jadwal untuk PO ini."}
          </Empty>
        ) : (
          po.schedules.map((s) => {
            const st = scheduleTotals(s);
            const pending = s.proposals.find((p) => p.status === "pending");
            const lastDecided = s.proposals.find((p) => p.status !== "pending");
            const days = daysBetween(today, s.eta_current);
            const short = s.volume_kg - st.acceptedKg;
            return (
              <article key={s.id} className="card overflow-hidden">
                <div className="grid gap-3 p-4">
                  <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
                    <div className="mr-auto">
                      <h3 className="text-base font-bold">ETA {fmtDate(s.eta_current)}</h3>
                      <p className="text-sm text-muted">
                        {s.eta_current !== s.eta_original ? `ETA awal ${fmtDate(s.eta_original)} · ` : ""}
                        diminta <span className="num">{fmtVolume(s.volume_kg)}</span> · diterima{" "}
                        <span className="num">{fmtVolume(st.acceptedKg)}</span>
                        {st.plannedKg > 0 ? (
                          <>
                            {" "}
                            · dalam rencana <span className="num">{fmtVolume(st.plannedKg)}</span>
                          </>
                        ) : null}
                      </p>
                    </div>
                    {short <= 0 ? (
                      <Pill tone="ok">Terpenuhi</Pill>
                    ) : days < 0 ? (
                      <Pill tone="danger">Lewat ETA, kurang {fmtVolume(short)}</Pill>
                    ) : (
                      <Pill tone="info">{days === 0 ? "ETA hari ini" : `${days} hari lagi`}</Pill>
                    )}
                  </div>
                  <ProgressBar doneKg={st.acceptedKg} plannedKg={st.plannedKg} totalKg={s.volume_kg} />

                  {s.reminders[0] ? <ReminderLine reminder={s.reminders[0]} current={s.reminders[0].eta === s.eta_current} /> : null}

                  {pending ? (
                    <div className="note note-warn grid gap-2">
                      <p>
                        <strong>Usulan vendor:</strong> ETA menjadi {fmtDate(pending.proposed_eta)}. Alasan: {pending.reason}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {buyer ? (
                          <>
                            <button type="button" className="btn btn-sm btn-primary" onClick={() => setModal({ t: "decide", proposal: pending, approve: true })}>
                              Setujui
                            </button>
                            <button type="button" className="btn btn-sm btn-danger" onClick={() => setModal({ t: "decide", proposal: pending, approve: false })}>
                              Tolak
                            </button>
                          </>
                        ) : vendor ? (
                          <button type="button" className="btn btn-sm" onClick={() => withdrawProposal(pending)} disabled={action.busy}>
                            Tarik usulan
                          </button>
                        ) : (
                          <span>Menunggu keputusan purchasing.</span>
                        )}
                      </div>
                    </div>
                  ) : lastDecided ? (
                    <p className="text-sm text-muted">
                      Usulan ETA {fmtDate(lastDecided.proposed_eta)} {lastDecided.status === "approved" ? "disetujui" : "ditolak"} pada{" "}
                      {fmtDateTime(lastDecided.decided_at)}
                      {lastDecided.decision_note ? `. Catatan: ${lastDecided.decision_note}` : "."}
                    </p>
                  ) : null}

                  <div className="flex flex-wrap gap-2">
                    {vendor && open ? (
                      <>
                        <button type="button" className="btn btn-sm" onClick={() => setModal({ t: "truck", scheduleId: s.id })}>
                          Daftarkan truk
                        </button>
                        {!pending ? (
                          <button type="button" className="btn btn-sm" onClick={() => setModal({ t: "proposal", schedule: s })}>
                            Usul tanggal baru
                          </button>
                        ) : null}
                      </>
                    ) : null}
                    {buyer ? (
                      <>
                        <button type="button" className="btn btn-sm" onClick={() => setModal({ t: "schedule", schedule: s })}>
                          Ubah jadwal
                        </button>
                        {s.trucks.length === 0 ? (
                          <button type="button" className="btn btn-sm btn-danger" onClick={() => deleteSchedule(s)} disabled={action.busy}>
                            Hapus jadwal
                          </button>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </div>

                {s.trucks.length === 0 ? (
                  <p className="border-t border-line px-4 py-3 text-sm text-muted">Belum ada truk untuk jadwal ini.</p>
                ) : (
                  <ul className="border-t border-line">
                    {s.trucks.map((t) => (
                      <TruckRow
                        key={t.id}
                        po={po}
                        truck={t}
                        busy={action.busy}
                        can={{
                          edit: vendor && t.status === "planned",
                          cancel: (vendor || buyer) && t.status === "planned",
                          receive: receiver && t.status === "planned",
                          correct: receiver && t.status === "received",
                          revive: buyer && t.status === "cancelled",
                          deleteReceipt: profile.role === "admin" && t.status === "received",
                        }}
                        on={{
                          edit: () => setModal({ t: "truck", truck: t }),
                          cancel: () => setModal({ t: "cancelTruck", truck: t }),
                          receive: () => setModal({ t: "receipt", truck: t }),
                          photos: () => setModal({ t: "photos", truck: t }),
                          revive: () => reviveTruck(t),
                          deleteReceipt: () => deleteReceipt(t),
                        }}
                      />
                    ))}
                  </ul>
                )}
              </article>
            );
          })
        )}
      </section>

      {isInternal(profile) ? <AuditSection poId={po.id} /> : null}

      {modal?.t === "editPo" ? <EditPo po={po} onClose={() => setModal(null)} onDone={done} /> : null}
      {modal?.t === "schedule" ? <ScheduleForm po={po} schedule={modal.schedule} onClose={() => setModal(null)} onDone={done} /> : null}
      {modal?.t === "proposal" ? <ProposalForm schedule={modal.schedule} onClose={() => setModal(null)} onDone={done} /> : null}
      {modal?.t === "truck" ? (
        <TruckForm
          po={po}
          scheduleId={modal.scheduleId}
          truck={modal.truck}
          unregistered={modal.unregistered}
          onClose={() => setModal(null)}
          onDone={done}
        />
      ) : null}
      {modal?.t === "receipt" ? <ReceiptForm po={po} truck={modal.truck} onClose={() => setModal(null)} onDone={done} /> : null}
      {modal?.t === "photos" ? <PhotoModal truck={modal.truck} onClose={() => setModal(null)} /> : null}
      {modal?.t === "cancelTruck" ? (
        <ReasonForm
          title={`Batalkan truk ${modal.truck.plate_number}`}
          label="Alasan pembatalan"
          submitLabel="Batalkan truk"
          danger
          onClose={() => setModal(null)}
          onSubmit={async (text) => {
            const { data, error: err } = await db()
              .from("trucks")
              .update({ status: "cancelled", cancel_reason: text })
              .eq("id", modal.truck.id)
              .select("id");
            if (err) throw err;
            if (!data || data.length === 0) throw new Error("Truk ini sudah terkunci dan tidak bisa dibatalkan.");
            done();
          }}
        />
      ) : null}
      {modal?.t === "decide" ? (
        <ReasonForm
          title={modal.approve ? "Setujui usulan tanggal" : "Tolak usulan tanggal"}
          label={`Catatan untuk vendor${modal.approve ? " (boleh kosong)" : ""}`}
          submitLabel={modal.approve ? `Setujui ETA ${fmtDate(modal.proposal.proposed_eta)}` : "Tolak usulan"}
          required={!modal.approve}
          danger={!modal.approve}
          onClose={() => setModal(null)}
          onSubmit={async (text) => {
            const { error: err } = await db()
              .from("schedule_proposals")
              .update({ status: modal.approve ? "approved" : "rejected", decision_note: text || null })
              .eq("id", modal.proposal.id);
            if (err) throw err;
            done();
          }}
        />
      ) : null}
    </div>
  );
}

function EditPo({ po, onClose, onDone }: { po: PO; onClose: () => void; onDone: () => void }) {
  const { data, error, loading } = useLoad(async () => ({ vendors: await loadVendors(), products: await loadProducts() }), []);
  if (loading || !data) {
    return (
      <Modal title="Ubah PO" onClose={onClose}>
        {error ? <ErrorNote error={error} /> : <Loading />}
      </Modal>
    );
  }
  return <POForm po={po} vendors={data.vendors} products={data.products} onClose={onClose} onDone={onDone} />;
}

type TruckCan = { edit: boolean; cancel: boolean; receive: boolean; correct: boolean; revive: boolean; deleteReceipt: boolean };
type TruckOn = { edit: () => void; cancel: () => void; receive: () => void; photos: () => void; revive: () => void; deleteReceipt: () => void };

function TruckRow({ po, truck: t, can, on, busy }: { po: PO; truck: Truck; can: TruckCan; on: TruckOn; busy: boolean }) {
  const r = t.receipt;
  const diff = r ? weightDiff(t.vendor_net_kg, r.factory_net_kg, po.product.tolerance_pct) : null;
  const overdue = isOverdue(t, new Date());
  return (
    <li className="grid gap-2 border-b border-line px-4 py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        <Plate>{t.plate_number}</Plate>
        {t.status === "planned" ? <Pill tone="info">Dalam rencana</Pill> : null}
        {t.status === "received" ? <Pill tone="ok">Diterima</Pill> : null}
        {t.status === "cancelled" ? <Pill>Batal</Pill> : null}
        {t.registered_by_qc ? <Pill tone="warn">Tak terdaftar</Pill> : null}
        {overdue ? <Pill tone="danger">Belum tiba lebih dari {OVERDUE_DAYS} hari</Pill> : null}
        {r && r.rejected_kg > 0 ? <Pill tone="danger">Ada penolakan</Pill> : null}
        {diff?.flagged ? <Pill tone="danger">Selisih melewati batas</Pill> : null}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
        <Item k="Berangkat" v={fmtDateTime(t.departure_at)} />
        <Item k="Netto vendor" v={fmtKg(t.vendor_net_kg)} num />
        {r ? (
          <>
            <Item k="Tanggal masuk" v={fmtDate(r.arrived_at)} />
            <Item k="Netto pabrik" v={fmtKg(r.factory_net_kg)} num />
            <Item k="Selisih" v={`${fmtKg(diff?.diffKg ?? 0)} (${fmtNum(diff?.diffPct ?? 0)}%)`} num bad={diff?.flagged} />
            <Item k="Ditolak" v={fmtKg(r.rejected_kg)} num bad={r.rejected_kg > 0} />
            <Item k="Diterima" v={fmtKg(acceptedKg(r))} num />
            <Item k="Surat jalan" v={r.delivery_note_number ?? "-"} />
          </>
        ) : null}
      </dl>

      {r && r.rejected_kg > 0 ? (
        <p className="text-sm">
          <strong>Alasan penolakan:</strong> {REJECT_REASONS[r.reject_reason ?? ""] ?? r.reject_reason}
          {r.reject_note ? `. ${r.reject_note}` : ""}
        </p>
      ) : null}
      {t.status === "cancelled" ? (
        <p className="text-sm text-muted">
          <strong>Alasan batal:</strong> {t.cancel_reason}
        </p>
      ) : null}

      {can.edit || can.cancel || can.receive || can.correct || can.revive || can.deleteReceipt || (r && r.photos.length > 0) ? (
        <div className="flex flex-wrap gap-2">
          {can.receive ? (
            <button type="button" className="btn btn-sm btn-primary" onClick={on.receive}>
              Catat penerimaan
            </button>
          ) : null}
          {can.correct ? (
            <button type="button" className="btn btn-sm" onClick={on.receive}>
              Koreksi penerimaan
            </button>
          ) : null}
          {r && r.photos.length > 0 ? (
            <button type="button" className="btn btn-sm" onClick={on.photos}>
              Lihat foto ({r.photos.length})
            </button>
          ) : null}
          {can.edit ? (
            <button type="button" className="btn btn-sm" onClick={on.edit}>
              Ubah
            </button>
          ) : null}
          {can.cancel ? (
            <button type="button" className="btn btn-sm btn-danger" onClick={on.cancel}>
              Batalkan
            </button>
          ) : null}
          {can.revive ? (
            <button type="button" className="btn btn-sm" onClick={on.revive} disabled={busy}>
              Aktifkan lagi
            </button>
          ) : null}
          {can.deleteReceipt ? (
            <button type="button" className="btn btn-sm btn-danger" onClick={on.deleteReceipt} disabled={busy}>
              Hapus penerimaan
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function ReminderLine({ reminder: r, current }: { reminder: Reminder; current: boolean }) {
  if (!current) return null;
  if (r.status === "sent") {
    return (
      <p className="text-sm text-muted">
        Pengingat email H-3 dikirim {fmtDateTime(r.last_try_at)} ke {r.recipients.length} akun vendor (saat itu kurang {fmtVolume(r.missing_kg)}).
      </p>
    );
  }
  return (
    <p className="note note-danger text-sm">
      Pengingat email H-3 belum terkirim
      {r.status === "no_recipient" ? ": vendor belum punya akun aktif." : `: ${r.error ?? "gagal dikirim"}.`} Dicoba lagi besok pagi
      ({r.attempts} kali dicoba).
    </p>
  );
}

function Item({ k, v, num, bad }: { k: string; v: string; num?: boolean; bad?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted">{k}</dt>
      <dd className={`${num ? "num" : ""} ${bad ? "font-semibold text-danger" : ""}`}>{v}</dd>
    </div>
  );
}

function PhotoModal({ truck, onClose }: { truck: Truck; onClose: () => void }) {
  const { data, error, loading } = useLoad(() => photoUrls(truck.receipt?.photos ?? []), [truck.id]);
  return (
    <Modal title={`Foto bukti ${truck.plate_number}`} onClose={onClose}>
      {loading ? <Loading label="Membuka foto" /> : null}
      <ErrorNote error={error} />
      <div className="grid gap-3">
        {(data ?? []).map((url, i) => (
          <a key={url} href={url} target="_blank" rel="noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={`Foto bukti ${i + 1} untuk truk ${truck.plate_number}`} className="w-full rounded-lg border border-line" />
          </a>
        ))}
      </div>
    </Modal>
  );
}

// --------------------------- Riwayat perubahan ----------------------
const TABLE_LABEL: Record<string, string> = {
  purchase_orders: "PO",
  schedules: "Jadwal",
  schedule_proposals: "Usulan tanggal",
  trucks: "Truk",
  receipts: "Penerimaan",
};

const FIELD_LABEL: Record<string, string> = {
  po_number: "No PO",
  vendor_id: "Vendor",
  product_id: "Produk",
  volume_kg: "Volume (kg)",
  status: "Status",
  note: "Catatan",
  eta_original: "ETA awal",
  eta_current: "ETA berlaku",
  schedule_id: "Jadwal",
  plate_number: "Nopol",
  vendor_net_kg: "Netto vendor (kg)",
  departure_at: "Berangkat",
  cancel_reason: "Alasan batal",
  arrived_at: "Tanggal masuk",
  factory_net_kg: "Netto pabrik (kg)",
  rejected_kg: "Ditolak (kg)",
  reject_reason: "Alasan penolakan",
  reject_note: "Catatan penolakan",
  delivery_note_number: "No surat jalan",
  photos: "Foto",
  proposed_eta: "Tanggal usulan",
  reason: "Alasan",
  decision_note: "Catatan keputusan",
};

const VALUE_LABEL: Record<string, string> = {
  planned: "dalam rencana",
  received: "diterima",
  cancelled: "batal",
  open: "buka",
  closed: "ditutup",
  pending: "menunggu",
  approved: "disetujui",
  rejected: "ditolak",
};

const show = (v: unknown): string => {
  if (v === null || v === undefined || v === "") return "kosong";
  if (typeof v === "string" && (VALUE_LABEL[v] || REJECT_REASONS[v])) return VALUE_LABEL[v] ?? REJECT_REASONS[v];
  if (typeof v === "number") return fmtNum(v);
  if (Array.isArray(v)) return `${v.length} file`;
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return fmtDateTime(v);
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return fmtDate(v);
  return String(v);
};

function describeAudit(e: AuditEntry): string {
  const row = e.new_data ?? e.old_data ?? {};
  const what =
    typeof row.plate_number === "string"
      ? ` ${row.plate_number}`
      : typeof row.eta_current === "string"
        ? ` ETA ${fmtDate(row.eta_current)}`
        : "";
  if (e.action === "INSERT") return `${TABLE_LABEL[e.table_name] ?? e.table_name}${what} ditambahkan.`;
  if (e.action === "DELETE") return `${TABLE_LABEL[e.table_name] ?? e.table_name}${what} dihapus.`;
  const changes = Object.keys(FIELD_LABEL)
    .filter((k) => JSON.stringify(e.old_data?.[k] ?? null) !== JSON.stringify(e.new_data?.[k] ?? null))
    .map((k) => `${FIELD_LABEL[k]}: ${show(e.old_data?.[k])} menjadi ${show(e.new_data?.[k])}`);
  return `${TABLE_LABEL[e.table_name] ?? e.table_name}${what} diubah. ${changes.join("; ") || "Tidak ada perubahan isi."}`;
}

function AuditSection({ poId }: { poId: string }) {
  const [opened, setOpened] = useState(false);
  return (
    <section className="card">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left font-bold"
        aria-expanded={opened}
        onClick={() => setOpened((o) => !o)}
      >
        Riwayat perubahan
        <span className="text-sm font-semibold text-denim">{opened ? "Sembunyikan" : "Tampilkan"}</span>
      </button>
      {opened ? <AuditList poId={poId} /> : null}
    </section>
  );
}

function AuditList({ poId }: { poId: string }) {
  const { data, error, loading } = useLoad(async () => {
    const [entries, profiles] = await Promise.all([loadAudit(poId), loadProfiles()]);
    return { entries, names: new Map(profiles.map((p) => [p.id, p.full_name])) };
  }, [poId]);
  if (loading) return <Loading label="Memuat riwayat" />;
  if (error) return <div className="px-4 pb-4"><ErrorNote error={error} /></div>;
  if (!data || data.entries.length === 0) return <p className="px-4 pb-4 text-sm text-muted">Belum ada riwayat.</p>;
  return (
    <ul className="border-t border-line">
      {data.entries.map((e) => (
        <li key={e.id} className="border-b border-line px-4 py-2 text-sm last:border-b-0">
          <p>{describeAudit(e)}</p>
          <p className="text-xs text-muted">
            {fmtDateTime(e.changed_at)} · {e.changed_by ? (data.names.get(e.changed_by) ?? "Pengguna tidak dikenal") : "Sistem"}
          </p>
        </li>
      ))}
    </ul>
  );
}
