-- ============================================================================================
-- OAuth scope: + partner:observe (enumerated model kept — 8 → 16).  CANDIDATE (revision v4) — NOT APPLIED TO PRODUCTION.
-- Live state (READONLY-verification B, production 2026-10-01): both scope CHECKs allow exactly the 8 canonical strings of
-- read [answer] [knowledge] [act]; no partner_mcp_* function body contains a scope literal.
-- Change (nothing else): both CHECKs allow the 16 canonical strings of read [answer] [knowledge] [observe] [act]
-- (order fixed: read, answer, knowledge, observe, act). The 8 existing strings stay valid; every stored row passes.
-- PRECONDITION (formatting-independent): each constraint's literal set is EXACTLY the old 8.
-- POSTCONDITION: full signature of both tables (columns, every other constraint, indexes, triggers, RLS, owner, grants,
-- policies, row count + scope multiset hash) and of every partner_mcp_* function (definition md5, definer, config, ACL)
-- is identical before and after.
-- ============================================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- The set of scope strings a CHECK definition allows, whichever way Postgres renders it.
CREATE FUNCTION pg_temp.scope_set(def text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $f$
  WITH lits AS (SELECT m[1] AS l FROM regexp_matches(def, '''([^'']+)''', 'g') AS m),
       els AS (SELECT e FROM lits, LATERAL unnest(CASE WHEN l LIKE '{%}' THEN l::text[] ELSE ARRAY[l] END) AS e)
  SELECT array_agg(DISTINCT e ORDER BY e) FROM els
$f$;

-- Full signature of one OAuth table EXCEPT its scope CHECK definition: columns (type, nullability, default, column ACL),
-- every other constraint (name, type, definition, validated, deferrable), the scope CHECK's NAME, indexes, triggers
-- (+ enabled), RLS / FORCE RLS, owner, table ACL, policies (every field), row count + multiset hash of the scope column
-- (no token / secret column is read). Plus, globally: every partner_mcp_* function (definition md5, security definer,
-- config, ACL). Before and after must be identical.
CREATE FUNCTION pg_temp.oauth_sig(t text) RETURNS text LANGUAGE plpgsql STABLE AS $f$
DECLARE s text; r text;
BEGIN
  SELECT concat_ws(E'\n',
    (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull || ':' || coalesce(pg_get_expr(d.adbin, d.adrelid), '-')
                       || ':' || coalesce(a.attacl::text, '-') || ':' || a.attidentity::text || a.attgenerated::text, '|' ORDER BY a.attnum)
       FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = ('public.' || t)::regclass AND a.attnum > 0 AND NOT a.attisdropped),
    (SELECT string_agg(c.conname || ':' || c.contype::text || ':' || CASE WHEN c.conname = t || '_scope_check' THEN '<SCOPE>' ELSE pg_get_constraintdef(c.oid) END
                       || ':' || c.convalidated || ':' || c.condeferrable || ':' || c.condeferred, '|' ORDER BY c.conname)
       FROM pg_constraint c WHERE c.conrelid = ('public.' || t)::regclass),
    (SELECT string_agg(indexdef, '|' ORDER BY indexname) FROM pg_indexes WHERE schemaname = 'public' AND tablename = t),
    (SELECT coalesce(string_agg(tg.tgname || ':' || tg.tgenabled::text || ':' || pg_get_triggerdef(tg.oid), '|' ORDER BY tg.tgname), '-') FROM pg_trigger tg
      WHERE tg.tgrelid = ('public.' || t)::regclass AND NOT tg.tgisinternal),
    (SELECT relrowsecurity || ':' || relforcerowsecurity || ':' || relowner::regrole::text || ':' || coalesce(relacl::text, '-') || ':' || relkind::text
       FROM pg_class WHERE oid = ('public.' || t)::regclass),
    (SELECT coalesce(string_agg(policyname || ':' || permissive || ':' || roles::text || ':' || cmd || ':' || coalesce(qual, '-') || ':' || coalesce(with_check, '-'), '|' ORDER BY policyname), '-')
       FROM pg_policies WHERE schemaname = 'public' AND tablename = t)) INTO s;
  EXECUTE format('SELECT count(*)::text || '':'' || coalesce(md5(string_agg(scope, ''|'' ORDER BY scope)), ''-'') FROM public.%I', t) INTO r;
  RETURN s || E'\n' || r;
END $f$;
CREATE FUNCTION pg_temp.mcp_functions_sig() RETURNS text LANGUAGE sql STABLE AS $f$
  SELECT coalesce(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)) || ':' || p.prosecdef || ':' || coalesce(p.proconfig::text, '-')
                             || ':' || coalesce(p.proacl::text, '-') || ':' || p.proowner::regrole::text, '|' ORDER BY p.oid::regprocedure::text), '-')
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'partner\_mcp\_%'
$f$;

CREATE TEMP TABLE scope_snapshot ON COMMIT DROP AS
  SELECT t, pg_temp.oauth_sig(t) AS sig FROM unnest(ARRAY['partner_mcp_auth_codes','partner_mcp_tokens']) AS t
  UNION ALL SELECT '<functions>', pg_temp.mcp_functions_sig();

DO $$
DECLARE
  v_from text[] := ARRAY['partner:read','partner:read partner:answer','partner:read partner:knowledge','partner:read partner:act',
    'partner:read partner:answer partner:knowledge','partner:read partner:answer partner:act','partner:read partner:knowledge partner:act',
    'partner:read partner:answer partner:knowledge partner:act'];
  v_to   text[] := ARRAY['partner:read','partner:read partner:answer','partner:read partner:knowledge','partner:read partner:observe','partner:read partner:act',
    'partner:read partner:answer partner:knowledge','partner:read partner:answer partner:observe','partner:read partner:answer partner:act',
    'partner:read partner:knowledge partner:observe','partner:read partner:knowledge partner:act','partner:read partner:observe partner:act',
    'partner:read partner:answer partner:knowledge partner:observe','partner:read partner:answer partner:knowledge partner:act',
    'partner:read partner:answer partner:observe partner:act','partner:read partner:knowledge partner:observe partner:act',
    'partner:read partner:answer partner:knowledge partner:observe partner:act'];
  t text; c text; def text;
BEGIN
  FOREACH t IN ARRAY ARRAY['partner_mcp_auth_codes','partner_mcp_tokens'] LOOP
    c := t || '_scope_check';
    SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint WHERE conrelid = ('public.' || t)::regclass AND conname = c AND contype = 'c';
    IF def IS NULL THEN RAISE EXCEPTION 'PRECONDITION: % missing', c; END IF;
    IF pg_temp.scope_set(def) IS DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(v_from) x) THEN
      RAISE EXCEPTION 'PRECONDITION: % is not exactly the verified 8-scope definition: %', c, def; END IF;
    IF (SELECT count(*) FROM pg_constraint WHERE conrelid = ('public.' || t)::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%partner:%') <> 1 THEN
      RAISE EXCEPTION 'PRECONDITION: % has more than one scope CHECK', t; END IF;
    -- IN (…) in the canonical order renders exactly like the live definition (CHECK ((scope = ANY (ARRAY['…'::text, …]))))
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I, ADD CONSTRAINT %I CHECK (scope IN (%s))', t, c, c,
      (SELECT string_agg(quote_literal(x), ', ' ORDER BY o) FROM unnest(v_to) WITH ORDINALITY AS u(x, o)));
    SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint WHERE conrelid = ('public.' || t)::regclass AND conname = c AND contype = 'c';
    IF pg_temp.scope_set(def) IS DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(v_to) x) THEN
      RAISE EXCEPTION 'POSTCONDITION: % is not the 16-scope set: %', c, def; END IF;
  END LOOP;
  -- the ONLY change: the two scope CHECK definitions. Everything else on both tables and every partner_mcp_* function is identical.
  IF EXISTS (SELECT 1 FROM scope_snapshot s WHERE s.sig IS DISTINCT FROM CASE WHEN s.t = '<functions>' THEN pg_temp.mcp_functions_sig() ELSE pg_temp.oauth_sig(s.t) END) THEN
    RAISE EXCEPTION 'POSTCONDITION: something other than the scope CHECKs changed'; END IF;
END $$;
COMMIT;
