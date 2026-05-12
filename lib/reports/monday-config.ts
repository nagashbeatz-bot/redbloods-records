/**
 * Persistent report schedule config stored in Monday.com.
 *
 * A hidden item is created in the שירים board.
 * The config is encoded in the item NAME to avoid column-format issues:
 *   "__redbloods_config__|07:00|19:00"
 *
 * This survives Railway redeploys — no external services needed.
 */
import "server-only";

const BOARD_ID  = process.env.MONDAY_BOARD_ID || "5096202122";
const API_TOKEN = process.env.MONDAY_API_TOKEN || "";
const API_URL   = "https://api.monday.com/v2";

// Prefix so we can find the item quickly
const PREFIX = "__redbloods_config__|";

interface ConfigPayload {
  morningTime: string;
  eveningTime: string;
}

// ─── Low-level GQL ────────────────────────────────────────────────────────────

async function gql(query: string, variables?: Record<string, unknown>) {
  if (!API_TOKEN) throw new Error("MONDAY_API_TOKEN חסר");
  const res = await fetch(API_URL, {
    method:  "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization:  API_TOKEN,
      "API-Version":  "2024-10",
    },
    body:  JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0]?.message ?? "Monday API error");
  return json.data;
}

// ─── Encode / decode ──────────────────────────────────────────────────────────

function encode(config: ConfigPayload): string {
  return `${PREFIX}${config.morningTime}|${config.eveningTime}`;
}

function decode(name: string): ConfigPayload | null {
  if (!name.startsWith(PREFIX)) return null;
  const parts = name.slice(PREFIX.length).split("|");
  if (parts.length < 2) return null;
  const [morningTime, eveningTime] = parts;
  const timeRe = /^([01]\d|2[0-3]):([0-5]\d)$/;
  if (!timeRe.test(morningTime) || !timeRe.test(eveningTime)) return null;
  return { morningTime, eveningTime };
}

// ─── Find config item ─────────────────────────────────────────────────────────

async function findConfigItem(): Promise<{ id: string; name: string } | null> {
  const data = await gql(`
    query {
      boards(ids: [${BOARD_ID}]) {
        items_page(limit: 200) {
          items { id name }
        }
      }
    }
  `);
  const items: { id: string; name: string }[] =
    data.boards[0]?.items_page?.items ?? [];
  return items.find((i) => i.name.startsWith(PREFIX)) ?? null;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Read the stored schedule from Monday.com. Returns null if not found or on error. */
export async function readMondayConfig(): Promise<ConfigPayload | null> {
  try {
    const item = await findConfigItem();
    if (!item) return null;
    return decode(item.name);
  } catch {
    return null;
  }
}

/** Write the schedule to Monday.com — creates the hidden config item if needed. */
export async function writeMondayConfig(config: ConfigPayload): Promise<void> {
  const newName = encode(config);
  const existing = await findConfigItem();

  if (existing) {
    // Update the item name to encode the new times
    await gql(
      `mutation ($boardId: ID!, $itemId: ID!, $value: JSON!) {
         change_column_value(board_id: $boardId, item_id: $itemId, column_id: "name", value: $value) { id }
       }`,
      { boardId: BOARD_ID, itemId: existing.id, value: JSON.stringify(newName) }
    );
  } else {
    // Create a new item with the config encoded in the name
    await gql(
      `mutation ($boardId: ID!, $name: String!) {
         create_item(board_id: $boardId, item_name: $name) { id }
       }`,
      { boardId: BOARD_ID, name: newName }
    );
  }
}
