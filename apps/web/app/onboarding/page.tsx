import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { Card } from "../ui";
import { OnboardingForm } from "./form";

export default async function OnboardingPage() {
  const session = await requireSession();
  if (session.actor) redirect("/dashboard");
  const t = await getTranslations("onboarding");

  return (
    <Card>
      <h1 className="text-3xl font-semibold tracking-[-0.025em] text-ink">{t("title")}</h1>
      <p className="mb-6 mt-2 text-ink-2">{t("subtitle")}</p>
      <OnboardingForm />
    </Card>
  );
}
