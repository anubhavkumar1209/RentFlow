/**
 * Product previews for the landing page, drawn with RentFlow's own design
 * tokens so they stay sharp and light (no screenshots to download). All names
 * and amounts are example data, labelled as such. TODO(M13): real screenshots.
 */
import { formatINR, prorateRent, splitByTenantDays } from "@rentflow/core";
import { Chip, cn } from "@rentflow/ui";
import { BedDouble, Building2, Check, CircleAlert, FileText, Landmark, LayoutDashboard, Megaphone, MessageCircle, PhoneCall, Receipt, Upload, Users, Wallet, X } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Logo } from "@/components/brand/logo";

const rupees = (r: number) => formatINR(r * 100);

function Window({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-2xl border border-line bg-card shadow-[0_40px_80px_-40px_rgb(15_23_42/0.35),0_0_0_1px_rgb(15_23_42/0.02)]", className)}>
      <div className="flex items-center gap-2 border-b border-line bg-page/80 px-4 py-2.5">
        <span className="size-2.5 rounded-full bg-[#f87171]" />
        <span className="size-2.5 rounded-full bg-[#fbbf24]" />
        <span className="size-2.5 rounded-full bg-[#34d399]" />
        <span className="ml-3 truncate text-xs text-ink-2">{title}</span>
      </div>
      {children}
    </div>
  );
}

// ─── Hero: the owner's overview ───────────────────────────────────────────────

export async function DashboardPreview() {
  const t = await getTranslations("landing.preview");
  const nav = [LayoutDashboard, Building2, BedDouble, Users, Receipt, MessageCircle];
  const stats: [string, string, string, string][] = [
    [t("expected"), rupees(342600), t("month"), "text-ink"],
    [t("collected"), rupees(296450), t("collectedSub"), "text-success"],
    [t("outstanding"), rupees(46150), t("outstandingSub"), "text-ink"],
    [t("overdue"), rupees(18400), t("overdueSub"), "text-danger"],
  ];
  const payments: [string, string, number, "bank" | "cash" | "live"][] = [
    ["Priya Sharma", "101-A", 650012, "live"],
    ["Rahul Verma", "204-B", 1150037, "bank"],
    ["Karan Mehta", "202-A", 600000, "cash"],
    ["Anmol Singh", "303-B", 325142, "bank"],
  ];
  // Last six months, collected vs expected (₹ thousands).
  const trend: [number, number][] = [
    [300, 286],
    [310, 302],
    [318, 309],
    [330, 324],
    [336, 331],
    [343, 296],
  ];
  return (
    <Window title={t("bar")}>
      <div className="flex">
        <aside className="hidden w-48 shrink-0 border-r border-line p-3 md:block">
          <div className="mb-4 flex items-center gap-2 px-2">
            <Logo size={22} motion="none" />
            <span className="text-sm font-semibold">
              Rent<span className="text-primary">Flow</span>
            </span>
          </div>
          {nav.map((Icon, i) => (
            <div key={i} className={cn("mb-0.5 flex items-center gap-2.5 rounded-lg px-2 py-2 text-[13px]", i === 0 ? "bg-primary-soft font-medium text-primary" : "text-ink-2")}>
              <Icon className="size-4" strokeWidth={1.75} />
              {t(`nav${i + 1}`)}
            </div>
          ))}
        </aside>
        <div className="min-w-0 flex-1 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-base font-semibold">{t("pg")}</p>
              <p className="text-xs text-ink-2">{t("month")}</p>
            </div>
            <Chip>{t("example")}</Chip>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {stats.map(([label, value, sub, tone]) => (
              <div key={label} className="rounded-xl border border-line p-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-ink-2">{label}</p>
                <p className={cn("mt-1 text-lg font-semibold tabular-nums sm:text-xl", tone)}>{value}</p>
                <p className="mt-0.5 truncate text-[11px] text-ink-2">{sub}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-[1.4fr_1fr]">
            <div className="rounded-xl border border-line">
              <p className="border-b border-line px-3 py-2 text-xs font-semibold">{t("recent")}</p>
              <ul className="divide-y divide-line">
                {payments.map(([name, bed, paise, kind]) => (
                  <li key={name} className={cn("flex items-center gap-3 px-3 py-2.5", kind === "live" && "rf-live")}>
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-page text-[11px] font-semibold text-ink-2">{name[0]}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium">{name}</p>
                      <p className="text-[11px] text-ink-2">{bed}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[13px] font-semibold tabular-nums">{formatINR(paise)}</p>
                      {kind === "live" ? (
                        <span className="relative block h-4 w-36 text-[11px]">
                          <span className="rf-wait absolute inset-0 text-right text-warning">{t("waiting")}…</span>
                          <span className="rf-paid absolute inset-0 inline-flex items-center justify-end gap-1 text-success">
                            <Check className="size-3" /> {t("matched")}
                          </span>
                        </span>
                      ) : (
                        <span className={cn("inline-flex items-center gap-1 text-[11px]", "text-success")}>
                          <Check className="size-3" /> {kind === "cash" ? t("cash") : t("matched")}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            <div className="hidden rounded-xl border border-line p-3 sm:block">
              <p className="text-xs font-semibold">{t("trend")}</p>
              <div className="mt-3 flex h-28 items-end gap-2.5" aria-hidden>
                {trend.map(([exp, got], i) => (
                  <div key={i} className="relative flex h-full flex-1 items-end">
                    <span className="absolute inset-x-0 bottom-0 rounded-t-[4px] bg-primary-soft" style={{ height: `${(exp / 350) * 100}%` }} />
                    <span className={cn("relative w-full rounded-t-[4px]", i === 5 ? "bg-mint" : "bg-primary")} style={{ height: `${(got / 350) * 100}%` }} />
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-line pt-3 text-[11px] text-ink-2">
                <span>{t("beds")}</span>
                <span className="font-medium text-ink">{t("bedsSub")}</span>
              </div>
              <div className="mt-2 grid grid-cols-10 gap-1" aria-hidden>
                {Array.from({ length: 30 }, (_, i) => (
                  <span key={i} className={cn("h-2.5 rounded-[3px]", i === 7 || i === 22 ? "bg-line" : i === 15 ? "bg-warning" : "bg-success/80")} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Window>
  );
}

// ─── WhatsApp chat (hero overlay + tenant section) ────────────────────────────

export async function ChatPreview({ className, variant = "bill" }: { className?: string; variant?: "bill" | "menu" }) {
  const t = await getTranslations("landing.preview");
  const icons = [Receipt, Wallet, FileText, Upload, Megaphone, PhoneCall];
  return (
    <div className={cn("w-[290px] overflow-hidden rounded-[28px] border-[6px] border-ink bg-[#efeae2] shadow-[0_40px_80px_-30px_rgb(15_23_42/0.55)]", className)}>
      <div className="flex items-center gap-2.5 bg-[#075e54] px-3.5 py-3 text-white">
        <Logo size={28} motion="none" />
        <div className="leading-tight">
          <p className="text-sm font-semibold">{t("chatName")}</p>
          <p className="text-[11px] text-white/70">WhatsApp Business</p>
        </div>
      </div>
      {variant === "menu" ? (
        <div className="space-y-2.5 p-3 text-[13px] leading-snug text-ink">
          <div className="ml-auto w-fit rounded-lg rounded-tr-none bg-[#d9fdd3] px-2.5 py-1.5 shadow-sm">
            {t("you")} <span className="ml-1 text-[10px] text-ink-2">10:02</span>
          </div>
          <div className="max-w-[92%] rounded-lg rounded-tl-none bg-white p-2.5 shadow-sm">{t("menuText")}</div>
          <div className="overflow-hidden rounded-xl bg-white shadow-sm">
            <p className="border-b border-line px-3 py-2 text-[12px] font-semibold text-ink-2">{t("menuTitle")}</p>
            <ul className="divide-y divide-line">
              {icons.map((Icon, i) => (
                <li key={i} className="flex items-center gap-2.5 px-3 py-2.5">
                  <Icon className="size-4 text-primary" strokeWidth={1.75} />
                  <span className="flex-1">{t(`m${i + 1}`)}</span>
                  <span className="size-3.5 rounded-full ring-1 ring-line" />
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : (
      <div className="space-y-2.5 p-3 text-[13px] leading-snug text-ink">
        <div className="max-w-[92%] rounded-lg rounded-tl-none bg-white p-2.5 shadow-sm">
          {t("chatBill")}
          <p className="mt-1 text-right text-[10px] text-ink-2">9:00</p>
        </div>
        <div className="grid max-w-[92%] grid-cols-2 gap-1.5">
          {[t("chatView"), t("chatPay")].map((b) => (
            <span key={b} className="rounded-lg bg-white py-2 text-center text-[12px] font-medium text-[#027eb5] shadow-sm">
              {b}
            </span>
          ))}
        </div>
        <div className="max-w-[92%] rounded-lg rounded-tl-none bg-white p-2.5 shadow-sm">
          <span className="mb-2 flex items-center gap-2 rounded-md bg-page p-2 text-[12px]">
            <FileText className="size-5 text-danger" strokeWidth={1.75} /> {t("chatReceipt")}
          </span>
          {t("chatPaid")}
          <p className="mt-1 text-right text-[10px] text-ink-2">11:21</p>
        </div>
      </div>
      )}
    </div>
  );
}

// ─── Billing: the Room 303 worked example (CLAUDE.md Part E) ────────────────

export async function BillSplitPreview() {
  const t = await getTranslations("landing.billing");
  // Computed with the same functions that bill real tenants.
  const meterPaise = 120 * 800;
  const [eA, eB] = splitByTenantDays(meterPaise, [
    { key: "a", days: 30 },
    { key: "b", days: 20 },
  ]);
  const tenants: { who: string; lines: [string, number][] }[] = [
    { who: t("a"), lines: [[t("rent"), prorateRent(200000, 30, 30)], [t("elec"), eA?.amountPaise ?? 0], [t("wifi"), 20000], [t("laundry"), 9000]] },
    { who: t("b"), lines: [[t("rent"), prorateRent(400000, 20, 30)], [t("elec"), eB?.amountPaise ?? 0], [t("wifi"), 20000]] },
  ];
  return (
    <Window title={t("room")}>
      <div className="p-4 sm:p-5">
        <p className="inline-flex items-center gap-2 rounded-lg bg-warning-soft px-2.5 py-1.5 text-xs font-medium text-warning">{t("meter")}</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {tenants.map(({ who, lines }) => (
            <div key={who} className="rounded-xl border border-line p-3.5">
              <p className="text-[13px] font-semibold">{who}</p>
              <dl className="mt-2 space-y-1.5 text-[13px]">
                {lines.map(([label, paise]) => (
                  <div key={label} className="flex justify-between text-ink-2">
                    <dt>{label}</dt>
                    <dd className="tabular-nums text-ink">{formatINR(paise)}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-2.5 flex justify-between border-t border-line pt-2.5 text-sm font-semibold">
                <span>{t("total")}</span>
                <span className="tabular-nums text-primary">{formatINR(lines.reduce((s, [, p]) => s + p, 0))}</span>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-ink-2">{t("note")}</p>
      </div>
    </Window>
  );
}

// ─── Payments: what RentFlow accepts and what it rejects ─────────────────────

export async function MatchPreview() {
  const t = await getTranslations("landing.pay");
  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-line bg-card p-4 shadow-[0_30px_60px_-40px_rgb(15_23_42/0.35)]">
        <div className="flex items-center justify-between gap-2">
          <Chip tone="success" icon={<Check />}>
            {t("auto")}
          </Chip>
          <span className="text-[11px] text-ink-2">UTR …4821</span>
        </div>
        <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div className="rounded-xl bg-page p-3">
            <p className="flex items-center gap-1.5 text-[11px] text-ink-2">
              <Landmark className="size-3.5" /> {t("credit")}
            </p>
            <p className="mt-1 text-lg font-semibold tabular-nums">₹6,500.12</p>
          </div>
          <span className="flex size-8 items-center justify-center rounded-full bg-primary text-white">
            <Check className="size-4" />
          </span>
          <div className="rounded-xl bg-page p-3">
            <p className="flex items-center gap-1.5 text-[11px] text-ink-2">
              <Receipt className="size-3.5" /> {t("bill")}
            </p>
            <p className="mt-1 text-lg font-semibold tabular-nums">₹6,500.12</p>
          </div>
        </div>
      </div>
      {(
        [
          [t("reused"), t("rejected"), "danger", X],
          [t("nomoney"), t("flagged"), "warning", CircleAlert],
        ] as const
      ).map(([text, chip, tone, Icon]) => (
        <div key={text} className="flex items-center gap-3 rounded-2xl border border-line bg-card p-3.5">
          <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full", tone === "danger" ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning")}>
            <Icon className="size-4" />
          </span>
          <p className="min-w-0 flex-1 text-[13px]">{text}</p>
          <Chip tone={tone}>{chip}</Chip>
        </div>
      ))}
    </div>
  );
}

// ─── Rooms & beds grid ───────────────────────────────────────────────────────

export async function BedsPreview() {
  const t = await getTranslations("landing.team");
  type S = "occupied" | "vacant" | "notice" | "reserved";
  const rooms: [string, [string, S, string?][]][] = [
    ["201", [["A", "occupied", "Aman"], ["B", "occupied", "Vikram"]]],
    ["202", [["A", "occupied", "Karan"], ["B", "notice", "Rohit"]]],
    ["203", [["A", "occupied", "Neha"], ["B", "vacant"], ["C", "occupied", "Isha"]]],
    ["204", [["A", "reserved", "Sana"], ["B", "occupied", "Rahul"]]],
  ];
  const tone: Record<S, string> = {
    occupied: "bg-success-soft text-success",
    vacant: "bg-page text-ink-2 ring-1 ring-inset ring-line",
    notice: "bg-warning-soft text-warning",
    reserved: "bg-primary-soft text-primary",
  };
  return (
    <Window title={`${t("floor")} · Sunrise PG`}>
      <div className="p-4 sm:p-5">
        <div className="grid grid-cols-2 gap-3">
          {rooms.map(([no, beds]) => (
            <div key={no} className="rounded-xl border border-line p-3">
              <p className="flex items-center gap-1.5 text-[13px] font-semibold">
                <BedDouble className="size-4 text-ink-2" strokeWidth={1.75} /> {no}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {beds.map(([label, s, name]) => (
                  <span key={label} className={cn("relative min-w-[64px] rounded-lg px-2 py-1.5 text-[11px] font-medium", tone[s])}>
                    {label} · {name ?? t("vacant")}
                    {no === "202" && label === "A" ? <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-danger ring-2 ring-card" /> : null}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {(["occupied", "vacant", "notice", "reserved"] as const).map((s) => (
            <span key={s} className={cn("rounded-md px-2 py-0.5 text-[11px] font-medium", tone[s])}>
              {t(s)}
            </span>
          ))}
        </div>
      </div>
    </Window>
  );
}
