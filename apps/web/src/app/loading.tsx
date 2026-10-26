import { BrandLogo, Skeleton, SkeletonLine } from '@bookingflow/ui';

/** App-wide route loading: the Bookly wordmark over a calm page skeleton. No spinner. */
export default function RootLoading() {
    return (
        <div className="flex min-h-screen flex-col items-center bg-bg px-4 pt-16 sm:pt-24" aria-busy="true">
            <span className="sr-only">Loading…</span>
            <BrandLogo size="md" labelled={false} />
            <div className="mt-10 w-full max-w-[440px] space-y-4" aria-hidden>
                <SkeletonLine width="w-2/3" className="h-7" />
                <SkeletonLine width="w-full" />
                <SkeletonLine width="w-4/5" />
                <Skeleton className="mt-6 h-40 w-full rounded-card-lg" />
                <Skeleton className="h-12 w-full rounded-control" />
            </div>
        </div>
    );
}
