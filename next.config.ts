import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ytsr does dynamic `require('../package.json')` inside util.js for bug-report URLs;
  // Next.js's bundler can't trace it. Keep the package external so it loads at runtime
  // via the real Node require mechanism.
  serverExternalPackages: ["@distube/ytsr"],
};

export default nextConfig;
