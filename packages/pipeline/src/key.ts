/**
 * Shared Model API key lookup. The key is read from the environment at call
 * time (never cached) so tests and CLIs can set it late. `MODEL_API_KEY` is
 * preferred; `META_API_KEY` is accepted as an alias.
 */
export function requireModelApiKey(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const key = env.MODEL_API_KEY ?? env.META_API_KEY;
  if (!key) {
    throw new Error(
      "MODEL_API_KEY is not set (alias META_API_KEY). Copy .env.example to " +
        ".env and add a Meta Model API key; see PLAN.md. The tiered pipeline " +
        "stays on stub adapters until a key exists.",
    );
  }
  return key;
}
