-- LOCAL HARNESS ONLY: give partner_mcp_tokens / partner_mcp_check_access the PRODUCTION shape (jsonb result with
-- token_id, client_id, user_id, scope, resource; VALID | REVOKED | EXPIRED | CLIENT_DISABLED), run after `scope`.
\set ON_ERROR_STOP on
ALTER TABLE public.partner_mcp_tokens ADD COLUMN user_id uuid, ADD COLUMN client_id text NOT NULL DEFAULT 'rbmcp_' || repeat('a', 32),
  ADD COLUMN resource text NOT NULL DEFAULT 'https://connector.example/mcp', ADD COLUMN expires_at timestamptz NOT NULL DEFAULT now() + interval '1 hour',
  ADD COLUMN client_disabled boolean NOT NULL DEFAULT false;
DROP FUNCTION public.partner_mcp_check_access(text);
CREATE FUNCTION public.partner_mcp_check_access(p_token_hash text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT CASE WHEN t.id IS NULL THEN jsonb_build_object('result', 'NOT_FOUND') ELSE jsonb_build_object(
    'result', CASE WHEN t.revoked_at IS NOT NULL THEN 'REVOKED' WHEN t.expires_at <= now() THEN 'EXPIRED' WHEN t.client_disabled THEN 'CLIENT_DISABLED' ELSE 'VALID' END,
    'token_id', t.id::text, 'client_id', t.client_id, 'user_id', t.user_id::text, 'scope', t.scope, 'resource', t.resource) END
  FROM (SELECT 1) d LEFT JOIN public.partner_mcp_tokens t ON t.token_hash = p_token_hash $$;
REVOKE ALL ON FUNCTION public.partner_mcp_check_access(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.partner_mcp_check_access(text) TO service_role;
-- tokens: hash = sha256 hex of a label
INSERT INTO public.partner_mcp_tokens (token_hash, family_id, scope, user_id, revoked_at, expires_at, client_disabled)
SELECT encode(sha256(convert_to(l, 'UTF8')), 'hex'), gen_random_uuid(), s, u::uuid, r, coalesce(e, now() + interval '1 hour'), coalesce(cd, false) FROM (VALUES
  ('owner-observe',   'partner:read partner:answer partner:knowledge partner:observe', '00000000-0000-4000-8000-00000000000a', NULL::timestamptz, NULL::timestamptz, NULL::boolean),
  ('owner-noobserve', 'partner:read partner:answer partner:knowledge',                 '00000000-0000-4000-8000-00000000000a', NULL, NULL, NULL),
  ('owner-revoked',   'partner:read partner:observe',                                  '00000000-0000-4000-8000-00000000000a', now(), NULL, NULL),
  ('owner-expired',   'partner:read partner:observe',                                  '00000000-0000-4000-8000-00000000000a', NULL, now() - interval '1 minute', NULL),
  ('owner-disabled',  'partner:read partner:observe',                                  '00000000-0000-4000-8000-00000000000a', NULL, NULL, true),
  ('team-observe',    'partner:read partner:observe',                                  '00000000-0000-4000-8000-00000000000b', NULL, NULL, NULL),
  ('anon-observe',    'partner:read partner:observe',                                  '00000000-0000-4000-8000-00000000000c', NULL, NULL, NULL),
  ('ghost-observe',   'partner:read partner:observe',                                  '00000000-0000-4000-8000-0000000000ee', NULL, NULL, NULL)
) v(l, s, u, r, e, cd);
