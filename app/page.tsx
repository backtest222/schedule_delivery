"use client";
import { BuyerDashboard, QcDashboard, VendorDashboard } from "@/components/dashboards";
import { useAuth } from "@/components/Shell";

export default function HomePage() {
  const { profile } = useAuth();
  if (profile.role === "vendor") return <VendorDashboard />;
  if (profile.role === "qc") return <QcDashboard />;
  return <BuyerDashboard />;
}
