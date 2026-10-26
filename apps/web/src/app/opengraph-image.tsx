import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { SITE_TAGLINE } from '@/lib/site';

export const alt = `Bookly. ${SITE_TAGLINE}`;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/**
 * The share card for WhatsApp, X, LinkedIn: the text wordmark and the
 * tagline only (logo work is on hold), in the brand colours, under the
 * scalloped awning. Rendered at build
 * time. The font is Clash Display 600 as .woff (Satori can't read woff2),
 * kept beside this file in `_og/` (Fontshare ITF Free Font License; see
 * public/fonts/LICENSES.md).
 */
export default async function OpenGraphImage() {
    const clash = await readFile(join(process.cwd(), 'src/app/_og/clash-display-600.woff'));
    const stripe = 60;
    const stripes = Array.from({ length: Math.ceil(size.width / stripe) });

    return new ImageResponse(
        (
            <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#FAF6EE', fontFamily: 'Clash Display' }}>
                {/* Awning: alternating gold stripes with a scalloped edge. */}
                <div style={{ display: 'flex', width: '100%', height: 70 }}>
                    {stripes.map((_, i) => (
                        <div
                            key={i}
                            style={{
                                width: stripe,
                                height: 70,
                                background: i % 2 ? '#0F6B4F' : '#E8A317',
                                borderBottomLeftRadius: stripe / 2,
                                borderBottomRightRadius: stripe / 2,
                            }}
                        />
                    ))}
                </div>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 88px' }}>
                    <div style={{ fontSize: 76, fontWeight: 600, color: '#0F6B4F', letterSpacing: -1 }}>Bookly</div>
                    <div style={{ marginTop: 18, fontSize: 104, fontWeight: 600, lineHeight: 1.02, color: '#1F2328', letterSpacing: -2 }}>
                        {SITE_TAGLINE}
                    </div>
                </div>
            </div>
        ),
        { ...size, fonts: [{ name: 'Clash Display', data: clash, weight: 600, style: 'normal' }] },
    );
}
