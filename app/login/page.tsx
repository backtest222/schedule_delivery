"use client";
import { useState } from "react";
import { db } from "@/lib/supabase";
import { ErrorNote, Field, useAction } from "@/components/ui";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { busy, error, run } = useAction();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const { error: err } = await db().auth.signInWithPassword({ email: email.trim(), password });
      if (err) {
        throw new Error(
          err.message.includes("Invalid login") ? "Email atau password salah." : `Login gagal: ${err.message}`,
        );
      }
      // Shell akan memindahkan ke Beranda setelah profil termuat.
    });
  };

  return (
    <main className="mx-auto max-w-sm px-4 py-14">
      <h1 className="text-2xl font-extrabold tracking-tight">Jadwal Pengiriman</h1>
      <p className="mt-1 text-sm text-muted">
        Masuk dengan akun yang diberikan purchasing. Vendor hanya melihat PO miliknya sendiri.
      </p>
      <form onSubmit={submit} className="card mt-6 grid gap-4 p-4">
        <Field label="Email">
          <input
            id="login-email"
            className="input"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="Password">
          <input
            id="login-password"
            className="input"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <ErrorNote error={error} />
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Memeriksa…" : "Masuk"}
        </button>
      </form>
      <p className="mt-4 text-sm text-muted">Lupa password? Minta purchasing atau admin mengatur ulang password Anda.</p>
    </main>
  );
}
