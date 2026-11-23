"use client";
import { useState } from "react";
import { isBuyer, useAuth } from "@/components/Shell";
import { Empty, ErrorNote, Field, Loading, Modal, Pill, useAction, useLoad } from "@/components/ui";
import { callRemindersApi, callUsersApi, downloadBackup, loadReminderLog, loadAccountInfo, loadProducts, loadProfiles, loadVendors } from "@/lib/data";
import { fmtDate, fmtDateTime, fmtNum, fmtVolume, parseNumber } from "@/lib/format";
import type { ReminderRun } from "@/lib/data";
import { db } from "@/lib/supabase";
import { ROLE_LABEL, type Product, type Profile, type Role, type Vendor } from "@/lib/types";

type Tab = "vendor" | "produk" | "akun" | "pengingat";

export default function ManagePage() {
  const { profile } = useAuth();
  const [tab, setTab] = useState<Tab>("vendor");
  if (!isBuyer(profile)) return <Empty title="Halaman ini hanya untuk purchasing dan admin" />;
  const tabs: [Tab, string][] = [
    ["vendor", "Vendor"],
    ["produk", "Produk"],
    ["akun", "Akun pengguna"],
    ["pengingat", "Pengingat email"],
  ];
  return (
    <div className="grid gap-4">
      <h1 className="text-xl font-extrabold tracking-tight">Kelola data induk dan akun</h1>
      <div role="tablist" aria-label="Jenis data" className="flex flex-wrap gap-2">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={`btn btn-sm ${tab === key ? "btn-primary" : ""}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "vendor" ? <VendorTab /> : null}
      {tab === "produk" ? <ProductTab /> : null}
      {tab === "akun" ? <AccountTab /> : null}
      {tab === "pengingat" ? <ReminderTab /> : null}
    </div>
  );
}

// ------------------------------ Vendor ------------------------------
function VendorTab() {
  const { data, error, loading, reload } = useLoad(loadVendors, []);
  const [editing, setEditing] = useState<Vendor | "new" | null>(null);
  const action = useAction();

  const remove = (v: Vendor) => {
    if (!window.confirm(`Hapus vendor ${v.name}?`)) return;
    void action.run(async () => {
      const { error: err } = await db().from("vendors").delete().eq("id", v.id);
      if (err) throw err;
      await reload();
    });
  };

  return (
    <section className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <p className="mr-auto text-sm text-muted">Vendor dipilih saat membuat PO dan saat membuat akun vendor.</p>
        <button type="button" className="btn btn-primary" onClick={() => setEditing("new")}>
          Tambah vendor
        </button>
      </div>
      <ErrorNote error={error ?? action.error} />
      {loading ? (
        <Loading />
      ) : !data || data.length === 0 ? (
        <Empty title="Belum ada vendor" />
      ) : (
        <ul className="card">
          {data.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5 last:border-b-0">
              <span className="mr-auto font-semibold">{v.name}</span>
              <button type="button" className="btn btn-sm" onClick={() => setEditing(v)}>
                Ubah nama
              </button>
              <button type="button" className="btn btn-sm btn-danger" onClick={() => remove(v)} disabled={action.busy}>
                Hapus
              </button>
            </li>
          ))}
        </ul>
      )}
      {editing ? (
        <NameForm
          title={editing === "new" ? "Tambah vendor" : "Ubah nama vendor"}
          initial={editing === "new" ? "" : editing.name}
          onClose={() => setEditing(null)}
          onSave={async (name) => {
            const q = editing === "new" ? db().from("vendors").insert({ name }) : db().from("vendors").update({ name }).eq("id", editing.id);
            const { error: err } = await q;
            if (err) throw err;
            setEditing(null);
            await reload();
          }}
        />
      ) : null}
    </section>
  );
}

function NameForm({
  title,
  initial,
  onClose,
  onSave,
}: {
  title: string;
  initial: string;
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(initial);
  const { busy, error, run } = useAction();
  return (
    <Modal title={title} onClose={onClose}>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => onSave(name.trim()));
        }}
      >
        <Field label="Nama">
          <input id="name-input" className="input" required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <ErrorNote error={error} />
        <button type="submit" className="btn btn-primary justify-self-end" disabled={busy}>
          {busy ? "Menyimpan…" : "Simpan"}
        </button>
      </form>
    </Modal>
  );
}

// ------------------------------ Produk ------------------------------
function ProductTab() {
  const { data, error, loading, reload } = useLoad(loadProducts, []);
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const action = useAction();

  const remove = (p: Product) => {
    if (!window.confirm(`Hapus produk ${p.name}?`)) return;
    void action.run(async () => {
      const { error: err } = await db().from("products").delete().eq("id", p.id);
      if (err) throw err;
      await reload();
    });
  };

  return (
    <section className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <p className="mr-auto max-w-xl text-sm text-muted">
          Batas selisih adalah persentase selisih netto vendor dan netto pabrik yang masih dianggap wajar. Di atas batas itu, truk
          ditandai merah.
        </p>
        <button type="button" className="btn btn-primary" onClick={() => setEditing("new")}>
          Tambah produk
        </button>
      </div>
      <ErrorNote error={error ?? action.error} />
      {loading ? (
        <Loading />
      ) : !data || data.length === 0 ? (
        <Empty title="Belum ada produk" />
      ) : (
        <ul className="card">
          {data.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5 last:border-b-0">
              <span className="mr-auto">
                <span className="font-semibold">{p.name}</span>
                <span className="num ml-2 text-sm text-muted">batas selisih {fmtNum(p.tolerance_pct)}%</span>
              </span>
              <button type="button" className="btn btn-sm" onClick={() => setEditing(p)}>
                Ubah
              </button>
              <button type="button" className="btn btn-sm btn-danger" onClick={() => remove(p)} disabled={action.busy}>
                Hapus
              </button>
            </li>
          ))}
        </ul>
      )}
      {editing ? (
        <ProductForm
          product={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            void reload();
          }}
        />
      ) : null}
    </section>
  );
}

function ProductForm({ product, onClose, onDone }: { product?: Product; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(product?.name ?? "");
  const [tolerance, setTolerance] = useState(String(product?.tolerance_pct ?? 0.5).replace(".", ","));
  const { busy, error, run } = useAction();
  return (
    <Modal title={product ? "Ubah produk" : "Tambah produk"} onClose={onClose}>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const pct = parseNumber(tolerance);
            if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw new Error("Batas selisih harus angka antara 0 dan 100.");
            const row = { name: name.trim(), tolerance_pct: pct };
            const q = product ? db().from("products").update(row).eq("id", product.id) : db().from("products").insert(row);
            const { error: err } = await q;
            if (err) throw err;
            onDone();
          });
        }}
      >
        <Field label="Nama produk">
          <input id="product-name" className="input" required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Batas selisih berat (%)" hint="Contoh: 0,5 berarti selisih di atas 0,5% ditandai merah.">
          <input id="product-tolerance" className="input num" inputMode="decimal" required value={tolerance} onChange={(e) => setTolerance(e.target.value)} />
        </Field>
        <ErrorNote error={error} />
        <button type="submit" className="btn btn-primary justify-self-end" disabled={busy}>
          {busy ? "Menyimpan…" : "Simpan"}
        </button>
      </form>
    </Modal>
  );
}

// ------------------------------- Akun -------------------------------
function randomPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = new Uint32Array(14);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

function AccountTab() {
  const { profile } = useAuth();
  const { data, error, loading, reload } = useLoad(
    async () => ({ profiles: await loadProfiles(), vendors: await loadVendors(), info: await loadAccountInfo() }),
    [],
  );
  const [modal, setModal] = useState<{ t: "new" } | { t: "password"; user: Profile } | null>(null);
  const action = useAction();
  const admin = profile.role === "admin";
  const mayManage = (p: Profile) => admin || p.role === "vendor";
  const vendorName = (id: string | null) => data?.vendors.find((v) => v.id === id)?.name ?? "-";

  const setActive = (p: Profile, active: boolean) => {
    if (!active && !window.confirm(`Nonaktifkan akun ${p.full_name}? Akun ini tidak akan bisa melihat data apa pun.`)) return;
    void action.run(async () => {
      await callUsersApi({ action: "update", id: p.id, active });
      await reload();
    });
  };

  const resetMfa = (p: Profile) => {
    if (!window.confirm(`Reset verifikasi dua langkah ${p.full_name}? Saat login berikutnya ia harus mendaftarkan aplikasi autentikator lagi.`)) return;
    void action.run(async () => {
      await callUsersApi({ action: "reset_mfa", id: p.id });
      await reload();
    });
  };

  return (
    <section className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <p className="mr-auto max-w-xl text-sm text-muted">
          {admin
            ? "Admin membuat semua jenis akun. Akun vendor hanya melihat PO milik vendornya."
            : "Purchasing membuat akun vendor. Akun purchasing dan QC dibuat oleh admin."}
        </p>
        {admin ? (
          <button type="button" className="btn" onClick={() => void action.run(downloadBackup)} disabled={action.busy}>
            Unduh cadangan data
          </button>
        ) : null}
        <button type="button" className="btn btn-primary" onClick={() => setModal({ t: "new" })} disabled={!data}>
          Tambah akun
        </button>
      </div>
      <ErrorNote error={error ?? action.error} />
      {loading ? (
        <Loading />
      ) : (
        <div className="card overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Nama</th>
                <th>Email</th>
                <th>Peran</th>
                <th>Vendor</th>
                <th>Status</th>
                <th>Login terakhir</th>
                <th>2 langkah</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(data?.profiles ?? []).map((p) => (
                <tr key={p.id}>
                  <td className="font-semibold">{p.full_name}</td>
                  <td>{p.email}</td>
                  <td>{ROLE_LABEL[p.role]}</td>
                  <td>{vendorName(p.vendor_id)}</td>
                  <td>{p.active ? <Pill tone="ok">Aktif</Pill> : <Pill>Nonaktif</Pill>}</td>
                  <td className="whitespace-nowrap">
                    {data?.info[p.id] ? (data.info[p.id].last_sign_in_at ? fmtDateTime(data.info[p.id].last_sign_in_at) : "Belum pernah") : "-"}
                  </td>
                  <td>
                    {!data?.info[p.id] ? (
                      "-"
                    ) : data.info[p.id].mfa ? (
                      <Pill tone="ok">Aktif</Pill>
                    ) : p.role === "admin" || p.role === "purchasing" ? (
                      <Pill tone="warn">Belum didaftarkan</Pill>
                    ) : (
                      "Tidak wajib"
                    )}
                  </td>
                  <td>
                    {mayManage(p) ? (
                      <div className="flex flex-wrap gap-2">
                        <button type="button" className="btn btn-sm" onClick={() => setModal({ t: "password", user: p })}>
                          Atur ulang password
                        </button>
                        {p.id !== profile.id ? (
                          <button type="button" className="btn btn-sm" onClick={() => setActive(p, !p.active)} disabled={action.busy}>
                            {p.active ? "Nonaktifkan" : "Aktifkan"}
                          </button>
                        ) : null}
                        {admin && data?.info[p.id]?.mfa ? (
                          <button type="button" className="btn btn-sm btn-danger" onClick={() => resetMfa(p)} disabled={action.busy}>
                            Reset 2 langkah
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {modal?.t === "new" && data ? (
        <AccountForm
          vendors={data.vendors}
          roles={admin ? ["vendor", "purchasing", "qc", "admin"] : ["vendor"]}
          onClose={() => setModal(null)}
          onDone={() => {
            setModal(null);
            void reload();
          }}
        />
      ) : null}
      {modal?.t === "password" ? <PasswordForm user={modal.user} onClose={() => setModal(null)} /> : null}
    </section>
  );
}

function AccountForm({ vendors, roles, onClose, onDone }: { vendors: Vendor[]; roles: Role[]; onClose: () => void; onDone: () => void }) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState(randomPassword);
  const [role, setRole] = useState<Role>(roles[0]);
  const [vendorId, setVendorId] = useState("");
  const { busy, error, run } = useAction();
  return (
    <Modal title="Tambah akun" onClose={onClose}>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await callUsersApi({ action: "create", full_name: fullName, email, password, role, vendor_id: role === "vendor" ? vendorId : null });
            onDone();
          });
        }}
      >
        <Field label="Peran">
          <select id="account-role" className="input" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {roles.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </Field>
        {role === "vendor" ? (
          <Field label="Vendor" hint="Akun ini hanya akan melihat PO milik vendor yang dipilih.">
            <select id="account-vendor" className="input" required value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
              <option value="">Pilih vendor</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        <Field label="Nama pengguna">
          <input id="account-name" className="input" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </Field>
        <Field label="Email">
          <input id="account-email" className="input" type="email" required autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password awal" hint="Minimal 12 karakter. Catat dan kirimkan ke pengguna lewat jalur yang aman. Password tidak bisa dilihat lagi setelah disimpan.">
          <input id="account-password" className="input mono" required minLength={12} autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <ErrorNote error={error} />
        <button type="submit" className="btn btn-primary justify-self-end" disabled={busy}>
          {busy ? "Membuat akun…" : "Buat akun"}
        </button>
      </form>
    </Modal>
  );
}

function PasswordForm({ user, onClose }: { user: Profile; onClose: () => void }) {
  const [password, setPassword] = useState(randomPassword);
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();
  return (
    <Modal title={`Atur ulang password ${user.full_name}`} onClose={onClose}>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await callUsersApi({ action: "update", id: user.id, password });
            setSaved(true);
          });
        }}
      >
        <Field label="Password baru" hint="Catat dan kirimkan ke pengguna lewat jalur yang aman.">
          <input id="reset-password" className="input mono" required minLength={12} autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <ErrorNote error={error} />
        {saved ? <p className="note note-info">Password sudah diganti.</p> : null}
        <button type="submit" className="btn btn-primary justify-self-end" disabled={busy || saved}>
          {busy ? "Menyimpan…" : "Simpan password"}
        </button>
      </form>
    </Modal>
  );
}

// ----------------------------- Pengingat ----------------------------
const RUN_STATUS = {
  sent: ["ok", "Terkirim"],
  failed: ["danger", "Gagal"],
  no_recipient: ["danger", "Vendor belum punya akun"],
  preview: ["info", "Akan dikirim"],
} as const;

function ReminderTab() {
  const log = useLoad(() => loadReminderLog(50), []);
  const [run, setRun] = useState<ReminderRun | null>(null);
  const action = useAction();

  const go = (preview: boolean) => {
    if (!preview && !window.confirm("Kirim pengingat sekarang ke semua vendor yang jadwalnya belum lengkap?")) return;
    void action.run(async () => {
      setRun(await callRemindersApi(preview));
      if (!preview) await log.reload();
    });
  };

  return (
    <section className="grid gap-4">
      <div className="card grid gap-2 p-4 text-sm">
        <p>
          Setiap pagi sekitar pukul 07.00 WIB, vendor otomatis menerima email bila ada jadwal yang <strong>ETA-nya tinggal 3 hari atau kurang</strong>{" "}
          tetapi volume truk yang didaftarkan masih kurang dari volume jadwal. Satu jadwal diingatkan satu kali per tanggal ETA. Email dikirim ke semua
          akun vendor yang aktif, dan balasan vendor masuk ke email purchasing pembuat PO.
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <button type="button" className="btn" onClick={() => go(true)} disabled={action.busy}>
            Lihat siapa yang akan diingatkan
          </button>
          <button type="button" className="btn btn-primary" onClick={() => go(false)} disabled={action.busy}>
            Kirim sekarang
          </button>
        </div>
      </div>
      <ErrorNote error={action.error ?? log.error} />

      {run ? (
        <div className="card overflow-x-auto" aria-live="polite">
          <p className="px-4 pt-3 text-sm font-semibold">
            {run.schedules === 0
              ? `Hari ini (${fmtDate(run.today)}) tidak ada jadwal yang perlu diingatkan.`
              : `${run.schedules} jadwal perlu diingatkan, tanggal ${fmtDate(run.today)}.`}
          </p>
          {run.results.length > 0 ? (
            <table className="tbl mt-2">
              <thead>
                <tr>
                  <th>Vendor</th>
                  <th className="r">Jadwal</th>
                  <th>Penerima</th>
                  <th>Hasil</th>
                </tr>
              </thead>
              <tbody>
                {run.results.map((r) => (
                  <tr key={r.vendor}>
                    <td className="font-semibold">{r.vendor}</td>
                    <td className="r">{r.schedules}</td>
                    <td>{r.recipients.length > 0 ? r.recipients.join(", ") : "-"}</td>
                    <td>
                      <Pill tone={RUN_STATUS[r.status][0]}>{RUN_STATUS[r.status][1]}</Pill>
                      {r.error ? <span className="mt-1 block text-xs text-danger">{r.error}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      ) : null}

      <h2 className="text-base font-bold">Riwayat pengingat</h2>
      {log.loading ? (
        <Loading />
      ) : !log.data || log.data.length === 0 ? (
        <Empty title="Belum ada pengingat yang dikirim" />
      ) : (
        <div className="card overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Waktu</th>
                <th>PO dan vendor</th>
                <th>ETA</th>
                <th className="r">Kurang</th>
                <th>Hasil</th>
              </tr>
            </thead>
            <tbody>
              {log.data.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap">{fmtDateTime(r.last_try_at)}</td>
                  <td>
                    {r.schedule ? (
                      <a href={`/po/${r.schedule.po.id}`} className="po-no text-denim underline underline-offset-2">
                        {r.schedule.po.po_number}
                      </a>
                    ) : (
                      "-"
                    )}
                    <br />
                    <span className="text-muted">{r.schedule?.po.vendor.name ?? ""}</span>
                  </td>
                  <td className="whitespace-nowrap">{fmtDate(r.eta)}</td>
                  <td className="r">{fmtVolume(r.missing_kg)}</td>
                  <td>
                    <Pill tone={RUN_STATUS[r.status][0]}>{RUN_STATUS[r.status][1]}</Pill>
                    <span className="mt-1 block text-xs text-muted">
                      {r.status === "sent" ? `${r.recipients.length} penerima` : `${r.attempts} kali dicoba${r.error ? `: ${r.error}` : ""}`}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
