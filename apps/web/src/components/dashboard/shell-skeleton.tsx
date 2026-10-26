import { BrandLogo, Skeleton, SkeletonCard, SkeletonLine } from '@bookingflow/ui';

/** What the app frame looks like while the session loads — no spinner. */
export function ShellSkeleton() {
    return (
        <div className="flex min-h-screen bg-bg" aria-busy="true">
            <span className="sr-only" role="status">Loading your workspace…</span>
            <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col gap-2 border-r border-border bg-surface p-4 lg:flex" aria-hidden>
                <BrandLogo variant="lockup" size="sm" labelled={false} />
                <Skeleton className="mt-4 h-14 w-full rounded-control" />
                {Array.from({ length: 8 }).map((_, i) => (
                    <Skeleton key={i} className="h-11 w-full rounded-control" />
                ))}
            </aside>
            <div className="flex flex-1 flex-col lg:ml-64">
                <div className="flex h-16 items-center gap-3 px-4 lg:px-8" aria-hidden>
                    <span className="lg:hidden"><BrandLogo variant="icon" size="sm" labelled={false} /></span>
                    <SkeletonLine width="w-40" />
                    <Skeleton className="ml-auto h-9 w-9 rounded-full" />
                </div>
                <div className="space-y-6 px-4 pt-5 sm:px-6 lg:px-8 lg:pt-8" aria-hidden>
                    <Skeleton className="h-9 w-56 rounded-control" />
                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                        {Array.from({ length: 4 }).map((_, i) => (
                            <Skeleton key={i} className="h-28 rounded-card" />
                        ))}
                    </div>
                    <div className="grid gap-4 lg:grid-cols-2">
                        <SkeletonCard />
                        <SkeletonCard />
                    </div>
                </div>
            </div>
        </div>
    );
}
