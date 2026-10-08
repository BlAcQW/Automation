import { useId } from 'react';

/**
 * Satin — the reference's folded-silk background (21st.dev
 * maroon-fintech-landing), in the forest palette. Pure SVG: a sun glow in
 * one corner, a blurred diagonal band with a highlight and a shadow seam,
 * and two soft edge folds. `variant` mirrors it so neighbouring cards
 * don't repeat. Motion is CSS (`.fs-satin-*`) and stops under
 * prefers-reduced-motion.
 */
export function Satin({ variant = 0 }: { variant?: number }) {
    const uid = useId().replace(/:/g, '');
    const id = `${uid}-satin${variant}`;
    const mirrored = variant % 2 === 1;
    const dark = 'var(--forest-satin-1)';
    const mid = 'var(--forest-satin-2)';
    const light = 'var(--forest-satin-3)';

    return (
        <svg className="fs-satin" viewBox="0 0 1200 700" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
            <defs>
                <radialGradient id={`${id}-sun`} cx="0.9" cy="0.08" r="0.55">
                    <stop offset="0" style={{ stopColor: light, stopOpacity: 1 }} />
                    <stop offset=".35" style={{ stopColor: mid, stopOpacity: 0.6 }} />
                    <stop offset="1" style={{ stopColor: dark, stopOpacity: 0 }} />
                </radialGradient>
                <linearGradient id={`${id}-band`} x1="0" y1="1" x2="1" y2="0">
                    <stop offset="0" style={{ stopColor: dark, stopOpacity: 0 }} />
                    <stop offset=".3" style={{ stopColor: mid, stopOpacity: 0.7 }} />
                    <stop offset=".55" style={{ stopColor: light, stopOpacity: 0.95 }} />
                    <stop offset=".75" style={{ stopColor: mid, stopOpacity: 0.6 }} />
                    <stop offset="1" style={{ stopColor: dark, stopOpacity: 0 }} />
                </linearGradient>
                <linearGradient id={`${id}-edge`} x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0" style={{ stopColor: light, stopOpacity: 0.95 }} />
                    <stop offset=".5" style={{ stopColor: mid, stopOpacity: 0.45 }} />
                    <stop offset="1" style={{ stopColor: dark, stopOpacity: 0 }} />
                </linearGradient>
                <filter id={`${id}-b1`} x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="26" /></filter>
                <filter id={`${id}-b2`} x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="9" /></filter>
                <filter id={`${id}-b3`} x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3" /></filter>
            </defs>
            <g transform={mirrored ? 'translate(1200 0) scale(-1 1)' : undefined}>
                <rect width="1200" height="700" style={{ fill: dark }} />
                <rect width="1200" height="700" fill={`url(#${id}-sun)`} />
                <g className="fs-satin-a">
                    <path
                        d="M-120 620C160 520 360 420 620 250S1020 20 1320 -60L1320 110C1040 170 820 330 600 470S160 720 -120 800Z"
                        fill={`url(#${id}-band)`}
                        filter={`url(#${id}-b1)`}
                    />
                    <path d="M-60 700C240 560 470 430 700 270S1080 60 1300 0" fill="none" style={{ stroke: light }} strokeOpacity=".6" strokeWidth="7" filter={`url(#${id}-b3)`} />
                    <path d="M-80 760C230 620 470 500 720 340S1080 130 1310 70" fill="none" stroke="#000" strokeOpacity=".5" strokeWidth="36" filter={`url(#${id}-b2)`} />
                </g>
                <g className="fs-satin-b">
                    <path d="M-60 120C40 220 90 380 60 560S20 700 40 760L-60 760Z" fill={`url(#${id}-edge)`} filter={`url(#${id}-b1)`} />
                    <path d="M-20 160C60 260 90 420 64 600" fill="none" style={{ stroke: light }} strokeOpacity=".6" strokeWidth="5" filter={`url(#${id}-b3)`} />
                </g>
                <g className="fs-satin-c">
                    <path d="M1240 300C1150 400 1090 520 1080 720L1240 720Z" style={{ fill: light }} fillOpacity=".5" filter={`url(#${id}-b1)`} />
                    <path d="M1210 340C1140 430 1100 540 1094 720" fill="none" style={{ stroke: light }} strokeOpacity=".45" strokeWidth="4" filter={`url(#${id}-b3)`} />
                </g>
                <rect width="1200" height="700" fill="#000" fillOpacity=".14" />
            </g>
        </svg>
    );
}
