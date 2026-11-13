"use client";
import { db } from "./supabase";

const BUCKET = "receipt-photos";
const MAX_SIDE = 1600;

/** Memperkecil foto di perangkat sebelum diunggah agar hemat kuota dan cepat di sinyal lemah. */
async function compress(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
    return blob ?? file;
  } catch {
    return file;
  }
}

/** Mengunggah foto bukti. Mengembalikan daftar lokasi file untuk disimpan di penerimaan. */
export async function uploadPhotos(poId: string, truckId: string, files: File[]): Promise<string[]> {
  const paths: string[] = [];
  for (const [i, file] of files.entries()) {
    const blob = await compress(file);
    const path = `${poId}/${truckId}/${Date.now()}-${i}.jpg`;
    const { error } = await db().storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg" });
    if (error) throw new Error(`Foto "${file.name}" gagal diunggah: ${error.message}`);
    paths.push(path);
  }
  return paths;
}

/** Tautan sementara (1 jam) untuk melihat foto privat. */
export async function photoUrls(paths: string[]): Promise<string[]> {
  if (paths.length === 0) return [];
  const { data, error } = await db().storage.from(BUCKET).createSignedUrls(paths, 3600);
  if (error) throw new Error(`Foto tidak bisa dibuka: ${error.message}`);
  return (data ?? []).map((d) => d.signedUrl).filter(Boolean) as string[];
}
