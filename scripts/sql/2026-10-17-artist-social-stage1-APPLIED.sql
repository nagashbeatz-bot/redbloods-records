-- Stage 1 decision 2 — FORWARD (Owner-approved 2026-10-17 after the rolled-back dry run).
-- ONE DO block = one atomic statement: any failed check raises and PostgreSQL undoes the whole block (no partial state);
-- COMMIT after a failed block does not commit anything. No row is inserted, updated or deleted.
BEGIN;
DO $fwd$
DECLARE
  v_out text := '';
  v_shalev uuid;
  v_camp uuid := gen_random_uuid();
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_fa uuid := gen_random_uuid();
  v_fb uuid := gen_random_uuid();
  v_pre text; v_post text;
  n int;
BEGIN
  -- production fingerprint (all 4 tables, every column) BEFORE
  SELECT md5(coalesce((SELECT string_agg((row_to_json(t)::jsonb - 'label_artist_id')::text, '|' ORDER BY id) FROM social_campaigns t), '') ||
             coalesce((SELECT string_agg((row_to_json(t)::jsonb - 'label_artist_id')::text, '|' ORDER BY id) FROM social_content_items t), '') ||
             coalesce((SELECT string_agg(row_to_json(t)::jsonb::text, '|' ORDER BY id) FROM social_content_files t), '') ||
             coalesce((SELECT string_agg(row_to_json(t)::jsonb::text, '|' ORDER BY id) FROM social_promotions t), '')) INTO v_pre;

  -- preconditions (identical to the forward script)
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'social_content_items_campaign_id_fkey')
     IS DISTINCT FROM 'FOREIGN KEY (campaign_id) REFERENCES social_campaigns(id) ON DELETE CASCADE' THEN RAISE EXCEPTION 'FORWARD_FAIL precondition items FK'; END IF;
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'social_content_files_campaign_id_fkey')
     IS DISTINCT FROM 'FOREIGN KEY (campaign_id) REFERENCES social_campaigns(id) ON DELETE CASCADE' THEN RAISE EXCEPTION 'FORWARD_FAIL precondition files FK'; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'label_artist_id'
             AND table_name IN ('social_campaigns', 'social_content_items')) THEN RAISE EXCEPTION 'FORWARD_FAIL precondition column exists'; END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.social_campaigns'::regclass AND NOT tgisinternal) THEN RAISE EXCEPTION 'FORWARD_FAIL precondition trigger'; END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE confrelid IN ('public.social_campaigns'::regclass, 'public.social_content_items'::regclass)
             AND conname NOT IN ('social_content_items_campaign_id_fkey', 'social_content_files_campaign_id_fkey',
                                 'social_content_files_content_item_id_fkey', 'social_promotions_campaign_id_fkey'))
     THEN RAISE EXCEPTION 'FORWARD_FAIL precondition unknown FK'; END IF;
  v_out := v_out || 'preconditions OK; ';

  -- ===== the forward migration, exactly =====
  ALTER TABLE public.social_campaigns     ADD COLUMN label_artist_id uuid NULL REFERENCES public.label_artists(id) ON DELETE RESTRICT;
  ALTER TABLE public.social_content_items ADD COLUMN label_artist_id uuid NULL REFERENCES public.label_artists(id) ON DELETE RESTRICT;
  ALTER TABLE public.social_content_items ALTER COLUMN campaign_id DROP NOT NULL;
  ALTER TABLE public.social_content_items ADD CONSTRAINT social_content_owner_ck CHECK (campaign_id IS NOT NULL OR label_artist_id IS NOT NULL);
  CREATE INDEX social_content_artist_idx ON public.social_content_items (label_artist_id, publish_date) WHERE label_artist_id IS NOT NULL;
  ALTER TABLE public.social_content_files ALTER COLUMN campaign_id DROP NOT NULL;
  ALTER TABLE public.social_content_items DROP CONSTRAINT social_content_items_campaign_id_fkey,
    ADD CONSTRAINT social_content_items_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.social_campaigns(id) ON DELETE SET NULL;
  ALTER TABLE public.social_content_files DROP CONSTRAINT social_content_files_campaign_id_fkey,
    ADD CONSTRAINT social_content_files_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.social_campaigns(id) ON DELETE SET NULL;
  CREATE FUNCTION public.social_campaign_before_delete() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public AS $f$
  BEGIN
    DELETE FROM public.social_content_items WHERE campaign_id = OLD.id AND label_artist_id IS NULL;
    RETURN OLD;
  END $f$;
  REVOKE ALL ON FUNCTION public.social_campaign_before_delete() FROM PUBLIC, anon, authenticated;
  CREATE TRIGGER social_campaign_before_delete BEFORE DELETE ON public.social_campaigns
    FOR EACH ROW EXECUTE FUNCTION public.social_campaign_before_delete();

  -- existing rows unchanged by the migration?
  SELECT md5(coalesce((SELECT string_agg((row_to_json(t)::jsonb - 'label_artist_id')::text, '|' ORDER BY id) FROM social_campaigns t), '') ||
             coalesce((SELECT string_agg((row_to_json(t)::jsonb - 'label_artist_id')::text, '|' ORDER BY id) FROM social_content_items t), '') ||
             coalesce((SELECT string_agg(row_to_json(t)::jsonb::text, '|' ORDER BY id) FROM social_content_files t), '') ||
             coalesce((SELECT string_agg(row_to_json(t)::jsonb::text, '|' ORDER BY id) FROM social_promotions t), '')) INTO v_post;
  IF v_post IS DISTINCT FROM v_pre THEN RAISE EXCEPTION 'FORWARD_FAIL migration changed existing rows'; END IF;
  IF EXISTS (SELECT 1 FROM social_content_items WHERE campaign_id IS NULL AND label_artist_id IS NULL) THEN RAISE EXCEPTION 'FORWARD_FAIL orphan after migration'; END IF;
  

  -- ===== postconditions (any failure raises → the whole block is undone, nothing partial) =====
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'social_content_items_campaign_id_fkey')
     IS DISTINCT FROM 'FOREIGN KEY (campaign_id) REFERENCES social_campaigns(id) ON DELETE SET NULL' THEN RAISE EXCEPTION 'FORWARD_FAIL items FK'; END IF;
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'social_content_files_campaign_id_fkey')
     IS DISTINCT FROM 'FOREIGN KEY (campaign_id) REFERENCES social_campaigns(id) ON DELETE SET NULL' THEN RAISE EXCEPTION 'FORWARD_FAIL files FK'; END IF;
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'social_content_files_content_item_id_fkey')
     IS DISTINCT FROM 'FOREIGN KEY (content_item_id) REFERENCES social_content_items(id) ON DELETE CASCADE' THEN RAISE EXCEPTION 'FORWARD_FAIL file-item FK changed'; END IF;
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'social_promotions_campaign_id_fkey')
     IS DISTINCT FROM 'FOREIGN KEY (campaign_id) REFERENCES social_campaigns(id) ON DELETE CASCADE' THEN RAISE EXCEPTION 'FORWARD_FAIL promotions FK changed'; END IF;
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'social_content_owner_ck')
     IS DISTINCT FROM 'CHECK (((campaign_id IS NOT NULL) OR (label_artist_id IS NOT NULL)))' THEN RAISE EXCEPTION 'FORWARD_FAIL owner CHECK'; END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.social_campaigns'::regclass AND tgname = 'social_campaign_before_delete' AND NOT tgisinternal) <> 1 THEN RAISE EXCEPTION 'FORWARD_FAIL trigger'; END IF;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'label_artist_id' AND is_nullable = 'YES'
      AND table_name IN ('social_campaigns', 'social_content_items')) <> 2 THEN RAISE EXCEPTION 'FORWARD_FAIL columns'; END IF;
  IF EXISTS (SELECT 1 FROM social_content_items WHERE label_artist_id IS NOT NULL) OR EXISTS (SELECT 1 FROM social_campaigns WHERE label_artist_id IS NOT NULL)
     THEN RAISE EXCEPTION 'FORWARD_FAIL a row got an artist (no data change was approved)'; END IF;
  IF EXISTS (SELECT 1 FROM social_content_items WHERE campaign_id IS NULL) OR EXISTS (SELECT 1 FROM social_content_files WHERE campaign_id IS NULL)
     THEN RAISE EXCEPTION 'FORWARD_FAIL an existing row lost its campaign'; END IF;
  IF has_function_privilege('anon', 'public.social_campaign_before_delete()', 'EXECUTE') OR has_function_privilege('authenticated', 'public.social_campaign_before_delete()', 'EXECUTE')
     THEN RAISE EXCEPTION 'FORWARD_FAIL function grant'; END IF;
  RAISE NOTICE 'FORWARD_OK fingerprint %', left(v_post, 12);
END
$fwd$;
COMMIT;
