import type { Project, ProjectStatus, ProjectType, FileLink, MondayColumnMap, UpdatableField } from "./types";
import { isOverdue, isDueSoon } from "./utils";

const BOARD_ID = process.env.MONDAY_BOARD_ID || "5096202122";
const API_TOKEN = process.env.MONDAY_API_TOKEN || "";
const API_URL = "https://api.monday.com/v2";

async function mondayGQL(query: string, variables?: Record<string, unknown>) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: API_TOKEN,
      "API-Version": "2024-10",
    },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  const json = await res.json();
  if (json.errors) {
    const errMsg = json.errors[0]?.message || "Monday API error";
    // Log full error for server-side diagnostics
    console.error("[Monday GQL Error]", JSON.stringify({ errMsg, errors: json.errors, variables }));
    throw new Error(errMsg);
  }
  if (!res.ok) {
    console.error("[Monday HTTP Error]", res.status, JSON.stringify(json));
    throw new Error(`Monday HTTP ${res.status}: ${JSON.stringify(json)}`);
  }
  return json.data;
}

let columnMapCache: MondayColumnMap | null = null;
let columnMapCachedAt: number = 0;
const COLUMN_MAP_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function getColumnMap(): Promise<MondayColumnMap> {
  const now = Date.now();
  if (columnMapCache && now - columnMapCachedAt < COLUMN_MAP_TTL_MS) return columnMapCache;

  const data = await mondayGQL(`
    query {
      boards(ids: [${BOARD_ID}]) {
        columns { id title type }
      }
    }
  `);

  const columns: { id: string; title: string; type: string }[] =
    data.boards[0]?.columns || [];

  // Normalize: collapse spaces + lowercase for robust matching
  const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();
  const find = (...candidates: string[]) =>
    columns.find((c) => candidates.some((t) => norm(c.title) === norm(t)))?.id || "";

  columnMapCache = {
    status: find("שלב נוכחי"),
    artist: find("שם אמן"),
    deadline: find("דדליין", "דד ליין", "deadline"),
    notes: find("הערות", "notes"),
    files: find("קבצים", "files"),
    // Optional — empty string if columns not yet added to board
    projectType: find("סוג פרויקט", "סוגפרויקט"),
    parentProject: find("שייך ל", "שייךל", "שייך"),
  };
  columnMapCachedAt = Date.now();

  return columnMapCache;
}

interface RawFileEntry {
  name: string;
  assetId?: number;
}

/** Extract file names + assetIds from Monday file column JSON value */
function parseFileEntries(value: string | null): RawFileEntry[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed.files)) {
      return parsed.files.map((f: { name?: string; assetId?: number }) => ({
        name: f.name || "",
        assetId: typeof f.assetId === "number" ? f.assetId : undefined,
      }));
    }
  } catch {}
  return [];
}

function parseStatus(text: string | null): ProjectStatus {
  const valid: ProjectStatus[] = [
    "בעבודה",
    "מחכה למיקס",
    "במיקס",
    "הושלם",
    "בהשהייה",
    "לא התחיל",
  ];
  return valid.find((s) => s === text) ?? "לא התחיל";
}

function parseProjectType(text: string | null): ProjectType {
  const valid: ProjectType[] = ["שיר", "EP", "אלבום", "קליפ", "רידים", "אחר"];
  return valid.find((t) => t === text) ?? "";
}

export async function fetchProjects(): Promise<Project[]> {
  const colMap = await getColumnMap();

  const data = await mondayGQL(`
    query {
      boards(ids: [${BOARD_ID}]) {
        items_page(limit: 200) {
          items {
            id
            name
            column_values {
              id
              text
              value
            }
          }
        }
      }
    }
  `);

  type RawItem = { id: string; name: string; column_values: { id: string; text: string; value: string }[] };
  const allItems: RawItem[] = data.boards[0]?.items_page?.items || [];
  // Filter out hidden system items (config and client records stored in this board)
  const items = allItems.filter(
    (i) => !i.name.startsWith("__redbloods_config__") && !i.name.startsWith("__client__|")
  );

  // Pass 1 — parse everything; collect raw file entries with assetIds
  type Partial = Omit<Project, "files"> & { rawFiles: RawFileEntry[] };
  const partial: Partial[] = items.map((item) => {
    const col = (id: string) => item.column_values.find((c) => c.id === id);
    const deadline = col(colMap.deadline)?.text || null;
    return {
      id: item.id,
      name: item.name,
      artist: col(colMap.artist)?.text || "",
      status: parseStatus(col(colMap.status)?.text || null),
      deadline: deadline || null,
      notes: col(colMap.notes)?.text || "",
      rawFiles: colMap.files ? parseFileEntries(col(colMap.files)?.value || null) : [],
      isOverdue: isOverdue(deadline),
      isDueSoon: isDueSoon(deadline),
      projectType: colMap.projectType ? parseProjectType(col(colMap.projectType)?.text || null) : "",
      parentProject: colMap.parentProject ? (col(colMap.parentProject)?.text || "") : "",
    };
  });

  // Pass 2 — batch-fetch public_url for all assetIds (signed S3 URLs, valid 1h, no auth needed)
  const allAssetIds = Array.from(new Set(
    partial.flatMap((p) => p.rawFiles.map((f) => f.assetId).filter((id): id is number => id !== undefined))
  ));

  const publicUrlMap: Record<number, string> = {};
  if (allAssetIds.length > 0) {
    try {
      const assetData = await mondayGQL(`
        query {
          assets(ids: [${allAssetIds.join(",")}]) {
            id
            public_url
          }
        }
      `);
      for (const asset of assetData.assets || []) {
        if (asset.public_url) publicUrlMap[Number(asset.id)] = asset.public_url;
      }
    } catch {
      // Non-fatal — files will show as unavailable
    }
  }

  // Pass 3 — assemble final Project objects
  return partial.map(({ rawFiles, ...rest }) => ({
    ...rest,
    files: rawFiles.map((f) => ({
      name: f.name,
      url: f.assetId != null ? (publicUrlMap[f.assetId] || "#") : "#",
      assetId: f.assetId,
    })),
  } satisfies Project));
}

// ─── Column Management Infrastructure ──────────────────────────────────────
//
// These functions provide low-level Monday.com column mutation primitives.
// IMPORTANT: None of these execute automatically. Every call site MUST show
// a ColumnChangePreview to the user and receive explicit confirmation before
// calling. The UI layer (not yet built) is responsible for the confirmation
// flow — these are infrastructure only.
//
// Required confirmation checklist (enforce in UI, not here):
//  1. Show operation type (add / rename / delete)
//  2. Show current board state (existing columns)
//  3. Show exact change that will be applied
//  4. Warn if deletion removes data (non-empty column)
//  5. Require explicit user click "אשר שינוי"
//  6. Show success/failure result
//  7. Invalidate columnMapCache after any structural change

/**
 * Adds a new column to the board.
 * DO NOT call without showing ColumnChangePreview and receiving user confirmation.
 */
export async function addBoardColumn(
  title: string,
  columnType: string = "text"
): Promise<{ id: string; title: string }> {
  const data = await mondayGQL(
    `
    mutation ($boardId: ID!, $title: String!, $columnType: ColumnType!) {
      create_column(
        board_id: $boardId
        title: $title
        column_type: $columnType
      ) { id title }
    }
  `,
    { boardId: BOARD_ID, title, columnType }
  );
  // Invalidate cache so next fetch picks up the new column
  columnMapCache = null;
  return data.create_column;
}

/**
 * Renames an existing column.
 * DO NOT call without showing ColumnChangePreview and receiving user confirmation.
 */
export async function renameColumn(
  columnId: string,
  newTitle: string
): Promise<void> {
  await mondayGQL(
    `
    mutation ($boardId: ID!, $columnId: String!, $title: String!) {
      change_column_title(
        board_id: $boardId
        column_id: $columnId
        title: $title
      ) { id title }
    }
  `,
    { boardId: BOARD_ID, columnId, title: newTitle }
  );
  // Invalidate cache so next fetch uses the updated title
  columnMapCache = null;
}

/**
 * Deletes a column from the board.
 * WARNING: This permanently removes the column and all its data.
 * DO NOT call without showing ColumnChangePreview, checking the column is
 * non-essential, and receiving explicit user confirmation.
 */
export async function deleteColumn(columnId: string): Promise<void> {
  await mondayGQL(
    `
    mutation ($boardId: ID!, $columnId: String!) {
      delete_column(
        board_id: $boardId
        column_id: $columnId
      ) { id }
    }
  `,
    { boardId: BOARD_ID, columnId }
  );
  // Invalidate cache
  columnMapCache = null;
}

/**
 * Returns whether optional columns (projectType, parentProject) exist on the board.
 * Safe to call frequently — uses the cached column map.
 */
export async function getOptionalColumnsStatus(): Promise<{
  projectType: boolean;
  parentProject: boolean;
}> {
  const colMap = await getColumnMap();
  return {
    projectType: !!colMap.projectType,
    parentProject: !!colMap.parentProject,
  };
}

/**
 * Fetches current board columns for display in a confirmation preview.
 * Call this before showing ColumnChangePreview so the user can see what
 * already exists on the board.
 */
export async function getBoardColumns(): Promise<
  { id: string; title: string; type: string }[]
> {
  const data = await mondayGQL(`
    query {
      boards(ids: [${BOARD_ID}]) {
        columns { id title type }
      }
    }
  `);
  return data.boards[0]?.columns || [];
}

// ─── End Column Management Infrastructure ───────────────────────────────────

export async function updateProjectField(
  itemId: string,
  field: UpdatableField,
  value: string
) {
  const colMap = await getColumnMap();

  // ── Item name — special mutation, not a regular column value ────────────
  if (field === "name") {
    if (!value.trim()) throw new Error("שם הפרויקט לא יכול להיות ריק");
    await mondayGQL(
      `mutation ($boardId: ID!, $itemId: ID!, $value: JSON!) {
        change_column_value(board_id: $boardId, item_id: $itemId, column_id: "name", value: $value) { id }
      }`,
      { boardId: BOARD_ID, itemId, value: JSON.stringify(value.trim()) }
    );
    return;
  }

  // ── Artist (dropdown column) ─────────────────────────────────────────────
  // "שם אמן" is a Monday dropdown column — value must use { labels: [...] }
  // with create_labels_if_missing so new artist names are added automatically.
  if (field === "artist") {
    const columnId = colMap.artist;
    if (!columnId) throw new Error("עמודת שם אמן לא נמצאת בבורד");

    // Parse comma-separated artists into individual labels
    const labels = value
      .split(/[,،;]/)
      .map((s) => s.trim())
      .filter(Boolean);

    const columnValue = labels.length > 0
      ? JSON.stringify({ labels })
      : JSON.stringify({ labels: [] });

    await mondayGQL(
      `mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
        change_column_value(
          board_id: $boardId,
          item_id: $itemId,
          column_id: $columnId,
          value: $value,
          create_labels_if_missing: true
        ) { id }
      }`,
      { boardId: BOARD_ID, itemId, columnId, value: columnValue }
    );
    return;
  }

  // ── All other fields ────────────────────────────────────────────────────
  const columnId =
    field === "status"        ? colMap.status :
    field === "deadline"      ? colMap.deadline :
    field === "notes"         ? colMap.notes :
    field === "projectType"   ? colMap.projectType :
    field === "parentProject" ? colMap.parentProject :
    "";

  if (!columnId) {
    throw new Error(`העמודה '${field}' לא נמצאת בבורד — יש להוסיף אותה תחילה`);
  }

  let columnValue: string;

  if (field === "status") {
    const boardData = await mondayGQL(`
      query {
        boards(ids: [${BOARD_ID}]) {
          columns(ids: ["${columnId}"]) { settings_str }
        }
      }
    `);
    const settings = JSON.parse(boardData.boards[0]?.columns[0]?.settings_str || "{}");
    const labels: Record<string, string> = settings.labels || {};
    const index = Object.entries(labels).find(([, v]) => v === value)?.[0];
    columnValue = index ? JSON.stringify({ index: parseInt(index) }) : JSON.stringify({ label: value });
  } else if (field === "deadline") {
    columnValue = value ? JSON.stringify({ date: value }) : JSON.stringify({});
  } else {
    columnValue = JSON.stringify(value);
  }

  await mondayGQL(
    `mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
    }`,
    { boardId: BOARD_ID, itemId, columnId, value: columnValue }
  );
}

/**
 * Create a new project (item) on the Monday board.
 * Returns the new item's ID.
 */
export async function createProject(fields: {
  name: string;
  artist?: string;
  status?: string;
  deadline?: string;
  notes?: string;
  projectType?: string;
  parentProject?: string;
}): Promise<string> {
  const colMap = await getColumnMap();

  // Build column_values JSON — only include columns that exist on the board
  const colValues: Record<string, unknown> = {};

  if (fields.artist && colMap.artist) {
    colValues[colMap.artist] = fields.artist;
  }

  if (fields.notes && colMap.notes) {
    colValues[colMap.notes] = fields.notes;
  }

  if (fields.deadline && colMap.deadline) {
    colValues[colMap.deadline] = { date: fields.deadline };
  }

  if (fields.projectType && colMap.projectType) {
    colValues[colMap.projectType] = fields.projectType;
  }

  if (fields.parentProject && colMap.parentProject) {
    colValues[colMap.parentProject] = fields.parentProject;
  }

  // Status — needs label index lookup
  if (fields.status && colMap.status) {
    const boardData = await mondayGQL(`
      query {
        boards(ids: [${BOARD_ID}]) {
          columns(ids: ["${colMap.status}"]) {
            settings_str
          }
        }
      }
    `);
    const settings = JSON.parse(
      boardData.boards[0]?.columns[0]?.settings_str || "{}"
    );
    const labels: Record<string, string> = settings.labels || {};
    const index = Object.entries(labels).find(([, v]) => v === fields.status)?.[0];
    colValues[colMap.status] = index
      ? { index: parseInt(index) }
      : { label: fields.status };
  }

  const data = await mondayGQL(
    `
    mutation ($boardId: ID!, $name: String!, $colValues: JSON!) {
      create_item(
        board_id: $boardId
        item_name: $name
        column_values: $colValues
      ) { id }
    }
  `,
    {
      boardId: BOARD_ID,
      name: fields.name,
      colValues: JSON.stringify(colValues),
    }
  );

  return data.create_item?.id ?? "";
}

/**
 * Upload an audio file to a project's file column on Monday.com.
 * Uses Monday's multipart file upload endpoint (https://api.monday.com/v2/file).
 * The file is uploaded with the provided newName (already renamed by the caller).
 */
export async function uploadFileToProject(
  projectId: string,
  file: Blob,
  fileName: string
): Promise<{ id: string; name: string; public_url?: string }> {
  const colMap = await getColumnMap();
  const columnId = colMap.files;
  if (!columnId) throw new Error("עמודת קבצים לא נמצאה בבורד");

  const form = new FormData();
  form.append(
    "query",
    `mutation ($file: File!) {
      add_file_to_column(
        item_id: "${projectId}",
        column_id: "${columnId}",
        file: $file
      ) { id name url public_url }
    }`
  );
  form.append("variables", JSON.stringify({ file: null }));
  form.append("map", JSON.stringify({ file: ["variables.file"] }));
  form.append("file", file, fileName);

  const res = await fetch("https://api.monday.com/v2/file", {
    method: "POST",
    headers: {
      Authorization: API_TOKEN,
      "API-Version": "2024-10",
    },
    body: form,
  });

  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0]?.message || "שגיאה בהעלאה");
  if (!json.data?.add_file_to_column) throw new Error("התגובה מ-Monday ריקה");
  return json.data.add_file_to_column;
}

/**
 * Debug: return the raw column list from Monday with id, title, type.
 * Used by GET /api/monday/debug to diagnose column mapping issues.
 */
export async function debugColumnMap() {
  const data = await mondayGQL(`
    query {
      boards(ids: [${BOARD_ID}]) {
        columns { id title type }
      }
    }
  `);
  const columns: { id: string; title: string; type: string }[] =
    data.boards[0]?.columns || [];
  const colMap = await getColumnMap();
  return { columns, colMap };
}

/**
 * Permanently delete a Monday asset (file) by its asset ID.
 * The asset is removed from the board item automatically.
 */
export async function deleteFileAsset(assetId: number): Promise<void> {
  await mondayGQL(
    `mutation ($id: Int!) { delete_asset(id: $id) { id } }`,
    { id: assetId }
  );
}
