# Sunny (סאני): one entity, many internal names

To the Owner there is one entity, **Sunny (סאני)**. Claude is its conversational voice. Redbloods Partner holds its brain, memory, actions and outcomes.

## User-facing identity (renamed)
- Hebrew UI: "סאני צריך ממך", "מה סאני למד ממך", "מה סאני מציע", "מה סאני ביצע", the "סאני" card heading, and the "דרך סאני" label.
- MCP connector: `serverInfo.title` and `resource_name` are **"Redbloods Sunny"**, tool titles read "Redbloods Sunny — …", and the server instructions present the entity as סאני.
- The consent page is titled "חיבור Claude לסאני — Redbloods Sunny".

## Where "Partner" intentionally stays
These are stable identifiers. Renaming any of them would break the live connector, audit history or DB CHECKs.
- **Modules:** `lib/partner/*` and the Partner Gateway (`lib/partner/gateway`, `lib/partner/knowledge`).
- **MCP protocol:** the protocol name `redbloods-partner` and the tool names (`partner_brief`, `partner_resolve`, `partner_entity`, `partner_query`, `partner_answer_question`, `partner_propose_knowledge`).
- **OAuth:** the scopes `partner:read`, `partner:answer`, `partner:knowledge` and the OAuth internals (`rbmcp_` client ids, `partner_mcp_*` functions).
- **DB tables:** `partner_owner_context`, `partner_owner_knowledge`, `partner_gateway_audit`, `partner_action_events`, and every other `partner_*` table.
- **Action ids:** `UPDATE_PROJECT_DEADLINE`, `RECORD_PAID_EXPENSE`.
- **Env flags:** `PARTNER_MCP_*` and `PARTNER_OWNER_KNOWLEDGE_ENABLED`.
- **Internal enum values:** e.g. the integrity decision `via: "CLAUDE"`, which the UI now shows as "דרך סאני".

## Every persistent operation has exactly one kind
1. **READ KNOWLEDGE:** Partner Gateway / `partner_query`.
2. **ANSWER EXISTING QUESTION:** `partner_answer_question` (P1).
3. **LEARN ORGANIZATIONAL KNOWLEDGE:** `partner_propose_knowledge` (P2). Typed kinds only. The flow is preview, then Owner confirmation, then commit.
4. **PROPOSE BUSINESS ACTION:** `sunny/action-proposal.ts` (P3). Preview only and not wired to MCP.
5. **APPROVE / EXECUTE:** only through the existing action primitives, in the Redbloods dashboard.

There is no generic write, SQL, table, JSON-document or key/value path.
