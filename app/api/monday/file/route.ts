import { NextRequest, NextResponse } from "next/server";

/**
 * Proxy Monday.com file downloads with full range-request support.
 *
 * Why this is needed:
 *  - Monday file URLs require an Authorization header the browser can't send.
 *  - Audio elements use HTTP Range requests for seeking/streaming.
 *  - We forward Range headers to Monday and pass back 206 Partial Content
 *    so the <audio> element can seek without re-downloading the whole file.
 *
 * Usage: /api/monday/file?url=<encoded-monday-asset-url>
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "url param required" }, { status: 400 });
  }

  const token = process.env.MONDAY_API_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "MONDAY_API_TOKEN not configured" }, { status: 500 });
  }

  // Forward Range header if present (audio seek / partial content)
  const rangeHeader = req.headers.get("range");
  const upstreamHeaders: Record<string, string> = { Authorization: token };
  if (rangeHeader) upstreamHeaders["Range"] = rangeHeader;

  let upstream: Response;
  try {
    upstream = await fetch(url, { headers: upstreamHeaders });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "fetch failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  if (!upstream.ok && upstream.status !== 206) {
    return NextResponse.json(
      { error: `upstream ${upstream.status}` },
      { status: upstream.status }
    );
  }

  // Build response headers — pass through the ones browsers need for audio
  const responseHeaders: Record<string, string> = {
    "Cache-Control": "private, max-age=300",
    "Accept-Ranges": "bytes",
  };

  const passthroughHeaders = [
    "content-type",
    "content-length",
    "content-range",
    "last-modified",
    "etag",
  ];
  for (const h of passthroughHeaders) {
    const v = upstream.headers.get(h);
    if (v) responseHeaders[h] = v;
  }

  // Default content-type for common audio formats if upstream didn't send one
  if (!responseHeaders["content-type"]) {
    const lower = url.toLowerCase();
    if (lower.includes(".mp3"))  responseHeaders["content-type"] = "audio/mpeg";
    else if (lower.includes(".wav")) responseHeaders["content-type"] = "audio/wav";
    else if (lower.includes(".m4a") || lower.includes(".aac"))
      responseHeaders["content-type"] = "audio/mp4";
    else if (lower.includes(".ogg")) responseHeaders["content-type"] = "audio/ogg";
    else if (lower.includes(".flac")) responseHeaders["content-type"] = "audio/flac";
    else responseHeaders["content-type"] = "application/octet-stream";
  }

  // Stream the body directly — don't buffer, supports partial content
  return new NextResponse(upstream.body, {
    status: upstream.status, // 200 or 206
    headers: responseHeaders,
  });
}
