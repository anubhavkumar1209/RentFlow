import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Landing } from "@/components/landing/landing";
import { isLoggedIn, requireSession } from "@/lib/session";

export const metadata: Metadata = {
  title: "RentFlow — rent collection for PGs, confirmed by your bank",
  description: "RentFlow sends every tenant their bill on WhatsApp, matches each payment with your bank and sends the receipt. For PG and hostel owners in India.",
};

/** Public landing page; people who are already logged in go straight to their app. */
export default async function Home() {
  if (await isLoggedIn()) {
    const session = await requireSession();
    redirect(session.actor ? "/dashboard" : "/onboarding");
  }
  return <Landing />;
}
