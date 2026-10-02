-- DRY-RUN: identical to the file it mirrors, but ends in ROLLBACK (nothing is kept).
-- ============================================================================================
-- T2 + MCP OWNER DECIDE — approve / reject a pending Sunny request from the Claude chat.  CANDIDATE — NOT APPLIED.
-- Precondition: T2 (a59e3ccd…) + Owner seed + partner:observe scope applied exactly as verified.
--
-- WHY A DB CHANGE: the T2 decide proves the Owner from request.jwt.claims (his Supabase session). The connector never
-- holds the Owner's Supabase JWT — only its own service key — so without this the only "chat approval" would be the
-- service role claiming the Owner approved (forbidden). This adds ONE new proof the DATABASE checks itself: possession
-- of the Owner's LIVE connector access token.
--
-- WHAT CHANGES (nothing else):
--   1. owner_approval_decide_core(p_uid, p_role, …)  = the EXACT applied body of owner_approval_decide (md5 c0a7f209ed4a7651b2220697a3c31979)
--      with assert_owner() replaced by a caller-supplied uid and 'authenticated' by p_role. NO grant to anyone.
--   2. owner_approval_decide(…)      = assert_owner() → core(uid, 'authenticated', …). Same signature, same grants,
--                                       same behaviour for the dashboard (/sunny-approvals).
--   3. owner_approval_decide_mcp(p_token_hash, p_request_id, p_decision, p_seen_hash, p_reason_he)
--        · p_token_hash = sha256 hex of the bearer Claude presented (the connector computes it; the DB stores only
--          hashes, and the service role cannot read the token table → a hash cannot be invented or read back);
--        · public.partner_mcp_check_access(hash) must say VALID (live, not revoked / expired / client disabled);
--        · the token's scope must contain partner:observe;
--        · the token's user must be an Owner principal AND a live, non-anonymous, confirmed, not banned / deleted auth user;
--        · then core(uid, 'mcp_owner_token', …) with p_approved = NULL (APPROVED = exactly as requested; no narrowing
--          from chat); exact request id + exact payload hash + one decision per request + expiry are the core's rules.
--      EXECUTE: service_role only (the connector). It takes NO user id, actor, role or basis argument.
--   4. owner_approval_decisions: decided_role += 'mcp_owner_token' (APPROVED / REJECTED only, decided_by NOT NULL).
-- ============================================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
DECLARE c int;
BEGIN
  IF to_regprocedure('public.owner_approval_decide(uuid, text, text, jsonb, text)') IS NULL THEN RAISE EXCEPTION 'PRECONDITION: T2 owner_approval_decide missing'; END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.owner_approval_decide(uuid, text, text, jsonb, text)'::regprocedure) <> 'c0a7f209ed4a7651b2220697a3c31979' THEN
    RAISE EXCEPTION 'PRECONDITION: owner_approval_decide is not the verified T2 body'; END IF;
  IF to_regprocedure('public.owner_approval_decide_core(uuid, text, uuid, text, text, jsonb, text)') IS NOT NULL OR to_regprocedure('public.owner_approval_decide_mcp(text, uuid, text, text, text)') IS NOT NULL THEN
    RAISE EXCEPTION 'PRECONDITION: already applied'; END IF;
  IF to_regprocedure('public.partner_mcp_check_access(text)') IS NULL OR (SELECT prorettype FROM pg_proc WHERE oid = 'public.partner_mcp_check_access(text)'::regprocedure) <> 'jsonb'::regtype THEN
    RAISE EXCEPTION 'PRECONDITION: partner_mcp_check_access(text) RETURNS jsonb missing'; END IF;
  SELECT count(*) INTO c FROM pg_constraint WHERE conrelid = 'public.owner_approval_decisions'::regclass AND conname = 'owner_approval_decisions_decided_role_check' AND pg_get_constraintdef(oid) = $d$CHECK ((decided_role = ANY (ARRAY['authenticated'::text, 'service_role'::text])))$d$;
  IF c <> 1 THEN RAISE EXCEPTION 'PRECONDITION: decided_role CHECK differs'; END IF;
  SELECT count(*) INTO c FROM pg_constraint WHERE conrelid = 'public.owner_approval_decisions'::regclass AND conname = 'owner_approval_decisions_who' AND pg_get_constraintdef(oid) = $d$CHECK ((((decision = ANY (ARRAY['APPROVED'::text, 'REJECTED'::text])) AND (decided_role = 'authenticated'::text) AND (decided_by IS NOT NULL)) OR ((decision = 'CANCELLED'::text) AND (decided_role = 'service_role'::text) AND (decided_by IS NULL))))$d$;
  IF c <> 1 THEN RAISE EXCEPTION 'PRECONDITION: who CHECK differs'; END IF;
  IF (SELECT count(*) FROM public.owner_approval_principals) < 1 THEN RAISE EXCEPTION 'PRECONDITION: no Owner principal (seed first)'; END IF;
END $$;

-- 4. decisions may record the new proof
ALTER TABLE public.owner_approval_decisions DROP CONSTRAINT owner_approval_decisions_decided_role_check,
  ADD CONSTRAINT owner_approval_decisions_decided_role_check CHECK (decided_role IN ('authenticated','service_role','mcp_owner_token'));
ALTER TABLE public.owner_approval_decisions DROP CONSTRAINT owner_approval_decisions_who,
  ADD CONSTRAINT owner_approval_decisions_who CHECK (
    (decision IN ('APPROVED','REJECTED') AND decided_role IN ('authenticated','mcp_owner_token') AND decided_by IS NOT NULL)
    OR (decision = 'CANCELLED' AND decided_role = 'service_role' AND decided_by IS NULL));

-- 1. the shared core (the exact applied body; no grant)
CREATE FUNCTION public.owner_approval_decide_core(p_uid uuid, p_role text, p_request_id uuid, p_decision text, p_seen_hash text, p_approved jsonb, p_reason_he text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_uid uuid; v_req public.owner_approval_requests; v_app jsonb; v_base uuid;
  v_res_ids uuid[] := '{}'; v_new jsonb; v_res jsonb; v_out jsonb; v_result text; r text; i integer := 0;
BEGIN
  -- the caller ALREADY proved the Owner (owner_approval_decide: his session; owner_approval_decide_mcp: his live connector token)
  IF p_uid IS NULL OR p_role NOT IN ('authenticated','mcp_owner_token') THEN RAISE EXCEPTION 'INVALID_REQUEST' USING ERRCODE = '22023'; END IF;
  v_uid := p_uid;
  IF p_decision NOT IN ('APPROVED','REJECTED') THEN RAISE EXCEPTION 'INVALID_DECISION' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_req FROM public.owner_approval_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'REQUEST_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF EXISTS (SELECT 1 FROM public.owner_approval_decisions WHERE request_id = p_request_id) THEN RAISE EXCEPTION 'ALREADY_DECIDED' USING ERRCODE = '22023'; END IF;
  IF v_req.request_expires_at IS NOT NULL AND now() > v_req.request_expires_at THEN RAISE EXCEPTION 'REQUEST_EXPIRED' USING ERRCODE = '22023'; END IF;
  IF p_seen_hash IS DISTINCT FROM v_req.payload_hash THEN RAISE EXCEPTION 'SEEN_HASH_MISMATCH: approve exactly what was shown' USING ERRCODE = '22023'; END IF;

  IF p_decision = 'REJECTED' THEN
    INSERT INTO public.owner_approval_decisions (request_id, decision, decided_by, decided_role, reason_he)
      VALUES (p_request_id, 'REJECTED', v_uid, p_role, NULLIF(btrim(p_reason_he), ''));
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
    VALUES (p_request_id, 'APPROVED', v_app, public.owner_approval_hash(v_app), v_app IS DISTINCT FROM v_req.requested_payload, v_uid, p_role,
            NULLIF(btrim(p_reason_he), ''), v_result);
  RETURN jsonb_build_object('decision', 'APPROVED', 'result', v_result, 'narrowed', v_app IS DISTINCT FROM v_req.requested_payload, 'newResources', i);
END $$;



-- 2. the dashboard path, unchanged in behaviour
CREATE OR REPLACE FUNCTION public.owner_approval_decide(p_request_id uuid, p_decision text, p_seen_hash text, p_approved jsonb, p_reason_he text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  RETURN public.owner_approval_decide_core(public.owner_approval_assert_owner(), 'authenticated', p_request_id, p_decision, p_seen_hash, p_approved, p_reason_he);
END $$;

-- 3. the chat path: the DB proves the Owner from his live connector token
CREATE FUNCTION public.owner_approval_decide_mcp(p_token_hash text, p_request_id uuid, p_decision text, p_seen_hash text, p_reason_he text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v jsonb; v_uid uuid;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'OWNER_TOKEN_REQUIRED' USING ERRCODE = '42501'; END IF;
  v := public.partner_mcp_check_access(p_token_hash);
  IF v IS NULL OR v->>'result' IS DISTINCT FROM 'VALID' THEN RAISE EXCEPTION 'OWNER_TOKEN_INVALID' USING ERRCODE = '42501'; END IF;
  IF NOT ('partner:observe' = ANY (string_to_array(coalesce(v->>'scope', ''), ' '))) THEN RAISE EXCEPTION 'OWNER_TOKEN_SCOPE: partner:observe required' USING ERRCODE = '42501'; END IF;
  IF coalesce(v->>'user_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'OWNER_TOKEN_INVALID' USING ERRCODE = '42501'; END IF;
  v_uid := (v->>'user_id')::uuid;
  IF NOT EXISTS (SELECT 1 FROM public.owner_approval_principals WHERE user_id = v_uid)
     OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = v_uid AND NOT coalesce(u.is_anonymous, false) AND u.email_confirmed_at IS NOT NULL
                    AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until < now())) THEN
    RAISE EXCEPTION 'OWNER_SESSION_REQUIRED: this token does not belong to the Owner' USING ERRCODE = '42501'; END IF;
  RETURN public.owner_approval_decide_core(v_uid, 'mcp_owner_token', p_request_id, p_decision, p_seen_hash, NULL, p_reason_he);
END $$;

REVOKE ALL ON FUNCTION public.owner_approval_decide_core(uuid, text, uuid, text, text, jsonb, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.owner_approval_decide_mcp(text, uuid, text, text, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.owner_approval_decide_mcp(text, uuid, text, text, text) TO service_role;

DO $$
DECLARE f record; v_callers text[]; v_expected text[];
BEGIN
  IF has_function_privilege('service_role', 'public.owner_approval_decide(uuid, text, text, jsonb, text)', 'EXECUTE') OR NOT has_function_privilege('authenticated', 'public.owner_approval_decide(uuid, text, text, jsonb, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'POSTCONDITION: owner_approval_decide grants changed'; END IF;
  IF has_function_privilege('service_role', 'public.owner_approval_decide_core(uuid, text, uuid, text, text, jsonb, text)', 'EXECUTE') OR has_function_privilege('authenticated', 'public.owner_approval_decide_core(uuid, text, uuid, text, text, jsonb, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.owner_approval_decide_core(uuid, text, uuid, text, text, jsonb, text)', 'EXECUTE') THEN RAISE EXCEPTION 'POSTCONDITION: the core is executable'; END IF;
  IF NOT has_function_privilege('service_role', 'public.owner_approval_decide_mcp(text, uuid, text, text, text)', 'EXECUTE') OR has_function_privilege('authenticated', 'public.owner_approval_decide_mcp(text, uuid, text, text, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.owner_approval_decide_mcp(text, uuid, text, text, text)', 'EXECUTE') THEN RAISE EXCEPTION 'POSTCONDITION: decide_mcp grants wrong'; END IF;
  -- check function: 'partner:read' must not be granted beyond service; T2 tables untouched
  IF has_table_privilege('service_role', 'public.owner_approval_principals', 'SELECT') THEN RAISE EXCEPTION 'POSTCONDITION: principals readable by service_role'; END IF;
  IF has_table_privilege('service_role', 'public.owner_approval_decisions', 'INSERT') OR has_table_privilege('service_role', 'public.owner_approval_requests', 'INSERT') THEN RAISE EXCEPTION 'POSTCONDITION: T2 tables writable by service_role'; END IF;
  FOR f IN SELECT * FROM (VALUES
      ('sunny_grant_tracking_authorization', ARRAY['owner_approval_decide_core']),
      ('sunny_register_resource_core', ARRAY['owner_approval_decide_core','sunny_register_content']),
      ('sunny_record_observations_core', ARRAY['owner_approval_decide_core','owner_approval_request','sunny_record_observations']),
      ('sunny_brain_transition_core', ARRAY['owner_brain_transition','sunny_brain_transition']),
      ('sunny_brain_insert_links', ARRAY['sunny_add_links','sunny_create_intel_record']),
      ('owner_approval_assert_owner', ARRAY['owner_approval_decide','owner_approval_request','owner_brain_transition','owner_revoke_tracking_authorization']),
      ('owner_approval_decide_core', ARRAY['owner_approval_decide','owner_approval_decide_mcp']),
      ('partner_mcp_check_access', ARRAY['owner_approval_decide_mcp'])) AS x(core, expected) LOOP
    SELECT coalesce(array_agg(p.proname::text ORDER BY p.proname), '{}') INTO v_callers FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname <> f.core AND p.prosrc ~ ('\m' || f.core || '\M');
    SELECT coalesce(array_agg(e ORDER BY e), '{}') INTO v_expected FROM unnest(f.expected) e;
    IF v_callers IS DISTINCT FROM v_expected THEN RAISE EXCEPTION 'POSTCONDITION: callers of % are % (expected %)', f.core, v_callers, v_expected; END IF;
  END LOOP;
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.owner_approval_decisions'::regclass AND conname = 'owner_approval_decisions_who') <> $d$CHECK ((((decision = ANY (ARRAY['APPROVED'::text, 'REJECTED'::text])) AND (decided_role = ANY (ARRAY['authenticated'::text, 'mcp_owner_token'::text])) AND (decided_by IS NOT NULL)) OR ((decision = 'CANCELLED'::text) AND (decided_role = 'service_role'::text) AND (decided_by IS NULL))))$d$
     OR (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.owner_approval_decisions'::regclass AND conname = 'owner_approval_decisions_decided_role_check') <> $d$CHECK ((decided_role = ANY (ARRAY['authenticated'::text, 'service_role'::text, 'mcp_owner_token'::text])))$d$ THEN
    RAISE EXCEPTION 'POSTCONDITION: decisions CHECKs'; END IF;
END $$;
ROLLBACK;

