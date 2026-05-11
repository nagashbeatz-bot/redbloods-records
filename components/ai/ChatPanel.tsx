"use client";

import { useState, useRef, useEffect } from "react";
import type { Project, ChatMessage, MondayUpdateAction, BulkUpdateAction, UpdatableField, PendingCreateAction } from "@/lib/types";
import { useProjects } from "@/components/ProjectsProvider";

interface ChatPanelProps {
  projects: Project[];
  onClose: () => void;
  /** Pre-filled prompt to auto-send once the panel mounts or receives it */
  pendingPrompt?: string;
  /** Called after the pending prompt has been consumed */
  onPromptConsumed?: () => void;
}

const SUGGESTED = [
  "מה דחוף היום?",
  "סדר עבודה לפי דדליינים",
  "סיכום לפי אמנים",
  "מי דורש הכי הרבה מעקב?",
  "איזה פרויקטים עברו דדליין?",
  "מי האמן הפעיל ביותר?",
];

interface PendingColumnAdd {
  title: string;
  columnType: string;
  reason?: string;
}

// Strip all PENDING_* blocks from display text
function stripPendingBlocks(raw: string): string {
  return raw
    .replace(/\[PENDING_UPDATE:\{[^}]*\}\]/g, "")
    .replace(/\[PENDING_COLUMN_ADD:\{[^}]*\}\]/g, "")
    .replace(/\[PENDING_BULK_UPDATE:\{[^}]*\}\]/g, "")
    .replace(/\[PENDING_CREATE:\{[^}]*\}\]/g, "")
    .trim();
}

// Parse [PENDING_CREATE:{...}] from agent response
function parsePendingCreate(raw: string): { text: string; createAction?: PendingCreateAction } {
  const match = raw.match(/\[PENDING_CREATE:(\{[^}]*\})\]/);
  if (!match) return { text: raw };
  try {
    const createAction = JSON.parse(match[1]) as PendingCreateAction;
    return { text: stripPendingBlocks(raw), createAction };
  } catch {
    return { text: stripPendingBlocks(raw) };
  }
}

// Parse [PENDING_BULK_UPDATE:{...}] from agent response
function parsePendingBulkUpdate(raw: string): { text: string; bulkAction?: BulkUpdateAction } {
  const match = raw.match(/\[PENDING_BULK_UPDATE:(\{[^}]*\})\]/);
  if (!match) return { text: raw };
  try {
    const parsed = JSON.parse(match[1]);
    const bulkAction: BulkUpdateAction = {
      field: parsed.field as UpdatableField,
      value: parsed.value ?? "",
      ids: Array.isArray(parsed.ids) ? parsed.ids : [],
      label: parsed.label ?? `${Array.isArray(parsed.ids) ? parsed.ids.length : "?"} פרויקטים`,
      filterDesc: parsed.filterDesc,
    };
    return { text: stripPendingBlocks(raw), bulkAction };
  } catch {
    return { text: stripPendingBlocks(raw) };
  }
}

// Parse [PENDING_UPDATE:{...}] from agent response
function parsePendingUpdate(raw: string): { text: string; action?: MondayUpdateAction } {
  const match = raw.match(/\[PENDING_UPDATE:(\{[^}]*\})\]/);
  if (!match) return { text: raw };
  try {
    const action = JSON.parse(match[1]) as MondayUpdateAction;
    return { text: stripPendingBlocks(raw), action };
  } catch {
    return { text: stripPendingBlocks(raw) };
  }
}

// Parse [PENDING_COLUMN_ADD:{...}] from agent response
function parsePendingColumnAdd(raw: string): { text: string; columnAdd?: PendingColumnAdd } {
  const match = raw.match(/\[PENDING_COLUMN_ADD:(\{[^}]*\})\]/);
  if (!match) return { text: raw };
  try {
    const columnAdd = JSON.parse(match[1]) as PendingColumnAdd;
    return { text: stripPendingBlocks(raw), columnAdd };
  } catch {
    return { text: stripPendingBlocks(raw) };
  }
}

// Parse all protocol types from an agent response
function parseAgentMessage(raw: string): {
  text: string;
  action?: MondayUpdateAction;
  columnAdd?: PendingColumnAdd;
  bulkAction?: BulkUpdateAction;
  createAction?: PendingCreateAction;
} {
  // PENDING_BULK_UPDATE — highest specificity
  const bulkResult = parsePendingBulkUpdate(raw);
  if (bulkResult.bulkAction) return bulkResult;
  // PENDING_UPDATE
  const updateResult = parsePendingUpdate(raw);
  if (updateResult.action) return updateResult;
  // PENDING_CREATE
  const createResult = parsePendingCreate(raw);
  if (createResult.createAction) return { text: createResult.text, createAction: createResult.createAction };
  // PENDING_COLUMN_ADD
  const colResult = parsePendingColumnAdd(raw);
  if (colResult.columnAdd) return { text: colResult.text, columnAdd: colResult.columnAdd };
  return { text: raw };
}

// Human-readable column type label
function columnTypeLabel(type: string) {
  const map: Record<string, string> = {
    text: "טקסט",
    long_text: "טקסט ארוך",
    numbers: "מספרים",
    date: "תאריך",
    status: "סטטוס",
  };
  return map[type] ?? type;
}

// Human-readable field label
function fieldLabel(field: string) {
  if (field === "status") return "שלב נוכחי";
  if (field === "deadline") return "דדליין";
  if (field === "notes") return "הערות";
  if (field === "projectType") return "סוג פרויקט";
  if (field === "parentProject") return "שייך ל";
  return field;
}

interface BulkProgress {
  current: number;
  total: number;
  failed: number;
}

type AIProvider = "groq" | "openai";

const PROVIDER_COLOR: Record<AIProvider, string> = {
  groq:   "#10B981",
  openai: "#3B82F6",
};
const PROVIDER_LABEL: Record<AIProvider, string> = {
  groq:   "Groq",
  openai: "OpenAI",
};

interface LocalMessage extends ChatMessage {
  pendingAction?: MondayUpdateAction;
  pendingColumnAdd?: PendingColumnAdd;
  pendingBulkAction?: BulkUpdateAction;
  pendingCreateAction?: PendingCreateAction;
  actionDone?: boolean;
  bulkProgress?: BulkProgress;
  provider?: AIProvider;  // which provider answered this message
}

export default function ChatPanel({ projects, onClose, pendingPrompt, onPromptConsumed }: ChatPanelProps) {
  const { updateProjectField, createProject } = useProjects();
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [confirmingSaving, setConfirmingSaving] = useState(false);
  const [activeProvider, setActiveProvider] = useState<AIProvider | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Auto-send when pendingPrompt arrives
  useEffect(() => {
    if (!pendingPrompt) return;
    onPromptConsumed?.();
    send(pendingPrompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPrompt]);

  const send = async (text?: string) => {
    const userText = (text || input).trim();
    if (!userText || loading) return;
    setInput("");

    const newMessages: LocalMessage[] = [
      ...messages,
      { role: "user", content: userText },
    ];
    setMessages(newMessages);
    setLoading(true);

    const apiMessages: ChatMessage[] = newMessages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: apiMessages, projects }),
      });
      const data = await res.json();
      const raw: string = data.content || "שגיאה בתגובה.";
      const provider: AIProvider | undefined =
        data.provider === "groq" || data.provider === "openai" ? data.provider : undefined;

      // Show actual provider in header briefly; always return to Groq (default) after.
      if (provider) {
        setActiveProvider(provider);
        // OpenAI was a per-message fallback — reset to Groq after 3 s
        if (provider !== "groq") {
          setTimeout(() => setActiveProvider("groq"), 3000);
        }
      }

      const { text, action, columnAdd, bulkAction, createAction } = parseAgentMessage(raw);

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: text,
          pendingAction: action,
          pendingColumnAdd: columnAdd,
          pendingBulkAction: bulkAction,
          pendingCreateAction: createAction,
          provider,
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "שגיאת חיבור. נסה שוב." },
      ]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  // Confirm field update (status / deadline / notes)
  const handleConfirmUpdate = async (msgIndex: number, action: MondayUpdateAction) => {
    setConfirmingSaving(true);
    try {
      await updateProjectField(action.projectId, action.field, action.newValue);
      setMessages((prev) => {
        const updated = prev.map((m, i) => (i === msgIndex ? { ...m, actionDone: true } : m));
        return [
          ...updated,
          { role: "assistant" as const, content: `✓ עודכן בהצלחה: "${action.projectName}" ← ${action.newValue}` },
        ];
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "שגיאה";
      setMessages((prev) => {
        const updated = prev.map((m, i) => (i === msgIndex ? { ...m, actionDone: true } : m));
        return [...updated, { role: "assistant" as const, content: `✕ העדכון נכשל: ${msg}` }];
      });
    } finally {
      setConfirmingSaving(false);
    }
  };

  // Confirm column addition
  const handleConfirmColumnAdd = async (msgIndex: number, col: PendingColumnAdd) => {
    setConfirmingSaving(true);
    try {
      const res = await fetch("/api/monday/column", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: col.title, columnType: col.columnType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "שגיאה");

      setMessages((prev) => {
        const updated = prev.map((m, i) => (i === msgIndex ? { ...m, actionDone: true } : m));
        return [
          ...updated,
          { role: "assistant" as const, content: `✓ העמודה "${col.title}" נוספה בהצלחה לבורד.` },
        ];
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "שגיאה";
      setMessages((prev) => {
        const updated = prev.map((m, i) => (i === msgIndex ? { ...m, actionDone: true } : m));
        return [...updated, { role: "assistant" as const, content: `✕ הוספת העמודה נכשלה: ${msg}` }];
      });
    } finally {
      setConfirmingSaving(false);
    }
  };

  const handleCancel = (msgIndex: number) => {
    setMessages((prev) =>
      prev.map((m, i) => (i === msgIndex ? { ...m, actionDone: true } : m))
    );
  };

  // Confirm new project creation
  const handleConfirmCreate = async (msgIndex: number, action: PendingCreateAction) => {
    setConfirmingSaving(true);
    try {
      await createProject(action);
      setMessages((prev) => {
        const updated = prev.map((m, i) => (i === msgIndex ? { ...m, actionDone: true } : m));
        return [
          ...updated,
          { role: "assistant" as const, content: `✓ הפרויקט "${action.name}" נוצר בהצלחה בבורד.` },
        ];
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "שגיאה";
      setMessages((prev) => {
        const updated = prev.map((m, i) => (i === msgIndex ? { ...m, actionDone: true } : m));
        return [...updated, { role: "assistant" as const, content: `✕ יצירת הפרויקט נכשלה: ${msg}` }];
      });
    } finally {
      setConfirmingSaving(false);
    }
  };

  // Bulk update — sequential execution with live progress, single confirm
  const handleConfirmBulkUpdate = async (msgIndex: number, action: BulkUpdateAction) => {
    const total = action.ids.length;
    // Initialize progress
    setMessages((prev) =>
      prev.map((m, i) =>
        i === msgIndex
          ? { ...m, bulkProgress: { current: 0, total, failed: 0 } }
          : m
      )
    );

    let failed = 0;
    for (let idx = 0; idx < action.ids.length; idx++) {
      try {
        await updateProjectField(action.ids[idx], action.field, action.value);
      } catch {
        failed++;
      }
      const current = idx + 1;
      setMessages((prev) =>
        prev.map((m, i) =>
          i === msgIndex
            ? { ...m, bulkProgress: { current, total, failed } }
            : m
        )
      );
    }

    const succeeded = total - failed;
    const summary =
      failed === 0
        ? `✓ עודכנו ${total} פרויקטים בהצלחה.`
        : `✓ עודכנו ${succeeded} מתוך ${total}. ${failed} נכשלו.`;

    setMessages((prev) => {
      const updated = prev.map((m, i) =>
        i === msgIndex ? { ...m, actionDone: true } : m
      );
      return [...updated, { role: "assistant" as const, content: summary }];
    });
  };

  const isEmpty = messages.length === 0;

  return (
    <div className="flex flex-col h-full" style={{ background: "#141414" }}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0"
        style={{ borderColor: "#252525" }}
      >
        <div className="flex items-center gap-2.5">
          <div
            className="w-6 h-6 rounded-lg flex items-center justify-center text-xs font-bold"
            style={{ background: "linear-gradient(135deg, #3B82F6, #EC4899)" }}
          >
            ✦
          </div>
          <div>
            <div className="text-sm font-semibold" style={{ color: "#E8E8E8" }}>
              סוכן Redbloods
            </div>
            <div className="flex items-center gap-1.5 text-xs" style={{ color: "#555" }}>
              {/* Provider dot — pulses while loading */}
              <span
                className={loading ? "animate-pulse" : ""}
                style={{
                  display: "inline-block",
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  // Dot is always Groq-green, except briefly after an OpenAI fallback
                  background: loading
                    ? "#555"
                    : activeProvider === "openai"
                    ? PROVIDER_COLOR.openai
                    : PROVIDER_COLOR.groq,
                  boxShadow: !loading
                    ? `0 0 4px ${activeProvider === "openai" ? PROVIDER_COLOR.openai : PROVIDER_COLOR.groq}55`
                    : "none",
                  flexShrink: 0,
                  transition: "background 0.4s, box-shadow 0.4s",
                }}
              />
              {loading
                ? "Groq מגיב..."
                : activeProvider === "openai"
                ? `OpenAI (fallback) · חוזר ל-Groq`
                : `Groq · ${projects.length} פרויקטים`}
            </div>
          </div>
        </div>
        <button
          onClick={onClose}
          className="w-6 h-6 flex items-center justify-center rounded-lg transition-all text-base"
          style={{ color: "#555", background: "none", border: "none", cursor: "pointer" }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#888")}
          onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#555")}
        >
          ×
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 min-h-0">
        {isEmpty && (
          <div className="text-center py-6">
            <div className="text-2xl mb-2" style={{ opacity: 0.4 }}>♫</div>
            <p className="text-xs" style={{ color: "#555" }}>
              שאל על הפרויקטים, דדליינים ואמנים
            </p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className="space-y-2">
            {/* Message bubble */}
            <div className={`flex ${msg.role === "user" ? "justify-start" : "justify-end"}`}>
              <div className="flex flex-col items-end max-w-[88%] gap-1">
                <div
                  className="rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed w-full"
                  style={
                    msg.role === "user"
                      ? { background: "#222", border: "1px solid #2A2A2A", color: "#D0D0D0" }
                      : { background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.2)", color: "#E8E8E8" }
                  }
                >
                  <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{msg.content}</p>
                </div>
                {/* Provider tag — only for assistant messages with known provider */}
                {msg.role === "assistant" && msg.provider && (
                  <div
                    className="flex items-center gap-1"
                    style={{ opacity: 0.45, fontSize: 10, color: PROVIDER_COLOR[msg.provider] }}
                  >
                    <span style={{
                      width: 4, height: 4, borderRadius: "50%",
                      background: PROVIDER_COLOR[msg.provider],
                      display: "inline-block", flexShrink: 0,
                    }} />
                    {PROVIDER_LABEL[msg.provider]}
                    {msg.provider === "openai" && (
                      <span style={{ color: "#444" }}> · fallback</span>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Field update confirmation card */}
            {msg.role === "assistant" && msg.pendingAction && !msg.actionDone && (
              <div className="flex justify-end">
                <div
                  className="max-w-[88%] rounded-2xl px-4 py-3 text-sm"
                  style={{ background: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.25)" }}
                >
                  <div className="text-xs mb-1" style={{ color: "#555" }}>הצעת עדכון מהסוכן</div>
                  <div className="mb-3" style={{ color: "#C0C0C0" }}>
                    <span style={{ color: "#888" }}>{msg.pendingAction.projectName}</span>
                    {" · "}
                    <span style={{ color: "#666" }}>{fieldLabel(msg.pendingAction.field)}</span>
                    {" → "}
                    <span style={{ color: "#3B82F6", fontWeight: 600 }}>
                      {msg.pendingAction.newValue || "—"}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleConfirmUpdate(i, msg.pendingAction!)}
                      disabled={confirmingSaving}
                      style={{
                        flex: 1, padding: "6px 0", borderRadius: 8, border: "none",
                        background: "#3B82F6", color: "#fff", fontSize: 12, fontWeight: 600,
                        cursor: confirmingSaving ? "not-allowed" : "pointer",
                        fontFamily: "inherit", opacity: confirmingSaving ? 0.7 : 1,
                      }}
                    >
                      {confirmingSaving ? "מעדכן..." : "אשר עדכון"}
                    </button>
                    <button
                      onClick={() => handleCancel(i)}
                      disabled={confirmingSaving}
                      style={{
                        flex: 1, padding: "6px 0", borderRadius: 8,
                        border: "1px solid #333", background: "transparent",
                        color: "#666", fontSize: 12, cursor: "pointer", fontFamily: "inherit",
                      }}
                    >
                      ביטול
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Bulk update confirmation card */}
            {msg.role === "assistant" && msg.pendingBulkAction && !msg.actionDone && (
              <div className="flex justify-end">
                <div
                  className="max-w-[92%] rounded-2xl px-4 py-3 text-sm w-full"
                  style={{ background: "rgba(139,92,246,0.06)", border: "1px solid rgba(139,92,246,0.25)" }}
                >
                  <div className="text-xs mb-2" style={{ color: "#7C3AED" }}>
                    עדכון מרוכז — {msg.pendingBulkAction.label}
                  </div>
                  <div className="mb-1" style={{ color: "#C0C0C0" }}>
                    <span style={{ color: "#888" }}>{fieldLabel(msg.pendingBulkAction.field)}</span>
                    {" → "}
                    <span style={{ color: "#A78BFA", fontWeight: 600 }}>
                      {msg.pendingBulkAction.value || "—"}
                    </span>
                  </div>
                  {msg.pendingBulkAction.filterDesc && (
                    <div className="text-xs mb-3" style={{ color: "#555" }}>
                      {msg.pendingBulkAction.filterDesc}
                    </div>
                  )}
                  {!msg.pendingBulkAction.filterDesc && <div className="mb-3" />}

                  {/* Progress indicator */}
                  {msg.bulkProgress && (
                    <div className="mb-3 text-xs" style={{ color: "#888" }}>
                      {msg.bulkProgress.current < msg.bulkProgress.total ? (
                        <>מעדכן... {msg.bulkProgress.current} / {msg.bulkProgress.total}</>
                      ) : (
                        <>הושלם</>
                      )}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={() => handleConfirmBulkUpdate(i, msg.pendingBulkAction!)}
                      disabled={confirmingSaving || !!msg.bulkProgress}
                      style={{
                        flex: 1, padding: "7px 0", borderRadius: 8, border: "none",
                        background: "#7C3AED", color: "#fff", fontSize: 12, fontWeight: 700,
                        cursor: (confirmingSaving || !!msg.bulkProgress) ? "not-allowed" : "pointer",
                        fontFamily: "inherit",
                        opacity: (confirmingSaving || !!msg.bulkProgress) ? 0.6 : 1,
                      }}
                    >
                      {msg.bulkProgress
                        ? `מעדכן ${msg.bulkProgress.current}/${msg.bulkProgress.total}...`
                        : `אשר ועדכן ${msg.pendingBulkAction.ids.length} פרויקטים`}
                    </button>
                    <button
                      onClick={() => handleCancel(i)}
                      disabled={confirmingSaving || !!msg.bulkProgress}
                      style={{
                        flex: 1, padding: "7px 0", borderRadius: 8,
                        border: "1px solid #333", background: "transparent",
                        color: "#666", fontSize: 12, cursor: "pointer", fontFamily: "inherit",
                      }}
                    >
                      ביטול
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Create project confirmation card */}
            {msg.role === "assistant" && msg.pendingCreateAction && !msg.actionDone && (
              <div className="flex justify-end">
                <div
                  className="max-w-[92%] rounded-2xl px-4 py-3 text-sm w-full"
                  style={{ background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.25)" }}
                >
                  <div className="flex items-center gap-1.5 mb-2">
                    <span style={{ fontSize: 11, color: "#10B981" }}>✦</span>
                    <span className="text-xs font-medium" style={{ color: "#10B981" }}>פרויקט חדש לבורד</span>
                  </div>

                  {/* Project details preview */}
                  <div className="space-y-1 mb-3">
                    <div className="font-semibold" style={{ color: "#F0F0F0" }}>
                      {msg.pendingCreateAction.name}
                    </div>
                    {msg.pendingCreateAction.artist && (
                      <div className="text-xs" style={{ color: "#888" }}>
                        אמן: {msg.pendingCreateAction.artist}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2 text-xs mt-1">
                      {msg.pendingCreateAction.projectType && (
                        <span style={{ color: "#6EE7B7" }}>{msg.pendingCreateAction.projectType}</span>
                      )}
                      {msg.pendingCreateAction.status && (
                        <span style={{ color: "#666" }}>{msg.pendingCreateAction.status}</span>
                      )}
                      {msg.pendingCreateAction.deadline && (
                        <span style={{ color: "#666" }}>דדליין: {msg.pendingCreateAction.deadline}</span>
                      )}
                      {msg.pendingCreateAction.parentProject && msg.pendingCreateAction.parentProject !== "ללא שיוך" && (
                        <span style={{ color: "#888" }}>שייך ל: {msg.pendingCreateAction.parentProject}</span>
                      )}
                    </div>
                    {msg.pendingCreateAction.notes && (
                      <div className="text-xs" style={{ color: "#555" }}>
                        הערות: {msg.pendingCreateAction.notes}
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => handleConfirmCreate(i, msg.pendingCreateAction!)}
                      disabled={confirmingSaving}
                      style={{
                        flex: 1, padding: "7px 0", borderRadius: 8, border: "none",
                        background: "#10B981", color: "#fff", fontSize: 12, fontWeight: 700,
                        cursor: confirmingSaving ? "not-allowed" : "pointer",
                        fontFamily: "inherit", opacity: confirmingSaving ? 0.7 : 1,
                      }}
                    >
                      {confirmingSaving ? "יוצר..." : "צור פרויקט"}
                    </button>
                    <button
                      onClick={() => handleCancel(i)}
                      disabled={confirmingSaving}
                      style={{
                        flex: 1, padding: "7px 0", borderRadius: 8,
                        border: "1px solid #333", background: "transparent",
                        color: "#666", fontSize: 12, cursor: "pointer", fontFamily: "inherit",
                      }}
                    >
                      ביטול
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Column add confirmation card — more prominent, structural change warning */}
            {msg.role === "assistant" && msg.pendingColumnAdd && !msg.actionDone && (
              <div className="flex justify-end">
                <div
                  className="max-w-[88%] rounded-2xl px-4 py-3 text-sm"
                  style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.3)" }}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <span style={{ fontSize: 11, color: "#F59E0B" }}>⚠</span>
                    <span className="text-xs" style={{ color: "#F59E0B" }}>שינוי מבנה בורד</span>
                  </div>
                  <div className="mb-1" style={{ color: "#C0C0C0" }}>
                    הוספת עמודה:{" "}
                    <span style={{ color: "#F0F0F0", fontWeight: 600 }}>
                      {msg.pendingColumnAdd.title}
                    </span>
                    {" · "}
                    <span style={{ color: "#888", fontSize: 12 }}>
                      {columnTypeLabel(msg.pendingColumnAdd.columnType)}
                    </span>
                  </div>
                  {msg.pendingColumnAdd.reason && (
                    <div className="mb-3 text-xs" style={{ color: "#666" }}>
                      {msg.pendingColumnAdd.reason}
                    </div>
                  )}
                  {!msg.pendingColumnAdd.reason && <div className="mb-3" />}
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleConfirmColumnAdd(i, msg.pendingColumnAdd!)}
                      disabled={confirmingSaving}
                      style={{
                        flex: 1, padding: "6px 0", borderRadius: 8, border: "none",
                        background: "#F59E0B", color: "#000", fontSize: 12, fontWeight: 700,
                        cursor: confirmingSaving ? "not-allowed" : "pointer",
                        fontFamily: "inherit", opacity: confirmingSaving ? 0.7 : 1,
                      }}
                    >
                      {confirmingSaving ? "מוסיף..." : "הוסף עמודה"}
                    </button>
                    <button
                      onClick={() => handleCancel(i)}
                      disabled={confirmingSaving}
                      style={{
                        flex: 1, padding: "6px 0", borderRadius: 8,
                        border: "1px solid #333", background: "transparent",
                        color: "#666", fontSize: 12, cursor: "pointer", fontFamily: "inherit",
                      }}
                    >
                      ביטול
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="flex justify-end">
            <div
              className="rounded-2xl px-4 py-2.5 text-sm flex items-center gap-1.5"
              style={{
                background: "rgba(59,130,246,0.08)",
                border: "1px solid rgba(59,130,246,0.15)",
                color: "#555",
              }}
            >
              <span className="animate-pulse">•</span>
              <span className="animate-pulse" style={{ animationDelay: "0.2s" }}>•</span>
              <span className="animate-pulse" style={{ animationDelay: "0.4s" }}>•</span>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Suggestions */}
      {isEmpty && (
        <div className="px-4 pb-3 flex-shrink-0">
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTED.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="px-2.5 py-1.5 rounded-xl border text-xs transition-all"
                style={{ background: "#1A1A1A", borderColor: "#252525", color: "#666", cursor: "pointer" }}
                onMouseEnter={(e) => {
                  const b = e.currentTarget as HTMLButtonElement;
                  b.style.borderColor = "#333";
                  b.style.color = "#999";
                }}
                onMouseLeave={(e) => {
                  const b = e.currentTarget as HTMLButtonElement;
                  b.style.borderColor = "#252525";
                  b.style.color = "#666";
                }}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="px-4 pb-4 pt-2 border-t flex-shrink-0" style={{ borderColor: "#252525" }}>
        <div
          className="flex items-center gap-2 rounded-xl border px-3 py-2"
          style={{ background: "#1A1A1A", borderColor: "#2A2A2A" }}
        >
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
            placeholder="שאל על הפרויקטים..."
            className="flex-1 text-sm bg-transparent outline-none text-right"
            style={{ color: "#E0E0E0" }}
            dir="rtl"
          />
          <button
            onClick={() => send()}
            disabled={loading || !input.trim()}
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-all flex-shrink-0"
            style={{
              background: input.trim() && !loading ? "#3B82F6" : "#252525",
              color: input.trim() && !loading ? "#fff" : "#444",
              border: "none",
              cursor: input.trim() && !loading ? "pointer" : "not-allowed",
            }}
          >
            ↑
          </button>
        </div>
      </div>
    </div>
  );
}
