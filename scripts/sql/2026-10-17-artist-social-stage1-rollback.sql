-- Stage 1 (artist social content) — ROLLBACK of 2026-10-17-artist-social-stage1-APPLIED.sql. NOT RUN. Owner approval required.
-- Guarded: refuses while any content / file has no campaign (artist-only content would be lost) — nothing is deleted.
-- Dropping the columns removes the artist links themselves (back them up first); no item, file, campaign or promotion is deleted.
BEGIN;
DO $rb$
BEGIN
  IF EXISTS (SELECT 1 FROM public.social_content_items WHERE campaign_id IS NULL) OR EXISTS (SELECT 1 FROM public.social_content_files WHERE campaign_id IS NULL)
    THEN RAISE EXCEPTION 'ROLLBACK_BLOCKED: artist content with no campaign exists — decide what to do with it first (nothing is deleted)'; END IF;
  DROP TRIGGER social_campaign_before_delete ON public.social_campaigns;
  DROP FUNCTION public.social_campaign_before_delete();
  ALTER TABLE public.social_content_files DROP CONSTRAINT social_content_files_campaign_id_fkey,
    ADD CONSTRAINT social_content_files_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.social_campaigns(id) ON DELETE CASCADE;
  ALTER TABLE public.social_content_items DROP CONSTRAINT social_content_items_campaign_id_fkey,
    ADD CONSTRAINT social_content_items_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.social_campaigns(id) ON DELETE CASCADE;
  ALTER TABLE public.social_content_files ALTER COLUMN campaign_id SET NOT NULL;
  ALTER TABLE public.social_content_items DROP CONSTRAINT social_content_owner_ck;
  ALTER TABLE public.social_content_items ALTER COLUMN campaign_id SET NOT NULL;
  DROP INDEX public.social_content_artist_idx;
  ALTER TABLE public.social_content_items DROP COLUMN label_artist_id;
  ALTER TABLE public.social_campaigns DROP COLUMN label_artist_id;
END
$rb$;
COMMIT;
