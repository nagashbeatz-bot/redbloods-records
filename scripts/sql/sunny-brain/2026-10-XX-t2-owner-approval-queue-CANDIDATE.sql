-- ============================================================================================
-- T2 — Generic Owner Approval Queue: FORWARD migration.  CANDIDATE (revision v4) — NOT APPLIED TO PRODUCTION.
-- Requires Sunny Brain v1 (v4) applied BEFORE this file.
--
-- Principle: a real approval is the Owner's OWN Redbloods session. Every Owner RPC is executable ONLY by `authenticated`
-- and, inside, runs owner_approval_assert_owner(): JWT role claim 'authenticated', not anonymous, auth.uid() listed in
-- owner_approval_principals. No function takes a caller-supplied user id. service_role has NO EXECUTE on them — and
-- even if it had, its JWT role claim is 'service_role' and auth.uid() is NULL → refused.
-- Kinds (v4): TRACKING_AUTHORIZATION (grant / replace an authorization, may register new accounts / pages) and
--             OWNER_OBSERVATIONS (values the Owner states — the ONLY path that writes OWNER_STATEMENT observations).
-- Owner-only Brain moves (ENDORSED / REJECTED / ACCEPTED / Owner invalidation / retire / retract): owner_brain_transition.
-- Creates: owner_approval_principals, owner_approval_requests, owner_approval_decisions; helpers + 6 RPCs. It alters no
-- existing object (it CALLS Brain cores from SECURITY DEFINER code; POSTCONDITIONS pin every caller).
-- The principal row is seeded by the separate seed file (own SHA-256, own guarded rollback).
-- ============================================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
BEGIN
  IF to_regclass('public.owner_approval_requests') IS NOT NULL OR to_regclass('public.owner_approval_decisions') IS NOT NULL
     OR to_regclass('public.owner_approval_principals') IS NOT NULL THEN RAISE EXCEPTION 'PRECONDITION: T2 tables already exist'; END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
             AND (p.proname LIKE 'owner\_approval\_%' OR p.proname IN ('owner_revoke_tracking_authorization','owner_brain_transition'))) THEN
    RAISE EXCEPTION 'PRECONDITION: T2 functions already exist'; END IF;
  IF to_regclass('public.sunny_tracking_authorizations') IS NULL OR to_regclass('public.sunny_resources') IS NULL OR to_regclass('public.sunny_brain_events') IS NULL THEN
    RAISE EXCEPTION 'PRECONDITION: Sunny Brain v1 must be applied first'; END IF;
  IF to_regprocedure('public.sunny_grant_tracking_authorization(text, text, uuid[], boolean, text[], text[], text[], boolean, boolean, integer, date, date, uuid, text, uuid)') IS NULL
     OR to_regprocedure('public.sunny_register_resource_core(text, text, text, uuid, text, text, text, text, text, text, uuid, text, uuid)') IS NULL
     OR to_regprocedure('public.sunny_record_observations_core(uuid, jsonb, text, uuid, text, uuid)') IS NULL
     OR to_regprocedure('public.sunny_brain_transition_core(text, uuid, text, text, text, uuid, text, uuid)') IS NULL
     OR to_regprocedure('public.sunny_canonical_url(text)') IS NULL THEN
    RAISE EXCEPTION 'PRECONDITION: Brain v1 (v4) cores missing'; END IF;
  IF has_function_privilege('service_role', 'public.sunny_grant_tracking_authorization(text, text, uuid[], boolean, text[], text[], text[], boolean, boolean, integer, date, date, uuid, text, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'PRECONDITION: service_role must not be able to grant'; END IF;
  IF to_regprocedure('auth.uid()') IS NULL OR to_regclass('auth.users') IS NULL THEN RAISE EXCEPTION 'PRECONDITION: Supabase auth missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    RAISE EXCEPTION 'PRECONDITION: Supabase roles missing'; END IF;
END $$;

-- ───────────────────────────── tables ─────────────────────────────

-- Who may decide. Written ONLY by the Owner-approved seed migration (no RPC writes it).
CREATE TABLE public.owner_approval_principals (
  user_id     uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
  label       text NOT NULL CHECK (char_length(label) BETWEEN 2 AND 60),
  added_at    timestamptz NOT NULL DEFAULT now(),
  added_by    text NOT NULL CHECK (added_by ~ '^migration:[A-Za-z0-9._-]{4,120}$')
);

-- A request = what Sunny (or the Owner's UI) asks the Owner to approve. Immutable.
CREATE TABLE public.owner_approval_requests (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq                 bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  kind                text NOT NULL CHECK (kind IN ('TRACKING_AUTHORIZATION','OWNER_OBSERVATIONS')),
  requested_payload   jsonb NOT NULL CHECK (jsonb_typeof(requested_payload) = 'object' AND octet_length(requested_payload::text) <= 32768),
  payload_hash        text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  summary_he          text NOT NULL CHECK (summary_he = btrim(summary_he) AND char_length(summary_he) BETWEEN 2 AND 2000),
  risk_he             text NOT NULL CHECK (risk_he = btrim(risk_he) AND char_length(risk_he) BETWEEN 2 AND 1000),
  requested_via       text NOT NULL CHECK (requested_via IN ('SUNNY','OWNER_UI')),
  requested_client    text NULL CHECK (requested_client IS NULL OR requested_client ~ '^rbmcp_[A-Za-z0-9_-]{32,64}$'),
  request_expires_at  timestamptz NULL,
  request_key         uuid NOT NULL UNIQUE,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT owner_approval_requests_expiry CHECK (request_expires_at IS NULL OR request_expires_at > created_at)
);
CREATE INDEX owner_approval_requests_kind_idx ON public.owner_approval_requests (kind, seq DESC);

-- Exactly one decision per request. Immutable.
CREATE TABLE public.owner_approval_decisions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq                    bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  request_id             uuid NOT NULL UNIQUE REFERENCES public.owner_approval_requests(id) ON DELETE RESTRICT,
  decision               text NOT NULL CHECK (decision IN ('APPROVED','REJECTED','CANCELLED')),
  approved_payload       jsonb NULL,
  approved_payload_hash  text NULL CHECK (approved_payload_hash IS NULL OR approved_payload_hash ~ '^[0-9a-f]{64}$'),
  narrowed               boolean NOT NULL DEFAULT false,
  decided_by             uuid NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  decided_role           text NOT NULL CHECK (decided_role IN ('authenticated','service_role')),
  reason_he              text NULL CHECK (reason_he IS NULL OR (reason_he = btrim(reason_he) AND char_length(reason_he) BETWEEN 1 AND 300)),
  result_ref             text NULL CHECK (result_ref IS NULL OR result_ref ~ '^(authorization|observations):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  created_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT owner_approval_decisions_who CHECK (
    (decision IN ('APPROVED','REJECTED') AND decided_role = 'authenticated' AND decided_by IS NOT NULL)
    OR (decision = 'CANCELLED' AND decided_role = 'service_role' AND decided_by IS NULL)),
  CONSTRAINT owner_approval_decisions_approved_shape CHECK (
    (decision = 'APPROVED') = (approved_payload IS NOT NULL AND approved_payload_hash IS NOT NULL AND result_ref IS NOT NULL))
);

CREATE FUNCTION public.owner_approval_append_only() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN RAISE EXCEPTION 'APPEND_ONLY: % rows never change or disappear', TG_TABLE_NAME USING ERRCODE = '42501'; END $$;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['owner_approval_principals','owner_approval_requests','owner_approval_decisions'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.owner_approval_append_only()', t || '_append_only', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.owner_approval_append_only()', t || '_no_truncate', t);
  END LOOP;
END $$;

-- ───────────────────────────── helpers (no API role) ─────────────────────────────

-- THE Owner check. No parameter: identity comes only from the verified JWT that PostgREST put in request.jwt.claims.
CREATE FUNCTION public.owner_approval_assert_owner() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_claims jsonb; v_uid uuid;
BEGIN
  v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  IF v_claims IS NULL OR v_claims->>'role' IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'OWNER_SESSION_REQUIRED: not an authenticated user session' USING ERRCODE = '42501'; END IF;
  IF coalesce((v_claims->>'is_anonymous')::boolean, false) THEN
    RAISE EXCEPTION 'OWNER_SESSION_REQUIRED: anonymous session' USING ERRCODE = '42501'; END IF;
  v_uid := auth.uid();
  IF v_uid IS NULL OR v_uid::text IS DISTINCT FROM (v_claims->>'sub') OR NOT EXISTS (SELECT 1 FROM public.owner_approval_principals WHERE user_id = v_uid) THEN
    RAISE EXCEPTION 'OWNER_SESSION_REQUIRED: this user may not decide' USING ERRCODE = '42501'; END IF;
  RETURN v_uid;
END $$;

CREATE FUNCTION public.owner_approval_hash(p jsonb) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT encode(sha256(convert_to(p::text, 'UTF8')), 'hex')   -- jsonb text is canonical (sorted keys, normalized)
$$;

CREATE FUNCTION public.owner_approval_text_array(p jsonb) RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT CASE WHEN p IS NULL OR jsonb_typeof(p) = 'null' THEN '{}'::text[]
              WHEN jsonb_typeof(p) = 'array' THEN coalesce((SELECT array_agg(x ORDER BY x) FROM jsonb_array_elements_text(p) x), '{}') END
$$;

-- Payload contracts.
-- TRACKING_AUTHORIZATION — exactly these keys, typed (all booleans REQUIRED, no defaults):
--   purposeKind · purposeHe · resourceIds uuid[] · newResources [{platform, resourceKind ACCOUNT|PAGE, identityKey
--   '<account|page>:<id>', firstHandle?, canonicalUrl?, displayName?, externalActor?}] · includeChildResources bool ·
--   entityKeys text[] · observationFamilies text[] · sourceKinds text[] · insightsAllowed bool · recommendationsAllowed bool ·
--   maxObservationsPerDay int|null (per Israel calendar day) · validFrom date · validUntil date|null · baseAuthorizationId uuid|null
-- OWNER_OBSERVATIONS — exactly {items: [1–40 observation items]}, every item sourceType OWNER_STATEMENT / captureMethod
--   OWNER_PROVIDED. Full item validation is the Brain core's (run in a rolled-back sub-transaction at request time, and
--   for real at decision time).
CREATE FUNCTION public.owner_approval_payload_ok(p_kind text, p jsonb) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $$
DECLARE k text; r jsonb;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN RETURN false; END IF;
  IF p_kind = 'OWNER_OBSERVATIONS' THEN
    IF (SELECT array_agg(x) FROM jsonb_object_keys(p) x) IS DISTINCT FROM ARRAY['items'] THEN RETURN false; END IF;
    IF jsonb_typeof(p->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'items') NOT BETWEEN 1 AND 40 THEN RETURN false; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p->'items') e WHERE jsonb_typeof(e) <> 'object'
               OR e->>'sourceType' IS DISTINCT FROM 'OWNER_STATEMENT' OR e->>'captureMethod' IS DISTINCT FROM 'OWNER_PROVIDED') THEN RETURN false; END IF;
    IF (SELECT count(DISTINCT e) FROM jsonb_array_elements(p->'items') e) <> jsonb_array_length(p->'items') THEN RETURN false; END IF;
    RETURN true;
  END IF;
  IF p_kind <> 'TRACKING_AUTHORIZATION' THEN RETURN false; END IF;
  FOR k IN SELECT jsonb_object_keys(p) LOOP
    IF NOT k = ANY (ARRAY['purposeKind','purposeHe','resourceIds','newResources','includeChildResources','entityKeys','observationFamilies','sourceKinds',
                          'insightsAllowed','recommendationsAllowed','maxObservationsPerDay','validFrom','validUntil','baseAuthorizationId']) THEN RETURN false; END IF;
  END LOOP;
  IF p->>'purposeKind' NOT IN ('OWN_PRESENCE','REFERENCE_RESEARCH','BUSINESS_SNAPSHOT') OR coalesce(char_length(p->>'purposeHe'), 0) NOT BETWEEN 2 AND 300 THEN RETURN false; END IF;
  IF jsonb_typeof(p->'resourceIds') IS DISTINCT FROM 'array' OR jsonb_typeof(p->'newResources') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p->'entityKeys') IS DISTINCT FROM 'array' OR jsonb_typeof(p->'observationFamilies') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p->'sourceKinds') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  IF jsonb_typeof(p->'includeChildResources') IS DISTINCT FROM 'boolean' OR jsonb_typeof(p->'insightsAllowed') IS DISTINCT FROM 'boolean'
     OR jsonb_typeof(p->'recommendationsAllowed') IS DISTINCT FROM 'boolean' THEN RETURN false; END IF;
  IF jsonb_array_length(p->'resourceIds') + jsonb_array_length(p->'newResources') + jsonb_array_length(p->'entityKeys') = 0 THEN RETURN false; END IF;
  IF jsonb_array_length(p->'resourceIds') + jsonb_array_length(p->'newResources') > 40 OR jsonb_array_length(p->'entityKeys') > 40
     OR jsonb_array_length(p->'observationFamilies') NOT BETWEEN 1 AND 20 OR jsonb_array_length(p->'sourceKinds') NOT BETWEEN 1 AND 8 THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p->'resourceIds') x WHERE jsonb_typeof(x) <> 'string' OR x #>> '{}' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p->'entityKeys') x WHERE jsonb_typeof(x) <> 'string') THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p->'observationFamilies') x WHERE jsonb_typeof(x) <> 'string' OR x #>> '{}' !~ '^[A-Z][A-Z0-9_]{1,30}$') THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p->'sourceKinds') x WHERE jsonb_typeof(x) <> 'string' OR x #>> '{}' NOT IN ('PUBLIC_PROFILE_PAGE','PUBLIC_CONTENT_PAGE','WEB_PAGE','REDBLOODS_RECORD','PLATFORM_API')) THEN RETURN false; END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(p->'newResources') LOOP
    IF jsonb_typeof(r) <> 'object' OR r->>'platform' NOT IN ('instagram','youtube','tiktok','spotify','facebook','x','web')
       OR r->>'resourceKind' NOT IN ('ACCOUNT','PAGE')
       OR coalesce(r->>'identityKey', '') !~ '^(account|page):[A-Za-z0-9@._:/-]{1,160}$'
       OR split_part(r->>'identityKey', ':', 1) <> lower(r->>'resourceKind') THEN RETURN false; END IF;
    IF r ? 'canonicalUrl' AND (r->>'canonicalUrl') IS DISTINCT FROM public.sunny_canonical_url(r->>'canonicalUrl') THEN RETURN false; END IF;
    IF r->>'platform' = 'web' AND (r->>'resourceKind' <> 'PAGE' OR NOT r ? 'canonicalUrl'
       OR r->>'identityKey' <> 'page:url-sha256:' || encode(sha256(convert_to(r->>'canonicalUrl', 'UTF8')), 'hex')) THEN RETURN false; END IF;
  END LOOP;
  IF (SELECT count(DISTINCT (e->>'platform') || '|' || (e->>'identityKey')) FROM jsonb_array_elements(p->'newResources') e) <> jsonb_array_length(p->'newResources') THEN RETURN false; END IF;
  IF p ? 'maxObservationsPerDay' AND jsonb_typeof(p->'maxObservationsPerDay') NOT IN ('null','number') THEN RETURN false; END IF;
  IF jsonb_typeof(p->'maxObservationsPerDay') = 'number' AND ((p->>'maxObservationsPerDay')::numeric <= 0 OR (p->>'maxObservationsPerDay')::numeric <> trunc((p->>'maxObservationsPerDay')::numeric)) THEN RETURN false; END IF;
  IF coalesce(p->>'validFrom', '') !~ '^\d{4}-\d{2}-\d{2}$' THEN RETURN false; END IF;
  IF p ? 'validUntil' AND jsonb_typeof(p->'validUntil') <> 'null' AND (coalesce(p->>'validUntil', '') !~ '^\d{4}-\d{2}-\d{2}$' OR (p->>'validUntil')::date < (p->>'validFrom')::date) THEN RETURN false; END IF;
  IF p ? 'baseAuthorizationId' AND jsonb_typeof(p->'baseAuthorizationId') <> 'null' AND coalesce(p->>'baseAuthorizationId', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN false; END IF;
  RETURN true;
END $$;

-- NARROWING ONLY: approved ⊆ requested in every dimension; never wider, never longer, never higher.
CREATE FUNCTION public.owner_approval_is_narrowing(p_kind text, req jsonb, app jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE r_max numeric; a_max numeric; r_until date; a_until date;
BEGIN
  IF p_kind = 'OWNER_OBSERVATIONS' THEN
    RETURN NOT EXISTS (SELECT 1 FROM jsonb_array_elements(app->'items') a WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(req->'items') q WHERE q = a));
  END IF;
  IF app->>'purposeKind' IS DISTINCT FROM req->>'purposeKind' OR app->>'purposeHe' IS DISTINCT FROM req->>'purposeHe'
     OR app->'baseAuthorizationId' IS DISTINCT FROM req->'baseAuthorizationId' THEN RETURN false; END IF;
  IF NOT public.owner_approval_text_array(app->'resourceIds') <@ public.owner_approval_text_array(req->'resourceIds')
     OR NOT public.owner_approval_text_array(app->'entityKeys') <@ public.owner_approval_text_array(req->'entityKeys')
     OR NOT public.owner_approval_text_array(app->'observationFamilies') <@ public.owner_approval_text_array(req->'observationFamilies')
     OR NOT public.owner_approval_text_array(app->'sourceKinds') <@ public.owner_approval_text_array(req->'sourceKinds') THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(app->'newResources') a WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(req->'newResources') q WHERE q = a)) THEN RETURN false; END IF;
  IF (app->>'includeChildResources')::boolean AND NOT (req->>'includeChildResources')::boolean THEN RETURN false; END IF;
  IF (app->>'insightsAllowed')::boolean AND NOT (req->>'insightsAllowed')::boolean THEN RETURN false; END IF;
  IF (app->>'recommendationsAllowed')::boolean AND NOT (req->>'recommendationsAllowed')::boolean THEN RETURN false; END IF;
  r_max := CASE WHEN jsonb_typeof(req->'maxObservationsPerDay') = 'number' THEN (req->>'maxObservationsPerDay')::numeric END;
  a_max := CASE WHEN jsonb_typeof(app->'maxObservationsPerDay') = 'number' THEN (app->>'maxObservationsPerDay')::numeric END;
  IF r_max IS NOT NULL AND (a_max IS NULL OR a_max > r_max) THEN RETURN false; END IF;      -- a cap can only go down, never away
  IF (app->>'validFrom')::date < (req->>'validFrom')::date THEN RETURN false; END IF;
  r_until := CASE WHEN jsonb_typeof(req->'validUntil') = 'string' THEN (req->>'validUntil')::date END;
  a_until := CASE WHEN jsonb_typeof(app->'validUntil') = 'string' THEN (app->>'validUntil')::date END;
  IF r_until IS NOT NULL AND (a_until IS NULL OR a_until > r_until) THEN RETURN false; END IF;
  RETURN true;
END $$;

-- ───────────────────────────── RPCs ─────────────────────────────

-- RPC 1 — create a request (no effect). Sunny (service_role) or the Owner's UI (authenticated + Owner check).
CREATE FUNCTION public.owner_approval_request(p_kind text, p_payload jsonb, p_summary_he text, p_risk_he text, p_requested_client text,
  p_request_expires_at timestamptz, p_request_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_row public.owner_approval_requests; v_hash text; v_via text; v_id uuid; v_claims jsonb; r text;
BEGIN
  IF p_request_key IS NULL THEN RAISE EXCEPTION 'INVALID_REQUEST' USING ERRCODE = '22023'; END IF;
  v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  v_via := CASE WHEN v_claims->>'role' = 'authenticated' THEN 'OWNER_UI' ELSE 'SUNNY' END;
  IF v_via = 'OWNER_UI' THEN PERFORM public.owner_approval_assert_owner(); END IF;
  IF NOT public.owner_approval_payload_ok(p_kind, p_payload) THEN RAISE EXCEPTION 'INVALID_PAYLOAD' USING ERRCODE = '22023'; END IF;
  v_hash := public.owner_approval_hash(p_payload);
  SELECT * INTO v_row FROM public.owner_approval_requests WHERE request_key = p_request_key;
  IF FOUND THEN
    IF v_row.payload_hash <> v_hash OR v_row.kind <> p_kind THEN RAISE EXCEPTION 'REQUEST_KEY_REUSED' USING ERRCODE = '22023'; END IF;
    RETURN jsonb_build_object('requestId', v_row.id, 'replayed', true);
  END IF;
  IF p_kind = 'TRACKING_AUTHORIZATION' THEN
    FOR r IN SELECT jsonb_array_elements_text(p_payload->'resourceIds') LOOP
      IF NOT EXISTS (SELECT 1 FROM public.sunny_resources WHERE id = r::uuid) THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND: %', r USING ERRCODE = '22023'; END IF;
    END LOOP;
    IF jsonb_typeof(p_payload->'baseAuthorizationId') = 'string' AND NOT EXISTS (SELECT 1 FROM public.sunny_tracking_authorizations WHERE id = (p_payload->>'baseAuthorizationId')::uuid) THEN
      RAISE EXCEPTION 'BASE_NOT_FOUND' USING ERRCODE = '22023'; END IF;
  ELSE
    -- full Brain validation now, in a sub-transaction that is always rolled back (nothing is written by a request)
    BEGIN
      PERFORM public.sunny_record_observations_core(gen_random_uuid(), p_payload->'items', 'OWNER_APPROVAL', NULL, 'approval:' || gen_random_uuid()::text, gen_random_uuid());
      RAISE EXCEPTION 'VALIDATED_ONLY' USING ERRCODE = 'SV001';
    EXCEPTION WHEN SQLSTATE 'SV001' THEN NULL;
    END;
  END IF;
  INSERT INTO public.owner_approval_requests (kind, requested_payload, payload_hash, summary_he, risk_he, requested_via, requested_client, request_expires_at, request_key)
    VALUES (p_kind, p_payload, v_hash, btrim(p_summary_he), btrim(p_risk_he), v_via, NULLIF(p_requested_client, ''), p_request_expires_at, p_request_key)
    RETURNING id INTO v_id;
  RETURN jsonb_build_object('requestId', v_id, 'replayed', false);
END $$;

-- RPC 2 — the Owner decides (APPROVE as requested / APPROVE narrowed / REJECT). Owner session ONLY.
--   p_seen_hash = the payload hash the dashboard showed; p_approved = NULL → as requested, else a narrowed payload.
CREATE FUNCTION public.owner_approval_decide(p_request_id uuid, p_decision text, p_seen_hash text, p_approved jsonb, p_reason_he text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_uid uuid; v_req public.owner_approval_requests; v_app jsonb; v_base uuid;
  v_res_ids uuid[] := '{}'; v_new jsonb; v_res jsonb; v_out jsonb; v_result text; r text; i integer := 0;
BEGIN
  v_uid := public.owner_approval_assert_owner();
  IF p_decision NOT IN ('APPROVED','REJECTED') THEN RAISE EXCEPTION 'INVALID_DECISION' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_req FROM public.owner_approval_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'REQUEST_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF EXISTS (SELECT 1 FROM public.owner_approval_decisions WHERE request_id = p_request_id) THEN RAISE EXCEPTION 'ALREADY_DECIDED' USING ERRCODE = '22023'; END IF;
  IF v_req.request_expires_at IS NOT NULL AND now() > v_req.request_expires_at THEN RAISE EXCEPTION 'REQUEST_EXPIRED' USING ERRCODE = '22023'; END IF;
  IF p_seen_hash IS DISTINCT FROM v_req.payload_hash THEN RAISE EXCEPTION 'SEEN_HASH_MISMATCH: approve exactly what was shown' USING ERRCODE = '22023'; END IF;

  IF p_decision = 'REJECTED' THEN
    INSERT INTO public.owner_approval_decisions (request_id, decision, decided_by, decided_role, reason_he)
      VALUES (p_request_id, 'REJECTED', v_uid, 'authenticated', NULLIF(btrim(p_reason_he), ''));
    RETURN jsonb_build_object('decision', 'REJECTED');
  END IF;

  v_app := coalesce(p_approved, v_req.requested_payload);
  IF NOT public.owner_approval_payload_ok(v_req.kind, v_app) THEN RAISE EXCEPTION 'INVALID_APPROVED_PAYLOAD' USING ERRCODE = '22023'; END IF;
  IF NOT public.owner_approval_is_narrowing(v_req.kind, v_req.requested_payload, v_app) THEN RAISE EXCEPTION 'NOT_NARROWING: an approval may only narrow the request' USING ERRCODE = '22023'; END IF;

  IF v_req.kind = 'OWNER_OBSERVATIONS' THEN
    v_out := public.sunny_record_observations_core(p_request_id, v_app->'items', 'OWNER_APPROVAL', NULL, 'approval:' || p_request_id::text,
               md5('owner-approval-observations|' || p_request_id::text)::uuid);
    v_result := 'observations:' || p_request_id::text;     -- batch_id = the request id
  ELSE
    v_base := CASE WHEN jsonb_typeof(v_app->'baseAuthorizationId') = 'string' THEN (v_app->>'baseAuthorizationId')::uuid END;
    IF v_base IS NOT NULL AND EXISTS (SELECT 1 FROM public.sunny_tracking_authorizations WHERE supersedes_id = v_base) THEN
      RAISE EXCEPTION 'STALE_BASE: the authorization changed since the request' USING ERRCODE = '40001'; END IF;
    FOR r IN SELECT jsonb_array_elements_text(v_app->'resourceIds') LOOP
      IF NOT EXISTS (SELECT 1 FROM public.sunny_resources WHERE id = r::uuid) OR EXISTS (SELECT 1 FROM public.sunny_brain_events WHERE resource_id = r::uuid) THEN
        RAISE EXCEPTION 'RESOURCE_NOT_ACTIVE: %', r USING ERRCODE = '22023'; END IF;
      v_res_ids := v_res_ids || r::uuid;
    END LOOP;
    FOR v_new IN SELECT * FROM jsonb_array_elements(v_app->'newResources') LOOP
      v_res := public.sunny_register_resource_core(v_new->>'platform', v_new->>'resourceKind', NULL, NULL, v_new->>'identityKey', v_new->>'firstHandle',
        v_new->>'canonicalUrl', v_new->>'displayName', v_new->>'externalActor', 'OWNER_APPROVAL', NULL, 'approval:' || p_request_id::text,
        md5('owner-approval-resource|' || p_request_id::text || '|' || (v_new->>'platform') || '|' || (v_new->>'identityKey'))::uuid);
      v_res_ids := v_res_ids || (v_res->>'resourceId')::uuid;
      i := i + 1;
    END LOOP;
    v_out := public.sunny_grant_tracking_authorization(
      v_app->>'purposeKind', v_app->>'purposeHe', v_res_ids, (v_app->>'includeChildResources')::boolean,
      public.owner_approval_text_array(v_app->'entityKeys'), public.owner_approval_text_array(v_app->'observationFamilies'),
      public.owner_approval_text_array(v_app->'sourceKinds'), (v_app->>'insightsAllowed')::boolean, (v_app->>'recommendationsAllowed')::boolean,
      CASE WHEN jsonb_typeof(v_app->'maxObservationsPerDay') = 'number' THEN (v_app->>'maxObservationsPerDay')::integer END,
      (v_app->>'validFrom')::date,
      CASE WHEN jsonb_typeof(v_app->'validUntil') = 'string' THEN (v_app->>'validUntil')::date END,
      v_base, 'approval:' || p_request_id::text, md5('owner-approval-grant|' || p_request_id::text)::uuid);
    v_result := 'authorization:' || (v_out->>'authorizationId');
  END IF;

  INSERT INTO public.owner_approval_decisions (request_id, decision, approved_payload, approved_payload_hash, narrowed, decided_by, decided_role, reason_he, result_ref)
    VALUES (p_request_id, 'APPROVED', v_app, public.owner_approval_hash(v_app), v_app IS DISTINCT FROM v_req.requested_payload, v_uid, 'authenticated',
            NULLIF(btrim(p_reason_he), ''), v_result);
  RETURN jsonb_build_object('decision', 'APPROVED', 'result', v_result, 'narrowed', v_app IS DISTINCT FROM v_req.requested_payload, 'newResources', i);
END $$;

-- RPC 3 — Sunny withdraws her own pending request (service_role). Cancelling grants nothing.
CREATE FUNCTION public.owner_approval_cancel(p_request_id uuid, p_reason_he text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM 1 FROM public.owner_approval_requests WHERE id = p_request_id AND requested_via = 'SUNNY' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'REQUEST_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF EXISTS (SELECT 1 FROM public.owner_approval_decisions WHERE request_id = p_request_id) THEN RETURN jsonb_build_object('status', 'ALREADY_DECIDED'); END IF;
  INSERT INTO public.owner_approval_decisions (request_id, decision, decided_role, reason_he)
    VALUES (p_request_id, 'CANCELLED', 'service_role', NULLIF(btrim(p_reason_he), ''));
  RETURN jsonb_build_object('status', 'CANCELLED');
END $$;

-- RPC 4 — the Owner revokes an authorization (REVOKED; a new version instead = an approved request with
-- baseAuthorizationId → SUPERSEDED). Owner session ONLY.
CREATE FUNCTION public.owner_revoke_tracking_authorization(p_authorization_id uuid, p_reason_he text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_uid uuid; v_reason text := NULLIF(btrim(p_reason_he), '');
BEGIN
  v_uid := public.owner_approval_assert_owner();
  IF v_reason IS NULL THEN RAISE EXCEPTION 'REASON_REQUIRED' USING ERRCODE = '22023'; END IF;
  PERFORM 1 FROM public.sunny_tracking_authorizations WHERE id = p_authorization_id FOR UPDATE;   -- serializes with autonomous writes (FOR SHARE)
  IF NOT FOUND THEN RAISE EXCEPTION 'AUTHORIZATION_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF EXISTS (SELECT 1 FROM public.sunny_brain_events WHERE authorization_id = p_authorization_id) THEN RETURN jsonb_build_object('status', 'ALREADY_ENDED'); END IF;
  INSERT INTO public.sunny_brain_events (authorization_id, from_status, to_status, reason_he, actor, approval_basis, approval_ref, request_key)
    VALUES (p_authorization_id, 'ACTIVE', 'REVOKED', v_reason, 'OWNER', 'OWNER_APPROVAL', 'session:' || v_uid::text, gen_random_uuid());
  RETURN jsonb_build_object('status', 'REVOKED');
END $$;

-- RPC 5 — the Owner's own Brain lifecycle moves (the ONLY path to ENDORSED / REJECTED / ACCEPTED, to the Owner's
-- STALE / INVALIDATED of a record, invalidating an Owner-given observation, retiring an Owner-registered resource,
-- retracting a link). Owner session ONLY; the event carries approval_ref session:<uid>.
CREATE FUNCTION public.owner_brain_transition(p_target_kind text, p_target_id uuid, p_to_status text, p_reason_he text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_uid uuid;
BEGIN
  v_uid := public.owner_approval_assert_owner();
  RETURN public.sunny_brain_transition_core(p_target_kind, p_target_id, p_to_status, p_reason_he, 'OWNER', NULL, 'session:' || v_uid::text, gen_random_uuid());
END $$;

-- ───────────────────────────── RLS + grants ─────────────────────────────
ALTER TABLE public.owner_approval_principals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.owner_approval_requests   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.owner_approval_decisions  ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.owner_approval_principals, public.owner_approval_requests, public.owner_approval_decisions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.owner_approval_requests, public.owner_approval_decisions TO service_role;   -- Sunny / dashboard read status
REVOKE ALL ON SEQUENCE public.owner_approval_requests_seq_seq, public.owner_approval_decisions_seq_seq FROM PUBLIC, anon, authenticated, service_role;
DO $$
DECLARE f regprocedure;
BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
            AND (p.proname LIKE 'owner\_approval\_%' OR p.proname IN ('owner_revoke_tracking_authorization','owner_brain_transition')) LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.owner_approval_request(text, jsonb, text, text, text, timestamptz, uuid) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.owner_approval_cancel(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.owner_approval_decide(uuid, text, text, jsonb, text) TO authenticated;            -- NOT service_role
GRANT EXECUTE ON FUNCTION public.owner_revoke_tracking_authorization(uuid, text) TO authenticated;                  -- NOT service_role
GRANT EXECUTE ON FUNCTION public.owner_brain_transition(text, uuid, text, text) TO authenticated;                   -- NOT service_role

-- ───────────────────────────── POSTCONDITIONS ─────────────────────────────
DO $$
DECLARE t text; n integer; f record; v_callers text[]; v_expected text[];
BEGIN
  FOREACH t IN ARRAY ARRAY['owner_approval_principals','owner_approval_requests','owner_approval_decisions'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || t)::regclass) THEN RAISE EXCEPTION 'POSTCONDITION: RLS off on %', t; END IF;
    IF has_table_privilege('service_role', 'public.' || t, 'INSERT') OR has_table_privilege('service_role', 'public.' || t, 'UPDATE') OR has_table_privilege('service_role', 'public.' || t, 'DELETE')
       OR has_table_privilege('authenticated', 'public.' || t, 'SELECT') OR has_table_privilege('authenticated', 'public.' || t, 'INSERT')
       OR has_table_privilege('anon', 'public.' || t, 'SELECT') OR has_table_privilege('anon', 'public.' || t, 'INSERT') THEN RAISE EXCEPTION 'POSTCONDITION: privileges on %', t; END IF;
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t) THEN RAISE EXCEPTION 'POSTCONDITION: policy on %', t; END IF;
    SELECT count(*) INTO n FROM pg_trigger WHERE tgrelid = ('public.' || t)::regclass AND NOT tgisinternal AND tgenabled = 'O';
    IF n <> 2 THEN RAISE EXCEPTION 'POSTCONDITION: % enabled triggers on %', n, t; END IF;
  END LOOP;
  IF has_table_privilege('service_role', 'public.owner_approval_principals', 'SELECT') THEN RAISE EXCEPTION 'POSTCONDITION: principals readable by service_role'; END IF;
  -- exact EXECUTE matrix of every T2 function
  FOR f IN SELECT p.oid, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
            AND (p.proname LIKE 'owner\_approval\_%' OR p.proname IN ('owner_revoke_tracking_authorization','owner_brain_transition')) LOOP
    IF has_function_privilege('anon', f.oid, 'EXECUTE') THEN RAISE EXCEPTION 'POSTCONDITION: anon executes %', f.proname; END IF;
    IF has_function_privilege('service_role', f.oid, 'EXECUTE') <> (f.proname IN ('owner_approval_request','owner_approval_cancel')) THEN
      RAISE EXCEPTION 'POSTCONDITION: service_role EXECUTE on % is wrong', f.proname; END IF;
    IF has_function_privilege('authenticated', f.oid, 'EXECUTE') <> (f.proname IN ('owner_approval_request','owner_approval_decide','owner_revoke_tracking_authorization','owner_brain_transition')) THEN
      RAISE EXCEPTION 'POSTCONDITION: authenticated EXECUTE on % is wrong', f.proname; END IF;
  END LOOP;
  -- the Brain cores still have no API grant
  IF has_function_privilege('service_role', 'public.sunny_grant_tracking_authorization(text, text, uuid[], boolean, text[], text[], text[], boolean, boolean, integer, date, date, uuid, text, uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.sunny_grant_tracking_authorization(text, text, uuid[], boolean, text[], text[], text[], boolean, boolean, integer, date, date, uuid, text, uuid)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.sunny_record_observations_core(uuid, jsonb, text, uuid, text, uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.sunny_brain_transition_core(text, uuid, text, text, text, uuid, text, uuid)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.sunny_brain_transition_core(text, uuid, text, text, text, uuid, text, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'POSTCONDITION: a Brain core became executable'; END IF;
  -- CALLER PINNING (Brain + T2): every path that can produce an OWNER / OWNER_STATEMENT row is a listed body
  FOR f IN SELECT * FROM (VALUES
      ('sunny_grant_tracking_authorization', ARRAY['owner_approval_decide']),
      ('sunny_register_resource_core', ARRAY['owner_approval_decide','sunny_register_content']),
      ('sunny_record_observations_core', ARRAY['owner_approval_decide','owner_approval_request','sunny_record_observations']),
      ('sunny_brain_transition_core', ARRAY['owner_brain_transition','sunny_brain_transition']),
      ('sunny_brain_insert_links', ARRAY['sunny_add_links','sunny_create_intel_record']),
      ('owner_approval_assert_owner', ARRAY['owner_approval_decide','owner_approval_request','owner_brain_transition','owner_revoke_tracking_authorization'])) AS x(core, expected) LOOP
    SELECT coalesce(array_agg(p.proname::text ORDER BY p.proname), '{}') INTO v_callers FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname <> f.core AND p.prosrc ~ ('\m' || f.core || '\M');
    SELECT coalesce(array_agg(e ORDER BY e), '{}') INTO v_expected FROM unnest(f.expected) e;
    IF v_callers IS DISTINCT FROM v_expected THEN RAISE EXCEPTION 'POSTCONDITION: callers of % are % (expected %)', f.core, v_callers, v_expected; END IF;
  END LOOP;
  SELECT coalesce(array_agg(p.proname::text ORDER BY p.proname), '{}') INTO v_callers FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prosrc ~* 'insert\s+into\s+public\.sunny_brain_events';
  IF v_callers IS DISTINCT FROM ARRAY['owner_revoke_tracking_authorization','sunny_brain_transition_core','sunny_create_intel_record','sunny_grant_tracking_authorization'] THEN
    RAISE EXCEPTION 'POSTCONDITION: event-log writers are %', v_callers; END IF;
  IF (SELECT count(*) FROM public.owner_approval_principals) <> 0 THEN RAISE EXCEPTION 'POSTCONDITION: principals must be seeded by the separate file'; END IF;
END $$;

COMMIT;
