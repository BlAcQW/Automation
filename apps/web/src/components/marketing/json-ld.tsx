/**
 * Inline JSON-LD, the pattern from the Next.js docs. The data is built on
 * the server from our own constants (lib/seo.ts), never from user input, and
 * every `<` is escaped so the payload can never close the <script> tag.
 * (React text children can't be used: React HTML-escapes the quotes.)
 */
export function JsonLd({ data }: { data: Record<string, unknown> | Record<string, unknown>[] }) {
    const json = JSON.stringify(data).replace(/</g, '\\u003c');
    return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
