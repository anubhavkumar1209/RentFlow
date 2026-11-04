import { Skeleton } from "@rentflow/ui";

/** Skeleton while a page's data loads (CLAUDE.md H5). */
export default function Loading() {
  return (
    <div className="space-y-5 px-4 py-5 md:px-6" aria-busy="true">
      <Skeleton className="h-7 w-56" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}
