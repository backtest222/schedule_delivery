"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { db, isConfigured } from "@/lib/supabase";
import { countUnread } from "@/lib/data";
import { ROLE_LABEL, type Profile } from "@/lib/types";
import { Loading } from "./ui";

type Auth = {
  profile: Profile;
  unread: number;
  refreshUnread: () => void;
  /** Menandai semua aktivitas sudah dilihat. */
  markSeen: () => Promise<void>;
};

const AuthContext = createContext<Auth | null>(null);

/** Profil pengguna yang sedang login. Hanya dipakai di halaman di dalam Shell. */
export function useAuth(): Auth {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth dipakai di luar Shell");
  return ctx;
}

export const isBuyer = (p: Profile) => p.role === "admin" || p.role === "purchasing";
export const isInternal = (p: Profile) => p.role !== "vendor";
export const canReceive = (p: Profile) => p.role === "qc" || p.role === "admin";

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto max-w-md px-4 py-16">
      <div className="card p-5">
        <h1 className="text-lg font-bold">{title}</h1>
        <div className="mt-2 grid gap-3 text-sm text-muted">{children}</div>
      </div>
    </main>
  );
}

export default function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  // undefined = belum diketahui, null = tidak ada
  const [userId, setUserId] = useState<string | null | undefined>(undefined);
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!isConfigured) return;
    const client = db();
    void client.auth.getSession().then(({ data }) => setUserId(data.session?.user.id ?? null));
    const { data: sub } = client.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user.id ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (userId === undefined) return;
    if (userId === null) {
      setProfile(null);
      return;
    }
    let alive = true;
    setProfile(undefined);
    void db()
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle()
      .then(({ data }) => {
        if (alive) setProfile((data as Profile | null) ?? null);
      });
    return () => {
      alive = false;
    };
  }, [userId]);

  const ready = Boolean(profile && profile.active);

  const refreshUnread = useCallback(() => {
    if (profile && profile.active) void countUnread(profile).then(setUnread);
  }, [profile]);

  useEffect(() => {
    if (!ready) return;
    refreshUnread();
    const timer = setInterval(refreshUnread, 60_000);
    return () => clearInterval(timer);
  }, [ready, refreshUnread, pathname]);

  const markSeen = useCallback(async () => {
    if (!profile) return;
    const now = new Date().toISOString();
    const { error } = await db().from("profiles").update({ activity_seen_at: now }).eq("id", profile.id);
    if (!error) {
      setProfile({ ...profile, activity_seen_at: now });
      setUnread(0);
    }
  }, [profile]);

  const onLogin = pathname === "/login";
  useEffect(() => {
    if (userId === null && !onLogin) router.replace("/login");
    if (userId && onLogin && ready) router.replace("/");
  }, [userId, onLogin, ready, router]);

  if (!isConfigured) {
    return (
      <Notice title="Website belum tersambung ke database">
        <p>
          Isi <span className="mono">NEXT_PUBLIC_SUPABASE_URL</span> dan{" "}
          <span className="mono">NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</span>, lalu jalankan ulang. Langkah lengkapnya
          ada di PANDUAN.md.
        </p>
      </Notice>
    );
  }

  if (onLogin) return <>{children}</>;
  if (userId === undefined || (userId && profile === undefined)) return <Loading label="Memeriksa login" />;
  if (userId === null) return null;

  const signOut = () => void db().auth.signOut();

  if (!profile || !profile.active) {
    return (
      <Notice title={profile ? "Akun ini dinonaktifkan" : "Akun ini belum punya peran"}>
        <p>
          {profile
            ? "Hubungi purchasing atau admin bila akun ini seharusnya masih aktif."
            : "Login berhasil, tetapi akun belum didaftarkan sebagai vendor, purchasing, QC, atau admin. Hubungi admin."}
        </p>
        <button type="button" className="btn" onClick={signOut}>
          Keluar
        </button>
      </Notice>
    );
  }

  const links = [
    { href: "/", label: "Beranda", show: true },
    { href: "/aktivitas", label: "Aktivitas", show: true, badge: unread },
    { href: "/laporan", label: "Laporan", show: isInternal(profile) },
    { href: "/kelola", label: "Kelola", show: isBuyer(profile) },
  ].filter((l) => l.show);

  return (
    <AuthContext.Provider value={{ profile, unread, refreshUnread, markSeen }}>
      <header className="sticky top-0 z-10 border-b border-line bg-surface">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2">
          <Link href="/" className="text-base font-extrabold tracking-tight">
            Jadwal Pengiriman
          </Link>
          <div className="ml-auto flex items-center gap-2 text-sm">
            <span className="hidden text-muted sm:inline">{profile.full_name}</span>
            <span className="pill">{ROLE_LABEL[profile.role]}</span>
            <button type="button" className="btn btn-sm" onClick={signOut}>
              Keluar
            </button>
          </div>
          <nav aria-label="Menu utama" className="-mx-1 flex w-full gap-1 overflow-x-auto">
            {links.map((l) => {
              const active = l.href === "/" ? pathname === "/" || pathname.startsWith("/po/") : pathname.startsWith(l.href);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold whitespace-nowrap ${
                    active ? "bg-brand-soft text-brand" : "text-muted hover:text-ink"
                  }`}
                >
                  {l.label}
                  {l.badge ? (
                    <span className="pill pill-danger" aria-label={`${l.badge} aktivitas baru`}>
                      {l.badge > 99 ? "99+" : l.badge}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 pt-5 pb-16">{children}</main>
    </AuthContext.Provider>
  );
}
