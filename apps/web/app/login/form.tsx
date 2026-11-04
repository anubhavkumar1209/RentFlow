"use client";

import { formatPhone, normalizePhone } from "@rentflow/core";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { DEMO_OTP } from "@/lib/demo/constants";
import { isDemo } from "@/lib/env";
import { createClient } from "@/lib/supabase/client";
import { Button, Card, ErrorText, Field } from "../ui";
import { demoVerifyOtp } from "./demo-actions";

type Step = { kind: "phone" } | { kind: "otp"; phone: string };

/** Phone + OTP. The same flow logs in or signs up; `mode` only changes the wording. */
export function LoginForm({ mode }: { mode: "signup" | "login" }) {
  const t = useTranslations("auth");
  /** Network failures surface as "Failed to fetch"; show something an owner can act on instead. */
  const describeError = (error: string | { message: string; name?: string }): string => {
    if (typeof error === "string") return error;
    if (error.name === "AuthRetryableFetchError" || /fetch|network/i.test(error.message)) return t("network");
    return error.message;
  };
  const router = useRouter();
  const [step, setStep] = useState<Step>({ kind: "phone" });
  // Inputs are controlled so React's automatic form reset doesn't wipe them after an error.
  const [phoneInput, setPhoneInput] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function sendOtp() {
    setError(null);
    const phone = normalizePhone(phoneInput);
    if (!phone) {
      setError(t("invalidPhone"));
      return;
    }
    if (isDemo) {
      setStep({ kind: "otp", phone }); // No SMS in demo mode.
      return;
    }
    setBusy(true);
    const { error } = await createClient().auth.signInWithOtp({ phone });
    setBusy(false);
    if (error) setError(describeError(error));
    else setStep({ kind: "otp", phone });
  }

  async function verifyOtp() {
    if (step.kind !== "otp") return;
    setError(null);
    setBusy(true);
    const { error } = isDemo
      ? await demoVerifyOtp(step.phone, otp)
      : await createClient().auth.verifyOtp({ phone: step.phone, token: otp.trim(), type: "sms" });
    if (error) {
      setBusy(false);
      setError(describeError(error));
      return;
    }
    router.replace("/");
    router.refresh();
  }

  const footer =
    step.kind === "phone" ? (
      <>
        {mode === "signup" ? t("haveAccount") : t("newHere")}{" "}
        <Link href={mode === "signup" ? "/login" : "/login?start=1"} className="font-semibold text-primary hover:underline">
          {mode === "signup" ? t("loginLink") : t("startLink")}
        </Link>
      </>
    ) : null;

  return (
    <Card footer={footer}>
      {step.kind === "phone" ? (
        <form action={sendOtp} className="space-y-5">
          <div>
            <h1 className="text-3xl font-semibold tracking-[-0.025em] text-ink">{mode === "signup" ? t("signupTitle") : t("loginTitle")}</h1>
            <p className="mt-2 text-ink-2">{mode === "signup" ? t("signupSub") : t("loginSub")}</p>
          </div>
          <Field
            label={t("mobile")}
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="98765 43210"
            value={phoneInput}
            onChange={(e) => setPhoneInput(e.target.value)}
            required
            autoFocus
            hint={t("otpNote")}
          />
          <ErrorText>{error}</ErrorText>
          <Button disabled={busy} className="rounded-full shadow-[0_10px_30px_-12px_rgb(15_118_110/0.7)]">
            {busy ? t("sending") : t("sendCode")}
          </Button>
        </form>
      ) : (
        <form action={verifyOtp} className="space-y-5">
          <div>
            <h1 className="text-3xl font-semibold tracking-[-0.025em] text-ink">{t("enterCode")}</h1>
            <p className="mt-2 text-ink-2">{isDemo ? t("demoCode", { code: DEMO_OTP }) : t("sentTo", { phone: formatPhone(step.phone) })}</p>
          </div>
          <Field
            label={t("code")}
            name="otp"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            value={otp}
            onChange={(e) => setOtp(e.target.value)}
            required
            autoFocus
          />
          <ErrorText>{error}</ErrorText>
          <Button disabled={busy} className="rounded-full shadow-[0_10px_30px_-12px_rgb(15_118_110/0.7)]">
            {busy ? t("checking") : t("verify")}
          </Button>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setOtp("");
              setStep({ kind: "phone" });
            }}
            className="h-12 w-full text-sm font-medium text-ink-2"
          >
            {t("differentNumber")}
          </button>
        </form>
      )}
    </Card>
  );
}
