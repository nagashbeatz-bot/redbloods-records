/** Shared domain-classification helper for Client/Label Artist Dossiers (Phase C.2). */
import type { PartnerCompanyState } from "../eyes/types";

export function classifyDomain(state: PartnerCompanyState, key: keyof PartnerCompanyState["domains"]): "complete" | "partial" | "unknown" {
  const d = state.domains[key];
  if (d.status !== "AVAILABLE") return "unknown";
  if (d.coverage === "FULL") return "complete";
  if (d.coverage === "PARTIAL") return "partial";
  return "unknown";
}
