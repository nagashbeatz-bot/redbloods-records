"use client";

import { getStatusColor, getStatusBg } from "@/lib/utils";
import type { ProjectStatus } from "@/lib/types";

interface StatusBadgeProps {
  status: ProjectStatus;
  small?: boolean;
}

export default function StatusBadge({ status, small }: StatusBadgeProps) {
  const color = getStatusColor(status);
  const bg = getStatusBg(status);

  return (
    <span
      style={{ color, background: bg, borderColor: `${color}33`, whiteSpace: "nowrap" }}
      className={`inline-flex items-center gap-1.5 rounded-full border font-medium ${
        small ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-sm"
      }`}
    >
      <span
        className="rounded-full flex-shrink-0"
        style={{ width: small ? 5 : 6, height: small ? 5 : 6, background: color }}
      />
      {status}
    </span>
  );
}

export function OverdueTag({ small }: { small?: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border font-medium ${
        small ? "px-2 py-0.5 text-xs" : "px-2.5 py-0.5 text-xs"
      }`}
      style={{
        color: "#EF4444",
        background: "rgba(239,68,68,0.08)",
        borderColor: "rgba(239,68,68,0.3)",
      }}
    >
      עבר דדליין
    </span>
  );
}

export function DueSoonTag({ days, small }: { days: number; small?: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border font-medium ${
        small ? "px-2 py-0.5 text-xs" : "px-2.5 py-0.5 text-xs"
      }`}
      style={{
        color: "#F97316",
        background: "rgba(249,115,22,0.08)",
        borderColor: "rgba(249,115,22,0.3)",
      }}
    >
      {days === 0 ? "היום" : days === 1 ? "מחר" : `עוד ${days} ימים`}
    </span>
  );
}
