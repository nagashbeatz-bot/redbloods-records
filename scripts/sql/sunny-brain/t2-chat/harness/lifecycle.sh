#!/bin/bash
# LOCAL ONLY. Migration lifecycle: dry-run leaves nothing, apply, re-run refused, existing T2 suite still green,
# rollback refused after a chat decision, rollback on a DB without chat decisions restores the exact original.
cd "$(dirname "$0")/../.."
P="psql -h /tmp -p 54329 -U postgres -X -q -v ON_ERROR_STOP=1"; Q="psql -h /tmp -p 54329 -U postgres -X -tA"
F=t2mcp/2026-10-XX-t2-mcp-owner-decide-CANDIDATE; pass=0; fail=0
ok() { if [ "$2" = "$3" ]; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL $1: got [$2] want [$3]"; fi; }
sig() { $Q -d $1 -c "select md5(string_agg(p.proname||':'||md5(p.prosrc)||':'||coalesce(p.proacl::text,''), '|' order by p.proname)) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname like 'owner_approval%'" -c "select md5(string_agg(conname||pg_get_constraintdef(oid),'|' order by conname)) from pg_constraint where conrelid='public.owner_approval_decisions'::regclass" | tr '\n' ' '; }
harness/fresh.sh l1 brain t2 seed p2 scope 2>/dev/null; $P -d l1 -f t2mcp/harness/aug-tokens.sql
before=$(sig l1)
$P -d l1 -f $F-DRYRUN.sql >/dev/null 2>&1; ok "dry-run exits clean" $? 0
ok "dry-run leaves nothing" "$(sig l1)" "$before"
ok "decide md5 = applied" "$($Q -d l1 -c "select md5(prosrc) from pg_proc where oid='public.owner_approval_decide(uuid,text,text,jsonb,text)'::regprocedure")" c0a7f209ed4a7651b2220697a3c31979
$P -d l1 -f $F.sql >/dev/null 2>&1; ok "apply" $? 0
after=$(sig l1)
$P -d l1 -f $F.sql >/dev/null 2>&1; ok "re-run refused by precondition" $? 3
ok "re-run changed nothing" "$(sig l1)" "$after"
$P -d l1 -f $F-rollback-DRYRUN.sql >/dev/null 2>&1; ok "rollback dry-run exits clean" $? 0
ok "rollback dry-run leaves migration in place" "$(sig l1)" "$after"
$P -d l1 -f $F-rollback.sql >/dev/null 2>&1; ok "rollback (no chat decisions)" $? 0
ok "rollback restores the exact original" "$(sig l1)" "$before"
$P -d l1 -f $F.sql >/dev/null 2>&1; ok "re-apply after rollback" $? 0
ok "re-apply = same result" "$(sig l1)" "$after"
# existing T2/Brain security suite on the migrated DB
$P -d l1 -f tests/10-security.sql -o /dev/null 2>/dev/null
ok "existing security suite after migration: 0 failures" "$($Q -d l1 -c "select count(*) filter (where not ok) from t.results")" 0
echo "existing suite passed: $($Q -d l1 -c "select count(*) filter (where ok) from t.results")"
$Q -d l1 -c "select 'FAIL-old '||suite||' | '||name||' | '||coalesce(detail,'') from t.results where not ok"
# rollback refused once a chat decision exists (mc has them from run.sh)
mcafter=$(sig mc)
$P -d mc -f $F-rollback.sql >/dev/null 2>&1; ok "rollback refused after chat decisions" $? 3
ok "refused rollback changed nothing" "$(sig mc)" "$mcafter"
echo "lifecycle: $pass passed, $fail failed"
