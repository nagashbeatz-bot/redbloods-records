-- Stage 2 (content series + weekly targets) — ROLLBACK of 2026-10-17-artist-social-stage2-APPLIED.sql. NOT RUN. Owner approval required.
-- Guarded: refuses while any series / target exists or any item has a series (that data would be lost) — nothing is deleted.
-- Restores the stage 1 CHECK and the stage 1 campaign-delete trigger body.
BEGIN;
DO $rb$
BEGIN
  IF EXISTS (SELECT 1 FROM public.social_cadence_targets) OR EXISTS (SELECT 1 FROM public.social_series)
     OR EXISTS (SELECT 1 FROM public.social_content_items WHERE series_id IS NOT NULL)
    THEN RAISE EXCEPTION 'ROLLBACK_BLOCKED: series / targets exist — decide what to do with them first (nothing is deleted)'; END IF;
  DROP TRIGGER social_cadence_targets_guard ON public.social_cadence_targets;
  DROP TRIGGER social_cadence_targets_append_only ON public.social_cadence_targets;
  DROP FUNCTION public.social_cadence_targets_guard();
  DROP FUNCTION public.social_cadence_targets_append_only();
  DROP TABLE public.social_cadence_targets;
  DROP TRIGGER social_content_series_guard ON public.social_content_items;
  DROP FUNCTION public.social_content_series_guard();
  DROP TRIGGER social_series_owner_guard ON public.social_series;
  DROP FUNCTION public.social_series_owner_guard();
  ALTER TABLE public.social_content_items DROP CONSTRAINT social_content_owner_ck,
    ADD CONSTRAINT social_content_owner_ck CHECK (campaign_id IS NOT NULL OR label_artist_id IS NOT NULL);
  CREATE OR REPLACE FUNCTION public.social_campaign_before_delete() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public AS $f$
  BEGIN
    DELETE FROM public.social_content_items WHERE campaign_id = OLD.id AND label_artist_id IS NULL;
    RETURN OLD;
  END $f$;
  REVOKE ALL ON FUNCTION public.social_campaign_before_delete() FROM PUBLIC, anon, authenticated;
  DROP INDEX public.social_content_series_idx;
  ALTER TABLE public.social_content_items DROP COLUMN series_id;
  DROP TABLE public.social_series;
END
$rb$;
COMMIT;
