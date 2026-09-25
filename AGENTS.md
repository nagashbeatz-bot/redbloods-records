<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# SUNNY COMPLETE SYSTEM AWARENESS (permanent Owner charter, 2026-09-25)

**SUNNY KNOWS EVERYTHING REDBLOODS KNOWS.** From the smallest operation (a status click, a resolved comment, one uploaded version, a page-load write) to the largest company flow (client → proposal → project → finance → sessions → calendar → producer → engineer → files → clip → release → show → artist balance → outcome). Existing Partner capabilities are implementation, never the knowledge boundary. "Redbloods knows it but Sunny cannot see it" is never an accepted final state: it is either closed or registered in `lib/partner/system/gaps.ts` (DATA_NOT_RECORDED / DATA_MODEL_GAP / CAPABILITY_GAP / AMBIGUOUS_IDENTITY / CONFLICTING_SOURCES / INTENTIONALLY_SECRET / TEMPORARILY_UNAVAILABLE / LEGACY_CONFLICT / SYSTEM_BEHAVIOR_GAP) with what would close it.

- **SECRETS ARE NOT KNOWLEDGE.** Passwords, cookies, OAuth tokens, service keys, API / cron / webhook secrets and bearer share links never reach Sunny. Sunny knows that an integration exists, whether it is connected, what it does, what depends on it and what failed. INTENTIONALLY_SECRET is reserved for that; ordinary detail is never excluded for being "too small".
- **CONNECT, DO NOT COPY.** Four layers: canonical live state, system knowledge, Owner organizational knowledge (P2), action / outcome history. One fact, one canonical source. Two disagreeing sources are modelled as CONFLICTING_SOURCES; they are never silently merged. P2 is never project / finance / client / show / file storage.
- **MAXIMUM KNOWLEDGE, MINIMUM CONTEXT.** Everything is retrievable by progressive disclosure (discover → summarize → traverse → fetch detail → deepen). Nothing is dumped whole into a conversation.
- **PROVENANCE.** Every item carries its epistemic status (FACT / DERIVED / OWNER_DECISION / OWNER_REPORTED / OBSERVATION / HYPOTHESIS / UNKNOWN …) and relationship quality. Free text is evidence, not a structured fact. UI labels are not server truth. History is not current state.
- **ACTIONS: EVERYTHING, WITH OWNER APPROVAL.** Knowledge access and mutation authority are separate. Every mutation is a typed primitive following UNDERSTAND → PROPOSE → PREVIEW EXACT CHANGE → OWNER APPROVAL → EXECUTE → FRESH READ → OUTCOME → HISTORY, with the action contract and approval classes in `lib/partner/system/project-actions.ts`. There is never a generic SQL writer or a generic mutation endpoint.

Every meaningful Redbloods change answers, in the same change:
1. What changed? 2. Which entities are affected? 3. Which fields / states / actions changed? 4. Which relationships changed? 5. Which user / role sees it? 6. Which read capability exposes it to Sunny? 7. Which System Awareness contract explains it? 8. What side effects exist? 9. What Push / Calendar / Dropbox / Finance effects exist? 10. Does it create a new Sunny knowledge gap (register it)? 11. Does it change an action Sunny may eventually perform (update the action inventory)? 12. Does it need a new relationship? 13. Does it change provenance / the source of truth? 14. Does it create a duplicate source? 15. Does it change history / audit / outcome semantics?

**Calendar is horizontal time context:** Sunny reads the Owner's live Google Calendar only through the Redbloods main service (the trusted integration owner; the connector never holds Google credentials; a dedicated service secret protects the internal read). Any feature that creates / stores calendar events must store the event id on its record (the only canonical calendar link) and update `lib/partner/system/calendar.ts` + `scripts/test-sunny-calendar.tsx`. A calendar read failure is never an empty calendar.

**Settings are not a blind spot:** every key family of the `settings` store is classified in `lib/partner/system/settings.ts` (A business / system information, B authentication secret — never read, C internal state with meaning, D display detail). A new settings key, prefix or settings-touching file fails `scripts/test-sunny-settings.tsx` until it is classified; A / C families must be readable by Sunny.

`SUNNY IMPACT: NONE` is allowed only for genuinely visual changes. Proof lives in tests, not in contracts: `scripts/test-sunny-complete-knowledge.tsx` pins every project-linked production column (`lib/partner/system/project-columns.ts`) and every mutating project route (`lib/partner/system/project-actions.ts`); a new column or route that Sunny cannot read / does not know fails it.

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
5. Is there a validated action primitive? Record it in `BUSINESS_ACTIONS` with its class (VALIDATED / FUTURE_PRIMITIVE_REQUIRED / SECURITY_RESTRICTED) and its confirmation classes (OWNER_APPROVAL / FINANCIAL / EXTERNAL_EFFECT / DESTRUCTIVE / STRONG). No legitimate operation is ever "never" for Sunny: risk sets the confirmation, not the prohibition. SECURITY_RESTRICTED is only for auth / roles / credentials.
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

## Sunny Awareness Check: users, roles, portals, access and Push

Any change that touches **who can log in, what a role or portal can see or do, a user-facing page for a non-owner, or any push sender** must also update `lib/partner/system/people.ts` in the same change:

- **Users / roles:** update the person contract. That means who they are, why they have access, how they authenticate, their landing page, every tab (purpose, visible data, money visibility), and their writes with the real enforcement (UI_VISIBLE / UI_HIDDEN / PROXY_ONLY / ROUTE_GUARDED / SERVER_AUTHORIZED / RLS_ENFORCED / OWNER_ONLY). Also update what they cannot do, and the pushes they receive or trigger. Keep the internal allowed / denied path samples true; the test proves them against `lib/roles.ts`.
- **Push senders:** every module that calls `sendPushToRoles` / `sendPushToAll` must be covered by a `PUSH_CONTRACTS` entry. Record recipient, purpose, trigger, type, timing, conditions, dedupe, the next step for the recipient, production-only guard, status and known bugs. Sunny may never trigger a push.
- **Access-control files** (`lib/roles.ts`, `proxy.ts`, `lib/require-auth.ts`, `lib/red-artists/portal-access.ts`, `lib/beat-scope.ts`, `lib/steven-scope.ts`, `lib/push.ts`): changing any of them fails `scripts/test-sunny-people.tsx` until the people contracts are reviewed and `ACCESS_REVIEWED_FINGERPRINTS` is updated.
- **Security gaps and UI-vs-server mismatches** are recorded in `SECURITY_GAPS` and reported to the Owner. Fixing them is a separate, approved mission.
- **Screenshots** are supplemental evidence only. Browsing production as the Owner writes data on page load (session auto-mark, push re-subscribe, task sync), so live browsing is not a read-only activity.

## Sunny Awareness Check: Projects (the central node)

Any change that touches **a project field, status / type vocabulary, a table or setting that references a project, project deletion / cascade, project money, a project page or drawer, or a page-load write on a project surface** must also update `lib/partner/system/projects.ts` in the same change:

- **Fields / vocabularies:** keep `PROJECT_FIELDS` (classified CANONICAL / DERIVED / LEGACY / DISPLAY_ONLY / AMBIGUOUS / POSSIBLE_BUG / CONFLICT) and `PROJECT_VOCABULARIES` true.
- **Relationships:** every project-referencing column must be a `PROJECT_LINKS` entry with link method, cardinality, quality (CANONICAL_RELATION / OWNER_CONFIRMED_RELATION / DERIVED_RELATION / TEXT_MATCH / AMBIGUOUS / UNKNOWN), DB enforcement, what breaks it and the live-read capability. Add new columns to `PROJECT_SCHEMA_COLUMNS`. Never claim a canonical link where the app only matches names.
- **Money:** the connected project view (`lib/partner/projects/money.ts`) reuses the Finance Brain primitives. Never add a second money rule; record conflicts in `PROJECT_MONEY_MODEL.conflictsHe` (report only).
- **Project semantics files** (`lib/projects-store.ts`, `lib/types.ts`, `app/api/projects/route.ts`, `app/api/projects/[id]/route.ts`, `lib/payment-status.ts`, `lib/clip-finance.ts`, `lib/finance/classify.ts`, `lib/project-paths.ts`, `components/ui/ProjectDrawer.tsx`, `components/AppShell.tsx`): changing any of them fails `scripts/test-sunny-projects.tsx` until the project contract is reviewed and `PROJECT_REVIEWED_FINGERPRINTS` is updated.
- **Signals are derived, never a score.** Stale is not urgent; quality before speed; label release work is protected. The portfolio is sorted by deadline, not ranked.

## Sunny Awareness Check: the Owner operating model

The Owner-confirmed way of working (deadlines, ball holder, investigate-then-ask, outside communication, cashflow vs label, advance payments, protected label artists, no fixed hours, personal calendar context, aliases, event → workflow) is a versioned system contract in `lib/partner/system/owner-model.ts`. It is applied deterministically in `lib/partner/sunny/operating.ts` and served as capability `operating_model`.
- Change a rule only when the Owner confirms it. Bump `OWNER_MODEL_VERSION` and never store confirmed rules as free notes or as P2 candidates.
- A feature that adds a business event (new show / project / payment …) must update its `WORKFLOW_MODELS` entry: what must be known, where Redbloods keeps it, downstream effects, pushes, actions.
- A new field that removes a repeated Owner question should update `QUESTION_TYPE_TO_MISSING_CONCEPT`.
- `scripts/test-sunny-operating-model.tsx` must pass.

## Sunny Awareness Check: Clients + Proposals

The customer journey (client → proposal → follow-up → conversion → project → money) is a system contract in `lib/partner/system/clients.ts`. It covers fields, vocabularies, status consumers, links with quality, the conversion flow, follow-up, lead reality, deal terms, the client_id assessment, history, actions and workflows. It is read through `client_view` / `client_portfolio` (`lib/partner/clients/view.ts`) and the CLIENT_DETAIL source.
- A change to a client / proposal column, status, route, conversion or follow-up behaviour must update that contract. `scripts/test-sunny-clients.tsx` pins the schema columns, the vocabularies the code declares, every route touching clients / proposals, and `CLIENT_REVIEWED_FINGERPRINTS`.
- Proposal amounts are POTENTIAL money. Project ↔ client by name is TEXT_MATCH; only the proposal chain is canonical. A due follow-up means "no recorded follow-up", never "the Owner did not follow up".

## Sunny Awareness Check: Label Artists

Label-artist development is a system contract in `lib/partner/system/label-artists.ts`. It covers:
- fields and vocabularies, membership, and links with quality;
- releases, money (ledger, cycles, show → ledger, media income and recoup, currency);
- portal, availability, presence, every artist push, actions and workflows.

It is read through `artist_view` / `artist_portfolio` (`lib/partner/label/view.ts`) and the LABEL_DETAIL source.
- A change to an artist / release / beat / ledger / cycle / media-income column, a vocabulary, a label / portal / beats route, show → ledger behaviour, the name → slug table or an artist push must update that contract. `scripts/test-sunny-label-artists.tsx` pins the schema, the vocabularies the code declares, the route families and `LABEL_REVIEWED_FINGERPRINTS`.
- Never invent release cadence, readiness, inactivity thresholds or payout / recoup policy. Keep the ledger, cycles, media income, recoup view, show money and client money separate. None of them stores a currency.

## Sunny Awareness Check: Shows + DJ

A live show is a system contract in `lib/partner/system/shows.ts`. It covers fields, vocabularies, status consumers, lifecycle transitions, the DJ model, money, the show → ledger paths, calendar, notifications, preparation evidence, actions and workflows. It is read through `show_view` / `show_portfolio` (`lib/partner/shows/view.ts`).
- A change to a show column, a status, the split / rehearsal rule, finance or ledger sync, DJ confirmation, show notifications or a show route must update that contract. `scripts/test-sunny-shows.tsx` pins the schema, the vocabularies, the route families and `SHOW_REVIEWED_FINGERPRINTS`.
- Show money must reuse the app's own `computeShowSplit` / `rehearsalCountedAmount`, never a second rule. Never auto-assign CLEANTONE. Shows store no currency.
