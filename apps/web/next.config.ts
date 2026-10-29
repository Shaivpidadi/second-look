import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { NextConfig } from "next";

/**
 * Load the repo-root .env (MODEL_API_KEY, SECOND_LOOK_MODELS, ...): Next
 * only reads .env files next to the app (apps/web), so `pnpm demo:lan`
 * started without the key. Variables already exported in the shell win.
 */
function loadRootEnv(): void {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) {
      const file = join(dir, ".env");
      if (existsSync(file)) process.loadEnvFile(file);
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

loadRootEnv();

const nextConfig: NextConfig = {
  transpilePackages: ["@second-look/validators", "@second-look/pipeline"],
};

export default nextConfig;
