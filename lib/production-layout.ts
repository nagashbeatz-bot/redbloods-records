"use client";

import { useState, useEffect } from "react";

export const SECTION_LABELS: Record<string, string> = {
  summary:     "סיכום הפקה",
  tasks:       "משימות הפקה",
  concept:     "קונספט ותסריט",
  documents:   "מסמכי הפקה",
  references:  "רפרנסים / השראות",
  budget:      "תקציב",
  budgetItems: "תקציב מפורט",
  files:       "קבצים ועריכה",
  notes:       "הערות",
};

export const DEFAULT_ORDER = [
  "summary", "tasks", "concept", "documents", "references",
  "budget", "budgetItems", "files", "notes",
];

export interface ProductionLayout {
  order: string[];
  hidden: string[];
}

const LS_KEY = "redFilmsProductionLayout";

export function useProductionLayout() {
  const [layout, setLayout] = useState<ProductionLayout>({
    order:  DEFAULT_ORDER,
    hidden: [],
  });

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<ProductionLayout>;
      // Ensure any new sections added later still appear
      const savedOrder  = parsed.order  ?? [];
      const mergedOrder = [
        ...savedOrder.filter(id => DEFAULT_ORDER.includes(id)),
        ...DEFAULT_ORDER.filter(id => !savedOrder.includes(id)),
      ];
      setLayout({ order: mergedOrder, hidden: parsed.hidden ?? [] });
    } catch { /* ignore corrupt storage */ }
  }, []);

  function save(next: ProductionLayout) {
    setLayout(next);
    try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }

  function reset() {
    const fresh: ProductionLayout = { order: DEFAULT_ORDER, hidden: [] };
    setLayout(fresh);
    try { localStorage.setItem(LS_KEY, JSON.stringify(fresh)); } catch { /* ignore */ }
  }

  return { layout, save, reset };
}
