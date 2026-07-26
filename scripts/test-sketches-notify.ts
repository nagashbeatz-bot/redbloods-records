/**
 * Standalone smoke test for lib/red-artists/sketches-notify-pure.ts (exact
 * push text) and the owner-ack gating logic in lib/red-artists/sketches-notify.ts,
 * which reuses the already-tested classifyPushResult from lib/shalev-weekly-pure.ts.
 *
 * Run with:   npx tsx scripts/test-sketches-notify.ts
 *
 * No "server-only"/Supabase/push dependency anywhere in this file — no real
 * Supabase writes, no real push.
 */
import {
  buildNewSketchPush,
  buildNewSketchOwnerAck,
  buildSketchUpdatedPush,
  buildSketchUpdatedOwnerAck,
} from "../lib/red-artists/sketches-notify-pure";
import { classifyPushResult } from "../lib/shalev-weekly-pure";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
}

function main() {
  console.log("\n—— new-sketch push text (exact copy) ——");
  {
    const p = buildNewSketchPush("בין השורות");
    check("title exact", p.title === "הועלתה סקיצה חדשה 🎵");
    check("body exact, uses ״…״ gershayim quotes", p.body === "הועלתה סקיצה חדשה בשם ״בין השורות״");

    const ack = buildNewSketchOwnerAck("בין השורות");
    check("owner ack title exact", ack.title === "ההתראה נשלחה לשליו ✅");
    check("owner ack body exact", ack.body === "נשלחה לשליו התראה על סקיצה חדשה בשם ״בין השורות״");
  }

  console.log("—— sketch-updated push text (exact copy) ——");
  {
    const p = buildSketchUpdatedPush("עד הבוקר");
    check("title exact", p.title === "עודכנה סקיצה בפרויקט 🎵");
    check("body exact", p.body === "הסקיצה בפרויקט ״עד הבוקר״ עודכנה");

    const ack = buildSketchUpdatedOwnerAck("עד הבוקר");
    check("owner ack title exact", ack.title === "ההתראה נשלחה לשליו ✅");
    check("owner ack body exact", ack.body === "נשלחה לשליו התראה שהסקיצה בפרויקט ״עד הבוקר״ עודכנה");
  }

  console.log("—— Hebrew encoding sanity (no mangled bytes, correct length) ——");
  {
    const p = buildNewSketchPush("שיר עם רווחים ומקפים - כך");
    check("Hebrew text round-trips intact through the template literal", p.body.includes("שיר עם רווחים ומקפים - כך"));
    check("gershayim characters are the real U+05F4 punctuation mark", p.body.includes("״"));
  }

  console.log("—— owner-ack gating via classifyPushResult (reused, already tested) ——");
  {
    // Simulates sendPushToRoles(["shalev"], …)'s return shape (PromiseSettledResult[]).
    const delivered = [{ status: "fulfilled" }];
    const noSubscription: { status: string }[] = [];
    const sendFailed = [{ status: "rejected" }];

    check("real delivery → owner ack IS sent (classifyPushResult === 'sent')", classifyPushResult(delivered) === "sent");
    check("no Shalev subscription at all → NO misleading owner ack", classifyPushResult(noSubscription) !== "sent");
    check("webpush actually failed for every device → NO misleading owner ack", classifyPushResult(sendFailed) !== "sent");

    // Mixed: at least one real device got it → still counts as delivered.
    const mixed = [{ status: "rejected" }, { status: "fulfilled" }];
    check("at least one device received it → owner ack IS sent", classifyPushResult(mixed) === "sent");
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);
}

main();
