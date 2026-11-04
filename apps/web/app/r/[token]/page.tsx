import { formatDate, formatINR } from "@rentflow/core";
import { loadReceiptView, verifyReceiptToken } from "@rentflow/server";
import type { Metadata } from "next";
import { getDeps } from "@/lib/deps";
import { BadgeCheck, ShieldX } from "lucide-react";
import { Logo } from "@/components/brand/logo";

export const metadata: Metadata = { title: "Verify receipt · RentFlow", robots: { index: false } };

/** Public receipt check (M6): anyone scanning the QR on a receipt can confirm it's genuine. No login. */
export default async function VerifyReceiptPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const deps = await getDeps();
  const id = verifyReceiptToken(deps.config.receiptSecret, decodeURIComponent(token));
  const view = id ? await loadReceiptView(deps.db, id) : null;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-6 flex items-center gap-2">
        <Logo size={36} motion="intro" />
        <span className="text-xl font-semibold">Rent<span className="text-primary">Flow</span></span>
      </div>
      {view ? (
        <div className="rounded-[var(--radius-card)] border border-success/30 bg-card p-6">
          <p className="flex items-center gap-2 text-lg font-semibold text-success"><BadgeCheck className="size-6" /> Genuine receipt</p>
          <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-ink-2">Receipt</dt>
            <dd className="font-medium">{view.number}</dd>
            <dt className="text-ink-2">Issued by</dt>
            <dd>{view.propertyName}</dd>
            <dt className="text-ink-2">Paid by</dt>
            {/* Only the first name and initial: this page is public. */}
            <dd>
              {view.tenantName.split(" ")[0]} {view.tenantName.split(" ")[1]?.[0] ? `${view.tenantName.split(" ")[1]?.[0]}.` : ""} · Room {view.room}
              {view.bed}
            </dd>
            <dt className="text-ink-2">Amount</dt>
            <dd className="font-semibold">{formatINR(view.amountPaise)}</dd>
            <dt className="text-ink-2">Date</dt>
            <dd>{formatDate(view.issuedOn)}</dd>
          </dl>
        </div>
      ) : (
        <div className="rounded-[var(--radius-card)] border border-danger/30 bg-card p-6">
          <p className="flex items-center gap-2 text-lg font-semibold text-danger"><ShieldX className="size-6" /> Not a valid RentFlow receipt</p>
          <p className="mt-2 text-sm text-ink-2">This link wasn&apos;t issued by RentFlow or has been changed. Ask the PG for the original receipt.</p>
        </div>
      )}
    </main>
  );
}
