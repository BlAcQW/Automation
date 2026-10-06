import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { groupByFile, scanSource } from './helpers/blind-spots.js';

const API_DIR = path.resolve(__dirname, '../..');

describe('blind-spot scan (prisma typed any/unknown)', () => {
    it('finds typed parameters, casts and loose aliases, and ignores comments and tests', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blind-'));
        fs.writeFileSync(path.join(dir, 'a.ts'), [
            'export async function f(prisma: any) {}',
            'export async function g(tx: unknown, other: string) {}',
            'const x = fastify.prisma as any;',
            'type Db = any;',
            'type Fn = (args: any) => Promise<any>;',
            '// prisma: any in a comment',
            'export async function ok(prisma: ExtendedPrismaClient) {}',
        ].join('\n'));
        fs.writeFileSync(path.join(dir, 'a.test.ts'), 'function t(prisma: any) {}');
        const spots = scanSource(dir);
        expect(spots.map((s) => s.line)).toEqual([1, 2, 3, 4, 5]);
        expect(new Set(spots.map((s) => s.file))).toEqual(new Set(['a.ts']));
    });

    it('every source file with such a call site is acknowledged in docs/TESTING.md (add new ones there, with how they are covered)', () => {
        const docs = fs.readFileSync(path.resolve(API_DIR, '../../docs/TESTING.md'), 'utf8');
        const files = [...groupByFile(scanSource(path.join(API_DIR, 'src'))).keys()];
        expect(files.length).toBeGreaterThan(0);
        const missing = files.filter((f) => !docs.includes(`\`${f}\``));
        expect(missing, 'files with a loosely typed prisma that docs/TESTING.md does not list').toEqual([]);
    });
});
