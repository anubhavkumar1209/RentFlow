import { Toaster } from "@rentflow/ui";
import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import {
  Inter,
  Noto_Nastaliq_Urdu,
  Noto_Sans_Bengali,
  Noto_Sans_Devanagari,
  Noto_Sans_Gujarati,
  Noto_Sans_Gurmukhi,
  Noto_Sans_Kannada,
  Noto_Sans_Malayalam,
  Noto_Sans_Oriya,
  Noto_Sans_Tamil,
  Noto_Sans_Telugu,
} from "next/font/google";
import { LANGUAGES, toLanguage } from "@rentflow/core";
import { isDemo } from "@/lib/env";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const devanagari = Noto_Sans_Devanagari({ subsets: ["devanagari"], variable: "--font-devanagari", display: "swap", weight: ["400", "500", "600", "700"] });
// One font per Indian script (next/font needs each as its own const). Not preloaded:
// a page downloads only the scripts it actually shows.
const bengali = Noto_Sans_Bengali({ subsets: ["bengali"], variable: "--font-bengali", display: "swap", weight: ["400", "500", "600", "700"], preload: false });
const tamil = Noto_Sans_Tamil({ subsets: ["tamil"], variable: "--font-tamil", display: "swap", weight: ["400", "500", "600", "700"], preload: false });
const telugu = Noto_Sans_Telugu({ subsets: ["telugu"], variable: "--font-telugu", display: "swap", weight: ["400", "500", "600", "700"], preload: false });
const gujarati = Noto_Sans_Gujarati({ subsets: ["gujarati"], variable: "--font-gujarati", display: "swap", weight: ["400", "500", "600", "700"], preload: false });
const kannada = Noto_Sans_Kannada({ subsets: ["kannada"], variable: "--font-kannada", display: "swap", weight: ["400", "500", "600", "700"], preload: false });
const malayalam = Noto_Sans_Malayalam({ subsets: ["malayalam"], variable: "--font-malayalam", display: "swap", weight: ["400", "500", "600", "700"], preload: false });
const gurmukhi = Noto_Sans_Gurmukhi({ subsets: ["gurmukhi"], variable: "--font-gurmukhi", display: "swap", weight: ["400", "500", "600", "700"], preload: false });
const oriya = Noto_Sans_Oriya({ subsets: ["oriya"], variable: "--font-oriya", display: "swap", weight: ["400", "500", "600", "700"], preload: false });
const urdu = Noto_Nastaliq_Urdu({ subsets: ["arabic"], variable: "--font-urdu", display: "swap", weight: ["400", "500", "600", "700"], preload: false });
const scripts = [bengali, tamil, telugu, gujarati, kannada, malayalam, gurmukhi, oriya, urdu];

export const metadata: Metadata = {
  title: "RentFlow",
  description: "Rent collection for PGs and hostels, on WhatsApp.",
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
  appleWebApp: { capable: true, title: "RentFlow", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#0F766E",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = toLanguage(await getLocale());
  const t = await getTranslations("demo");
  return (
    <html lang={locale} dir={LANGUAGES[locale].dir} className={[inter, devanagari, ...scripts].map((f) => f.variable).join(" ")}>
      <body className="min-h-dvh font-sans antialiased">
        <NextIntlClientProvider>
          {isDemo ? <div className="bg-warning-soft px-4 py-2 text-center text-sm text-warning">{t("banner")}</div> : null}
          {children}
          <Toaster />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
