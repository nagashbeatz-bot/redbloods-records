<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Sunny Awareness Check (permanent development contract)

Sunny (סאני) is Redbloods' organizational brain. The Owner talks to Sunny through Claude, and Redbloods OS is Sunny's source of truth. Sunny's knowledge has three layers, which must never be mixed:

1. **Canonical company state:** live records, read through the Partner readers / Gateway (`lib/partner/*`, `lib/partner/operations`).
2. **Redbloods system knowledge:** how the product works. Machine-readable contracts live in `lib/partner/system/registry.ts` and are served as `partner_query` capability `system_awareness`.
3. **Owner organizational knowledge:** things only the Owner knows (nicknames, reasons, priorities). This is typed P2 knowledge in `lib/partner/owner-knowledge`, never free notes.

Every meaningful business feature change must answer the SUNNY AWARENESS CHECK in the same change:

1. Should Sunny read it? If yes, add or extend a canonical reader and register a capability in `lib/partner/knowledge/catalog.ts`. Never add a raw table reader or a per-feature MCP tool.
2. Should Sunny relate it? Add relationships with an honest quality (CANONICAL / OWNER_CONFIRMED / DERIVED / TEXT_MATCH / AMBIGUOUS / UNKNOWN). Never manufacture DB links.
3. Can Sunny learn context about it? If so, use an existing typed knowledge kind, or add a bounded kind (no generic notes). Canonical data is never copied into owner knowledge.
4. Can Sunny propose changes? Only through an existing validated Partner action primitive. Never add a generic mutation.
5. Is there a validated action primitive? Record it in `BUSINESS_ACTIONS` with its class (VALIDATED / FUTURE_PRIMITIVE_REQUIRED / NEVER_EXPOSE_TO_SUNNY).
6. What approval is required?
7. What is canonical?
8. What limitation must Sunny know? Record it in `limitationsHe`. Ignorance of a limitation is a Sunny bug.
9. Which tests prove the awareness? `scripts/test-sunny-system.tsx` must pass.

Also:
- Update the domain contract (rules classified as CANONICAL_BUSINESS_RULE / IMPLEMENTATION_BEHAVIOR / OWNER_POLICY / LEGACY_BEHAVIOR / POSSIBLE_BUG / CONFLICT, plus side effects and notifications).
- Add a `CAPABILITY_CHANGES` entry and bump `SYSTEM_BASELINE_VERSION` when Sunny's support changes.
- A new page or API group that no domain owns fails the repository-wide awareness test. Either assign it to a domain, or add a `SURFACE_EXCLUSIONS` entry with an explicit `SUNNY IMPACT: NONE` reason.
- Visual-only changes state `SUNNY IMPACT: NONE` in the commit message.
- Sunny never inspects source code at runtime and never edits code. Push, Calendar writes, Agent Alerts, settings and auth are never exposed to Sunny.
