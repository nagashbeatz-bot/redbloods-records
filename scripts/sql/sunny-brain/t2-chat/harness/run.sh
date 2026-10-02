#!/bin/bash
# LOCAL ONLY. Builds a harness DB, applies the production-shaped token stub + the candidate, runs the security suite.
cd "$(dirname "$0")/../.."
P="psql -h /tmp -p 54329 -U postgres -X -q -v ON_ERROR_STOP=1"
harness/fresh.sh mc brain t2 seed p2 scope 2>/dev/null
$P -d mc -f t2mcp/harness/aug-tokens.sql
$P -d mc -f t2mcp/2026-10-XX-t2-mcp-owner-decide-CANDIDATE.sql 2>&1 | grep -v NOTICE
$P -d mc -f t2mcp/harness/test-t2mcp.sql -o /dev/null 2>&1 | grep -v NOTICE
$P -d mc -tA -c "select suite||': '||count(*) filter (where ok)||' ok, '||count(*) filter (where not ok)||' fail' from t.results group by suite order by min(n)" -c "select 'FAIL '||name||' | '||coalesce(detail,'') from t.results where not ok"
