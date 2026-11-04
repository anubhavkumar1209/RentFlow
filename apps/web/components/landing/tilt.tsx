"use client";

import { useRef, type CSSProperties, type ReactNode } from "react";

/**
 * Tilts its child in 3D towards the pointer (mouse or finger). Pure CSS
 * variables + one requestAnimationFrame, so it stays smooth on low-end phones.
 * Reduced-motion users get the still resting angle.
 */
export function Tilt({ children, className = "", rx = 0, ry = 0, range = 8 }: { children: ReactNode; className?: string; rx?: number; ry?: number; range?: number }) {
  const stage = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const frame = useRef(0);

  const set = (x: number, y: number) => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      inner.current?.style.setProperty("--rx", `${x.toFixed(2)}deg`);
      inner.current?.style.setProperty("--ry", `${y.toFixed(2)}deg`);
    });
  };
  const still = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  return (
    <div
      ref={stage}
      className={`rf-stage ${className}`}
      onPointerMove={(e) => {
        const box = stage.current?.getBoundingClientRect();
        if (!box || e.pointerType === "touch" || still()) return;
        const x = (e.clientX - box.left) / box.width - 0.5;
        const y = (e.clientY - box.top) / box.height - 0.5;
        set(rx - y * range, ry + x * range);
      }}
      onPointerLeave={() => set(rx, ry)}
    >
      <div ref={inner} className="rf-tilt" style={{ "--rx": `${rx}deg`, "--ry": `${ry}deg` } as CSSProperties}>
        {children}
      </div>
    </div>
  );
}
