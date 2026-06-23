"use client";

import React, { useState, useEffect } from "react";
import type { SocialCampaign, SocialContentItem, SocialContentFile, SocialContentStatus, SocialPlatform } from "@/lib/types";
import {
  SOCIAL_CONTENT_STATUS_LABELS,
  SOCIAL_CONTENT_STATUS_COLORS,
  SOCIAL_PLATFORM_ICONS,
} from "@/lib/types";

// ── Design Tokens ──────────────────────────────────────────────────────────────
const BRAND  = "#DC2626";
const GREEN  = "#10B981";
const AMBER  = "#F59E0B";
const PURPLE = "#8B5CF6";
const CYAN   = "#06B6D4";
const BLUE   = "#3B82F6";
const BG     = "#090910";
const CARD   = "rgba(255,255,255,0.058)";
const CARD2  = "rgba(255,255,255,0.085)";
const BDR    = "rgba(255,255,255,0.10)";
const BDR2   = "rgba(255,255,255,0.18)";
const TEXT   = "#F2F2F2";
const TEXT2  = "#A0A0B0";
const MUTED  = "#52526A";
const LABEL  = "#70709A";

const PLT_COLORS: Record<string, string> = {
  tiktok: "#EE1D52", instagram: "#E1306C", youtube: "#FF0000",
  spotify: "#1DB954", other: MUTED,
};

// ── Mock Data ──────────────────────────────────────────────────────────────────
const ARTIST_NAME  = "שליו טסמה";
const ARTIST_GENRE = "אפרו / פופ";
const ARTIST_ROLE  = "אמן / יוצר";
const CAMPAIGN_NAME = "פרנציפ";
const CAMPAIGN_TYPE = "סינגל";
const CAMPAIGN_DATE = "30.06.26";

const TYPE_COLORS: Record<string, string> = {
  "סינגל": "#DC2626",
  "BTS":    "#3B82F6",
  "תדמית": "#10B981",
};

type MockRow = {
  id: string; num: string; title: string; content_type: string;
  platforms: SocialPlatform[]; campaign: string;
  status: SocialContentStatus;
  publish_date: string; publish_time?: string;
  assets: number; notes: string;
};

const MOCK_ROWS: MockRow[] = [
  { id:"1", num:"001", title:"טיזר ראשון",   content_type:"סינגל", platforms:["instagram","tiktok","youtube"],  campaign:"קמפיין: פרנציפ",            status:"scheduled",    publish_date:"21.06.26", publish_time:"20:00", assets:2, notes:"ללא הערות"   },
  { id:"2", num:"002", title:"קאבר סינגל",   content_type:"סינגל", platforms:["spotify","instagram","youtube"], campaign:"קמפיין: פרנציפ",            status:"needs_review", publish_date:"23.06.26", publish_time:"19:00", assets:1, notes:"לאישור אמן"  },
  { id:"3", num:"003", title:"BTS מהקליפ",   content_type:"BTS",   platforms:["instagram","tiktok"],            campaign:"קמפיין BTS קליפ - פרנציפ", status:"in_edit",      publish_date:"24.06.26", publish_time:"19:00", assets:3, notes:"עריכה אחרונה" },
  { id:"4", num:"004", title:"סטורי הכרזה",  content_type:"תדמית", platforms:["instagram"],                     campaign:"קמפיין תדמית - שליו טסמה", status:"ready",        publish_date:"26.06.26", publish_time:"12:00", assets:0, notes:"עיצוב גרפי"  },
];

const MOCK_FILES: FileCard[] = [
  { id:"f1", name:"טיזר_ראשון.mp4",      ext:"MP4", ctx:"קמפיין: פרנציפ",            type:"video", dur:"00:18", label:"טיזר",  accent:GREEN,    thumb:"linear-gradient(145deg,#011A0A 0%,#044020 35%,#087C40 65%,#10B981 95%)",    link:null, contentItemId:null },
  { id:"f2", name:"קאבר_סינגל.jpg",      ext:"JPG", ctx:"קמפיין: פרנציפ",            type:"image", dur:null,    label:"קאבר",  accent:BLUE,     thumb:"linear-gradient(145deg,#060618 0%,#0F1540 35%,#1E3A8A 65%,#3B82F6 95%)",    link:null, contentItemId:null },
  { id:"f3", name:"BTS_מהקליפ.mp4",      ext:"MP4", ctx:"קמפיין BTS קליפ - פרנציפ", type:"video", dur:"00:27", label:"BTS",   accent:GREEN,    thumb:"linear-gradient(145deg,#011A0A 0%,#044020 35%,#087C40 65%,#10B981 95%)",    link:null, contentItemId:null },
  { id:"f4", name:"שליו_סטודיו.jpg",     ext:"JPG", ctx:"קמפיין תדמית - שליו טסמה", type:"image", dur:null,    label:"תדמית", accent:BLUE,     thumb:"linear-gradient(145deg,#060618 0%,#0F1540 35%,#1E3A8A 65%,#3B82F6 95%)",    link:null, contentItemId:null },
  { id:"f5", name:"לוגו_פרנציפ.png",    ext:"PNG", ctx:"קמפיין: פרנציפ",            type:"image", dur:null,    label:"לוגו",  accent:"#C026D3",thumb:"linear-gradient(145deg,#1A0015 0%,#4A0040 35%,#8B0070 65%,#C026D3 95%)",    link:null, contentItemId:null },
  { id:"f6", name:"BTS_קליפ4.mp4",       ext:"MP4", ctx:"קמפיין BTS קליפ - פרנציפ", type:"video", dur:"00:32", label:"BTS",   accent:GREEN,    thumb:"linear-gradient(145deg,#011A0A 0%,#044020 35%,#087C40 65%,#10B981 95%)",    link:null, contentItemId:null },
];

const WEEK_DAYS = [
  { label:"שבת",   date:"21.06", today:false, items:[
    { t:"סינגל ראשון",  c:BRAND,  time:"20:00", icon:"📢" },
    { t:"סטורי הכרזה", c:PURPLE, time:"12:00", icon:"✏️" },
  ]},
  { label:"ראשון", date:"22.06", today:false, items:[
    { t:"טיזר ראשון",  c:BRAND,  time:"18:00", icon:"🎬" },
    { t:"סטורי הכרזה", c:PURPLE, time:"12:00", icon:"✏️" },
  ]},
  { label:"שני",   date:"23.06", today:true,  items:[
    { t:"קאבר סינגל",  c:BLUE,   time:"19:00", icon:"🎵" },
    { t:"סטורי הכרזה", c:PURPLE, time:"12:00", icon:"✏️" },
  ]},
  { label:"שלישי", date:"24.06", today:false, items:[
    { t:"BTS מהקליפ",  c:GREEN,  time:"18:00", icon:"🎬" },
    { t:"קאבר סינגל",  c:BLUE,   time:"19:00", icon:"🎵" },
  ]},
  { label:"רביעי", date:"25.06", today:false, items:[] },
  { label:"חמישי", date:"26.06", today:false, items:[
    { t:"סטורי הכרזה", c:PURPLE, time:"12:00", icon:"✏️" },
    { t:"טיזר שני",    c:BRAND,  time:"18:00", icon:"🎬" },
  ]},
  { label:"שישי",  date:"27.06", today:false, items:[
    { t:"סטורי הכרזה", c:PURPLE, time:"12:00", icon:"✏️" },
  ]},
];

type DisplayCampaign = { id: string; title: string; type?: string; progress: number; deadline: string; color: string; };

const MOCK_CAMPAIGNS: DisplayCampaign[] = [
  { id:"c1", title:"השקת סינגל — פרנציפ",      type:"סינגל", progress:68, deadline:"30.06.26", color:BRAND },
  { id:"c2", title:"BTS קליפ — פרנציפ",         type:"BTS",   progress:42, deadline:"05.07.26", color:BLUE  },
  { id:"c3", title:"קמפיין תדמית — שליו טסמה", type:"תדמית", progress:25, deadline:"15.07.26", color:GREEN },
];

const MOCK_ACTIVITY = [
  { id:"a1", init:"ש", user:"שליו",  text:"עדכן סטטוס של 'קאבר סינגל' לממתין לאישור", time:"לפני 12 דקות", color:GREEN },
  { id:"a2", init:"מ", user:"מיכל",  text:"העלתה קובץ חדש: BTS_מהקליפ.mp4",           time:"לפני 36 דקות", color:BLUE  },
  { id:"a3", init:"ד", user:"דניאל", text:"הוסיף הערה לפריט 'טיזר ראשון'",             time:"לפני שעה",     color:AMBER },
];

// ── File card helpers ──────────────────────────────────────────────────────────
type FileCard = {
  id: string; name: string; ext: string; ctx: string;
  type: "image" | "video"; dur: string | null;
  label: string; accent: string; thumb: string;
  link: string | null;
  contentItemId: string | null;
};

function toDirectLink(link: string): string {
  return link
    .replace("www.dropbox.com", "dl.dropboxusercontent.com")
    .replace("?dl=0", "")
    .replace("&dl=0", "");
}

const EXT_STYLES: Record<string, { accent: string; thumb: string }> = {
  MP4:  { accent: GREEN,     thumb: "linear-gradient(145deg,#011A0A 0%,#044020 35%,#087C40 65%,#10B981 95%)" },
  MOV:  { accent: GREEN,     thumb: "linear-gradient(145deg,#011A0A 0%,#044020 35%,#087C40 65%,#10B981 95%)" },
  JPG:  { accent: BLUE,      thumb: "linear-gradient(145deg,#060618 0%,#0F1540 35%,#1E3A8A 65%,#3B82F6 95%)" },
  JPEG: { accent: BLUE,      thumb: "linear-gradient(145deg,#060618 0%,#0F1540 35%,#1E3A8A 65%,#3B82F6 95%)" },
  PNG:  { accent: "#C026D3", thumb: "linear-gradient(145deg,#1A0015 0%,#4A0040 35%,#8B0070 65%,#C026D3 95%)" },
  PSD:  { accent: PURPLE,    thumb: "linear-gradient(145deg,#09060F 0%,#1E0A3E 35%,#3B1A8A 65%,#8B5CF6 95%)" },
  PDF:  { accent: BRAND,     thumb: "linear-gradient(145deg,#3D0000 0%,#8B0000 35%,#DC2626 65%,#FF7B50 95%)" },
};

function mapApiFileToCard(f: SocialContentFile, idx: number): FileCard {
  const ext = (f.file_name.split(".").pop() ?? "FILE").toUpperCase();
  const isVideo = f.file_type ? f.file_type.startsWith("video") : (ext === "MP4" || ext === "MOV");
  const style = EXT_STYLES[ext] ?? {
    accent: AMBER,
    thumb: "linear-gradient(145deg,#150900 0%,#3D1E00 35%,#7A4500 65%,#F59E0B 95%)",
  };
  const labels = ["קאבר", "BTS", "ריל", "טיזר", "קליפ", "סטורי", "פוסט", "אחר"];
  return {
    id: f.id,
    name: f.file_name,
    ext,
    ctx: f.file_name,
    type: isVideo ? "video" : "image",
    dur: null,
    label: labels[idx % labels.length],
    accent: style.accent,
    thumb: style.thumb,
    link: f.dropbox_share_link ?? null,
    contentItemId: f.content_item_id ?? null,
  };
}

// ── Sub-components ─────────────────────────────────────────────────────────────
function ProgressRing({ pct, color, size = 52 }: { pct: number; color: string; size?: number }) {
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (pct / 100) * circ;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={BDR2} strokeWidth={5} />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={5}
        strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round" />
    </svg>
  );
}

function StatusBadge({ status }: { status: SocialContentStatus }) {
  const color = SOCIAL_CONTENT_STATUS_COLORS[status] ?? MUTED;
  const label = SOCIAL_CONTENT_STATUS_LABELS[status] ?? status;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", padding: "3px 10px",
      borderRadius: 20, fontSize: 11, fontWeight: 700, whiteSpace: "nowrap",
      background: color + "2C", border: `1px solid ${color}70`, color,
    }}>{label}</span>
  );
}

function PlatformBadge({ platform }: { platform: SocialPlatform }) {
  const icon  = SOCIAL_PLATFORM_ICONS[platform] ?? "🌐";
  const color = PLT_COLORS[platform] ?? MUTED;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      width: 28, height: 28, borderRadius: 7, fontSize: 15, flexShrink: 0,
      background: color + "22", border: `1px solid ${color}60`,
    }}>{icon}</span>
  );
}

// Card with optional colored accent border + glow
function SCard({
  children, style, accent,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
  accent?: string;
}) {
  return (
    <div style={{
      background: CARD,
      border: `1px solid ${accent ? accent + "45" : BDR}`,
      borderRadius: 16,
      padding: 20,
      boxShadow: accent ? `0 4px 28px ${accent}18` : "0 2px 18px rgba(0,0,0,0.4)",
      ...style,
    }}>
      {children}
    </div>
  );
}

// ── Shared modal input style ───────────────────────────────────────────────────
const MINPUT: React.CSSProperties = {
  width: "100%", padding: "10px 12px", borderRadius: 9, fontSize: 13,
  background: "rgba(255,255,255,0.085)", border: "1px solid rgba(255,255,255,0.18)",
  color: "#F2F2F2", outline: "none", boxSizing: "border-box",
  fontFamily: "'Heebo', Arial, sans-serif", direction: "rtl",
};

// ── CustomSelect (dark dropdown — replaces native select in modals) ───────────
function CustomSelect({
  value, onChange, options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const selected = options.find(o => o.value === value);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          ...MINPUT,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          cursor: "pointer", userSelect: "none",
        }}
      >
        <span style={{ color: selected ? "#F2F2F2" : "#52526A" }}>
          {selected?.label ?? "בחר..."}
        </span>
        <span style={{ fontSize: 9, opacity: 0.55 }}>{open ? "▲" : "▼"}</span>
      </div>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
          zIndex: 10001, background: "#15151F",
          border: "1px solid rgba(255,255,255,0.18)", borderRadius: 9,
          boxShadow: "0 10px 32px rgba(0,0,0,0.85)", maxHeight: 220, overflowY: "auto",
        }}>
          {options.map(opt => (
            <div
              key={opt.value}
              onClick={() => { onChange(opt.value); setOpen(false); }}
              style={{
                padding: "9px 12px", fontSize: 13, direction: "rtl", cursor: "pointer",
                color: opt.value === value ? "#DC2626" : "#F2F2F2",
                background: opt.value === value ? "rgba(220,38,38,0.10)" : "transparent",
              }}
              onMouseEnter={e => { if (opt.value !== value) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.07)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = opt.value === value ? "rgba(220,38,38,0.10)" : "transparent"; }}
            >
              {opt.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── AddContentItemModal ────────────────────────────────────────────────────────
function AddContentItemModal({
  campaignId, onClose, onSuccess,
}: {
  campaignId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [title, setTitle] = useState("");
  const [contentType, setContentType] = useState("טיזר");
  const [platform, setPlatform] = useState("");
  const [publishDate, setPublishDate] = useState("");
  const [status, setStatus] = useState<SocialContentStatus>("idea");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    if (!title.trim() || saving) return;
    setSaving(true); setError("");
    try {
      const res = await fetch("/api/social/content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaign_id: campaignId,
          title: title.trim(),
          content_type: contentType,
          platform: platform || null,
          publish_date: publishDate || null,
          status,
          notes,
        }),
      });
      if (!res.ok) throw new Error();
      onSuccess(); onClose();
    } catch {
      setError("שגיאה בשמירה — נסה שוב");
    } finally {
      setSaving(false);
    }
  }

  const canSave = title.trim().length > 0 && !saving;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      background: "rgba(0,0,0,0.78)", backdropFilter: "blur(6px)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }} onClick={onClose}>
      <div style={{
        background: "#0D0D16", border: "1px solid rgba(255,255,255,0.18)",
        borderRadius: 18, padding: "28px 28px 24px",
        width: 480, maxWidth: "92vw",
        boxShadow: "0 24px 80px rgba(0,0,0,0.85), 0 0 60px rgba(220,38,38,0.07)",
        direction: "rtl",
      }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 22 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 900, color: "#F2F2F2" }}>+ פריט תוכן חדש</div>
            <div style={{ fontSize: 11, color: "#52526A", marginTop: 2 }}>הוספת פריט תוכן לקמפיין</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#52526A", fontSize: 20, cursor: "pointer", padding: "0 4px", transition: "none" }}>✕</button>
        </div>

        {/* Fields */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#70709A", marginBottom: 6 }}>שם הפריט *</div>
            <input
              value={title} onChange={e => setTitle(e.target.value)}
              placeholder="לדוגמה: טיזר ראשון, קאבר סינגל..."
              autoFocus
              style={MINPUT}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#70709A", marginBottom: 6 }}>סוג תוכן</div>
              <CustomSelect
                value={contentType}
                onChange={setContentType}
                options={["טיזר","BTS","ליפסינק","סטורי","קליפ קצר","פוסט","ריל","הכרזה","תוכן אישי","אחר"].map(t => ({ value: t, label: t }))}
              />
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#70709A", marginBottom: 6 }}>פלטפורמה</div>
              <CustomSelect
                value={platform}
                onChange={setPlatform}
                options={[
                  { value: "", label: "— ללא —" },
                  { value: "instagram", label: "Instagram" },
                  { value: "tiktok", label: "TikTok" },
                  { value: "youtube", label: "YouTube" },
                  { value: "spotify", label: "Spotify" },
                  { value: "other", label: "אחר" },
                ]}
              />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#70709A", marginBottom: 6 }}>תאריך פרסום</div>
              <input type="date" value={publishDate} onChange={e => setPublishDate(e.target.value)} style={{ ...MINPUT, colorScheme: "dark" }} />
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#70709A", marginBottom: 6 }}>סטטוס</div>
              <CustomSelect
                value={status}
                onChange={v => setStatus(v as SocialContentStatus)}
                options={(["idea","needs_shoot","shot","in_edit","needs_review","ready","scheduled","posted"] as SocialContentStatus[]).map(s => ({
                  value: s,
                  label: SOCIAL_CONTENT_STATUS_LABELS[s],
                }))}
              />
            </div>
          </div>

          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#70709A", marginBottom: 6 }}>הערות</div>
            <textarea
              value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="הערות נוספות..." rows={2}
              style={{ ...MINPUT, resize: "none" } as React.CSSProperties}
            />
          </div>
        </div>

        {error && <div style={{ fontSize: 12, color: "#EF4444", marginTop: 10 }}>{error}</div>}

        {/* Footer */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 20, paddingTop: 16, borderTop: "1px solid rgba(255,255,255,0.10)" }}>
          <button onClick={onClose} style={{ padding: "9px 18px", borderRadius: 8, fontSize: 12, fontWeight: 700, background: "none", border: "1px solid rgba(255,255,255,0.18)", color: "#A0A0B0", cursor: "pointer", transition: "none" }}>
            ביטול
          </button>
          <button onClick={handleSave} disabled={!canSave} style={{
            padding: "9px 24px", borderRadius: 8, fontSize: 12, fontWeight: 800,
            background: canSave ? "#DC2626" : "#52526A", border: "none", color: "#fff",
            cursor: canSave ? "pointer" : "default",
            boxShadow: canSave ? "0 2px 12px rgba(220,38,38,0.4)" : "none",
            transition: "none",
          }}>
            {saving ? "שומר..." : "שמור פריט"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── UploadAssetModal ───────────────────────────────────────────────────────────
function UploadAssetModal({
  campaignId, rows, onClose, onSuccess,
}: {
  campaignId: string;
  rows: MockRow[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [step, setStep] = useState<1 | 2>(rows.length === 0 ? 2 : 1);
  const [selectedItemId, setSelectedItemId] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);

  function handleFile(file: File) {
    if (!selectedItemId) { setError("יש לבחור פריט תוכן תחילה"); return; }
    setUploading(true); setProgress(0); setError("");
    const fd = new FormData();
    fd.append("file", file);
    fd.append("contentItemId", selectedItemId);
    fd.append("campaignId", campaignId);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/social/upload");
    xhr.upload.onprogress = e => { if (e.lengthComputable) setProgress(Math.round(e.loaded / e.total * 100)); };
    xhr.onload = () => {
      if (xhr.status === 200) { onSuccess(); onClose(); }
      else { setError("שגיאה בהעלאה — נסה שוב"); setUploading(false); }
    };
    xhr.onerror = () => { setError("שגיאה בהעלאה — נסה שוב"); setUploading(false); };
    xhr.send(fd);
  }

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      background: "rgba(0,0,0,0.78)", backdropFilter: "blur(6px)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }} onClick={onClose}>
      <div style={{
        background: "#0D0D16", border: "1px solid rgba(255,255,255,0.18)",
        borderRadius: 18, padding: "28px 28px 24px",
        width: 500, maxWidth: "92vw",
        boxShadow: "0 24px 80px rgba(0,0,0,0.85), 0 0 60px rgba(220,38,38,0.07)",
        direction: "rtl",
      }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 22 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 900, color: "#F2F2F2" }}>+ העלאת נכס</div>
            <div style={{ fontSize: 11, color: "#52526A", marginTop: 2 }}>
              {step === 1 ? "שלב 1 — בחר פריט תוכן לשיוך" : "שלב 2 — בחר קובץ להעלאה"}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ display: "flex", gap: 6 }}>
              {[1, 2].map(s => (
                <div key={s} style={{ width: 6, height: 6, borderRadius: "50%", background: step >= s ? "#DC2626" : "rgba(255,255,255,0.18)" }} />
              ))}
            </div>
            <button onClick={onClose} style={{ background: "none", border: "none", color: "#52526A", fontSize: 20, cursor: "pointer", padding: "0 4px", transition: "none" }}>✕</button>
          </div>
        </div>

        {/* Step 1 — pick content item */}
        {step === 1 && (
          <div>
            {rows.length === 0 ? (
              <div style={{ textAlign: "center", padding: "24px 0", color: "#52526A", fontSize: 13 }}>
                אין פריטי תוכן בקמפיין — צור פריט תוכן תחילה
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 320, overflowY: "auto" }}>
                {rows.map(row => (
                  <div key={row.id} onClick={() => setSelectedItemId(row.id)} style={{
                    padding: "12px 14px", borderRadius: 10,
                    background: selectedItemId === row.id ? "rgba(220,38,38,0.12)" : "rgba(255,255,255,0.05)",
                    border: `1px solid ${selectedItemId === row.id ? "rgba(220,38,38,0.45)" : "rgba(255,255,255,0.10)"}`,
                    cursor: "pointer",
                    transition: "none",
                  }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#F2F2F2" }}>{row.title}</div>
                    <div style={{ fontSize: 11, color: "#70709A", marginTop: 3 }}>{row.content_type} · {row.publish_date}</div>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 20, paddingTop: 16, borderTop: "1px solid rgba(255,255,255,0.10)" }}>
              <button onClick={onClose} style={{ padding: "9px 18px", borderRadius: 8, fontSize: 12, fontWeight: 700, background: "none", border: "1px solid rgba(255,255,255,0.18)", color: "#A0A0B0", cursor: "pointer", transition: "none" }}>ביטול</button>
              <button onClick={() => setStep(2)} disabled={!selectedItemId} style={{
                padding: "9px 24px", borderRadius: 8, fontSize: 12, fontWeight: 800,
                background: selectedItemId ? "#DC2626" : "#52526A", border: "none", color: "#fff",
                cursor: selectedItemId ? "pointer" : "default",
                boxShadow: selectedItemId ? "0 2px 12px rgba(220,38,38,0.4)" : "none",
                transition: "none",
              }}>הבא ←</button>
            </div>
          </div>
        )}

        {/* Step 2 — file upload */}
        {step === 2 && (
          <div>
            {!uploading ? (
              <div
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
                style={{
                  border: `2px dashed ${dragOver ? "#DC2626" : "rgba(255,255,255,0.22)"}`,
                  borderRadius: 12, padding: "36px 20px",
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
                  background: dragOver ? "rgba(220,38,38,0.06)" : "rgba(255,255,255,0.03)",
                  cursor: "pointer", transition: "none",
                }}
                onClick={() => { const i = document.createElement("input"); i.type = "file"; i.onchange = e => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) handleFile(f); }; i.click(); }}
              >
                <div style={{ fontSize: 36, opacity: 0.5 }}>☁</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#A0A0B0" }}>גרור קובץ לכאן</div>
                <div style={{ fontSize: 11, color: "#52526A" }}>או לחץ לבחירת קובץ · עד 500MB</div>
              </div>
            ) : (
              <div style={{ padding: "24px 0" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#F2F2F2", marginBottom: 12, textAlign: "center" }}>מעלה... {progress}%</div>
                <div style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,0.10)", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${progress}%`, background: "linear-gradient(90deg,#DC2626,#F97316)", borderRadius: 3, transition: "width 0.15s" }} />
                </div>
              </div>
            )}
            {error && <div style={{ fontSize: 12, color: "#EF4444", marginTop: 10 }}>{error}</div>}
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 20, paddingTop: 16, borderTop: "1px solid rgba(255,255,255,0.10)" }}>
              <button onClick={() => setStep(1)} disabled={uploading} style={{ padding: "9px 18px", borderRadius: 8, fontSize: 12, fontWeight: 700, background: "none", border: "1px solid rgba(255,255,255,0.18)", color: "#A0A0B0", cursor: uploading ? "default" : "pointer", transition: "none" }}>← חזרה</button>
              {selectedItemId && rows.find(r => r.id === selectedItemId) && (
                <div style={{ fontSize: 11, color: "#70709A", alignSelf: "center" }}>
                  משויך ל: {rows.find(r => r.id === selectedItemId)?.title}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────────
export default function SocialDesignPreview() {
  const [campaigns, setCampaigns] = useState<SocialCampaign[]>([]);
  const [rows, setRows] = useState<MockRow[]>([]);
  const [files, setFiles] = useState<FileCard[]>([]);
  const [socialLoading, setSocialLoading] = useState(true);
  const [selectedFile, setSelectedFile] = useState<FileCard | null>(null);
  const [searchQ, setSearchQ] = useState("");
  const [filterPlatform, setFilterPlatform] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterCampaign, setFilterCampaign] = useState("all");
  const [weekOffset, setWeekOffset] = useState(0);
  const [activeCampaignId, setActiveCampaignId] = useState<string | null>(null);
  const [showAddContent, setShowAddContent] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [deletingFileId, setDeletingFileId] = useState<string | null>(null);
  const [deleteInProgress, setDeleteInProgress] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/social/campaigns")
      .then(r => r.json())
      .then(d => {
        if (!Array.isArray(d.campaigns) || d.campaigns.length === 0) {
          setRows(MOCK_ROWS);
          setFiles(MOCK_FILES);
          setSocialLoading(false);
          return;
        }
        setCampaigns(d.campaigns);
        const active: SocialCampaign =
          d.campaigns.find((c: SocialCampaign) => c.status === "active") ?? d.campaigns[0];
        setActiveCampaignId(active.id);
        Promise.all([
          fetch(`/api/social/files?campaignId=${active.id}`)
            .then(r => r.json())
            .then(d => {
              if (Array.isArray(d.files) && d.files.length > 0)
                setFiles(d.files.slice(0, 6).map((f: SocialContentFile, i: number) => mapApiFileToCard(f, i)));
              else
                setFiles(MOCK_FILES);
            })
            .catch(() => setFiles(MOCK_FILES)),
          fetch(`/api/social/content?campaignId=${active.id}`)
            .then(r => r.json())
            .then(d => {
              if (!Array.isArray(d.items) || d.items.length === 0) { setRows(MOCK_ROWS); return; }
              setRows(
                d.items.slice(0, 8).map((item: SocialContentItem, idx: number) => ({
                  id: item.id,
                  num: String(idx + 1).padStart(3, "0"),
                  title: item.title,
                  content_type: item.content_type,
                  platforms: item.platform ? [(item.platform as SocialPlatform)] : [],
                  campaign: campaigns.find(c => c.id === item.campaign_id)?.title ?? "—",
                  status: item.status as SocialContentStatus,
                  publish_date: item.publish_date
                    ? new Date(item.publish_date).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" })
                    : "—",
                  publish_time: (() => {
                    if (!item.publish_date) return undefined;
                    try {
                      const d = new Date(item.publish_date);
                      const h = d.getHours(), m = d.getMinutes();
                      if (h === 0 && m === 0) return undefined;
                      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
                    } catch { return undefined; }
                  })(),
                  assets: item.asset_link ? 1 : 0,
                  notes: (item as unknown as { notes?: string }).notes ?? "",
                }))
              );
            })
            .catch(() => setRows(MOCK_ROWS)),
        ]).finally(() => setSocialLoading(false));
      })
      .catch(() => {
        setRows(MOCK_ROWS);
        setFiles(MOCK_FILES);
        setSocialLoading(false);
      });
  }, []);

  // KPI — gated by socialLoading so numbers never flash from fallback→real
  const missingAssets      = socialLoading ? null : (rows.filter(r => r.assets === 0).length             || 2);
  const pendingReview      = socialLoading ? null : (rows.filter(r => r.status === "needs_review").length || 4);
  const scheduledWeek      = socialLoading ? null : (rows.filter(r => r.status === "scheduled").length   || 9);
  const published          = socialLoading ? null : (rows.filter(r => r.status === "posted").length      || 18);
  const campaignProgress   = socialLoading ? null : `${MOCK_CAMPAIGNS[0]?.progress ?? 68}%`;

  // Campaigns — always show MOCK_CAMPAIGNS as structural stages (progress % not tracked in DB)
  const displayCampaigns: DisplayCampaign[] | null = socialLoading ? null : MOCK_CAMPAIGNS;

  const KPI_CARDS: { label: string; sub: string; icon: string; value: number | string | null; color: string }[] = [
    { label:"חסרים להשלמה",     sub:"דרוש טיפול",          icon:"⚠️", value:missingAssets,    color:"#EF4444" },
    { label:"ממתין לאישור",      sub:"אישור אמן / צוות",   icon:"⏳", value:pendingReview,    color:AMBER     },
    { label:"מתוזמנים",          sub:"השבוע הקרוב",         icon:"📅", value:scheduledWeek,    color:CYAN      },
    { label:"פורסמו",            sub:"מתוך הקמפיין",        icon:"📊", value:published,        color:GREEN     },
    { label:"התקדמות קמפיין",   sub:"לפי שלבי הקמפיין",   icon:"🎯", value:campaignProgress, color:BRAND     },
  ];

  function refreshContent() {
    if (!activeCampaignId) return;
    fetch(`/api/social/content?campaignId=${activeCampaignId}`)
      .then(r => r.json())
      .then(d => {
        if (!Array.isArray(d.items) || d.items.length === 0) return;
        setRows(d.items.slice(0, 8).map((item: SocialContentItem, idx: number) => ({
          id: item.id,
          num: String(idx + 1).padStart(3, "0"),
          title: item.title,
          content_type: item.content_type,
          platforms: item.platform ? [(item.platform as SocialPlatform)] : [],
          campaign: campaigns.find(c => c.id === item.campaign_id)?.title ?? "—",
          status: item.status as SocialContentStatus,
          publish_date: item.publish_date
            ? new Date(item.publish_date).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" })
            : "—",
          publish_time: undefined,
          assets: item.asset_link ? 1 : 0,
          notes: (item as unknown as { notes?: string }).notes ?? "",
        })));
      })
      .catch(() => {});
  }

  function refreshFiles() {
    if (!activeCampaignId) return;
    fetch(`/api/social/files?campaignId=${activeCampaignId}`)
      .then(r => r.json())
      .then(d => {
        if (Array.isArray(d.files) && d.files.length > 0)
          setFiles(d.files.slice(0, 6).map((f: SocialContentFile, i: number) => mapApiFileToCard(f, i)));
        else
          setFiles([]);
      })
      .catch(() => {});
  }

  async function handleDeleteFile(fileId: string) {
    setDeleteInProgress(fileId);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/social/files?id=${fileId}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setDeletingFileId(null);
      refreshFiles();
    } catch {
      setDeleteError(fileId);
    } finally {
      setDeleteInProgress(null);
    }
  }

  const filteredRows = rows.filter(r => {
    const matchQ = !searchQ || r.title.includes(searchQ) || r.content_type.includes(searchQ);
    const matchP = filterPlatform === "all" || (r.platforms ?? []).includes(filterPlatform as SocialPlatform);
    const matchS = filterStatus   === "all" || r.status === filterStatus;
    const matchC = filterCampaign === "all" || r.campaign === filterCampaign;
    return matchQ && matchP && matchS && matchC;
  });

  // Map contentItemId → FileCard[] for thumbnail lookup in table (supports multiple files per item)
  const filesByContentItem: Record<string, FileCard[]> = {};
  for (const f of files) {
    if (!f.contentItemId) continue;
    if (!filesByContentItem[f.contentItemId]) filesByContentItem[f.contentItemId] = [];
    filesByContentItem[f.contentItemId].push(f);
  }
  const rowByContentItemId: Record<string, MockRow> = Object.fromEntries(
    rows.map(r => [r.id, r])
  );

  const selStyle: React.CSSProperties = {
    padding: "6px 10px", borderRadius: 8, fontSize: 12, fontWeight: 600,
    background: CARD2, border: `1px solid ${BDR2}`, color: TEXT2,
    cursor: "pointer", outline: "none", direction: "rtl",
  };

  return (
    <div style={{
      minHeight: "100vh", background: BG, direction: "rtl",
      fontFamily: "'Heebo', Arial, sans-serif", color: TEXT,
      padding: "16px 8px 80px",
    }}>
      <div style={{ maxWidth: 1800, margin: "0 auto", padding: "0 8px" }}>

        {/* ── Block 1: Page Header ─────────────────────────────────────────── */}
        <div style={{ marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
            <h1 style={{
              margin: 0, fontSize: 27, fontWeight: 900, letterSpacing: "-0.02em",
              background: `linear-gradient(130deg, ${TEXT} 55%, ${BRAND} 100%)`,
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
            }}>
              קמפיין — {CAMPAIGN_NAME}
            </h1>
            <span style={{ fontSize: 17 }}>🎯</span>
          </div>
          <p style={{ margin: 0, fontSize: 12, color: TEXT2 }}>
            {ARTIST_NAME} · {CAMPAIGN_TYPE} · תאריך יציאה {CAMPAIGN_DATE}
          </p>
        </div>

        {/* ── Block 2: Artist Card + KPI Row ───────────────────────────────── */}
        <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 16, marginBottom: 16 }}>

          {/* Artist Card */}
          <SCard accent={BRAND} style={{
            display: "flex", flexDirection: "column", gap: 14, padding: "20px 18px",
            background: "linear-gradient(145deg, rgba(220,38,38,0.07) 0%, rgba(255,255,255,0.04) 100%)",
          }}>
            {/* Top: avatar + name */}
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{
                width: 72, height: 72, borderRadius: "50%", flexShrink: 0,
                background: "linear-gradient(145deg, #5A0000, #DC2626 60%, #FF7B50)",
                border: `2px solid rgba(220,38,38,0.55)`,
                boxShadow: "0 0 22px rgba(220,38,38,0.4), 0 0 50px rgba(220,38,38,0.1)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 30,
              }}>🎤</div>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800, color: TEXT, marginBottom: 2 }}>{ARTIST_NAME}</div>
                <div style={{ fontSize: 11, color: TEXT2 }}>{ARTIST_ROLE}</div>
                <div style={{ fontSize: 10, color: MUTED, marginTop: 1 }}>{ARTIST_GENRE}</div>
              </div>
            </div>

            {/* Stats row */}
            <div style={{
              display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4,
              padding: "10px 0",
              borderTop: `1px solid ${BDR}`, borderBottom: `1px solid ${BDR}`,
            }}>
              {[
                { val: "48", lbl: "פוסטים"   },
                { val: "12", lbl: "קמפיינים"},
                { val: "3",  lbl: "שלבים"   },
              ].map(s => (
                <div key={s.lbl} style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 18, fontWeight: 900, color: TEXT, lineHeight: 1 }}>{s.val}</div>
                  <div style={{ fontSize: 9, color: MUTED, marginTop: 3, letterSpacing: "0.03em" }}>{s.lbl}</div>
                </div>
              ))}
            </div>

            <button style={{
              padding: "8px 14px", borderRadius: 8, fontSize: 11, fontWeight: 700,
              background: "rgba(220,38,38,0.13)", border: "1px solid rgba(220,38,38,0.38)",
              color: BRAND, cursor: "pointer", outline: "none", width: "100%",
              boxShadow: "0 2px 10px rgba(220,38,38,0.12)",
              transition: "none",
            }}>
              הצג פרופיל אמן ↗
            </button>
          </SCard>

          {/* KPI Cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
            {KPI_CARDS.map(kpi => (
              <SCard key={kpi.label} accent={kpi.color} style={{
                padding: "18px 18px",
                display: "flex", flexDirection: "column", justifyContent: "space-between",
                background: `linear-gradient(145deg, ${kpi.color}09 0%, ${CARD} 100%)`,
                position: "relative", overflow: "hidden",
              }}>
                {/* Ghost icon background */}
                <div style={{
                  position: "absolute", bottom: -8, left: -4,
                  fontSize: 64, opacity: 0.04, userSelect: "none", pointerEvents: "none", lineHeight: 1,
                }}>{kpi.icon}</div>
                <div style={{
                  fontSize: 9, fontWeight: 700, color: LABEL,
                  textTransform: "uppercase", letterSpacing: "0.07em",
                  lineHeight: 1.3, marginBottom: 10,
                }}>{kpi.label}</div>
                {kpi.value === null
                  ? <div style={{ height: 42, width: "55%", borderRadius: 6, background: "rgba(255,255,255,0.07)", margin: "0 auto 10px" }} />
                  : <div style={{
                      fontSize: 42, fontWeight: 900, color: kpi.color,
                      lineHeight: 1, marginBottom: 4,
                      textShadow: `0 0 20px ${kpi.color}40`,
                    }}>{kpi.value}</div>
                }
                {kpi.value !== null && (
                  <div style={{ fontSize: 10, color: kpi.color, opacity: 0.75, marginBottom: 6 }}>{kpi.sub}</div>
                )}
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <span style={{
                    width: 18, height: 18, borderRadius: 5, flexShrink: 0,
                    background: kpi.color + "22",
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    fontSize: 10,
                  }}>{kpi.icon}</span>
                </div>
              </SCard>
            ))}
          </div>
        </div>

        {/* ── Block 3: Content Table ───────────────────────────────────────── */}
        <SCard style={{ marginBottom: 16, padding: 0, overflow: "hidden" }}>
          {/* Header */}
          <div style={{
            padding: "16px 22px 14px",
            borderBottom: `1px solid ${BDR}`,
            background: "rgba(255,255,255,0.03)",
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 16, fontWeight: 900, color: TEXT }}>
                  לוח תוכן — {CAMPAIGN_NAME}
                </span>
                <span style={{
                  background: CARD2, border: `1px solid ${BDR2}`, color: TEXT2,
                  fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 6,
                }}>{filteredRows.length} פריטים</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button onClick={() => setShowUploadModal(true)} style={{
                  fontSize: 12, fontWeight: 800, padding: "8px 16px", borderRadius: 8,
                  background: CARD2, border: `1px solid ${BDR2}`, color: TEXT2, cursor: "pointer",
                  transition: "none",
                }}>+ העלאת קובץ</button>
                <button onClick={() => setShowAddContent(true)} style={{
                  fontSize: 12, fontWeight: 800, padding: "8px 20px", borderRadius: 8,
                  background: BRAND, border: "none", color: "#fff", cursor: "pointer",
                  boxShadow: "0 2px 12px rgba(220,38,38,0.4)",
                  transition: "none",
                }}>+ הוסף תוכן</button>
              </div>
            </div>
            {/* Controls */}
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ position: "relative" }}>
                <span style={{ position: "absolute", right: 9, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: MUTED, pointerEvents: "none" }}>🔍</span>
                <input
                  value={searchQ}
                  onChange={e => setSearchQ(e.target.value)}
                  placeholder="חיפוש בתוכן..."
                  style={{ ...selStyle, paddingRight: 28, width: 180, background: CARD2, color: TEXT }}
                />
              </div>
              <select value={filterPlatform} onChange={e => setFilterPlatform(e.target.value)} style={selStyle}>
                <option value="all">כל הפלטפורמות</option>
                <option value="instagram">Instagram</option>
                <option value="tiktok">TikTok</option>
                <option value="youtube">YouTube</option>
                <option value="spotify">Spotify</option>
              </select>
              <select value={filterCampaign} onChange={e => setFilterCampaign(e.target.value)} style={selStyle}>
                <option value="all">כל הקמפיינים</option>
                {Array.from(new Set(rows.map(r => r.campaign).filter(Boolean))).map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={selStyle}>
                <option value="all">כל הסטטוסים</option>
                <option value="idea">רעיון</option>
                <option value="needs_shoot">צריך צילום</option>
                <option value="shot">צולם</option>
                <option value="in_edit">בעריכה</option>
                <option value="needs_review">ממתין לאישור</option>
                <option value="ready">מוכן להעלאה</option>
                <option value="scheduled">תוזמן</option>
                <option value="posted">פורסם</option>
              </select>
            </div>
          </div>

          {/* Table */}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${BDR2}`, background: "rgba(255,255,255,0.04)" }}>
                  {["#", "פריט תוכן", "קמפיין / פרויקט", "סוג", "פלטפורמות", "תאריך פרסום", "נכס מצורף", "סטטוס", "הערות", ""].map(h => (
                    <th key={h} style={{
                      padding: "11px 16px", textAlign: "right", fontSize: 10,
                      fontWeight: 800, color: TEXT2,
                      textTransform: "uppercase", letterSpacing: "0.06em",
                      whiteSpace: "nowrap",
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {socialLoading
                  ? Array.from({ length: 4 }).map((_, i) => (
                      <tr key={i} style={{ borderBottom: `1px solid ${BDR}` }}>
                        {Array.from({ length: 10 }).map((_, j) => (
                          <td key={j} style={{ padding: "15px 16px" }}>
                            <div style={{ height: 10, borderRadius: 4, background: "rgba(255,255,255,0.06)", width: j === 1 ? "80%" : j === 0 ? "40%" : "60%" }} />
                          </td>
                        ))}
                      </tr>
                    ))
                  : filteredRows.map(row => (
                  <tr
                    key={row.id}
                    style={{ borderBottom: `1px solid ${BDR}`, cursor: "pointer" }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = CARD2; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                  >
                    <td style={{ padding: "15px 16px", whiteSpace: "nowrap" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: BRAND, display: "inline-block", flexShrink: 0 }} />
                        <span style={{ fontSize: 11, fontWeight: 700, color: MUTED }}>{row.num}</span>
                      </span>
                    </td>
                    <td style={{ padding: "15px 16px", maxWidth: 220 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {row.title}
                      </div>
                    </td>
                    <td style={{ padding: "15px 16px", maxWidth: 180 }}>
                      {(() => {
                        const tc = TYPE_COLORS[row.content_type] ?? CYAN;
                        return (
                          <span style={{
                            fontSize: 10, fontWeight: 800, padding: "3px 9px", borderRadius: 8,
                            background: tc + "1C", border: `1px solid ${tc}50`, color: tc,
                            whiteSpace: "nowrap", overflow: "hidden", maxWidth: 168, display: "inline-block", textOverflow: "ellipsis",
                          }}>
                            {row.campaign || "—"}
                          </span>
                        );
                      })()}
                    </td>
                    <td style={{ padding: "15px 16px", color: TEXT2, fontSize: 12, whiteSpace: "nowrap" }}>
                      {row.content_type}
                    </td>
                    <td style={{ padding: "15px 16px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "nowrap" }}>
                        {(row.platforms ?? []).map(p => (
                          <PlatformBadge key={p} platform={p} />
                        ))}
                        {(row.platforms ?? []).length === 0 && <span style={{ color: MUTED, fontSize: 11 }}>—</span>}
                      </div>
                    </td>
                    <td style={{ padding: "15px 16px", color: TEXT2, fontSize: 12, whiteSpace: "nowrap" }}>
                      <div>{row.publish_date === "—" ? "לא נקבע" : row.publish_date}</div>
                      <div style={{ fontSize: 10, color: MUTED, marginTop: 1 }}>{row.publish_time ?? "—"}</div>
                    </td>
                    <td style={{ padding: "15px 16px" }}>
                      {(() => {
                        const thumbs = filesByContentItem[row.id] ?? [];
                        if (thumbs.length > 0) {
                          const visible = thumbs.slice(0, 3);
                          const overflow = thumbs.length - 3;
                          return (
                            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                              {visible.map(f => (
                                <div key={f.id} style={{
                                  width: 36, height: 36, borderRadius: 7, flexShrink: 0,
                                  overflow: "hidden", background: f.thumb,
                                  border: `1px solid ${f.accent}55`,
                                }} title={f.name}>
                                  {f.type === "image" && f.link && (
                                    <img
                                      src={toDirectLink(f.link)}
                                      alt={f.name}
                                      loading="lazy"
                                      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                                      onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                                    />
                                  )}
                                  {f.type === "video" && f.link && (
                                    <video
                                      src={toDirectLink(f.link)}
                                      muted preload="metadata" playsInline
                                      onLoadedMetadata={e => {
                                        try { (e.currentTarget as HTMLVideoElement).currentTime = 0.1; } catch {}
                                      }}
                                      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                                      onError={e => { (e.currentTarget as HTMLVideoElement).style.display = "none"; }}
                                    />
                                  )}
                                </div>
                              ))}
                              {overflow > 0 && (
                                <span style={{
                                  fontSize: 10, fontWeight: 800, color: TEXT2,
                                  background: CARD2, border: `1px solid ${BDR2}`,
                                  borderRadius: 6, padding: "2px 5px", flexShrink: 0,
                                }}>+{overflow}</span>
                              )}
                            </div>
                          );
                        }
                        if (row.assets > 0) {
                          return (
                            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                              {Array.from({ length: Math.min(row.assets, 3) }).map((_, i) => (
                                <div key={i} style={{
                                  width: 26, height: 26, borderRadius: 6,
                                  background: `rgba(220,38,38,${0.1 + i * 0.07})`,
                                  border: `1px solid ${BDR2}`,
                                  display: "flex", alignItems: "center", justifyContent: "center",
                                  fontSize: 11, flexShrink: 0,
                                }}>🖼</div>
                              ))}
                              {row.assets > 3 && (
                                <span style={{ fontSize: 11, color: TEXT2, fontWeight: 700 }}>+{row.assets - 3}</span>
                              )}
                            </div>
                          );
                        }
                        return <span style={{ fontSize: 11, color: MUTED }}>—</span>;
                      })()}
                    </td>
                    <td style={{ padding: "15px 16px" }}>
                      <StatusBadge status={row.status} />
                    </td>
                    <td style={{ padding: "15px 16px", fontSize: 12, color: row.notes.startsWith("✓") ? GREEN : TEXT2, whiteSpace: "nowrap", maxWidth: 140 }}>
                      <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {row.notes || <span style={{ color: MUTED }}>—</span>}
                      </div>
                    </td>
                    <td style={{ padding: "15px 10px", position: "relative" }}>
                      {(() => {
                        const rowFiles = filesByContentItem[row.id] ?? [];
                        if (rowFiles.length === 0) return <span style={{ color: MUTED, fontSize: 12 }}>—</span>;
                        const rowDelKey = `row_${row.id}`;
                        if (deletingFileId === rowDelKey) {
                          return (
                            <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 130 }}>
                              {rowFiles.map(rf => (
                                <div key={rf.id} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                                  <span style={{ fontSize: 10, color: TEXT2, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 70 }}>{rf.name}</span>
                                  {deletingFileId === rowDelKey && deleteInProgress === rf.id
                                    ? <span style={{ fontSize: 10, color: MUTED }}>מוחק...</span>
                                    : deleteError === rf.id
                                    ? <span style={{ fontSize: 10, color: "#EF4444" }}>שגיאה</span>
                                    : (
                                      <button
                                        onClick={e => { e.stopPropagation(); handleDeleteFile(rf.id); }}
                                        style={{ background: "none", border: "none", cursor: "pointer", color: MUTED, fontSize: 13, padding: "1px 4px", borderRadius: 4, transition: "none", flexShrink: 0 }}
                                        onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.color = "#DC2626"}
                                        onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.color = MUTED}
                                      >🗑</button>
                                    )
                                  }
                                </div>
                              ))}
                              <button
                                onClick={e => { e.stopPropagation(); setDeletingFileId(null); setDeleteError(null); }}
                                style={{ fontSize: 10, color: MUTED, background: "none", border: "none", cursor: "pointer", textAlign: "right", padding: 0, transition: "none" }}
                              >ביטול</button>
                            </div>
                          );
                        }
                        return (
                          <button
                            onClick={e => { e.stopPropagation(); setDeletingFileId(rowDelKey); setDeleteError(null); }}
                            style={{ background: "none", border: "none", cursor: "pointer", color: MUTED, fontSize: 14, padding: "2px 6px", borderRadius: 6, transition: "none" }}
                            onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.color = "#DC2626"}
                            onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.color = MUTED}
                          >🗑</button>
                        );
                      })()}
                    </td>
                  </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </SCard>

        {/* ── Block 4: File Gallery ─────────────────────────────────────────── */}
        <SCard style={{ marginBottom: 16, padding: "18px 22px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{
                width: 30, height: 30, borderRadius: 8,
                background: "rgba(220,38,38,0.14)", border: "1px solid rgba(220,38,38,0.3)",
                display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0,
              }}>☁️</div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 900, color: TEXT }}>תצוגה מקדימה לקבצים שהועלו</div>
                <div style={{ fontSize: 10, color: MUTED, marginTop: 2 }}>
                  {socialLoading ? "טוען..." : `${files.length} קבצים · קמפיין ${CAMPAIGN_NAME}`}
                </div>
              </div>
            </div>
            <button style={{
              fontSize: 11, fontWeight: 700, padding: "7px 14px", borderRadius: 8,
              background: CARD2, border: `1px solid ${BDR2}`, color: TEXT2,
              cursor: "pointer", transition: "none",
            }} onClick={() => setShowUploadModal(true)}>+ העלאת קובץ</button>
          </div>

          {/* Full-width grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
            {socialLoading
              ? Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} style={{ borderRadius: 12, border: `1px solid ${BDR}`, background: CARD2, overflow: "hidden" }}>
                    <div style={{ height: 148, background: "rgba(255,255,255,0.04)" }} />
                    <div style={{ padding: "9px 10px 11px" }}>
                      <div style={{ height: 10, width: "70%", borderRadius: 4, background: "rgba(255,255,255,0.06)", marginBottom: 5 }} />
                      <div style={{ height: 8,  width: "50%", borderRadius: 4, background: "rgba(255,255,255,0.04)" }} />
                    </div>
                  </div>
                ))
              : files.map(f => (
              <div
                key={f.id}
                onClick={() => { if (deletingFileId !== f.id) setSelectedFile(f); }}
                style={{
                  borderRadius: 12, border: `1px solid ${BDR}`, overflow: "hidden",
                  background: CARD2, cursor: "pointer", position: "relative",
                  transition: "transform 0.15s, border-color 0.15s, box-shadow 0.15s",
                }}
                onMouseEnter={e => {
                  const el = e.currentTarget as HTMLElement;
                  el.style.borderColor = f.accent + "55";
                  el.style.transform = "translateY(-2px)";
                  el.style.boxShadow = `0 8px 28px ${f.accent}1A`;
                }}
                onMouseLeave={e => {
                  const el = e.currentTarget as HTMLElement;
                  el.style.borderColor = BDR;
                  el.style.transform = "translateY(0)";
                  el.style.boxShadow = "none";
                }}
              >
                {/* Thumbnail */}
                <div style={{
                  width: "100%", height: 148, background: f.thumb,
                  position: "relative", overflow: "hidden",
                }}>
                  {/* Real image preview */}
                  {f.type === "image" && f.link && (
                    <img
                      src={toDirectLink(f.link)}
                      alt={f.name}
                      loading="lazy"
                      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", zIndex: 0 }}
                      onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                    />
                  )}
                  {/* Real video preview — first frame via preload="metadata" */}
                  {f.type === "video" && f.link && (
                    <video
                      src={toDirectLink(f.link)}
                      muted
                      preload="metadata"
                      playsInline
                      onLoadedMetadata={e => {
                        try { (e.currentTarget as HTMLVideoElement).currentTime = 0.1; } catch {}
                      }}
                      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", zIndex: 0 }}
                      onError={e => { (e.currentTarget as HTMLVideoElement).style.display = "none"; }}
                    />
                  )}
                  {/* Bottom fade overlay */}
                  <div style={{
                    position: "absolute", inset: 0,
                    background: "linear-gradient(to bottom, transparent 35%, rgba(0,0,0,0.6) 100%)",
                  }} />

                  {/* Center element */}
                  <div style={{
                    position: "absolute", inset: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    zIndex: 1,
                  }}>
                    {f.type === "video" ? (
                      <div style={{
                        width: 40, height: 40, borderRadius: "50%",
                        background: "rgba(0,0,0,0.62)", border: "2.5px solid rgba(255,255,255,0.88)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        boxShadow: "0 4px 16px rgba(0,0,0,0.55)",
                        paddingRight: 2,
                        fontSize: 14, color: "#fff",
                      }}>▶</div>
                    ) : (
                      <span style={{ fontSize: 36, opacity: 0.55 }}>🖼</span>
                    )}
                  </div>

                  {/* Content type label — top right */}
                  <span style={{
                    position: "absolute", top: 7, right: 7, zIndex: 2,
                    background: f.accent + "E0",
                    color: "#fff", fontSize: 9, fontWeight: 800,
                    padding: "2px 7px", borderRadius: 5,
                    letterSpacing: "0.04em",
                  }}>{f.label}</span>

                  {/* File ext — bottom right */}
                  <span style={{
                    position: "absolute", bottom: 7, right: 7, zIndex: 2,
                    background: "rgba(0,0,0,0.72)", color: TEXT2,
                    fontSize: 9, fontWeight: 800, padding: "2px 6px", borderRadius: 4,
                  }}>{f.ext}</span>

                  {/* Duration — bottom left (video only) */}
                  {f.dur && (
                    <span style={{
                      position: "absolute", bottom: 7, left: 7, zIndex: 2,
                      background: "rgba(0,0,0,0.82)", color: "#fff",
                      fontSize: 10, fontWeight: 800, padding: "2px 7px", borderRadius: 4,
                      letterSpacing: "0.05em",
                    }}>{f.dur}</span>
                  )}

                  {/* Trash button — top left */}
                  <button
                    onClick={e => { e.stopPropagation(); setDeletingFileId(f.id); setDeleteError(null); }}
                    style={{
                      position: "absolute", top: 8, left: 8, zIndex: 3,
                      background: "rgba(0,0,0,0.60)", border: "1px solid rgba(255,255,255,0.14)",
                      borderRadius: 7, width: 28, height: 28,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      cursor: "pointer", color: "#A0A0B0", fontSize: 13, transition: "none",
                    }}
                    onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.color = "#DC2626"}
                    onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.color = "#A0A0B0"}
                  >🗑</button>
                </div>

                {/* Confirm overlay — covers whole card */}
                {deletingFileId === f.id && (
                  <div
                    onClick={e => e.stopPropagation()}
                    style={{
                      position: "absolute", inset: 0, zIndex: 10,
                      background: "rgba(9,9,16,0.92)", backdropFilter: "blur(3px)",
                      display: "flex", flexDirection: "column",
                      alignItems: "center", justifyContent: "center", gap: 10, padding: 14,
                    }}
                  >
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#F2F2F2", textAlign: "center" }}>למחוק את הקובץ?</div>
                    <div style={{ fontSize: 10, color: "#52526A", textAlign: "center", wordBreak: "break-all", maxWidth: "90%" }}>{f.name}</div>
                    {deleteError === f.id && (
                      <div style={{ fontSize: 10, color: "#EF4444" }}>שגיאה — נסה שוב</div>
                    )}
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        onClick={() => { setDeletingFileId(null); setDeleteError(null); }}
                        style={{ padding: "6px 14px", borderRadius: 7, fontSize: 11, fontWeight: 700, background: "none", border: "1px solid rgba(255,255,255,0.18)", color: "#A0A0B0", cursor: "pointer", transition: "none" }}
                      >ביטול</button>
                      <button
                        onClick={() => handleDeleteFile(f.id)}
                        disabled={deleteInProgress === f.id}
                        style={{ padding: "6px 14px", borderRadius: 7, fontSize: 11, fontWeight: 800, background: deleteInProgress === f.id ? "#52526A" : "#DC2626", border: "none", color: "#fff", cursor: deleteInProgress === f.id ? "default" : "pointer", boxShadow: deleteInProgress === f.id ? "none" : "0 2px 10px rgba(220,38,38,0.45)", transition: "none" }}
                      >{deleteInProgress === f.id ? "מוחק..." : "מחק"}</button>
                    </div>
                  </div>
                )}

                {/* Info */}
                <div style={{ padding: "9px 10px 11px" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 3 }}>
                    {(f.contentItemId && rowByContentItemId[f.contentItemId]?.title) || f.name}
                  </div>
                  <div style={{ fontSize: 10, color: MUTED, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {f.contentItemId && rowByContentItemId[f.contentItemId]?.title ? f.name : f.ctx}
                  </div>
                </div>
              </div>
            ))}
            {/* Upload tile */}
            {!socialLoading && (
              <div style={{
                borderRadius: 12, border: `2px dashed ${BDR2}`, background: "rgba(255,255,255,0.02)",
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                gap: 8, cursor: "pointer", minHeight: 200,
                transition: "border-color 0.15s",
              }}
              onClick={() => setShowUploadModal(true)}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.32)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = BDR2; }}
              >
                <div style={{ width: 40, height: 40, borderRadius: "50%", background: CARD2, border: `1px solid ${BDR}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, color: MUTED }}>☁</div>
                <div style={{ fontSize: 11, fontWeight: 700, color: MUTED }}>גרור קבצים לכאן</div>
                <div style={{ fontSize: 10, color: MUTED, opacity: 0.6 }}>או לחץ להעלאה</div>
              </div>
            )}
          </div>
        </SCard>

        {/* ── Block 5: Bottom 3-col grid ────────────────────────────────────── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, minHeight: 360 }}>

          {/* Col 1: Active Campaigns */}
          <SCard accent={BRAND} style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 14 }}>🚀</span>
                <span style={{ fontSize: 14, fontWeight: 900, color: TEXT }}>שלבי הקמפיין</span>
              </div>
              <span style={{
                background: BRAND + "18", border: `1px solid ${BRAND}35`,
                color: BRAND, fontSize: 10, fontWeight: 700,
                padding: "2px 8px", borderRadius: 10,
              }}>{displayCampaigns ? displayCampaigns.length : "—"} שלבים</span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {!displayCampaigns
                ? Array.from({ length: 2 }).map((_, i) => (
                    <div key={i} style={{ padding: "14px 16px", borderRadius: 12, background: CARD2, border: `1px solid ${BDR}` }}>
                      <div style={{ height: 11, width: "70%", borderRadius: 4, background: "rgba(255,255,255,0.06)", marginBottom: 8 }} />
                      <div style={{ height: 8,  width: "45%", borderRadius: 4, background: "rgba(255,255,255,0.04)" }} />
                    </div>
                  ))
                : displayCampaigns.map(camp => (
                <div key={camp.id} style={{
                  padding: "14px 16px", background: CARD2,
                  borderRadius: 12, border: `1px solid ${camp.color}22`,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
                    <div style={{ position: "relative", flexShrink: 0, width: 62, height: 62 }}>
                      <ProgressRing pct={camp.progress} color={camp.color} size={62} />
                      <div style={{
                        position: "absolute", inset: 0,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 10, fontWeight: 900, color: camp.color,
                      }}>{camp.progress}%</div>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {camp.type && (
                        <span style={{ fontSize: 9, fontWeight: 800, padding: "2px 7px", borderRadius: 6, background: camp.color + "22", border: `1px solid ${camp.color}44`, color: camp.color, letterSpacing: "0.05em", display: "inline-block", marginBottom: 4 }}>
                          {camp.type}
                        </span>
                      )}
                      <div style={{ fontSize: 12, fontWeight: 700, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 3 }}>
                        {camp.title}
                      </div>
                      <div style={{ fontSize: 10, color: MUTED, marginTop: 2 }}>פרויקט: {ARTIST_NAME} · יעד: {camp.deadline}</div>
                    </div>
                  </div>
                  {/* Progress bar */}
                  <div style={{ height: 3, background: BDR2, borderRadius: 2, overflow: "hidden" }}>
                    <div style={{
                      height: "100%", width: `${camp.progress}%`,
                      background: `linear-gradient(90deg, ${camp.color}88, ${camp.color})`,
                      borderRadius: 2,
                    }} />
                  </div>
                </div>
                ))}
            </div>

            <button style={{ marginTop: 14, background: "none", border: "none", color: BRAND, fontSize: 12, fontWeight: 700, cursor: "pointer", textAlign: "right", padding: 0 }}>
              הצג את כל השלבים →
            </button>
          </SCard>

          {/* Col 2: Weekly Board */}
          <SCard style={{ padding: "20px 18px", display: "flex", flexDirection: "column" }}>
            {/* Header row: nav buttons left, title+range right */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              {/* Nav buttons — left side in RTL */}
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => setWeekOffset(o => o - 1)}
                  style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 9, background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.18)", color: TEXT, fontSize: 12, fontWeight: 700, cursor: "pointer", outline: "none", transition: "none", whiteSpace: "nowrap" }}
                >
                  <span style={{ fontSize: 12, lineHeight: 1 }}>›</span> שבוע קודם
                </button>
                <button
                  onClick={() => setWeekOffset(o => o + 1)}
                  style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 9, background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.18)", color: TEXT, fontSize: 12, fontWeight: 700, cursor: "pointer", outline: "none", transition: "none", whiteSpace: "nowrap" }}
                >
                  שבוע הבא <span style={{ fontSize: 12, lineHeight: 1 }}>‹</span>
                </button>
              </div>
              {/* Title + range — right side */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <span style={{ fontSize: 14, fontWeight: 900, color: TEXT }}>לוח שבועי</span>
                  <span style={{ fontSize: 13 }}>📅</span>
                </div>
                <span style={{ fontSize: 10, color: MUTED }}>
                  {weekOffset === 0 ? "21–27 ביוני" : weekOffset === 1 ? "28 יוני – 4 יולי" : weekOffset === -1 ? "14–20 ביוני" : "21–27 ביוני"}
                </span>
              </div>
            </div>

            {/* Day columns grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6, flex: 1 }}>
              {WEEK_DAYS.map(day => (
                <div key={day.label} style={{
                  display: "flex", flexDirection: "column", gap: 6,
                  background: day.today ? "rgba(220,38,38,0.07)" : "rgba(255,255,255,0.025)",
                  border: day.today ? `1px solid ${BRAND}60` : "1px solid rgba(255,255,255,0.07)",
                  borderRadius: 10, padding: "10px 6px 8px",
                  boxShadow: day.today ? `0 0 16px rgba(220,38,38,0.12)` : "none",
                  minHeight: 180,
                }}>
                  {/* Day label */}
                  <div style={{ textAlign: "center", marginBottom: 6 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: day.today ? BRAND : MUTED, marginBottom: 5, letterSpacing: "0.03em" }}>
                      {day.label}
                    </div>
                    <div style={{
                      fontSize: 13, fontWeight: 900,
                      color: day.today ? "#fff" : TEXT2,
                      background: day.today ? BRAND : "transparent",
                      borderRadius: 6, padding: day.today ? "3px 7px" : "0",
                      display: "inline-block",
                      boxShadow: day.today ? "0 2px 10px rgba(220,38,38,0.5)" : "none",
                    }}>{day.date}</div>
                  </div>

                  {/* Items */}
                  {(weekOffset === 0 ? day.items : []).map((item, idx) => (
                    <div key={idx} style={{
                      background: item.c + "22", border: `1px solid ${item.c}50`,
                      borderRadius: 8, padding: "8px 8px 7px",
                      overflow: "hidden",
                    }}>
                      {/* Name + icon */}
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4, marginBottom: 5 }}>
                        <span style={{ fontSize: 10, fontWeight: 800, color: item.c, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{item.t}</span>
                        <span style={{ fontSize: 12, flexShrink: 0 }}>{item.icon}</span>
                      </div>
                      {/* Time */}
                      <div style={{ fontSize: 11, fontWeight: 700, color: item.c, opacity: 0.9 }}>{item.time}</div>
                    </div>
                  ))}
                </div>
              ))}
            </div>

            <button style={{ marginTop: 14, background: "none", border: "none", color: BRAND, fontSize: 12, fontWeight: 700, cursor: "pointer", padding: 0, display: "block", textAlign: "center", width: "100%" }}>
              הצג לוח מלא ←
            </button>
          </SCard>

          {/* Col 3: Activity Feed */}
          <SCard style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 14 }}>⚡</span>
                <span style={{ fontSize: 14, fontWeight: 900, color: TEXT }}>פעילות אחרונה</span>
              </div>
              <span style={{ fontSize: 10, color: MUTED }}>היום</span>
            </div>

            <div style={{ flex: 1 }}>
              {MOCK_ACTIVITY.map((act, idx) => (
                <div key={act.id} style={{
                  display: "flex", gap: 12, alignItems: "flex-start",
                  padding: "13px 0",
                  borderBottom: idx < MOCK_ACTIVITY.length - 1 ? `1px solid ${BDR}` : "none",
                }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
                    background: `linear-gradient(135deg, ${act.color}28, ${act.color}10)`,
                    border: `1.5px solid ${act.color}55`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 13, fontWeight: 800, color: act.color,
                    boxShadow: `0 2px 10px ${act.color}18`,
                  }}>{act.init}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: TEXT2, lineHeight: 1.45, marginBottom: 4 }}>
                      <span style={{ fontWeight: 700, color: TEXT }}>{act.user}</span>
                      {" — "}
                      {act.text}
                    </div>
                    <div style={{ fontSize: 10, color: MUTED }}>{act.time}</div>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ paddingTop: 12, borderTop: `1px solid ${BDR}`, marginTop: 4 }}>
              <button style={{ background: "none", border: "none", color: BRAND, fontSize: 12, fontWeight: 700, cursor: "pointer", padding: 0 }}>
                הצג את כל הפעילות →
              </button>
            </div>
          </SCard>

        </div>
      </div>

      {/* ── File Viewer Modal ──────────────────────────────────────────────── */}
      {/* ── Add Content Modal ──────────────────────────────────────────────── */}
      {showAddContent && activeCampaignId && (
        <AddContentItemModal
          campaignId={activeCampaignId}
          onClose={() => setShowAddContent(false)}
          onSuccess={() => { refreshContent(); }}
        />
      )}

      {/* ── Upload Asset Modal ─────────────────────────────────────────────── */}
      {showUploadModal && activeCampaignId && (
        <UploadAssetModal
          campaignId={activeCampaignId}
          rows={rows}
          onClose={() => setShowUploadModal(false)}
          onSuccess={() => { refreshFiles(); }}
        />
      )}

      {selectedFile && (
        <div
          onClick={() => setSelectedFile(null)}
          style={{
            position: "fixed", inset: 0, zIndex: 9999,
            background: "rgba(0,0,0,0.88)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 24,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: "#141414",
              borderRadius: 18,
              border: `1px solid ${BDR2}`,
              padding: 24,
              maxWidth: 760,
              width: "100%",
              maxHeight: "90vh",
              display: "flex",
              flexDirection: "column",
              gap: 16,
              boxShadow: "0 32px 100px rgba(0,0,0,0.85), 0 0 0 1px rgba(255,255,255,0.04)",
              overflowY: "auto",
            }}
          >
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                <div style={{
                  padding: "2px 8px", borderRadius: 6, fontSize: 10, fontWeight: 800,
                  background: selectedFile.accent + "22", border: `1px solid ${selectedFile.accent}55`,
                  color: selectedFile.accent, flexShrink: 0,
                }}>{selectedFile.ext}</div>
                <span style={{ fontSize: 13, fontWeight: 700, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {selectedFile.name}
                </span>
              </div>
              <button
                onClick={() => setSelectedFile(null)}
                style={{
                  background: "none", border: "none", color: MUTED,
                  fontSize: 22, cursor: "pointer", lineHeight: 1,
                  flexShrink: 0, padding: "0 4px",
                  transition: "none",
                }}
              >✕</button>
            </div>

            {/* Media area */}
            {selectedFile.link ? (
              selectedFile.type === "video" ? (
                <video
                  controls
                  src={toDirectLink(selectedFile.link)}
                  style={{ width: "100%", borderRadius: 10, background: "#000", maxHeight: 480 }}
                />
              ) : (
                <img
                  src={toDirectLink(selectedFile.link)}
                  alt={selectedFile.name}
                  style={{ width: "100%", borderRadius: 10, maxHeight: 480, objectFit: "contain", background: "#000" }}
                />
              )
            ) : (
              <div style={{
                background: selectedFile.thumb,
                borderRadius: 10, height: 260,
                display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center", gap: 10,
              }}>
                <span style={{ fontSize: 48, opacity: 0.45 }}>
                  {selectedFile.type === "video" ? "▶" : "🖼"}
                </span>
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>
                  {selectedFile.name}
                </span>
              </div>
            )}

            {/* Footer */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <span style={{ fontSize: 11, color: MUTED }}>{selectedFile.ctx}</span>
              {selectedFile.link && (
                <button
                  onClick={() => window.open(selectedFile.link!, "_blank", "noopener,noreferrer")}
                  style={{
                    padding: "8px 18px", borderRadius: 8, fontSize: 12, fontWeight: 700,
                    background: CARD2, border: `1px solid ${BDR2}`, color: TEXT2,
                    cursor: "pointer", transition: "none", whiteSpace: "nowrap",
                  }}
                >
                  פתח בדרופבוקס ↗
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
