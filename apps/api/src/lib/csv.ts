/**
 * CSV for spreadsheets people actually open (Excel, Google Sheets, Numbers).
 *
 * Formula injection: a cell that starts with = + - @ (or a tab / carriage
 * return, which some spreadsheets skip before looking) is run as a formula
 * when the file is opened, so a waitlist "name" of =HYPERLINK(...) would be a
 * live link in the owner's sheet. Such cells get a leading apostrophe, which
 * every spreadsheet shows as plain text (OWASP's recommendation). That
 * includes E.164 phone numbers (+233...): they read as text, not a number.
 */

export type CsvValue = string | number | boolean | Date | null | undefined;

const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;

export function csvCell(value: CsvValue): string {
    if (value === null || value === undefined) return '';
    const text = value instanceof Date ? value.toISOString() : String(value);
    const safe = typeof value === 'string' && FORMULA_START.test(text) ? `'${text}` : text;
    return NEEDS_QUOTES.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** UTF-8 byte-order mark: without it Excel reads the file as Windows-1252 and mangles ₵ and accents. */
export const UTF8_BOM = '\uFEFF';

/** Header + rows, CRLF line endings, with a BOM. */
export function toCsv(header: readonly string[], rows: ReadonlyArray<readonly CsvValue[]>): string {
    const lines = [header, ...rows].map((row) => row.map(csvCell).join(','));
    return `${UTF8_BOM}${lines.join('\r\n')}\r\n`;
}
