export { computeAwbCheckDigit, normalizeAwb, validateAwb } from "./awb.ts";
export {
  computeContainerCheckDigit,
  normalizeContainer,
  validateContainer,
} from "./iso6346.ts";
export {
  computeGs1CheckDigit,
  normalizeSscc,
  validateSscc,
} from "./gs1.ts";
export { fail, pass, type CheckResult } from "./types.ts";
