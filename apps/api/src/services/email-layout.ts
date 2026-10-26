/**
 * Bookly email layout — one branded shell for every email we send
 * (verification, password reset, invites, booking/order notifications).
 *
 * Built for the clients people actually use in Ghana (Gmail app/web, Outlook,
 * Apple Mail, Yahoo): table layout, inline styles only, no images, no web
 * fonts relied upon, a bulletproof button (VML for Outlook desktop) and a
 * plain-text twin for every message.
 *
 * Brand: cream page, white card (24px radius), gold scalloped awning across
 * the top of the card, green primary button, "Bookly" wordmark as styled text,
 * tagline "Your shop, always open." in the footer. All text pairs meet WCAG AA.
 */

export const EMAIL_COLORS = {
    cream: '#FAF6EE',
    white: '#FFFFFF',
    green: '#0F6B4F',
    greenDark: '#0B5540',
    gold: '#E8A317',
    goldLight: '#F2C35B',
    charcoal: '#1F2328',
    /** 5.9:1 on white, 5.4:1 on cream. Lightest colour allowed for reading text. */
    muted: '#5F6672',
    border: '#E7E1D6',
    soft: '#F4EFE5',
} as const;

/** Bricolage first for clients that have it; web-safe fallbacks for the rest. */
export const EMAIL_FONT_STACK =
    "'Bricolage Grotesque', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export const BOOKLY_TAGLINE = 'Your shop, always open.';

/** Plain-text sign-off appended to every text body. */
export const TEXT_FOOTER = `--\nBookly · ${BOOKLY_TAGLINE}`;

export function escapeHtml(input: string): string {
    return input.replace(
        /[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
    );
}

const C = EMAIL_COLORS;
// Single-quoted family names are safe inside double-quoted style="" attributes.
const FONT = EMAIL_FONT_STACK;

/**
 * Bulletproof green button: a padded table cell (works everywhere, whole area
 * clickable) wrapped in VML for Outlook desktop. Min 48px tall.
 */
export function emailButton(label: string, url: string): string {
    const href = escapeHtml(url);
    const text = escapeHtml(label);
    return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:8px 0 20px">
  <tr>
    <td align="center" bgcolor="${C.green}" style="border-radius:12px;background:${C.green}">
      <!--[if mso]>
      <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:48px;v-text-anchor:middle;width:260px" arcsize="25%" stroke="f" fillcolor="${C.green}">
        <w:anchorlock/>
        <center style="color:#FFFFFF;font-family:Segoe UI,Arial,sans-serif;font-size:16px;font-weight:bold">${text}</center>
      </v:roundrect>
      <![endif]-->
      <!--[if !mso]><!-- -->
      <a href="${href}" target="_blank" style="display:inline-block;min-height:48px;box-sizing:border-box;padding:14px 28px;border-radius:12px;background:${C.green};color:#FFFFFF;font-family:${FONT};font-size:16px;font-weight:700;line-height:20px;text-decoration:none;mso-hide:all">${text}</a>
      <!--<![endif]-->
    </td>
  </tr>
</table>`;
}

/** Inline green text link. */
export function emailLink(label: string, url: string): string {
    return `<a href="${escapeHtml(url)}" target="_blank" style="color:${C.green};font-weight:600;text-decoration:underline;word-break:break-all">${escapeHtml(label)}</a>`;
}

/** Paragraph in the card body. `html` must already be escaped. */
export function emailParagraph(html: string, opts: { small?: boolean; muted?: boolean } = {}): string {
    const size = opts.small ? '14px' : '16px';
    const lh = opts.small ? '21px' : '24px';
    const color = opts.muted ? C.muted : C.charcoal;
    return `<p style="margin:0 0 16px;font-family:${FONT};font-size:${size};line-height:${lh};color:${color}">${html}</p>`;
}

/**
 * A "receipt" block: label/value rows on a soft cream panel. Values are
 * escaped here. Use for booking/order facts (service, date, time, ref, total).
 */
export function emailDetails(rows: Array<[label: string, value: string]>): string {
    const body = rows
        .map(
            ([label, value], i) => `<tr>
      <td style="padding:${i === 0 ? '14px' : '8px'} 16px ${i === rows.length - 1 ? '14px' : '8px'};font-family:${FONT};font-size:14px;line-height:20px;color:${C.muted};white-space:nowrap;vertical-align:top">${escapeHtml(label)}</td>
      <td align="right" style="padding:${i === 0 ? '14px' : '8px'} 16px ${i === rows.length - 1 ? '14px' : '8px'};font-family:${FONT};font-size:15px;line-height:20px;color:${C.charcoal};font-weight:700;text-align:right;word-break:break-word">${escapeHtml(value)}</td>
    </tr>`,
        )
        .join('\n');
    return `<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="margin:4px 0 20px;background:${C.soft};border:1px solid ${C.border};border-radius:16px;border-collapse:separate">
    ${body}
  </table>`;
}

/**
 * The awning: alternating gold stripes with scalloped (rounded) bottoms.
 * Pure table cells + border-radius; clients that ignore border-radius
 * (Outlook desktop) show straight stripes, which still reads as the awning.
 */
function awning(): string {
    const STRIPES = 12;
    const width = `${(100 / STRIPES).toFixed(4)}%`;
    const cells = (h: number, scallop: boolean) =>
        Array.from({ length: STRIPES }, (_, i) => {
            const col = i % 2 === 0 ? C.gold : C.goldLight;
            if (!scallop) {
                return `<td width="${width}" height="${h}" bgcolor="${col}" style="height:${h}px;line-height:${h}px;font-size:0;background:${col}">&nbsp;</td>`;
            }
            return `<td width="${width}" height="${h}" style="height:${h}px;line-height:${h}px;font-size:0;padding:0"><div style="height:${h}px;line-height:${h}px;font-size:0;background:${col};border-radius:0 0 ${h}px ${h}px">&nbsp;</div></td>`;
        }).join('');
    return `<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="border-collapse:collapse;table-layout:fixed">
      <tr>${cells(10, false)}</tr>
      <tr>${cells(10, true)}</tr>
    </table>`;
}

export interface EmailLayoutArgs {
    /** <title> and the hidden inbox preview line. Plain text. */
    title: string;
    preheader: string;
    /** Big friendly heading in the card. Plain text. */
    heading: string;
    /** Card body HTML (use the helpers above; escape all variables). */
    bodyHtml: string;
    /** Why the reader got this email, shown small in the footer. Plain text. */
    footerNote?: string;
}

/** Wrap a message in the full Bookly email document. */
export function renderEmailLayout(args: EmailLayoutArgs): string {
    const title = escapeHtml(args.title);
    const pre = escapeHtml(args.preheader);
    const heading = escapeHtml(args.heading);
    const note = args.footerNote
        ? `<p style="margin:0 0 8px;font-family:${FONT};font-size:13px;line-height:19px;color:${C.muted}">${escapeHtml(args.footerNote)}</p>`
        : '';
    return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>${title}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>
  body { margin:0; padding:0; width:100% !important; background:${C.cream}; }
  a { color:${C.green}; }
  @media (max-width: 480px) {
    .bk-pad { padding-left:20px !important; padding-right:20px !important; }
    .bk-outer { padding-left:12px !important; padding-right:12px !important; }
    .bk-h1 { font-size:24px !important; line-height:30px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${C.cream}" bgcolor="${C.cream}">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${C.cream};opacity:0">${pre}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="${C.cream}" style="background:${C.cream}">
  <tr>
    <td align="center" class="bk-outer" style="padding:32px 16px">
      <!--[if mso]><table role="presentation" width="560" border="0" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
      <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="max-width:560px">
        <tr>
          <td align="left" style="padding:0 8px 16px">
            <span style="font-family:${FONT};font-size:26px;line-height:30px;font-weight:800;letter-spacing:-0.5px;color:${C.green}">Bookly</span>
          </td>
        </tr>
        <tr>
          <td bgcolor="${C.white}" style="background:${C.white};border:1px solid ${C.border};border-radius:24px;overflow:hidden">
            ${awning()}
            <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0">
              <tr>
                <td class="bk-pad" style="padding:24px 32px 16px">
                  <h1 class="bk-h1" style="margin:0 0 16px;font-family:${FONT};font-size:28px;line-height:34px;font-weight:800;letter-spacing:-0.5px;color:${C.charcoal}">${heading}</h1>
                  ${args.bodyHtml}
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:24px 16px 8px">
            ${note}
            <p style="margin:0;font-family:${FONT};font-size:14px;line-height:20px;color:${C.charcoal}"><span style="font-weight:800;color:${C.green}">Bookly</span> &middot; ${escapeHtml(BOOKLY_TAGLINE)}</p>
          </td>
        </tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td>
  </tr>
</table>
</body>
</html>`;
}

/** Join plain-text body lines and add the Bookly sign-off. */
export function renderEmailText(lines: string[]): string {
    return [...lines, '', TEXT_FOOTER].join('\n');
}
