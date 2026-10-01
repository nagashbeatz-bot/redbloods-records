-- ============================================================================================
-- Sunny knowledge infrastructure (entity relationships / classifications / known entities / provenance): FORWARD migration.
-- CANDIDATE — NOT APPLIED. Apply only after the Owner approves this file's exact SHA-256.
--
-- Changes (nothing else), table public.partner_owner_knowledge ONLY:
--   1 kind CHECK            : + 'ENTITY_CLASSIFICATION', + 'KNOWN_ENTITY'   (the 10 existing kinds stay, unchanged)
--   2 subject_key CHECK     : + 'known:<slug>'   (a controlled identity declared through a KNOWN_ENTITY row; for
--                              an entity that has no canonical Redbloods record, e.g. NagashBeatz)
-- NOT changed: columns, epistemic CHECK, provenance CHECK, value CHECK, indexes, FKs, triggers (append-only),
--   RLS, grants, other tables, existing rows (none are rewritten; the new CHECKs are validated against them).
-- Provenance (OWNER_STATEMENT / SYSTEM_RECORD / EXTERNAL_SOURCE / INFERRED), confidence, validFrom / validUntil,
-- status are stored INSIDE the existing typed `value` jsonb — no column is added.
-- Each constraint is located by its EXACT live pg_get_constraintdef text (the approved old definition); any difference aborts before any ALTER.
-- ============================================================================================
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create temp table ki_snapshot on commit drop as
select (select count(*) from public.partner_owner_knowledge) as n_rows,
       (select md5(string_agg(id::text || kind || subject_key || slot_key || value::text, '|' order by id)) from public.partner_owner_knowledge) as rows_sig,
       (select string_agg(tablename || ':' || policyname || ':' || cmd, '|' order by tablename, policyname) from pg_policies where schemaname = 'public') as pol_sig,
       (select string_agg(contype::text || ':' || count, ',' order by contype) from (select contype, count(*) from pg_constraint where conrelid = 'public.partner_owner_knowledge'::regclass group by contype) c) as con_sig;

do $fwd$
declare
  -- the EXACT live definitions (read-only pre-check 2026-10-01) — any drift aborts before any ALTER
  old_kind constant text := $d$CHECK ((kind = ANY (ARRAY['ENTITY_ALIAS'::text, 'ORGANIZATIONAL_ROLE'::text, 'ENTITY_RELATIONSHIP'::text, 'PROJECT_BLOCKER'::text, 'FOLLOW_UP_EXPECTATION'::text, 'VENDOR_COMMITMENT'::text, 'RELEASE_PRIORITY'::text, 'PAYMENT_REPORTED_BY_OWNER'::text, 'PROCESS_FRICTION'::text, 'WORKING_POLICY_CANDIDATE'::text])))$d$;
  old_subj constant text := $d$CHECK ((subject_key ~ '^((project|client|label-artist|dj|show|release):[0-9a-f-]{36}|vendor:(VICTOR|STEVEN)|company:REDBLOODS)$'::text))$d$;
  kind_names text[]; subj_names text[];
begin
  select array_agg(conname order by conname) into kind_names from pg_constraint
   where conrelid = 'public.partner_owner_knowledge'::regclass and contype = 'c' and pg_get_constraintdef(oid) = old_kind;
  if kind_names is null or cardinality(kind_names) <> 1 then raise exception 'PRECONDITION: the live kind CHECK is not exactly the approved definition (found % matches)', coalesce(cardinality(kind_names), 0); end if;

  select array_agg(conname order by conname) into subj_names from pg_constraint
   where conrelid = 'public.partner_owner_knowledge'::regclass and contype = 'c' and pg_get_constraintdef(oid) = old_subj;
  if subj_names is null or cardinality(subj_names) <> 1 then raise exception 'PRECONDITION: the live subject_key CHECK is not exactly the approved definition (found % matches)', coalesce(cardinality(subj_names), 0); end if;

  execute format('alter table public.partner_owner_knowledge drop constraint %I, add constraint %I check (kind in (%L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L))',
    kind_names[1], kind_names[1],
    'ENTITY_ALIAS', 'ORGANIZATIONAL_ROLE', 'ENTITY_RELATIONSHIP', 'PROJECT_BLOCKER', 'FOLLOW_UP_EXPECTATION', 'VENDOR_COMMITMENT',
    'RELEASE_PRIORITY', 'PAYMENT_REPORTED_BY_OWNER', 'PROCESS_FRICTION', 'WORKING_POLICY_CANDIDATE', 'ENTITY_CLASSIFICATION', 'KNOWN_ENTITY');

  execute format('alter table public.partner_owner_knowledge drop constraint %I, add constraint %I check (subject_key ~ %L)',
    subj_names[1], subj_names[1],
    '^((project|client|label-artist|dj|show|release):[0-9a-f-]{36}|vendor:(VICTOR|STEVEN)|company:REDBLOODS|known:[a-z0-9][a-z0-9-]{1,62})$');
end
$fwd$;

do $post$
declare
  -- the EXACT definitions the forward must have created
  new_kind constant text := $d$CHECK ((kind = ANY (ARRAY['ENTITY_ALIAS'::text, 'ORGANIZATIONAL_ROLE'::text, 'ENTITY_RELATIONSHIP'::text, 'PROJECT_BLOCKER'::text, 'FOLLOW_UP_EXPECTATION'::text, 'VENDOR_COMMITMENT'::text, 'RELEASE_PRIORITY'::text, 'PAYMENT_REPORTED_BY_OWNER'::text, 'PROCESS_FRICTION'::text, 'WORKING_POLICY_CANDIDATE'::text, 'ENTITY_CLASSIFICATION'::text, 'KNOWN_ENTITY'::text])))$d$;
  new_subj constant text := $d$CHECK ((subject_key ~ '^((project|client|label-artist|dj|show|release):[0-9a-f-]{36}|vendor:(VICTOR|STEVEN)|company:REDBLOODS|known:[a-z0-9][a-z0-9-]{1,62})$'::text))$d$;
  s record;
begin
  select * into s from ki_snapshot;
  if s.n_rows <> (select count(*) from public.partner_owner_knowledge) then raise exception 'POSTCONDITION: row count changed'; end if;
  if s.rows_sig is distinct from (select md5(string_agg(id::text || kind || subject_key || slot_key || value::text, '|' order by id)) from public.partner_owner_knowledge) then raise exception 'POSTCONDITION: rows changed'; end if;
  if s.pol_sig is distinct from (select string_agg(tablename || ':' || policyname || ':' || cmd, '|' order by tablename, policyname) from pg_policies where schemaname = 'public') then raise exception 'POSTCONDITION: policies changed'; end if;
  if has_table_privilege('service_role', 'public.partner_owner_knowledge', 'UPDATE') or has_table_privilege('service_role', 'public.partner_owner_knowledge', 'DELETE') then raise exception 'POSTCONDITION: privileges'; end if;
  if (select count(*) from pg_constraint where conrelid = 'public.partner_owner_knowledge'::regclass and contype = 'c' and pg_get_constraintdef(oid) = new_kind) <> 1 then raise exception 'POSTCONDITION: kind CHECK is not exactly the new definition'; end if;
  if (select count(*) from pg_constraint where conrelid = 'public.partner_owner_knowledge'::regclass and contype = 'c' and pg_get_constraintdef(oid) = new_subj) <> 1 then raise exception 'POSTCONDITION: subject_key CHECK is not exactly the new definition'; end if;
  -- two CHECKs replaced by two CHECKs: the per-type constraint counts (c / f / p / u) are identical before and after
  if s.con_sig is distinct from (select string_agg(contype::text || ':' || count, ',' order by contype) from (select contype, count(*) from pg_constraint where conrelid = 'public.partner_owner_knowledge'::regclass group by contype) c) then raise exception 'POSTCONDITION: constraint counts changed'; end if;
end
$post$;

commit;
