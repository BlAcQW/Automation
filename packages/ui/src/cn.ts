import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * Plain twMerge reads the brand type scale (`text-hero`, `text-body`, …) as
 * colours and drops it when a colour class like `text-text` follows.
 */
const merge = extendTailwindMerge({
    extend: {
        classGroups: {
            'font-size': [{ text: ['hero', 'page-title', 'section-heading', 'body', 'small'] }],
        },
    },
});

export function cn(...inputs: ClassValue[]) {
    return merge(clsx(inputs));
}
