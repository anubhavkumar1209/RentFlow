"use server";

import { normalizePhone } from "@rentflow/core";
import { DEMO_OTP } from "@/lib/demo/constants";
import { startDemoSession } from "@/lib/demo/server";

/** Demo-mode stand-in for Supabase's verifyOtp: the code is always 123456. */
export async function demoVerifyOtp(phone: string, otp: string): Promise<{ error: string | null }> {
  const e164 = normalizePhone(phone);
  if (!e164) return { error: "Enter a valid 10-digit mobile number." };
  if (otp.trim() !== DEMO_OTP) return { error: `Wrong code. In demo mode the code is always ${DEMO_OTP}.` };
  await startDemoSession(e164);
  return { error: null };
}
