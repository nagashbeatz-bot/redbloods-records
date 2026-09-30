-- Owner Inbox MEMORY (Phase 1) — APPLIED in production 2026-10-01 after the Owner's approval and a clean read-only pre-DDL.
-- One transaction. Verified after: 2 tables (RLS, service_role SELECT only), 4 RPCs (EXECUTE service_role only), 3 guard triggers, 0 rows.
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.sunny_inbox_links') IS NOT NULL OR to_regclass('public.sunny_inbox_interpretations') IS NOT NULL THEN
    RAISE EXCEPTION 'PRECONDITION: inbox memory tables already exist';
  END IF;
  IF md5(pg_get_functiondef('public.sunny_owner_inbox_mark_processed(uuid,text,text,text)'::regprocedure)) <> '1f88114b2083b4fdc7730a6819dbcad6' THEN
    RAISE EXCEPTION 'PRECONDITION: mark_processed changed since the pre-DDL capture';
  END IF;
END $$;

ALTER TABLE public.sunny_owner_inbox DROP CONSTRAINT sunny_owner_inbox_outcome_check;
ALTER TABLE public.sunny_owner_inbox ADD CONSTRAINT sunny_owner_inbox_outcome_check
  CHECK (outcome IN ('LEARNED_KNOWLEDGE','ACTION_PLANNED','NO_ACTION_NEEDED','DISMISSED','MEMORY_RECORDED'));
ALTER TABLE public.sunny_owner_inbox ADD CONSTRAINT sunny_owner_inbox_memory_recorded_no_ref
  CHECK (outcome IS DISTINCT FROM 'MEMORY_RECORDED' OR outcome_ref IS NULL);

CREATE FUNCTION public.sunny_inbox_entity_exists(p_key text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE k text; v uuid;
BEGIN
  IF p_key IS NULL THEN RETURN false; END IF;
  IF p_key IN ('vendor:VICTOR','vendor:STEVEN') THEN RETURN true; END IF;
  IF p_key !~ '^(project|client|label-artist|dj|show|session|release):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN false; END IF;
  k := split_part(p_key, ':', 1);
  v := substr(p_key, char_length(k) + 2)::uuid;
  CASE k
    WHEN 'project'      THEN RETURN EXISTS (SELECT 1 FROM public.projects WHERE id = v);
    WHEN 'client'       THEN RETURN EXISTS (SELECT 1 FROM public.clients WHERE id = v);
    WHEN 'dj'           THEN RETURN EXISTS (SELECT 1 FROM public.clients WHERE id = v) AND EXISTS (SELECT 1 FROM public.shows WHERE dj_client_id = v);
    WHEN 'label-artist' THEN RETURN EXISTS (SELECT 1 FROM public.label_artists WHERE id = v);
    WHEN 'show'         THEN RETURN EXISTS (SELECT 1 FROM public.shows WHERE id = v);
    WHEN 'session'      THEN RETURN EXISTS (SELECT 1 FROM public.sessions WHERE id = v);
    WHEN 'release'      THEN RETURN EXISTS (SELECT 1 FROM public.project_release_details WHERE project_id = v);
    ELSE RETURN false;
  END CASE;
END $$;

CREATE FUNCTION public.sunny_inbox_text_list_ok(p text[], p_max_n integer, p_max_len integer) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT p IS NOT NULL AND coalesce(array_ndims(p), 1) = 1 AND cardinality(p) <= p_max_n
     AND NOT EXISTS (SELECT 1 FROM unnest(p) x WHERE x IS NULL OR x <> btrim(x) OR char_length(x) NOT BETWEEN 1 AND p_max_len)
$$;

CREATE TABLE public.sunny_inbox_links (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id          uuid NOT NULL REFERENCES public.sunny_owner_inbox(id) ON DELETE RESTRICT,
  entity_key       text NOT NULL CHECK (
    entity_key ~ '^(project|client|label-artist|dj|show|session|release):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR entity_key IN ('vendor:VICTOR','vendor:STEVEN')),
  quality          text NOT NULL CHECK (quality IN ('EXACT_UNIQUE','OWNER_CONFIRMED')),
  method           text NOT NULL CHECK (method IN ('RESOLVER_UNIQUE','OWNER_ANSWER')),
  surface          text NOT NULL CHECK (surface = btrim(surface) AND char_length(surface) BETWEEN 2 AND 80),
  candidates       text[] NULL,
  request_key      uuid NOT NULL UNIQUE,
  payload_hash     text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_via      text NOT NULL DEFAULT 'SUNNY' CHECK (created_via = 'SUNNY'),
  retracted_at     timestamptz NULL,
  retracted_reason text NULL CHECK (retracted_reason IS NULL OR char_length(retracted_reason) BETWEEN 1 AND 200),
  retracted_via    text NULL CHECK (retracted_via IS NULL OR retracted_via = 'SUNNY'),
  CONSTRAINT sunny_inbox_links_quality_method CHECK ((quality = 'OWNER_CONFIRMED') = (method = 'OWNER_ANSWER')),
  CONSTRAINT sunny_inbox_links_candidates CHECK (
    (method = 'RESOLVER_UNIQUE' AND candidates IS NULL)
    OR (method = 'OWNER_ANSWER' AND candidates IS NOT NULL AND cardinality(candidates) BETWEEN 2 AND 8 AND entity_key = ANY (candidates))),
  CONSTRAINT sunny_inbox_links_retract_consistency CHECK (
    (retracted_at IS NULL AND retracted_reason IS NULL AND retracted_via IS NULL)
    OR (retracted_at IS NOT NULL AND retracted_reason IS NOT NULL AND retracted_via IS NOT NULL))
);
CREATE UNIQUE INDEX sunny_inbox_links_active_uk ON public.sunny_inbox_links (item_id, entity_key) WHERE retracted_at IS NULL;
CREATE INDEX sunny_inbox_links_entity_idx ON public.sunny_inbox_links (entity_key) WHERE retracted_at IS NULL;

CREATE TABLE public.sunny_inbox_interpretations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq                bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  item_id            uuid NOT NULL REFERENCES public.sunny_owner_inbox(id) ON DELETE RESTRICT,
  link_id            uuid NOT NULL REFERENCES public.sunny_inbox_links(id) ON DELETE RESTRICT,
  entity_key         text NOT NULL CHECK (entity_key ~ '^project:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  what_happened      text NOT NULL CHECK (what_happened = btrim(what_happened) AND char_length(what_happened) BETWEEN 1 AND 300),
  completed          text[] NOT NULL DEFAULT '{}' CHECK (public.sunny_inbox_text_list_ok(completed, 5, 160)),
  open_gaps          text[] NOT NULL DEFAULT '{}' CHECK (public.sunny_inbox_text_list_ok(open_gaps, 5, 160)),
  blockers           text[] NOT NULL DEFAULT '{}' CHECK (public.sunny_inbox_text_list_ok(blockers, 5, 160)),
  ball_with          text NOT NULL DEFAULT 'UNKNOWN' CHECK (ball_with IN ('OWNER','TEAM','ENGINEER','VICTOR','ARTIST','CLIENT','UNKNOWN')),
  inferred_next_step text NULL CHECK (inferred_next_step IS NULL OR (inferred_next_step = btrim(inferred_next_step) AND char_length(inferred_next_step) BETWEEN 1 AND 200)),
  confidence         text NOT NULL CHECK (confidence IN ('LOW','MEDIUM','HIGH')),
  epistemic          text NOT NULL DEFAULT 'HYPOTHESIS' CHECK (epistemic = 'HYPOTHESIS'),
  source             text NOT NULL DEFAULT 'OWNER_REPORTED_DERIVED' CHECK (source = 'OWNER_REPORTED_DERIVED'),
  basis_status       text NULL CHECK (basis_status IS NULL OR char_length(basis_status) BETWEEN 1 AND 40),
  basis_ball         text NULL CHECK (basis_ball IS NULL OR basis_ball ~ '^[A-Z_]{1,60}$'),
  basis_event_at     timestamptz NULL,
  supersedes_id      uuid NULL REFERENCES public.sunny_inbox_interpretations(id) ON DELETE RESTRICT,
  supersede_kind     text NULL CHECK (supersede_kind IS NULL OR supersede_kind IN ('NEW_UPDATE','CORRECTION')),
  supersede_reason   text NULL CHECK (supersede_reason IS NULL OR char_length(supersede_reason) BETWEEN 1 AND 200),
  request_key        uuid NOT NULL UNIQUE,
  payload_hash       text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_via        text NOT NULL DEFAULT 'SUNNY' CHECK (created_via = 'SUNNY'),
  retracted_at       timestamptz NULL,
  retracted_reason   text NULL CHECK (retracted_reason IS NULL OR char_length(retracted_reason) BETWEEN 1 AND 200),
  retracted_via      text NULL CHECK (retracted_via IS NULL OR retracted_via = 'SUNNY'),
  CONSTRAINT sunny_inbox_interpretations_supersede_consistency CHECK (
    (supersedes_id IS NULL AND supersede_kind IS NULL AND supersede_reason IS NULL)
    OR (supersedes_id IS NOT NULL AND supersede_kind = 'NEW_UPDATE')
    OR (supersedes_id IS NOT NULL AND supersede_kind = 'CORRECTION' AND supersede_reason IS NOT NULL)),
  CONSTRAINT sunny_inbox_interpretations_retract_consistency CHECK (
    (retracted_at IS NULL AND retracted_reason IS NULL AND retracted_via IS NULL)
    OR (retracted_at IS NOT NULL AND retracted_reason IS NOT NULL AND retracted_via IS NOT NULL))
);
CREATE INDEX sunny_inbox_interpretations_head_idx ON public.sunny_inbox_interpretations (entity_key, seq DESC) WHERE retracted_at IS NULL;
CREATE INDEX sunny_inbox_interpretations_link_idx ON public.sunny_inbox_interpretations (link_id);
CREATE INDEX sunny_inbox_interpretations_item_idx ON public.sunny_inbox_interpretations (item_id);

ALTER TABLE public.sunny_inbox_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sunny_inbox_interpretations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.sunny_inbox_links, public.sunny_inbox_interpretations FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.sunny_inbox_links, public.sunny_inbox_interpretations TO service_role;
REVOKE ALL ON SEQUENCE public.sunny_inbox_interpretations_seq_seq FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.sunny_inbox_link_entity(p_item_id uuid, p_entity_key text, p_method text, p_surface text, p_candidates text[], p_request_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_surface text := btrim(p_surface);
  v_cands text[]; v_hash text; v_link public.sunny_inbox_links; v_item public.sunny_owner_inbox; v_id uuid; v_con text;
BEGIN
  IF p_item_id IS NULL OR p_request_key IS NULL OR p_entity_key IS NULL THEN RAISE EXCEPTION 'INVALID_REQUEST' USING ERRCODE = '22023'; END IF;
  IF p_method IS NULL OR p_method NOT IN ('RESOLVER_UNIQUE','OWNER_ANSWER') THEN RAISE EXCEPTION 'INVALID_METHOD: "%"', p_method USING ERRCODE = '22023'; END IF;
  IF p_method = 'OWNER_ANSWER' THEN
    IF p_candidates IS NULL OR array_position(p_candidates, NULL) IS NOT NULL THEN RAISE EXCEPTION 'INVALID_CANDIDATES' USING ERRCODE = '22023'; END IF;
    SELECT array_agg(DISTINCT c ORDER BY c) INTO v_cands FROM unnest(p_candidates) c;
  ELSIF p_candidates IS NOT NULL THEN
    RAISE EXCEPTION 'CANDIDATES_NOT_ALLOWED: only OWNER_ANSWER carries candidates' USING ERRCODE = '22023';
  END IF;
  v_hash := encode(sha256(convert_to(jsonb_build_object('item', p_item_id::text, 'entity', p_entity_key, 'method', p_method,
    'surface', v_surface, 'candidates', to_jsonb(v_cands))::text, 'UTF8')), 'hex');
  SELECT * INTO v_link FROM public.sunny_inbox_links WHERE request_key = p_request_key;
  IF FOUND THEN
    IF v_link.payload_hash <> v_hash THEN RAISE EXCEPTION 'REQUEST_KEY_REUSED' USING ERRCODE = '22023'; END IF;
    RETURN jsonb_build_object('linkId', v_link.id, 'quality', v_link.quality, 'replayed', true);
  END IF;
  SELECT * INTO v_item FROM public.sunny_owner_inbox WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ITEM_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_link FROM public.sunny_inbox_links WHERE request_key = p_request_key;
  IF FOUND THEN
    IF v_link.payload_hash <> v_hash THEN RAISE EXCEPTION 'REQUEST_KEY_REUSED' USING ERRCODE = '22023'; END IF;
    RETURN jsonb_build_object('linkId', v_link.id, 'quality', v_link.quality, 'replayed', true);
  END IF;
  IF v_surface IS NULL OR char_length(v_surface) NOT BETWEEN 2 AND 80 OR strpos(v_item.body, v_surface) = 0 THEN
    RAISE EXCEPTION 'SURFACE_NOT_IN_TEXT' USING ERRCODE = '22023';
  END IF;
  IF NOT public.sunny_inbox_entity_exists(p_entity_key) THEN RAISE EXCEPTION 'ENTITY_NOT_FOUND: %', p_entity_key USING ERRCODE = '22023'; END IF;
  IF p_method = 'OWNER_ANSWER' THEN
    IF coalesce(cardinality(v_cands), 0) NOT BETWEEN 2 AND 8 THEN RAISE EXCEPTION 'INVALID_CANDIDATES: 2-8' USING ERRCODE = '22023'; END IF;
    IF NOT (p_entity_key = ANY (v_cands)) THEN RAISE EXCEPTION 'NOT_A_CANDIDATE: %', p_entity_key USING ERRCODE = '22023'; END IF;
    IF EXISTS (SELECT 1 FROM unnest(v_cands) c WHERE NOT public.sunny_inbox_entity_exists(c)) THEN
      RAISE EXCEPTION 'ENTITY_NOT_FOUND: a candidate' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.sunny_inbox_links WHERE item_id = p_item_id AND entity_key = p_entity_key AND retracted_at IS NULL) THEN
    RAISE EXCEPTION 'ALREADY_LINKED: %', p_entity_key USING ERRCODE = '22023';
  END IF;
  BEGIN
    INSERT INTO public.sunny_inbox_links (item_id, entity_key, quality, method, surface, candidates, request_key, payload_hash)
      VALUES (p_item_id, p_entity_key, CASE WHEN p_method = 'OWNER_ANSWER' THEN 'OWNER_CONFIRMED' ELSE 'EXACT_UNIQUE' END,
              p_method, v_surface, v_cands, p_request_key, v_hash)
      RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
    IF v_con = 'sunny_inbox_links_request_key_key' THEN RAISE EXCEPTION 'REQUEST_KEY_REUSED' USING ERRCODE = '22023'; END IF;
    RAISE;
  END;
  RETURN jsonb_build_object('linkId', v_id, 'quality', CASE WHEN p_method = 'OWNER_ANSWER' THEN 'OWNER_CONFIRMED' ELSE 'EXACT_UNIQUE' END, 'replayed', false);
END $$;

CREATE FUNCTION public.sunny_inbox_record_interpretation(
  p_link_id uuid, p_request_key uuid,
  p_what_happened text, p_completed text[], p_open_gaps text[], p_blockers text[],
  p_ball_with text, p_inferred_next_step text, p_confidence text,
  p_basis_status text, p_basis_ball text, p_basis_event_at timestamptz,
  p_supersedes_id uuid, p_supersede_kind text, p_supersede_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_next text := NULLIF(btrim(p_inferred_next_step), '');
  v_reason text := NULLIF(btrim(p_supersede_reason), '');
  v_completed text[] := coalesce(p_completed, '{}'); v_gaps text[] := coalesce(p_open_gaps, '{}'); v_blockers text[] := coalesce(p_blockers, '{}');
  v_hash text; v_row public.sunny_inbox_interpretations; v_head public.sunny_inbox_interpretations; v_link public.sunny_inbox_links;
  v_has_head boolean; v_id uuid; v_con text;
BEGIN
  IF p_link_id IS NULL OR p_request_key IS NULL THEN RAISE EXCEPTION 'INVALID_REQUEST' USING ERRCODE = '22023'; END IF;
  v_hash := encode(sha256(convert_to(jsonb_build_object(
    'link', p_link_id::text, 'whatHappened', p_what_happened, 'completed', to_jsonb(v_completed), 'openGaps', to_jsonb(v_gaps),
    'blockers', to_jsonb(v_blockers), 'ballWith', p_ball_with, 'nextStep', v_next, 'confidence', p_confidence,
    'supersedes', p_supersedes_id::text, 'supersedeKind', p_supersede_kind, 'supersedeReason', v_reason)::text, 'UTF8')), 'hex');
  SELECT * INTO v_row FROM public.sunny_inbox_interpretations WHERE request_key = p_request_key;
  IF FOUND THEN
    IF v_row.payload_hash <> v_hash THEN RAISE EXCEPTION 'REQUEST_KEY_REUSED' USING ERRCODE = '22023'; END IF;
    RETURN jsonb_build_object('interpretationId', v_row.id, 'replayed', true);
  END IF;
  SELECT * INTO v_link FROM public.sunny_inbox_links WHERE id = p_link_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'LINK_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF v_link.entity_key !~ '^project:' THEN RAISE EXCEPTION 'NOT_A_PROJECT_LINK: interpretation is for projects only (Phase 1)' USING ERRCODE = '22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('sunny_inbox_interp:' || v_link.entity_key, 0));
  PERFORM 1 FROM public.sunny_owner_inbox WHERE id = v_link.item_id FOR SHARE;
  SELECT * INTO v_link FROM public.sunny_inbox_links WHERE id = p_link_id FOR SHARE;
  SELECT * INTO v_row FROM public.sunny_inbox_interpretations WHERE request_key = p_request_key;
  IF FOUND THEN
    IF v_row.payload_hash <> v_hash THEN RAISE EXCEPTION 'REQUEST_KEY_REUSED' USING ERRCODE = '22023'; END IF;
    RETURN jsonb_build_object('interpretationId', v_row.id, 'replayed', true);
  END IF;
  IF v_link.retracted_at IS NOT NULL THEN RAISE EXCEPTION 'LINK_RETRACTED' USING ERRCODE = '22023'; END IF;
  IF NOT public.sunny_inbox_entity_exists(v_link.entity_key) THEN RAISE EXCEPTION 'ENTITY_NOT_FOUND: %', v_link.entity_key USING ERRCODE = '22023'; END IF;
  IF p_what_happened IS NULL OR p_what_happened <> btrim(p_what_happened) OR char_length(p_what_happened) NOT BETWEEN 1 AND 300 THEN
    RAISE EXCEPTION 'INVALID_FIELD: what_happened (1-300, trimmed)' USING ERRCODE = '22023';
  END IF;
  IF NOT public.sunny_inbox_text_list_ok(v_completed, 5, 160) THEN RAISE EXCEPTION 'INVALID_FIELD: completed (max 5 x 1-160)' USING ERRCODE = '22023'; END IF;
  IF NOT public.sunny_inbox_text_list_ok(v_gaps, 5, 160) THEN RAISE EXCEPTION 'INVALID_FIELD: open_gaps (max 5 x 1-160)' USING ERRCODE = '22023'; END IF;
  IF NOT public.sunny_inbox_text_list_ok(v_blockers, 5, 160) THEN RAISE EXCEPTION 'INVALID_FIELD: blockers (max 5 x 1-160)' USING ERRCODE = '22023'; END IF;
  IF p_ball_with IS NULL OR p_ball_with NOT IN ('OWNER','TEAM','ENGINEER','VICTOR','ARTIST','CLIENT','UNKNOWN') THEN RAISE EXCEPTION 'INVALID_FIELD: ball_with' USING ERRCODE = '22023'; END IF;
  IF v_next IS NOT NULL AND char_length(v_next) > 200 THEN RAISE EXCEPTION 'INVALID_FIELD: inferred_next_step (max 200)' USING ERRCODE = '22023'; END IF;
  IF p_confidence IS NULL OR p_confidence NOT IN ('LOW','MEDIUM','HIGH') THEN RAISE EXCEPTION 'INVALID_FIELD: confidence' USING ERRCODE = '22023'; END IF;
  IF p_basis_status IS NOT NULL AND char_length(p_basis_status) NOT BETWEEN 1 AND 40 THEN RAISE EXCEPTION 'INVALID_BASIS: status' USING ERRCODE = '22023'; END IF;
  IF p_basis_ball IS NOT NULL AND p_basis_ball !~ '^[A-Z_]{1,60}$' THEN RAISE EXCEPTION 'INVALID_BASIS: ball' USING ERRCODE = '22023'; END IF;
  IF p_basis_event_at IS NOT NULL AND p_basis_event_at > now() + interval '5 minutes' THEN RAISE EXCEPTION 'INVALID_BASIS: event in the future' USING ERRCODE = '22023'; END IF;
  IF v_reason IS NOT NULL AND char_length(v_reason) > 200 THEN RAISE EXCEPTION 'INVALID_REASON: 1-200 chars' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_head FROM public.sunny_inbox_interpretations
   WHERE entity_key = v_link.entity_key AND retracted_at IS NULL ORDER BY seq DESC LIMIT 1;
  v_has_head := FOUND;
  IF v_has_head THEN
    IF p_supersedes_id IS DISTINCT FROM v_head.id THEN RAISE EXCEPTION 'HEAD_CHANGED: the current head is %', v_head.id USING ERRCODE = '22023'; END IF;
    IF p_supersede_kind IS NULL OR p_supersede_kind NOT IN ('NEW_UPDATE','CORRECTION') THEN RAISE EXCEPTION 'INVALID_SUPERSEDE_KIND' USING ERRCODE = '22023'; END IF;
    IF p_supersede_kind = 'CORRECTION' AND v_reason IS NULL THEN RAISE EXCEPTION 'INVALID_REASON: a correction needs a reason' USING ERRCODE = '22023'; END IF;
  ELSIF p_supersedes_id IS NOT NULL OR p_supersede_kind IS NOT NULL OR v_reason IS NOT NULL THEN
    RAISE EXCEPTION 'NOTHING_TO_SUPERSEDE' USING ERRCODE = '22023';
  END IF;
  BEGIN
    INSERT INTO public.sunny_inbox_interpretations (item_id, link_id, entity_key, what_happened, completed, open_gaps, blockers, ball_with,
        inferred_next_step, confidence, basis_status, basis_ball, basis_event_at, supersedes_id, supersede_kind, supersede_reason, request_key, payload_hash)
      VALUES (v_link.item_id, v_link.id, v_link.entity_key, p_what_happened, v_completed, v_gaps, v_blockers, p_ball_with,
        v_next, p_confidence, p_basis_status, p_basis_ball, p_basis_event_at,
        CASE WHEN v_has_head THEN v_head.id END, CASE WHEN v_has_head THEN p_supersede_kind END, CASE WHEN v_has_head THEN v_reason END,
        p_request_key, v_hash)
      RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
    IF v_con = 'sunny_inbox_interpretations_request_key_key' THEN RAISE EXCEPTION 'REQUEST_KEY_REUSED' USING ERRCODE = '22023'; END IF;
    RAISE;
  END;
  RETURN jsonb_build_object('interpretationId', v_id, 'supersedes', CASE WHEN v_has_head THEN v_head.id END, 'replayed', false);
END $$;

CREATE FUNCTION public.sunny_inbox_retract_link(p_link_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_link public.sunny_inbox_links; v_reason text := NULLIF(btrim(p_reason), ''); v_n integer;
BEGIN
  IF v_reason IS NULL OR char_length(v_reason) > 200 THEN RAISE EXCEPTION 'INVALID_REASON: 1-200 chars' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_link FROM public.sunny_inbox_links WHERE id = p_link_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'LINK_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('sunny_inbox_interp:' || v_link.entity_key, 0));
  PERFORM 1 FROM public.sunny_owner_inbox WHERE id = v_link.item_id FOR UPDATE;
  SELECT * INTO v_link FROM public.sunny_inbox_links WHERE id = p_link_id FOR UPDATE;
  IF v_link.retracted_at IS NOT NULL THEN
    IF v_link.retracted_reason = v_reason THEN RETURN jsonb_build_object('linkId', p_link_id, 'replayed', true); END IF;
    RAISE EXCEPTION 'ALREADY_RETRACTED' USING ERRCODE = '22023';
  END IF;
  UPDATE public.sunny_inbox_interpretations SET retracted_at = now(), retracted_reason = left('link retracted: ' || v_reason, 200), retracted_via = 'SUNNY'
   WHERE link_id = p_link_id AND retracted_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  UPDATE public.sunny_inbox_links SET retracted_at = now(), retracted_reason = v_reason, retracted_via = 'SUNNY' WHERE id = p_link_id;
  RETURN jsonb_build_object('linkId', p_link_id, 'interpretationsRetracted', v_n, 'replayed', false);
END $$;

CREATE FUNCTION public.sunny_inbox_retract_interpretation(p_interpretation_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_row public.sunny_inbox_interpretations; v_reason text := NULLIF(btrim(p_reason), '');
BEGIN
  IF v_reason IS NULL OR char_length(v_reason) > 200 THEN RAISE EXCEPTION 'INVALID_REASON: 1-200 chars' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_row FROM public.sunny_inbox_interpretations WHERE id = p_interpretation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'INTERPRETATION_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('sunny_inbox_interp:' || v_row.entity_key, 0));
  PERFORM 1 FROM public.sunny_owner_inbox WHERE id = v_row.item_id FOR SHARE;
  SELECT * INTO v_row FROM public.sunny_inbox_interpretations WHERE id = p_interpretation_id FOR UPDATE;
  IF v_row.retracted_at IS NOT NULL THEN
    IF v_row.retracted_reason = v_reason THEN RETURN jsonb_build_object('interpretationId', p_interpretation_id, 'replayed', true); END IF;
    RAISE EXCEPTION 'ALREADY_RETRACTED' USING ERRCODE = '22023';
  END IF;
  UPDATE public.sunny_inbox_interpretations SET retracted_at = now(), retracted_reason = v_reason, retracted_via = 'SUNNY' WHERE id = p_interpretation_id;
  RETURN jsonb_build_object('interpretationId', p_interpretation_id, 'replayed', false);
END $$;

-- mark_processed: the existing behaviour + the writer's existing ref contract (checkOutcomeRef, lib/owner-inbox.ts) now also in the DB
-- + MEMORY_RECORDED. Nothing else changes (same via check, same UPDATE, same NOT_NEW_OR_MISSING, same stored ref = NULLIF(btrim(p_ref), '')).
CREATE OR REPLACE FUNCTION public.sunny_owner_inbox_mark_processed(p_id uuid, p_via text, p_outcome text, p_ref text)
RETURNS public.sunny_owner_inbox LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r public.sunny_owner_inbox; v_ref text := NULLIF(btrim(p_ref), '');
BEGIN
  IF p_via IS NULL OR p_via NOT IN ('DASHBOARD','SUNNY') THEN
    RAISE EXCEPTION 'INVALID_PROCESSED_VIA: "%" (allowed: DASHBOARD, SUNNY)', p_via
      USING ERRCODE = '22023';
  END IF;
  IF p_outcome IS NULL OR p_outcome NOT IN ('LEARNED_KNOWLEDGE','ACTION_PLANNED','NO_ACTION_NEEDED','DISMISSED','MEMORY_RECORDED') THEN
    RAISE EXCEPTION 'INVALID_OUTCOME: "%" (allowed: LEARNED_KNOWLEDGE, ACTION_PLANNED, NO_ACTION_NEEDED, DISMISSED, MEMORY_RECORDED)', p_outcome
      USING ERRCODE = '22023';
  END IF;
  IF p_outcome = 'ACTION_PLANNED' AND (v_ref IS NULL OR v_ref !~ '^pl_[A-Za-z0-9_-]{16,64}$') THEN
    RAISE EXCEPTION 'INVALID_REF: ACTION_PLANNED needs a plan id (pl_...)' USING ERRCODE = '22023';
  END IF;
  IF p_outcome = 'LEARNED_KNOWLEDGE' AND (v_ref IS NULL OR v_ref !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
    RAISE EXCEPTION 'INVALID_REF: LEARNED_KNOWLEDGE needs a knowledge record id (uuid)' USING ERRCODE = '22023';
  END IF;
  IF p_outcome IN ('NO_ACTION_NEEDED','DISMISSED','MEMORY_RECORDED') AND v_ref IS NOT NULL THEN
    RAISE EXCEPTION 'REF_NOT_ALLOWED: % carries no reference', p_outcome USING ERRCODE = '22023';
  END IF;
  IF p_outcome = 'MEMORY_RECORDED' THEN
    PERFORM 1 FROM public.sunny_owner_inbox WHERE id = p_id FOR UPDATE;
    IF FOUND THEN
      IF NOT EXISTS (SELECT 1 FROM public.sunny_inbox_links WHERE item_id = p_id AND retracted_at IS NULL) THEN
        RAISE EXCEPTION 'NO_MEMORY: the item has no active entity link' USING ERRCODE = '22023';
      END IF;
      IF EXISTS (SELECT 1 FROM public.sunny_inbox_links l WHERE l.item_id = p_id AND l.retracted_at IS NULL AND l.entity_key LIKE 'project:%'
                   AND NOT EXISTS (SELECT 1 FROM public.sunny_inbox_interpretations i WHERE i.link_id = l.id AND i.retracted_at IS NULL)) THEN
        RAISE EXCEPTION 'UNINTERPRETED_PROJECT_LINK: every linked project needs an interpretation first' USING ERRCODE = '22023';
      END IF;
    END IF;
  END IF;
  UPDATE public.sunny_owner_inbox
     SET status = 'PROCESSED', processed_at = now(), processed_via = p_via,
         outcome = p_outcome, outcome_ref = v_ref
   WHERE id = p_id AND status = 'NEW'
  RETURNING * INTO r;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_NEW_OR_MISSING: inbox item % does not exist or is already PROCESSED', p_id
      USING ERRCODE = 'P0002';
  END IF;
  RETURN r;
END $$;

CREATE FUNCTION public.sunny_owner_inbox_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'NO_DELETE: inbox items are never deleted' USING ERRCODE = '42501'; END IF;
  IF (NEW.id, NEW.created_at, NEW.body, NEW.author, NEW.epistemic, NEW.source, NEW.request_key)
       IS DISTINCT FROM (OLD.id, OLD.created_at, OLD.body, OLD.author, OLD.epistemic, OLD.source, OLD.request_key) THEN
    RAISE EXCEPTION 'IMMUTABLE_BODY: the Owner''s text never changes' USING ERRCODE = '42501';
  END IF;
  IF OLD.status = 'PROCESSED' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'FINAL_STATE: PROCESSED never changes' USING ERRCODE = '42501'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sunny_owner_inbox_guard BEFORE UPDATE OR DELETE ON public.sunny_owner_inbox FOR EACH ROW EXECUTE FUNCTION public.sunny_owner_inbox_guard();

CREATE FUNCTION public.sunny_inbox_links_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'NO_DELETE: inbox links are never deleted' USING ERRCODE = '42501'; END IF;
  IF (NEW.id, NEW.item_id, NEW.entity_key, NEW.quality, NEW.method, NEW.surface, NEW.candidates, NEW.request_key, NEW.payload_hash, NEW.created_at, NEW.created_via)
       IS DISTINCT FROM (OLD.id, OLD.item_id, OLD.entity_key, OLD.quality, OLD.method, OLD.surface, OLD.candidates, OLD.request_key, OLD.payload_hash, OLD.created_at, OLD.created_via) THEN
    RAISE EXCEPTION 'IMMUTABLE_CONTENT: a link never changes (retract it)' USING ERRCODE = '42501';
  END IF;
  IF OLD.retracted_at IS NOT NULL AND (NEW.retracted_at, NEW.retracted_reason, NEW.retracted_via) IS DISTINCT FROM (OLD.retracted_at, OLD.retracted_reason, OLD.retracted_via) THEN
    RAISE EXCEPTION 'FINAL_STATE: a retraction is permanent' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sunny_inbox_links_guard BEFORE UPDATE OR DELETE ON public.sunny_inbox_links FOR EACH ROW EXECUTE FUNCTION public.sunny_inbox_links_guard();

CREATE FUNCTION public.sunny_inbox_interpretations_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'NO_DELETE: interpretations are never deleted' USING ERRCODE = '42501'; END IF;
  IF (NEW.id, NEW.seq, NEW.item_id, NEW.link_id, NEW.entity_key, NEW.what_happened, NEW.completed, NEW.open_gaps, NEW.blockers, NEW.ball_with,
      NEW.inferred_next_step, NEW.confidence, NEW.epistemic, NEW.source, NEW.basis_status, NEW.basis_ball, NEW.basis_event_at,
      NEW.supersedes_id, NEW.supersede_kind, NEW.supersede_reason, NEW.request_key, NEW.payload_hash, NEW.created_at, NEW.created_via)
     IS DISTINCT FROM
     (OLD.id, OLD.seq, OLD.item_id, OLD.link_id, OLD.entity_key, OLD.what_happened, OLD.completed, OLD.open_gaps, OLD.blockers, OLD.ball_with,
      OLD.inferred_next_step, OLD.confidence, OLD.epistemic, OLD.source, OLD.basis_status, OLD.basis_ball, OLD.basis_event_at,
      OLD.supersedes_id, OLD.supersede_kind, OLD.supersede_reason, OLD.request_key, OLD.payload_hash, OLD.created_at, OLD.created_via) THEN
    RAISE EXCEPTION 'IMMUTABLE_CONTENT: an interpretation never changes (supersede or retract it)' USING ERRCODE = '42501';
  END IF;
  IF OLD.retracted_at IS NOT NULL AND (NEW.retracted_at, NEW.retracted_reason, NEW.retracted_via) IS DISTINCT FROM (OLD.retracted_at, OLD.retracted_reason, OLD.retracted_via) THEN
    RAISE EXCEPTION 'FINAL_STATE: a retraction is permanent' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sunny_inbox_interpretations_guard BEFORE UPDATE OR DELETE ON public.sunny_inbox_interpretations FOR EACH ROW EXECUTE FUNCTION public.sunny_inbox_interpretations_guard();

REVOKE ALL ON FUNCTION public.sunny_inbox_entity_exists(text), public.sunny_inbox_text_list_ok(text[], integer, integer),
  public.sunny_owner_inbox_guard(), public.sunny_inbox_links_guard(), public.sunny_inbox_interpretations_guard()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.sunny_inbox_link_entity(uuid, text, text, text, text[], uuid),
  public.sunny_inbox_record_interpretation(uuid, uuid, text, text[], text[], text[], text, text, text, text, text, timestamptz, uuid, text, text),
  public.sunny_inbox_retract_link(uuid, text), public.sunny_inbox_retract_interpretation(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sunny_inbox_link_entity(uuid, text, text, text, text[], uuid),
  public.sunny_inbox_record_interpretation(uuid, uuid, text, text[], text[], text[], text, text, text, text, text, timestamptz, uuid, text, text),
  public.sunny_inbox_retract_link(uuid, text), public.sunny_inbox_retract_interpretation(uuid, text)
  TO service_role;

COMMIT;
