import { formatDate, formatINR, formatPeriod, LANGUAGES, pack } from "@rentflow/core";
import { loadPayPage, type PayStatus } from "@rentflow/server";
import { buttonClass, Chip, cn, type Tone } from "@rentflow/ui";
import { BadgeCheck, ChevronDown, Hourglass, ReceiptText, ShieldAlert, ShieldX, Smartphone } from "lucide-react";
import type { Metadata } from "next";
import { Logo } from "@/components/brand/logo";
import { getDeps } from "@/lib/deps";
import { CopyButton, ScreenshotUpload } from "./pay-client";

export const metadata: Metadata = { title: "Pay your rent · RentFlow", robots: { index: false } };

const TONE: Record<PayStatus, Tone> = { unpaid: "danger", confirming: "warning", partially_paid: "warning", paid: "success" };

/** The tenant's bill & pay page (CLAUDE.md F2): opened from the WhatsApp bill's "Pay now". No login. */
export default async function PayPage({ params }: { params: Promise<{ token: string }> }) {
  const { token: raw } = await params;
  const token = decodeURIComponent(raw);
  const page = await loadPayPage(await getDeps(), token);

  if (!page) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
        <div className="rounded-[var(--radius-card)] border border-danger/30 bg-card p-6">
          <p className="flex items-center gap-2 text-lg font-semibold text-danger">
            <ShieldX className="size-6" /> {pack("en").payPage.invalid}
          </p>
          {/* We don't know whose link this was, so English and Hindi. */}
          <p className="mt-2 text-sm text-ink-2">{pack("en").payPage.invalidText}</p>
          <p className="mt-3 text-sm text-ink-2">{pack("hi").payPage.invalidText}</p>
        </div>
      </main>
    );
  }

  // In the tenant's own language (their WhatsApp preference), not the browser's.
  const t = pack(page.language).payPage;
  const amount = formatINR(page.toPayPaise);
  const open = page.status !== "paid" && page.toPayPaise > 0;

  return (
    <main lang={page.language} dir={LANGUAGES[page.language].dir} className="min-h-dvh bg-page">
      {/* PG-branded header */}
      <header className="bg-primary px-4 pb-16 pt-5 text-white">
        <div className="mx-auto flex max-w-md items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-white/15 text-lg font-semibold">{page.propertyName[0]}</span>
          <div className="min-w-0">
            <p className="truncate font-semibold">{page.propertyName}</p>
            <p className="text-sm text-white/75">{t.bill(formatPeriod(page.period), `${page.room}${page.bed}`)}</p>
          </div>
        </div>
      </header>

      <div className="mx-auto -mt-12 max-w-md space-y-4 px-4 pb-10">
        {/* Amount */}
        <section className="rounded-[var(--radius-modal)] border border-line bg-card p-5 shadow-[var(--shadow-card)]">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-ink-2">{t.hi(page.firstName)}</p>
            <Chip tone={TONE[page.status]}>{t.status[page.status]}</Chip>
          </div>
          {page.status === "paid" ? (
            <div className="mt-4 text-center">
              <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-success-soft text-success">
                <BadgeCheck className="size-8" />
              </span>
              <p className="mt-3 text-xl font-semibold text-ink">{t.paidTitle}</p>
              <p className="text-sm text-ink-2">{t.paidText}</p>
              {page.receiptUrl ? (
                <a href={page.receiptUrl} className={buttonClass("secondary", "lg", "mt-4 w-full")}>
                  <ReceiptText /> {t.receipt}
                </a>
              ) : null}
            </div>
          ) : (
            <>
              <p className="mt-3 text-sm text-ink-2">{page.status === "partially_paid" ? t.left : t.toPay}</p>
              <p className="text-4xl font-semibold tracking-tight tabular-nums text-ink">{amount}</p>
              <p className="mt-1 text-sm text-ink-2">{t.due(formatDate(page.dueDate))}</p>
              {page.status === "confirming" ? (
                <p className="mt-3 flex gap-2 rounded-[var(--radius-input)] bg-warning-soft p-3 text-sm text-warning">
                  <Hourglass className="mt-0.5 size-4 shrink-0" /> {t.confirmingText}
                </p>
              ) : page.status === "partially_paid" ? (
                <p className="mt-3 rounded-[var(--radius-input)] bg-warning-soft p-3 text-sm text-warning">{t.partialText}</p>
              ) : null}
            </>
          )}
        </section>

        {open && page.upiLink ? (
          <>
            {/* Pay */}
            <section className="space-y-3 rounded-[var(--radius-modal)] border border-line bg-card p-5">
              <a href={page.upiLink} className={buttonClass("primary", "lg", "h-14 w-full rounded-full text-base shadow-[0_10px_30px_-12px_rgb(15_118_110/0.7)]")}>
                <Smartphone /> {t.payApp} · {amount}
              </a>
              <p className="text-center text-xs text-ink-2">{t.appHint}</p>
              <p className="pt-1 text-center text-xs font-medium uppercase tracking-wide text-ink-2">{t.payWith}</p>
              <div className="grid grid-cols-3 gap-2">
                {page.appLinks.map((app) => (
                  <a key={app.app} href={app.href} className="flex h-12 items-center justify-center rounded-[var(--radius-input)] border border-line text-sm font-semibold text-ink hover:border-primary hover:bg-primary-soft">
                    {app.label}
                  </a>
                ))}
              </div>
            </section>

            {/* QR + manual details */}
            <section className="rounded-[var(--radius-modal)] border border-line bg-card p-5">
              <p className="text-center text-sm font-medium text-ink">{t.scan}</p>
              {page.qr ? (
                <img src={page.qr} alt={`UPI QR · ${amount}`} width={220} height={220} className="mx-auto mt-3 rounded-xl border border-line p-2" />
              ) : null}
              <p className="mt-4 text-sm font-semibold text-ink">{t.manual}</p>
              <dl className="mt-2 divide-y divide-line rounded-[var(--radius-input)] border border-line">
                {[
                  [t.upiId, page.vpa],
                  [t.payee, page.payeeName],
                  ...(page.upiPhone ? [[t.upiNumber, page.upiPhone] as const] : []),
                ].map(([label, value]) => (
                  <div key={label} className="flex items-center gap-2 py-1 pl-3">
                    <div className="min-w-0 flex-1">
                      <dt className="text-xs text-ink-2">{label}</dt>
                      <dd className="truncate font-medium text-ink">{value}</dd>
                    </div>
                    {label !== t.payee && value ? <CopyButton value={value.replace(/\s/g, "")} label={t.copy} copied={t.copied} /> : null}
                  </div>
                ))}
              </dl>
              <p className="mt-2 text-xs text-ink-2">{t.exact(amount)}</p>
            </section>
          </>
        ) : open ? (
          <p className="rounded-[var(--radius-modal)] border border-line bg-card p-5 text-sm text-ink-2">{t.noUpi}</p>
        ) : null}

        <p className={cn("flex gap-2 rounded-[var(--radius-input)] p-3 text-sm", "bg-info-soft text-info")}>
          <ShieldAlert className="mt-0.5 size-4 shrink-0" /> {t.warn(page.payeeName)}
        </p>

        {/* Itemised bill */}
        <details className="group rounded-[var(--radius-modal)] border border-line bg-card p-5" open={page.status === "paid"}>
          <summary className="flex min-h-6 cursor-pointer list-none items-center justify-between font-semibold text-ink [&::-webkit-details-marker]:hidden">
            {t.details}
            <ChevronDown className="size-5 text-ink-2 transition-transform group-open:rotate-180" />
          </summary>
          <dl className="mt-3 space-y-2 text-sm">
            {page.lines.map((l, i) => (
              <div key={i} className="flex justify-between gap-3">
                <dt className="text-ink-2">{l.description}</dt>
                <dd className="tabular-nums text-ink">{formatINR(l.amountPaise)}</dd>
              </div>
            ))}
            <div className="flex justify-between border-t border-line pt-2 font-semibold">
              <dt>{t.total}</dt>
              <dd className="tabular-nums">{formatINR(page.totalPaise)}</dd>
            </div>
          </dl>
        </details>

        {page.status === "unpaid" || page.status === "partially_paid" ? (
          <section className="rounded-[var(--radius-modal)] border border-line bg-card p-5">
            <ScreenshotUpload token={token} text={t.upload} />
          </section>
        ) : null}

        <p className="flex items-center justify-center gap-2 pt-2 text-xs text-ink-2">
          <Logo size={18} motion="none" /> RentFlow
        </p>
      </div>
    </main>
  );
}
