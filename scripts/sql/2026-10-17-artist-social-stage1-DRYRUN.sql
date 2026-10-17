-- Stage 1 decision 2 — DRY RUN. One transaction, never committed.
-- Safety: everything runs inside ONE DO block, which always ends with RAISE EXCEPTION → the whole block is undone by
-- PostgreSQL itself (even if the editor auto-commits). The outer BEGIN / ROLLBACK is a second layer; the script never persists anything.
BEGIN;
DO $dry$
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
     IS DISTINCT FROM 'FOREIGN KEY (campaign_id) REFERENCES social_campaigns(id) ON DELETE CASCADE' THEN RAISE EXCEPTION 'DRYRUN_FAIL precondition items FK'; END IF;
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'social_content_files_campaign_id_fkey')
     IS DISTINCT FROM 'FOREIGN KEY (campaign_id) REFERENCES social_campaigns(id) ON DELETE CASCADE' THEN RAISE EXCEPTION 'DRYRUN_FAIL precondition files FK'; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'label_artist_id'
             AND table_name IN ('social_campaigns', 'social_content_items')) THEN RAISE EXCEPTION 'DRYRUN_FAIL precondition column exists'; END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.social_campaigns'::regclass AND NOT tgisinternal) THEN RAISE EXCEPTION 'DRYRUN_FAIL precondition trigger'; END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE confrelid IN ('public.social_campaigns'::regclass, 'public.social_content_items'::regclass)
             AND conname NOT IN ('social_content_items_campaign_id_fkey', 'social_content_files_campaign_id_fkey',
                                 'social_content_files_content_item_id_fkey', 'social_promotions_campaign_id_fkey'))
     THEN RAISE EXCEPTION 'DRYRUN_FAIL precondition unknown FK'; END IF;
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
  IF v_post IS DISTINCT FROM v_pre THEN RAISE EXCEPTION 'DRYRUN_FAIL migration changed existing rows'; END IF;
  IF EXISTS (SELECT 1 FROM social_content_items WHERE campaign_id IS NULL AND label_artist_id IS NULL) THEN RAISE EXCEPTION 'DRYRUN_FAIL orphan after migration'; END IF;
  v_out := v_out || 'migration applied (in-transaction) OK; ';

  -- ===== the experiment: TEST rows only (ids generated here, never existing ones) =====
  SELECT id INTO v_shalev FROM label_artists WHERE name = 'שליו טסמה';
  IF v_shalev IS NULL THEN RAISE EXCEPTION 'DRYRUN_FAIL no roster row'; END IF;
  INSERT INTO social_campaigns (id, project_id, title, artist_name, release_date, status, marketing_angle, target_audience, main_message, platforms, owner_id, notes, created_at, updated_at, promotion_budget, label_artist_id)
    VALUES (v_camp, NULL, 'DRYRUN test campaign', 'שליו טסמה', NULL, 'draft', '', '', '', ARRAY[]::text[], '', 'DRYRUN', now(), now(), 0, v_shalev);
  INSERT INTO social_content_items (id, campaign_id, project_id, title, content_type, status, platform, due_date, publish_date, owner_name, asset_link, dropbox_link, calendar_event_id, task_id, caption, hook, notes, posted_url, created_at, updated_at, publish_time, label_artist_id)
    VALUES (v_a, v_camp, NULL, 'DRYRUN A (artist)', 'reel', 'idea', NULL, NULL, NULL, '', '', '', NULL, NULL, '', '', 'DRYRUN', '', now(), now(), NULL, v_shalev),
           (v_b, v_camp, NULL, 'DRYRUN B (no artist)', 'reel', 'idea', NULL, NULL, NULL, '', '', '', NULL, NULL, '', '', 'DRYRUN', '', now(), now(), NULL, NULL);
  INSERT INTO social_content_files (id, content_item_id, campaign_id, project_id, file_name, file_type, file_size, dropbox_path, dropbox_file_id, dropbox_share_link, uploaded_by, created_at, updated_at)
    VALUES (v_fa, v_a, v_camp, NULL, 'dryrun-a.mp4', 'video/mp4', 1, '/DRYRUN/a', 'dryrun-a', '', '', now(), now()),
           (v_fb, v_b, v_camp, NULL, 'dryrun-b.mp4', 'video/mp4', 1, '/DRYRUN/b', 'dryrun-b', '', '', now(), now());
  v_out := v_out || 'test rows created (1 campaign, 2 items, 2 files); ';

  DELETE FROM social_campaigns WHERE id = v_camp;

  -- 1) artist content + its file survive, detached from the campaign
  SELECT count(*) INTO n FROM social_content_items WHERE id = v_a AND campaign_id IS NULL AND label_artist_id = v_shalev;
  IF n <> 1 THEN RAISE EXCEPTION 'DRYRUN_FAIL artist item lost'; END IF;
  SELECT count(*) INTO n FROM social_content_files WHERE id = v_fa AND content_item_id = v_a AND campaign_id IS NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'DRYRUN_FAIL artist file lost'; END IF;
  v_out := v_out || 'R1 artist item kept (campaign NULL, artist Shalev) + its file kept and attached; ';
  -- 2) non-artist content + its file deleted with the campaign
  SELECT count(*) INTO n FROM social_content_items WHERE id = v_b;
  IF n <> 0 THEN RAISE EXCEPTION 'DRYRUN_FAIL non-artist item survived'; END IF;
  SELECT count(*) INTO n FROM social_content_files WHERE id = v_fb;
  IF n <> 0 THEN RAISE EXCEPTION 'DRYRUN_FAIL non-artist file survived'; END IF;
  v_out := v_out || 'R2 non-artist item + its file deleted with the campaign; ';
  -- no orphans anywhere
  IF EXISTS (SELECT 1 FROM social_content_items WHERE campaign_id IS NULL AND label_artist_id IS NULL) THEN RAISE EXCEPTION 'DRYRUN_FAIL orphan item'; END IF;
  IF EXISTS (SELECT 1 FROM social_content_files f JOIN social_content_items i ON i.id = f.content_item_id WHERE f.campaign_id IS DISTINCT FROM i.campaign_id) THEN RAISE EXCEPTION 'DRYRUN_FAIL file/item campaign mismatch'; END IF;
  IF EXISTS (SELECT 1 FROM social_content_files f WHERE NOT EXISTS (SELECT 1 FROM social_content_items i WHERE i.id = f.content_item_id)) THEN RAISE EXCEPTION 'DRYRUN_FAIL orphan file'; END IF;
  v_out := v_out || 'no orphan items / files, no file-item mismatch; ';
  -- the CHECK refuses an item with neither campaign nor artist
  BEGIN
    INSERT INTO social_content_items (id, campaign_id, title, content_type, status, owner_name, asset_link, dropbox_link, caption, hook, notes, posted_url, created_at, updated_at)
      VALUES (gen_random_uuid(), NULL, 'DRYRUN C', 'reel', 'idea', '', '', '', '', '', '', '', now(), now());
    RAISE EXCEPTION 'DRYRUN_FAIL CHECK did not refuse';
  EXCEPTION WHEN check_violation THEN v_out := v_out || 'CHECK refuses an item with no campaign and no artist; ';
  END;
  -- remove the surviving test item (test data only)
  DELETE FROM social_content_items WHERE id = v_a;

  -- production rows identical to before?
  SELECT md5(coalesce((SELECT string_agg((row_to_json(t)::jsonb - 'label_artist_id')::text, '|' ORDER BY id) FROM social_campaigns t), '') ||
             coalesce((SELECT string_agg((row_to_json(t)::jsonb - 'label_artist_id')::text, '|' ORDER BY id) FROM social_content_items t), '') ||
             coalesce((SELECT string_agg(row_to_json(t)::jsonb::text, '|' ORDER BY id) FROM social_content_files t), '') ||
             coalesce((SELECT string_agg(row_to_json(t)::jsonb::text, '|' ORDER BY id) FROM social_promotions t), '')) INTO v_post;
  IF v_post IS DISTINCT FROM v_pre THEN RAISE EXCEPTION 'DRYRUN_FAIL production rows changed'; END IF;
  v_out := v_out || 'counts now c' || (SELECT count(*) FROM social_campaigns) || ' i' || (SELECT count(*) FROM social_content_items) || ' f' || (SELECT count(*) FROM social_content_files) || ' p' || (SELECT count(*) FROM social_promotions) || '; ';
  v_out := v_out || 'fingerprint before ' || left(v_pre, 12) || ' after ' || left(v_post, 12) || '; ';

  -- ALWAYS undo: this exception rolls back the whole block (schema + rows)
  RAISE EXCEPTION 'DRYRUN_RESULT %', v_out;
END
$dry$;
ROLLBACK;
