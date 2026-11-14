"use client";
import { useEffect, useRef, useState } from "react";
import { db } from "@/lib/supabase";
import { ErrorNote, Field, Loading, useAction } from "./ui";

type Mode = { t: "loading" } | { t: "enroll"; factorId: string; qr: string; secret: string } | { t: "verify"; factorId: string };

/**
 * Verifikasi dua langkah untuk admin dan purchasing.
 * Belum pernah mendaftar: tampilkan kode QR untuk aplikasi autentikator.
 * Sudah mendaftar: minta kode 6 angka.
 */
export default function MfaGate({ name, onSignOut }: { name: string; onSignOut: () => void }) {
  const [mode, setMode] = useState<Mode>({ t: "loading" });
  const [code, setCode] = useState("");
  const [setupError, setSetupError] = useState<unknown>(null);
  const { busy, error, run } = useAction();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      const mfa = db().auth.mfa;
      const { data, error: listError } = await mfa.listFactors();
      if (listError) return setSetupError(new Error(`Verifikasi dua langkah gagal dimuat: ${listError.message}`));
      const verified = data.totp[0];
      if (verified) return setMode({ t: "verify", factorId: verified.id });
      // Bersihkan pendaftaran yang dulu tidak diselesaikan, lalu mulai yang baru.
      for (const f of data.all) {
        if (f.status === "unverified") await mfa.unenroll({ factorId: f.id });
      }
      const { data: enrolled, error: enrollError } = await mfa.enroll({ factorType: "totp", friendlyName: `Autentikator ${Date.now()}` });
      if (enrollError || !enrolled) {
        return setSetupError(new Error(`Pendaftaran verifikasi dua langkah gagal: ${enrollError?.message ?? ""}`));
      }
      setMode({ t: "enroll", factorId: enrolled.id, qr: enrolled.totp.qr_code, secret: enrolled.totp.secret });
    })();
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode.t === "loading") return;
    void run(async () => {
      const { error: verifyError } = await db().auth.mfa.challengeAndVerify({ factorId: mode.factorId, code: code.trim() });
      if (verifyError) throw new Error("Kode salah atau sudah kedaluwarsa. Tunggu kode berikutnya di aplikasi, lalu coba lagi.");
      // Setelah berhasil, sesi naik ke tingkat dua langkah dan Shell menampilkan halaman.
    });
  };

  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <div className="card grid gap-4 p-5">
        <div>
          <h1 className="text-xl">Verifikasi dua langkah</h1>
          <p className="mt-1 text-sm text-muted">
            {name}, akun admin dan purchasing wajib memakai kode dari aplikasi autentikator selain password.
          </p>
        </div>
        <ErrorNote error={setupError} />
        {mode.t === "loading" && !setupError ? <Loading label="Menyiapkan" /> : null}

        {mode.t === "enroll" ? (
          <ol className="grid list-decimal gap-3 pl-5 text-sm">
            <li>Pasang aplikasi autentikator di HP, misalnya Google Authenticator atau Microsoft Authenticator.</li>
            <li>
              Pindai kode QR ini dengan aplikasi tersebut.
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={mode.qr} alt="Kode QR untuk aplikasi autentikator" width={176} height={176} className="mt-2 rounded border border-line bg-white p-2" />
              <span className="mt-2 block text-muted">
                Tidak bisa memindai? Ketik kunci ini di aplikasi: <span className="mono break-all text-ink">{mode.secret}</span>
              </span>
            </li>
            <li>Masukkan 6 angka yang muncul di aplikasi.</li>
          </ol>
        ) : null}

        {mode.t !== "loading" ? (
          <form onSubmit={submit} className="grid gap-4">
            <Field label="Kode 6 angka" hint={mode.t === "verify" ? "Buka aplikasi autentikator di HP Anda." : undefined}>
              <input
                id="mfa-code"
                className="input mono text-center text-lg tracking-[0.3em]"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              />
            </Field>
            <ErrorNote error={error} />
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "Memeriksa…" : mode.t === "enroll" ? "Aktifkan dan masuk" : "Masuk"}
            </button>
          </form>
        ) : null}

        <p className="text-sm text-muted">
          HP hilang atau ganti? Minta admin mereset verifikasi dua langkah Anda di halaman Kelola.{" "}
          <button type="button" className="btn-link" onClick={onSignOut}>
            Keluar
          </button>
        </p>
      </div>
    </main>
  );
}
