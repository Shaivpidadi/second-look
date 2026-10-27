import type { Crop } from "./types.ts";

export interface SamCropInput {
  /** Still frame bytes (JPEG/PNG). One noun-phrase concept per request. */
  image: Uint8Array;
  concept: string;
}

/** Locate the document in a frame and return crops. Needs MODEL_API_KEY. */
export async function cropDocument(_input: SamCropInput): Promise<Crop[]> {
  throw new Error("sam.cropDocument: not implemented (needs MODEL_API_KEY)");
}
