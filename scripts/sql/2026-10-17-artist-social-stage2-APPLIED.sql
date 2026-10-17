-- Stage 2 (content series + weekly targets) — FORWARD. Owner-approved 2026-10-17 after the rolled-back dry run (37 checks).
-- The forward body below is BYTE-IDENTICAL to the "FORWARD" section of 2026-10-17-artist-social-stage2-DRYRUN.sql.
-- ONE DO block = one atomic statement: any failed check raises and PostgreSQL undoes the whole block (no partial state);
-- the COMMIT after a failed block commits nothing. No existing row is changed; no row is created.
BEGIN;
DO $fwd$
DECLARE
  v_pre text; v_post text;
BEGIN
  SELECT md5(coalesce((SELECT string_agg((row_to_json(t)::jsonb - 'series_id')::text, '|' ORDER BY id) FROM social_content_items t), '') ||
             coalesce((SELECT string_agg(row_to_json(t)::jsonb::text, '|' ORDER BY id) FROM social_campaigns t), '') ||
             coalesce((SELECT string_agg(row_to_json(t)::jsonb::text, '|' ORDER BY id) FROM social_content_files t), '') ||
             coalesce((SELECT string_agg(row_to_json(t)::jsonb::text, '|' ORDER BY id) FROM social_promotions t), '')) INTO v_pre;

  -- ===== preconditions =====
  IF to_regclass('public.social_series') IS NOT NULL OR to_regclass('public.social_cadence_targets') IS NOT NULL THEN RAISE EXCEPTION 'FORWARD_FAIL tables exist'; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'social_content_items' AND column_name = 'series_id') THEN RAISE EXCEPTION 'FORWARD_FAIL column exists'; END IF;
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'social_content_owner_ck') IS DISTINCT FROM 'CHECK (((campaign_id IS NOT NULL) OR (label_artist_id IS NOT NULL)))' THEN RAISE EXCEPTION 'FORWARD_FAIL owner CHECK'; END IF;
  IF to_regclass('public.sunny_intel_records') IS NULL THEN RAISE EXCEPTION 'FORWARD_FAIL brain records table missing'; END IF;

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
  -- ===== postconditions (any failure raises -> the whole block is undone, nothing partial) =====
  SELECT md5(coalesce((SELECT string_agg((row_to_json(t)::jsonb - 'series_id')::text, '|' ORDER BY id) FROM social_content_items t), '') ||
             coalesce((SELECT string_agg(row_to_json(t)::jsonb::text, '|' ORDER BY id) FROM social_campaigns t), '') ||
             coalesce((SELECT string_agg(row_to_json(t)::jsonb::text, '|' ORDER BY id) FROM social_content_files t), '') ||
             coalesce((SELECT string_agg(row_to_json(t)::jsonb::text, '|' ORDER BY id) FROM social_promotions t), '')) INTO v_post;
  IF v_post IS DISTINCT FROM v_pre THEN RAISE EXCEPTION 'FORWARD_FAIL existing rows changed'; END IF;
  IF EXISTS (SELECT 1 FROM social_content_items WHERE series_id IS NOT NULL) THEN RAISE EXCEPTION 'FORWARD_FAIL a row got a series'; END IF;
  IF (SELECT count(*) FROM social_series) <> 0 OR (SELECT count(*) FROM social_cadence_targets) <> 0 THEN RAISE EXCEPTION 'FORWARD_FAIL data created'; END IF;
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'social_content_items_campaign_id_fkey') NOT LIKE '%ON DELETE SET NULL' THEN RAISE EXCEPTION 'FORWARD_FAIL items FK changed'; END IF;
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'social_content_owner_ck') IS DISTINCT FROM 'CHECK (((campaign_id IS NOT NULL) OR (label_artist_id IS NOT NULL) OR (series_id IS NOT NULL)))' THEN RAISE EXCEPTION 'FORWARD_FAIL owner CHECK'; END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('social_campaign_before_delete', 'social_content_series_guard', 'social_series_owner_guard', 'social_cadence_targets_append_only', 'social_cadence_targets_guard')) <> 5 THEN RAISE EXCEPTION 'FORWARD_FAIL triggers'; END IF;
  IF has_table_privilege('anon', 'public.social_cadence_targets', 'SELECT') OR has_table_privilege('authenticated', 'public.social_series', 'SELECT')
     OR has_table_privilege('anon', 'public.social_series', 'INSERT') OR has_table_privilege('authenticated', 'public.social_cadence_targets', 'INSERT') THEN RAISE EXCEPTION 'FORWARD_FAIL grants'; END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.social_series'::regclass) OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.social_cadence_targets'::regclass) THEN RAISE EXCEPTION 'FORWARD_FAIL RLS'; END IF;
END
$fwd$;
COMMIT;
