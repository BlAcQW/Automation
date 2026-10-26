import type { MetadataRoute } from 'next';
import { PUBLIC_PAGES, absoluteUrl } from '@/lib/site';

/** Every public page, with the date its content last changed (lib/site.ts). */
export default function sitemap(): MetadataRoute.Sitemap {
    return PUBLIC_PAGES.map((p) => ({
        url: absoluteUrl(p.path),
        lastModified: new Date(`${p.updated}T00:00:00Z`),
        changeFrequency: p.changeFrequency,
        priority: p.priority,
    }));
}
