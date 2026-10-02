-- ============================================================================================
-- Sunny Brain v1: FORWARD migration.  CANDIDATE (revision v4) — NOT APPLIED TO PRODUCTION. Tested only on a local PG16 harness.
-- v1 intelligence types = INSIGHT + RECOMMENDATION. DECISION / LEARNING are Owner-approved P2 kinds (separate migration).
-- OUTCOME / EXPERIMENT are RESERVED (accepted by the type CHECK, refused by sunny_intel_body_ok until v1.1).
-- Apply only after: (1) the Owner approves this file's exact SHA-256, (2) the local harness passes, (3) the separate
-- DRY-RUN file (same SQL, ends in ROLLBACK, own SHA-256) passes in production, (4) the [VERIFY] reads hold.
--
-- Creates (touches NOTHING existing):
--   sunny_resources                external resource identity — UNIQUE (platform, identity_key); NOT a business entity
--   sunny_tracking_authorizations  the security boundary for every autonomous write (granted only through T2)
--   sunny_observations             time-series (subject = a resource OR a Redbloods entity key)
--   sunny_intel_records            INSIGHT · RECOMMENDATION (always Sunny's inference, always under an authorization)
--   sunny_brain_links              typed evidence graph (never ends at Owner knowledge in v1)
--   sunny_brain_events             the ONE lifecycle / correction log
--   2 views, helpers (no grants), 4 internal cores (no grants), 5 service_role wrappers.
--
-- v4 security model (who can write what — enforced by privileges + CHECKs + caller pinning, not by prompts):
--   service_role (connector / server) : ONLY the 5 wrappers. None of them takes an approval_basis / approval_ref / actor
--                                        argument: every row they write is SUNNY + TRACKING_AUTHORIZATION + a live,
--                                        covering authorization. They can never write OWNER_APPROVAL / OWNER_STATEMENT,
--                                        never link to knowledge:, never move an Owner-only status.
--   Owner session (authenticated)     : ONLY through T2 RPCs (owner_approval_decide / owner_revoke_tracking_authorization /
--                                        owner_brain_transition), which call the cores below as definer after
--                                        owner_approval_assert_owner(). The cores have NO grants. The POSTCONDITIONS pin the
--                                        exact set of functions whose body calls each core.
--   Nobody                            : direct INSERT / UPDATE / DELETE / TRUNCATE on any brain table.
--
-- [VERIFY] (read-only, before apply): sunny_inbox_entity_exists(text) exists; partner_owner_knowledge has the
-- knowledge-infra CHECKs; partner_action_plans.plan_id exists; transactions.id is uuid; roles anon / authenticated /
-- service_role exist.
-- ============================================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
BEGIN
  IF to_regclass('public.sunny_resources') IS NOT NULL OR to_regclass('public.sunny_tracking_authorizations') IS NOT NULL
     OR to_regclass('public.sunny_observations') IS NOT NULL OR to_regclass('public.sunny_intel_records') IS NOT NULL
     OR to_regclass('public.sunny_brain_links') IS NOT NULL OR to_regclass('public.sunny_brain_events') IS NOT NULL THEN
    RAISE EXCEPTION 'PRECONDITION: a sunny brain table already exists';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND (p.proname LIKE 'sunny\_brain\_%' OR p.proname LIKE 'sunny\_intel\_%' OR p.proname LIKE 'sunny\_auth\_%'
               OR p.proname IN ('sunny_today_il','sunny_canonical_url','sunny_grant_tracking_authorization','sunny_register_resource_core','sunny_register_content',
                                'sunny_record_observations','sunny_record_observations_core','sunny_create_intel_record','sunny_add_links'))) THEN
    RAISE EXCEPTION 'PRECONDITION: a sunny brain function already exists';
  END IF;
  IF to_regprocedure('public.sunny_inbox_entity_exists(text)') IS NULL THEN RAISE EXCEPTION 'PRECONDITION: sunny_inbox_entity_exists(text) missing'; END IF;
  IF to_regclass('public.partner_owner_knowledge') IS NULL OR to_regclass('public.sunny_owner_inbox') IS NULL
     OR to_regclass('public.partner_owner_context') IS NULL OR to_regclass('public.partner_action_plans') IS NULL
     OR to_regclass('public.transactions') IS NULL THEN
    RAISE EXCEPTION 'PRECONDITION: a referenced table is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    RAISE EXCEPTION 'PRECONDITION: Supabase roles missing';
  END IF;
END $$;

-- ═════════════════════════════ helpers (no grants to anyone) ═════════════════════════════

-- Israel calendar day. Authorization windows AND the daily observation cap are Israel calendar days (Asia/Jerusalem, DST-aware).
CREATE FUNCTION public.sunny_today_il() RETURNS date LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT (now() AT TIME ZONE 'Asia/Jerusalem')::date
$$;

-- Canonical URL (v4). Returns the canonical form, or NULL when the URL is not acceptable. A stored URL must equal its own
-- canonical form (CHECK), so noise never reaches storage. Rules — and ONLY these (meaningful parameters are never stripped):
--   * https only; no userinfo; host lowercased, a trailing dot and the default port :443 removed; path kept byte-for-byte
--     (an empty path becomes "/"); no whitespace / control / < > " \ ^ ` { | } ; ≤ 500 chars.
--   * query: the ORDER is kept (order can be meaningful); empty segments are dropped; a parameter is dropped ONLY when its
--     name is a known tracking parameter: utm_* · fbclid gclid gclsrc dclid gbraid wbraid msclkid yclid ttclid twclid igshid igsh
--     mc_cid mc_eid _ga _gl (everywhere) + per host: YouTube si feature pp · Spotify si nd · X/Twitter s t ref_src ref_url ·
--     TikTok is_from_webapp sender_device is_copy_url _r _t web_id share_app_id share_link_id u_code tt_from sec_user_id
--     social_sharing · Facebook mibextid rdid. Everything else (YouTube v / list / t, Spotify context, IG img_index, any
--     unknown parameter) is kept.
--   * fragment: dropped, EXCEPT a hash route (#/… or #!…), which is meaningful to single-page sites.
-- The TypeScript mirror (lib/partner/brain/url.ts, with the implementation) must return the identical string — parity test.
CREATE FUNCTION public.sunny_canonical_url(p_url text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE
  m text[]; v_host text; v_path text; v_kept text[]; v_frag text; v_hostp text[];
  v_generic constant text[] := ARRAY['fbclid','gclid','gclsrc','dclid','gbraid','wbraid','msclkid','yclid','ttclid','twclid','igshid','igsh','mc_cid','mc_eid','_ga','_gl'];
BEGIN
  IF p_url IS NULL OR char_length(p_url) > 500 OR p_url ~ '[[:space:][:cntrl:]<>"\\^`{|}]' THEN RETURN NULL; END IF;
  m := regexp_match(p_url, '^([A-Za-z][A-Za-z0-9+.-]*)://([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$');
  IF m IS NULL OR lower(m[1]) <> 'https' THEN RETURN NULL; END IF;
  v_host := lower(m[2]);
  IF v_host = '' OR position('@' IN v_host) > 0 THEN RETURN NULL; END IF;
  v_host := regexp_replace(v_host, ':443$', '');
  v_host := regexp_replace(v_host, '\.(:[0-9]+)?$', '\1');
  IF v_host !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:[0-9]{1,5})?$' THEN RETURN NULL; END IF;
  v_path := CASE WHEN m[3] = '' THEN '/' ELSE m[3] END;
  v_hostp := CASE
    WHEN v_host IN ('youtube.com','www.youtube.com','m.youtube.com','music.youtube.com','youtu.be') THEN ARRAY['si','feature','pp']
    WHEN v_host = 'open.spotify.com' THEN ARRAY['si','nd']
    WHEN v_host IN ('x.com','www.x.com','twitter.com','www.twitter.com','mobile.twitter.com') THEN ARRAY['s','t','ref_src','ref_url']
    WHEN v_host IN ('tiktok.com','www.tiktok.com','m.tiktok.com','vm.tiktok.com') THEN
      ARRAY['is_from_webapp','sender_device','is_copy_url','_r','_t','web_id','share_app_id','share_link_id','u_code','tt_from','sec_user_id','social_sharing']
    WHEN v_host IN ('facebook.com','www.facebook.com','m.facebook.com') THEN ARRAY['mibextid','rdid']
    ELSE '{}'::text[] END;
  IF m[4] IS NOT NULL THEN
    SELECT array_agg(seg ORDER BY ord) INTO v_kept
      FROM unnest(string_to_array(substr(m[4], 2), '&')) WITH ORDINALITY AS u(seg, ord)
     WHERE seg <> '' AND split_part(seg, '=', 1) <> ''
       AND lower(split_part(seg, '=', 1)) NOT LIKE 'utm\_%'
       AND NOT (lower(split_part(seg, '=', 1)) = ANY (v_generic || v_hostp));
  END IF;
  v_frag := CASE WHEN m[5] ~ '^#[/!]' THEN m[5] ELSE '' END;
  RETURN 'https://' || v_host || v_path || CASE WHEN coalesce(cardinality(v_kept), 0) > 0 THEN '?' || array_to_string(v_kept, '&') ELSE '' END || v_frag;
END $$;

-- A Redbloods ENTITY key (canonical Gateway keys + company + a declared known: identity). Resources are NOT entities.
CREATE FUNCTION public.sunny_brain_entity_ok(p_key text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF p_key IS NULL OR char_length(p_key) > 120 THEN RETURN false; END IF;
  IF p_key = 'company:REDBLOODS' THEN RETURN true; END IF;
  IF p_key ~ '^known:[a-z0-9][a-z0-9-]{1,62}$' THEN
    RETURN EXISTS (SELECT 1 FROM public.partner_owner_knowledge WHERE kind = 'KNOWN_ENTITY' AND subject_key = p_key);
  END IF;
  IF p_key ~ '^transaction:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN EXISTS (SELECT 1 FROM public.transactions WHERE id = substr(p_key, 13)::uuid);
  END IF;
  RETURN public.sunny_inbox_entity_exists(p_key); -- project|client|label-artist|dj|show|session|release, vendor:VICTOR|STEVEN
END $$;

-- A non-brain reference at the end of a link: an entity, an Owner memory row (cited as evidence only) or an action plan.
CREATE FUNCTION public.sunny_brain_ref_ok(p_ref text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE k text; v text;
BEGIN
  IF p_ref IS NULL THEN RETURN false; END IF;
  IF p_ref ~ '^(inbox|knowledge|context):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    k := split_part(p_ref, ':', 1); v := substr(p_ref, char_length(k) + 2);
    CASE k
      WHEN 'inbox'     THEN RETURN EXISTS (SELECT 1 FROM public.sunny_owner_inbox WHERE id = v::uuid);
      WHEN 'knowledge' THEN RETURN EXISTS (SELECT 1 FROM public.partner_owner_knowledge WHERE id = v::uuid);
      WHEN 'context'   THEN RETURN EXISTS (SELECT 1 FROM public.partner_owner_context WHERE id = v::uuid);
    END CASE;
  END IF;
  IF p_ref ~ '^plan:[A-Za-z0-9_-]{8,64}$' THEN
    RETURN EXISTS (SELECT 1 FROM public.partner_action_plans WHERE plan_id::text = substr(p_ref, 6));
  END IF;
  RETURN public.sunny_brain_entity_ok(p_ref);
END $$;

-- Bounded typed body per record type: allowed keys, required keys, scalar / short-list values, ≤ 4 KB.
CREATE FUNCTION public.sunny_intel_body_ok(p_type text, p_body jsonb) RETURNS boolean
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

-- Lifecycle of intelligence records, per actor (v4: the actor is part of the rule, not a caller claim).
-- SUNNY may only move what is still OPEN (or ACCEPTED → ACTED_ON); everything the Owner touched moves only with the Owner.
CREATE FUNCTION public.sunny_intel_transition_ok(p_type text, p_from text, p_to text, p_actor text) RETURNS boolean
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

-- ═════════════════════════════ tables ═════════════════════════════

-- 1. RESOURCES — "what exactly was observed": an external account / content item / page. Its own identity, never a
--    business entity. Ownership by a Redbloods entity is P2 knowledge (ENTITY_RELATIONSHIP OWNS_RESOURCE), never here.
--    IDENTITY (v4): UNIQUE (platform, identity_key). identity_key is PLATFORM-LOCAL: '<account|content|page>:<stable id>'.
--      account : a platform id when known (YouTube 'id:UC…'), else 'handle:<lowercased handle>' as first seen.
--      content : the platform's content id — ONE namespace per platform (a YouTube video id is the same item whether it is
--                a VIDEO or a SHORT; an IG shortcode the same for POST / REEL). content_kind is an attribute, never identity.
--      page    : on 'web' ALWAYS 'page:url-sha256:<sha256 of the canonical URL>' (CHECK) — no charset / collision issue.
--    The same id on two platforms is two resources; the same id twice on one platform is refused.
CREATE TABLE public.sunny_resources (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform        text NOT NULL CHECK (platform IN ('instagram','youtube','tiktok','spotify','facebook','x','web')),
  resource_kind   text NOT NULL CHECK (resource_kind IN ('ACCOUNT','CONTENT','PAGE')),
  content_kind    text NULL CHECK (content_kind IS NULL OR content_kind IN ('POST','REEL','STORY','VIDEO','SHORT','LIVE','PLAYLIST','TRACK','ALBUM','ARTICLE')),
  parent_id       uuid NULL REFERENCES public.sunny_resources(id) ON DELETE RESTRICT,
  identity_key    text NOT NULL CHECK (identity_key ~ '^(account|content|page):[A-Za-z0-9@._:/-]{1,160}$'),
  first_handle    text NULL CHECK (first_handle IS NULL OR first_handle ~ '^[A-Za-z0-9@._-]{1,60}$'),
  canonical_url   text NULL CHECK (canonical_url IS NULL OR canonical_url IS NOT DISTINCT FROM public.sunny_canonical_url(canonical_url)),
  display_name    text NULL CHECK (display_name IS NULL OR (display_name = btrim(display_name) AND char_length(display_name) BETWEEN 1 AND 120)),
  external_actor  text NULL CHECK (external_actor IS NULL OR external_actor ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  approval_basis  text NOT NULL CHECK (approval_basis IN ('OWNER_APPROVAL','TRACKING_AUTHORIZATION')),
  authorization_id uuid NULL,  -- FK added after sunny_tracking_authorizations exists
  approval_ref    text NOT NULL CHECK (char_length(approval_ref) BETWEEN 8 AND 120),
  request_key     uuid NOT NULL UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sunny_resources_identity_uk UNIQUE (platform, identity_key),
  CONSTRAINT sunny_resources_identity_kind CHECK (split_part(identity_key, ':', 1) = lower(resource_kind)),
  CONSTRAINT sunny_resources_handle_lower CHECK (identity_key !~ '^account:handle:' OR identity_key = lower(identity_key)),
  CONSTRAINT sunny_resources_web_identity CHECK (platform <> 'web' OR (resource_kind = 'PAGE' AND canonical_url IS NOT NULL
    AND identity_key = 'page:url-sha256:' || encode(sha256(convert_to(canonical_url, 'UTF8')), 'hex'))),
  CONSTRAINT sunny_resources_kind_shape CHECK (
    (resource_kind = 'CONTENT') = (content_kind IS NOT NULL)
    AND (resource_kind <> 'CONTENT' OR parent_id IS NOT NULL)
    AND (resource_kind = 'CONTENT' OR parent_id IS NULL)),
  CONSTRAINT sunny_resources_basis CHECK (
    (approval_basis = 'TRACKING_AUTHORIZATION' AND authorization_id IS NOT NULL AND resource_kind = 'CONTENT'
       AND approval_ref = 'authorization:' || authorization_id::text)
    OR (approval_basis = 'OWNER_APPROVAL' AND authorization_id IS NULL
       AND approval_ref ~ '^approval:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
);
CREATE INDEX sunny_resources_parent_idx ON public.sunny_resources (parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX sunny_resources_actor_idx ON public.sunny_resources (external_actor) WHERE external_actor IS NOT NULL;

-- 2. TRACKING AUTHORIZATIONS — the security boundary. Created ONLY by sunny_grant_tracking_authorization, which only the
--    T2 approval RPC calls (Owner session). Every autonomous write names an ACTIVE authorization that covers it.
CREATE TABLE public.sunny_tracking_authorizations (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose_kind             text NOT NULL CHECK (purpose_kind IN ('OWN_PRESENCE','REFERENCE_RESEARCH','BUSINESS_SNAPSHOT')),
  purpose_he               text NOT NULL CHECK (purpose_he = btrim(purpose_he) AND char_length(purpose_he) BETWEEN 2 AND 300),
  resource_ids             uuid[] NOT NULL DEFAULT '{}' CHECK (cardinality(resource_ids) <= 40 AND array_position(resource_ids, NULL) IS NULL),
  include_child_resources  boolean NOT NULL,
  entity_keys              text[] NOT NULL DEFAULT '{}' CHECK (cardinality(entity_keys) <= 40 AND array_position(entity_keys, NULL) IS NULL),
  observation_families     text[] NOT NULL CHECK (cardinality(observation_families) BETWEEN 1 AND 20 AND array_position(observation_families, NULL) IS NULL),
  source_kinds             text[] NOT NULL CHECK (cardinality(source_kinds) BETWEEN 1 AND 8 AND source_kinds <@ ARRAY['PUBLIC_PROFILE_PAGE','PUBLIC_CONTENT_PAGE','WEB_PAGE','REDBLOODS_RECORD','PLATFORM_API']::text[]),
  insights_allowed         boolean NOT NULL,
  recommendations_allowed  boolean NOT NULL,   -- v4: an autonomous recommendation needs this (no standing magic string)
  max_observations_per_day integer NULL CHECK (max_observations_per_day IS NULL OR max_observations_per_day > 0),
  valid_from               date NOT NULL,
  valid_until              date NULL,
  supersedes_id            uuid NULL REFERENCES public.sunny_tracking_authorizations(id) ON DELETE RESTRICT,
  approval_basis           text NOT NULL DEFAULT 'OWNER_APPROVAL' CHECK (approval_basis = 'OWNER_APPROVAL'),
  approval_ref             text NOT NULL CHECK (approval_ref ~ '^approval:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  request_key              uuid NOT NULL UNIQUE,
  created_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sunny_auth_scope_nonempty CHECK (cardinality(resource_ids) + cardinality(entity_keys) >= 1),
  CONSTRAINT sunny_auth_window CHECK (valid_until IS NULL OR valid_until >= valid_from),
  CONSTRAINT sunny_auth_families CHECK (array_to_string(observation_families, ',') ~ '^[A-Z][A-Z0-9_]{1,30}(,[A-Z][A-Z0-9_]{1,30})*$')
);
COMMENT ON COLUMN public.sunny_tracking_authorizations.max_observations_per_day IS
  'NULL = no cap. Otherwise the maximum number of observations written under this authorization per ISRAEL CALENDAR DAY (00:00–24:00 Asia/Jerusalem, DST-aware), counted by created_at (write time), not observed_at. Serialized per authorization (advisory lock).';
COMMENT ON COLUMN public.sunny_tracking_authorizations.valid_until IS 'NULL = no expiry (never a default). Inclusive Israel calendar day.';
CREATE UNIQUE INDEX sunny_auth_one_successor_uk ON public.sunny_tracking_authorizations (supersedes_id) WHERE supersedes_id IS NOT NULL;
CREATE INDEX sunny_auth_resources_gin ON public.sunny_tracking_authorizations USING gin (resource_ids);
ALTER TABLE public.sunny_resources ADD CONSTRAINT sunny_resources_authorization_fk
  FOREIGN KEY (authorization_id) REFERENCES public.sunny_tracking_authorizations(id) ON DELETE RESTRICT;

-- 3. OBSERVATIONS — one value about ONE subject at one time. Never an inference.
--    v4: TRACKING_AUTHORIZATION ⇒ EXTERNAL_SOURCE / SYSTEM_RECORD only. OWNER_STATEMENT ⇒ OWNER_APPROVAL with an approved
--    T2 request (approval:<uuid>) — written only by owner_approval_decide (kind OWNER_OBSERVATIONS) through the core.
CREATE TABLE public.sunny_observations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq              bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  batch_id         uuid NOT NULL,
  resource_id      uuid NULL REFERENCES public.sunny_resources(id) ON DELETE RESTRICT,
  entity_key       text NULL CHECK (entity_key IS NULL OR char_length(entity_key) <= 120),
  observation_type text NOT NULL CHECK (observation_type ~ '^[A-Z][A-Z0-9_]{1,30}\.[A-Z][A-Z0-9_]{1,40}$'),
  value_num        numeric NULL CHECK (value_num IS NULL OR (value_num > -1e15 AND value_num < 1e15)),
  value_text       text NULL CHECK (value_text IS NULL OR (value_text = btrim(value_text) AND char_length(value_text) BETWEEN 1 AND 300)),
  value_bool       boolean NULL,
  unit             text NULL CHECK (unit IS NULL OR unit ~ '^[A-Za-z_%₪$€]{1,16}$'),
  observed_at      timestamptz NOT NULL,
  period_start     date NULL,
  period_end       date NULL,
  source_type      text NOT NULL CHECK (source_type IN ('OWNER_STATEMENT','SYSTEM_RECORD','EXTERNAL_SOURCE')),
  source_kind      text NOT NULL CHECK (source_kind IN ('PUBLIC_PROFILE_PAGE','PUBLIC_CONTENT_PAGE','WEB_PAGE','PLATFORM_API','REDBLOODS_RECORD','OWNER_STATEMENT','OWNER_SCREENSHOT','PLATFORM_ANALYTICS_EXPORT')),
  -- a canonical https URL (meaningful query kept, tracking noise refused), or an opaque non-URL reference
  source_ref       text NULL CHECK (source_ref IS NULL OR (char_length(source_ref) BETWEEN 3 AND 500 AND (
                     (source_ref ~ '^https://' AND source_ref IS NOT DISTINCT FROM public.sunny_canonical_url(source_ref))
                     OR source_ref ~ '^(redbloods|owner):[A-Za-z0-9:._-]{3,200}$'))),
  capture_method   text NOT NULL CHECK (capture_method IN ('CLAUDE_READ','OWNER_PROVIDED','SYSTEM_SNAPSHOT','API')),
  confidence       text NOT NULL CHECK (confidence IN ('CONFIRMED','HIGH','MEDIUM','LOW')),
  approval_basis   text NOT NULL CHECK (approval_basis IN ('OWNER_APPROVAL','TRACKING_AUTHORIZATION')),
  authorization_id uuid NULL REFERENCES public.sunny_tracking_authorizations(id) ON DELETE RESTRICT,
  approval_ref     text NOT NULL CHECK (char_length(approval_ref) BETWEEN 8 AND 120),
  corrects_id      uuid NULL REFERENCES public.sunny_observations(id) ON DELETE RESTRICT,
  request_key      uuid NOT NULL,
  item_index       smallint NOT NULL CHECK (item_index BETWEEN 0 AND 39),
  payload_hash     text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sunny_obs_one_subject CHECK (num_nonnulls(resource_id, entity_key) = 1),
  CONSTRAINT sunny_obs_one_value CHECK (num_nonnulls(value_num, value_text, value_bool) = 1),
  CONSTRAINT sunny_obs_period CHECK (period_end IS NULL OR period_start IS NULL OR period_end >= period_start),
  CONSTRAINT sunny_obs_source CHECK (
    (source_type = 'OWNER_STATEMENT' AND source_kind IN ('OWNER_STATEMENT','OWNER_SCREENSHOT','PLATFORM_ANALYTICS_EXPORT') AND capture_method = 'OWNER_PROVIDED')
    OR (source_type = 'SYSTEM_RECORD' AND source_kind = 'REDBLOODS_RECORD' AND capture_method = 'SYSTEM_SNAPSHOT')
    OR (source_type = 'EXTERNAL_SOURCE' AND source_kind IN ('PUBLIC_PROFILE_PAGE','PUBLIC_CONTENT_PAGE','WEB_PAGE','PLATFORM_API') AND capture_method IN ('CLAUDE_READ','API'))),
  CONSTRAINT sunny_obs_external_not_confirmed CHECK (source_type <> 'EXTERNAL_SOURCE' OR confidence <> 'CONFIRMED'),
  CONSTRAINT sunny_obs_basis CHECK (
    (approval_basis = 'TRACKING_AUTHORIZATION' AND authorization_id IS NOT NULL AND source_type IN ('EXTERNAL_SOURCE','SYSTEM_RECORD')
       AND approval_ref = 'authorization:' || authorization_id::text)
    OR (approval_basis = 'OWNER_APPROVAL' AND authorization_id IS NULL AND source_type = 'OWNER_STATEMENT'
       AND approval_ref ~ '^approval:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')),
  CONSTRAINT sunny_obs_request_item_uk UNIQUE (request_key, item_index)
);
CREATE INDEX sunny_obs_resource_series_idx ON public.sunny_observations (resource_id, observation_type, observed_at DESC) WHERE resource_id IS NOT NULL;
CREATE INDEX sunny_obs_entity_series_idx ON public.sunny_observations (entity_key, observation_type, observed_at DESC) WHERE entity_key IS NOT NULL;
CREATE INDEX sunny_obs_type_time_idx ON public.sunny_observations (observation_type, observed_at DESC);
CREATE INDEX sunny_obs_batch_idx ON public.sunny_observations (batch_id);
CREATE INDEX sunny_obs_auth_time_idx ON public.sunny_observations (authorization_id, created_at) WHERE authorization_id IS NOT NULL;
CREATE UNIQUE INDEX sunny_obs_one_correction_uk ON public.sunny_observations (corrects_id) WHERE corrects_id IS NOT NULL;

-- 4. INTELLIGENCE RECORDS — what Sunny INFERRED or PROPOSED (never an Owner fact). Content immutable; status in events.
--    v4: always TRACKING_AUTHORIZATION (a live authorization that covers EVERY subject, with insights_allowed /
--    recommendations_allowed). No STANDING basis, no OWNER_APPROVAL creation path in v1.
CREATE TABLE public.sunny_intel_records (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq              bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  record_type      text NOT NULL CHECK (record_type IN ('INSIGHT','RECOMMENDATION','OUTCOME','EXPERIMENT')),
  entity_keys      text[] NOT NULL DEFAULT '{}' CHECK (cardinality(entity_keys) <= 8 AND array_position(entity_keys, NULL) IS NULL),
  resource_ids     uuid[] NOT NULL DEFAULT '{}' CHECK (cardinality(resource_ids) <= 8 AND array_position(resource_ids, NULL) IS NULL),
  topic            text NULL CHECK (topic IS NULL OR topic ~ '^[a-z][a-z0-9_]{1,30}(\.[a-z0-9_]{1,40}){0,4}$'),
  area             text NOT NULL CHECK (area IN ('PROJECTS','SHOWS','FINANCE','RELEASES','TEAM','CLIENTS','SOCIAL','MARKETING','CONTENT','OPERATIONS','SALES','VENDORS')),
  title_he         text NOT NULL CHECK (title_he = btrim(title_he) AND char_length(title_he) BETWEEN 2 AND 160),
  body             jsonb NOT NULL,
  source_type      text NOT NULL CHECK (source_type IN ('OWNER_STATEMENT','SYSTEM_RECORD','EXTERNAL_SOURCE','INFERRED')),
  confidence       text NOT NULL CHECK (confidence IN ('CONFIRMED','HIGH','MEDIUM','LOW')),
  review_at        date NULL,
  supersedes_id    uuid NULL REFERENCES public.sunny_intel_records(id) ON DELETE RESTRICT,
  approval_basis   text NOT NULL CHECK (approval_basis = 'TRACKING_AUTHORIZATION'),
  authorization_id uuid NOT NULL REFERENCES public.sunny_tracking_authorizations(id) ON DELETE RESTRICT,
  approval_ref     text NOT NULL,
  request_key      uuid NOT NULL UNIQUE,
  payload_hash     text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  schema_version   text NOT NULL DEFAULT 'sunny-intel-v1' CHECK (schema_version = 'sunny-intel-v1'),
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sunny_intel_body CHECK (public.sunny_intel_body_ok(record_type, body)),
  CONSTRAINT sunny_intel_inferred_never_confirmed CHECK (source_type <> 'INFERRED' OR confidence <> 'CONFIRMED'),
  CONSTRAINT sunny_intel_v1_is_inference CHECK (record_type NOT IN ('INSIGHT','RECOMMENDATION') OR source_type = 'INFERRED'),
  CONSTRAINT sunny_intel_has_subject CHECK (cardinality(entity_keys) + cardinality(resource_ids) >= 1),
  CONSTRAINT sunny_intel_ref CHECK (approval_ref = 'authorization:' || authorization_id::text)
);
COMMENT ON COLUMN public.sunny_intel_records.review_at IS
  'Canonical name: reviewAt (TypeScript / tool / docs) = review_at (DB). Optional, default NULL. Never computed, never auto-reviewed, never a reminder.';
CREATE UNIQUE INDEX sunny_intel_one_successor_uk ON public.sunny_intel_records (supersedes_id) WHERE supersedes_id IS NOT NULL;
CREATE INDEX sunny_intel_entities_gin ON public.sunny_intel_records USING gin (entity_keys);
CREATE INDEX sunny_intel_resources_gin ON public.sunny_intel_records USING gin (resource_ids);
CREATE INDEX sunny_intel_type_idx ON public.sunny_intel_records (record_type, seq DESC);
CREATE INDEX sunny_intel_topic_idx ON public.sunny_intel_records (topic, seq DESC) WHERE topic IS NOT NULL;

-- 5. EVIDENCE GRAPH — typed edges "<from> ROLE <to>", matrix enforced in sunny_brain_insert_links.
--    v4: every link is Sunny's, under a live authorization (authorization_id NOT NULL). NO link ever ENDS at Owner knowledge
--    (to_ref knowledge: / inbox: / context: are refused): attaching anything to an Owner decision / learning needs a
--    DB-proven Owner approval, which v1 does not have → reserved. Citing an Owner memory row AS EVIDENCE (from_ref) is allowed.
CREATE TABLE public.sunny_brain_links (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role                text NOT NULL CHECK (role IN ('EVIDENCE_FOR','EVIDENCE_AGAINST','DERIVED_FROM','COMPARES_TO','RECOMMENDS','IMPLEMENTED_BY','TESTS','RESULT_OF','PRODUCED_LEARNING')),
  from_record_id      uuid NULL REFERENCES public.sunny_intel_records(id) ON DELETE RESTRICT,
  from_observation_id uuid NULL REFERENCES public.sunny_observations(id) ON DELETE RESTRICT,
  from_ref            text NULL CHECK (from_ref IS NULL OR char_length(from_ref) BETWEEN 3 AND 120),
  to_record_id        uuid NULL REFERENCES public.sunny_intel_records(id) ON DELETE RESTRICT,
  to_resource_id      uuid NULL REFERENCES public.sunny_resources(id) ON DELETE RESTRICT,
  to_ref              text NULL CHECK (to_ref IS NULL OR (char_length(to_ref) BETWEEN 3 AND 120 AND to_ref !~ '^(knowledge|inbox|context):')),
  note_he             text NULL CHECK (note_he IS NULL OR char_length(note_he) BETWEEN 1 AND 200),
  approval_basis      text NOT NULL CHECK (approval_basis = 'TRACKING_AUTHORIZATION'),
  authorization_id    uuid NOT NULL REFERENCES public.sunny_tracking_authorizations(id) ON DELETE RESTRICT,
  request_key         uuid NOT NULL,
  item_index          smallint NOT NULL CHECK (item_index BETWEEN 0 AND 39),
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sunny_links_one_from CHECK (num_nonnulls(from_record_id, from_observation_id, from_ref) = 1),
  CONSTRAINT sunny_links_one_to CHECK (num_nonnulls(to_record_id, to_resource_id, to_ref) = 1),
  CONSTRAINT sunny_links_no_self CHECK (from_record_id IS NULL OR from_record_id IS DISTINCT FROM to_record_id),
  CONSTRAINT sunny_links_v1_roles CHECK (role NOT IN ('TESTS','RESULT_OF','PRODUCED_LEARNING')),   -- reserved
  CONSTRAINT sunny_links_request_item_uk UNIQUE (request_key, item_index)
);
CREATE INDEX sunny_links_from_rec_idx ON public.sunny_brain_links (from_record_id) WHERE from_record_id IS NOT NULL;
CREATE INDEX sunny_links_from_obs_idx ON public.sunny_brain_links (from_observation_id) WHERE from_observation_id IS NOT NULL;
CREATE INDEX sunny_links_to_rec_idx ON public.sunny_brain_links (to_record_id) WHERE to_record_id IS NOT NULL;
CREATE INDEX sunny_links_to_res_idx ON public.sunny_brain_links (to_resource_id) WHERE to_resource_id IS NOT NULL;
CREATE INDEX sunny_links_refs_idx ON public.sunny_brain_links (coalesce(from_ref, to_ref)) WHERE from_ref IS NOT NULL OR to_ref IS NOT NULL;
CREATE UNIQUE INDEX sunny_links_edge_uk ON public.sunny_brain_links (role,
  coalesce(from_record_id::text, from_observation_id::text, from_ref), coalesce(to_record_id::text, to_resource_id::text, to_ref));

-- 6. EVENTS — the ONE lifecycle / correction / audit log. Exactly one target per event.
--    v4: actor, basis and reference are ONE fact — OWNER ⇔ OWNER_APPROVAL ⇔ session:<uid> | approval:<request>;
--    SUNNY ⇔ TRACKING_AUTHORIZATION ⇔ authorization:<id>. OWNER rows are written only by T2 (Owner session) code.
CREATE TABLE public.sunny_brain_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq              bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  record_id        uuid NULL REFERENCES public.sunny_intel_records(id) ON DELETE RESTRICT,
  observation_id   uuid NULL REFERENCES public.sunny_observations(id) ON DELETE RESTRICT,
  authorization_id uuid NULL REFERENCES public.sunny_tracking_authorizations(id) ON DELETE RESTRICT,
  resource_id      uuid NULL REFERENCES public.sunny_resources(id) ON DELETE RESTRICT,
  link_id          uuid NULL REFERENCES public.sunny_brain_links(id) ON DELETE RESTRICT,
  from_status      text NULL,
  to_status        text NOT NULL CHECK (to_status IN (
    'OPEN','ENDORSED','REJECTED','WITHDRAWN','ACCEPTED','ACTED_ON','STALE','RETIRED','INVALIDATED','SUPERSEDED','REVOKED','RETRACTED',
    'RECORDED','PLANNED','RUNNING','ENDED','ABANDONED')),
  reason_he        text NULL CHECK (reason_he IS NULL OR (reason_he = btrim(reason_he) AND char_length(reason_he) BETWEEN 1 AND 300)),
  actor            text NOT NULL CHECK (actor IN ('OWNER','SUNNY')),
  approval_basis   text NOT NULL CHECK (approval_basis IN ('OWNER_APPROVAL','TRACKING_AUTHORIZATION')),
  approval_ref     text NOT NULL,
  request_key      uuid NOT NULL UNIQUE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sunny_events_one_target CHECK (num_nonnulls(record_id, observation_id, authorization_id, resource_id, link_id) = 1),
  CONSTRAINT sunny_events_actor_basis CHECK (
    (actor = 'OWNER' AND approval_basis = 'OWNER_APPROVAL'
       AND approval_ref ~ '^(session|approval):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    OR (actor = 'SUNNY' AND approval_basis = 'TRACKING_AUTHORIZATION'
       AND approval_ref ~ '^authorization:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')),
  CONSTRAINT sunny_events_reason_required CHECK (to_status NOT IN ('REJECTED','RETIRED','INVALIDATED','REVOKED','WITHDRAWN','ABANDONED','STALE','RETRACTED') OR reason_he IS NOT NULL),
  CONSTRAINT sunny_events_owner_moves CHECK (to_status NOT IN ('ENDORSED','REJECTED','ACCEPTED','REVOKED') OR actor = 'OWNER'),
  -- an authorization ends only by the Owner: REVOKED (he revoked it) or SUPERSEDED (he approved a new version)
  CONSTRAINT sunny_events_target_status CHECK (
    (observation_id IS NULL OR to_status = 'INVALIDATED')
    AND (authorization_id IS NULL OR (to_status IN ('REVOKED','SUPERSEDED') AND actor = 'OWNER'))
    AND (resource_id IS NULL OR to_status IN ('RETIRED','INVALIDATED'))
    AND (link_id IS NULL OR to_status = 'RETRACTED'))
);
CREATE UNIQUE INDEX sunny_events_record_creation_uk ON public.sunny_brain_events (record_id) WHERE record_id IS NOT NULL AND from_status IS NULL;
CREATE UNIQUE INDEX sunny_events_obs_once_uk ON public.sunny_brain_events (observation_id) WHERE observation_id IS NOT NULL;
CREATE UNIQUE INDEX sunny_events_auth_once_uk ON public.sunny_brain_events (authorization_id) WHERE authorization_id IS NOT NULL;
CREATE UNIQUE INDEX sunny_events_resource_once_uk ON public.sunny_brain_events (resource_id) WHERE resource_id IS NOT NULL;
CREATE UNIQUE INDEX sunny_events_link_once_uk ON public.sunny_brain_events (link_id) WHERE link_id IS NOT NULL;
CREATE INDEX sunny_events_record_idx ON public.sunny_brain_events (record_id, seq DESC) WHERE record_id IS NOT NULL;

-- ═════════════════════════════ current-state views (security_invoker) ═════════════════════════════
CREATE VIEW public.sunny_intel_record_status WITH (security_invoker = true) AS
  SELECT DISTINCT ON (e.record_id) e.record_id, e.to_status AS status, e.created_at AS status_at
  FROM public.sunny_brain_events e WHERE e.record_id IS NOT NULL ORDER BY e.record_id, e.seq DESC;

CREATE VIEW public.sunny_observations_current WITH (security_invoker = true) AS
  SELECT o.* FROM public.sunny_observations o
  WHERE NOT EXISTS (SELECT 1 FROM public.sunny_brain_events e WHERE e.observation_id = o.id);

-- ═════════════════════════════ authorization helpers (no grants) ═════════════════════════════

-- Is this authorization usable right now? Takes a SHARE lock on the row FIRST, so a concurrent revoke / supersede (FOR
-- UPDATE on the same row) is serialized: a write either commits before the revoke, or waits and then sees it.
CREATE FUNCTION public.sunny_auth_active(p_id uuid) RETURNS public.sunny_tracking_authorizations
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE a public.sunny_tracking_authorizations;
BEGIN
  IF p_id IS NULL THEN RAISE EXCEPTION 'AUTHORIZATION_REQUIRED' USING ERRCODE = '22023'; END IF;
  SELECT * INTO a FROM public.sunny_tracking_authorizations WHERE id = p_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AUTHORIZATION_NOT_FOUND' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.sunny_brain_events WHERE authorization_id = p_id) THEN RAISE EXCEPTION 'AUTHORIZATION_NOT_ACTIVE: revoked or superseded' USING ERRCODE = '22023'; END IF;
  IF public.sunny_today_il() < a.valid_from OR (a.valid_until IS NOT NULL AND public.sunny_today_il() > a.valid_until) THEN
    RAISE EXCEPTION 'AUTHORIZATION_OUT_OF_WINDOW' USING ERRCODE = '22023'; END IF;
  RETURN a;
END $$;

-- Does the authorization cover this resource (directly, or as content under a covered account)?
CREATE FUNCTION public.sunny_auth_covers_resource(p_auth public.sunny_tracking_authorizations, p_resource uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT p_resource = ANY (p_auth.resource_ids)
      OR (p_auth.include_child_resources AND EXISTS (
            SELECT 1 FROM public.sunny_resources r WHERE r.id = p_resource AND r.parent_id = ANY (p_auth.resource_ids)))
$$;

-- Does the authorization cover EVERY subject (entities by exact key, resources directly / as children)?
CREATE FUNCTION public.sunny_auth_covers_subjects(p_auth public.sunny_tracking_authorizations, p_entities text[], p_resources uuid[]) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT coalesce(p_entities, '{}') <@ p_auth.entity_keys
     AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p_resources, '{}')) r WHERE NOT public.sunny_auth_covers_resource(p_auth, r))
$$;

-- Does the authorization cover this record (all its subjects) / this observation (its subject)?
CREATE FUNCTION public.sunny_auth_covers_record(p_auth public.sunny_tracking_authorizations, p_record uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (SELECT 1 FROM public.sunny_intel_records x WHERE x.id = p_record AND public.sunny_auth_covers_subjects(p_auth, x.entity_keys, x.resource_ids))
$$;
CREATE FUNCTION public.sunny_auth_covers_observation(p_auth public.sunny_tracking_authorizations, p_obs uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (SELECT 1 FROM public.sunny_observations o WHERE o.id = p_obs
    AND ((o.resource_id IS NOT NULL AND public.sunny_auth_covers_resource(p_auth, o.resource_id)) OR (o.entity_key IS NOT NULL AND o.entity_key = ANY (p_auth.entity_keys))))
$$;

-- ═════════════════════════════ append-only enforcement ═════════════════════════════
CREATE FUNCTION public.sunny_brain_append_only() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'APPEND_ONLY: % rows never change or disappear (write a sunny_brain_events row instead)', TG_TABLE_NAME USING ERRCODE = '42501';
END $$;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sunny_resources','sunny_tracking_authorizations','sunny_observations','sunny_intel_records','sunny_brain_links','sunny_brain_events'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.sunny_brain_append_only()', t || '_append_only', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.sunny_brain_append_only()', t || '_no_truncate', t);
  END LOOP;
END $$;

-- ═════════════════════════════ internal cores (NO grants; callers pinned by POSTCONDITION) ═════════════════════════════
-- Common contract: SECURITY DEFINER, fixed search_path, typed args only, idempotent on request_key (same key + same
-- payload = replay; same key + other payload = REQUEST_KEY_REUSED), fail closed with a named error.

-- CORE A — grant (or replace) a tracking authorization. Called ONLY by T2 owner_approval_decide (Owner session).
-- Replacing writes ONE event on the old version: SUPERSEDED (the Owner approved a new version) — never REVOKED.
CREATE FUNCTION public.sunny_grant_tracking_authorization(
  p_purpose_kind text, p_purpose_he text, p_resource_ids uuid[], p_include_children boolean, p_entity_keys text[],
  p_families text[], p_source_kinds text[], p_insights_allowed boolean, p_recommendations_allowed boolean, p_max_per_day integer,
  p_valid_from date, p_valid_until date, p_supersedes_id uuid, p_approval_ref text, p_request_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_row public.sunny_tracking_authorizations; v_id uuid; k text; r uuid;
BEGIN
  IF p_request_key IS NULL OR p_include_children IS NULL OR p_insights_allowed IS NULL OR p_recommendations_allowed IS NULL THEN
    RAISE EXCEPTION 'INVALID_REQUEST' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_row FROM public.sunny_tracking_authorizations WHERE request_key = p_request_key;
  IF FOUND THEN
    IF v_row.purpose_he <> btrim(p_purpose_he) OR v_row.resource_ids <> coalesce(p_resource_ids, '{}') OR v_row.observation_families <> p_families
       OR v_row.valid_until IS DISTINCT FROM p_valid_until OR v_row.approval_ref <> p_approval_ref THEN RAISE EXCEPTION 'REQUEST_KEY_REUSED' USING ERRCODE = '22023'; END IF;
    RETURN jsonb_build_object('authorizationId', v_row.id, 'replayed', true);
  END IF;
  FOREACH r IN ARRAY coalesce(p_resource_ids, '{}') LOOP
    IF NOT EXISTS (SELECT 1 FROM public.sunny_resources WHERE id = r) THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND: %', r USING ERRCODE = '22023'; END IF;
    IF EXISTS (SELECT 1 FROM public.sunny_brain_events WHERE resource_id = r) THEN RAISE EXCEPTION 'RESOURCE_NOT_ACTIVE: %', r USING ERRCODE = '22023'; END IF;
  END LOOP;
  FOREACH k IN ARRAY coalesce(p_entity_keys, '{}') LOOP
    IF NOT public.sunny_brain_entity_ok(k) THEN RAISE EXCEPTION 'ENTITY_NOT_FOUND: %', k USING ERRCODE = '22023'; END IF;
  END LOOP;
  IF p_valid_from < public.sunny_today_il() - 1 THEN RAISE EXCEPTION 'BACKDATED_AUTHORIZATION' USING ERRCODE = '22023'; END IF;
  IF p_supersedes_id IS NOT NULL THEN
    PERFORM 1 FROM public.sunny_tracking_authorizations WHERE id = p_supersedes_id FOR UPDATE;   -- serializes with autonomous writes
    IF NOT FOUND THEN RAISE EXCEPTION 'SUPERSEDES_NOT_FOUND' USING ERRCODE = '22023'; END IF;
    IF EXISTS (SELECT 1 FROM public.sunny_brain_events WHERE authorization_id = p_supersedes_id) THEN
      RAISE EXCEPTION 'STALE_BASE: the authorization is already revoked or superseded' USING ERRCODE = '40001'; END IF;
  END IF;
  BEGIN
    INSERT INTO public.sunny_tracking_authorizations (purpose_kind, purpose_he, resource_ids, include_child_resources, entity_keys, observation_families,
        source_kinds, insights_allowed, recommendations_allowed, max_observations_per_day, valid_from, valid_until, supersedes_id, approval_ref, request_key)
      VALUES (p_purpose_kind, btrim(p_purpose_he), coalesce(p_resource_ids, '{}'), p_include_children, coalesce(p_entity_keys, '{}'), p_families,
        p_source_kinds, p_insights_allowed, p_recommendations_allowed, p_max_per_day, p_valid_from, p_valid_until, p_supersedes_id, p_approval_ref, p_request_key)
      RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'CONCURRENT_SUPERSEDE' USING ERRCODE = '40001';
  END;
  IF p_supersedes_id IS NOT NULL THEN
    INSERT INTO public.sunny_brain_events (authorization_id, from_status, to_status, reason_he, actor, approval_basis, approval_ref, request_key)
      VALUES (p_supersedes_id, 'ACTIVE', 'SUPERSEDED', 'הוחלפה בגרסה חדשה (authorization:' || v_id::text || ')', 'OWNER', 'OWNER_APPROVAL', p_approval_ref, gen_random_uuid());
  END IF;
  RETURN jsonb_build_object('authorizationId', v_id, 'replayed', false);
END $$;

-- CORE B — register an external resource. OWNER_APPROVAL (approval:<request>): any kind — called only by T2 decide.
-- TRACKING_AUTHORIZATION: only CONTENT under an account the ACTIVE authorization covers — via sunny_register_content.
CREATE FUNCTION public.sunny_register_resource_core(
  p_platform text, p_resource_kind text, p_content_kind text, p_parent_id uuid, p_identity_key text, p_first_handle text,
  p_canonical_url text, p_display_name text, p_external_actor text, p_approval_basis text, p_authorization_id uuid,
  p_approval_ref text, p_request_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_row public.sunny_resources; v_auth public.sunny_tracking_authorizations; v_id uuid;
BEGIN
  IF p_request_key IS NULL OR p_identity_key IS NULL OR p_platform IS NULL THEN RAISE EXCEPTION 'INVALID_REQUEST' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_row FROM public.sunny_resources WHERE request_key = p_request_key;
  IF FOUND THEN
    IF v_row.platform <> p_platform OR v_row.identity_key <> p_identity_key THEN RAISE EXCEPTION 'REQUEST_KEY_REUSED' USING ERRCODE = '22023'; END IF;
    RETURN jsonb_build_object('resourceId', v_row.id, 'replayed', true);
  END IF;
  SELECT * INTO v_row FROM public.sunny_resources WHERE platform = p_platform AND identity_key = p_identity_key;
  IF FOUND THEN RETURN jsonb_build_object('resourceId', v_row.id, 'replayed', false, 'existing', true); END IF; -- one identity, one row
  IF split_part(p_identity_key, ':', 1) <> lower(p_resource_kind) THEN RAISE EXCEPTION 'IDENTITY_KEY_MISMATCH' USING ERRCODE = '22023'; END IF;
  IF p_approval_basis = 'TRACKING_AUTHORIZATION' THEN
    v_auth := public.sunny_auth_active(p_authorization_id);
    IF p_resource_kind <> 'CONTENT' OR NOT v_auth.include_child_resources OR NOT (p_parent_id = ANY (v_auth.resource_ids)) THEN
      RAISE EXCEPTION 'OUTSIDE_AUTHORIZATION: only content under a covered account' USING ERRCODE = '22023';
    END IF;
    p_approval_ref := 'authorization:' || v_auth.id::text;
  ELSIF p_approval_basis <> 'OWNER_APPROVAL' OR p_authorization_id IS NOT NULL
        OR p_approval_ref !~ '^approval:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'INVALID_APPROVAL_BASIS' USING ERRCODE = '22023';
  END IF;
  IF p_parent_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.sunny_resources WHERE id = p_parent_id AND resource_kind = 'ACCOUNT' AND platform = p_platform) THEN
    RAISE EXCEPTION 'PARENT_NOT_AN_ACCOUNT_OF_THIS_PLATFORM' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.sunny_resources (platform, resource_kind, content_kind, parent_id, identity_key, first_handle, canonical_url, display_name,
      external_actor, approval_basis, authorization_id, approval_ref, request_key)
    VALUES (p_platform, p_resource_kind, p_content_kind, p_parent_id, p_identity_key, NULLIF(p_first_handle, ''), NULLIF(p_canonical_url, ''),
      NULLIF(btrim(p_display_name), ''), NULLIF(p_external_actor, ''), p_approval_basis, CASE WHEN p_approval_basis = 'TRACKING_AUTHORIZATION' THEN v_auth.id END,
      p_approval_ref, p_request_key)
    RETURNING id INTO v_id;
  RETURN jsonb_build_object('resourceId', v_id, 'replayed', false, 'existing', false);
END $$;

-- CORE C — observations (batch 1–40, atomic).
--   TRACKING_AUTHORIZATION (via sunny_record_observations): every item covered (subject, family, source kind), source
--     EXTERNAL_SOURCE / SYSTEM_RECORD only, the Israel-calendar-day cap (if set) holds — serialized per authorization.
--   OWNER_APPROVAL (only from T2 decide, kind OWNER_OBSERVATIONS): OWNER_STATEMENT items the Owner approved in his session.
CREATE FUNCTION public.sunny_record_observations_core(
  p_batch_id uuid, p_items jsonb, p_approval_basis text, p_authorization_id uuid, p_approval_ref text, p_request_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_hash text; v_auth public.sunny_tracking_authorizations; v_used integer; it jsonb; i integer := 0;
  v_res uuid; v_ent text; v_type text; v_kind text; v_src text; v_ids uuid[] := '{}'; v_id uuid; v_corr uuid;
BEGIN
  IF p_batch_id IS NULL OR p_request_key IS NULL OR p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN RAISE EXCEPTION 'INVALID_REQUEST' USING ERRCODE = '22023'; END IF;
  IF jsonb_array_length(p_items) NOT BETWEEN 1 AND 40 THEN RAISE EXCEPTION 'BATCH_SIZE: 1-40' USING ERRCODE = '22023'; END IF;
  v_hash := encode(sha256(convert_to(jsonb_build_object('b', p_batch_id, 'i', p_items, 'basis', p_approval_basis, 'auth', p_authorization_id, 'ref', p_approval_ref)::text, 'UTF8')), 'hex');
  IF EXISTS (SELECT 1 FROM public.sunny_observations WHERE request_key = p_request_key) THEN
    IF EXISTS (SELECT 1 FROM public.sunny_observations WHERE request_key = p_request_key AND payload_hash <> v_hash) THEN RAISE EXCEPTION 'REQUEST_KEY_REUSED' USING ERRCODE = '22023'; END IF;
    RETURN jsonb_build_object('replayed', true, 'ids', (SELECT jsonb_agg(id ORDER BY item_index) FROM public.sunny_observations WHERE request_key = p_request_key));
  END IF;
  IF p_approval_basis = 'TRACKING_AUTHORIZATION' THEN
    v_auth := public.sunny_auth_active(p_authorization_id);
    p_approval_ref := 'authorization:' || v_auth.id::text;
    IF v_auth.max_observations_per_day IS NOT NULL THEN
      PERFORM pg_advisory_xact_lock(hashtextextended('sunny_auth_daily_cap:' || v_auth.id::text, 0));   -- concurrent batches cannot both pass
      SELECT count(*) INTO v_used FROM public.sunny_observations
       WHERE authorization_id = v_auth.id
         AND created_at >= (public.sunny_today_il()::timestamp AT TIME ZONE 'Asia/Jerusalem')
         AND created_at <  ((public.sunny_today_il() + 1)::timestamp AT TIME ZONE 'Asia/Jerusalem');
      IF v_used + jsonb_array_length(p_items) > v_auth.max_observations_per_day THEN
        RAISE EXCEPTION 'AUTHORIZATION_DAILY_CAP: % used of % today (Israel calendar day)', v_used, v_auth.max_observations_per_day USING ERRCODE = '22023';
      END IF;
    END IF;
  ELSIF p_approval_basis = 'OWNER_APPROVAL' THEN
    IF p_authorization_id IS NOT NULL OR coalesce(p_approval_ref, '') !~ '^approval:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'INVALID_APPROVAL_BASIS' USING ERRCODE = '22023'; END IF;
  ELSE RAISE EXCEPTION 'INVALID_APPROVAL_BASIS' USING ERRCODE = '22023';
  END IF;
  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    IF jsonb_typeof(it) <> 'object' THEN RAISE EXCEPTION 'INVALID_ITEM' USING ERRCODE = '22023'; END IF;
    v_res := NULLIF(it->>'resourceId', '')::uuid; v_ent := NULLIF(it->>'entityKey', ''); v_type := it->>'type'; v_kind := it->>'sourceKind'; v_src := it->>'sourceType';
    v_corr := NULLIF(it->>'correctsId', '')::uuid;
    IF (p_approval_basis = 'TRACKING_AUTHORIZATION' AND v_src NOT IN ('EXTERNAL_SOURCE','SYSTEM_RECORD'))
       OR (p_approval_basis = 'OWNER_APPROVAL' AND v_src IS DISTINCT FROM 'OWNER_STATEMENT') THEN
      RAISE EXCEPTION 'SOURCE_NOT_ALLOWED_FOR_BASIS: % under %', v_src, p_approval_basis USING ERRCODE = '22023'; END IF;
    IF v_res IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM public.sunny_resources WHERE id = v_res) THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND: %', v_res USING ERRCODE = '22023'; END IF;
      IF EXISTS (SELECT 1 FROM public.sunny_brain_events WHERE resource_id = v_res) THEN RAISE EXCEPTION 'RESOURCE_NOT_ACTIVE: %', v_res USING ERRCODE = '22023'; END IF;
    ELSIF v_ent IS NOT NULL AND NOT public.sunny_brain_entity_ok(v_ent) THEN RAISE EXCEPTION 'ENTITY_NOT_FOUND: %', v_ent USING ERRCODE = '22023';
    END IF;
    IF p_approval_basis = 'TRACKING_AUTHORIZATION' THEN
      IF v_res IS NOT NULL AND NOT public.sunny_auth_covers_resource(v_auth, v_res) THEN RAISE EXCEPTION 'OUTSIDE_AUTHORIZATION_SUBJECT: %', v_res USING ERRCODE = '22023'; END IF;
      IF v_ent IS NOT NULL AND NOT (v_ent = ANY (v_auth.entity_keys)) THEN RAISE EXCEPTION 'OUTSIDE_AUTHORIZATION_SUBJECT: %', v_ent USING ERRCODE = '22023'; END IF;
      IF NOT (split_part(v_type, '.', 1) = ANY (v_auth.observation_families)) THEN RAISE EXCEPTION 'OUTSIDE_AUTHORIZATION_FAMILY: %', v_type USING ERRCODE = '22023'; END IF;
      IF NOT (v_kind = ANY (v_auth.source_kinds)) THEN RAISE EXCEPTION 'OUTSIDE_AUTHORIZATION_SOURCE: %', v_kind USING ERRCODE = '22023'; END IF;
    END IF;
    IF v_corr IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM public.sunny_brain_events WHERE observation_id = v_corr) THEN
        RAISE EXCEPTION 'CORRECTS_REQUIRES_INVALIDATED: invalidate the wrong reading first' USING ERRCODE = '22023'; END IF;
      IF p_approval_basis = 'TRACKING_AUTHORIZATION' AND NOT EXISTS (SELECT 1 FROM public.sunny_observations WHERE id = v_corr AND approval_basis = 'TRACKING_AUTHORIZATION') THEN
        RAISE EXCEPTION 'NEEDS_OWNER_APPROVAL: correcting an Owner-given value' USING ERRCODE = '22023'; END IF;
    END IF;
    INSERT INTO public.sunny_observations (batch_id, resource_id, entity_key, observation_type, value_num, value_text, value_bool, unit, observed_at,
        period_start, period_end, source_type, source_kind, source_ref, capture_method, confidence, approval_basis, authorization_id, approval_ref,
        corrects_id, request_key, item_index, payload_hash)
      VALUES (p_batch_id, v_res, v_ent, v_type, (it->>'valueNum')::numeric, NULLIF(btrim(it->>'valueText'), ''), (it->>'valueBool')::boolean, NULLIF(it->>'unit', ''),
        (it->>'observedAt')::timestamptz, (it->>'periodStart')::date, (it->>'periodEnd')::date, v_src, v_kind, NULLIF(it->>'sourceRef', ''),
        it->>'captureMethod', it->>'confidence', p_approval_basis, CASE WHEN p_approval_basis = 'TRACKING_AUTHORIZATION' THEN v_auth.id END, p_approval_ref,
        v_corr, p_request_key, i, v_hash)
      RETURNING id INTO v_id;
    v_ids := v_ids || v_id; i := i + 1;
  END LOOP;
  RETURN jsonb_build_object('replayed', false, 'ids', to_jsonb(v_ids));
END $$;

-- CORE D — insert typed links [{role, fromRecord|fromObs|fromRef, toRecord|toResource|toRef, noteHe}] under ONE live
-- authorization. v1 matrix (from → role → to); every record / observation endpoint must be covered by that authorization:
--   EVIDENCE_FOR / EVIDENCE_AGAINST : observation | record | ref(entity | inbox | knowledge | context)  → INSIGHT | RECOMMENDATION
--   DERIVED_FROM                    : INSIGHT → INSIGHT
--   COMPARES_TO                     : INSIGHT → resource (covered) | ref(entity in scope)
--   RECOMMENDS                      : INSIGHT → RECOMMENDATION
--   IMPLEMENTED_BY                  : RECOMMENDATION → ref plan:<action plan>
--   PRODUCED_LEARNING / TESTS / RESULT_OF : reserved (refused by CHECK and here)
--   ANY link ending at knowledge: / inbox: / context: : refused (CHECK + here) — no DB-provable Owner approval in v1.
CREATE FUNCTION public.sunny_brain_insert_links(p_links jsonb, p_auth public.sunny_tracking_authorizations, p_request_key uuid, p_offset integer) RETURNS integer
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

-- CORE E — one lifecycle move. p_actor = 'SUNNY' (from sunny_brain_transition: a live covering authorization) or 'OWNER'
-- (ONLY from T2 owner_brain_transition, after owner_approval_assert_owner(); p_approval_ref = 'session:<uid>').
-- Authorizations never move here (T2 owner_revoke_tracking_authorization / supersede through decide).
CREATE FUNCTION public.sunny_brain_transition_core(
  p_target_kind text, p_target_id uuid, p_to_status text, p_reason_he text, p_actor text, p_authorization_id uuid,
  p_approval_ref text, p_request_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_ev public.sunny_brain_events; v_rec public.sunny_intel_records; v_auth public.sunny_tracking_authorizations;
        v_from text; v_basis text; v_id uuid;
BEGIN
  IF p_target_id IS NULL OR p_request_key IS NULL OR p_actor NOT IN ('OWNER','SUNNY') THEN RAISE EXCEPTION 'INVALID_REQUEST' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_ev FROM public.sunny_brain_events WHERE request_key = p_request_key;
  IF FOUND THEN
    IF coalesce(v_ev.record_id, v_ev.observation_id, v_ev.authorization_id, v_ev.resource_id, v_ev.link_id) <> p_target_id OR v_ev.to_status <> p_to_status OR v_ev.actor <> p_actor THEN
      RAISE EXCEPTION 'REQUEST_KEY_REUSED' USING ERRCODE = '22023'; END IF;
    RETURN jsonb_build_object('eventId', v_ev.id, 'replayed', true);
  END IF;
  IF p_actor = 'SUNNY' THEN
    v_auth := public.sunny_auth_active(p_authorization_id);
    v_basis := 'TRACKING_AUTHORIZATION'; p_approval_ref := 'authorization:' || v_auth.id::text;
  ELSE
    IF p_authorization_id IS NOT NULL OR coalesce(p_approval_ref, '') !~ '^session:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'INVALID_APPROVAL_BASIS' USING ERRCODE = '22023'; END IF;
    v_basis := 'OWNER_APPROVAL';
  END IF;
  IF p_to_status = 'SUPERSEDED' THEN RAISE EXCEPTION 'USE_CREATE: supersede by creating the successor' USING ERRCODE = '22023'; END IF;
  CASE p_target_kind
    WHEN 'RECORD' THEN
      SELECT * INTO v_rec FROM public.sunny_intel_records WHERE id = p_target_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'RECORD_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
      SELECT status INTO v_from FROM public.sunny_intel_record_status WHERE record_id = p_target_id;
      IF NOT public.sunny_intel_transition_ok(v_rec.record_type, v_from, p_to_status, p_actor) THEN
        RAISE EXCEPTION 'ILLEGAL_TRANSITION: % % → % by %', v_rec.record_type, v_from, p_to_status, p_actor USING ERRCODE = '22023'; END IF;
      IF p_actor = 'SUNNY' THEN
        IF NOT public.sunny_auth_covers_subjects(v_auth, v_rec.entity_keys, v_rec.resource_ids) THEN RAISE EXCEPTION 'OUTSIDE_AUTHORIZATION_SUBJECT: record' USING ERRCODE = '22023'; END IF;
        IF (v_rec.record_type = 'INSIGHT' AND NOT v_auth.insights_allowed) OR (v_rec.record_type = 'RECOMMENDATION' AND NOT v_auth.recommendations_allowed) THEN
          RAISE EXCEPTION 'TYPE_NOT_AUTHORIZED: %', v_rec.record_type USING ERRCODE = '22023'; END IF;
      END IF;
      -- ACTED_ON only with a live IMPLEMENTED_BY link to the action plan that implemented it
      IF p_to_status = 'ACTED_ON' AND NOT EXISTS (SELECT 1 FROM public.sunny_brain_links l WHERE l.from_record_id = p_target_id AND l.role = 'IMPLEMENTED_BY'
           AND NOT EXISTS (SELECT 1 FROM public.sunny_brain_events e WHERE e.link_id = l.id)) THEN
        RAISE EXCEPTION 'ACTED_ON_NEEDS_IMPLEMENTED_BY_LINK' USING ERRCODE = '22023'; END IF;
      INSERT INTO public.sunny_brain_events (record_id, from_status, to_status, reason_he, actor, approval_basis, approval_ref, request_key)
        VALUES (p_target_id, v_from, p_to_status, NULLIF(btrim(p_reason_he), ''), p_actor, v_basis, p_approval_ref, p_request_key) RETURNING id INTO v_id;
    WHEN 'OBSERVATION' THEN
      PERFORM 1 FROM public.sunny_observations WHERE id = p_target_id FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'OBSERVATION_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
      IF p_to_status <> 'INVALIDATED' THEN RAISE EXCEPTION 'ILLEGAL_TRANSITION: observation → %', p_to_status USING ERRCODE = '22023'; END IF;
      IF p_actor = 'SUNNY' AND (NOT EXISTS (SELECT 1 FROM public.sunny_observations WHERE id = p_target_id AND approval_basis = 'TRACKING_AUTHORIZATION')
                                OR NOT public.sunny_auth_covers_observation(v_auth, p_target_id)) THEN
        RAISE EXCEPTION 'NEEDS_OWNER_APPROVAL: an Owner-given value or outside the authorization' USING ERRCODE = '42501'; END IF;
      IF EXISTS (SELECT 1 FROM public.sunny_brain_events WHERE observation_id = p_target_id) THEN RETURN jsonb_build_object('status', 'ALREADY_INVALIDATED'); END IF;
      INSERT INTO public.sunny_brain_events (observation_id, from_status, to_status, reason_he, actor, approval_basis, approval_ref, request_key)
        VALUES (p_target_id, 'VALID', p_to_status, NULLIF(btrim(p_reason_he), ''), p_actor, v_basis, p_approval_ref, p_request_key) RETURNING id INTO v_id;
    WHEN 'AUTHORIZATION' THEN
      RAISE EXCEPTION 'USE_OWNER_REVOKE: only the Owner revokes / replaces an authorization (Redbloods dashboard)' USING ERRCODE = '42501';
    WHEN 'RESOURCE' THEN
      PERFORM 1 FROM public.sunny_resources WHERE id = p_target_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
      IF p_to_status NOT IN ('RETIRED','INVALIDATED') THEN RAISE EXCEPTION 'ILLEGAL_TRANSITION: resource → %', p_to_status USING ERRCODE = '22023'; END IF;
      IF p_actor = 'SUNNY' AND (NOT EXISTS (SELECT 1 FROM public.sunny_resources WHERE id = p_target_id AND approval_basis = 'TRACKING_AUTHORIZATION')
                                OR NOT public.sunny_auth_covers_resource(v_auth, p_target_id)) THEN
        RAISE EXCEPTION 'NEEDS_OWNER_APPROVAL: an Owner-registered resource or outside the authorization' USING ERRCODE = '42501'; END IF;
      IF EXISTS (SELECT 1 FROM public.sunny_brain_events WHERE resource_id = p_target_id) THEN RETURN jsonb_build_object('status', 'ALREADY_CLOSED'); END IF;
      INSERT INTO public.sunny_brain_events (resource_id, from_status, to_status, reason_he, actor, approval_basis, approval_ref, request_key)
        VALUES (p_target_id, 'ACTIVE', p_to_status, NULLIF(btrim(p_reason_he), ''), p_actor, v_basis, p_approval_ref, p_request_key) RETURNING id INTO v_id;
    WHEN 'LINK' THEN
      PERFORM 1 FROM public.sunny_brain_links WHERE id = p_target_id FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'LINK_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
      IF p_to_status <> 'RETRACTED' THEN RAISE EXCEPTION 'ILLEGAL_TRANSITION: link → %', p_to_status USING ERRCODE = '22023'; END IF;
      IF EXISTS (SELECT 1 FROM public.sunny_brain_events WHERE link_id = p_target_id) THEN RETURN jsonb_build_object('status', 'ALREADY_RETRACTED'); END IF;
      INSERT INTO public.sunny_brain_events (link_id, from_status, to_status, reason_he, actor, approval_basis, approval_ref, request_key)
        VALUES (p_target_id, 'ACTIVE', p_to_status, NULLIF(btrim(p_reason_he), ''), p_actor, v_basis, p_approval_ref, p_request_key) RETURNING id INTO v_id;
    ELSE RAISE EXCEPTION 'INVALID_TARGET_KIND' USING ERRCODE = '22023';
  END CASE;
  RETURN jsonb_build_object('eventId', v_id, 'from', v_from, 'to', p_to_status, 'replayed', false);
END $$;

-- ═════════════════════════════ service_role wrappers (the ONLY API surface; no basis / ref / actor arguments) ═════════════════════════════

-- W1 — CONTENT (a post / video …) under an account that an ACTIVE authorization covers.
CREATE FUNCTION public.sunny_register_content(
  p_platform text, p_content_kind text, p_parent_id uuid, p_identity_key text, p_canonical_url text, p_display_name text,
  p_authorization_id uuid, p_request_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF p_authorization_id IS NULL THEN RAISE EXCEPTION 'AUTHORIZATION_REQUIRED' USING ERRCODE = '22023'; END IF;
  RETURN public.sunny_register_resource_core(p_platform, 'CONTENT', p_content_kind, p_parent_id, p_identity_key, NULL, p_canonical_url, p_display_name,
    NULL, 'TRACKING_AUTHORIZATION', p_authorization_id, 'authorization:pending', p_request_key);
END $$;

-- W2 — observations Sunny read herself (EXTERNAL_SOURCE / SYSTEM_RECORD) under an authorization. Never OWNER_STATEMENT.
CREATE FUNCTION public.sunny_record_observations(p_batch_id uuid, p_items jsonb, p_authorization_id uuid, p_request_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF p_authorization_id IS NULL THEN RAISE EXCEPTION 'AUTHORIZATION_REQUIRED' USING ERRCODE = '22023'; END IF;
  RETURN public.sunny_record_observations_core(p_batch_id, p_items, 'TRACKING_AUTHORIZATION', p_authorization_id, NULL, p_request_key);
END $$;

-- W3 — create an INSIGHT / RECOMMENDATION (+ first event OPEN + links, atomically). Links may use "$self".
-- Rules: a live authorization covering EVERY subject (≥ 1), insights_allowed / recommendations_allowed; every INSIGHT needs
-- ≥ 1 EVIDENCE_FOR; every RECOMMENDATION needs ≥ 1 grounding link (RECOMMENDS from an insight or EVIDENCE_FOR) and carries
-- the exact text presented (presentedHe). A record supersedes only its own type, only while the old one is OPEN, only
-- when the old one is covered by the same authorization.
CREATE FUNCTION public.sunny_create_intel_record(
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

-- W4 — Sunny's own lifecycle moves (always actor SUNNY under a live covering authorization).
CREATE FUNCTION public.sunny_brain_transition(
  p_target_kind text, p_target_id uuid, p_to_status text, p_reason_he text, p_authorization_id uuid, p_request_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF p_authorization_id IS NULL THEN RAISE EXCEPTION 'AUTHORIZATION_REQUIRED' USING ERRCODE = '22023'; END IF;
  RETURN public.sunny_brain_transition_core(p_target_kind, p_target_id, p_to_status, p_reason_he, 'SUNNY', p_authorization_id, NULL, p_request_key);
END $$;

-- W5 — add links to existing records later (e.g. RECOMMENDATION IMPLEMENTED_BY plan:<id>). Idempotent on request_key.
CREATE FUNCTION public.sunny_add_links(p_links jsonb, p_authorization_id uuid, p_request_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_n integer; v_auth public.sunny_tracking_authorizations;
BEGIN
  IF p_request_key IS NULL THEN RAISE EXCEPTION 'INVALID_REQUEST' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.sunny_brain_links WHERE request_key = p_request_key) THEN RETURN jsonb_build_object('replayed', true); END IF;
  v_auth := public.sunny_auth_active(p_authorization_id);
  v_n := public.sunny_brain_insert_links(p_links, v_auth, p_request_key, 0);
  RETURN jsonb_build_object('links', v_n, 'replayed', false);
END $$;

-- ═════════════════════════════ RLS + grants ═════════════════════════════
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sunny_resources','sunny_tracking_authorizations','sunny_observations','sunny_intel_records','sunny_brain_links','sunny_brain_events'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role', t);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO service_role', t);
  END LOOP;
END $$;
REVOKE ALL ON TABLE public.sunny_intel_record_status, public.sunny_observations_current FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.sunny_intel_record_status, public.sunny_observations_current TO service_role;
REVOKE ALL ON SEQUENCE public.sunny_observations_seq_seq, public.sunny_intel_records_seq_seq, public.sunny_brain_events_seq_seq FROM PUBLIC, anon, authenticated, service_role;

-- every brain function: nobody, first (Supabase default privileges grant EXECUTE on new functions to the API roles)
DO $$
DECLARE f regprocedure;
BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND (p.proname LIKE 'sunny\_brain\_%' OR p.proname LIKE 'sunny\_intel\_%' OR p.proname LIKE 'sunny\_auth\_%'
              OR p.proname IN ('sunny_today_il','sunny_canonical_url','sunny_grant_tracking_authorization','sunny_register_resource_core','sunny_register_content',
                               'sunny_record_observations','sunny_record_observations_core','sunny_create_intel_record','sunny_add_links')) LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;
END $$;
-- then exactly the 5 wrappers for service_role
GRANT EXECUTE ON FUNCTION
  public.sunny_register_content(text, text, uuid, text, text, text, uuid, uuid),
  public.sunny_record_observations(uuid, jsonb, uuid, uuid),
  public.sunny_create_intel_record(text, text[], uuid[], text, text, text, jsonb, text, text, date, uuid, text, jsonb, uuid, uuid),
  public.sunny_brain_transition(text, uuid, text, text, uuid, uuid),
  public.sunny_add_links(jsonb, uuid, uuid)
  TO service_role;

-- ═════════════════════════════ POSTCONDITIONS ═════════════════════════════
DO $$
DECLARE t text; n integer; f record; v_callers text[]; v_expected text[];
  v_wrappers constant text[] := ARRAY['sunny_add_links','sunny_brain_transition','sunny_create_intel_record','sunny_record_observations','sunny_register_content'];
BEGIN
  FOREACH t IN ARRAY ARRAY['sunny_resources','sunny_tracking_authorizations','sunny_observations','sunny_intel_records','sunny_brain_links','sunny_brain_events'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || t)::regclass) THEN RAISE EXCEPTION 'POSTCONDITION: RLS off on %', t; END IF;
    IF has_table_privilege('service_role', 'public.' || t, 'INSERT') OR has_table_privilege('service_role', 'public.' || t, 'UPDATE')
       OR has_table_privilege('service_role', 'public.' || t, 'DELETE') OR has_table_privilege('service_role', 'public.' || t, 'TRUNCATE') THEN
      RAISE EXCEPTION 'POSTCONDITION: service_role can write % directly', t; END IF;
    IF has_table_privilege('anon', 'public.' || t, 'SELECT') OR has_table_privilege('authenticated', 'public.' || t, 'SELECT')
       OR has_table_privilege('anon', 'public.' || t, 'INSERT') OR has_table_privilege('authenticated', 'public.' || t, 'INSERT') THEN
      RAISE EXCEPTION 'POSTCONDITION: % reachable by anon/authenticated', t; END IF;
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t) THEN RAISE EXCEPTION 'POSTCONDITION: unexpected policy on %', t; END IF;
    SELECT count(*) INTO n FROM pg_trigger WHERE tgrelid = ('public.' || t)::regclass AND NOT tgisinternal AND tgenabled = 'O';
    IF n <> 2 THEN RAISE EXCEPTION 'POSTCONDITION: % has % enabled triggers (expected 2)', t, n; END IF;
    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;
    IF n <> 0 THEN RAISE EXCEPTION 'POSTCONDITION: % not empty', t; END IF;
  END LOOP;
  -- function privileges: anon / authenticated execute NOTHING; service_role executes exactly the 5 wrappers
  FOR f IN SELECT p.oid, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND (p.proname LIKE 'sunny\_brain\_%' OR p.proname LIKE 'sunny\_intel\_%' OR p.proname LIKE 'sunny\_auth\_%'
              OR p.proname IN ('sunny_today_il','sunny_canonical_url','sunny_grant_tracking_authorization','sunny_register_resource_core','sunny_register_content',
                               'sunny_record_observations','sunny_record_observations_core','sunny_create_intel_record','sunny_add_links')) LOOP
    IF has_function_privilege('anon', f.oid, 'EXECUTE') OR has_function_privilege('authenticated', f.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'POSTCONDITION: % executable by anon/authenticated', f.proname; END IF;
    IF has_function_privilege('service_role', f.oid, 'EXECUTE') <> (f.proname = ANY (v_wrappers)) THEN
      RAISE EXCEPTION 'POSTCONDITION: service_role EXECUTE on % is wrong', f.proname; END IF;
  END LOOP;
  -- CALLER PINNING: the exact set of public functions whose body calls each core (T2 adds its own callers later)
  FOR f IN SELECT * FROM (VALUES
      ('sunny_grant_tracking_authorization', ARRAY[]::text[]),
      ('sunny_register_resource_core', ARRAY['sunny_register_content']),
      ('sunny_record_observations_core', ARRAY['sunny_record_observations']),
      ('sunny_brain_transition_core', ARRAY['sunny_brain_transition']),
      ('sunny_brain_insert_links', ARRAY['sunny_add_links','sunny_create_intel_record'])) AS x(core, expected) LOOP
    SELECT coalesce(array_agg(p.proname::text ORDER BY p.proname), '{}') INTO v_callers FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname <> f.core AND p.prosrc ~ ('\m' || f.core || '\M');
    SELECT coalesce(array_agg(e ORDER BY e), '{}') INTO v_expected FROM unnest(f.expected) e;
    IF v_callers IS DISTINCT FROM v_expected THEN RAISE EXCEPTION 'POSTCONDITION: callers of % are % (expected %)', f.core, v_callers, v_expected; END IF;
  END LOOP;
  -- direct writers of the event log (OWNER rows can only come from these bodies; T2 adds its own)
  SELECT coalesce(array_agg(p.proname::text ORDER BY p.proname), '{}') INTO v_callers FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prosrc ~* 'insert\s+into\s+public\.sunny_brain_events';
  IF v_callers IS DISTINCT FROM ARRAY['sunny_brain_transition_core','sunny_create_intel_record','sunny_grant_tracking_authorization'] THEN
    RAISE EXCEPTION 'POSTCONDITION: event-log writers are %', v_callers; END IF;
  -- identity: UNIQUE (platform, identity_key) and NOT a global identity_key unique
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.sunny_resources'::regclass AND conname = 'sunny_resources_identity_uk'
                 AND pg_get_constraintdef(oid) = 'UNIQUE (platform, identity_key)') THEN RAISE EXCEPTION 'POSTCONDITION: identity unique'; END IF;
  IF public.sunny_canonical_url('https://WWW.Example.com:443/a?utm_source=x&id=7#top') IS DISTINCT FROM 'https://www.example.com/a?id=7' THEN
    RAISE EXCEPTION 'POSTCONDITION: canonical url self-test'; END IF;
END $$;

COMMIT;
