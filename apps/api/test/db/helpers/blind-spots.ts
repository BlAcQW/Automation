/**
 * Static scan for the places tsc cannot protect: functions whose Prisma
 * handle is typed `any` / `unknown`, or casts of it to `any` / `never` /
 * `unknown`. A wrong column name written through one of these compiles fine
 * and fails only at runtime (the takeoverAt bug).
 *
 * Library + CLI:  npx tsx test/db/helpers/blind-spots.ts   (prints a table)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface BlindSpot { file: string; line: number; text: string; }

// Parameter / variable typed any|unknown, e.g.  prisma: any,  tx: any,  db: unknown
const TYPED_LOOSE = /\b(prisma|db|tx|client|fastify\.prisma)\??\s*:\s*(any|unknown)\b/;
// A loose alias that stands in for a Prisma handle or delegate, e.g.  type CustomerDb = any,
// type Fn = (args: any) => ...
const LOOSE_ALIAS = /\btype\s+\w+\s*=\s*(any\b|\(args:\s*any\))/;
// Cast at a call site, e.g.  prisma as any,  fastify.prisma as never
const CAST_LOOSE = /\b(prisma|db|tx|client)\s+as\s+(any|never|unknown)\b/;

const SKIP_DIRS = new Set(['node_modules', 'dist', 'test-utils']);
const SKIP_FILE = /(\.test\.ts|\.d\.ts|test-kit\.ts|\/testing\.ts)$/;

export function scanSource(rootDir: string): BlindSpot[] {
    const out: BlindSpot[] = [];
    const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) walk(full); continue; }
            if (!entry.name.endsWith('.ts') || SKIP_FILE.test(full)) continue;
            const lines = fs.readFileSync(full, 'utf8').split(/\r?\n/);
            lines.forEach((text, i) => {
                const code = text.replace(/\/\/.*$/, '');
                if (TYPED_LOOSE.test(code) || CAST_LOOSE.test(code) || LOOSE_ALIAS.test(code)) {
                    out.push({ file: path.relative(rootDir, full).split(path.sep).join('/'), line: i + 1, text: text.trim() });
                }
            });
        }
    };
    walk(rootDir);
    return out.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

export function groupByFile(spots: BlindSpot[]): Map<string, BlindSpot[]> {
    const m = new Map<string, BlindSpot[]>();
    for (const s of spots) m.set(s.file, [...(m.get(s.file) ?? []), s]);
    return m;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../src');
    const grouped = groupByFile(scanSource(src));
    for (const [file, spots] of grouped) console.log(`${file}  (${spots.length})  lines ${spots.map((s) => s.line).join(', ')}`);
    console.log(`\n${grouped.size} files, ${[...grouped.values()].reduce((t, s) => t + s.length, 0)} sites`);
}
