// One-time script to add missing columns to the Monday.com board
// Run: node scripts/add-columns.mjs

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env.local manually
const envPath = resolve(__dirname, "../.env.local");
const envContent = readFileSync(envPath, "utf-8");
for (const line of envContent.split("\n")) {
  const [key, ...rest] = line.split("=");
  if (key && rest.length) process.env[key.trim()] = rest.join("=").trim();
}

const TOKEN = process.env.MONDAY_API_TOKEN;
const BOARD_ID = process.env.MONDAY_BOARD_ID || "5096202122";

if (!TOKEN) {
  console.error("❌ MONDAY_API_TOKEN not found in .env.local");
  process.exit(1);
}

async function addColumn(title, columnType) {
  const query = `
    mutation {
      create_column(
        board_id: ${BOARD_ID},
        title: "${title}",
        column_type: ${columnType}
      ) {
        id
        title
      }
    }
  `;

  const res = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: TOKEN,
      "API-Version": "2024-10",
    },
    body: JSON.stringify({ query }),
  });

  const data = await res.json();
  if (data.errors) throw new Error(JSON.stringify(data.errors));
  return data.data.create_column;
}

console.log("🔧 Adding columns to Monday.com board...\n");

try {
  const col1 = await addColumn("סוג פרויקט", "text");
  console.log(`✓ נוספה: "${col1.title}" (${col1.id})`);

  const col2 = await addColumn("שייך ל", "text");
  console.log(`✓ נוספה: "${col2.title}" (${col2.id})`);

  console.log("\n✅ שתי העמודות נוספו בהצלחה. רענן את האפליקציה.");
} catch (err) {
  console.error("❌ שגיאה:", err.message);
}
