/**
 * Dropbox token manager — auto-refreshes the access token using a stored refresh token.
 *
 * Setup:
 *   DROPBOX_APP_KEY    (required) — your Dropbox app's App Key
 *   DROPBOX_APP_SECRET (required) — your Dropbox app's App Secret
 *   DROPBOX_ACCESS_TOKEN (legacy / fallback) — short-lived token from the old flow
 *
 * The refresh token is stored in Supabase settings table: key = "dropbox_tokens"
 * value = { access_token, refresh_token, expires_at (ISO string) }
 *
 * Flow:
 *   1. Visit /setup/dropbox → redirects to Dropbox OAuth with token_access_type=offline
 *   2. Dropbox redirects to /api/dropbox/callback?code=...
 *   3. Callback exchanges code for { access_token, refresh_token }
 *   4. Both tokens saved in Supabase settings
 *   5. Every call to getDropboxToken() checks expiry and auto-refreshes when needed
 */

import { supabase } from "./supabase";

const SETTINGS_KEY = "dropbox_tokens";
const EXPIRY_BUFFER_MS = 5 * 60 * 1000; // refresh 5 min before actual expiry

// In-memory cache so we don't hit Supabase on every request
let _cachedToken: string | null = null;
let _cachedExpiry: number = 0; // epoch ms

interface StoredTokens {
  access_token:  string;
  refresh_token: string;
  expires_at:    string; // ISO string
}

/** Persist tokens to Supabase */
async function saveTokens(tokens: StoredTokens): Promise<void> {
  await supabase
    .from("settings")
    .upsert({ key: SETTINGS_KEY, value: tokens as unknown as Record<string, unknown> }, { onConflict: "key" });
}

/** Load tokens from Supabase */
async function loadTokens(): Promise<StoredTokens | null> {
  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("key", SETTINGS_KEY)
    .maybeSingle();
  if (!data?.value) return null;
  return data.value as unknown as StoredTokens;
}

/**
 * Exchange a refresh token for a new access token via Dropbox API.
 * Updates Supabase with the new tokens.
 */
async function refreshAccessToken(refreshToken: string): Promise<string> {
  const appKey    = process.env.DROPBOX_APP_KEY;
  const appSecret = process.env.DROPBOX_APP_SECRET;
  if (!appKey || !appSecret) {
    throw new Error("DROPBOX_APP_KEY / DROPBOX_APP_SECRET חסרים ב-.env.local");
  }

  const params = new URLSearchParams({
    grant_type:    "refresh_token",
    refresh_token: refreshToken,
    client_id:     appKey,
    client_secret: appSecret,
  });

  const res = await fetch("https://api.dropbox.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Dropbox token refresh נכשל: ${body}`);
  }

  const data = (await res.json()) as {
    access_token:  string;
    expires_in:    number; // seconds
    token_type:    string;
  };

  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();

  await saveTokens({
    access_token:  data.access_token,
    refresh_token: refreshToken, // refresh token doesn't change
    expires_at:    expiresAt,
  });

  // Update in-memory cache
  _cachedToken  = data.access_token;
  _cachedExpiry = Date.now() + data.expires_in * 1000 - EXPIRY_BUFFER_MS;

  return data.access_token;
}

/**
 * Returns a valid Dropbox access token.
 * - Uses in-memory cache first
 * - Falls back to Supabase (and refreshes if expired)
 * - Falls back to DROPBOX_ACCESS_TOKEN env var (legacy / short-lived)
 */
export async function getDropboxToken(): Promise<string> {
  // 1. In-memory cache hit
  if (_cachedToken && Date.now() < _cachedExpiry) {
    return _cachedToken;
  }

  // 2. Load from Supabase
  const stored = await loadTokens();
  if (stored?.refresh_token) {
    const expiryMs = new Date(stored.expires_at).getTime();
    if (stored.access_token && Date.now() < expiryMs - EXPIRY_BUFFER_MS) {
      // Still valid — cache it
      _cachedToken  = stored.access_token;
      _cachedExpiry = expiryMs - EXPIRY_BUFFER_MS;
      return stored.access_token;
    }
    // Expired — refresh
    return refreshAccessToken(stored.refresh_token);
  }

  // 3. Fallback: static env var (legacy short-lived token)
  const envToken = process.env.DROPBOX_ACCESS_TOKEN;
  if (envToken) return envToken;

  throw new Error(
    "Dropbox לא מחובר. בקר ב-/setup/dropbox כדי להתחבר."
  );
}

/**
 * Exchange an authorization code for access + refresh tokens.
 * Called by the OAuth callback route.
 */
export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string
): Promise<StoredTokens> {
  const appKey    = process.env.DROPBOX_APP_KEY;
  const appSecret = process.env.DROPBOX_APP_SECRET;
  if (!appKey || !appSecret) {
    throw new Error("DROPBOX_APP_KEY / DROPBOX_APP_SECRET חסרים ב-.env.local");
  }

  const params = new URLSearchParams({
    code,
    grant_type:   "authorization_code",
    client_id:    appKey,
    client_secret: appSecret,
    redirect_uri:  redirectUri,
  });

  const res = await fetch("https://api.dropbox.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Dropbox code exchange נכשל: ${body}`);
  }

  const data = (await res.json()) as {
    access_token:  string;
    refresh_token: string;
    expires_in:    number;
    token_type:    string;
  };

  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();
  const tokens: StoredTokens = {
    access_token:  data.access_token,
    refresh_token: data.refresh_token,
    expires_at:    expiresAt,
  };

  await saveTokens(tokens);

  // Prime the in-memory cache
  _cachedToken  = data.access_token;
  _cachedExpiry = Date.now() + data.expires_in * 1000 - EXPIRY_BUFFER_MS;

  return tokens;
}

/** Build the Dropbox OAuth authorization URL */
export function getDropboxAuthUrl(redirectUri: string): string {
  const appKey = process.env.DROPBOX_APP_KEY;
  if (!appKey) throw new Error("DROPBOX_APP_KEY חסר ב-.env.local");

  const params = new URLSearchParams({
    response_type:     "code",
    client_id:         appKey,
    redirect_uri:      redirectUri,
    token_access_type: "offline", // ← this gives us the refresh token
  });

  return `https://www.dropbox.com/oauth2/authorize?${params.toString()}`;
}
