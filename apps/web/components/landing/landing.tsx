import { buttonClass, cn } from "@rentflow/ui";
import {
  ArrowRight,
  BadgeCheck,
  BellRing,
  Building2,
  Calculator,
  Check,
  ChevronDown,
  Database,
  DoorOpen,
  FileSpreadsheet,
  FileWarning,
  History,
  ImageOff,
  Landmark,
  Languages,
  LockKeyhole,
  MapPin,
  MessageCircle,
  PhoneCall,
  QrCode,
  ReceiptText,
  ShieldCheck,
  Smartphone,
  Upload,
  UserCog,
  Users,
  Wallet,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { LanguageSwitch } from "@/app/ui";
import { Logo } from "@/components/brand/logo";
import { BedsPreview, BillSplitPreview, ChatPreview, DashboardPreview, MatchPreview } from "./previews";
import { Tilt } from "./tilt";

const W = (
  <>
    Rent<span className="text-primary">Flow</span>
  </>
);

function Eyebrow({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  return (
    <p className={cn("inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em]", dark ? "text-mint" : "text-primary")}>
      <span className={cn("h-px w-6", dark ? "bg-mint" : "bg-primary")} />
      {children}
    </p>
  );
}

function H2({ children, className }: { children: ReactNode; className?: string }) {
  return <h2 className={cn("mt-4 text-3xl font-semibold leading-[1.1] tracking-[-0.025em] sm:text-[44px]", className)}>{children}</h2>;
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="mt-6 space-y-3">
      {items.map((b) => (
        <li key={b} className="flex gap-3 text-[15px] leading-relaxed text-ink-2">
          <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
            <Check className="size-3" strokeWidth={3} />
          </span>
          {b}
        </li>
      ))}
    </ul>
  );
}

/** One feature: copy on one side, a product preview on the other. */
function Feature({ id, eyebrow, title, sub, bullets, flip, children }: { id?: string; eyebrow: string; title: string; sub: string; bullets: string[]; flip?: boolean; children: ReactNode }) {
  return (
    <div id={id} className="grid scroll-mt-24 items-center gap-10 lg:grid-cols-2 lg:gap-16">
      <div className={cn("rf-reveal", flip && "lg:order-2")}>
        <Eyebrow>{eyebrow}</Eyebrow>
        <H2>{title}</H2>
        <p className="mt-4 text-lg leading-relaxed text-ink-2">{sub}</p>
        <Bullets items={bullets} />
      </div>
      <div className="rf-reveal relative">
        <div aria-hidden className="absolute -inset-4 -z-10 rounded-[28px] bg-gradient-to-br from-primary-soft via-page to-page sm:-inset-6" />
        {children}
      </div>
    </div>
  );
}

export async function Landing() {
  const t = await getTranslations("landing");

  const trust = ["t1", "t2", "t3", "t4"] as const;
  const facts = ["1", "2", "3", "4"] as const;
  const problems: [LucideIcon, string][] = [
    [Wallet, "1"],
    [Calculator, "2"],
    [Zap, "3"],
    [ImageOff, "4"],
    [FileWarning, "5"],
    [PhoneCall, "6"],
  ];
  const steps: [LucideIcon, string][] = [
    [Building2, "1"],
    [BadgeCheck, "2"],
    [MessageCircle, "3"],
  ];
  const grid: [LucideIcon, string][] = [
    [BellRing, "1"],
    [QrCode, "2"],
    [Wallet, "3"],
    [DoorOpen, "4"],
    [FileSpreadsheet, "5"],
    [Upload, "6"],
    [Building2, "7"],
    [History, "8"],
    [Languages, "9"],
  ];
  const security: [LucideIcon, string][] = [
    [Landmark, "1"],
    [LockKeyhole, "2"],
    [MapPin, "3"],
    [ShieldCheck, "4"],
    [UserCog, "5"],
    [Database, "6"],
  ];
  const faqs = ["1", "2", "3", "4", "5", "6", "7", "8"] as const;
  const links = [
    ["product", "#product"],
    ["how", "#how"],
    ["tenants", "#tenants"],
    ["security", "#security"],
    ["faq", "#faq"],
  ] as const;

  // Structured data for search engines (Google: FAQ + software application).
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "RentFlow",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      description: t("hero.sub"),
      areaServed: "IN",
      inLanguage: ["en", "hi"],
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faqs.map((n) => ({ "@type": "Question", name: t(`faq.q${n}`), acceptedAnswer: { "@type": "Answer", text: t(`faq.a${n}`) } })),
    },
  ];

  return (
    <div className="min-h-dvh overflow-x-clip bg-card text-ink">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />

      {/* ── Header ───────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-line/70 bg-card/80 backdrop-blur-lg">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-8 px-4 sm:px-6">
          <Link href="/" className="rf-logo-trigger flex items-center gap-2" aria-label="RentFlow">
            <Logo size={30} />
            <span className="text-lg font-semibold tracking-tight">{W}</span>
          </Link>
          <nav className="hidden items-center gap-7 text-sm font-medium text-ink-2 lg:flex">
            {links.map(([k, href]) => (
              <a key={k} href={href} className="whitespace-nowrap transition-colors hover:text-ink">
                {t(`nav.${k}`)}
              </a>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <div className="hidden sm:block">
              <LanguageSwitch />
            </div>
            <Link href="/login" className={buttonClass("ghost", "sm")}>
              {t("nav.login")}
            </Link>
            <Link href="/login?start=1" className={buttonClass("primary", "sm", "rounded-full px-4")}>
              {t("nav.start")}
            </Link>
          </div>
        </div>
      </header>

      <main>
        {/* ── Hero ─────────────────────────────────────── */}
        <section className="rf-hero relative">
          <div aria-hidden className="rf-grid pointer-events-none absolute inset-0" />
          <div className="relative mx-auto max-w-7xl px-4 pt-14 sm:px-6 md:pt-16">
            <div className="mx-auto max-w-4xl text-center">
              <p className="inline-flex items-center gap-2 rounded-full border border-primary/15 bg-card/80 px-3.5 py-1.5 text-[13px] font-medium text-primary shadow-sm">
                <span className="size-1.5 rounded-full bg-primary" /> {t("hero.badge")}
              </p>
              <h1 className="mt-6 text-[40px] font-semibold leading-[1.05] tracking-[-0.035em] sm:text-6xl lg:text-[68px]">
                {t("hero.title1")}{" "}
                <span className="bg-gradient-to-r from-primary to-[#14b8a6] bg-clip-text text-transparent">{t("hero.title2")}</span>
              </h1>
              <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-ink-2 sm:text-xl">{t("hero.sub")}</p>
              <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Link href="/login?start=1" className={buttonClass("primary", "lg", "w-full rounded-full px-7 shadow-[0_10px_30px_-10px_rgb(15_118_110/0.6)] sm:w-auto")}>
                  {t("hero.start")} <ArrowRight />
                </Link>
                <a href="#how" className={buttonClass("secondary", "lg", "w-full rounded-full px-7 sm:w-auto")}>
                  {t("hero.how")}
                </a>
              </div>
              <ul className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-ink-2">
                {trust.map((k) => (
                  <li key={k} className="flex items-center gap-1.5">
                    <Check className="size-4 text-primary" /> {t(`hero.${k}`)}
                  </li>
                ))}
              </ul>
            </div>

            {/* Product preview, in 3D */}
            {/* Dashboard + chat form one centred group: the chat sits in the right padding. */}
            <div className="rf-rise relative mx-auto mt-12 max-w-6xl pb-16 md:mt-14 md:pb-24">
              <Tilt rx={12} ry={0} range={6}>
                <div className="rf-3d relative md:pr-24 lg:pr-32">
                  <DashboardPreview />
                  <div className="absolute -bottom-16 right-0 hidden md:block" style={{ transform: "translateZ(90px)" }}>
                    <div className="rf-float">
                      <ChatPreview />
                    </div>
                  </div>
                </div>
              </Tilt>
            </div>
          </div>
        </section>

        {/* ── Facts ────────────────────────────────────── */}
        <section className="border-y border-line bg-page">
          <dl className="mx-auto grid max-w-7xl grid-cols-2 divide-line px-4 sm:px-6 lg:grid-cols-4 lg:divide-x">
            {facts.map((n) => (
              <div key={n} className="px-2 py-8 text-center lg:px-6">
                <dt className="text-3xl font-semibold tracking-tight text-primary sm:text-4xl">{t(`facts.f${n}v`)}</dt>
                <dd className="mt-1.5 text-sm text-ink-2">{t(`facts.f${n}l`)}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* ── Problems ─────────────────────────────────── */}
        <section className="mx-auto max-w-7xl px-4 py-24 sm:px-6 md:py-32">
          <div className="rf-reveal max-w-3xl">
            <Eyebrow>{t("problems.eyebrow")}</Eyebrow>
            <H2>{t("problems.title")}</H2>
          </div>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {problems.map(([Icon, n]) => (
              <div key={n} className="rf-reveal group rounded-2xl border border-line bg-card p-6 transition-shadow hover:shadow-[0_20px_40px_-24px_rgb(15_23_42/0.25)]">
                <span className="flex size-10 items-center justify-center rounded-xl bg-danger-soft text-danger">
                  <Icon className="size-5" strokeWidth={1.75} />
                </span>
                <h3 className="mt-4 text-lg font-semibold">{t(`problems.p${n}t`)}</h3>
                <p className="mt-1.5 leading-relaxed text-ink-2">{t(`problems.p${n}d`)}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── How it works ─────────────────────────────── */}
        <section id="how" className="scroll-mt-16 border-y border-line bg-page">
          <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6 md:py-32">
            <div className="rf-reveal mx-auto max-w-3xl text-center">
              <Eyebrow>{t("how.eyebrow")}</Eyebrow>
              <H2>{t("how.title")}</H2>
            </div>
            <ol className="relative mt-14 grid gap-6 md:grid-cols-3">
              <span aria-hidden className="absolute left-[16%] right-[16%] top-7 hidden h-px bg-gradient-to-r from-primary/0 via-primary/40 to-primary/0 md:block" />
              {steps.map(([Icon, n]) => (
                <li key={n} className="rf-reveal relative rounded-2xl border border-line bg-card p-6 text-center">
                  <span className="relative mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary text-white shadow-[0_12px_24px_-12px_rgb(15_118_110/0.7)]">
                    <Icon className="size-6" strokeWidth={1.75} />
                    <span className="absolute -right-2 -top-2 flex size-6 items-center justify-center rounded-full bg-card text-xs font-bold text-primary ring-1 ring-line">{n}</span>
                  </span>
                  <h3 className="mt-5 text-lg font-semibold">{t(`how.s${n}t`)}</h3>
                  <p className="mt-2 leading-relaxed text-ink-2">{t(`how.s${n}d`)}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ── Features ─────────────────────────────────── */}
        <section id="product" className="mx-auto max-w-7xl scroll-mt-16 space-y-28 px-4 py-24 sm:px-6 md:space-y-36 md:py-32">
          <Feature eyebrow={t("billing.eyebrow")} title={t("billing.title")} sub={t("billing.sub")} bullets={[t("billing.b1"), t("billing.b2"), t("billing.b3")]}>
            <BillSplitPreview />
          </Feature>
          <Feature flip eyebrow={t("pay.eyebrow")} title={t("pay.title")} sub={t("pay.sub")} bullets={[t("pay.b1"), t("pay.b2"), t("pay.b3")]}>
            <MatchPreview />
          </Feature>
          <Feature id="tenants" eyebrow={t("wa.eyebrow")} title={t("wa.title")} sub={t("wa.sub")} bullets={[t("wa.b1"), t("wa.b2"), t("wa.b3")]}>
            <div className="flex justify-center py-4">
              <ChatPreview variant="menu" />
            </div>
          </Feature>
          <Feature flip eyebrow={t("team.eyebrow")} title={t("team.title")} sub={t("team.sub")} bullets={[t("team.b1"), t("team.b2"), t("team.b3")]}>
            <BedsPreview />
          </Feature>
        </section>

        {/* ── Everything else ──────────────────────────── */}
        <section className="border-y border-line bg-page">
          <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6 md:py-32">
            <div className="rf-reveal mx-auto max-w-3xl text-center">
              <Eyebrow>{t("grid.eyebrow")}</Eyebrow>
              <H2>{t("grid.title")}</H2>
            </div>
            <div className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
              {grid.map(([Icon, n]) => (
                <div key={n} className="bg-card p-6 sm:p-7">
                  <Icon className="size-6 text-primary" strokeWidth={1.75} />
                  <h3 className="mt-4 font-semibold">{t(`grid.g${n}t`)}</h3>
                  <p className="mt-1.5 text-[15px] leading-relaxed text-ink-2">{t(`grid.g${n}d`)}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Old way vs RentFlow ─────────────────────── */}
        <section className="mx-auto max-w-5xl px-4 py-24 sm:px-6 md:py-32">
          <H2 className="rf-reveal text-center">{t("compare.title")}</H2>
          <div className="rf-reveal mt-12 overflow-hidden rounded-2xl border border-line">
            <div className="grid grid-cols-2 bg-page text-sm font-semibold">
              <p className="px-4 py-4 text-ink-2 sm:px-6">{t("compare.before")}</p>
              <p className="flex items-center gap-2 border-l border-line bg-primary-soft px-4 py-4 text-primary sm:px-6">
                <Logo size={20} motion="none" /> {t("compare.after")}
              </p>
            </div>
            {(["1", "2", "3", "4", "5", "6"] as const).map((n) => (
              <div key={n} className="grid grid-cols-2 border-t border-line text-[15px]">
                <p className="flex gap-2.5 px-4 py-4 text-ink-2 sm:px-6">
                  <X className="mt-0.5 size-4 shrink-0 text-danger" /> {t(`compare.r${n}a`)}
                </p>
                <p className="flex gap-2.5 border-l border-line px-4 py-4 font-medium sm:px-6">
                  <Check className="mt-0.5 size-4 shrink-0 text-primary" /> {t(`compare.r${n}b`)}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Security ─────────────────────────────────── */}
        <section id="security" className="relative scroll-mt-16 overflow-hidden bg-ink text-white">
          <div aria-hidden className="absolute inset-0 bg-[radial-gradient(50%_60%_at_80%_0%,rgb(15_118_110/0.45),transparent_70%)]" />
          <div className="relative mx-auto max-w-7xl px-4 py-24 sm:px-6 md:py-32">
            <div className="rf-reveal max-w-3xl">
              <Eyebrow dark>{t("security.eyebrow")}</Eyebrow>
              <H2>{t("security.title")}</H2>
            </div>
            <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {security.map(([Icon, n]) => (
                <div key={n} className="rf-reveal rounded-2xl border border-white/10 bg-white/[0.04] p-6">
                  <span className="flex size-10 items-center justify-center rounded-xl bg-primary/30 text-mint">
                    <Icon className="size-5" strokeWidth={1.75} />
                  </span>
                  <h3 className="mt-4 text-lg font-semibold">{t(`security.s${n}t`)}</h3>
                  <p className="mt-1.5 leading-relaxed text-white/65">{t(`security.s${n}d`)}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── FAQ ─────────────────────────────────────── */}
        <section id="faq" className="mx-auto grid max-w-7xl scroll-mt-16 gap-10 px-4 py-24 sm:px-6 md:py-32 lg:grid-cols-[1fr_1.7fr] lg:gap-16">
          <div className="lg:sticky lg:top-28 lg:self-start">
            <H2 className="mt-0">{t("faq.title")}</H2>
            <p className="mt-4 leading-relaxed text-ink-2">{t("faq.sub")}</p>
          </div>
          <div className="divide-y divide-line rounded-2xl border border-line">
            {faqs.map((n) => (
              <details key={n} className="group px-5 sm:px-6" open={n === "1"}>
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 py-5 font-semibold [&::-webkit-details-marker]:hidden">
                  {t(`faq.q${n}`)}
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-page text-ink-2 transition-transform group-open:rotate-180">
                    <ChevronDown className="size-4" />
                  </span>
                </summary>
                <p className="-mt-1 pb-5 leading-relaxed text-ink-2">{t(`faq.a${n}`)}</p>
              </details>
            ))}
          </div>
        </section>

        {/* ── Call to action ──────────────────────────── */}
        <section className="px-4 pb-24 sm:px-6">
          <div className="relative mx-auto max-w-7xl overflow-hidden rounded-[28px] bg-primary px-6 py-16 text-center text-white sm:px-12 md:py-20">
            <div aria-hidden className="absolute inset-0 bg-[radial-gradient(60%_80%_at_50%_0%,rgb(94_234_212/0.35),transparent_70%)]" />
            <div className="relative">
              <h2 className="mx-auto max-w-3xl text-3xl font-semibold leading-[1.1] tracking-[-0.025em] sm:text-5xl">{t("cta.title")}</h2>
              <p className="mx-auto mt-4 max-w-xl text-lg text-white/80">{t("cta.sub")}</p>
              <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Link href="/login?start=1" className={buttonClass("secondary", "lg", "w-full rounded-full border-0 px-7 text-primary sm:w-auto")}>
                  {t("cta.start")} <ArrowRight />
                </Link>
                <Link href="/login" className={buttonClass("ghost", "lg", "w-full rounded-full px-7 text-white ring-1 ring-white/40 hover:bg-white/10 hover:text-white sm:w-auto")}>
                  {t("cta.login")}
                </Link>
              </div>
              <p className="mt-6 flex items-center justify-center gap-4 text-sm text-white/75">
                <span className="flex items-center gap-1.5">
                  <Smartphone className="size-4" /> {t("hero.t4")}
                </span>
                <span className="flex items-center gap-1.5">
                  <Users className="size-4" /> {t("hero.t1")}
                </span>
              </p>
            </div>
          </div>
        </section>
      </main>

      {/* ── Footer ───────────────────────────────────── */}
      <footer className="border-t border-line bg-page">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[2fr_1fr_1fr]">
          <div>
            <div className="rf-logo-trigger flex items-center gap-2">
              <Logo size={28} motion="hover" />
              <span className="text-lg font-semibold">{W}</span>
            </div>
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-ink-2">{t("footer.tag")}</p>
          </div>
          <div>
            <p className="text-sm font-semibold">{t("footer.product")}</p>
            <ul className="mt-3 space-y-2 text-sm text-ink-2">
              {links.slice(1).map(([k, href]) => (
                <li key={k}>
                  <a href={href} className="hover:text-ink">
                    {t(`nav.${k}`)}
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-sm font-semibold">{t("footer.language")}</p>
            <div className="mt-2 -ml-3">
              <LanguageSwitch />
            </div>
            <Link href="/login" className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
              <ReceiptText className="size-4" /> {t("nav.login")}
            </Link>
          </div>
        </div>
        <div className="border-t border-line">
          <p className="mx-auto max-w-7xl px-4 py-6 text-sm text-ink-2 sm:px-6">
            © {new Date().getFullYear()} RentFlow · {t("footer.made")}
          </p>
        </div>
        {/* TODO(M13): pricing, privacy policy, terms, contact/demo form. */}
      </footer>
    </div>
  );
}
