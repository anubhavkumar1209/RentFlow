import { getTranslations } from "next-intl/server";
import { requireActor } from "@/lib/session";
import { MoneyTabs } from "./tabs";

/** Bills & Payments (CLAUDE.md H6.7): one section, four tabs. */
export default async function MoneyLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor();
  const t = await getTranslations("billsTabs");
  const tabs = [
    { href: "/billing", label: t("cycle") },
    { href: "/readings", label: t("readings") },
    // Managers can't settle UPI payments (Part E10), so they don't get the inbox.
    ...(actor.role === "owner" ? [{ href: "/payments", label: t("payments") }] : []),
    { href: "/cash", label: t("cash") },
  ];
  return (
    <>
      <MoneyTabs tabs={tabs} />
      {children}
    </>
  );
}
