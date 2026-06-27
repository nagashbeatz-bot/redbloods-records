import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // Keep googleapis (and its Node.js deps) server-side only
  serverExternalPackages: ["googleapis", "google-auth-library", "node-cron"],
  experimental: {
    // proxy.ts (middleware) makes Next buffer the whole request body in memory
    // so it can be read in both proxy and the route handler. The default cap is
    // 10MB — anything larger (MP3/WAV/FLAC/stems) is silently truncated, so
    // req.formData() in the upload routes throws "Failed to parse body as
    // FormData". Raise it to cover audio deliverables. NOTE: this buffers in
    // memory, so the practical ceiling is bounded by the instance RAM; truly
    // huge stems should move to a direct client→Dropbox upload.
    proxyClientMaxBodySize: "512mb",
  },
};

export default nextConfig;
