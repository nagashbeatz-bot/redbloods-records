-- ============================================================================================
-- Sunny Brain v1: ROLLBACK.  CANDIDATE (revision v4) — NOT APPLIED TO PRODUCTION.
-- SAFE MODE: refuses when ANY brain row exists, or while T2 is installed (T2 calls Brain functions — roll T2 back first).
-- Sunny's memory is never dropped by a rollback; a brain that holds rows needs a separate, Owner-approved export-first
-- procedure. Drops ONLY what the forward file created.
-- ============================================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
DECLARE t text; n integer := 0; c integer;
BEGIN
  IF to_regclass('public.sunny_brain_events') IS NULL THEN RAISE EXCEPTION 'PRECONDITION: sunny brain v1 is not installed'; END IF;
  IF to_regclass('public.owner_approval_requests') IS NOT NULL OR to_regclass('public.owner_approval_principals') IS NOT NULL THEN
    RAISE EXCEPTION 'PRECONDITION: T2 is installed — roll back T2 (and its seed) first'; END IF;
  FOREACH t IN ARRAY ARRAY['sunny_resources','sunny_tracking_authorizations','sunny_observations','sunny_intel_records','sunny_brain_links','sunny_brain_events'] LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO c; n := n + c;
  END LOOP;
  IF n <> 0 THEN RAISE EXCEPTION 'PRECONDITION: the brain holds % rows — export-first procedure required (Owner approval)', n; END IF;
END $$;

DROP FUNCTION public.sunny_add_links(jsonb, uuid, uuid);
DROP FUNCTION public.sunny_brain_transition(text, uuid, text, text, uuid, uuid);
DROP FUNCTION public.sunny_create_intel_record(text, text[], uuid[], text, text, text, jsonb, text, text, date, uuid, text, jsonb, uuid, uuid);
DROP FUNCTION public.sunny_record_observations(uuid, jsonb, uuid, uuid);
DROP FUNCTION public.sunny_register_content(text, text, uuid, text, text, text, uuid, uuid);
DROP FUNCTION public.sunny_brain_transition_core(text, uuid, text, text, text, uuid, text, uuid);
DROP FUNCTION public.sunny_brain_insert_links(jsonb, public.sunny_tracking_authorizations, uuid, integer);
DROP FUNCTION public.sunny_record_observations_core(uuid, jsonb, text, uuid, text, uuid);
DROP FUNCTION public.sunny_register_resource_core(text, text, text, uuid, text, text, text, text, text, text, uuid, text, uuid);
DROP FUNCTION public.sunny_grant_tracking_authorization(text, text, uuid[], boolean, text[], text[], text[], boolean, boolean, integer, date, date, uuid, text, uuid);
DROP FUNCTION public.sunny_auth_covers_observation(public.sunny_tracking_authorizations, uuid);
DROP FUNCTION public.sunny_auth_covers_record(public.sunny_tracking_authorizations, uuid);
DROP FUNCTION public.sunny_auth_covers_subjects(public.sunny_tracking_authorizations, text[], uuid[]);
DROP FUNCTION public.sunny_auth_covers_resource(public.sunny_tracking_authorizations, uuid);
DROP FUNCTION public.sunny_auth_active(uuid);

DROP VIEW public.sunny_observations_current;
DROP VIEW public.sunny_intel_record_status;

-- FK order (triggers go with their tables)
DROP TABLE public.sunny_brain_events;
DROP TABLE public.sunny_brain_links;
DROP TABLE public.sunny_intel_records;
DROP TABLE public.sunny_observations;
ALTER TABLE public.sunny_resources DROP CONSTRAINT sunny_resources_authorization_fk;
DROP TABLE public.sunny_tracking_authorizations;
DROP TABLE public.sunny_resources;

DROP FUNCTION public.sunny_brain_append_only();
DROP FUNCTION public.sunny_intel_transition_ok(text, text, text, text);
DROP FUNCTION public.sunny_intel_body_ok(text, jsonb);
DROP FUNCTION public.sunny_brain_ref_ok(text);
DROP FUNCTION public.sunny_brain_entity_ok(text);
DROP FUNCTION public.sunny_canonical_url(text);
DROP FUNCTION public.sunny_today_il();

DO $$
BEGIN
  IF to_regclass('public.sunny_resources') IS NOT NULL OR to_regclass('public.sunny_tracking_authorizations') IS NOT NULL
     OR to_regclass('public.sunny_observations') IS NOT NULL OR to_regclass('public.sunny_intel_records') IS NOT NULL
     OR to_regclass('public.sunny_brain_links') IS NOT NULL OR to_regclass('public.sunny_brain_events') IS NOT NULL
     OR to_regclass('public.sunny_intel_record_status') IS NOT NULL OR to_regclass('public.sunny_observations_current') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
                WHERE ns.nspname = 'public' AND (p.proname LIKE 'sunny\_brain\_%' OR p.proname LIKE 'sunny\_intel\_%' OR p.proname LIKE 'sunny\_auth\_%'
                  OR p.proname IN ('sunny_today_il','sunny_canonical_url','sunny_grant_tracking_authorization','sunny_register_resource_core','sunny_register_content',
                                   'sunny_record_observations','sunny_record_observations_core','sunny_create_intel_record','sunny_add_links'))) THEN
    RAISE EXCEPTION 'POSTCONDITION: brain objects remain';
  END IF;
  IF to_regprocedure('public.sunny_inbox_entity_exists(text)') IS NULL OR to_regclass('public.partner_owner_knowledge') IS NULL THEN
    RAISE EXCEPTION 'POSTCONDITION: a pre-existing object disappeared'; END IF;
END $$;

COMMIT;
