export {
  appendAudit,
  listAuditSessions,
  readSessionAudit,
  type AuditStoreOptions,
} from "./audit.ts";
export {
  changedReadings,
  CropCache,
  hashReadings,
  VerdictCache,
  type VerdictLookup,
} from "./cache.ts";
export { checkDigitChecks, fieldMatchChecks } from "./checks.ts";
export {
  analyzeFrames,
  decodePngToGray,
  dhash64,
  frameHash,
  hammingDistance,
  selectKeyframes,
  sharpness,
  type DecodedGray,
  type FrameAnalysis,
  type KeyframeOptions,
} from "./frames.ts";
export {
  callBudgetLimit,
  DEFAULT_CALL_BUDGET,
  getCallStats,
  postJson,
  recordUsage,
  resetCallStats,
  type CallStats,
  type PostJsonOptions,
  type RetryOptions,
} from "./http.ts";
export {
  CLAIM_AMOUNT_PLACEHOLDER,
  draftClaim,
  draftClaimTemplate,
  mentionsDamage,
  parseDamagedQty,
  type ClaimDraftInput,
  type DraftClaimOptions,
} from "./claim.ts";
export { checkCrossDoc, type CrossDocOptions } from "./crossdoc.ts";
export { exportAuditCsv, exportAuditMarkdown } from "./export.ts";
export {
  createGlimmerAdapter,
  isFreeTextField,
  redactReadings,
  RealGlimmerAdapter,
  StubGlimmerAdapter,
  type GlimmerAdapter,
  type GlimmerPassInput,
  type GlimmerPassOutput,
} from "./glimmer.ts";
export { loadDotEnv, requireModelApiKey } from "./key.ts";
export {
  createPipelineAdapters,
  resolveModelMode,
  type ModelMode,
  type PipelineAdapters,
} from "./mode.ts";
export {
  assertSingleConcept,
  createSamAdapter,
  defaultDocumentBox,
  extractBoxes,
  RealSamAdapter,
  StubSamAdapter,
  type RealSamOptions,
  type SamAdapter,
  type SamCropInput,
  type SamCropOutput,
} from "./sam.ts";
export {
  createSparkAdapter,
  ESTIMATED_SPARK_CALL_COST_USD,
  RealSparkAdapter,
  StubSparkAdapter,
  type RealSparkOptions,
  type SparkAdapter,
  type SparkEscalationInput,
  type SparkEscalationOutput,
  type SparkJudgment,
  type SparkUsage,
} from "./spark.ts";
export {
  type AuditEntry,
  type BoundingBox,
  type ClaimDraft,
  type Crop,
  type FieldCheck,
  type FieldReading,
  type ModelCall,
  type SessionState,
  type Verdict,
} from "./types.ts";
export {
  hasHandwriting,
  reduceVerdict,
  runTieredPipeline,
  type TieredPipelineInput,
  type TieredPipelineResult,
} from "./verdict.ts";
