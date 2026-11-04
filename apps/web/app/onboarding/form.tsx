"use client";

import { LanguageOptions } from "@/components/language-options";
import { Select } from "@rentflow/ui";
import { useLocale, useTranslations } from "next-intl";
import { useActionState } from "react";
import { Button, ErrorText, Field } from "../ui";
import { createOrg, type OnboardingState } from "./actions";

const initialState: OnboardingState = { error: null, values: { orgName: "", ownerName: "", language: "" } };

export function OnboardingForm() {
  const t = useTranslations("onboarding");
  const locale = useLocale();
  const [state, action, pending] = useActionState(createOrg, initialState);
  return (
    <form action={action} className="space-y-4">
      <Field label={t("yourName")} name="ownerName" autoComplete="name" defaultValue={state.values.ownerName} required autoFocus />
      <Field label={t("business")} name="orgName" placeholder="Sunrise PG" hint={t("businessHint")} defaultValue={state.values.orgName} required />
      <Select label={t("language")} name="language" defaultValue={state.values.language || locale}>
        <LanguageOptions />
      </Select>
      <ErrorText>{state.error}</ErrorText>
      <Button disabled={pending}>{pending ? t("creating") : t("continue")}</Button>
    </form>
  );
}
