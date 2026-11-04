import { queries } from "@rentflow/server";
import { buttonClass } from "@rentflow/ui";
import { CreditCard, ReceiptText, UserCog, UserRound } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Page, Section } from "@/components/ui";
import { asCurrentUser, requireActor } from "@/lib/session";

/** Settings (CLAUDE.md H6.12). Audit log arrives in M11, Google Sheets in M12. */
export default async function SettingsPage() {
  const actor = await requireActor();
  const t = await getTranslations("settings");
  const tp = await getTranslations("profile");
  const owner = actor.role === "owner";
  const properties = owner ? await asCurrentUser((tx) => queries.listProperties(tx, actor.orgId)) : [];
  const first = properties[0];

  const links = [
    { icon: UserRound, title: tp("title"), description: t("profileDescription"), href: "/profile" },
    ...(owner
      ? [
          { icon: UserCog, title: t("team"), description: t("teamDescription"), href: "/staff" },
          { icon: ReceiptText, title: t("billing"), description: t("billingDescription"), href: first ? `/properties/${first.id}` : "/properties" },
          { icon: CreditCard, title: t("payment"), description: t("paymentDescription"), href: "/payments#connect" },
        ]
      : []),
  ];

  return (
    <Page title={t("title")}>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {links.map((l) => (
          <Section key={l.title}>
            <div className="flex h-full flex-col gap-3">
              <span className="flex size-10 items-center justify-center rounded-[var(--radius-input)] bg-primary-soft text-primary">
                <l.icon className="size-5" strokeWidth={1.75} />
              </span>
              <div className="flex-1">
                <p className="font-semibold text-ink">{l.title}</p>
                <p className="text-sm text-ink-2">{l.description}</p>
              </div>
              <Link href={l.href} className={buttonClass("secondary")}>
                {t("open")}
              </Link>
            </div>
          </Section>
        ))}
      </div>
    </Page>
  );
}
