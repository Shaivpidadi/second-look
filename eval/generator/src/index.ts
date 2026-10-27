export {
  generateForm,
  type AwbDoc,
  type Bol,
  type CommercialInvoice,
  type PackingList,
  type Pod,
  type SsccLabel,
  type SyntheticForm,
} from "./documents.ts";
export {
  applyError,
  ensureExceptionNote,
  injectErrors,
  injectHardErrors,
  isPaperError,
  paperValues,
  type ErrorKind,
  type InjectedError,
  type TypedValues,
} from "./errors.ts";
export { buildForm, buildHardForm, hardFormDegrade, type GeneratedForm } from "./generate.ts";
export {
  PAGE_HEIGHT,
  PAGE_WIDTH,
  applyDegrade,
  awbPage,
  blurPixels,
  bolPage,
  glarePixels,
  hardDegradeSpec,
  invoicePage,
  labelPage,
  packingPage,
  podPage,
  renderForm,
  renderPage,
  skewPixels,
  type DegradeSpec,
} from "./render.ts";
export { createRng, digitString, int, pick, type Rng } from "./prng.ts";
