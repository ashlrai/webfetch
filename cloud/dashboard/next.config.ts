import type { NextConfig } from "next";

const config: NextConfig = {
  typedRoutes: false,
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
};

export default config;
