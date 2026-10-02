-- T2 chat decision — PREFLIGHT (READ-ONLY: SELECT only; changes nothing). Run before the candidate; every row must say OK.
SELECT 'decide body = the applied T2' AS check_name,
  CASE WHEN md5(prosrc) = 'c0a7f209ed4a7651b2220697a3c31979' THEN 'OK' ELSE 'STOP: ' || md5(prosrc) END AS result
  FROM pg_proc WHERE oid = to_regprocedure('public.owner_approval_decide(uuid,text,text,jsonb,text)')
UNION ALL SELECT 'decide_core / decide_mcp absent',
  CASE WHEN to_regprocedure('public.owner_approval_decide_core(uuid,text,uuid,text,text,jsonb,text)') IS NULL
        AND to_regprocedure('public.owner_approval_decide_mcp(text,uuid,text,text,text)') IS NULL THEN 'OK' ELSE 'STOP: already present' END
UNION ALL SELECT 'partner_mcp_check_access(text) returns jsonb',
  CASE WHEN (SELECT prorettype FROM pg_proc WHERE oid = to_regprocedure('public.partner_mcp_check_access(text)')) = 'jsonb'::regtype THEN 'OK' ELSE 'STOP' END
UNION ALL SELECT 'no other function calls partner_mcp_check_access (caller pin)',
  CASE WHEN NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND prosrc ~ '\mpartner_mcp_check_access\M' AND proname <> 'partner_mcp_check_access')
       THEN 'OK' ELSE 'STOP: ' || (SELECT string_agg(proname, ',') FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND prosrc ~ '\mpartner_mcp_check_access\M' AND proname <> 'partner_mcp_check_access') END
UNION ALL SELECT 'decided_role CHECK = applied T2',
  CASE WHEN (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.owner_approval_decisions'::regclass AND conname = 'owner_approval_decisions_decided_role_check')
       = $d$CHECK ((decided_role = ANY (ARRAY['authenticated'::text, 'service_role'::text])))$d$ THEN 'OK' ELSE 'STOP' END
UNION ALL SELECT 'who CHECK = applied T2',
  CASE WHEN (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.owner_approval_decisions'::regclass AND conname = 'owner_approval_decisions_who')
       = $d$CHECK ((((decision = ANY (ARRAY['APPROVED'::text, 'REJECTED'::text])) AND (decided_role = 'authenticated'::text) AND (decided_by IS NOT NULL)) OR ((decision = 'CANCELLED'::text) AND (decided_role = 'service_role'::text) AND (decided_by IS NULL))))$d$ THEN 'OK' ELSE 'STOP' END
UNION ALL SELECT 'at least one Owner principal (count only)',
  CASE WHEN (SELECT count(*) FROM public.owner_approval_principals) >= 1 THEN 'OK' ELSE 'STOP: no principal' END
UNION ALL SELECT 'service_role: no EXECUTE on the dashboard decide',
  CASE WHEN NOT has_function_privilege('service_role', 'public.owner_approval_decide(uuid,text,text,jsonb,text)', 'EXECUTE') THEN 'OK' ELSE 'STOP' END
UNION ALL SELECT 'info: pending requests', (SELECT count(*)::text FROM public.owner_approval_requests r WHERE NOT EXISTS (SELECT 1 FROM public.owner_approval_decisions d WHERE d.request_id = r.id));
