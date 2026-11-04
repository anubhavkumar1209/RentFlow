"use server";

import { SCREENSHOT_MAX_BYTES, submitPayScreenshot } from "@rentflow/server";
import { revalidatePath } from "next/cache";
import { getDeps } from "@/lib/deps";

export interface UploadState {
  result?: "saved" | "duplicate" | "invalid" | "missing" | "too_big" | "error";
}

/** Public (no login): the signed token in the URL is the only key. A screenshot is a hint for matching, never proof of payment. */
export async function uploadScreenshotAction(token: string, _prev: UploadState, form: FormData): Promise<UploadState> {
  const file = form.get("screenshot");
  if (!(file instanceof File) || file.size === 0) return { result: "missing" };
  if (file.size > SCREENSHOT_MAX_BYTES) return { result: "too_big" };
  try {
    const result = await submitPayScreenshot(await getDeps(), token, { bytes: Buffer.from(await file.arrayBuffer()), contentType: file.type });
    revalidatePath(`/p/${token}`);
    return { result };
  } catch (err) {
    console.error(err);
    return { result: "error" };
  }
}
