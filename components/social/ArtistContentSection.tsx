"use client";

/**
 * Stage 1 (2026-10-17): "התוכן של האמן" — the artist's own content, managed with the EXISTING content components
 * (ContentItemsTable for the list / edit / delete, AddContentModal for a new item). Items of a campaign linked to the artist
 * show here too (one canonical link). Nothing publishes; no calendar, push or finance effect.
 */
import { useState } from "react";
import AddContentModal from "./AddContentModal";
import ContentItemsTable from "./ContentItemsTable";
import { useArtistContent } from "./useArtistContent";

export default function ArtistContentSection({ labelArtistId, artistName, autoOpenAdd = false, onChanged }: { labelArtistId: string; artistName: string; autoOpenAdd?: boolean; onChanged?: () => void }) {
  const { items, state, addItem, updateItem, deleteItem, reload } = useArtistContent(labelArtistId);
  const [adding, setAdding] = useState(autoOpenAdd);
  const changed = <T,>(p: Promise<T>) => p.then((x) => { onChanged?.(); return x; });
  return (
    <section style={{ background: "linear-gradient(180deg, #161617 0%, #111112 100%)", border: "1px solid rgba(255,255,255,0.10)", borderRadius: 18, padding: "16px 18px", marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <div>
          <h3 style={{ margin: 0, color: "#F2F2F2", fontSize: 15.5, fontWeight: 800 }}>התוכן של {artistName}</h3>
          <div style={{ color: "#606060", fontSize: 11.5, marginTop: 3 }}>תוכן של האמן — עם או בלי קמפיין. כולל תוכן של קמפיין שמקושר לאמן.</div>
        </div>
        <button onClick={() => setAdding(true)} style={{ padding: "8px 14px", borderRadius: 9, border: "none", background: "#DC2626", color: "#fff", fontSize: 12.5, fontWeight: 800, cursor: "pointer" }}>+ תוכן חדש</button>
      </div>
      {state === "loading" ? <div style={{ color: "#A0A0A0", fontSize: 13 }}>טוען…</div>
        : state === "error" ? <div style={{ color: "#F59E0B", fontSize: 13 }}>לא הצלחתי לקרוא את התוכן — זה לא אומר שאין תוכן. <button onClick={reload} style={{ background: "none", border: "none", color: "#60A5FA", cursor: "pointer" }}>נסה שוב</button></div>
        : items.length === 0 ? <div style={{ color: "#A0A0A0", fontSize: 13 }}>עוד אין תוכן ל{artistName}. אפשר להוסיף כאן, או לבקש מסאני להכין תוכנית — היא תציג לך תצוגה מקדימה ותחכה לאישור.</div>
        : <ContentItemsTable items={items} onUpdate={(id, p) => changed(updateItem(id, p))} onDelete={(id) => changed(deleteItem(id))} campaignProjectId={null} />}
      {adding && <AddContentModal campaignId={null} projectId={null} onAdd={(i) => changed(addItem(i))} onClose={() => setAdding(false)} onFileUploaded={() => { reload(); onChanged?.(); }} />}
    </section>
  );
}
