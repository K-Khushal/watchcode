import { statSync } from "node:fs";
import { HOOK_TRANSCRIPT_DELTA_BYTES } from "@watchcode/shared";

export function baselineSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

export function transcriptGrew(path: string, baseline: number): boolean {
  try {
    const size = statSync(path).size;
    // Truncation/rotation also implies the file changed materially; treat as
    // local resolution rather than getting stuck waiting for forward growth.
    if (size < baseline) return true;
    return size >= baseline + HOOK_TRANSCRIPT_DELTA_BYTES;
  } catch {
    return false;
  }
}
