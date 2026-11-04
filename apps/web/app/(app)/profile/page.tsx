import { LanguageOptions } from "@/components/language-options";
import { formatDate, formatPhone, todayInIndia } from "@rentflow/core";
import { DEFAULT_MANAGER_PERMISSIONS, queries, type ManagerPermission } from "@rentflow/server";
import { buttonClass, Chip } from "@rentflow/ui";
import { Building2, Check, LogOut, Minus, Phone } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { Field, Page, Section, Select } from "@/components/ui";
import { asCurrentUser, requireActor } from "@/lib/session";
import { saveMyProfileAction } from "./actions";

const PERMS: ManagerPermission[] = ["manage_tenants", "record_cash", "enter_readings", "edit_prices"];

/** My profile: who I am, what I can change, and what I'm allowed to do. */
export default async function ProfilePage() {
  const actor = await requireActor();
  const t = await getTranslations("profile");
  const tt = await getTranslations("topbar");
  const me = await asCurrentUser((tx) => queries.myProfile(tx, actor.userId, actor.orgId));
  if (!me) notFound();
  const owner = actor.role === "owner";
  const roleLabel = owner ? tt("owner") : actor.role === "manager" ? tt("manager") : tt("staff");
  const granted = me.access.filter((a) => owner || a.permissions);

  return (
    <Page title={t("title")} subtitle={t("subtitle", { org: me.org_name })}>
      {/* Identity card */}
      <Section>
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex size-16 shrink-0 items-center justify-center rounded-full bg-primary-soft text-2xl font-semibold text-primary">
            {(me.name ?? me.phone).trim().charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-semibold text-ink">{me.name ?? formatPhone(me.phone)}</p>
            <p className="text-sm text-ink-2">{formatPhone(me.phone)}</p>
            <div className="mt-1 flex flex-wrap gap-2">
              <Chip tone="info">{roleLabel}</Chip>
              <Chip tone="neutral">{me.org_name}</Chip>
            </div>
          </div>
        </div>
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title={t("details")}>
          <ActionForm action={saveMyProfileAction} submit={t("save")}>
            <Field label={t("name")} name="name" defaultValue={me.name ?? ""} autoComplete="name" required />
            <Field label={t("email")} name="email" type="email" inputMode="email" autoComplete="email" defaultValue={me.email ?? ""} hint={t("emailHint")} />
            <Select label={t("language")} name="language" defaultValue={me.language}>
              <LanguageOptions />
            </Select>
          </ActionForm>
        </Section>

        <Section title={t("account")}>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-ink-2">{t("phone")}</dt>
              <dd className="mt-0.5 flex items-center gap-2 font-medium text-ink">
                <Phone className="size-4 text-muted" /> {formatPhone(me.phone)}
              </dd>
              <dd className="mt-1 text-xs text-ink-2">{t("phoneHint")}</dd>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <dt className="text-ink-2">{t("role")}</dt>
                <dd className="mt-0.5 font-medium text-ink">{roleLabel}</dd>
              </div>
              <div>
                <dt className="text-ink-2">{t("memberSince")}</dt>
                <dd className="mt-0.5 font-medium text-ink">{formatDate(todayInIndia(me.memberSince))}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-ink-2">{t("business")}</dt>
                <dd className="mt-0.5 font-medium text-ink">{me.org_name}</dd>
              </div>
            </div>
          </dl>
          <form action="/auth/signout" method="post" className="mt-5">
            <button className={buttonClass("secondary", "md", "text-danger")}>
              <LogOut /> {t("logout")}
            </button>
          </form>
        </Section>
      </div>

      <Section title={t("access")} description={owner ? t("ownerAccess", { count: me.access.length }) : granted.length ? t("managerAccess") : t("noAccess")}>
        {granted.length > 0 ? (
          <ul className="divide-y divide-line">
            {granted.map((a) => {
              const perms = { ...DEFAULT_MANAGER_PERMISSIONS, ...(a.permissions ?? {}) };
              return (
                <li key={a.propertyId} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <span className="flex items-center gap-2 font-medium text-ink">
                    <Building2 className="size-4 text-muted" strokeWidth={1.75} /> {a.name}
                  </span>
                  {owner ? null : (
                    <span className="flex flex-wrap gap-1.5">
                      {PERMS.map((p) => (
                        <Chip key={p} tone={perms[p] ? "success" : "neutral"} icon={perms[p] ? <Check /> : <Minus />}>
                          {t(`perm_${p}`)}
                        </Chip>
                      ))}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        ) : null}
      </Section>
    </Page>
  );
}
