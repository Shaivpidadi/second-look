import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@second-look/validators", "@second-look/pipeline"],
};

export default nextConfig;
