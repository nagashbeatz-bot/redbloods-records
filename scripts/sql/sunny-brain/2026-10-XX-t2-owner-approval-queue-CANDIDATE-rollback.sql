-- ============================================================================================
-- T2 Owner Approval Queue: ROLLBACK.  CANDIDATE (revision v4) — NOT APPLIED TO PRODUCTION.
-- SAFE MODE: refuses when any request / decision / principal row exists (approval history is never dropped by a
-- rollback). Order: the guarded SEED rollback first (removes the one principal while nothing was approved), then this file.
-- A queue that holds history needs a separate, Owner-approved export-first procedure.
-- Drops ONLY what the T2 forward file created. Brain v1 objects are untouched.
-- ============================================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $$
BEGIN
  IF to_regclass('public.owner_approval_requests') IS NULL THEN RAISE EXCEPTION 'PRECONDITION: T2 is not installed'; END IF;
  IF (SELECT count(*) FROM public.owner_approval_requests) + (SELECT count(*) FROM public.owner_approval_decisions) <> 0 THEN
    RAISE EXCEPTION 'PRECONDITION: the queue holds approval history — export-first procedure required (Owner approval)'; END IF;
  IF (SELECT count(*) FROM public.owner_approval_principals) <> 0 THEN
    RAISE EXCEPTION 'PRECONDITION: a principal exists — run the guarded seed rollback first'; END IF;
  IF EXISTS (SELECT 1 FROM public.sunny_brain_events WHERE actor = 'OWNER') OR EXISTS (SELECT 1 FROM public.sunny_tracking_authorizations)
     OR EXISTS (SELECT 1 FROM public.sunny_resources WHERE approval_basis = 'OWNER_APPROVAL') OR EXISTS (SELECT 1 FROM public.sunny_observations WHERE approval_basis = 'OWNER_APPROVAL') THEN
    RAISE EXCEPTION 'PRECONDITION: Brain rows created through the approval path exist — export-first procedure required'; END IF;
END $$;
DROP FUNCTION public.owner_brain_transition(text, uuid, text, text);
DROP FUNCTION public.owner_revoke_tracking_authorization(uuid, text);
DROP FUNCTION public.owner_approval_cancel(uuid, text);
DROP FUNCTION public.owner_approval_decide(uuid, text, text, jsonb, text);
DROP FUNCTION public.owner_approval_request(text, jsonb, text, text, text, timestamptz, uuid);
DROP FUNCTION public.owner_approval_is_narrowing(text, jsonb, jsonb);
DROP FUNCTION public.owner_approval_payload_ok(text, jsonb);
DROP FUNCTION public.owner_approval_text_array(jsonb);
DROP FUNCTION public.owner_approval_hash(jsonb);
DROP FUNCTION public.owner_approval_assert_owner();
DROP TABLE public.owner_approval_decisions;
DROP TABLE public.owner_approval_requests;
DROP TABLE public.owner_approval_principals;
DROP FUNCTION public.owner_approval_append_only();
DO $$
BEGIN
  IF to_regclass('public.owner_approval_requests') IS NOT NULL OR to_regclass('public.owner_approval_decisions') IS NOT NULL
     OR to_regclass('public.owner_approval_principals') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
                AND (p.proname LIKE 'owner\_approval\_%' OR p.proname IN ('owner_revoke_tracking_authorization','owner_brain_transition'))) THEN
    RAISE EXCEPTION 'POSTCONDITION: T2 objects remain'; END IF;
  IF to_regclass('public.sunny_tracking_authorizations') IS NULL OR to_regprocedure('public.sunny_brain_transition_core(text, uuid, text, text, text, uuid, text, uuid)') IS NULL THEN
    RAISE EXCEPTION 'POSTCONDITION: a Brain object disappeared'; END IF;
END $$;
COMMIT;
