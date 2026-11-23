export type Role = "admin" | "purchasing" | "qc" | "vendor";
export type PoStatus = "open" | "closed";
export type TruckStatus = "planned" | "received" | "cancelled";
export type ProposalStatus = "pending" | "approved" | "rejected";

export type Vendor = { id: string; name: string };
export type Product = { id: string; name: string; tolerance_pct: number };

export type Profile = {
  id: string;
  full_name: string;
  email: string;
  role: Role;
  vendor_id: string | null;
  active: boolean;
  activity_seen_at: string;
  created_at: string;
};

export type Receipt = {
  truck_id: string;
  arrived_at: string; // YYYY-MM-DD
  factory_net_kg: number;
  rejected_kg: number;
  reject_reason: string | null;
  reject_note: string | null;
  delivery_note_number: string | null;
  photos: string[];
  received_by: string | null;
  created_at: string;
  updated_at: string;
};

export type Truck = {
  id: string;
  schedule_id: string;
  po_id: string;
  plate_number: string;
  vendor_net_kg: number;
  departure_at: string;
  status: TruckStatus;
  registered_by_qc: boolean;
  cancel_reason: string | null;
  created_at: string;
  updated_at: string;
  receipt: Receipt | null;
};

export type Proposal = {
  id: string;
  schedule_id: string;
  proposed_eta: string;
  reason: string;
  status: ProposalStatus;
  created_at: string;
  decided_at: string | null;
  decision_note: string | null;
};

export type Reminder = {
  id: number;
  schedule_id: string;
  eta: string;
  status: "sent" | "failed" | "no_recipient";
  recipients: string[];
  missing_kg: number;
  error: string | null;
  attempts: number;
  first_try_at: string;
  last_try_at: string;
};

export type Schedule = {
  id: string;
  po_id: string;
  eta_original: string; // YYYY-MM-DD
  eta_current: string;
  volume_kg: number;
  created_at: string;
  trucks: Truck[];
  proposals: Proposal[];
  reminders: Reminder[];
};

export type PO = {
  id: string;
  po_number: string;
  vendor_id: string;
  product_id: string;
  volume_kg: number;
  status: PoStatus;
  note: string | null;
  created_at: string;
  closed_at: string | null;
  vendor: Vendor;
  product: Product;
  schedules: Schedule[];
};

export type Activity = {
  id: number;
  created_at: string;
  kind: string;
  po_id: string;
  vendor_id: string;
  data: Record<string, unknown>;
  actor: string | null;
};

export type AuditEntry = {
  id: number;
  changed_at: string;
  changed_by: string | null;
  table_name: string;
  row_id: string;
  action: "INSERT" | "UPDATE" | "DELETE";
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
};

export const REJECT_REASONS: Record<string, string> = {
  kualitas: "Kualitas tidak sesuai spesifikasi",
  kadar_air: "Kadar air terlalu tinggi",
  kontaminasi: "Kontaminasi atau benda asing",
  kemasan: "Kemasan rusak",
  dokumen: "Dokumen tidak lengkap",
  lainnya: "Lainnya",
};

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  purchasing: "Purchasing",
  qc: "QC",
  vendor: "Vendor",
};
