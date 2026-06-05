import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // youtube-sr does some dynamic requires and works better when loaded externally.
  serverExternalPackages: ["youtube-sr"],
};

export default nextConfig;
