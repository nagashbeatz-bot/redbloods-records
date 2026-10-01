-- Rollback of scripts/sql/2026-10-01-one-clip-model.sql — restores the exact BEFORE state. ONE transaction, guarded.
-- Only for use if the Owner asks to undo the migration. The new project row is removed only when nothing else points at it.
BEGIN;
DO $$
DECLARE
  n int;
  BALAGAN_SONG   constant uuid := '92d7c2cf-c521-4cf4-90ac-9cb9afd86f9a';
  BALAGAN_CLIP   constant uuid := 'f795d947-48ee-43b1-9d31-66505637f6ca';
  YAHALOM_SONG   constant uuid := 'ba5eefb6-bc1b-49f0-8a30-56ef44380d46';
  YAHALOM_CLIP   constant uuid := '4d833ca7-4f8d-4573-843e-4cd716c95a54';
  PRINCIPE_SONG  constant uuid := 'cb7302b7-1db5-4169-af2d-b8a45e455776';
  PRINCIPE_CLIP  constant uuid := '7e528136-81d0-4382-abf7-7bdab6ce04dd';
  RF_YAHALOM     constant uuid := '87cd24ac-7c01-4eb8-8f9b-6edf03c5828a';
  RF_PRINCIPE    constant uuid := '5d443ac7-117f-4947-89b8-d90c6c6884a2';
  SESS_PRINCIPE  constant text := '726a70e1-88bd-4fb5-8c7b-366fa0049549';
BEGIN
  UPDATE sessions SET project_id = PRINCIPE_SONG::text WHERE id::text = SESS_PRINCIPE AND project_id = PRINCIPE_CLIP::text;
  GET DIAGNOSTICS n = ROW_COUNT; IF n <> 1 THEN RAISE EXCEPTION 'session: % rows', n; END IF;
  UPDATE red_films_productions SET project_id = PRINCIPE_SONG, updated_at = now() WHERE id = RF_PRINCIPE AND project_id = PRINCIPE_CLIP;
  GET DIAGNOSTICS n = ROW_COUNT; IF n <> 1 THEN RAISE EXCEPTION 'RF פרנציפ: % rows', n; END IF;
  UPDATE transactions SET project_id = PRINCIPE_SONG::text WHERE project_id = PRINCIPE_CLIP::text AND expense_scope = 'קליפ' AND type = 'expense';
  GET DIAGNOSTICS n = ROW_COUNT; IF n <> 10 THEN RAISE EXCEPTION 'Principe expenses: % rows', n; END IF;
  SELECT count(*) INTO n FROM transactions WHERE project_id = PRINCIPE_CLIP::text;
  IF n <> 0 THEN RAISE EXCEPTION 'פרנציפ — קליפ still has % transactions', n; END IF;
  SELECT count(*) INTO n FROM sessions WHERE project_id = PRINCIPE_CLIP::text;
  IF n <> 0 THEN RAISE EXCEPTION 'פרנציפ — קליפ still has % sessions', n; END IF;
  DELETE FROM projects WHERE id = PRINCIPE_CLIP AND name = 'פרנציפ — קליפ';
  GET DIAGNOSTICS n = ROW_COUNT; IF n <> 1 THEN RAISE EXCEPTION 'project row: % rows', n; END IF;
  UPDATE red_films_productions SET project_id = YAHALOM_SONG, updated_at = now() WHERE id = RF_YAHALOM AND project_id = YAHALOM_CLIP;
  GET DIAGNOSTICS n = ROW_COUNT; IF n <> 1 THEN RAISE EXCEPTION 'RF יהלום: % rows', n; END IF;
  UPDATE projects SET song_project_id = NULL, updated_at = now() WHERE id IN (BALAGAN_CLIP, YAHALOM_CLIP);
  GET DIAGNOSTICS n = ROW_COUNT; IF n <> 2 THEN RAISE EXCEPTION 'song links: % rows', n; END IF;
  UPDATE settings SET value = value || jsonb_build_object('clipAgreedPrice', 3500), updated_at = now() WHERE key IN ('finance_' || BALAGAN_CLIP, 'finance_' || YAHALOM_CLIP);
  GET DIAGNOSTICS n = ROW_COUNT; IF n <> 2 THEN RAISE EXCEPTION 'settings (3500): % rows', n; END IF;
  UPDATE settings SET value = value || jsonb_build_object('clipAgreedPrice', 0), updated_at = now() WHERE key = 'finance_' || BALAGAN_SONG;
  GET DIAGNOSTICS n = ROW_COUNT; IF n <> 1 THEN RAISE EXCEPTION 'settings (0): % rows', n; END IF;
END $$;
COMMIT;
