"use client";
import { useState } from "react";
import { isBuyer, useAuth } from "@/components/Shell";
import { Empty, ErrorNote, Field, Loading, Modal, Pill, useAction, useLoad } from "@/components/ui";
import { callUsersApi, loadProducts, loadProfiles, loadVendors } from "@/lib/data";
import { fmtNum, parseNumber } from "@/lib/format";
import { db } from "@/lib/supabase";
import { ROLE_LABEL, type Product, type Profile, type Role, type Vendor } from "@/lib/types";

type Tab = "vendor" | "produk" | "akun";

export default function ManagePage() {
  const { profile } = useAuth();
  const [tab, setTab] = useState<Tab>("vendor");
  if (!isBuyer(profile)) return <Empty title="Halaman ini hanya untuk purchasing dan admin" />;
  const tabs: [Tab, string][] = [
    ["vendor", "Vendor"],
    ["produk", "Produk"],
    ["akun", "Akun pengguna"],
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
  const bytes = new Uint32Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

function AccountTab() {
  const { profile } = useAuth();
  const { data, error, loading, reload } = useLoad(async () => ({ profiles: await loadProfiles(), vendors: await loadVendors() }), []);
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

  return (
    <section className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <p className="mr-auto max-w-xl text-sm text-muted">
          {admin
            ? "Admin membuat semua jenis akun. Akun vendor hanya melihat PO milik vendornya."
            : "Purchasing membuat akun vendor. Akun purchasing dan QC dibuat oleh admin."}
        </p>
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
        <Field label="Password awal" hint="Catat dan kirimkan ke pengguna lewat jalur yang aman. Password tidak bisa dilihat lagi setelah disimpan.">
          <input id="account-password" className="input mono" required minLength={8} autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
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
          <input id="reset-password" className="input mono" required minLength={8} autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
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
