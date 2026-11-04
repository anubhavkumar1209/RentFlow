"use client";

// Building blocks for the signed-out pages (login, signup), on the shared design system.
import { Alert, Button as UiButton, Field as UiField, cn } from "@rentflow/ui";
import { LANGUAGES, type Language } from "@rentflow/core";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft, Check, Languages, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useTransition, type ComponentProps } from "react";
import { setLanguageAction } from "./(app)/shell-actions";
import { Logo } from "@/components/brand/logo";
import { LanguageOptions } from "@/components/language-options";

const Wordmark = ({ light = false }: { light?: boolean }) => (
  <span className={cn("text-xl font-semibold tracking-tight", light ? "text-white" : "text-ink")}>
    Rent<span className={light ? "text-mint" : "text-primary"}>Flow</span>
  </span>
);

/** Signed-out screens (login, onboarding): brand panel on the left, the form on the right, matching the landing page. */
export function Card({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) {
  const t = useTranslations("auth");
  return (
    <div className="grid min-h-dvh bg-card lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel (large screens) */}
      <aside className="relative hidden overflow-hidden bg-primary p-12 text-white lg:flex lg:flex-col">
        <div aria-hidden className="absolute inset-0 bg-[radial-gradient(70%_60%_at_20%_0%,rgb(94_234_212/0.35),transparent_70%),radial-gradient(50%_50%_at_100%_100%,rgb(15_23_42/0.35),transparent_70%)]" />
        <div aria-hidden className="absolute inset-0 bg-[linear-gradient(to_right,rgb(255_255_255/0.06)_1px,transparent_1px),linear-gradient(to_bottom,rgb(255_255_255/0.06)_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:radial-gradient(70%_60%_at_30%_30%,black,transparent)]" />
        <Link href="/" className="rf-logo-trigger relative flex w-fit items-center gap-2">
          <span className="rounded-[12px] ring-2 ring-white/25">
            <Logo size={36} />
          </span>
          <Wordmark light />
        </Link>
        <div className="relative my-auto max-w-md py-12">
          <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[13px] font-medium text-mint ring-1 ring-white/15">
            <span className="size-1.5 rounded-full bg-mint" /> {t("panelBadge")}
          </p>
          <h2 className="mt-5 text-4xl font-semibold leading-[1.1] tracking-[-0.03em] xl:text-5xl">{t("panelTitle")}</h2>
          <ul className="mt-8 space-y-3.5">
            {(["p1", "p2", "p3"] as const).map((k) => (
              <li key={k} className="flex items-center gap-3 text-[15px] text-white/85">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-white/15">
                  <Check className="size-3.5 text-mint" strokeWidth={3} />
                </span>
                {t(k)}
              </li>
            ))}
          </ul>
          {/* A confirmed bill, like the ones on the landing page (example data). */}
          <div className="rf-float mt-12 w-full max-w-sm rounded-2xl bg-card p-4 text-ink shadow-[0_40px_80px_-30px_rgb(0_0_0/0.5)] [transform:rotate(-2deg)]">
            <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.12em] text-ink-2">
              <span>{t("cardRoom")}</span>
              <span className="rounded-md bg-page px-1.5 py-0.5 normal-case tracking-normal ring-1 ring-line">{t("example")}</span>
            </div>
            <div className="mt-2 flex items-end justify-between gap-3">
              <p className="text-[15px] font-medium">Priya Sharma</p>
              <p className="text-2xl font-semibold tabular-nums">₹6,500.12</p>
            </div>
            <p className="mt-2 flex items-center gap-1.5 text-[13px] font-medium text-success">
              <span className="flex size-4 items-center justify-center rounded-full bg-success-soft">
                <Check className="size-3" strokeWidth={3} />
              </span>
              {t("cardPaid")}
            </p>
          </div>
        </div>
        <p className="relative flex gap-5 text-sm text-white/70">
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="size-4" /> {t("trust1")}
          </span>
          <span className="flex items-center gap-1.5">
            <Languages className="size-4" /> {t("trust2")}
          </span>
        </p>
      </aside>

      {/* Form column */}
      <main className="relative flex flex-col px-4 py-6 sm:px-10">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(60%_100%_at_50%_0%,rgb(94_234_212/0.18),transparent_70%)] lg:hidden" />
        <div className="relative flex items-center justify-between gap-2">
          <Link href="/" className="rf-logo-trigger flex items-center gap-2 lg:hidden">
            <Logo size={32} />
            <Wordmark />
          </Link>
          <Link href="/" className="hidden items-center gap-1.5 text-sm font-medium text-ink-2 hover:text-ink lg:inline-flex">
            <ArrowLeft className="size-4" /> {t("back")}
          </Link>
          <LanguageSwitch />
        </div>
        <div className="relative mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-10">
          {children}
          {footer ? <div className="mt-8 text-center text-sm text-ink-2">{footer}</div> : null}
        </div>
        <ul className="relative mx-auto mb-2 flex flex-wrap justify-center gap-x-5 gap-y-2 text-[13px] text-ink-2 lg:hidden">
          {(["trust1", "trust2"] as const).map((k) => (
            <li key={k} className="flex items-center gap-1.5">
              <Check className="size-3.5 text-primary" /> {t(k)}
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}

/** English / हिन्दी toggle, available before logging in. */
export function LanguageSwitch() {
  const locale = useLocale() as Language;
  const [pending, start] = useTransition();
  return (
    <label className="relative inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-input)] px-2 text-sm text-ink-2 hover:bg-page">
      <Languages className="size-4 shrink-0" aria-hidden />
      <span className="sr-only">Language</span>
      {/* The native name only, so the switch stays small; the list shows "தமிழ் · Tamil". */}
      <span aria-hidden className="max-w-24 truncate">{LANGUAGES[locale]?.native ?? "English"}</span>
      <select
        value={locale}
        disabled={pending}
        onChange={(e) => start(() => setLanguageAction(e.target.value))}
        className="absolute inset-0 cursor-pointer opacity-0"
        aria-label="Language"
      >
        <LanguageOptions />
      </select>
    </label>
  );
}

export function Field(props: ComponentProps<"input"> & { label: string; hint?: string }) {
  return <UiField {...props} />;
}

export function Button({ className = "", ...props }: ComponentProps<"button">) {
  return <UiButton size="lg" className={cn("w-full", className)} {...props} />;
}

export function ErrorText({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return <Alert>{children}</Alert>;
}
