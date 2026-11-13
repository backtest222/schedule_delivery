"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { errMsg } from "@/lib/supabase";
import { fmtVolume, parseNumber } from "@/lib/format";
import type { Tone } from "@/lib/activity";

export function Pill({ tone, children }: { tone?: Tone | "plain"; children: ReactNode }) {
  return <span className={`pill ${tone && tone !== "plain" ? `pill-${tone}` : ""}`}>{children}</span>;
}

export function Plate({ children }: { children: ReactNode }) {
  return <span className="plate">{children}</span>;
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="note note-danger">
      {errMsg(error)}
    </p>
  );
}

export function Loading({ label = "Memuat data" }: { label?: string }) {
  return <p className="py-10 text-center text-muted">{label}…</p>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="card px-4 py-8 text-center">
      <p className="font-semibold">{title}</p>
      {children ? <div className="mx-auto mt-1 max-w-md text-sm text-muted">{children}</div> : null}
    </div>
  );
}

/** Batang capaian: hijau = sudah diterima, biru muda = truk dalam rencana. */
export function ProgressBar({ doneKg, plannedKg, totalKg }: { doneKg: number; plannedKg: number; totalKg: number }) {
  const w = (kg: number) => `${Math.min(100, totalKg > 0 ? (kg / totalKg) * 100 : 0)}%`;
  return (
    <div
      className="bar"
      role="img"
      aria-label={`Diterima ${fmtVolume(doneKg)} dari ${fmtVolume(totalKg)}, dalam rencana ${fmtVolume(plannedKg)}`}
    >
      <i className="bar-planned" style={{ width: w(doneKg + plannedKg) }} />
      <i className="bar-done" style={{ width: w(doneKg) }} />
    </div>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line bg-surface px-4 py-3">
        <h2 className="text-base font-bold">{title}</h2>
        <button type="button" className="btn btn-sm" onClick={onClose}>
          Tutup
        </button>
      </div>
      <div className="px-4 py-4">{children}</div>
    </dialog>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

/** Isian berat. Nilai yang keluar selalu kg; pengguna boleh mengetik dalam ton. */
export function WeightInput({
  label,
  valueKg,
  onChange,
  allowTon = false,
  hint,
  required = true,
  id,
}: {
  label: string;
  valueKg: number | null;
  onChange: (kg: number | null) => void;
  allowTon?: boolean;
  hint?: ReactNode;
  required?: boolean;
  id: string;
}) {
  const [unit, setUnit] = useState<"kg" | "ton">(allowTon ? "ton" : "kg");
  const [text, setText] = useState(() =>
    valueKg === null ? "" : String(allowTon ? valueKg / 1000 : valueKg).replace(".", ","),
  );
  const emit = (t: string, u: "kg" | "ton") => {
    const n = parseNumber(t);
    onChange(Number.isFinite(n) ? Math.round(n * (u === "ton" ? 1000 : 1) * 100) / 100 : null);
  };
  return (
    <div className="field">
      <label htmlFor={id}>
        <span className="text-[0.8125rem] font-semibold">{label}</span>
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          className="input num"
          inputMode="decimal"
          autoComplete="off"
          required={required}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            emit(e.target.value, unit);
          }}
        />
        {allowTon ? (
          <select
            aria-label="Satuan"
            className="input w-24!"
            value={unit}
            onChange={(e) => {
              const u = e.target.value as "kg" | "ton";
              setUnit(u);
              emit(text, u);
            }}
          >
            <option value="ton">ton</option>
            <option value="kg">kg</option>
          </select>
        ) : (
          <span className="self-center text-sm text-muted">kg</span>
        )}
      </div>
      {hint ? <small>{hint}</small> : null}
    </div>
  );
}

/** Memuat data saat komponen tampil, dengan status memuat, error, dan fungsi muat ulang. */
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const reload = useCallback(async () => {
    try {
      const d = await loaderRef.current();
      setData(d);
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, loading, reload };
}

/** Menjalankan satu tindakan (simpan, hapus) dengan status sibuk dan error. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const run = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, run, setError };
}
