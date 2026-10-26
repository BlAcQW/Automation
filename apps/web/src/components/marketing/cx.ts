import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * `cn` that knows the brand type scale. The shared `cn` (packages/ui/src/cn.ts)
 * uses plain twMerge, which reads `text-hero`, `text-page-title`, `text-body`
 * … as COLOURS and silently drops them when a colour like `text-text` follows.
 * Candidate fix for packages/ui: use this config in the shared `cn`.
 */
const merge = extendTailwindMerge({
    extend: {
        classGroups: {
            'font-size': [{ text: ['hero', 'page-title', 'section-heading', 'body', 'small'] }],
        },
    },
});

export function cx(...inputs: ClassValue[]): string {
    return merge(clsx(inputs));
}
