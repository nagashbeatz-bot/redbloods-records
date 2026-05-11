import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // Keep googleapis (and its Node.js deps) server-side only
  serverExternalPackages: ["googleapis", "google-auth-library", "node-cron"],
};

export default nextConfig;
