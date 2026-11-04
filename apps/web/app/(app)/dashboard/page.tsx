import { addMonths, formatDate, formatINR, formatPeriod, formatPhone, isPeriod, periodOf, todayInIndia, type Period } from "@rentflow/core";
import { queries, receiptToken } from "@rentflow/server";
import { Chip, cn } from "@rentflow/ui";
import { BadgeCheck, Banknote, ChevronLeft, ChevronRight, Hourglass, Landmark, ReceiptText, Users, Wallet, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Badge, Balance, Empty, LinkButton, Money, Page, Section, Table, Td } from "@/components/ui";
import { getDeps } from "@/lib/deps";
import { selectedPropertyId } from "@/lib/property";
import { asCurrentUser, requireActor } from "@/lib/session";

/** Bill line kinds in the order owners think about them. */
const KINDS = ["rent", "metered", "fixed", "service", "late_fee", "adjustment"] as const;
const KIND_COLOR: Record<(typeof KINDS)[number], string> = {
  rent: "bg-primary",
  metered: "bg-warning",
  fixed: "bg-info",
  service: "bg-mint",
  late_fee: "bg-danger",
  adjustment: "bg-ink-2",
};

function Tile({ icon: Icon, label, value, hint, tone, href }: { icon: LucideIcon; label: string; value: React.ReactNode; hint: React.ReactNode; tone?: string; href?: string }) {
  const body = (
    <>
      <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-ink-2">
        <Icon className="size-4" strokeWidth={1.75} /> {label}
      </p>
      <p className={cn("mt-2 text-2xl font-semibold tabular-nums md:text-3xl", tone ?? "text-ink")}>{value}</p>
      <p className="mt-1 text-sm text-ink-2">{hint}</p>
    </>
  );
  const box = "block rounded-[var(--radius-card)] border border-line bg-card p-4 shadow-[var(--shadow-card)] md:p-5";
  return href ? (
    <Link href={href} className={cn(box, "transition-colors hover:border-primary/40")}>
      {body}
    </Link>
  ) : (
    <div className={box}>{body}</div>
  );
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const actor = await requireActor();
  const t = await getTranslations("overview");
  const thisMonth = periodOf(todayInIndia());
  const { m } = await searchParams;
  // Any month up to this one; the report is about what was billed and received in it.
  const period: Period = m && isPeriod(m) && m <= thisMonth ? m : thisMonth;
  const properties = await asCurrentUser((tx) => queries.listProperties(tx, actor.orgId));
  const propertyId = await selectedPropertyId(properties.map((p) => p.id));
  const [dash, cash] = await asCurrentUser(async (tx) => [
    await queries.dashboard(tx, actor.orgId, period, propertyId),
    await queries.cashOverview(tx, actor.orgId),
  ] as const);
  const owner = actor.role === "owner";
  const secret = (await getDeps()).config.receiptSecret;

  if (properties.length === 0) {
    return (
      <Page title="Welcome to RentFlow" subtitle="Three steps and your PG runs itself.">
        <Section>
          <ol className="space-y-3 text-sm">
            <li>
              <b>1. Add your property</b> — rent due day, UPI ID, electricity rate, then generate rooms and beds in one go.
            </li>
            <li>
              <b>2. Add tenants</b> — one by one or import a CSV/Excel sheet. Each gets a WhatsApp welcome.
            </li>
            <li>
              <b>3. Approve the monthly bills</b> — RentFlow drafts them, sends them on WhatsApp, matches payments and sends receipts.
            </li>
          </ol>
          {owner ? <div className="mt-4"><LinkButton href="/properties">Add your first property</LinkButton></div> : <p className="mt-4 text-sm text-ink-2">Ask the owner to give you access to a property.</p>}
        </Section>
      </Page>
    );
  }

  const month = formatPeriod(period);
  // Pending = what tenants still owe now (money rule E14: never counted as collected).
  const pending = dash.pending.reduce((s, p) => s + Math.max(0, p.balancePaise), 0);
  const cashInHand = cash.inHand.reduce((s, c) => s + c.amountPaise, 0);
  // Rounded down, so it never says 100% while money is still due.
  const pct = dash.newChargesPaise > 0 ? Math.floor((Math.min(dash.collectedPaise, dash.newChargesPaise) * 100) / dash.newChargesPaise) : 0;
  const billCount = Math.max(0, ...dash.breakdown.map((k) => k.bills));
  const draftThisMonth = dash.drafts.find((d) => d.period === period);
  const breakdown = KINDS.map((kind) => ({ kind, paise: dash.breakdown.find((k) => k.kind === kind)?.paise ?? 0 })).filter((k) => k.paise !== 0);
  const positive = breakdown.reduce((s, k) => s + Math.max(0, k.paise), 0);
  const monthHref = (p: Period) => (p === thisMonth ? "/dashboard" : `/dashboard?m=${p}`);

  return (
    <Page
      title={t("title", { month })}
      subtitle={t("subtitle", { occupied: dash.occupied, beds: dash.beds })}
      actions={
        <nav aria-label={t("month")} className="flex items-center gap-1 rounded-[var(--radius-input)] border border-line bg-card p-1">
          <Link href={monthHref(addMonths(period, -1))} className="flex size-9 items-center justify-center rounded-md text-ink-2 hover:bg-page hover:text-ink" aria-label={t("prev")}>
            <ChevronLeft className="size-4" />
          </Link>
          <span className="min-w-24 px-1 text-center text-sm font-semibold">{month}</span>
          {period < thisMonth ? (
            <Link href={monthHref(addMonths(period, 1))} className="flex size-9 items-center justify-center rounded-md text-ink-2 hover:bg-page hover:text-ink" aria-label={t("next")}>
              <ChevronRight className="size-4" />
            </Link>
          ) : (
            <span className="size-9" aria-hidden />
          )}
        </nav>
      }
    >
      {/* The four numbers */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile icon={Users} label={t("activeTenants")} value={dash.activeTenants} hint={t("activeHint", { occupied: dash.occupied, beds: dash.beds })} href="/tenants" />
        <Tile
          icon={ReceiptText}
          label={t("billed")}
          value={formatINR(dash.newChargesPaise)}
          hint={draftThisMonth ? t("notApproved", { month }) : billCount ? t("billedHint", { count: billCount, month }) : t("noBillsShort")}
          href={draftThisMonth ? `/billing/${draftThisMonth.id}` : "/billing"}
        />
        <Tile icon={BadgeCheck} label={t("collected")} value={formatINR(dash.collectedPaise)} hint={t("collectedHint", { pct, cash: formatINR(dash.collectedCashPaise) })} tone="text-success" href="/payments" />
        <Tile
          icon={Hourglass}
          label={t("pending")}
          value={formatINR(pending)}
          hint={t("pendingHint", { count: dash.pending.length })}
          tone={pending > 0 ? "text-danger" : "text-ink"}
          href="#pending"
        />
      </div>

      {dash.drafts.length > 0 ? (
        <Section title={t("draftsTitle")} description={t("draftsSub")}>
          <ul className="divide-y divide-line">
            {dash.drafts.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 py-2">
                <span>
                  {d.property} · {formatPeriod(d.period)} {d.anomalyCount > 0 ? <Badge tone="amber">{t("toCheck", { count: d.anomalyCount })}</Badge> : null}
                </span>
                <LinkButton href={`/billing/${d.id}`} variant="secondary">
                  {t("review")}
                </LinkButton>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1.1fr_1fr]">
        {/* Monthly report: what the bills charge, by type */}
        <Section className="min-w-0" title={t("reportTitle")} description={t("reportSub", { month })} actions={<LinkButton href="/reports" variant="secondary">{t("fullReports")}</LinkButton>}>
          {breakdown.length === 0 ? (
            <Empty>{t("noBills", { month })}</Empty>
          ) : (
            <>
              <div className="flex h-3 overflow-hidden rounded-full bg-page" aria-hidden>
                {breakdown.filter((k) => k.paise > 0).map((k) => (
                  <span key={k.kind} className={KIND_COLOR[k.kind]} style={{ width: `${(k.paise / positive) * 100}%` }} />
                ))}
              </div>
              <dl className="mt-4 divide-y divide-line">
                {breakdown.map((k) => (
                  <div key={k.kind} className="flex items-center gap-3 py-2.5">
                    <span className={cn("size-2.5 shrink-0 rounded-full", KIND_COLOR[k.kind])} />
                    <dt className="flex-1 text-sm text-ink">{t(`kind_${k.kind}`)}</dt>
                    {k.paise > 0 ? <span className="text-xs tabular-nums text-ink-2">{Math.round((k.paise / positive) * 100)}%</span> : null}
                    <dd className="w-28 text-right font-medium tabular-nums">
                      <Money paise={k.paise} />
                    </dd>
                  </div>
                ))}
                <div className="flex items-center gap-3 pt-3 font-semibold">
                  <span className="size-2.5 shrink-0" />
                  <dt className="flex-1">{t("total")}</dt>
                  <dd className="w-28 text-right tabular-nums">
                    <Money paise={dash.newChargesPaise} />
                  </dd>
                </div>
              </dl>
              <div className="mt-4 grid grid-cols-2 gap-3 rounded-[var(--radius-input)] bg-page p-3 text-sm">
                <div>
                  <p className="text-ink-2">{t("collected")}</p>
                  <p className="font-semibold tabular-nums text-success">{formatINR(dash.collectedPaise)}</p>
                </div>
                <div>
                  <p className="text-ink-2">{t("pending")}</p>
                  <p className={cn("font-semibold tabular-nums", pending > 0 ? "text-danger" : "text-ink")}>{formatINR(pending)}</p>
                </div>
              </div>
            </>
          )}
        </Section>

        {/* Money received this month */}
        <Section className="min-w-0" title={t("recentTitle")} description={t("recentSub", { month })} actions={owner ? <LinkButton href="/payments" variant="secondary">{t("viewAll")}</LinkButton> : undefined}>
          {dash.recentPayments.length === 0 ? (
            <Empty>{t("noPayments", { month })}</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {dash.recentPayments.map((r) => (
                <li key={r.id} className="flex items-center gap-3 py-2.5">
                  <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full", r.method === "cash" ? "bg-warning-soft text-warning" : "bg-success-soft text-success")}>
                    {r.method === "cash" ? <Banknote className="size-4" /> : r.method === "manual" ? <Wallet className="size-4" /> : <Landmark className="size-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <Link href={`/tenants/${r.tenancyId}`} className="block truncate text-sm font-medium hover:underline">
                      {r.name} <span className="font-normal text-ink-2">· {r.room}</span>
                    </Link>
                    <p className="truncate text-xs text-ink-2">
                      {formatDate(r.at.slice(0, 10))} · {t(`method_${r.method}`)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold tabular-nums">{formatINR(r.paise)}</p>
                    {r.receiptId ? (
                      <a href={`/r/${receiptToken(secret, r.receiptId)}`} target="_blank" rel="noreferrer" className="text-xs font-medium text-primary hover:underline">
                        {t("receipt")}
                      </a>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <section id="pending" className="scroll-mt-20">
        <Section title={t("pendingTitle")} description={t("pendingSub")}>
          {dash.pending.length === 0 ? (
            <Empty>{t("allPaid")}</Empty>
          ) : (
            <Table head={[t("colTenant"), t("colRoom"), t("colDue"), t("colBill"), t("colOwed")]}>
              {dash.pending.map((p) => (
                <tr key={p.tenancy_id}>
                  <Td data-label={t("colTenant")}>
                    <Link href={`/tenants/${p.tenancy_id}`} className="font-medium hover:underline">
                      {p.name}
                    </Link>
                    <div className="text-xs text-ink-2">{formatPhone(p.phone)}</div>
                  </Td>
                  <Td data-label={t("colRoom")}>
                    {p.room} <span className="text-xs text-ink-2">{p.property}</span>
                  </Td>
                  <Td data-label={t("colDue")}>
                    {formatDate(p.due_date)}{" "}
                    {p.due_date < todayInIndia() ? <Chip tone="danger">{t("overdue")}</Chip> : p.status === "partially_paid" ? <Chip tone="warning">{t("partial")}</Chip> : null}
                  </Td>
                  <Td data-label={t("colBill")}>
                    <Money paise={p.payablePaise} />
                  </Td>
                  <Td data-label={t("colOwed")}>
                    <Balance paise={p.balancePaise} />
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Section>
      </section>

      {owner && cash.inHand.length > 0 ? (
        <Section title={t("cashTitle")} description={t("cashSub")} actions={<LinkButton href="/cash" variant="secondary">{t("openCash")}</LinkButton>}>
          <ul className="divide-y divide-line">
            {cash.inHand.map((c) => (
              <li key={c.manager} className="flex justify-between py-2">
                <span>{c.manager}</span>
                <Money paise={c.amountPaise} className="font-semibold" />
              </li>
            ))}
            <li className="flex justify-between py-2 font-semibold">
              <span>{t("cashTotal")}</span>
              <Money paise={cashInHand} />
            </li>
          </ul>
        </Section>
      ) : null}
    </Page>
  );
}
