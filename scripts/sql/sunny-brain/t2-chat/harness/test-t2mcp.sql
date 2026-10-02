-- LOCAL HARNESS ONLY. baseline + brain + t2 + seed + p2 + scope + aug-tokens + the t2mcp CANDIDATE.
\set ON_ERROR_STOP on
CREATE FUNCTION t.h(l text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT encode(sha256(convert_to(l, 'UTF8')), 'hex') $$;
GRANT EXECUTE ON FUNCTION t.h(text) TO PUBLIC;
SELECT set_config('t.owner', '00000000-0000-4000-8000-00000000000a', false), set_config('t.team', '00000000-0000-4000-8000-00000000000b', false),
       set_config('t.today', ((now() AT TIME ZONE 'Asia/Jerusalem')::date)::text, false);
CREATE FUNCTION t.pay(handle text) RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT jsonb_build_object(
  'purposeKind', 'OWN_PRESENCE', 'purposeHe', 'מעקב ' || handle, 'resourceIds', '[]'::jsonb,
  'newResources', jsonb_build_array(jsonb_build_object('platform','instagram','resourceKind','ACCOUNT','identityKey','account:handle:' || handle,'firstHandle',handle)),
  'includeChildResources', false, 'entityKeys', '[]'::jsonb, 'observationFamilies', jsonb_build_array('AUDIENCE'), 'sourceKinds', jsonb_build_array('PUBLIC_PROFILE_PAGE'),
  'insightsAllowed', false, 'recommendationsAllowed', false, 'maxObservationsPerDay', 3,
  'validFrom', current_setting('t.today'), 'validUntil', null, 'baseAuthorizationId', null) $$;
GRANT EXECUTE ON FUNCTION t.pay(text) TO PUBLIC;
-- Sunny (service_role) files four requests
SELECT t.as('service_role', 'service_role');
SELECT set_config('t.rA', (public.owner_approval_request('TRACKING_AUTHORIZATION', t.pay('shalev'), 'מעקב שליו', 'סיכון נמוך', 'rbmcp_' || repeat('a', 32), null, gen_random_uuid()))->>'requestId', false);
SELECT set_config('t.rB', (public.owner_approval_request('TRACKING_AUTHORIZATION', t.pay('avi'), 'מעקב אבי', 'סיכון נמוך', 'rbmcp_' || repeat('a', 32), null, gen_random_uuid()))->>'requestId', false);
SELECT set_config('t.rC', (public.owner_approval_request('TRACKING_AUTHORIZATION', t.pay('ref1'), 'מעקב ref1', 'סיכון נמוך', 'rbmcp_' || repeat('a', 32), null, gen_random_uuid()))->>'requestId', false);
SELECT set_config('t.rD', (public.owner_approval_request('TRACKING_AUTHORIZATION', t.pay('ref2'), 'מעקב ref2', 'סיכון נמוך', 'rbmcp_' || repeat('a', 32), null, gen_random_uuid()))->>'requestId', false);
RESET ROLE;
SELECT set_config('t.hA', (SELECT payload_hash FROM public.owner_approval_requests WHERE id = current_setting('t.rA')::uuid), false),
       set_config('t.hB', (SELECT payload_hash FROM public.owner_approval_requests WHERE id = current_setting('t.rB')::uuid), false),
       set_config('t.hC', (SELECT payload_hash FROM public.owner_approval_requests WHERE id = current_setting('t.rC')::uuid), false),
       set_config('t.hD', (SELECT payload_hash FROM public.owner_approval_requests WHERE id = current_setting('t.rD')::uuid), false);

-- ═══ A. who may call what ═══
SELECT set_config('t.suite', 'A-grants', false);
SELECT t.ok('decide_mcp has no p_approved argument (no narrowing from chat)', pg_get_function_identity_arguments('public.owner_approval_decide_mcp(text,uuid,text,text,text)'::regprocedure) !~ 'approved');
SELECT t.as('service_role', 'service_role');
SELECT t.err('SR cannot call decide_core (no Owner impersonation)', $q$ SELECT public.owner_approval_decide_core(current_setting('t.owner')::uuid,'mcp_owner_token',current_setting('t.rA')::uuid,'APPROVED',current_setting('t.hA'),null,null) $q$, 'permission denied');
SELECT t.err('SR cannot call the dashboard decide', $q$ SELECT public.owner_approval_decide(current_setting('t.rA')::uuid,'APPROVED',current_setting('t.hA'),null,null) $q$, 'permission denied');
SELECT t.err('SR cannot read partner_mcp_tokens (hashes are not readable back)', $q$ SELECT token_hash FROM public.partner_mcp_tokens $q$, 'permission denied');
SELECT t.err('SR cannot read principals', $q$ SELECT * FROM public.owner_approval_principals $q$, 'permission denied');
SELECT t.err('SR cannot insert a decision', $q$ INSERT INTO public.owner_approval_decisions (request_id, decision, decided_role, decided_by) VALUES (current_setting('t.rA')::uuid,'APPROVED','mcp_owner_token',current_setting('t.owner')::uuid) $q$, 'permission denied');
SELECT t.as('authenticated', 'authenticated', current_setting('t.owner'));
SELECT t.err('authenticated cannot call decide_mcp', $q$ SELECT public.owner_approval_decide_mcp(t.h('owner-observe'),current_setting('t.rA')::uuid,'APPROVED',current_setting('t.hA'),null) $q$, 'permission denied');
SELECT t.err('authenticated cannot call decide_core', $q$ SELECT public.owner_approval_decide_core(current_setting('t.owner')::uuid,'authenticated',current_setting('t.rA')::uuid,'APPROVED',current_setting('t.hA'),null,null) $q$, 'permission denied');
SELECT t.as('anon', 'anon');
SELECT t.err('anon cannot call decide_mcp', $q$ SELECT public.owner_approval_decide_mcp(t.h('owner-observe'),current_setting('t.rA')::uuid,'APPROVED',current_setting('t.hA'),null) $q$, 'permission denied');
RESET ROLE;

-- ═══ B. the token must prove the Owner ═══
SELECT set_config('t.suite', 'B-token-proof', false);
SELECT t.as('service_role', 'service_role');
SELECT t.err('no token hash (service_role alone) refused', $q$ SELECT public.owner_approval_decide_mcp(null,current_setting('t.rA')::uuid,'APPROVED',current_setting('t.hA'),null) $q$, 'OWNER_TOKEN_REQUIRED');
SELECT t.err('a non-hex token refused', $q$ SELECT public.owner_approval_decide_mcp('rbmcp_plaintext',current_setting('t.rA')::uuid,'APPROVED',current_setting('t.hA'),null) $q$, 'OWNER_TOKEN_REQUIRED');
SELECT t.err('an unknown token hash refused', $q$ SELECT public.owner_approval_decide_mcp(t.h('made-up'),current_setting('t.rA')::uuid,'APPROVED',current_setting('t.hA'),null) $q$, 'OWNER_TOKEN_INVALID');
SELECT t.err('the Owner''s REVOKED token refused', $q$ SELECT public.owner_approval_decide_mcp(t.h('owner-revoked'),current_setting('t.rA')::uuid,'APPROVED',current_setting('t.hA'),null) $q$, 'OWNER_TOKEN_INVALID');
SELECT t.err('the Owner''s EXPIRED token refused', $q$ SELECT public.owner_approval_decide_mcp(t.h('owner-expired'),current_setting('t.rA')::uuid,'APPROVED',current_setting('t.hA'),null) $q$, 'OWNER_TOKEN_INVALID');
SELECT t.err('a token of a DISABLED client refused', $q$ SELECT public.owner_approval_decide_mcp(t.h('owner-disabled'),current_setting('t.rA')::uuid,'APPROVED',current_setting('t.hA'),null) $q$, 'OWNER_TOKEN_INVALID');
SELECT t.err('the Owner''s token WITHOUT partner:observe refused', $q$ SELECT public.owner_approval_decide_mcp(t.h('owner-noobserve'),current_setting('t.rA')::uuid,'APPROVED',current_setting('t.hA'),null) $q$, 'OWNER_TOKEN_SCOPE');
SELECT t.err('a TEAM member''s live token refused (non-owner)', $q$ SELECT public.owner_approval_decide_mcp(t.h('team-observe'),current_setting('t.rA')::uuid,'APPROVED',current_setting('t.hA'),null) $q$, 'OWNER_SESSION_REQUIRED');
SELECT t.err('an anonymous user''s token refused', $q$ SELECT public.owner_approval_decide_mcp(t.h('anon-observe'),current_setting('t.rA')::uuid,'APPROVED',current_setting('t.hA'),null) $q$, 'OWNER_SESSION_REQUIRED');
SELECT t.err('a token of a user with no auth account refused', $q$ SELECT public.owner_approval_decide_mcp(t.h('ghost-observe'),current_setting('t.rA')::uuid,'APPROVED',current_setting('t.hA'),null) $q$, 'OWNER_SESSION_REQUIRED');
RESET ROLE; UPDATE auth.users SET banned_until = now() + interval '1 day' WHERE id = current_setting('t.owner')::uuid;
SELECT t.as('service_role', 'service_role');
SELECT t.err('the Owner''s token while his account is BANNED refused', $q$ SELECT public.owner_approval_decide_mcp(t.h('owner-observe'),current_setting('t.rA')::uuid,'APPROVED',current_setting('t.hA'),null) $q$, 'OWNER_SESSION_REQUIRED');
RESET ROLE; UPDATE auth.users SET banned_until = NULL WHERE id = current_setting('t.owner')::uuid;
SELECT t.ok('nothing decided by any refused attempt', NOT EXISTS (SELECT 1 FROM public.owner_approval_decisions));
SELECT t.ok('no authorization created by any refused attempt', NOT EXISTS (SELECT 1 FROM public.sunny_tracking_authorizations));

-- ═══ C. exact request, exact hash, once ═══
SELECT set_config('t.suite', 'C-exact-once', false);
SELECT t.as('service_role', 'service_role');
SELECT t.err('stale / other hash refused', $q$ SELECT public.owner_approval_decide_mcp(t.h('owner-observe'),current_setting('t.rA')::uuid,'APPROVED',current_setting('t.hB'),null) $q$, 'SEEN_HASH_MISMATCH');
SELECT t.err('missing hash refused', $q$ SELECT public.owner_approval_decide_mcp(t.h('owner-observe'),current_setting('t.rA')::uuid,'APPROVED',null,null) $q$, 'SEEN_HASH|INVALID');
SELECT t.err('an unknown request refused', $q$ SELECT public.owner_approval_decide_mcp(t.h('owner-observe'),gen_random_uuid(),'APPROVED',current_setting('t.hA'),null) $q$, 'NOT_FOUND|REQUEST');
SELECT t.err('CANCELLED is not a chat decision', $q$ SELECT public.owner_approval_decide_mcp(t.h('owner-observe'),current_setting('t.rA')::uuid,'CANCELLED',current_setting('t.hA'),null) $q$, 'INVALID');
SELECT set_config('t.authA', split_part(t.run('Owner token approves request A exactly', $q$ SELECT public.owner_approval_decide_mcp(t.h('owner-observe'),current_setting('t.rA')::uuid,'APPROVED',current_setting('t.hA'),'מאשר') $q$)->>'result', ':', 2), false);
SELECT t.err('replay of the same approval refused (no duplicate)', $q$ SELECT public.owner_approval_decide_mcp(t.h('owner-observe'),current_setting('t.rA')::uuid,'APPROVED',current_setting('t.hA'),'מאשר') $q$, 'ALREADY_DECIDED');
SELECT t.err('a later REJECT of a decided request refused', $q$ SELECT public.owner_approval_decide_mcp(t.h('owner-observe'),current_setting('t.rA')::uuid,'REJECTED',current_setting('t.hA'),null) $q$, 'ALREADY_DECIDED');
RESET ROLE;
SELECT t.ok('exactly one decision for A', (SELECT count(*) FROM public.owner_approval_decisions WHERE request_id = current_setting('t.rA')::uuid) = 1);
SELECT t.ok('audit: decided_role mcp_owner_token, decided_by = the Owner (from the token, not an argument)',
  (SELECT decided_role = 'mcp_owner_token' AND decided_by = current_setting('t.owner')::uuid AND decision = 'APPROVED' FROM public.owner_approval_decisions WHERE request_id = current_setting('t.rA')::uuid));
SELECT t.ok('exactly one ACTIVE authorization, with the requested terms', (SELECT count(*) FROM public.sunny_tracking_authorizations) = 1
  AND (SELECT max_observations_per_day = 3 AND insights_allowed = false FROM public.sunny_tracking_authorizations));
SELECT t.ok('the authorization carries the approval ref', EXISTS (SELECT 1 FROM public.sunny_tracking_authorizations WHERE id::text = current_setting('t.authA')));
SELECT t.ok('B / C / D untouched', (SELECT count(*) FROM public.owner_approval_decisions WHERE request_id IN (current_setting('t.rB')::uuid, current_setting('t.rC')::uuid, current_setting('t.rD')::uuid)) = 0);

-- ═══ D. reject from chat ═══
SELECT set_config('t.suite', 'D-reject', false);
SELECT t.as('service_role', 'service_role');
SELECT t.run('Owner token rejects request B', $q$ SELECT public.owner_approval_decide_mcp(t.h('owner-observe'),current_setting('t.rB')::uuid,'REJECTED',current_setting('t.hB'),'לא מאשר') $q$);
SELECT t.err('approving B after the rejection refused', $q$ SELECT public.owner_approval_decide_mcp(t.h('owner-observe'),current_setting('t.rB')::uuid,'APPROVED',current_setting('t.hB'),null) $q$, 'ALREADY_DECIDED');
RESET ROLE;
SELECT t.ok('B rejected by the Owner via token; nothing created', (SELECT decision = 'REJECTED' AND decided_role = 'mcp_owner_token' AND decided_by = current_setting('t.owner')::uuid FROM public.owner_approval_decisions WHERE request_id = current_setting('t.rB')::uuid)
  AND (SELECT count(*) FROM public.sunny_tracking_authorizations) = 1);

-- ═══ E. the dashboard path is unchanged ═══
SELECT set_config('t.suite', 'E-dashboard', false);
SELECT t.as('authenticated', 'authenticated', current_setting('t.team'));
SELECT t.err('team session: dashboard decide refused', $q$ SELECT public.owner_approval_decide(current_setting('t.rC')::uuid,'APPROVED',current_setting('t.hC'),null,null) $q$, 'OWNER_SESSION_REQUIRED');
SELECT t.as('authenticated', 'authenticated', current_setting('t.owner'));
SELECT t.err('dashboard: wrong hash refused', $q$ SELECT public.owner_approval_decide(current_setting('t.rC')::uuid,'APPROVED',repeat('0',64),null,null) $q$, 'SEEN_HASH_MISMATCH');
SELECT t.run('dashboard: Owner session narrows + approves C (insights stays off, cap down)', $q$ SELECT public.owner_approval_decide(current_setting('t.rC')::uuid,'APPROVED',current_setting('t.hC'), jsonb_set(t.pay('ref1'),'{maxObservationsPerDay}','2'), null) $q$);
SELECT t.run('dashboard: Owner session rejects D', $q$ SELECT public.owner_approval_decide(current_setting('t.rD')::uuid,'REJECTED',current_setting('t.hD'),null,null) $q$);
SELECT t.as('service_role', 'service_role', current_setting('t.owner'));
SELECT t.err('SR with forged Owner claims still cannot use the dashboard decide', $q$ SELECT public.owner_approval_decide(current_setting('t.rC')::uuid,'APPROVED',current_setting('t.hC'),null,null) $q$, 'permission denied');
SELECT t.err('chat after dashboard decision refused', $q$ SELECT public.owner_approval_decide_mcp(t.h('owner-observe'),current_setting('t.rC')::uuid,'APPROVED',current_setting('t.hC'),null) $q$, 'ALREADY_DECIDED');
RESET ROLE;
SELECT t.ok('dashboard decisions recorded as authenticated', (SELECT bool_and(decided_role = 'authenticated' AND decided_by = current_setting('t.owner')::uuid) FROM public.owner_approval_decisions WHERE request_id IN (current_setting('t.rC')::uuid, current_setting('t.rD')::uuid)));
SELECT t.ok('C approved with the narrowed cap 2', EXISTS (SELECT 1 FROM public.sunny_tracking_authorizations WHERE max_observations_per_day = 2));

-- ═══ F. CHECK constraints ═══
SELECT set_config('t.suite', 'F-checks', false);
SELECT t.err('CHECK: a CANCELLED decision cannot carry mcp_owner_token', $q$ INSERT INTO public.owner_approval_decisions (request_id, decision, decided_role, decided_by) SELECT id, 'CANCELLED', 'mcp_owner_token', null FROM public.owner_approval_requests LIMIT 1 $q$, 'check constraint|duplicate|violates');
SELECT t.err('CHECK: an mcp_owner_token approval needs decided_by', $q$ INSERT INTO public.owner_approval_decisions (request_id, decision, decided_role, decided_by) VALUES (gen_random_uuid(), 'APPROVED', 'mcp_owner_token', null) $q$, 'check constraint|violates');
SELECT t.err('CHECK: an unknown role refused', $q$ INSERT INTO public.owner_approval_decisions (request_id, decision, decided_role, decided_by) VALUES (gen_random_uuid(), 'APPROVED', 'connector', current_setting('t.owner')::uuid) $q$, 'check constraint|violates');

-- ═══ G. cancelled request ═══
SELECT set_config('t.suite', 'G-cancelled', false);
SELECT t.as('service_role', 'service_role');
SELECT set_config('t.rE', (public.owner_approval_request('TRACKING_AUTHORIZATION', t.pay('ref3'), 'מעקב ref3', 'סיכון נמוך', 'rbmcp_' || repeat('a', 32), null, gen_random_uuid()))->>'requestId', false);
SELECT t.run('Sunny withdraws E', $q$ SELECT to_jsonb(public.owner_approval_cancel(current_setting('t.rE')::uuid, 'בוטל')) $q$);
RESET ROLE;
SELECT set_config('t.hE', (SELECT payload_hash FROM public.owner_approval_requests WHERE id = current_setting('t.rE')::uuid), false);
SELECT t.as('service_role', 'service_role');
SELECT t.err('chat approval of a withdrawn request refused', $q$ SELECT public.owner_approval_decide_mcp(t.h('owner-observe'),current_setting('t.rE')::uuid,'APPROVED',current_setting('t.hE'),null) $q$, 'ALREADY_DECIDED');
RESET ROLE;
