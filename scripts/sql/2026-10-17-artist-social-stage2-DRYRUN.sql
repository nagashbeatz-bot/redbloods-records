-- Stage 2 (series + weekly targets) — DRY RUN. ONE DO block that ALWAYS ends with RAISE EXCEPTION, so PostgreSQL undoes the
-- whole block (schema + rows) even if the editor auto-commits; the outer BEGIN / ROLLBACK is a second layer. No COMMIT statement.
BEGIN;
DO $dry$
DECLARE
  v_out text := '';
  v_pre text; v_post text;
  d date := (now() AT TIME ZONE 'Asia/Jerusalem')::date;
  v_nagash uuid; v_shalev uuid;
  s_rb uuid; s_label uuid; v_camp uuid := gen_random_uuid();
  i_a uuid := gen_random_uuid(); i_e uuid := gen_random_uuid(); i_s uuid := gen_random_uuid();
  t1 uuid; t2 uuid; t3 uuid; t4 uuid; t5 uuid; t6 uuid; te uuid; tn uuid; b1 uuid; b2 uuid;
  n int;
BEGIN
  SELECT md5(coalesce((SELECT string_agg((row_to_json(t)::jsonb - 'series_id')::text, '|' ORDER BY id) FROM social_content_items t), '') ||
             coalesce((SELECT string_agg(row_to_json(t)::jsonb::text, '|' ORDER BY id) FROM social_campaigns t), '') ||
             coalesce((SELECT string_agg(row_to_json(t)::jsonb::text, '|' ORDER BY id) FROM social_content_files t), '') ||
             coalesce((SELECT string_agg(row_to_json(t)::jsonb::text, '|' ORDER BY id) FROM social_promotions t), '')) INTO v_pre;

  -- ===== preconditions =====
  IF to_regclass('public.social_series') IS NOT NULL OR to_regclass('public.social_cadence_targets') IS NOT NULL THEN RAISE EXCEPTION 'DRYRUN_FAIL tables exist'; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'social_content_items' AND column_name = 'series_id') THEN RAISE EXCEPTION 'DRYRUN_FAIL column exists'; END IF;
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'social_content_owner_ck') IS DISTINCT FROM 'CHECK (((campaign_id IS NOT NULL) OR (label_artist_id IS NOT NULL)))' THEN RAISE EXCEPTION 'DRYRUN_FAIL owner CHECK'; END IF;
  IF to_regclass('public.sunny_intel_records') IS NULL THEN RAISE EXCEPTION 'DRYRUN_FAIL brain records table missing'; END IF;
  v_out := v_out || 'preconditions OK; ';

  -- ===== FORWARD (exactly as proposed, with the corrected target guard) =====
  CREATE TABLE public.social_series (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 80),
    owner_scope text NOT NULL CHECK (owner_scope IN ('ARTIST', 'LABEL')),
    label_artist_id uuid NULL REFERENCES public.label_artists(id) ON DELETE RESTRICT,
    platforms text[] NOT NULL DEFAULT '{}' CHECK (platforms <@ ARRAY['tiktok','instagram','youtube','spotify','other']::text[]),
    status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PAUSED', 'ENDED')),
    notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 500),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT social_series_scope_ck CHECK ((owner_scope = 'ARTIST') = (label_artist_id IS NOT NULL))
  );
  CREATE UNIQUE INDEX social_series_name_uk ON public.social_series (coalesce(label_artist_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));
  ALTER TABLE public.social_content_items ADD COLUMN series_id uuid NULL REFERENCES public.social_series(id) ON DELETE RESTRICT;
  CREATE INDEX social_content_series_idx ON public.social_content_items (series_id, publish_date) WHERE series_id IS NOT NULL;
  ALTER TABLE public.social_content_items DROP CONSTRAINT social_content_owner_ck,
    ADD CONSTRAINT social_content_owner_ck CHECK (campaign_id IS NOT NULL OR label_artist_id IS NOT NULL OR series_id IS NOT NULL);
  CREATE OR REPLACE FUNCTION public.social_campaign_before_delete() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public AS $f$
  BEGIN
    DELETE FROM public.social_content_items WHERE campaign_id = OLD.id AND label_artist_id IS NULL AND series_id IS NULL;
    RETURN OLD;
  END $f$;
  REVOKE ALL ON FUNCTION public.social_campaign_before_delete() FROM PUBLIC, anon, authenticated;

  CREATE FUNCTION public.social_content_series_guard() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public AS $s$
  DECLARE v_scope text; v_artist uuid;
  BEGIN
    IF NEW.series_id IS NULL THEN RETURN NEW; END IF;
    SELECT owner_scope, label_artist_id INTO v_scope, v_artist FROM public.social_series WHERE id = NEW.series_id;
    IF v_scope = 'ARTIST' AND NEW.label_artist_id IS DISTINCT FROM v_artist THEN
      RAISE EXCEPTION 'SERIES_ARTIST_MISMATCH: an item of an artist series belongs to that artist' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END $s$;
  REVOKE ALL ON FUNCTION public.social_content_series_guard() FROM PUBLIC, anon, authenticated;
  CREATE TRIGGER social_content_series_guard BEFORE INSERT OR UPDATE OF series_id, label_artist_id ON public.social_content_items
    FOR EACH ROW EXECUTE FUNCTION public.social_content_series_guard();

  CREATE FUNCTION public.social_series_owner_guard() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public AS $o$
  BEGIN
    IF (NEW.owner_scope, NEW.label_artist_id) IS DISTINCT FROM (OLD.owner_scope, OLD.label_artist_id)
       AND EXISTS (SELECT 1 FROM public.social_content_items WHERE series_id = OLD.id) THEN
      RAISE EXCEPTION 'SERIES_OWNER_LOCKED: a series with content keeps its owner' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END $o$;
  REVOKE ALL ON FUNCTION public.social_series_owner_guard() FROM PUBLIC, anon, authenticated;
  CREATE TRIGGER social_series_owner_guard BEFORE UPDATE OF owner_scope, label_artist_id ON public.social_series
    FOR EACH ROW EXECUTE FUNCTION public.social_series_owner_guard();

  CREATE TABLE public.social_cadence_targets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    scope text NOT NULL CHECK (scope IN ('OVERALL', 'BREAKDOWN', 'SERIES')),
    label_artist_id uuid NULL REFERENCES public.label_artists(id) ON DELETE RESTRICT,
    series_id uuid NULL REFERENCES public.social_series(id) ON DELETE RESTRICT,
    platform text NULL CHECK (platform IS NULL OR platform IN ('tiktok','instagram','youtube','spotify','other')),
    content_type text NULL CHECK (content_type IS NULL OR (content_type = btrim(content_type) AND char_length(content_type) BETWEEN 1 AND 60)),
    action text NOT NULL CHECK (action IN ('SET', 'END')),
    per_week smallint NULL,
    valid_from date NOT NULL,
    valid_until date NULL,
    supersedes_id uuid NULL REFERENCES public.social_cadence_targets(id) ON DELETE RESTRICT,
    source text NOT NULL CHECK (source IN ('OWNER_STATEMENT', 'OWNER_APPROVED_RECOMMENDATION')),
    recommendation_id uuid NULL REFERENCES public.sunny_intel_records(id) ON DELETE RESTRICT,
    note_he text NULL CHECK (note_he IS NULL OR char_length(note_he) BETWEEN 1 AND 300),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT social_targets_window_ck CHECK (valid_until IS NULL OR valid_until >= valid_from),
    CONSTRAINT social_targets_action_ck CHECK ((action = 'SET' AND per_week BETWEEN 1 AND 50) OR (action = 'END' AND per_week IS NULL AND supersedes_id IS NOT NULL AND valid_until IS NULL)),
    CONSTRAINT social_targets_source_ck CHECK ((source = 'OWNER_APPROVED_RECOMMENDATION') = (recommendation_id IS NOT NULL)),
    CONSTRAINT social_targets_scope_ck CHECK (
      (scope = 'OVERALL'   AND label_artist_id IS NOT NULL AND series_id IS NULL AND platform IS NULL AND content_type IS NULL)
   OR (scope = 'BREAKDOWN' AND label_artist_id IS NOT NULL AND series_id IS NULL AND (platform IS NOT NULL OR content_type IS NOT NULL))
   OR (scope = 'SERIES'    AND series_id IS NOT NULL AND platform IS NULL AND content_type IS NULL))
  );
  CREATE UNIQUE INDEX social_targets_one_successor_uk ON public.social_cadence_targets (supersedes_id) WHERE supersedes_id IS NOT NULL;
  CREATE INDEX social_targets_artist_idx ON public.social_cadence_targets (label_artist_id, scope, valid_from);

  CREATE FUNCTION public.social_cadence_targets_append_only() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public AS $g$
  BEGIN RAISE EXCEPTION 'social_cadence_targets is append-only (a change = a new row that supersedes)'; END $g$;
  REVOKE ALL ON FUNCTION public.social_cadence_targets_append_only() FROM PUBLIC, anon, authenticated;
  CREATE TRIGGER social_cadence_targets_append_only BEFORE UPDATE OR DELETE ON public.social_cadence_targets
    FOR EACH ROW EXECUTE FUNCTION public.social_cadence_targets_append_only();

  -- the target guard (CORRECTED after the focused review: effective windows are compared with plain date comparisons —
  -- an empty window (a same-day replacement) is skipped instead of building an invalid range that would raise)
  CREATE FUNCTION public.social_cadence_targets_guard() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public AS $t$
  DECLARE v_old public.social_cadence_targets; v_today date := (now() AT TIME ZONE 'Asia/Jerusalem')::date; v_new_end date := coalesce(NEW.valid_until, 'infinity'::date);
  BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('social_targets:' || coalesce(NEW.label_artist_id::text, '') || ':' || coalesce(NEW.series_id::text, '')));
    IF NEW.valid_from < v_today THEN RAISE EXCEPTION 'TARGET_BACKDATED: a target starts today or later (history is never rewritten)' USING ERRCODE = 'check_violation'; END IF;
    IF NEW.supersedes_id IS NOT NULL THEN
      SELECT * INTO v_old FROM public.social_cadence_targets WHERE id = NEW.supersedes_id;
      IF (v_old.scope, v_old.label_artist_id, v_old.series_id, v_old.platform, v_old.content_type)
         IS DISTINCT FROM (NEW.scope, NEW.label_artist_id, NEW.series_id, NEW.platform, NEW.content_type)
        THEN RAISE EXCEPTION 'TARGET_SLOT_MISMATCH: a change replaces the same target' USING ERRCODE = 'check_violation'; END IF;
      IF v_old.action = 'END' THEN RAISE EXCEPTION 'TARGET_ALREADY_ENDED' USING ERRCODE = 'check_violation'; END IF;
      IF NEW.valid_from < v_old.valid_from THEN RAISE EXCEPTION 'TARGET_BEFORE_PREVIOUS' USING ERRCODE = 'check_violation'; END IF;
    END IF;
    IF NEW.action = 'SET' AND EXISTS (
      SELECT 1 FROM (
        SELECT t.valid_from AS f, least(coalesce(t.valid_until, 'infinity'::date), coalesce(s.valid_from - 1, 'infinity'::date)) AS e
        FROM public.social_cadence_targets t LEFT JOIN public.social_cadence_targets s ON s.supersedes_id = t.id
        WHERE t.action = 'SET' AND t.id IS DISTINCT FROM NEW.supersedes_id
          AND (t.scope, t.label_artist_id, t.series_id, t.platform, t.content_type) IS NOT DISTINCT FROM (NEW.scope, NEW.label_artist_id, NEW.series_id, NEW.platform, NEW.content_type)
      ) w WHERE w.e >= w.f AND w.f <= v_new_end AND w.e >= NEW.valid_from)
      THEN RAISE EXCEPTION 'TARGET_OVERLAP: an active target already covers this period' USING ERRCODE = 'check_violation'; END IF;
    IF NEW.scope = 'BREAKDOWN' AND NEW.action = 'SET' AND EXISTS (
      SELECT 1 FROM (
        SELECT t.valid_from AS f, least(coalesce(t.valid_until, 'infinity'::date), coalesce(s.valid_from - 1, 'infinity'::date)) AS e
        FROM public.social_cadence_targets t LEFT JOIN public.social_cadence_targets s ON s.supersedes_id = t.id
        WHERE t.scope = 'BREAKDOWN' AND t.action = 'SET' AND t.label_artist_id = NEW.label_artist_id AND t.id IS DISTINCT FROM NEW.supersedes_id
          AND (t.platform IS NULL OR NEW.platform IS NULL OR t.platform = NEW.platform)
          AND (t.content_type IS NULL OR NEW.content_type IS NULL OR t.content_type = NEW.content_type)
          AND (t.platform, t.content_type) IS DISTINCT FROM (NEW.platform, NEW.content_type)
      ) w WHERE w.e >= w.f AND w.f <= v_new_end AND w.e >= NEW.valid_from)
      THEN RAISE EXCEPTION 'BREAKDOWN_OVERLAP: two breakdown targets would count the same items' USING ERRCODE = 'check_violation'; END IF;
    RETURN NEW;
  END $t$;
  REVOKE ALL ON FUNCTION public.social_cadence_targets_guard() FROM PUBLIC, anon, authenticated;
  CREATE TRIGGER social_cadence_targets_guard BEFORE INSERT ON public.social_cadence_targets
    FOR EACH ROW EXECUTE FUNCTION public.social_cadence_targets_guard();

  ALTER TABLE public.social_series ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.social_cadence_targets ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON public.social_series, public.social_cadence_targets FROM anon, authenticated;
  v_out := v_out || 'forward applied (in-transaction); ';

  -- ===== experiment rows (DRYRUN, generated ids) =====
  SELECT id INTO v_nagash FROM label_artists WHERE name = 'נגש ביטס';
  SELECT id INTO v_shalev FROM label_artists WHERE name = 'שליו טסמה';
  IF v_nagash IS NULL OR v_shalev IS NULL THEN RAISE EXCEPTION 'DRYRUN_FAIL roster'; END IF;
  INSERT INTO social_series (name, owner_scope, label_artist_id, platforms) VALUES ('DRYRUN Red Bars', 'ARTIST', v_nagash, ARRAY['instagram']) RETURNING id INTO s_rb;
  INSERT INTO social_series (name, owner_scope, label_artist_id) VALUES ('DRYRUN label series', 'LABEL', NULL) RETURNING id INTO s_label;
  BEGIN INSERT INTO social_series (name, owner_scope) VALUES ('DRYRUN bad', 'ARTIST'); RAISE EXCEPTION 'DRYRUN_FAIL artist series without artist';
  EXCEPTION WHEN check_violation THEN v_out := v_out || 'S1 artist series needs an artist; '; END;
  BEGIN INSERT INTO social_series (name, owner_scope, label_artist_id) VALUES ('dryrun red bars', 'ARTIST', v_nagash); RAISE EXCEPTION 'DRYRUN_FAIL duplicate series name';
  EXCEPTION WHEN unique_violation THEN v_out := v_out || 'S2 duplicate series name refused; '; END;

  -- point 1: series ownership on items
  INSERT INTO social_content_items (id, campaign_id, title, content_type, status, owner_name, asset_link, dropbox_link, caption, hook, notes, posted_url, series_id, created_at, updated_at)
    VALUES (i_s, NULL, 'DRYRUN label item', 'reel', 'idea', '', '', '', '', '', '', '', s_label, now(), now());
  v_out := v_out || 'P1a no artist + no campaign + LABEL series allowed; ';
  BEGIN INSERT INTO social_content_items (id, campaign_id, title, content_type, status, owner_name, asset_link, dropbox_link, caption, hook, notes, posted_url, series_id, created_at, updated_at)
    VALUES (gen_random_uuid(), NULL, 'DRYRUN x', 'reel', 'idea', '', '', '', '', '', '', '', s_rb, now(), now()); RAISE EXCEPTION 'DRYRUN_FAIL no-artist item in artist series';
  EXCEPTION WHEN check_violation THEN v_out := v_out || 'P1b no-artist item in an artist series refused; '; END;
  BEGIN INSERT INTO social_content_items (id, campaign_id, label_artist_id, title, content_type, status, owner_name, asset_link, dropbox_link, caption, hook, notes, posted_url, series_id, created_at, updated_at)
    VALUES (gen_random_uuid(), NULL, v_shalev, 'DRYRUN y', 'reel', 'idea', '', '', '', '', '', '', '', s_rb, now(), now()); RAISE EXCEPTION 'DRYRUN_FAIL other artist item in artist series';
  EXCEPTION WHEN check_violation THEN v_out := v_out || 'P1c another artist''s item in an artist series refused; '; END;
  INSERT INTO social_campaigns (id, title, artist_name, status, marketing_angle, target_audience, main_message, platforms, owner_id, notes, promotion_budget, created_at, updated_at)
    VALUES (v_camp, 'DRYRUN campaign', '', 'draft', '', '', '', ARRAY[]::text[], '', 'DRYRUN', 0, now(), now());
  INSERT INTO social_content_items (id, campaign_id, label_artist_id, title, content_type, status, owner_name, asset_link, dropbox_link, caption, hook, notes, posted_url, series_id, created_at, updated_at)
    VALUES (i_a, v_camp, v_nagash, 'DRYRUN Red Bars item', 'reel', 'published', '', '', '', '', '', '', '', s_rb, now(), now()),
           (i_e, v_camp, NULL, 'DRYRUN plain item', 'reel', 'idea', '', '', '', '', '', '', '', NULL, now(), now());
  v_out := v_out || 'P1d the artist''s own item in the artist series allowed; ';
  BEGIN UPDATE social_content_items SET label_artist_id = v_shalev WHERE id = i_a; RAISE EXCEPTION 'DRYRUN_FAIL update moved item to another artist inside artist series';
  EXCEPTION WHEN check_violation THEN v_out := v_out || 'P1e update to another artist refused; '; END;
  BEGIN UPDATE social_content_items SET series_id = s_rb WHERE id = i_s; RAISE EXCEPTION 'DRYRUN_FAIL update moved no-artist item into artist series';
  EXCEPTION WHEN check_violation THEN v_out := v_out || 'P1f update of a no-artist item into an artist series refused; '; END;
  BEGIN UPDATE social_series SET owner_scope = 'LABEL', label_artist_id = NULL WHERE id = s_rb; RAISE EXCEPTION 'DRYRUN_FAIL owner change with content';
  EXCEPTION WHEN check_violation THEN v_out := v_out || 'P1g a series with content keeps its owner; '; END;
  BEGIN INSERT INTO social_content_items (id, campaign_id, title, content_type, status, owner_name, asset_link, dropbox_link, caption, hook, notes, posted_url, created_at, updated_at)
    VALUES (gen_random_uuid(), NULL, 'DRYRUN orphan', 'reel', 'idea', '', '', '', '', '', '', '', now(), now()); RAISE EXCEPTION 'DRYRUN_FAIL orphan item allowed';
  EXCEPTION WHEN check_violation THEN v_out := v_out || 'P1h no campaign + no artist + no series refused; '; END;
  DELETE FROM social_campaigns WHERE id = v_camp;
  SELECT count(*) INTO n FROM social_content_items WHERE id = i_a AND campaign_id IS NULL AND series_id = s_rb;
  IF n <> 1 THEN RAISE EXCEPTION 'DRYRUN_FAIL series/artist item lost with campaign'; END IF;
  SELECT count(*) INTO n FROM social_content_items WHERE id = i_e;
  IF n <> 0 THEN RAISE EXCEPTION 'DRYRUN_FAIL plain item survived campaign delete'; END IF;
  v_out := v_out || 'P1i campaign delete keeps artist/series items, deletes the rest; ';
  BEGIN DELETE FROM social_series WHERE id = s_rb; RAISE EXCEPTION 'DRYRUN_FAIL series with items deleted';
  EXCEPTION WHEN foreign_key_violation THEN v_out := v_out || 'P1j a series with items cannot be deleted; '; END;

  -- point 2 / focused review: replacement chains, END, history, dates, no false block
  INSERT INTO social_cadence_targets (scope, label_artist_id, action, per_week, valid_from, source) VALUES ('OVERALL', v_nagash, 'SET', 3, d, 'OWNER_STATEMENT') RETURNING id INTO t1;
  BEGIN INSERT INTO social_cadence_targets (scope, label_artist_id, action, per_week, valid_from, source) VALUES ('OVERALL', v_nagash, 'SET', 9, d + 7, 'OWNER_STATEMENT'); RAISE EXCEPTION 'DRYRUN_FAIL overlap root allowed';
  EXCEPTION WHEN check_violation THEN v_out := v_out || 'R1 a second root over an active target refused; '; END;
  INSERT INTO social_cadence_targets (scope, label_artist_id, action, per_week, valid_from, supersedes_id, source) VALUES ('OVERALL', v_nagash, 'SET', 4, d + 7, t1, 'OWNER_STATEMENT') RETURNING id INTO t2;
  INSERT INTO social_cadence_targets (scope, label_artist_id, action, per_week, valid_from, supersedes_id, source) VALUES ('OVERALL', v_nagash, 'SET', 5, d + 14, t2, 'OWNER_STATEMENT') RETURNING id INTO t3;
  v_out := v_out || 'R2 chain 3 -> 4 -> 5 accepted; ';
  BEGIN INSERT INTO social_cadence_targets (scope, label_artist_id, action, per_week, valid_from, supersedes_id, source) VALUES ('OVERALL', v_nagash, 'SET', 6, d + 20, t2, 'OWNER_STATEMENT'); RAISE EXCEPTION 'DRYRUN_FAIL second successor (overlapping)';
  EXCEPTION WHEN check_violation THEN v_out := v_out || 'R3a a second successor overlapping the live chain refused (TARGET_OVERLAP); '; END;
  BEGIN INSERT INTO social_cadence_targets (scope, label_artist_id, action, per_week, valid_from, valid_until, supersedes_id, source) VALUES ('OVERALL', v_nagash, 'SET', 6, d + 7, d + 8, t2, 'OWNER_STATEMENT'); RAISE EXCEPTION 'DRYRUN_FAIL second successor (non-overlapping)';
  EXCEPTION WHEN unique_violation THEN v_out := v_out || 'R3b a second successor that overlaps nothing still refused by UNIQUE (no fork); '; END;
  BEGIN INSERT INTO social_cadence_targets (scope, label_artist_id, action, per_week, valid_from, supersedes_id, source) VALUES ('OVERALL', v_nagash, 'SET', 6, d + 10, t3, 'OWNER_STATEMENT'); RAISE EXCEPTION 'DRYRUN_FAIL replacement before previous start';
  EXCEPTION WHEN check_violation THEN v_out := v_out || 'R4 a replacement starting before the previous one refused; '; END;
  INSERT INTO social_cadence_targets (scope, label_artist_id, action, per_week, valid_from, supersedes_id, source) VALUES ('OVERALL', v_nagash, 'SET', 6, d + 14, t3, 'OWNER_STATEMENT') RETURNING id INTO t4;
  INSERT INTO social_cadence_targets (scope, label_artist_id, action, per_week, valid_from, supersedes_id, source) VALUES ('OVERALL', v_nagash, 'SET', 7, d + 14, t4, 'OWNER_STATEMENT') RETURNING id INTO t5;
  v_out := v_out || 'R5 same-day replacement twice accepted (empty windows skipped); ';
  INSERT INTO social_cadence_targets (scope, label_artist_id, action, per_week, valid_from, supersedes_id, source) VALUES ('OVERALL', v_nagash, 'SET', 8, d + 21, t5, 'OWNER_STATEMENT') RETURNING id INTO t6;
  v_out := v_out || 'R6 a later replacement after same-day ones accepted (no false block); ';
  BEGIN INSERT INTO social_cadence_targets (scope, label_artist_id, action, per_week, valid_from, source) VALUES ('OVERALL', v_nagash, 'SET', 2, d + 8, 'OWNER_STATEMENT'); RAISE EXCEPTION 'DRYRUN_FAIL overlap with history';
  EXCEPTION WHEN check_violation THEN v_out := v_out || 'R7 overlap with a middle history window refused; '; END;
  INSERT INTO social_cadence_targets (scope, label_artist_id, action, valid_from, supersedes_id, source) VALUES ('OVERALL', v_nagash, 'END', d + 28, t6, 'OWNER_STATEMENT') RETURNING id INTO te;
  BEGIN INSERT INTO social_cadence_targets (scope, label_artist_id, action, per_week, valid_from, supersedes_id, source) VALUES ('OVERALL', v_nagash, 'SET', 9, d + 35, te, 'OWNER_STATEMENT'); RAISE EXCEPTION 'DRYRUN_FAIL superseding END';
  EXCEPTION WHEN check_violation THEN v_out := v_out || 'R8 superseding an END refused; '; END;
  BEGIN INSERT INTO social_cadence_targets (scope, label_artist_id, action, per_week, valid_from, source) VALUES ('OVERALL', v_nagash, 'SET', 9, d + 21, 'OWNER_STATEMENT'); RAISE EXCEPTION 'DRYRUN_FAIL new root before END';
  EXCEPTION WHEN check_violation THEN v_out := v_out || 'R9 a new root inside the last window (before END) refused; '; END;
  INSERT INTO social_cadence_targets (scope, label_artist_id, action, per_week, valid_from, source) VALUES ('OVERALL', v_nagash, 'SET', 9, d + 28, 'OWNER_STATEMENT') RETURNING id INTO tn;
  v_out := v_out || 'R10 a new target from the END date accepted; ';
  BEGIN INSERT INTO social_cadence_targets (scope, label_artist_id, action, per_week, valid_from, source) VALUES ('OVERALL', v_shalev, 'SET', 2, d - 1, 'OWNER_STATEMENT'); RAISE EXCEPTION 'DRYRUN_FAIL backdated';
  EXCEPTION WHEN check_violation THEN v_out := v_out || 'R11 a backdated target refused; '; END;
  INSERT INTO social_cadence_targets (scope, label_artist_id, action, per_week, valid_from, source) VALUES ('OVERALL', v_shalev, 'SET', 2, d, 'OWNER_STATEMENT');
  v_out := v_out || 'R12 another artist has an independent slot; ';
  -- explicit windows + breakdown
  INSERT INTO social_cadence_targets (scope, label_artist_id, platform, action, per_week, valid_from, valid_until, source) VALUES ('BREAKDOWN', v_nagash, 'instagram', 'SET', 2, d, d + 6, 'OWNER_STATEMENT') RETURNING id INTO b1;
  INSERT INTO social_cadence_targets (scope, label_artist_id, platform, action, per_week, valid_from, source) VALUES ('BREAKDOWN', v_nagash, 'instagram', 'SET', 3, d + 7, 'OWNER_STATEMENT') RETURNING id INTO b2;
  v_out := v_out || 'R13 adjacent explicit windows accepted (end d+6, next from d+7); ';
  BEGIN INSERT INTO social_cadence_targets (scope, label_artist_id, platform, action, per_week, valid_from, valid_until, source) VALUES ('BREAKDOWN', v_nagash, 'instagram', 'SET', 1, d + 6, d + 6, 'OWNER_STATEMENT'); RAISE EXCEPTION 'DRYRUN_FAIL one-day overlap';
  EXCEPTION WHEN check_violation THEN v_out := v_out || 'R14 a one-day overlap on the end date refused; '; END;
  BEGIN INSERT INTO social_cadence_targets (scope, label_artist_id, platform, content_type, action, per_week, valid_from, valid_until, source) VALUES ('BREAKDOWN', v_nagash, 'instagram', 'ריל', 'SET', 1, d, d + 3, 'OWNER_STATEMENT'); RAISE EXCEPTION 'DRYRUN_FAIL breakdown overlap';
  EXCEPTION WHEN check_violation THEN v_out := v_out || 'R15 instagram vs instagram+reel overlap refused; '; END;
  INSERT INTO social_cadence_targets (scope, label_artist_id, platform, action, per_week, valid_from, source) VALUES ('BREAKDOWN', v_nagash, 'youtube', 'SET', 1, d, 'OWNER_STATEMENT');
  v_out := v_out || 'R16 a different platform in the same period accepted; ';
  BEGIN INSERT INTO social_cadence_targets (scope, label_artist_id, platform, action, per_week, valid_from, supersedes_id, source) VALUES ('BREAKDOWN', v_nagash, 'tiktok', 'SET', 1, d + 7, b2, 'OWNER_STATEMENT'); RAISE EXCEPTION 'DRYRUN_FAIL slot mismatch';
  EXCEPTION WHEN check_violation THEN v_out := v_out || 'R17 a replacement in another slot refused; '; END;
  INSERT INTO social_cadence_targets (scope, series_id, action, per_week, valid_from, source) VALUES ('SERIES', s_rb, 'SET', 1, d, 'OWNER_STATEMENT');
  v_out := v_out || 'R18 a series target alongside the overall target accepted; ';
  BEGIN INSERT INTO social_cadence_targets (scope, label_artist_id, platform, action, per_week, valid_from, source) VALUES ('BREAKDOWN', v_shalev, 'spotify', 'SET', 0, d + 40, 'OWNER_STATEMENT'); RAISE EXCEPTION 'DRYRUN_FAIL per_week 0';
  EXCEPTION WHEN check_violation THEN v_out := v_out || 'R19 per_week 0 refused; '; END;
  BEGIN INSERT INTO social_cadence_targets (scope, label_artist_id, platform, action, per_week, valid_from, source) VALUES ('BREAKDOWN', v_shalev, 'other', 'SET', 2, d + 40, 'OWNER_APPROVED_RECOMMENDATION'); RAISE EXCEPTION 'DRYRUN_FAIL recommendation without id';
  EXCEPTION WHEN check_violation THEN v_out := v_out || 'R20 approved recommendation needs its record; '; END;
  BEGIN UPDATE social_cadence_targets SET per_week = 10 WHERE id = t1; RAISE EXCEPTION 'DRYRUN_FAIL update allowed';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'DRYRUN_FAIL%' OR SQLERRM NOT LIKE '%append-only%' THEN RAISE; END IF; v_out := v_out || 'R21 UPDATE refused (append-only); '; END;
  BEGIN DELETE FROM social_cadence_targets WHERE id = t1; RAISE EXCEPTION 'DRYRUN_FAIL delete allowed';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'DRYRUN_FAIL%' OR SQLERRM NOT LIKE '%append-only%' THEN RAISE; END IF; v_out := v_out || 'R22 DELETE refused (append-only); '; END;
  SELECT count(*) INTO n FROM social_cadence_targets WHERE id IN (t1, t2, t3, t4, t5, t6, te, tn, b1, b2);
  IF n <> 10 THEN RAISE EXCEPTION 'DRYRUN_FAIL history lost'; END IF;
  v_out := v_out || 'R23 the whole history kept (10 rows); targets total ' || (SELECT count(*) FROM social_cadence_targets) || '; ';

  -- cleanup of experiment items so the production fingerprint can be compared (the rollback removes everything anyway)
  DELETE FROM social_content_items WHERE id IN (i_a, i_s);
  SELECT md5(coalesce((SELECT string_agg((row_to_json(t)::jsonb - 'series_id')::text, '|' ORDER BY id) FROM social_content_items t), '') ||
             coalesce((SELECT string_agg(row_to_json(t)::jsonb::text, '|' ORDER BY id) FROM social_campaigns t), '') ||
             coalesce((SELECT string_agg(row_to_json(t)::jsonb::text, '|' ORDER BY id) FROM social_content_files t), '') ||
             coalesce((SELECT string_agg(row_to_json(t)::jsonb::text, '|' ORDER BY id) FROM social_promotions t), '')) INTO v_post;
  IF v_post IS DISTINCT FROM v_pre THEN RAISE EXCEPTION 'DRYRUN_FAIL production rows changed'; END IF;
  v_out := v_out || 'counts c' || (SELECT count(*) FROM social_campaigns) || ' i' || (SELECT count(*) FROM social_content_items) || ' f' || (SELECT count(*) FROM social_content_files) || ' p' || (SELECT count(*) FROM social_promotions) || '; fingerprint ' || left(v_pre, 12) || ' = ' || left(v_post, 12);

  RAISE EXCEPTION 'DRYRUN_RESULT %', v_out;
END
$dry$;
ROLLBACK;
