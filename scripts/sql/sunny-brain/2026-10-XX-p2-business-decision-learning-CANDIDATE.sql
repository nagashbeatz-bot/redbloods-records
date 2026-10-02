-- ============================================================================================
-- P2 (partner_owner_knowledge): + BUSINESS_DECISION, + BUSINESS_LEARNING kinds.  CANDIDATE (revision v4) — NOT APPLIED TO PRODUCTION.
-- Decision Memory and owner-approved Learnings REUSE the existing Owner-knowledge lifecycle (append-only, slot supersession,
-- WITHDRAW, status / validFrom / validUntil, review_at, provenance, T1-hardened Owner approval).
-- Change (nothing else): the kind CHECK = the 12 live kinds + BUSINESS_DECISION + BUSINESS_LEARNING (constraint name kept).
-- PRECONDITION: the live kind CHECK is EXACTLY the knowledge-infra definition (production read-only check A2 = 1).
-- POSTCONDITION: a full signature snapshot (columns + defaults + column ACLs, every other CHECK / FK / UNIQUE / PK with
-- its name, indexes, triggers + enabled state, RLS / FORCE RLS, owner, grants, policies, rows count + hash) is identical
-- before and after; only the kind CHECK definition differs.
-- ============================================================================================
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Full signature of public.partner_owner_knowledge EXCEPT the one kind CHECK: columns (type, nullability, default,
-- column ACL), every other constraint (name, type, definition, validated, deferrable), the kind constraint's NAME and type,
-- indexes, triggers (definition + enabled state), RLS / FORCE RLS, owner, table ACL, policies (every field), row count +
-- row hash. Before and after must be byte-identical; only the kind CHECK definition may differ.
CREATE FUNCTION pg_temp.p2_sig(p_kind_def text) RETURNS text LANGUAGE sql STABLE AS $f$
  SELECT concat_ws(E'\n',
    (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull || ':' || coalesce(pg_get_expr(d.adbin, d.adrelid), '-')
                       || ':' || coalesce(a.attacl::text, '-') || ':' || a.attidentity::text || a.attgenerated::text, '|' ORDER BY a.attnum)
       FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = 'public.partner_owner_knowledge'::regclass AND a.attnum > 0 AND NOT a.attisdropped),
    (SELECT string_agg(c.conname || ':' || c.contype::text || ':' || CASE WHEN pg_get_constraintdef(c.oid) = p_kind_def THEN '<KIND>' ELSE pg_get_constraintdef(c.oid) END
                       || ':' || c.convalidated || ':' || c.condeferrable || ':' || c.condeferred, '|' ORDER BY c.conname)
       FROM pg_constraint c WHERE c.conrelid = 'public.partner_owner_knowledge'::regclass),
    (SELECT count(*)::text FROM pg_constraint c WHERE c.conrelid = 'public.partner_owner_knowledge'::regclass AND pg_get_constraintdef(c.oid) = p_kind_def),
    (SELECT string_agg(indexdef, '|' ORDER BY indexname) FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'partner_owner_knowledge'),
    (SELECT string_agg(t.tgname || ':' || t.tgenabled::text || ':' || pg_get_triggerdef(t.oid), '|' ORDER BY t.tgname) FROM pg_trigger t
      WHERE t.tgrelid = 'public.partner_owner_knowledge'::regclass AND NOT t.tgisinternal),
    (SELECT relrowsecurity || ':' || relforcerowsecurity || ':' || relowner::regrole::text || ':' || coalesce(relacl::text, '-') || ':' || relkind::text || ':' || relreplident::text
       FROM pg_class WHERE oid = 'public.partner_owner_knowledge'::regclass),
    (SELECT coalesce(string_agg(policyname || ':' || permissive || ':' || roles::text || ':' || cmd || ':' || coalesce(qual, '-') || ':' || coalesce(with_check, '-'), '|' ORDER BY policyname), '-')
       FROM pg_policies WHERE schemaname = 'public' AND tablename = 'partner_owner_knowledge'),
    (SELECT count(*)::text || ':' || coalesce(md5(string_agg(id::text || kind || subject_key || slot_key || value::text, '|' ORDER BY id)), '-') FROM public.partner_owner_knowledge))
$f$;

create temp table p2_snapshot on commit drop as select pg_temp.p2_sig($d$CHECK ((kind = ANY (ARRAY['ENTITY_ALIAS'::text, 'ORGANIZATIONAL_ROLE'::text, 'ENTITY_RELATIONSHIP'::text, 'PROJECT_BLOCKER'::text, 'FOLLOW_UP_EXPECTATION'::text, 'VENDOR_COMMITMENT'::text, 'RELEASE_PRIORITY'::text, 'PAYMENT_REPORTED_BY_OWNER'::text, 'PROCESS_FRICTION'::text, 'WORKING_POLICY_CANDIDATE'::text, 'ENTITY_CLASSIFICATION'::text, 'KNOWN_ENTITY'::text])))$d$) as sig;

do $$
declare
  old_def constant text := $d$CHECK ((kind = ANY (ARRAY['ENTITY_ALIAS'::text, 'ORGANIZATIONAL_ROLE'::text, 'ENTITY_RELATIONSHIP'::text, 'PROJECT_BLOCKER'::text, 'FOLLOW_UP_EXPECTATION'::text, 'VENDOR_COMMITMENT'::text, 'RELEASE_PRIORITY'::text, 'PAYMENT_REPORTED_BY_OWNER'::text, 'PROCESS_FRICTION'::text, 'WORKING_POLICY_CANDIDATE'::text, 'ENTITY_CLASSIFICATION'::text, 'KNOWN_ENTITY'::text])))$d$;
  names text[];
begin
  select array_agg(conname) into names from pg_constraint
   where conrelid = 'public.partner_owner_knowledge'::regclass and contype = 'c' and pg_get_constraintdef(oid) = old_def;
  if names is null or cardinality(names) <> 1 then raise exception 'PRECONDITION: the live kind CHECK is not exactly the expected definition (found % matches)', coalesce(cardinality(names), 0); end if;
  execute format('alter table public.partner_owner_knowledge drop constraint %I, add constraint %I check (kind in (%L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L))',
    names[1], names[1],
    'ENTITY_ALIAS', 'ORGANIZATIONAL_ROLE', 'ENTITY_RELATIONSHIP', 'PROJECT_BLOCKER', 'FOLLOW_UP_EXPECTATION', 'VENDOR_COMMITMENT',
    'RELEASE_PRIORITY', 'PAYMENT_REPORTED_BY_OWNER', 'PROCESS_FRICTION', 'WORKING_POLICY_CANDIDATE', 'ENTITY_CLASSIFICATION', 'KNOWN_ENTITY',
    'BUSINESS_DECISION', 'BUSINESS_LEARNING');
end $$;

do $$
declare
  new_def constant text := $d$CHECK ((kind = ANY (ARRAY['ENTITY_ALIAS'::text, 'ORGANIZATIONAL_ROLE'::text, 'ENTITY_RELATIONSHIP'::text, 'PROJECT_BLOCKER'::text, 'FOLLOW_UP_EXPECTATION'::text, 'VENDOR_COMMITMENT'::text, 'RELEASE_PRIORITY'::text, 'PAYMENT_REPORTED_BY_OWNER'::text, 'PROCESS_FRICTION'::text, 'WORKING_POLICY_CANDIDATE'::text, 'ENTITY_CLASSIFICATION'::text, 'KNOWN_ENTITY'::text, 'BUSINESS_DECISION'::text, 'BUSINESS_LEARNING'::text])))$d$;
begin
  if (select count(*) from pg_constraint where conrelid = 'public.partner_owner_knowledge'::regclass and contype = 'c' and pg_get_constraintdef(oid) = new_def) <> 1 then
    raise exception 'POSTCONDITION: kind CHECK is not exactly the new definition'; end if;
  -- the ONLY difference: the kind CHECK definition (same name, same everything else, same rows)
  if (select sig from p2_snapshot) is distinct from pg_temp.p2_sig(new_def) then
    raise exception 'POSTCONDITION: something other than the kind CHECK changed on partner_owner_knowledge'; end if;
  if has_table_privilege('service_role', 'public.partner_owner_knowledge', 'UPDATE') or has_table_privilege('service_role', 'public.partner_owner_knowledge', 'DELETE') then
    raise exception 'POSTCONDITION: privileges'; end if;
end $$;
commit;
