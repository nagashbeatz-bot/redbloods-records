-- ROLLBACK of T2 + MCP OWNER DECIDE.  CANDIDATE. Restores owner_approval_decide to the exact verified body (md5 c0a7f209ed4a7651b2220697a3c31979),
-- drops the core + the chat path and restores the two decisions CHECKs. Refused while any decision was made through the chat
-- path (decided_role = 'mcp_owner_token') — history is never rewritten.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $$
BEGIN
  IF to_regprocedure('public.owner_approval_decide_mcp(text, uuid, text, text, text)') IS NULL OR to_regprocedure('public.owner_approval_decide_core(uuid, text, uuid, text, text, jsonb, text)') IS NULL THEN
    RAISE EXCEPTION 'PRECONDITION: the MCP decide migration is not applied'; END IF;
  IF EXISTS (SELECT 1 FROM public.owner_approval_decisions WHERE decided_role = 'mcp_owner_token') THEN
    RAISE EXCEPTION 'PRECONDITION: chat decisions exist — rollback would invalidate history (refused)'; END IF;
END $$;
DROP FUNCTION public.owner_approval_decide_mcp(text, uuid, text, text, text);
DROP FUNCTION public.owner_approval_decide(uuid, text, text, jsonb, text);
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


REVOKE ALL ON FUNCTION public.owner_approval_decide(uuid, text, text, jsonb, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.owner_approval_decide(uuid, text, text, jsonb, text) TO authenticated;
DROP FUNCTION public.owner_approval_decide_core(uuid, text, uuid, text, text, jsonb, text);
ALTER TABLE public.owner_approval_decisions DROP CONSTRAINT owner_approval_decisions_who,
  ADD CONSTRAINT owner_approval_decisions_who CHECK (
    (decision IN ('APPROVED','REJECTED') AND decided_role = 'authenticated' AND decided_by IS NOT NULL)
    OR (decision = 'CANCELLED' AND decided_role = 'service_role' AND decided_by IS NULL));
ALTER TABLE public.owner_approval_decisions DROP CONSTRAINT owner_approval_decisions_decided_role_check,
  ADD CONSTRAINT owner_approval_decisions_decided_role_check CHECK (decided_role IN ('authenticated','service_role'));
DO $$
DECLARE f record; v_callers text[]; v_expected text[];
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.owner_approval_decide(uuid, text, text, jsonb, text)'::regprocedure) <> 'c0a7f209ed4a7651b2220697a3c31979' THEN RAISE EXCEPTION 'POSTCONDITION: decide body not restored'; END IF;
  IF has_function_privilege('service_role', 'public.owner_approval_decide(uuid, text, text, jsonb, text)', 'EXECUTE') OR NOT has_function_privilege('authenticated', 'public.owner_approval_decide(uuid, text, text, jsonb, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'POSTCONDITION: decide grants'; END IF;
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
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.owner_approval_decisions'::regclass AND conname = 'owner_approval_decisions_who') <> $d$CHECK ((((decision = ANY (ARRAY['APPROVED'::text, 'REJECTED'::text])) AND (decided_role = 'authenticated'::text) AND (decided_by IS NOT NULL)) OR ((decision = 'CANCELLED'::text) AND (decided_role = 'service_role'::text) AND (decided_by IS NULL))))$d$
     OR (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.owner_approval_decisions'::regclass AND conname = 'owner_approval_decisions_decided_role_check') <> $d$CHECK ((decided_role = ANY (ARRAY['authenticated'::text, 'service_role'::text])))$d$ THEN
    RAISE EXCEPTION 'POSTCONDITION: decisions CHECKs not restored'; END IF;
END $$;
COMMIT;
