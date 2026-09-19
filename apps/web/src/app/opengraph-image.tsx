import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'Bookly: your bookings, taken on WhatsApp';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/**
 * The preview card when the link is shared on WhatsApp, X, LinkedIn. Rendered
 * at build time; no image asset to keep in sync with the copy.
 */
export default function OpenGraphImage() {
    return new ImageResponse(
        (
            <div
                style={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    padding: 72,
                    background: 'linear-gradient(135deg, #0A0F0D 0%, #0F1614 60%, #0B2E22 100%)',
                    color: '#F2F6F4',
                    fontFamily: 'sans-serif',
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <div style={{ width: 22, height: 22, borderRadius: 999, background: '#10B981' }} />
                    <div style={{ fontSize: 40, fontWeight: 700, letterSpacing: -1 }}>Bookly</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                    <div style={{ fontSize: 74, fontWeight: 700, lineHeight: 1.05, letterSpacing: -2, maxWidth: 980 }}>
                        Your bookings, taken on WhatsApp.
                    </div>
                    <div style={{ fontSize: 32, color: '#B6C2BD', maxWidth: 900, lineHeight: 1.35 }}>
                        An assistant that answers, books, collects the deposit and sends the reminder. You just show up.
                    </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 26, color: '#8A9994' }}>
                    <div style={{ padding: '10px 18px', borderRadius: 12, background: '#10B981', color: '#050807', fontWeight: 600 }}>
                        Start free
                    </div>
                    <div>bookly.ikieguy.online</div>
                </div>
            </div>
        ),
        { ...size },
    );
}
