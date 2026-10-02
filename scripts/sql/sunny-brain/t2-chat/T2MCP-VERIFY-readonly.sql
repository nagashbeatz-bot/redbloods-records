-- T2 chat decision — VERIFY after the candidate (READ-ONLY: SELECT only). Every row must say OK.
SELECT 'decide_core exists, EXECUTE: nobody' AS check_name,
  CASE WHEN to_regprocedure('public.owner_approval_decide_core(uuid,text,uuid,text,text,jsonb,text)') IS NOT NULL
   AND NOT has_function_privilege('service_role', 'public.owner_approval_decide_core(uuid,text,uuid,text,text,jsonb,text)', 'EXECUTE')
   AND NOT has_function_privilege('authenticated', 'public.owner_approval_decide_core(uuid,text,uuid,text,text,jsonb,text)', 'EXECUTE')
   AND NOT has_function_privilege('anon', 'public.owner_approval_decide_core(uuid,text,uuid,text,text,jsonb,text)', 'EXECUTE') THEN 'OK' ELSE 'FAIL' END AS result
UNION ALL SELECT 'decide (dashboard): authenticated only',
  CASE WHEN has_function_privilege('authenticated', 'public.owner_approval_decide(uuid,text,text,jsonb,text)', 'EXECUTE')
   AND NOT has_function_privilege('service_role', 'public.owner_approval_decide(uuid,text,text,jsonb,text)', 'EXECUTE')
   AND NOT has_function_privilege('anon', 'public.owner_approval_decide(uuid,text,text,jsonb,text)', 'EXECUTE') THEN 'OK' ELSE 'FAIL' END
UNION ALL SELECT 'decide_mcp: service_role only, no p_approved',
  CASE WHEN has_function_privilege('service_role', 'public.owner_approval_decide_mcp(text,uuid,text,text,text)', 'EXECUTE')
   AND NOT has_function_privilege('authenticated', 'public.owner_approval_decide_mcp(text,uuid,text,text,text)', 'EXECUTE')
   AND NOT has_function_privilege('anon', 'public.owner_approval_decide_mcp(text,uuid,text,text,text)', 'EXECUTE')
   AND pg_get_function_identity_arguments('public.owner_approval_decide_mcp(text,uuid,text,text,text)'::regprocedure) !~ 'approved' THEN 'OK' ELSE 'FAIL' END
UNION ALL SELECT 'decide_core callers = decide, decide_mcp',
  CASE WHEN (SELECT string_agg(proname, ',' ORDER BY proname) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND prosrc ~ '\mowner_approval_decide_core\M' AND proname <> 'owner_approval_decide_core')
   = 'owner_approval_decide,owner_approval_decide_mcp' THEN 'OK' ELSE 'FAIL' END
UNION ALL SELECT 'decided_role CHECK includes mcp_owner_token',
  CASE WHEN (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.owner_approval_decisions'::regclass AND conname = 'owner_approval_decisions_decided_role_check') ~ 'mcp_owner_token' THEN 'OK' ELSE 'FAIL' END
UNION ALL SELECT 'service_role still cannot read principals / write decisions',
  CASE WHEN NOT has_table_privilege('service_role', 'public.owner_approval_principals', 'SELECT')
   AND NOT has_table_privilege('service_role', 'public.owner_approval_decisions', 'INSERT') THEN 'OK' ELSE 'FAIL' END
UNION ALL SELECT 'service_role still cannot read partner_mcp_tokens',
  CASE WHEN NOT has_table_privilege('service_role', 'public.partner_mcp_tokens', 'SELECT') THEN 'OK' ELSE 'FAIL' END
UNION ALL SELECT 'info: decisions by role', coalesce((SELECT string_agg(decided_role || '=' || n, ', ') FROM (SELECT decided_role, count(*) n FROM public.owner_approval_decisions GROUP BY 1) x), 'none');
