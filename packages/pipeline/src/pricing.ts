/**
 * Official Meta Model API prices (dev.meta.ai/docs/pricing-rate-limits):
 * Muse Spark Standard mode per-token rates and SAM 3.1 per-image/frame
 * rates. Real adapters price every response from its `usage` block.
 */

export const SPARK_INPUT_USD_PER_TOKEN = 1.25 / 1_000_000;
export const SPARK_OUTPUT_USD_PER_TOKEN = 4.25 / 1_000_000;
export const SPARK_CACHED_INPUT_USD_PER_TOKEN = 0.15 / 1_000_000;
export const SAM_IMAGE_USD = 2.5 / 1000;
export const SAM_VIDEO_FRAME_USD = 0.2 / 1000;

/** Price one Spark response from its token usage. */
export function sparkCostUsd(
  inputTokens: number,
  outputTokens: number,
  cachedInputTokens = 0,
): number {
  const cached = Math.max(0, Math.min(cachedInputTokens, inputTokens));
  return (
    (inputTokens - cached) * SPARK_INPUT_USD_PER_TOKEN +
    cached * SPARK_CACHED_INPUT_USD_PER_TOKEN +
    outputTokens * SPARK_OUTPUT_USD_PER_TOKEN
  );
}

/** Price one SAM response from its processed image/frame counts. */
export function samCostUsd(imagesProcessed: number, videoFramesProcessed = 0): number {
  return imagesProcessed * SAM_IMAGE_USD + videoFramesProcessed * SAM_VIDEO_FRAME_USD;
}
