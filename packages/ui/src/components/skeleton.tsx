import { type HTMLAttributes } from 'react';
import { cn } from '../cn';

/**
 * Loading placeholders — skeletons, not spinners. The shimmer
 * (`.skeleton-shimmer`, globals.css) stops under reduced motion.
 * Wrap a group in an element with `aria-busy="true"` and a visually-hidden
 * "Loading…" label; the shapes themselves are aria-hidden.
 */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
    return <div aria-hidden className={cn('skeleton-shimmer rounded-lg bg-surface-2', className)} {...props} />;
}

/** One line of text. `width` as a Tailwind class, e.g. "w-2/3". */
export function SkeletonLine({ className, width = 'w-full' }: { className?: string; width?: string }) {
    return <Skeleton className={cn('h-4', width, className)} />;
}

/** A card: title, two lines, an action. */
export function SkeletonCard({ className }: { className?: string }) {
    return (
        <div aria-hidden className={cn('rounded-card border border-border bg-surface p-5 shadow-card', className)}>
            <div className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="flex-1 space-y-2">
                    <SkeletonLine width="w-1/2" />
                    <SkeletonLine width="w-1/3" className="h-3" />
                </div>
            </div>
            <div className="mt-5 space-y-2.5">
                <SkeletonLine />
                <SkeletonLine width="w-4/5" />
            </div>
            <Skeleton className="mt-5 h-11 w-32 rounded-control" />
        </div>
    );
}

/** A table row with `columns` cells (desktop tables). */
export function SkeletonTableRow({ columns = 4, className }: { columns?: number; className?: string }) {
    return (
        <div aria-hidden className={cn('flex items-center gap-4 border-b border-border px-4 py-4', className)}>
            {Array.from({ length: columns }).map((_, i) => (
                <SkeletonLine key={i} width={i === 0 ? 'w-1/4' : 'flex-1'} />
            ))}
        </div>
    );
}

/** A list of `rows` avatar + two-line items (bookings, chats, orders on mobile). */
export function SkeletonList({ rows = 5, className }: { rows?: number; className?: string }) {
    return (
        <div aria-hidden className={cn('divide-y divide-border', className)}>
            {Array.from({ length: rows }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 py-3.5">
                    <Skeleton className="h-11 w-11 shrink-0 rounded-full" />
                    <div className="flex-1 space-y-2">
                        <SkeletonLine width={i % 2 ? 'w-2/5' : 'w-1/2'} />
                        <SkeletonLine width="w-3/4" className="h-3" />
                    </div>
                    <Skeleton className="h-6 w-16 rounded-full" />
                </div>
            ))}
        </div>
    );
}
