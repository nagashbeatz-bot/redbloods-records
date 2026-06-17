"use client";

import { useState } from "react";
import type { SocialContentItem, SocialContentStatus, SocialPlatform, SocialContentFile } from "@/lib/types";
import {
  SOCIAL_CONTENT_STATUS_LABELS,
  SOCIAL_CONTENT_STATUS_COLORS,
  SOCIAL_CONTENT_STATUSES,
  SOCIAL_PLATFORM_LABELS,
  SOCIAL_PLATFORM_ICONS,
  fileTypeIcon,
  dropboxRawUrl,
} from "@/lib/types";
import ContentItemDetail from "./ContentItemDetail";
import MediaPreviewModal from "./MediaPreviewModal";

interface Props {
  items: SocialContentItem[];
  onUpdate: (id: string, patch: Partial<SocialContentItem>) => Promise<unknown>;
  onDelete: (id: string) => Promise<void>;
  fileCounts?: Record<string, number>;
  filesByItem?: Record<string, SocialContentFile[]>;
  campaignProjectId?: string | null;
}

function formatDate(d: string | null) {
  if (!d) return "—";
  const [, m, day] = d.split("-");
  return `${parseInt(day)}/${parseInt(m)}`;
}

function isOverdue(item: SocialContentItem) {
  if (!item.due_date || item.status === "posted" || item.status === "cancelled") return false;
  return item.due_date < new Date().toISOString().slice(0, 10);
}

function FileLinks({ item }: { item: SocialContentItem }) {
  const links = [
    item.asset_link && { href: item.asset_link, icon: "📁", label: "קובץ" },
    item.dropbox_link && { href: item.dropbox_link, icon: "📦", label: "Dropbox" },
    item.posted_url && { href: item.posted_url, icon: "🔗", label: "פוסט" },
  ].filter(Boolean) as { href: string; icon: string; label: string }[];

  if (links.length === 0) return <span style={{ color: "#333", fontSize: 12 }}>—</span>;

  return (
    <div style={{ display: "flex", gap: 4 }}>
      {links.map(({ href, icon, label }) => (
        <a
          key={href}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          title={label}
          onClick={(e) => e.stopPropagation()}
          style={{
            fontSize: 14, textDecoration: "none",
            padding: "2px 6px", borderRadius: 6,
            background: "#252525", border: "1px solid #333",
          }}
        >
          {icon}
        </a>
      ))}
    </div>
  );
}

function MediaThumb({ files, onPreview }: { files: SocialContentFile[]; onPreview: (f: SocialContentFile) => void }) {
  const first = files[0];
  const count = files.length;
  const isImage = first.file_type.startsWith("image/");
  const isVideo = first.file_type.startsWith("video/");
  const rawUrl = first.dropbox_share_link ? dropboxRawUrl(first.dropbox_share_link) : null;
  const [imgFailed, setImgFailed] = useState(false);

  const W = 56, H = 42;
  const containerStyle: React.CSSProperties = { width: W, height: H, borderRadius: 6, border: "1px solid #333", overflow: "hidden", flexShrink: 0 };

  let media: React.ReactNode;
  if (isImage && rawUrl && !imgFailed) {
    // eslint-disable-next-line @next/next/no-img-element
    media = <img src={rawUrl} alt={first.file_name} style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={() => setImgFailed(true)} />;
  } else if (isVideo && rawUrl) {
    media = (
      <div style={{ position: "relative", width: "100%", height: "100%" }}>
        <video
          src={rawUrl} preload="metadata" muted playsInline
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
          onLoadedMetadata={(e) => { e.currentTarget.currentTime = 1; }}
        />
        <div style={{ position: "absolute", bottom: 3, left: 3, background: "rgba(0,0,0,0.6)", borderRadius: 4, fontSize: 8, color: "#fff", padding: "1px 4px", lineHeight: 1.4 }}>▶</div>
      </div>
    );
  } else {
    const shortName = first.file_name.length > 12 ? first.file_name.slice(0, 11) + "…" : first.file_name;
    media = (
      <div style={{ width: "100%", height: "100%", background: "#252525", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2 }}>
        <span style={{ fontSize: 16 }}>{fileTypeIcon(first.file_type)}</span>
        <span style={{ fontSize: 8, color: "#666", textAlign: "center", lineHeight: 1.2 }}>{shortName}</span>
      </div>
    );
  }

  return (
    <div onClick={(e) => { e.stopPropagation(); onPreview(first); }} title={first.file_name} style={{ position: "relative", display: "inline-flex", cursor: "pointer" }}>
      <div style={containerStyle}>{media}</div>
      {count > 1 && (
        <span style={{ position: "absolute", top: -4, right: -6, fontSize: 9, fontWeight: 800, lineHeight: 1, background: "#EC4899", color: "#fff", borderRadius: 8, padding: "2px 4px", border: "1px solid #1A1A1A" }}>
          +{count - 1}
        </span>
      )}
    </div>
  );
}

export default function ContentItemsTable({ items, onUpdate, onDelete, fileCounts = {}, filesByItem = {}, campaignProjectId }: Props) {
  const [selectedItem, setSelectedItem] = useState<SocialContentItem | null>(null);
  const [previewFile, setPreviewFile] = useState<SocialContentFile | null>(null);

  async function handleStatusChange(id: string, status: SocialContentStatus, e: React.ChangeEvent<HTMLSelectElement>) {
    e.stopPropagation();
    await onUpdate(id, { status });
  }

  if (items.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "40px 0", color: "#555", fontSize: 14 }}>
        אין תכנים עדיין — לחץ &quot;+ תוכן חדש&quot; להתחלה
      </div>
    );
  }

  return (
    <>
      {/* Desktop table */}
      <div className="hidden md:block" style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #2A2A2A" }}>
              {["תוכן", "סוג", "פלטפורמה", "סטטוס", "תאריך יעד", "אחראי", "קבצים"].map((h) => (
                <th key={h} style={{ padding: "8px 10px", color: "#555", fontWeight: 600, textAlign: "right", whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const overdue = isOverdue(item);
              const itemFiles = filesByItem[item.id] ?? [];
              return (
                <tr
                  key={item.id}
                  onClick={() => setSelectedItem(item)}
                  style={{ borderBottom: "1px solid #1E1E1E", cursor: "pointer" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#1E1E1E")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <td style={{ padding: "10px 10px", color: "#E0E0E0", fontWeight: 600, maxWidth: 180 }}>
                    <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.title}</div>
                    {item.hook && <div style={{ fontSize: 11, color: "#555", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.hook}</div>}
                  </td>
                  <td style={{ padding: "10px 10px", color: "#888", whiteSpace: "nowrap" }}>{item.content_type || "—"}</td>
                  <td style={{ padding: "10px 10px", whiteSpace: "nowrap" }}>
                    {item.platform ? (
                      <span style={{ display: "flex", alignItems: "center", gap: 4, color: "#AAA" }}>
                        <span>{SOCIAL_PLATFORM_ICONS[item.platform as SocialPlatform]}</span>
                        {SOCIAL_PLATFORM_LABELS[item.platform as SocialPlatform]}
                      </span>
                    ) : "—"}
                  </td>
                  <td style={{ padding: "10px 10px" }} onClick={(e) => e.stopPropagation()}>
                    <select
                      value={item.status}
                      onChange={(e) => handleStatusChange(item.id, e.target.value as SocialContentStatus, e)}
                      style={{
                        fontSize: 12, fontWeight: 700, padding: "3px 8px", borderRadius: 20,
                        border: "none", cursor: "pointer", fontFamily: "inherit",
                        background: SOCIAL_CONTENT_STATUS_COLORS[item.status] + "22",
                        color: SOCIAL_CONTENT_STATUS_COLORS[item.status],
                      }}
                    >
                      {SOCIAL_CONTENT_STATUSES.map((s) => (
                        <option key={s} value={s}>{SOCIAL_CONTENT_STATUS_LABELS[s]}</option>
                      ))}
                    </select>
                  </td>
                  <td style={{ padding: "10px 10px", whiteSpace: "nowrap", color: overdue ? "#EF4444" : "#888" }}>
                    {formatDate(item.due_date)}
                    {overdue && <span style={{ fontSize: 10, marginRight: 4 }}>⚠</span>}
                  </td>
                  <td style={{ padding: "10px 10px", color: "#888", whiteSpace: "nowrap" }}>{item.owner_name || "—"}</td>
                  <td style={{ padding: "10px 10px" }} onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {itemFiles.length > 0 ? (
                        <MediaThumb files={itemFiles} onPreview={setPreviewFile} />
                      ) : (
                        <FileLinks item={item} />
                      )}
                      {(fileCounts[item.id] ?? 0) > 1 && itemFiles.length === 0 && (
                        <span style={{
                          fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 8,
                          background: "#EC489922", border: "1px solid #EC489944", color: "#EC4899",
                        }}>
                          {fileCounts[item.id]} 📎
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile cards — note: no inline display so md:hidden can take effect */}
      <div className="md:hidden" style={{ flexDirection: "column", gap: 10 }}>
        {items.map((item) => {
          const overdue = isOverdue(item);
          const statusColor = SOCIAL_CONTENT_STATUS_COLORS[item.status];
          const itemFiles = filesByItem[item.id] ?? [];
          return (
            <div
              key={item.id}
              onClick={() => setSelectedItem(item)}
              style={{
                background: "#1A1A1A", borderRadius: 12,
                border: `1px solid ${overdue ? "#EF444433" : "#2A2A2A"}`,
                padding: "12px 14px", cursor: "pointer",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#E0E0E0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.title}</div>
                  {item.content_type && <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>{item.content_type}</div>}
                </div>
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 20,
                  background: statusColor + "22", color: statusColor, whiteSpace: "nowrap", marginRight: 8,
                }}>
                  {SOCIAL_CONTENT_STATUS_LABELS[item.status]}
                </span>
              </div>
              <div style={{ display: "flex", gap: 12, fontSize: 12, color: "#666", flexWrap: "wrap", alignItems: "center" }}>
                {item.platform && (
                  <span>{SOCIAL_PLATFORM_ICONS[item.platform as SocialPlatform]} {SOCIAL_PLATFORM_LABELS[item.platform as SocialPlatform]}</span>
                )}
                {item.due_date && (
                  <span style={{ color: overdue ? "#EF4444" : "#666" }}>
                    {overdue && "⚠ "}{formatDate(item.due_date)}
                  </span>
                )}
                {item.owner_name && <span>{item.owner_name}</span>}
                {itemFiles.length > 0 ? (
                  <MediaThumb files={itemFiles} onPreview={setPreviewFile} />
                ) : (
                  <FileLinks item={item} />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {selectedItem && (
        <ContentItemDetail
          item={selectedItem}
          campaignProjectId={campaignProjectId}
          onUpdate={async (id, patch) => {
            await onUpdate(id, patch);
            setSelectedItem(null);
          }}
          onDelete={async (id) => {
            await onDelete(id);
            setSelectedItem(null);
          }}
          onClose={() => setSelectedItem(null)}
        />
      )}

      {previewFile && (
        <MediaPreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />
      )}
    </>
  );
}
