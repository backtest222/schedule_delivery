"use client";
import { useState } from "react";
import { db } from "@/lib/supabase";
import { acceptedKg, nextSchedule, poTotals, weightDiff } from "@/lib/calc";
import { fmtDate, fmtKg, fmtNum, fmtVolume, toLocalInput, todayStr } from "@/lib/format";
import { uploadPhotos } from "@/lib/photos";
import { REJECT_REASONS, type PO, type Product, type Schedule, type Truck, type Vendor } from "@/lib/types";
import { ErrorNote, Field, Modal, WeightInput, useAction } from "./ui";

function Actions({ busy, label, onClose }: { busy: boolean; label: string; onClose: () => void }) {
  return (
    <div className="flex flex-wrap justify-end gap-2 pt-1">
      <button type="button" className="btn" onClick={onClose} disabled={busy}>
        Batal
      </button>
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? "Menyimpan…" : label}
      </button>
    </div>
  );
}

// ------------------------------- PO ---------------------------------
export function POForm({
  po,
  vendors,
  products,
  onClose,
  onDone,
}: {
  po?: PO;
  vendors: Vendor[];
  products: Product[];
  onClose: () => void;
  onDone: (id: string) => void;
}) {
  const [number, setNumber] = useState(po?.po_number ?? "");
  const [vendorId, setVendorId] = useState(po?.vendor_id ?? "");
  const [productId, setProductId] = useState(po?.product_id ?? "");
  const [volume, setVolume] = useState<number | null>(po?.volume_kg ?? null);
  const [note, setNote] = useState(po?.note ?? "");
  const { busy, error, run } = useAction();
  const hasTrucks = Boolean(po?.schedules.some((s) => s.trucks.length > 0));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      if (!volume || volume <= 0) throw new Error("Isi volume PO dengan angka lebih dari nol.");
      const row = {
        po_number: number.trim(),
        vendor_id: vendorId,
        product_id: productId,
        volume_kg: volume,
        note: note.trim() || null,
      };
      if (po) {
        const { error: err } = await db().from("purchase_orders").update(row).eq("id", po.id);
        if (err) throw err;
        onDone(po.id);
      } else {
        const { data, error: err } = await db().from("purchase_orders").insert(row).select("id").single();
        if (err) throw err;
        onDone((data as { id: string }).id);
      }
    });
  };

  return (
    <Modal title={po ? "Ubah PO" : "Buat PO"} onClose={onClose}>
      <form onSubmit={submit} className="grid gap-4">
        <Field label="Nomor PO">
          <input id="po-number" className="input po-no" required value={number} onChange={(e) => setNumber(e.target.value)} />
        </Field>
        <Field label="Vendor" hint={hasTrucks ? "Tidak bisa diganti karena PO ini sudah punya truk." : undefined}>
          <select id="po-vendor" className="input" required disabled={hasTrucks} value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
            <option value="">Pilih vendor</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Produk" hint="Satu PO berisi satu produk.">
          <select id="po-product" className="input" required disabled={hasTrucks} value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">Pilih produk</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <WeightInput id="po-volume" label="Volume PO" valueKg={volume} onChange={setVolume} allowTon />
        <Field label="Catatan (boleh kosong)">
          <textarea id="po-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <ErrorNote error={error} />
        <Actions busy={busy} label={po ? "Simpan perubahan" : "Buat PO"} onClose={onClose} />
      </form>
    </Modal>
  );
}

// ------------------------------ Jadwal ------------------------------
export function ScheduleForm({
  po,
  schedule,
  onClose,
  onDone,
}: {
  po: PO;
  schedule?: Schedule;
  onClose: () => void;
  onDone: () => void;
}) {
  const [eta, setEta] = useState(schedule?.eta_current ?? "");
  const [volume, setVolume] = useState<number | null>(schedule?.volume_kg ?? null);
  const { busy, error, run } = useAction();
  const locked = Boolean(schedule && schedule.trucks.length > 0);

  const others = po.schedules.filter((s) => s.id !== schedule?.id).reduce((sum, s) => sum + s.volume_kg, 0);
  const over = volume ? others + volume - po.volume_kg : 0;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      if (!volume || volume <= 0) throw new Error("Isi volume jadwal dengan angka lebih dari nol.");
      if (schedule) {
        // Selama belum ada truk, tanggal masih dianggap koreksi, jadi ETA awal ikut berubah.
        const row = locked ? { eta_current: eta, volume_kg: volume } : { eta_original: eta, eta_current: eta, volume_kg: volume };
        const { error: err } = await db().from("schedules").update(row).eq("id", schedule.id);
        if (err) throw err;
      } else {
        const { error: err } = await db().from("schedules").insert({ po_id: po.id, eta_original: eta, volume_kg: volume });
        if (err) throw err;
      }
      onDone();
    });
  };

  return (
    <Modal title={schedule ? "Ubah jadwal" : "Tambah jadwal"} onClose={onClose}>
      <form onSubmit={submit} className="grid gap-4">
        <Field
          label={locked ? "ETA revisi" : "ETA diminta"}
          hint={
            locked
              ? `ETA awal ${fmtDate(schedule?.eta_original)} tetap tersimpan dan dipakai untuk menilai ketepatan waktu.`
              : "Tanggal barang diminta tiba di pabrik."
          }
        >
          <input id="schedule-eta" className="input" type="date" required value={eta} onChange={(e) => setEta(e.target.value)} />
        </Field>
        <WeightInput id="schedule-volume" label="Volume diminta" valueKg={volume} onChange={setVolume} allowTon />
        {over > 0 ? (
          <p className="note note-warn">
            Jumlah semua jadwal menjadi {fmtVolume(others + (volume ?? 0))}, melebihi volume PO {fmtVolume(po.volume_kg)} sebesar{" "}
            {fmtVolume(over)}. Jadwal tetap bisa disimpan.
          </p>
        ) : null}
        <ErrorNote error={error} />
        <Actions busy={busy} label={schedule ? "Simpan perubahan" : "Tambah jadwal"} onClose={onClose} />
      </form>
    </Modal>
  );
}

// --------------------------- Usulan tanggal -------------------------
export function ProposalForm({ schedule, onClose, onDone }: { schedule: Schedule; onClose: () => void; onDone: () => void }) {
  const [eta, setEta] = useState("");
  const [reason, setReason] = useState("");
  const { busy, error, run } = useAction();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const { error: err } = await db()
        .from("schedule_proposals")
        .insert({ schedule_id: schedule.id, proposed_eta: eta, reason: reason.trim() });
      if (err) throw err;
      onDone();
    });
  };

  return (
    <Modal title="Usul tanggal baru" onClose={onClose}>
      <form onSubmit={submit} className="grid gap-4">
        <p className="text-sm text-muted">
          ETA yang berlaku sekarang {fmtDate(schedule.eta_current)}. Jadwal baru berlaku setelah purchasing menyetujui.
        </p>
        <Field label="Tanggal yang diusulkan">
          <input id="proposal-eta" className="input" type="date" required value={eta} onChange={(e) => setEta(e.target.value)} />
        </Field>
        <Field label="Alasan">
          <textarea id="proposal-reason" className="input" required value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <ErrorNote error={error} />
        <Actions busy={busy} label="Kirim usulan" onClose={onClose} />
      </form>
    </Modal>
  );
}

// ------------------------------- Truk -------------------------------
export function TruckForm({
  po,
  scheduleId,
  truck,
  unregistered = false,
  onClose,
  onDone,
}: {
  po: PO;
  scheduleId?: string;
  truck?: Truck;
  /** true bila QC mencatat truk yang datang tanpa didaftarkan vendor. */
  unregistered?: boolean;
  onClose: () => void;
  onDone: (truckId: string) => void;
}) {
  const [schedule, setSchedule] = useState(truck?.schedule_id ?? scheduleId ?? nextSchedule(po, todayStr())?.id ?? "");
  const [plate, setPlate] = useState(truck?.plate_number ?? "");
  const [net, setNet] = useState<number | null>(truck?.vendor_net_kg ?? null);
  const [departure, setDeparture] = useState(toLocalInput(truck?.departure_at ?? new Date()));
  const { busy, error, run } = useAction();

  const totals = poTotals(po);
  const committed = totals.acceptedKg + totals.plannedKg - (truck && truck.status === "planned" ? truck.vendor_net_kg : 0);
  const over = net ? committed + net - po.volume_kg : 0;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      if (!net || net <= 0) throw new Error("Isi berat netto dengan angka lebih dari nol.");
      const row = {
        schedule_id: schedule,
        plate_number: plate,
        vendor_net_kg: net,
        departure_at: new Date(departure).toISOString(),
      };
      if (truck) {
        const { data, error: err } = await db().from("trucks").update(row).eq("id", truck.id).select("id");
        if (err) throw err;
        if (!data || data.length === 0) throw new Error("Data truk ini sudah terkunci dan tidak bisa diubah.");
        onDone(truck.id);
      } else {
        const { data, error: err } = await db().from("trucks").insert(row).select("id").single();
        if (err) throw err;
        onDone((data as { id: string }).id);
      }
    });
  };

  return (
    <Modal title={truck ? "Ubah data truk" : unregistered ? "Catat truk tak terdaftar" : "Daftarkan truk"} onClose={onClose}>
      <form onSubmit={submit} className="grid gap-4">
        <p className="text-sm text-muted">
          PO <span className="po-no">{po.po_number}</span> · {po.vendor.name} · {po.product.name}
          {unregistered ? ". Truk ini akan ditandai datang tanpa didaftarkan vendor." : ""}
        </p>
        <Field label="Untuk jadwal">
          <select id="truck-schedule" className="input" required value={schedule} onChange={(e) => setSchedule(e.target.value)}>
            <option value="">Pilih jadwal</option>
            {po.schedules.map((s) => (
              <option key={s.id} value={s.id}>
                ETA {fmtDate(s.eta_current)} · {fmtVolume(s.volume_kg)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Nomor polisi">
          <input
            id="truck-plate"
            className="input mono uppercase"
            required
            autoCapitalize="characters"
            placeholder="BE 1234 AB"
            value={plate}
            onChange={(e) => setPlate(e.target.value)}
          />
        </Field>
        <WeightInput
          id="truck-net"
          label={unregistered ? "Berat netto menurut surat jalan vendor" : "Berat netto timbangan vendor"}
          valueKg={net}
          onChange={setNet}
          hint="Netto = berat isi saja, tanpa berat truk."
        />
        <Field label={unregistered ? "Waktu berangkat (perkiraan)" : "Jadwal keberangkatan"}>
          <input
            id="truck-departure"
            className="input"
            type="datetime-local"
            required
            value={departure}
            onChange={(e) => setDeparture(e.target.value)}
          />
        </Field>
        {over > 0 ? (
          <p className="note note-warn">
            Dengan truk ini, total diterima dan dalam rencana melebihi volume PO {fmtVolume(po.volume_kg)} sebesar{" "}
            {fmtVolume(over)}. Truk tetap bisa disimpan, tetapi purchasing akan melihat peringatan ini.
          </p>
        ) : null}
        <ErrorNote error={error} />
        <Actions busy={busy} label={truck ? "Simpan perubahan" : "Simpan truk"} onClose={onClose} />
      </form>
    </Modal>
  );
}

// ---------------------------- Penerimaan ----------------------------
export function ReceiptForm({ po, truck, onClose, onDone }: { po: PO; truck: Truck; onClose: () => void; onDone: () => void }) {
  const r = truck.receipt;
  const [arrived, setArrived] = useState(r?.arrived_at ?? todayStr());
  const [factoryNet, setFactoryNet] = useState<number | null>(r?.factory_net_kg ?? null);
  const [hasReject, setHasReject] = useState(Boolean(r && r.rejected_kg > 0));
  const [rejected, setRejected] = useState<number | null>(r && r.rejected_kg > 0 ? r.rejected_kg : null);
  const [reason, setReason] = useState(r?.reject_reason ?? "");
  const [note, setNote] = useState(r?.reject_note ?? "");
  const [sj, setSj] = useState(r?.delivery_note_number ?? "");
  const [files, setFiles] = useState<File[]>([]);
  const { busy, error, run } = useAction();

  const diff = factoryNet ? weightDiff(truck.vendor_net_kg, factoryNet, po.product.tolerance_pct) : null;
  const rejectedKg = hasReject ? (rejected ?? 0) : 0;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      if (!factoryNet || factoryNet <= 0) throw new Error("Isi netto timbangan pabrik dengan angka lebih dari nol.");
      if (hasReject && (!rejected || rejected <= 0)) throw new Error("Isi berat yang ditolak, atau matikan pilihan penolakan.");
      if (rejectedKg > factoryNet) throw new Error("Berat ditolak tidak boleh melebihi netto pabrik.");
      if (hasReject && !reason) throw new Error("Pilih alasan penolakan.");
      const uploaded = files.length > 0 ? await uploadPhotos(po.id, truck.id, files) : [];
      const row = {
        arrived_at: arrived,
        factory_net_kg: factoryNet,
        rejected_kg: rejectedKg,
        reject_reason: hasReject ? reason : null,
        reject_note: hasReject ? note.trim() || null : null,
        delivery_note_number: sj.trim() || null,
        photos: [...(r?.photos ?? []), ...uploaded],
      };
      const q = r
        ? db().from("receipts").update(row).eq("truck_id", truck.id)
        : db().from("receipts").insert({ truck_id: truck.id, ...row });
      const { error: err } = await q;
      if (err) throw err;
      onDone();
    });
  };

  return (
    <Modal title={r ? "Koreksi penerimaan" : "Catat penerimaan"} onClose={onClose}>
      <form onSubmit={submit} className="grid gap-4">
        <div className="note note-info grid gap-1">
          <p>
            <span className="plate">{truck.plate_number}</span> · {po.vendor.name} · {po.product.name}
          </p>
          <p>
            PO <span className="po-no">{po.po_number}</span> · netto vendor <strong className="num">{fmtKg(truck.vendor_net_kg)}</strong>
            {truck.registered_by_qc ? " · tak terdaftar" : ""}
          </p>
        </div>
        <Field label="Tanggal truk masuk">
          <input id="receipt-arrived" className="input" type="date" required max={todayStr()} value={arrived} onChange={(e) => setArrived(e.target.value)} />
        </Field>
        <WeightInput
          id="receipt-net"
          label="Netto timbangan pabrik"
          valueKg={factoryNet}
          onChange={setFactoryNet}
          hint="Seluruh muatan yang ditimbang di pabrik, termasuk bagian yang nanti ditolak."
        />
        {diff ? (
          <p className={`note ${diff.flagged ? "note-danger" : "note-info"}`} aria-live="polite">
            Selisih dengan netto vendor: <strong className="num">{fmtKg(diff.diffKg)}</strong> ({fmtNum(diff.diffPct)}%).{" "}
            {diff.flagged
              ? `Melewati batas ${fmtNum(po.product.tolerance_pct)}% untuk ${po.product.name}.`
              : `Masih dalam batas ${fmtNum(po.product.tolerance_pct)}%.`}
          </p>
        ) : null}
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input id="receipt-has-reject" type="checkbox" className="size-5" checked={hasReject} onChange={(e) => setHasReject(e.target.checked)} />
          Ada barang yang ditolak
        </label>
        {hasReject ? (
          <div className="grid gap-4 border-l-2 border-danger pl-3">
            <WeightInput
              id="receipt-rejected"
              label="Berat ditolak"
              valueKg={rejected}
              onChange={setRejected}
              hint={
                factoryNet
                  ? `Berat diterima menjadi ${fmtKg(acceptedKg({ factory_net_kg: factoryNet, rejected_kg: rejectedKg }))}.`
                  : "Isi seluruh netto pabrik bila semua muatan ditolak."
              }
            />
            <Field label="Alasan penolakan">
              <select id="receipt-reason" className="input" required value={reason} onChange={(e) => setReason(e.target.value)}>
                <option value="">Pilih alasan</option>
                {Object.entries(REJECT_REASONS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Catatan penolakan (boleh kosong)">
              <textarea id="receipt-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>
        ) : null}
        <Field label="Nomor surat jalan vendor (boleh kosong)">
          <input id="receipt-sj" className="input mono" value={sj} onChange={(e) => setSj(e.target.value)} />
        </Field>
        <Field
          label="Foto bukti (boleh kosong)"
          hint={r && r.photos.length > 0 ? `Sudah ada ${r.photos.length} foto. Foto baru ditambahkan, bukan menggantikan.` : "Foto diperkecil otomatis sebelum diunggah."}
        >
          <input
            id="receipt-photos"
            className="input"
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => setFiles([...(e.target.files ?? [])])}
          />
        </Field>
        <ErrorNote error={error} />
        <Actions busy={busy} label={r ? "Simpan koreksi" : "Simpan penerimaan"} onClose={onClose} />
      </form>
    </Modal>
  );
}

// ---------------------- Isian alasan sederhana ----------------------
export function ReasonForm({
  title,
  label,
  submitLabel,
  required = true,
  danger = false,
  onClose,
  onSubmit,
}: {
  title: string;
  label: string;
  submitLabel: string;
  required?: boolean;
  danger?: boolean;
  onClose: () => void;
  onSubmit: (text: string) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const { busy, error, run } = useAction();
  return (
    <Modal title={title} onClose={onClose}>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => onSubmit(text.trim()));
        }}
      >
        <Field label={label}>
          <textarea id="reason-text" className="input" required={required} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        <ErrorNote error={error} />
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Batal
          </button>
          <button type="submit" className={`btn ${danger ? "btn-danger" : "btn-primary"}`} disabled={busy}>
            {busy ? "Menyimpan…" : submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
