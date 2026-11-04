"use client";

import { Toaster as Sonner, toast } from "sonner";

/** One toaster per app; success messages appear as toasts (CLAUDE.md H5). */
export function Toaster() {
  return (
    <Sonner
      position="top-center"
      toastOptions={{
        classNames: {
          toast: "rounded-[var(--radius-card)] border border-line bg-card text-ink shadow-[var(--shadow-card)]",
          success: "[&_[data-icon]]:text-success",
          error: "[&_[data-icon]]:text-danger",
        },
      }}
    />
  );
}

export { toast };
