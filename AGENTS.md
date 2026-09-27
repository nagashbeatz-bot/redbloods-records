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
- Sunny never inspects source code at runtime and never edits code. Push, Calendar writes, Agent Alerts and settings are reachable ONLY through typed, Owner-approved primitives (never a generic sender or settings writer; a push only when the app's own writer sends it). Auth, users, roles, passwords, tokens and device registration are never exposed to Sunny.

## Sunny Awareness Check: users, roles, portals, access and Push

Any change that touches **who can log in, what a role or portal can see or do, a user-facing page for a non-owner, or any push sender** must also update `lib/partner/system/people.ts` in the same change:

- **Users / roles:** update the person contract. That means who they are, why they have access, how they authenticate, their landing page, every tab (purpose, visible data, money visibility), and their writes with the real enforcement (UI_VISIBLE / UI_HIDDEN / PROXY_ONLY / ROUTE_GUARDED / SERVER_AUTHORIZED / RLS_ENFORCED / OWNER_ONLY). Also update what they cannot do, and the pushes they receive or trigger. Keep the internal allowed / denied path samples true; the test proves them against `lib/roles.ts`.
- **Push senders:** every module that calls `sendPushToRoles` / `sendPushToAll` must be covered by a `PUSH_CONTRACTS` entry. Record recipient, purpose, trigger, type, timing, conditions, dedupe, the next step for the recipient, production-only guard, status and known bugs. Sunny may never trigger a push.
- **Access-control files** (`lib/roles.ts`, `proxy.ts`, `lib/require-auth.ts`, `lib/red-artists/portal-access.ts`, `lib/beat-scope.ts`, `lib/steven-scope.ts`, `lib/push.ts`): changing any of them fails `scripts/test-sunny-people.tsx` until the people contracts are reviewed and `ACCESS_REVIEWED_FINGERPRINTS` is updated.
- **Security gaps and UI-vs-server mismatches** are recorded in `SECURITY_GAPS` and reported to the Owner. Fixing them is a separate, approved mission.
- **Presence (Owner decision Q1, 2026-09-27):** ONE shared model for every portal user (`lib/push-presence-pure.ts`): last-seen on every ping / heartbeat, a new visit = no last-seen for 30 minutes, ONE Owner push per real visit claimed atomically. Sunny shows `lastSeenAt` and the visit-push delivery state as separate facts.
- **Delivery evidence:** a one-time push marker / batch is a delivery claim (`lib/push-claims-pure.ts`: processing → `sent` only after a delivered push, else `failed`); a marker without a status predates 2026-09-27 and is unverified. Never write "sent" before delivery.
- **Screenshots** are supplemental evidence only. Browsing production as the Owner writes data on page load (push re-subscribe, task sync; the session auto-mark is retired), so live browsing is not a read-only activity.

## Sunny Awareness Check: Projects (the central node)

Any change that touches **a project field, status / type vocabulary, a table or setting that references a project, project deletion / cascade, project money, a project page or drawer, or a page-load write on a project surface** must also update `lib/partner/system/projects.ts` in the same change:

- **Fields / vocabularies:** keep `PROJECT_FIELDS` (classified CANONICAL / DERIVED / LEGACY / DISPLAY_ONLY / AMBIGUOUS / POSSIBLE_BUG / CONFLICT) and `PROJECT_VOCABULARIES` true.
- **Relationships:** every project-referencing column must be a `PROJECT_LINKS` entry with link method, cardinality, quality (CANONICAL_RELATION / OWNER_CONFIRMED_RELATION / DERIVED_RELATION / TEXT_MATCH / AMBIGUOUS / UNKNOWN), DB enforcement, what breaks it and the live-read capability. Add new columns to `PROJECT_SCHEMA_COLUMNS`. Never claim a canonical link where the app only matches names.
- **Money:** the connected project view (`lib/partner/projects/money.ts`) reuses the Finance Brain primitives. Never add a second money rule; record conflicts in `PROJECT_MONEY_MODEL.conflictsHe` (report only).
- **Project semantics files** (`lib/projects-store.ts`, `lib/types.ts`, `app/api/projects/route.ts`, `app/api/projects/[id]/route.ts`, `lib/payment-status.ts`, `lib/clip-finance.ts`, `lib/finance/classify.ts`, `lib/project-paths.ts`, `components/ui/ProjectDrawer.tsx`, `components/AppShell.tsx`): changing any of them fails `scripts/test-sunny-projects.tsx` until the project contract is reviewed and `PROJECT_REVIEWED_FINGERPRINTS` is updated.
- **Signals are derived, never a score.** Stale is not urgent; quality before speed; label release work is protected. The portfolio is sorted by deadline, not ranked.
- **One rule each (2026-09-27):** overdue = `lib/project-deadline.ts` only (valid date before today in Israel; never הושלם / בוטל / בהשהייה / hidden; an unparseable deadline is reported, never overdue); label vs client = the ONE stored business type (`lib/project-classification.ts`; the Owner rule — שליו טסמה / אבי מולה credited → לייבל — applies only at creation; a mismatch is `MISMATCH_OWNER_RULE`, fixed only by the Owner); project money = `lib/finance/project-summary.ts` (fully paid needs agreed > 0, else `PRICE_UNKNOWN`; every total is a per-currency map). The end date is stamped only on a real transition into הושלם; Steven completion never changes the project (a suggestion only).
- **Finance owned rows:** a transaction kept in step by another writer (show, mix work, clip row, Red Films line, promotion, Victor salary) is owned (`lib/finance/ownership.ts`): never deleted from Finance, its money / identity fields refused with a 409 naming the owner — the Finance route, screen and Sunny share that one rule.

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
- Never invent release cadence, readiness, inactivity thresholds or payout / recoup policy. Keep the ledger, cycles, media income, recoup view, show money and client money separate. The ledger, cycles and media income store no currency (shows carry theirs).
- **Recoup (Owner canon 2026-09-27):** only per the specific artist agreement. With no recorded rule the clip recoup is `NOT_DEFINED` everywhere — never 50 % of the budget, never the budget, never the clip price.
- **The שליו טסמה / אבי מולה agreement (Owner decision 2026-09-27, FINAL):** ONE rule layer, `lib/label-agreements.ts` (pure). It is used by the finance sync, the close-show ledger, the close dialog, the label clips / recoup routes, the label page, the media target and Sunny (`artist_view` money.agreement, `show_view` split). `scripts/test-owner-business-rules.tsx` must pass.
  - Scope: ONLY those two artists, by id (a name alone never inherits it); any other artist or a collaboration is `NOT_DEFINED`.
  - Production / mix / master = 100 % label (no artist share, no artist debt). Clip = 50 / 50 (the artist's half is an artist EXPENSE in the ledger; the amount the Owner recorded is the record). Show = 50 / 50 of the NET (revenue − DJ − counted rehearsals, the app's own `computeShowSplit`). Media = 50 / 50 of the income. Any other category = `NOT_DEFINED`.
  - Cash out ≠ label share ≠ artist share ≠ artist share funded by the label: never merged, per currency. The label P&L counts the LABEL share.
  - **Accounting = the bi-monthly CYCLE** (the app's cycle windows; the ledger's income, expenses, shows, media share and payments meet in the cycle balance). There is NO recoup: media never repays a specific clip (`MEDIA_RECOUP_TARGET` = 0), and no income is matched to a specific expense unless the Owner records an explicit link. Media records stored before 2026-09-27 carry 'recouped' values from a retired rule: history only, never evidence of an active offset.
  - The Red Films actual cost (Finance) and the artist ledger are different dimensions (e.g. Principe: 4,955 cash out vs the 2,480 clip expense the Owner recorded — approved, not a conflict).
- **Identity:** a portal / release resolves by the stable roster id first (Shalev, Avi); name-keyed links are disclosed on rename. A collaboration show is AMBIGUOUS identity and is never attributed. The released date is the FIRST release and is never cleared.
- **DJ CLEANTONE is TEAM, not a label artist (Owner decision 2026-09-27):** the roster is שליו טסמה / אבי מולה / נגש ביטס. רועי איוב (DJ CLEANTONE) is the label's DJ, shown on the team page; his only canonical identity is his client id (`lib/red-artists/cleantone.ts`); he is never an artist-cycle-reminder recipient. His portal is unchanged (PORTAL_ARTISTS keeps his slug for it only). Owner knowledge stored on his retired label-artist key is read as an alias of his DJ / client identity (`withIdentityAliases`), never rewritten.

## Sunny Awareness Check: Shows + DJ

A live show is a system contract in `lib/partner/system/shows.ts`. It covers fields, vocabularies, status consumers, lifecycle transitions, the DJ model, money, the show → ledger paths, calendar, notifications, preparation evidence, actions and workflows. It is read through `show_view` / `show_portfolio` (`lib/partner/shows/view.ts`).
- A change to a show column, a status, the split / rehearsal rule, finance or ledger sync, DJ confirmation, show notifications or a show route must update that contract. `scripts/test-sunny-shows.tsx` pins the schema, the vocabularies, the route families and `SHOW_REVIEWED_FINGERPRINTS`.
- Show money must reuse the app's own `computeShowSplit` / `rehearsalCountedAmount`, never a second rule. Never auto-assign CLEANTONE. D6 (Owner decision 2026-09-27): only a בוצע rehearsal counts toward the split (מתוכנן / בוטל never, even if paid); no page-load writer may change a show rehearsal's status (the page-load auto-mark is retired entirely, A3); a legacy auto-marked התקיים keeps the pre-D6 rule until the Owner confirms it. D5 (Owner decision + migration 2026-09-27): money received = SHOW_PAYMENT income rows in Finance (`transactions.show_id` + `show_money_role`); `showMoneyOf` is the one rule (received / remaining / credit); marking paid / closing records the REMAINDER once; payments are never deleted with a show, and a show with payments never goes back to a lead. Each show has ONE currency (`shows.currency`); its Finance rows carry it; a non-₪ show never syncs into the currency-less artist ledger. A1 (Owner canon 2026-09-27): client paid ≠ DJ paid ≠ artist paid — fee rows are created צפוי and become שולם only explicitly (the close-dialog flag, `MARK_SHOW_FEE_PAID`, or a Finance edit); a save's payment status is intent only, never an implicit undo; a paid fee is never downgraded or re-priced (`PAID_FEE_ROW_MISMATCH` reports a disagreement). Known open bug (reported, not fixed): reverting / deleting a show with no client payment hard-deletes a fee row already שולם.

## Sunny Awareness Check: Victor (external producer)

Victor's work is a system contract in `lib/partner/system/victor.ts`. It covers fields, vocabularies, settings, identity, states, the handoff / ball model, files, feedback, money, portal, pushes, actions, workflows, signals and integrity. It is read through `victor_view` / `victor_portfolio` (`lib/partner/victor/view.ts`).
- A change to a Victor work column, status / work-state / outcome, a `vendor_victor_*` / `victor_*` setting, a Victor route (`app/api/vendor/victor/*`, `app/api/dropbox/vendor-*`), the ball rule, the salary view or a Victor push must update that contract. `scripts/test-sunny-victor.tsx` pins the schema, the vocabularies, the settings keys, the route families and `VICTOR_REVIEWED_FINGERPRINTS`.
- The handoff must reuse the app's own `computeVictorBall`, never a second rule. A disagreeing send log is shown as CONFLICTING_EVIDENCE, not resolved.
- A salary month is paid only when a finance row is שולם. Overrides and legacy keys are Owner statements, and a disagreement is a conflict. Never mix $ and ₪. The monthly goal is a KPI, never a pay rule. There is no workload cap and no performance score.
- Victor portal security is enforced server-side, and `scripts/test-victor-portal-security.tsx` proves it with the real routes on fakes:
  - Victor may change nothing on a work record (every work PATCH is refused).
  - Every Victor file read / download / delete / upload must lie inside the work's own canonical folder (`lib/victor-scope.ts`); malformed or out-of-folder paths fail closed.
  - Victor may delete only a file whose recorded uploader is `victor`.
  - Victor responses carry no storage path, link or salary.
  - Lookups by project id, the folder builder and the raw storage routes are Owner-only, checked in-route as well as at the proxy.
- A new Victor-reachable route or file operation must use that scope module and extend that test.
- Remaining findings stay in `SECURITY_GAPS` with an honest status (REPORTED_NOT_FIXED / REMEDIATED with proof / PARTIALLY_REMEDIATED). Fixing an open one is a separate, approved mission.

## Sunny Awareness Check: the team ball cycle + retired income status (2026-09-27)

- **Ball cycle (Owner-approved):** the team uploads a version → the ball is the Owner's (`WAITING_FOR_OWNER_FEEDBACK`); the Owner sends notes → the ball is the team's (`WAITING_FOR_NEW_VERSION_FROM_TEAM`); a new version → the Owner again.
  - `lib/team-ball-cycle.ts` names the stage over the app's own evidence rules (`computeVictorBall`, `engineerHandoff`). It never adds a second rule.
  - Feedback on a version that was already superseded when it was given (Victor notes / a Steven comment) never moves the ball.
  - Time never completes a work.
  - An outbound `pending_feedback` send waits on the recipient (`WAITING_FEEDBACK`, EXTERNAL); only a received version is the Owner's feedback due (`OWNER_FEEDBACK_DUE`).
- **'לבדיקה' is retired:** `DEPRECATED_PAYMENT_STATUSES` in `lib/finance/classify.ts`.
  - The shared finance writer refuses it on create / update (400), and no picker or Sunny status list offers it.
  - A legacy row stays readable, is neither received nor expected, and is never converted automatically. Production inventory 2026-09-27: 0 rows.

## Sunny Awareness Check: Steven + Mix Pipeline

Mix / master work (Steven and any other engineer) is a system contract in `lib/partner/system/mix.ts`. It covers:
- fields of the seven mix tables, settings, vocabularies, engineer identity and Steven-specific vs generic behavior;
- the work unit and creation paths, statuses, handoff evidence, versions, comments, final files, money;
- the portal, pushes, consumers, actions, workflows, signals, security and integrity.

It is read through `mix_view` / `mix_portfolio` (`lib/partner/mix/view.ts`).
- A change to an engineer-work / version / comment / attachment / riddim-line / pre-mix-note / final-file column, a status / work type / version status, the Steven page status mapping, the mix setup engineers, a `steven_*` / `final_files_batch:` setting, a mix route, the completion flow, the payment sync or a mix push must update that contract. `scripts/test-sunny-mix.tsx` pins the schema, the vocabularies, the settings literals, the route families + action inventory and `MIX_REVIEWED_FINGERPRINTS`.
- Reuse the app's own rules (final-files request flags, closed status, newer-version comparison, Finance validation), never a second rule.
- Completed ≠ approved ≠ final files ≠ paid. The latest version is the newest upload, never the highest number. $ and ₪ are never added. The 3.25 ratio / $200 / PayPal ×1.05 are code working values, not Owner policy — 3.25 / ×1.05 only produce a labelled estimate in the notes. An engineer is a free-text name; only exactly "Steven" is Steven.
- **One writer (2026-09-27):** every path reconciles the linked expense through `lib/writes/mix.ts` reconcileEngineerExpense, recorded in the WORK currency (e.g. $200); a שולם row is never overwritten or deleted and un-pay is refused while it is שולם. Paid = `lib/mix-payment-pure.ts` isEngineerWorkPaid for every screen and Sunny. Engineer completed ≠ project completed: Steven's completion only suggests completing the project.

## Sunny Awareness Check: Red Films + Clip / Video

Video production is a system contract in `lib/partner/system/red-films.ts`. It covers:
- fields of the ten video tables, the clip settings keys, vocabularies;
- the two systems (Red Films production vs the project clip deal), statuses, money layers, crew, shoots + calendar, files;
- consumers, actions, workflows, signals, security and integrity.

It is read through `video_view` / `video_portfolio` (`lib/partner/redfilms/view.ts`).
- A change to a Red Films / clip column, a production / edit / collection status, a budget-line / document / equipment / clip category, a video route, the send-clip or promote flow, a writer of expense scope קליפ, or the shoot-session model must update that contract. `scripts/test-sunny-red-films.tsx` pins the schema, the vocabularies, the route families + action inventory, the expense-scope writers and `RF_REVIEWED_FINGERPRINTS`.
- Planned ≠ spent: production budget, budget lines and clip rows are planning; a Red Films payment is real money that left the company; only Finance expenses with scope קליפ are actual spend, and only שולם is paid. Never add currencies: every Red Films money row carries its currency (productions, budget lines, payments = the line's currency, equipment; migration 2026-09-27); totals are per currency; a line with payments never changes currency.
- Clip income (scope קליפ on income) is revenue, never a video expense.
- **RF payment → exactly ONE linked Finance expense (DB-1, Owner-approved, live 2026-09-27):** `red_films_budget_payments.linked_transaction_id` (UNIQUE → transactions, ON DELETE SET NULL) is written ONLY by `lib/writes/rf-finance-link.ts` (expense, שולם, the payment's amount + currency — no FX, its date / method, the production's project, scope קליפ; compare-and-swap, a lost race removes the new expense).
  - A new payment links automatically (`insertBudgetPayment`); an edit propagates amount / date / method; a delete removes the expense with the payment. The linked expense is Finance-owned `RF_PAYMENT` (notes only).
  - A non-clip production → `SCOPE_REQUIRED` (never an invented scope); a clip production without a project → `PROJECT_REQUIRED`; a similar unlinked Finance expense → `POSSIBLE_DUPLICATE` (the Boss decides). The payment stays unlinked and it is reported.
  - Historical payments are linked only by the Boss's typed actions `LINK_RF_PAYMENT_TO_FINANCE` / `LINK_RF_PAYMENTS_FOR_PRODUCTION`. A linked payment is counted once (in Finance); "outside Finance" readers count only unlinked payments. `scripts/test-rf-finance-link.tsx` must pass.
- **A ≠ B ≠ C ≠ D (Owner canon 2026-09-27):** client clip price ≠ planned budget ≠ actual paid cost ≠ recoup (`NOT_DEFINED`). 'שלח קליפ' starts a production at budget 0 in the deal currency — the price never sets the budget, no lock. A budget line is paid only from its payments in the line currency (`lib/clip-rf-money-pure.ts` budgetLinePaidState); the stored line status is planning intent. A Red Films payment is real company money, not yet linked to Finance (DB-1 awaits approval); a non-clip production has no canonical scope (`SCOPE_REQUIRED`). 'העבר לכספים' keeps the planning row, claimed and linked.
- A passed shoot date never proves a shoot. A release never requires a video. Crew names are free text.

## Sunny Awareness Check: the whole company (ONE Sunny)

The whole-system model is a contract in `lib/partner/system/company.ts`. It covers:
- the attention map (every domain signal → nature, dimensions and whose move; no score);
- the cross-domain graph with relationship quality, source precedence per concept, and the question planner;
- the E2E workflows, gap root causes and future primitives;
- repo and table coverage, the depth reconciliation and the discoveries.

It is read through `company_view` (`lib/partner/company/view.ts`), which composes every Deep Brain view and adds no second rule.
- **A new signal code** in any domain view fails `scripts/test-sunny-company.tsx` until it is mapped in `ATTENTION_MAP`.
- **A new non-partner `lib/` module** fails until it matches a `REPO_COVERAGE` entry.
- **A new table** read or written with `.from("…")` fails until it is in `TABLE_COVERAGE`.
- **A new knowledge gap** must resolve to a root cause through `gapRootOf`.
- Attention ≠ problem. Label spend is INVESTMENT. Cashflow vs label is a tension for the Owner to decide.
- The presentation order is fixed and is never a priority.
- Agent alerts are context only; they are never action truth.
- Decisions are Owner-only. A known decision is re-evaluated against live state, never answered by Sunny.
- "What changed" shows only recorded timestamps.
- The morning brief is produced on request only: no Push, no Cron.

## Sunny Awareness Check: Sessions, Tasks, Meetings, Albums, Delivery, Social, Files, Reports, Sunny core + connector

These ten domains are contracts:
- `lib/partner/system/work-domains.ts` covers every column, the vocabularies pinned to the code, every route with its auth and writes, relations, rules, side effects, production state and gaps.
- `lib/partner/system/platform-domains.ts` covers:
  - the storage namespaces and operations, and the live-listing decision;
  - the reports model, every background job and the attention engines;
  - the code business goals;
  - the Sunny core stores and the connector model.

They are read through `session_view`, `task_view`, `meeting_view`, `album_view`, `delivery_view`, `social_view`, `storage_view`, `reports_view` and `sunny_self` (`lib/partner/work/view.ts`, `lib/partner/self/view.ts`).

`scripts/test-sunny-full-brain.tsx` fails on any of these:
- a new column in those tables;
- a changed vocabulary;
- a new route in those families;
- a new in-process schedule or secret-protected cron route;
- a changed connector tool list;
- changed code business goals.

Rules:
- A passed date is never "happened". Since 2026-09-27 no page load writes a session status (the auto-mark is retired): התקיים is an explicit Owner record; a passed מתוכנן is 'עבר — לא אושר'; התקיים on a session that ended on / before `AUTO_MARK_RETIRED_AT` may be a legacy auto-mark. The calendar pull never changes a status (it reports `statusConflicts` / `calendarErrors`).
- "Delivered" is always dated; `lastDeliveredAt` keeps delivery history (DELIVERED_BEFORE).
- Task links by notes / title markers stay TEXT_MATCH.
- "Delivered" comes only from a delivery record.
- The social checklist is implementation behaviour, never a release verdict.
- Files are served as metadata only (never a path or link); storage-only files are a registered gap.
- Report money (creation date, ₪ only weekly) is a registered conflict with the Finance Brain.
- Sunny never claims conversation memory. The connector audit is insert-only and unreadable by Sunny.

## Retired: the in-app AI assistant ("Mai")

The older in-app AI assistant was removed on 2026-09-25 by Owner decision. Sunny, through Claude, is the only AI / organizational partner.
- Never re-add an in-app chat, prompt, context builder, model router or model SDK.
- `lib/feature-flags.ts` `AGENT_ALERT_RULES_ENABLED` (off) gates only the rule-based agent-alert pipeline, never AI.
- The reports keep their deterministic recommendations.
- Its storage was removed too (2026-09-25, Owner-approved SQL): the empty memory table and the six `ai_budget_*` / `ai_log_*` settings keys.
- `scripts/test-mai-removed.tsx` must pass.

## Sunny Awareness Check: the Universal Action Layer (Wave 0)

Every Redbloods write is a typed contract in ONE registry, `lib/partner/act/registry.ts`, built from the domain action inventories plus supplementary contracts. Each contract records availability (SUNNY_EXECUTABLE / SUNNY_NEEDS_HARDENING / SUNNY_BLOCKED / SUNNY_INTENTIONALLY_EXCLUDED + detail), risk class, confirmation class, declared and possible side effects, phase, reversibility and wave. There is one engine for all actions: plan → server-side preview → the Boss's approval → fresh read + stale check → execute → verify → outcome → audit. The engine lives in `lib/partner/act/{plan,approval,engine}.ts`.
- **EVERY write / mutation / execution requires the Boss's explicit approval** of the exact previewed change. Risk classes shape the preview; they never permit execution. `partner:act` ≠ autonomy.
- **Wave 0 executes nothing through Claude.** The two validated primitives (deadline, paid expense) stay dashboard-approved. The act scope and tools are defined but not grantable or registered until the Boss approves the action-layer DDL and enables them.
- **A new or changed write route** fails `scripts/test-sunny-act-foundation.tsx` until you run `node scripts/gen-act-handler-map.mjs` and then review the registry:
  - G1: every handler maps to an action;
  - G2: every accepted field is classified (`lib/partner/act/fields.ts`);
  - G5: every reachable side effect is declared.
- **A new status value** must be in `lib/partner/act/transitions.ts` (G3).
- **A new background / page-load writer** must be in `lib/partner/act/background.ts` (G4). Never call `/api/push/check` on page load.
- **A new business action or workflow event** must map in `lib/partner/act/business-events.ts` (G6).
- **Plan persistence is allowlist-only** (`lib/partner/act/persist.ts`):
  - What may be stored is only the plan's fixed fields: the contract's declared typed arguments, canonical entity keys, 64-hex fingerprints, and scalar before / after values.
  - Anything credential-like, path-like, URL-like or route-like, and any undeclared or nested field, REJECTS the plan. It is never trimmed or redacted into storage, and the engine refuses such a plan before approval.
  - Event and outcome details are redacted and capped.
  - A new argument must be typed, and must never be named sql / path / url / token / body / headers.
- **What the action layer never has:** a generic SQL / DB / REST / PATCH writer, arbitrary route / code / file-path execution, a security delegation, or a push outside an approved business action.
- **Discovered unsafe behaviour** is classified in `NEEDS_HARDENING` and fixed only in a separate, approved mission. D5 stays blocked until its SQL is approved; D6 and D7 are decided (2026-09-27). Formerly: D5 / D6 / D7 stay BLOCKED_BY_OWNER_DECISION. Wave 1 is not started without the Boss's GO.
- **Owner identity:** the Owner is Nagash (נגש), the final authority; Sunny addresses the Owner as "בוס" naturally (not in every sentence). Auth / DB records are not renamed.

### Universal Action Layer — Wave 1 (real hands, built OFF)

- **The 13 READY primitives** live in `lib/partner/act/primitives.ts`. Each is a narrow, internal, reversible edit through the SAME shared writer the UI route uses (`updateProject`, `updateReleaseDetails`, `updateMixCommentStatus`, `updateMixVersion`, `updateLabelArtist`, `updateVictorWork`): no push / email / calendar / Google Tasks / files / finance / delete / bulk.
- **Adding a primitive means:** a spec there (resolve → read → plan → apply → verify), a READY W1 contract in `registry.ts` with typed args + `fields`, and cases in `scripts/test-sunny-act-wave1.tsx` (happy / invalid / missing / wrong type / stale / no approval / exact verify). Never expose a candidate whose writer is whole-body, full-replacement, unvalidated, or has external side effects: classify it NEEDS_HARDENING / BLOCKED.
- **The ONE path is:** MCP tool (connector, relay only) → `POST /api/partner/internal/act` on MAIN, secured by its own secret (`PARTNER_INTERNAL_ACT_SECRET`), with the endpoint 404 unless `PARTNER_ACT_ENABLED=true` → `lib/partner/act/service.ts` → the engine → `store-supabase.ts` (the 4 action tables; fail closed; allowlist persistence).
- **Enabling it needs all of these:**
  - on MAIN: `PARTNER_ACT_ENABLED=true` and `PARTNER_INTERNAL_ACT_SECRET`;
  - on the connector: `PARTNER_MCP_ACT_ENABLED=true`, the same secret, and `PARTNER_MAIN_BASE_URL`;
  - a NEW Owner consent listing `partner:act` (a refresh never adds a scope).
  It is never switched on without the Boss's explicit approval.
- **Sunny speaks to the Owner as "בוס":** preview → wait for an explicit "כן" → execute → report the fresh read. Every write needs a new approval, and a changed plan needs a new preview.

### Universal Action Layer — 100% coverage (permanent Owner directive, 2026-09-27)

- **The target is 100% of legitimate Redbloods operations**, each executable by Sunny after the Boss's explicit approval. Sensitivity sets how strong the safeguards are (preview, confirmation, stale check, verification); it never sets whether an operation is supported.
- **Every operation is in `lib/partner/act/matrix.ts`**, in exactly one class:
  - EXECUTABLE;
  - NEEDS_HARDENING, with the required work and a destination wave;
  - BLOCKED_BY_MISSING_CAPABILITY, with the required work (a product decision or data model);
  - INTENTIONALLY_SECURITY_EXCLUDED, which is only allowed for secret / credential flows, identity-bound actions of another user, or system machinery. The owner equivalent is named whenever one exists.
- Waves are sequencing only (`WAVE_PLAN`), never exclusions.
- **New guards in `scripts/test-sunny-act-foundation.tsx`:**
  - G7: the matrix has no orphan and no dead end, and the exclusion list is pinned.
  - G8: every mutating UI fetch (button / form / toggle / upload / delete) maps to a registered write handler.
  - G9: no server actions and no browser-side database writes.
- A new mutation anywhere fails these guards until it is registered.

### Universal Action Layer — primitive families (one mission, 2026-09-27)

- **Primitives live per family in `lib/partner/act/primitives/`** (`core.ts` framework, `wave1.ts`, `projects.ts`, `crm.ts`, `sessions.ts`, `finance.ts`, `shows.ts`, `mix.ts`, `victor.ts`, `label.ts`, `redfilms.ts`, …) and are listed once in `primitives/index.ts`. The registry builds each READY contract from the primitive's `meta` — one source.
- **Every primitive calls a shared writer in `lib/writes/*`, and the UI route calls the SAME writer.** A route whose logic is inline is refactored into `lib/writes/<family>.ts` first; hardening (validation, CAS claims, calendar follow-through, dependent cleanup) is done there, so the UI benefits too. Record each fix in `HARDENED` (`registry.ts`) and remove it from `NEEDS_HARDENING`.
- **The action layer reaches integrations only through `lib/writes/*`** (Google via `lib/writes/calendar.ts`); primitives, service, stores and relay never call Google / push / Dropbox / a table directly (H1 / H1b / 27).
- **External effects are declared and previewed:** CALENDAR / GOOGLE_TASKS / EMAIL (invites) / PUSH (only a push the app's own writer already sends) / DELETION / FINANCE. Deletes, money and invitations highlight their key values in the preview (`requiredValues`); a disconnected integration is refused, never reported as done.
- **Simple approval (Owner decision 2026-09-27):** after a clear preview, "מאשר" / "כן, מאשר" / "מאושר" is enough — the Boss never repeats amounts, dates, recipients or words (`lib/partner/act/approval-text.ts`). The token binds the exact plan hash + Owner + client + expiry + one-time nonce; execution re-reads live state (STALE → nothing runs). An approval that also changes something ("מאשר אבל 500 במקום 400") is APPROVAL_WITH_CHANGES → a new plan; an older preview superseded by a newer open one is AMBIGUOUS_OPEN_PREVIEWS (never guessed).
- **Coverage:** every census operation carried out by primitives has a `COVERAGE_MAP` entry (`full` or `remaining`). Every primitive has a `PRIMITIVE_SYSTEM_DOMAIN` entry, and every business action it executes a `BUSINESS_ACTION_PRIMITIVES` entry — G10 keeps `DOMAIN_CONTRACTS.support.execute` and `BUSINESS_ACTIONS.sunnyCanExecuteToday` equal to them. Domain action inventories do not restate executability (`sunnyToday: "SEE_ACTION_COVERAGE"`).
- **Each family has a test** (`scripts/test-sunny-act-<family>.tsx`, on `scripts/fixtures/act-harness.ts`): happy path with exact verification, invalid args, missing entity, wrong type, stale → no write, no approval → no write, plus family rules, pinned vocabularies and shared-writer checks.
- **The `partner:act` consent text and the served coverage line stay accurate** (typed registered actions only, never generic write access; the effects list is derived from the primitives).
- **Addressability:** an action Sunny cannot target is not an action Sunny can perform. Every key kind a primitive parses must be listed by the `action_targets` capability (`lib/partner/act/targets.ts`, built only from already-loaded sources, no new table reader), resolved by `partner_resolve`, or documented in `NON_KEY_TARGETS` (e.g. a wrong sketch id is refused WITH the artist's sketches). `scripts/test-sunny-act-targets.tsx` fails on an unaddressable kind.
- **Files:** an existing file is addressed by a server-computed handle (project + fileRef, Victor work + fileRef, work + briefRef), never a path.
- **File Channel (Boss decision 2026-09-27):** a new file reaches Redbloods through the **Sunny Inbox** folder of the connected storage (`lib/writes/inbox.ts`). The MCP request limit (16 KB) and a conversation without raw attachment bytes make that the channel. Sunny sees inbox items only as handles (24-hex) + name + size. Placement goes through `lib/writes/file-channel.ts` → the SAME upload writers the screens use (`lib/writes/uploads.ts` + the mix / label / Victor writers): the screens' own limits, types, destinations, duplicate behaviour and notifications, never a new policy. The inbox item is consumed only on success. A new placement = a destination in file-channel + an `UPLOAD_PRIMITIVES` entry + a case in `scripts/test-sunny-act-uploads.tsx`.
- **Conversation → Redbloods file transfer is OWNER_DEFERRED (2026-09-27):** no upload endpoint, deposit ticket, allowed-domain flow or MCP upload App is built, and no security guard is weakened for it. The Sunny Inbox stays the fallback; rows that need new bytes are classified `OWNER_DEFERRED_CLAUDE_FILE_TRANSFER` (candidate `SUNNY.CLAUDE_FILE_TRANSFER`).

### Universal Action Layer — compound plans, history, Claude operability (2026-09-27)

- **Compound plan:** one business event = `partner_plan_action` with `steps: [{ actionId, args }]` (2–20, execution order; one logical request = one plan, e.g. 11 album tracks). The server resolves every step, the preview shows every step, and ONE approval is bound to the exact whole-plan hash (a changed step / argument / entity / effect = a new plan). Before anything runs every step is re-read (any change → STALE, nothing runs). Steps run in order, each at most once; a failure stops later steps and the result says exactly which applied / failed / did not run (never "done"; no automatic rollback). Two steps on the same record are refused; a step that needs a record another step creates is planned right after, with the created record.
- **Self-change vs external change (2026-09-27):** records created by EARLIER steps of the SAME execution never make a later step STALE — the engine passes the ids those steps returned (`excludeCreated`) and `withExcluded` (`primitives/core.ts`) leaves exactly those ids out of every creation-context list reader (the duplicate reader, `albumTrackOrder`). Never exclude by name / amount / number. An external change (before execution or between steps) still → STALE. A new list-based creation context must be added to `withExcluded` with a self-change + external-change test. In-plan rules are checked at planning (`albumPlanConflict`: the same album track number twice, add + move on one album).
- **Connector rate limits:** general 30/min + 300/h, action 40/h + 150/24h (per token, in memory, sliding). `gate()` (`lib/integrations/partner-mcp/rate-limit.ts`) counts a request only when EVERY limiter it belongs to allows it; RATE_LIMITED returns `limiter` + `retryAfterSec`. Changing a ceiling needs the Boss's decision.
- **Action history:** `partner_plan_status` with `history: true` (filters since / before / actionId / entity / outcome, `limit` ≤ 50, cursor `nextBefore`) or a `planId` for detail. It is read-only and Owner-scoped. It never exposes an approval token, confirmation text, secret or path.
- **Claude operability:** every census row also carries `claude` (`lib/partner/act/matrix.ts`): EXECUTABLE_FROM_CLAUDE / OWNER_DEFERRED_CLAUDE_FILE_TRANSFER / HUMAN_INTERACTION_REQUIRED (`HUMAN_BOUNDARIES`: OAuth, device, another person) / INTENTIONALLY_SECURITY_EXCLUDED / WAITING_ON_OWNER_DECISION / ENGINEERING_GAP (must be 0; G12). "Go click it in Redbloods" is never Claude operability.
- **Improvement candidates** (`IMPROVEMENT_CANDIDATES`) are not census rows: project-file rename / move, the atomic project-delete DB function, Red Films approval history, the Claude file transfer.
- **Stage card:** `next_steps` mode `stage` turns a record's lifecycle + state (from its live view) into currentStage + Owner-decided meaning, nextExpectedEvent, expectedFrom, evidence, ownerAction, sunnyAction (executable typed actions only) and blockingUnknowns. D7: Red Films "מאושר" = the Owner approved the CURRENT stage to proceed. It is not client approval, payment, the final version or delivery.
- **URL fields (Boss decision 2026-09-27):** a URL is stored only through a typed `url` argument (`persist.urlProblem`: http(s), no user / password, no credential parameter or token shape, no localhost / IP) into a field meant for a link. The preview shows the exact new URL and field; an old link is only a fingerprint (`link#…`). Nothing is fetched because a link was stored (the intake reads its folder once to build the preview). Primitives never name storage columns — MAIN's wiring (`server.ts`) maps typed link args to columns.
- **Improvement candidates:** something Redbloods itself cannot do (no route, no screen: inventory enforcement `NO_ROUTE`) is not a census operation. It is an `IMPROVEMENT_CANDIDATES` entry (`registry.ts`, PRODUCT / INFRASTRUCTURE) for the Boss, never a Sunny gap.
- **Bulk:** a bulk primitive fingerprints the exact set it will change (any change before execution is STALE); the preview states it is a bulk update ("עדכון גורף") and the exact set.
- **Execution truth (2026-09-27):** a plan executes at most once (a replay returns the record; a new approval of an executed plan is `ALREADY_EXECUTED`, a running one `IN_PROGRESS`). A plan is EXECUTED only when every step applied / needed no change — otherwise `PARTIALLY_APPLIED` / `STALE` / `FAILED` / `IN_PROGRESS` / `OUTCOME_UNKNOWN`, with each step's own outcome. A step claimed by a crashed run is reconciled read-only after 5 minutes by its own verify. A money create that looks like an existing record needs the server-issued `duplicateAck` with the Boss's explicit "separate record" answer.
- **One registry truth:** a census row whose whole outcome live primitives carry out (`COVERAGE_MAP` full) is EXECUTABLE in the registry itself; planning its id answers `USE_PRIMITIVES` with the primitives to plan.
