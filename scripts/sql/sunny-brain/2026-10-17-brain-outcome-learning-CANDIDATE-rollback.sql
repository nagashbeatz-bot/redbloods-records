-- Sunny Brain v1.1 OUTCOME candidate — ROLLBACK (restores the exact v1 functions, CHECK and drops the index).
-- Refuses while any OUTCOME record or RESULT_OF / PRODUCED_LEARNING link exists (stored learning evidence is never dropped
-- silently — keeping or archiving it is a separate Owner decision).
BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.sunny_intel_records WHERE record_type = 'OUTCOME') THEN RAISE EXCEPTION 'ROLLBACK REFUSED: OUTCOME records exist'; END IF;
  IF EXISTS (SELECT 1 FROM public.sunny_brain_links WHERE role IN ('RESULT_OF','PRODUCED_LEARNING')) THEN RAISE EXCEPTION 'ROLLBACK REFUSED: outcome links exist'; END IF;
END $$;
DROP INDEX IF EXISTS public.sunny_links_one_result_of_uk;
ALTER TABLE public.sunny_brain_links DROP CONSTRAINT IF EXISTS sunny_links_v11_roles;
ALTER TABLE public.sunny_brain_links ADD CONSTRAINT sunny_links_v1_roles CHECK (role NOT IN ('TESTS','RESULT_OF','PRODUCED_LEARNING'));

CREATE OR REPLACE FUNCTION public.sunny_intel_body_ok(p_type text, p_body jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE allowed text[]; required text[]; r record;
BEGIN
  IF p_body IS NULL OR jsonb_typeof(p_body) <> 'object' OR octet_length(p_body::text) > 4096 THEN RETURN false; END IF;
  CASE p_type
    WHEN 'INSIGHT'        THEN allowed := ARRAY['statementHe','insightKind','reasoningHe','causalStatus','counterEvidenceHe','periodFrom','periodTo'];
                               required := ARRAY['statementHe','insightKind','causalStatus'];
    WHEN 'RECOMMENDATION' THEN allowed := ARRAY['recommendationHe','presentedHe','whyHe','expectedEffectHe','effort','urgency'];
                               required := ARRAY['recommendationHe','presentedHe'];
    ELSE RETURN false;   -- OUTCOME / EXPERIMENT: reserved until v1.1
  END CASE;
  IF EXISTS (SELECT 1 FROM unnest(required) q WHERE NOT p_body ? q) THEN RETURN false; END IF;
  FOR r IN SELECT key, value FROM jsonb_each(p_body) LOOP
    IF NOT (r.key = ANY (allowed)) THEN RETURN false; END IF;
    IF jsonb_typeof(r.value) = 'string' THEN
      IF char_length(r.value #>> '{}') NOT BETWEEN 1 AND 600 THEN RETURN false; END IF;
    ELSIF jsonb_typeof(r.value) = 'array' THEN
      IF jsonb_array_length(r.value) > 12 OR EXISTS (SELECT 1 FROM jsonb_array_elements(r.value) e
           WHERE jsonb_typeof(e) <> 'string' OR char_length(e #>> '{}') NOT BETWEEN 1 AND 200) THEN RETURN false; END IF;
    ELSIF jsonb_typeof(r.value) <> 'number' THEN RETURN false;
    END IF;
  END LOOP;
  IF p_type = 'INSIGHT' AND (p_body->>'insightKind' NOT IN ('EXPLANATION','GAP','PATTERN','ANOMALY','RISK','OPPORTUNITY','COMPARISON','TREND')
                             OR p_body->>'causalStatus' NOT IN ('CORRELATION_ONLY','PLAUSIBLE_CAUSE','TESTED')) THEN RETURN false; END IF;
  IF p_type = 'RECOMMENDATION' AND p_body ? 'effort' AND p_body->>'effort' NOT IN ('LOW','MEDIUM','HIGH') THEN RETURN false; END IF;
  IF p_type = 'RECOMMENDATION' AND p_body ? 'urgency' AND p_body->>'urgency' NOT IN ('NOW','SOON','LATER') THEN RETURN false; END IF;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.sunny_intel_transition_ok(p_type text, p_from text, p_to text, p_actor text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT (p_type, coalesce(p_from, '∅'), p_to, p_actor) IN (
    ('INSIGHT','∅','OPEN','SUNNY'),
    ('INSIGHT','OPEN','WITHDRAWN','SUNNY'), ('INSIGHT','OPEN','INVALIDATED','SUNNY'), ('INSIGHT','OPEN','SUPERSEDED','SUNNY'),
    ('INSIGHT','OPEN','ENDORSED','OWNER'), ('INSIGHT','OPEN','REJECTED','OWNER'), ('INSIGHT','OPEN','INVALIDATED','OWNER'),
    ('INSIGHT','ENDORSED','REJECTED','OWNER'), ('INSIGHT','ENDORSED','INVALIDATED','OWNER'),
    ('RECOMMENDATION','∅','OPEN','SUNNY'),
    ('RECOMMENDATION','OPEN','STALE','SUNNY'), ('RECOMMENDATION','OPEN','ACTED_ON','SUNNY'), ('RECOMMENDATION','OPEN','WITHDRAWN','SUNNY'),
    ('RECOMMENDATION','OPEN','INVALIDATED','SUNNY'), ('RECOMMENDATION','OPEN','SUPERSEDED','SUNNY'), ('RECOMMENDATION','ACCEPTED','ACTED_ON','SUNNY'),
    ('RECOMMENDATION','OPEN','ACCEPTED','OWNER'), ('RECOMMENDATION','OPEN','REJECTED','OWNER'),
    ('RECOMMENDATION','ACCEPTED','REJECTED','OWNER'), ('RECOMMENDATION','ACCEPTED','STALE','OWNER'))
    -- v1.1: OUTCOME / EXPERIMENT tuples are added by CREATE OR REPLACE of this function
$$;

CREATE OR REPLACE FUNCTION public.sunny_brain_insert_links(p_links jsonb, p_auth public.sunny_tracking_authorizations, p_request_key uuid, p_offset integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  l jsonb; i integer := 0; v_role text; fr uuid; fo uuid; fref text; tr uuid; tres uuid; tref text; ft text; tt text; ok boolean;
BEGIN
  IF p_links IS NULL OR jsonb_typeof(p_links) <> 'array' THEN RETURN 0; END IF;
  IF jsonb_array_length(p_links) + p_offset > 40 THEN RAISE EXCEPTION 'TOO_MANY_LINKS' USING ERRCODE = '22023'; END IF;
  FOR l IN SELECT * FROM jsonb_array_elements(p_links) LOOP
    v_role := l->>'role'; ft := NULL; tt := NULL;
    fr := NULLIF(l->>'fromRecord', '')::uuid; fo := NULLIF(l->>'fromObs', '')::uuid; fref := NULLIF(l->>'fromRef', '');
    tr := NULLIF(l->>'toRecord', '')::uuid; tres := NULLIF(l->>'toResource', '')::uuid; tref := NULLIF(l->>'toRef', '');
    IF coalesce(tref, '') ~ '^(knowledge|inbox|context):' THEN RAISE EXCEPTION 'LINK_TO_OWNER_MEMORY_RESERVED: no link may end at Owner knowledge in v1' USING ERRCODE = '42501'; END IF;
    IF fr IS NOT NULL THEN SELECT record_type INTO ft FROM public.sunny_intel_records WHERE id = fr;
      IF ft IS NULL THEN RAISE EXCEPTION 'RECORD_NOT_FOUND: %', fr USING ERRCODE = '22023'; END IF;
      IF NOT public.sunny_auth_covers_record(p_auth, fr) THEN RAISE EXCEPTION 'OUTSIDE_AUTHORIZATION_SUBJECT: record %', fr USING ERRCODE = '22023'; END IF;
    END IF;
    IF tr IS NOT NULL THEN SELECT record_type INTO tt FROM public.sunny_intel_records WHERE id = tr;
      IF tt IS NULL THEN RAISE EXCEPTION 'RECORD_NOT_FOUND: %', tr USING ERRCODE = '22023'; END IF;
      IF NOT public.sunny_auth_covers_record(p_auth, tr) THEN RAISE EXCEPTION 'OUTSIDE_AUTHORIZATION_SUBJECT: record %', tr USING ERRCODE = '22023'; END IF;
    END IF;
    IF fo IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM public.sunny_observations WHERE id = fo) THEN RAISE EXCEPTION 'OBSERVATION_NOT_FOUND: %', fo USING ERRCODE = '22023'; END IF;
      IF NOT public.sunny_auth_covers_observation(p_auth, fo) THEN RAISE EXCEPTION 'OUTSIDE_AUTHORIZATION_SUBJECT: observation %', fo USING ERRCODE = '22023'; END IF;
    END IF;
    IF tres IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM public.sunny_resources WHERE id = tres) THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND: %', tres USING ERRCODE = '22023'; END IF;
      IF NOT public.sunny_auth_covers_resource(p_auth, tres) THEN RAISE EXCEPTION 'OUTSIDE_AUTHORIZATION_SUBJECT: resource %', tres USING ERRCODE = '22023'; END IF;
    END IF;
    IF (fref IS NOT NULL AND NOT public.sunny_brain_ref_ok(fref)) OR (tref IS NOT NULL AND NOT public.sunny_brain_ref_ok(tref)) THEN RAISE EXCEPTION 'REF_NOT_FOUND' USING ERRCODE = '22023'; END IF;
    IF fref IS NOT NULL AND fref ~ '^plan:' THEN RAISE EXCEPTION 'LINK_NOT_ALLOWED: a plan is never evidence' USING ERRCODE = '22023'; END IF;
    ok := CASE v_role
      WHEN 'EVIDENCE_FOR'      THEN tt IN ('INSIGHT','RECOMMENDATION')
      WHEN 'EVIDENCE_AGAINST'  THEN tt IN ('INSIGHT','RECOMMENDATION')
      WHEN 'DERIVED_FROM'      THEN ft = 'INSIGHT' AND tt = 'INSIGHT'
      WHEN 'COMPARES_TO'       THEN ft = 'INSIGHT' AND (tres IS NOT NULL OR (tref IS NOT NULL AND public.sunny_brain_entity_ok(tref) AND tref = ANY (p_auth.entity_keys)))
      WHEN 'RECOMMENDS'        THEN ft = 'INSIGHT' AND tt = 'RECOMMENDATION'
      WHEN 'IMPLEMENTED_BY'    THEN ft = 'RECOMMENDATION' AND tref ~ '^plan:'
      ELSE false END;
    IF NOT coalesce(ok, false) THEN RAISE EXCEPTION 'LINK_NOT_ALLOWED: % (% → %)', v_role, coalesce(ft, CASE WHEN fo IS NOT NULL THEN 'OBSERVATION' ELSE 'REF' END), coalesce(tt, CASE WHEN tres IS NOT NULL THEN 'RESOURCE' ELSE 'REF' END) USING ERRCODE = '22023'; END IF;
    INSERT INTO public.sunny_brain_links (role, from_record_id, from_observation_id, from_ref, to_record_id, to_resource_id, to_ref, note_he, approval_basis, authorization_id, request_key, item_index)
      VALUES (v_role, fr, fo, fref, tr, tres, tref, NULLIF(btrim(l->>'noteHe'), ''), 'TRACKING_AUTHORIZATION', p_auth.id, p_request_key, p_offset + i);
    i := i + 1;
  END LOOP;
  RETURN i;
END $$;

CREATE OR REPLACE FUNCTION public.sunny_create_intel_record(
  p_record_type text, p_entity_keys text[], p_resource_ids uuid[], p_topic text, p_area text, p_title_he text, p_body jsonb,
  p_source_type text, p_confidence text, p_review_at date, p_supersedes_id uuid, p_supersede_reason text,
  p_links jsonb, p_authorization_id uuid, p_request_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_hash text; v_row public.sunny_intel_records; v_auth public.sunny_tracking_authorizations; v_old public.sunny_intel_records; v_old_status text;
  v_id uuid; v_n integer; k text; r uuid; v_links jsonb; v_ref text;
BEGIN
  IF p_request_key IS NULL OR p_record_type IS NULL THEN RAISE EXCEPTION 'INVALID_REQUEST' USING ERRCODE = '22023'; END IF;
  v_hash := encode(sha256(convert_to(jsonb_build_object('t', p_record_type, 'e', to_jsonb(p_entity_keys), 'r', to_jsonb(p_resource_ids), 'topic', p_topic,
    'area', p_area, 'title', p_title_he, 'body', p_body, 'src', p_source_type, 'conf', p_confidence, 'reviewAt', p_review_at,
    'sup', p_supersedes_id, 'supr', p_supersede_reason, 'links', p_links, 'auth', p_authorization_id)::text, 'UTF8')), 'hex');
  SELECT * INTO v_row FROM public.sunny_intel_records WHERE request_key = p_request_key;
  IF FOUND THEN
    IF v_row.payload_hash <> v_hash THEN RAISE EXCEPTION 'REQUEST_KEY_REUSED' USING ERRCODE = '22023'; END IF;
    RETURN jsonb_build_object('recordId', v_row.id, 'replayed', true);
  END IF;
  IF p_record_type NOT IN ('INSIGHT','RECOMMENDATION') THEN RAISE EXCEPTION 'TYPE_RESERVED: %', p_record_type USING ERRCODE = '22023'; END IF;
  v_auth := public.sunny_auth_active(p_authorization_id);
  v_ref := 'authorization:' || v_auth.id::text;
  IF p_record_type = 'INSIGHT' AND NOT v_auth.insights_allowed THEN RAISE EXCEPTION 'INSIGHTS_NOT_AUTHORIZED' USING ERRCODE = '22023'; END IF;
  IF p_record_type = 'RECOMMENDATION' AND NOT v_auth.recommendations_allowed THEN RAISE EXCEPTION 'RECOMMENDATIONS_NOT_AUTHORIZED' USING ERRCODE = '22023'; END IF;
  FOREACH k IN ARRAY coalesce(p_entity_keys, '{}') LOOP
    IF NOT public.sunny_brain_entity_ok(k) THEN RAISE EXCEPTION 'ENTITY_NOT_FOUND: %', k USING ERRCODE = '22023'; END IF;
  END LOOP;
  FOREACH r IN ARRAY coalesce(p_resource_ids, '{}') LOOP
    IF NOT EXISTS (SELECT 1 FROM public.sunny_resources WHERE id = r) THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND: %', r USING ERRCODE = '22023'; END IF;
  END LOOP;
  IF NOT public.sunny_auth_covers_subjects(v_auth, p_entity_keys, p_resource_ids) THEN RAISE EXCEPTION 'OUTSIDE_AUTHORIZATION_SUBJECT' USING ERRCODE = '22023'; END IF;
  IF p_supersedes_id IS NOT NULL THEN
    SELECT * INTO v_old FROM public.sunny_intel_records WHERE id = p_supersedes_id FOR UPDATE;
    IF NOT FOUND OR v_old.record_type <> p_record_type THEN RAISE EXCEPTION 'SUPERSEDES_INVALID' USING ERRCODE = '22023'; END IF;
    SELECT status INTO v_old_status FROM public.sunny_intel_record_status WHERE record_id = v_old.id;
    IF NOT public.sunny_intel_transition_ok(p_record_type, v_old_status, 'SUPERSEDED', 'SUNNY') THEN RAISE EXCEPTION 'SUPERSEDES_NOT_ALLOWED: % (only an OPEN record; the Owner decides the rest)', v_old_status USING ERRCODE = '22023'; END IF;
    IF NOT public.sunny_auth_covers_subjects(v_auth, v_old.entity_keys, v_old.resource_ids) THEN RAISE EXCEPTION 'OUTSIDE_AUTHORIZATION_SUBJECT: superseded record' USING ERRCODE = '22023'; END IF;
  END IF;
  BEGIN
    INSERT INTO public.sunny_intel_records (record_type, entity_keys, resource_ids, topic, area, title_he, body, source_type, confidence, review_at,
        supersedes_id, approval_basis, authorization_id, approval_ref, request_key, payload_hash)
      VALUES (p_record_type, coalesce(p_entity_keys, '{}'), coalesce(p_resource_ids, '{}'), p_topic, p_area, btrim(p_title_he), p_body, p_source_type, p_confidence,
        p_review_at, p_supersedes_id, 'TRACKING_AUTHORIZATION', v_auth.id, v_ref, p_request_key, v_hash)
      RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'CONCURRENT_SUPERSEDE' USING ERRCODE = '40001';
  END;
  INSERT INTO public.sunny_brain_events (record_id, from_status, to_status, actor, approval_basis, approval_ref, request_key)
    VALUES (v_id, NULL, 'OPEN', 'SUNNY', 'TRACKING_AUTHORIZATION', v_ref, gen_random_uuid());
  IF p_supersedes_id IS NOT NULL THEN
    INSERT INTO public.sunny_brain_events (record_id, from_status, to_status, reason_he, actor, approval_basis, approval_ref, request_key)
      VALUES (p_supersedes_id, v_old_status, 'SUPERSEDED', coalesce(NULLIF(btrim(p_supersede_reason), ''), 'הוחלפה ברשומה חדשה'), 'SUNNY', 'TRACKING_AUTHORIZATION', v_ref, gen_random_uuid());
  END IF;
  v_links := replace(coalesce(p_links, '[]'::jsonb)::text, '"$self"', to_jsonb(v_id::text)::text)::jsonb;
  v_n := public.sunny_brain_insert_links(v_links, v_auth, p_request_key, 0);
  IF p_record_type = 'INSIGHT' AND NOT EXISTS (SELECT 1 FROM public.sunny_brain_links WHERE to_record_id = v_id AND role = 'EVIDENCE_FOR') THEN
    RAISE EXCEPTION 'INSIGHT_NEEDS_EVIDENCE' USING ERRCODE = '22023';
  END IF;
  IF p_record_type = 'RECOMMENDATION' AND NOT EXISTS (SELECT 1 FROM public.sunny_brain_links WHERE to_record_id = v_id AND role IN ('RECOMMENDS','EVIDENCE_FOR')) THEN
    RAISE EXCEPTION 'RECOMMENDATION_NEEDS_GROUNDING' USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object('recordId', v_id, 'links', v_n, 'replayed', false);
END $$;
COMMIT;
