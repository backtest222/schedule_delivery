import "server-only";
import { fail, getCaller, type Role } from "@/lib/server/caller";

/**
 * Pengelolaan akun. Rute server memakai kunci rahasia Supabase.
 * - Admin boleh membuat dan mengubah semua akun, serta mereset verifikasi dua langkah.
 * - Purchasing hanya boleh membuat dan mengubah akun vendor.
 */

const ROLES: Role[] = ["admin", "purchasing", "qc", "vendor"];
const MIN_PASSWORD = 12;
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export async function POST(request: Request) {
  const caller = await getCaller(request);
  if (caller instanceof Response) return caller;
  const { admin, callerId, role: callerRole } = caller;
  const mayManage = (role: Role) => callerRole === "admin" || role === "vendor";

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return fail(400, "Permintaan tidak bisa dibaca.");
  }

  // Login terakhir dan status verifikasi dua langkah tiap akun.
  if (body.action === "overview") {
    const { data: profiles } = await admin.from("profiles").select("id, role");
    const visible = new Set((profiles ?? []).filter((p) => mayManage(p.role as Role)).map((p) => p.id as string));
    const users: Record<string, { last_sign_in_at: string | null; mfa: boolean }> = {};
    for (let page = 1; page <= 50; page += 1) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) return fail(500, `Daftar akun gagal dibaca: ${error.message}`);
      for (const u of data.users) {
        if (!visible.has(u.id)) continue;
        users[u.id] = {
          last_sign_in_at: u.last_sign_in_at ?? null,
          mfa: (u.factors ?? []).some((f) => f.status === "verified"),
        };
      }
      if (data.users.length < 200) break;
    }
    return Response.json({ users });
  }

  if (body.action === "create") {
    const fullName = text(body.full_name);
    const email = text(body.email).toLowerCase();
    const password = typeof body.password === "string" ? body.password : "";
    const role = body.role as Role;
    const vendorId = text(body.vendor_id) || null;

    if (!fullName) return fail(400, "Isi nama pengguna.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail(400, "Alamat email tidak valid.");
    if (password.length < MIN_PASSWORD) return fail(400, `Password minimal ${MIN_PASSWORD} karakter.`);
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

  if (body.action === "update" || body.action === "reset_mfa") {
    const id = text(body.id);
    if (!id) return fail(400, "Akun tidak disebutkan.");
    const { data: target } = await admin.from("profiles").select("role").eq("id", id).maybeSingle();
    if (!target) return fail(404, "Akun tidak ditemukan.");
    if (!mayManage(target.role as Role)) return fail(403, "Purchasing hanya boleh mengubah akun vendor.");

    if (body.action === "reset_mfa") {
      if (callerRole !== "admin") return fail(403, "Hanya admin yang boleh mereset verifikasi dua langkah.");
      const { data: listed, error: listError } = await admin.auth.admin.mfa.listFactors({ userId: id });
      if (listError) return fail(400, `Verifikasi dua langkah gagal dibaca: ${listError.message}`);
      for (const factor of listed?.factors ?? []) {
        const { error } = await admin.auth.admin.mfa.deleteFactor({ id: factor.id, userId: id });
        if (error) return fail(400, `Verifikasi dua langkah gagal direset: ${error.message}`);
      }
      return Response.json({ ok: true });
    }

    if (typeof body.password === "string") {
      if (body.password.length < MIN_PASSWORD) return fail(400, `Password minimal ${MIN_PASSWORD} karakter.`);
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
