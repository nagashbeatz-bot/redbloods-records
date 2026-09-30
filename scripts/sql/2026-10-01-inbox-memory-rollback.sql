-- ROLLBACK of 2026-10-01-inbox-memory.sql — NOT run. Only with the Owner's explicit decision; refuses itself when memory rows exist.
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.sunny_inbox_links) OR EXISTS (SELECT 1 FROM public.sunny_inbox_interpretations)
     OR EXISTS (SELECT 1 FROM public.sunny_owner_inbox WHERE outcome = 'MEMORY_RECORDED') THEN
    RAISE EXCEPTION 'ROLLBACK_REFUSED: inbox memory already has rows — a separate Owner decision';
  END IF;
END $$;
DROP TRIGGER sunny_owner_inbox_guard ON public.sunny_owner_inbox;
DROP FUNCTION public.sunny_owner_inbox_guard();
DROP FUNCTION public.sunny_inbox_retract_interpretation(uuid, text);
DROP FUNCTION public.sunny_inbox_retract_link(uuid, text);
DROP FUNCTION public.sunny_inbox_record_interpretation(uuid, uuid, text, text[], text[], text[], text, text, text, text, text, timestamptz, uuid, text, text);
DROP FUNCTION public.sunny_inbox_link_entity(uuid, text, text, text, text[], uuid);
DROP TABLE public.sunny_inbox_interpretations;
DROP TABLE public.sunny_inbox_links;
DROP FUNCTION public.sunny_inbox_interpretations_guard();
DROP FUNCTION public.sunny_inbox_links_guard();
DROP FUNCTION public.sunny_inbox_text_list_ok(text[], integer, integer);
DROP FUNCTION public.sunny_inbox_entity_exists(text);
ALTER TABLE public.sunny_owner_inbox DROP CONSTRAINT sunny_owner_inbox_memory_recorded_no_ref;
ALTER TABLE public.sunny_owner_inbox DROP CONSTRAINT sunny_owner_inbox_outcome_check;
ALTER TABLE public.sunny_owner_inbox ADD CONSTRAINT sunny_owner_inbox_outcome_check
  CHECK (outcome IN ('LEARNED_KNOWLEDGE','ACTION_PLANNED','NO_ACTION_NEEDED','DISMISSED'));
-- the 2026-09-30 mark_processed, exactly as captured (pg_get_functiondef md5 1f88114b2083b4fdc7730a6819dbcad6)
CREATE OR REPLACE FUNCTION public.sunny_owner_inbox_mark_processed(p_id uuid, p_via text, p_outcome text, p_ref text)
 RETURNS sunny_owner_inbox
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE r public.sunny_owner_inbox;
BEGIN
  IF p_via IS NULL OR p_via NOT IN ('DASHBOARD','SUNNY') THEN
    RAISE EXCEPTION 'INVALID_PROCESSED_VIA: "%" (allowed: DASHBOARD, SUNNY)', p_via
      USING ERRCODE = '22023';
  END IF;
  IF p_outcome IS NULL OR p_outcome NOT IN ('LEARNED_KNOWLEDGE','ACTION_PLANNED','NO_ACTION_NEEDED','DISMISSED') THEN
    RAISE EXCEPTION 'INVALID_OUTCOME: "%" (allowed: LEARNED_KNOWLEDGE, ACTION_PLANNED, NO_ACTION_NEEDED, DISMISSED)', p_outcome
      USING ERRCODE = '22023';
  END IF;
  UPDATE public.sunny_owner_inbox
     SET status = 'PROCESSED', processed_at = now(), processed_via = p_via,
         outcome = p_outcome, outcome_ref = NULLIF(btrim(p_ref), '')
   WHERE id = p_id AND status = 'NEW'
  RETURNING * INTO r;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_NEW_OR_MISSING: inbox item % does not exist or is already PROCESSED', p_id
      USING ERRCODE = 'P0002';
  END IF;
  RETURN r;
END $function$;
COMMIT;
