import { describe, it, expect } from 'vitest';
import { csvCell, toCsv } from './csv.js';

describe('csvCell: safe against spreadsheet formula injection', () => {
    it('prefixes a quote to cells starting with = + - @ (and tab / carriage return)', () => {
        expect(csvCell('=HYPERLINK("http://evil","x")')).toBe(`"'=HYPERLINK(""http://evil"",""x"")"`);
        expect(csvCell('+233244123456')).toBe("'+233244123456");
        expect(csvCell('-2+3')).toBe("'-2+3");
        expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
        expect(csvCell('\t=1')).toBe("'\t=1");
        expect(csvCell('\r=1')).toBe(`"'\r=1"`);
    });

    it('leaves ordinary text alone and quotes commas, quotes and new lines', () => {
        expect(csvCell('Glow Skin Clinic')).toBe('Glow Skin Clinic');
        expect(csvCell('East Legon, Accra')).toBe('"East Legon, Accra"');
        expect(csvCell('She said "hi"')).toBe('"She said ""hi"""');
        expect(csvCell('line 1\nline 2')).toBe('"line 1\nline 2"');
        expect(csvCell('a=b')).toBe('a=b');
    });

    it('writes null / undefined as empty and dates as ISO', () => {
        expect(csvCell(null)).toBe('');
        expect(csvCell(undefined)).toBe('');
        expect(csvCell(new Date('2026-10-29T10:00:00Z'))).toBe('2026-10-29T10:00:00.000Z');
        expect(csvCell(42)).toBe('42');
    });
});

describe('toCsv', () => {
    it('UTF-8 with a BOM (so Excel reads ₵ and accents), CRLF rows, header first', () => {
        const csv = toCsv(['name', 'city'], [['Ama', 'Kumasi'], ['Kofi', 'Tamale, North']]);
        expect(csv.startsWith('\uFEFF')).toBe(true);
        expect(csv).toBe('\uFEFFname,city\r\nAma,Kumasi\r\nKofi,"Tamale, North"\r\n');
    });

    it('keeps non-ASCII text intact', () => {
        expect(toCsv(['note'], [['GH₵ 200 · Adwoa Asantewaa']])).toContain('GH₵ 200 · Adwoa Asantewaa');
    });
});
