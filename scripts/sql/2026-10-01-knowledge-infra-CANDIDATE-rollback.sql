-- Rollback of 2026-10-01-knowledge-infra-CANDIDATE.sql. CANDIDATE — NOT APPLIED.
-- Refuses to run while any row uses the new kinds / known: keys (the table is append-only; rows are never deleted).
-- The constraints to replace are located ONLY by their EXACT definitions (what the forward created); any difference aborts before any ALTER.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $r$
declare
  new_kind constant text := $d$CHECK ((kind = ANY (ARRAY['ENTITY_ALIAS'::text, 'ORGANIZATIONAL_ROLE'::text, 'ENTITY_RELATIONSHIP'::text, 'PROJECT_BLOCKER'::text, 'FOLLOW_UP_EXPECTATION'::text, 'VENDOR_COMMITMENT'::text, 'RELEASE_PRIORITY'::text, 'PAYMENT_REPORTED_BY_OWNER'::text, 'PROCESS_FRICTION'::text, 'WORKING_POLICY_CANDIDATE'::text, 'ENTITY_CLASSIFICATION'::text, 'KNOWN_ENTITY'::text])))$d$;
  new_subj constant text := $d$CHECK ((subject_key ~ '^((project|client|label-artist|dj|show|release):[0-9a-f-]{36}|vendor:(VICTOR|STEVEN)|company:REDBLOODS|known:[a-z0-9][a-z0-9-]{1,62})$'::text))$d$;
  old_kind constant text := $d$CHECK ((kind = ANY (ARRAY['ENTITY_ALIAS'::text, 'ORGANIZATIONAL_ROLE'::text, 'ENTITY_RELATIONSHIP'::text, 'PROJECT_BLOCKER'::text, 'FOLLOW_UP_EXPECTATION'::text, 'VENDOR_COMMITMENT'::text, 'RELEASE_PRIORITY'::text, 'PAYMENT_REPORTED_BY_OWNER'::text, 'PROCESS_FRICTION'::text, 'WORKING_POLICY_CANDIDATE'::text])))$d$;
  old_subj constant text := $d$CHECK ((subject_key ~ '^((project|client|label-artist|dj|show|release):[0-9a-f-]{36}|vendor:(VICTOR|STEVEN)|company:REDBLOODS)$'::text))$d$;
  kind_names text[]; subj_names text[];
begin
  if exists (select 1 from public.partner_owner_knowledge where kind in ('ENTITY_CLASSIFICATION', 'KNOWN_ENTITY') or subject_key like 'known:%') then
    raise exception 'ROLLBACK REFUSED: rows already use the new kinds / known: keys';
  end if;

  select array_agg(conname order by conname) into kind_names from pg_constraint
   where conrelid = 'public.partner_owner_knowledge'::regclass and contype = 'c' and pg_get_constraintdef(oid) = new_kind;
  if kind_names is null or cardinality(kind_names) <> 1 then raise exception 'PRECONDITION: the live kind CHECK is not exactly the forward definition (found % matches)', coalesce(cardinality(kind_names), 0); end if;

  select array_agg(conname order by conname) into subj_names from pg_constraint
   where conrelid = 'public.partner_owner_knowledge'::regclass and contype = 'c' and pg_get_constraintdef(oid) = new_subj;
  if subj_names is null or cardinality(subj_names) <> 1 then raise exception 'PRECONDITION: the live subject_key CHECK is not exactly the forward definition (found % matches)', coalesce(cardinality(subj_names), 0); end if;

  execute format('alter table public.partner_owner_knowledge drop constraint %I, add constraint %I check (kind in (%L, %L, %L, %L, %L, %L, %L, %L, %L, %L))', kind_names[1], kind_names[1],
    'ENTITY_ALIAS', 'ORGANIZATIONAL_ROLE', 'ENTITY_RELATIONSHIP', 'PROJECT_BLOCKER', 'FOLLOW_UP_EXPECTATION', 'VENDOR_COMMITMENT', 'RELEASE_PRIORITY', 'PAYMENT_REPORTED_BY_OWNER', 'PROCESS_FRICTION', 'WORKING_POLICY_CANDIDATE');
  execute format('alter table public.partner_owner_knowledge drop constraint %I, add constraint %I check (subject_key ~ %L)', subj_names[1], subj_names[1],
    '^((project|client|label-artist|dj|show|release):[0-9a-f-]{36}|vendor:(VICTOR|STEVEN)|company:REDBLOODS)$');

  -- postcondition: back to exactly the original approved definitions
  if (select count(*) from pg_constraint where conrelid = 'public.partner_owner_knowledge'::regclass and contype = 'c' and pg_get_constraintdef(oid) = old_kind) <> 1 then raise exception 'POSTCONDITION: kind CHECK is not exactly the original definition'; end if;
  if (select count(*) from pg_constraint where conrelid = 'public.partner_owner_knowledge'::regclass and contype = 'c' and pg_get_constraintdef(oid) = old_subj) <> 1 then raise exception 'POSTCONDITION: subject_key CHECK is not exactly the original definition'; end if;
end
$r$;

commit;
