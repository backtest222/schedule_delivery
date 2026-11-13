import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Pengelolaan akun. Hanya rute ini yang memakai kunci rahasia Supabase.
 * - Admin boleh membuat dan mengubah semua akun.
 * - Purchasing hanya boleh membuat dan mengubah akun vendor.
 * Pemanggil dikenali dari token login yang dikirim di header Authorization.
 */

const ROLES = ["admin", "purchasing", "qc", "vendor"] as const;
type Role = (typeof ROLES)[number];

const fail = (status: number, error: string) => Response.json({ error }, { status });
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) return fail(500, "SUPABASE_SECRET_KEY belum diisi di server.");

  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return fail(401, "Sesi login tidak ditemukan. Silakan login ulang.");

  const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) return fail(401, "Sesi login habis. Silakan login ulang.");
  const callerId = userData.user.id;

  const { data: caller } = await admin.from("profiles").select("role, active").eq("id", callerId).maybeSingle();
  const callerRole = caller?.active ? (caller.role as Role) : null;
  if (callerRole !== "admin" && callerRole !== "purchasing") {
    return fail(403, "Akun Anda tidak punya izin mengelola akun.");
  }
  const mayManage = (role: Role) => callerRole === "admin" || role === "vendor";

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return fail(400, "Permintaan tidak bisa dibaca.");
  }

  if (body.action === "create") {
    const fullName = text(body.full_name);
    const email = text(body.email).toLowerCase();
    const password = typeof body.password === "string" ? body.password : "";
    const role = body.role as Role;
    const vendorId = text(body.vendor_id) || null;

    if (!fullName) return fail(400, "Isi nama pengguna.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail(400, "Alamat email tidak valid.");
    if (password.length < 8) return fail(400, "Password minimal 8 karakter.");
    if (!ROLES.includes(role)) return fail(400, "Peran tidak dikenal.");
    if (!mayManage(role)) return fail(403, "Purchasing hanya boleh membuat akun vendor.");
    if (role === "vendor" && !vendorId) return fail(400, "Pilih vendor untuk akun ini.");

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createError || !created.user) {
      const registered = /already|registered|exists/i.test(createError?.message ?? "");
      return fail(400, registered ? "Email itu sudah terdaftar." : `Akun gagal dibuat: ${createError?.message ?? ""}`);
    }

    const { error: profileError } = await admin.from("profiles").insert({
      id: created.user.id,
      full_name: fullName,
      email,
      role,
      vendor_id: role === "vendor" ? vendorId : null,
    });
    if (profileError) {
      // Jangan tinggalkan akun login tanpa profil.
      await admin.auth.admin.deleteUser(created.user.id);
      return fail(400, `Profil gagal disimpan: ${profileError.message}`);
    }
    return Response.json({ ok: true });
  }

  if (body.action === "update") {
    const id = text(body.id);
    if (!id) return fail(400, "Akun tidak disebutkan.");
    const { data: target } = await admin.from("profiles").select("role").eq("id", id).maybeSingle();
    if (!target) return fail(404, "Akun tidak ditemukan.");
    if (!mayManage(target.role as Role)) return fail(403, "Purchasing hanya boleh mengubah akun vendor.");

    if (typeof body.password === "string") {
      if (body.password.length < 8) return fail(400, "Password minimal 8 karakter.");
      const { error } = await admin.auth.admin.updateUserById(id, { password: body.password });
      if (error) return fail(400, `Password gagal diubah: ${error.message}`);
    }

    const changes: Record<string, unknown> = {};
    if (typeof body.active === "boolean") {
      if (id === callerId && !body.active) return fail(400, "Anda tidak bisa menonaktifkan akun sendiri.");
      changes.active = body.active;
    }
    if (text(body.full_name)) changes.full_name = text(body.full_name);
    if (Object.keys(changes).length > 0) {
      const { error } = await admin.from("profiles").update(changes).eq("id", id);
      if (error) return fail(400, `Perubahan gagal disimpan: ${error.message}`);
    }
    return Response.json({ ok: true });
  }

  return fail(400, "Tindakan tidak dikenal.");
}
