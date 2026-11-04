"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Background jobs (bills, receipts) finish a moment after the click; keep the phone screen fresh. */
export function AutoRefresh({ seconds = 3 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}
