import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type Role = "admin" | "purchasing" | "qc" | "vendor";

export const fail = (status: number, error: string) => Response.json({ error }, { status });

/** Klien server dengan kunci rahasia. Hanya dipakai di rute server. */
export function serviceClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) return null;
  return createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Tingkat verifikasi di dalam token login: "aal2" berarti sudah lewat verifikasi dua langkah. */
function aalOf(token: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()) as { aal?: string };
    return payload.aal ?? null;
  } catch {
    return null;
  }
}

/**
 * Mengenali pemanggil dari token login di header Authorization.
 * Hanya admin dan purchasing yang lolos, dan keduanya wajib sudah verifikasi dua langkah.
 */
export async function getCaller(
  request: Request,
): Promise<{ admin: SupabaseClient; callerId: string; role: "admin" | "purchasing" } | Response> {
  const admin = serviceClient();
  if (!admin) return fail(500, "SUPABASE_SECRET_KEY belum diisi di server.");

  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return fail(401, "Sesi login tidak ditemukan. Silakan login ulang.");

  // getUser memeriksa keaslian token ke Supabase; isi token baru dipercaya setelah itu.
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return fail(401, "Sesi login habis. Silakan login ulang.");

  const { data: caller } = await admin.from("profiles").select("role, active").eq("id", data.user.id).maybeSingle();
  const role = caller?.active ? (caller.role as Role) : null;
  if (role !== "admin" && role !== "purchasing") return fail(403, "Akun Anda tidak punya izin untuk tindakan ini.");
  if (aalOf(token) !== "aal2") return fail(403, "Selesaikan verifikasi dua langkah dulu, lalu coba lagi.");

  return { admin, callerId: data.user.id, role };
}
