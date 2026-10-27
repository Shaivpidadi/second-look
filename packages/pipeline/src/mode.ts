import {
  createGlimmerAdapter,
  type GlimmerAdapter,
} from "./glimmer.ts";
import { createSamAdapter, type SamAdapter } from "./sam.ts";
import { createSparkAdapter, type SparkAdapter } from "./spark.ts";

/** Adapter set: "real" only when the key exists and `SECOND_LOOK_MODELS=real`. */
export type ModelMode = "stub" | "real";

export interface PipelineAdapters {
  sam: SamAdapter;
  glimmer: GlimmerAdapter;
  spark: SparkAdapter;
}

/**
 * Resolve the adapter mode from the environment. Real mode needs both the
 * `SECOND_LOOK_MODELS=real` flag and a key (`MODEL_API_KEY` or the
 * `META_API_KEY` alias); anything else stays on stubs.
 */
export function resolveModelMode(env: NodeJS.ProcessEnv = process.env): ModelMode {
  if ((env.SECOND_LOOK_MODELS ?? "").toLowerCase() !== "real") return "stub";
  return env.MODEL_API_KEY ?? env.META_API_KEY ? "real" : "stub";
}

/**
 * Build the pipeline adapter set for a mode. In real mode only Spark goes
 * live: `sam-3.1` returns empty text via `/v1/responses` (no box shape
 * verified, see STATUS.md), so SAM stays on the stub, and Glimmer has no
 * local weights yet. Each adapter still reports its own `name`, so runs
 * can label every arm real vs stub.
 */
export function createPipelineAdapters(
  mode: ModelMode = resolveModelMode(),
): PipelineAdapters {
  if (mode === "real") {
    return {
      sam: createSamAdapter("stub"),
      glimmer: createGlimmerAdapter("stub"),
      spark: createSparkAdapter("real"),
    };
  }
  return {
    sam: createSamAdapter("stub"),
    glimmer: createGlimmerAdapter("stub"),
    spark: createSparkAdapter("stub"),
  };
}
