-- One clip model — production data migration (Owner decision 2026-10-01). NOT RUN until the Owner approves this file.
-- ONE transaction. Every UPDATE / INSERT is guarded on the exact BEFORE state read 2026-10-01 and checked with ROW_COUNT;
-- any difference raises and rolls the whole transaction back. No DELETE, no DROP, no schema change.
-- Precondition: the Sunny action SET_AGREED_PRICE (יהלום — קליפ, 3500 ₪) already ran — its result is guarded below.
-- Rollback: scripts/sql/2026-10-01-one-clip-model-rollback.sql

BEGIN;
DO $$
DECLARE
  n int;
  s numeric;
  -- projects
  BALAGAN_SONG   constant uuid := '92d7c2cf-c521-4cf4-90ac-9cb9afd86f9a';
  BALAGAN_CLIP   constant uuid := 'f795d947-48ee-43b1-9d31-66505637f6ca';
  YAHALOM_SONG   constant uuid := 'ba5eefb6-bc1b-49f0-8a30-56ef44380d46';
  YAHALOM_CLIP   constant uuid := '4d833ca7-4f8d-4573-843e-4cd716c95a54';
  PRINCIPE_SONG  constant uuid := 'cb7302b7-1db5-4169-af2d-b8a45e455776';
  PRINCIPE_CLIP  constant uuid := '7e528136-81d0-4382-abf7-7bdab6ce04dd';  -- the new "פרנציפ — קליפ" (created below)
  -- Red Films productions
  RF_YAHALOM     constant uuid := '87cd24ac-7c01-4eb8-8f9b-6edf03c5828a';
  RF_PRINCIPE    constant uuid := '5d443ac7-117f-4947-89b8-d90c6c6884a2';
  -- the Principe shoot session
  SESS_PRINCIPE  constant text := '726a70e1-88bd-4fb5-8c7b-366fa0049549';
  -- Principe's 10 clip expenses (₪4,955, all שולם, RECORDS, each linked to one Red Films payment)
  PRINCIPE_TX    constant text[] := ARRAY[
    '09d3fe39-75d3-470a-9848-225779026b4f', '87c05b43-070a-4a5a-b6e6-c52ac1bb5c85', '8bdaa565-71f8-45f5-a7ed-2190f8fa9f90',
    '93efd240-1ef7-400c-a595-5d728708548f', 'bbb61684-d76d-4c31-b7f0-5e7c1143d946', 'dbb43e88-3f53-48dd-894e-772069d17bb2',
    '02900aba-74ef-49c1-8ebc-bd0d6ee815f3', 'c8691277-ae9d-45c3-9ae2-4f9ce8f0dbdd', '15e86a7e-06f5-4dc4-81b2-37728529abac',
    '3b8d90cf-16ca-4926-a322-bbb45bffd7d1'];
  -- the Owner-recorded Principe clip share (artist ledger) — must stay exactly as it is
  LEDGER_LUMP    constant uuid := '14c924ec-277b-42d6-8a74-d0170271a569';
BEGIN
  -- ── BEFORE guards (exact state read 2026-10-01) ────────────────────────────────────────────────────────────────────
  PERFORM 1 FROM settings WHERE key = 'finance_' || BALAGAN_CLIP
    AND value->>'clipAgreedPrice' = '3500' AND value->>'agreedPrice' = '3500' AND value->>'currency' = '₪'
    AND value->>'clipProductionId' = 'e8e8489b-ba06-4f30-9dba-f927f8c3b043' AND value->>'financeException' = 'true';
  IF NOT FOUND THEN RAISE EXCEPTION 'BEFORE: finance_בלאגן — קליפ differs'; END IF;
  PERFORM 1 FROM settings WHERE key = 'finance_' || YAHALOM_CLIP
    AND value->>'clipAgreedPrice' = '3500' AND value->>'agreedPrice' = '3500' AND value->>'currency' = '₪';
  IF NOT FOUND THEN RAISE EXCEPTION 'BEFORE: finance_יהלום — קליפ differs (SET_AGREED_PRICE 3500 ₪ must have run)'; END IF;
  PERFORM 1 FROM settings WHERE key = 'finance_' || BALAGAN_SONG
    AND value->>'clipAgreedPrice' = '0' AND value->>'financeException' = 'true';
  IF NOT FOUND THEN RAISE EXCEPTION 'BEFORE: finance_בלאגן differs'; END IF;
  SELECT count(*) INTO n FROM settings WHERE key LIKE 'finance_%' AND value ? 'clipAgreedPrice';
  IF n <> 3 THEN RAISE EXCEPTION 'BEFORE: expected 3 clipAgreedPrice keys, found %', n; END IF;
  SELECT count(*) INTO n FROM projects WHERE id IN (BALAGAN_CLIP, YAHALOM_CLIP) AND project_type = 'קליפ' AND song_project_id IS NULL;
  IF n <> 2 THEN RAISE EXCEPTION 'BEFORE: clip projects / song links differ (%)', n; END IF;
  SELECT count(*) INTO n FROM projects WHERE id = PRINCIPE_CLIP OR name = 'פרנציפ — קליפ';
  IF n <> 0 THEN RAISE EXCEPTION 'BEFORE: פרנציפ — קליפ already exists'; END IF;
  PERFORM 1 FROM projects WHERE id = PRINCIPE_SONG AND project_type = 'שיר' AND status = 'הושלם' AND project_business_type = 'לייבל';
  IF NOT FOUND THEN RAISE EXCEPTION 'BEFORE: פרנציפ differs'; END IF;
  PERFORM 1 FROM red_films_productions WHERE id = RF_YAHALOM AND project_id = YAHALOM_SONG AND status = 'בעריכה';
  IF NOT FOUND THEN RAISE EXCEPTION 'BEFORE: Red Films יהלום differs'; END IF;
  PERFORM 1 FROM red_films_productions WHERE id = RF_PRINCIPE AND project_id = PRINCIPE_SONG AND status = 'פורסם';
  IF NOT FOUND THEN RAISE EXCEPTION 'BEFORE: Red Films פרנציפ differs'; END IF;
  PERFORM 1 FROM sessions WHERE id::text = SESS_PRINCIPE AND project_id = PRINCIPE_SONG::text AND session_type = 'צילום קליפ' AND date = '2026-06-09';
  IF NOT FOUND THEN RAISE EXCEPTION 'BEFORE: the פרנציפ shoot session differs'; END IF;
  SELECT count(*), coalesce(sum(amount), 0) INTO n, s FROM transactions
    WHERE id::text = ANY (PRINCIPE_TX) AND project_id = PRINCIPE_SONG::text AND type = 'expense' AND expense_scope = 'קליפ'
      AND payment_status = 'שולם' AND currency = '₪' AND business_unit = 'RECORDS';
  IF n <> 10 OR s <> 4955 THEN RAISE EXCEPTION 'BEFORE: Principe clip expenses differ (% rows, %)', n, s; END IF;
  SELECT count(*) INTO n FROM transactions WHERE project_id = PRINCIPE_SONG::text AND expense_scope = 'קליפ';
  IF n <> 10 THEN RAISE EXCEPTION 'BEFORE: Principe has % clip-scoped rows (expected 10)', n; END IF;
  SELECT count(*) INTO n FROM red_films_budget_payments WHERE production_id = RF_PRINCIPE AND linked_transaction_id::text = ANY (PRINCIPE_TX);
  IF n <> 10 THEN RAISE EXCEPTION 'BEFORE: Principe RF payment links differ (%)', n; END IF;
  SELECT count(*) INTO n FROM artist_balance_entries WHERE id = LEDGER_LUMP AND amount = 2480 AND description = 'קליפ - פרנציפ' AND artist_id = '8806fe5e-1238-4228-8078-b3db3ccc9b46';
  IF n <> 1 THEN RAISE EXCEPTION 'BEFORE: the Principe ledger row (2,480) differs'; END IF;

  -- ── 1. retire clipAgreedPrice (the key only — the rest of each blob is kept) ───────────────────────────────────────
  UPDATE settings SET value = value - 'clipAgreedPrice', updated_at = now()
   WHERE key IN ('finance_' || BALAGAN_CLIP, 'finance_' || YAHALOM_CLIP, 'finance_' || BALAGAN_SONG) AND value ? 'clipAgreedPrice';
  GET DIAGNOSTICS n = ROW_COUNT; IF n <> 3 THEN RAISE EXCEPTION 'settings: % rows', n; END IF;

  -- ── 2. song links (clip → its song) ───────────────────────────────────────────────────────────────────────────────
  UPDATE projects SET song_project_id = BALAGAN_SONG, updated_at = now() WHERE id = BALAGAN_CLIP AND song_project_id IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT; IF n <> 1 THEN RAISE EXCEPTION 'song link בלאגן: % rows', n; END IF;
  UPDATE projects SET song_project_id = YAHALOM_SONG, updated_at = now() WHERE id = YAHALOM_CLIP AND song_project_id IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT; IF n <> 1 THEN RAISE EXCEPTION 'song link יהלום: % rows', n; END IF;

  -- ── 3. Red Films יהלום → the clip project ─────────────────────────────────────────────────────────────────────────
  UPDATE red_films_productions SET project_id = YAHALOM_CLIP, updated_at = now() WHERE id = RF_YAHALOM AND project_id = YAHALOM_SONG;
  GET DIAGNOSTICS n = ROW_COUNT; IF n <> 1 THEN RAISE EXCEPTION 'RF יהלום: % rows', n; END IF;

  -- ── 4. פרנציפ — קליפ: a clip project with its historical dates (the same columns createClientProject writes) ──────
  INSERT INTO projects (id, name, artist, status, start_date, end_date, deadline, notes, project_type, parent_project, project_business_type, song_project_id)
  VALUES (PRINCIPE_CLIP, 'פרנציפ — קליפ', 'שליו טסמה', 'הושלם', '2026-06-09', '2026-07-31', NULL, '', 'קליפ', 'פרנציפ', 'לייבל', PRINCIPE_SONG);
  GET DIAGNOSTICS n = ROW_COUNT; IF n <> 1 THEN RAISE EXCEPTION 'insert פרנציפ — קליפ: % rows', n; END IF;
  UPDATE transactions SET project_id = PRINCIPE_CLIP::text
   WHERE id::text = ANY (PRINCIPE_TX) AND project_id = PRINCIPE_SONG::text AND expense_scope = 'קליפ' AND type = 'expense';
  GET DIAGNOSTICS n = ROW_COUNT; IF n <> 10 THEN RAISE EXCEPTION 'Principe clip expenses: % rows', n; END IF;
  UPDATE red_films_productions SET project_id = PRINCIPE_CLIP, updated_at = now() WHERE id = RF_PRINCIPE AND project_id = PRINCIPE_SONG;
  GET DIAGNOSTICS n = ROW_COUNT; IF n <> 1 THEN RAISE EXCEPTION 'RF פרנציפ: % rows', n; END IF;
  UPDATE sessions SET project_id = PRINCIPE_CLIP::text WHERE id::text = SESS_PRINCIPE AND project_id = PRINCIPE_SONG::text AND session_type = 'צילום קליפ';
  GET DIAGNOSTICS n = ROW_COUNT; IF n <> 1 THEN RAISE EXCEPTION 'Principe shoot session: % rows', n; END IF;

  -- ── AFTER checks (inside the transaction) ─────────────────────────────────────────────────────────────────────────
  SELECT count(*) INTO n FROM settings WHERE key LIKE 'finance_%' AND value ? 'clipAgreedPrice';
  IF n <> 0 THEN RAISE EXCEPTION 'AFTER: % clipAgreedPrice keys remain', n; END IF;
  SELECT count(*) INTO n FROM transactions WHERE project_id = PRINCIPE_SONG::text AND expense_scope = 'קליפ';
  IF n <> 0 THEN RAISE EXCEPTION 'AFTER: % clip rows remain on פרנציפ', n; END IF;
  SELECT count(*), coalesce(sum(amount), 0) INTO n, s FROM transactions WHERE project_id = PRINCIPE_CLIP::text AND business_unit = 'RECORDS' AND payment_status = 'שולם';
  IF n <> 10 OR s <> 4955 THEN RAISE EXCEPTION 'AFTER: פרנציפ — קליפ holds % rows / %', n, s; END IF;
  SELECT count(*) INTO n FROM artist_balance_entries WHERE id = LEDGER_LUMP AND amount = 2480;
  IF n <> 1 THEN RAISE EXCEPTION 'AFTER: the Principe ledger row changed'; END IF;
END $$;
COMMIT;
