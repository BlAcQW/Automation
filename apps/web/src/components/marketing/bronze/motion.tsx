'use client';

import { useEffect, useRef, useState } from 'react';
import { MessageCircle } from 'lucide-react';

/**
 * Motion for the landing page.
 *
 * WHY THIS IS CSS AND NOT FRAMER
 * ------------------------------
 * The first version used framer with `initial={{ opacity: 0 }}`. That renders
 * the markup at opacity 0 on the server, so the content only becomes visible
 * once JS has loaded, hydrated and started animating. A headless render of it
 * showed the whole hero chat sitting at `opacity:0` — which is exactly what a
 * cheap phone on a bad connection would show.
 *
 * So the resting state here is VISIBLE, and motion is layered on top:
 *
 *   - Reveals arm themselves only after mount, in JS. Without JS the element
 *     never gets `is-armed`, so it simply stays visible.
 *   - Animations are CSS keyframes, which run without React and finish even
 *     if the main thread is busy.
 *   - `prefers-reduced-motion` is handled in CSS, so it cannot be missed by
 *     a component that forgets to check.
 *
 * Worst case is a static page. Never an empty one.
 */

/**
 * Reveal a group of children as it scrolls in.
 *
 * Children animate in document order; the stagger is CSS `nth-child` delays,
 * so no per-item wrapper is needed.
 */
export function Reveal({
    children,
    className = '',
    style,
}: {
    children: React.ReactNode;
    className?: string;
    style?: React.CSSProperties;
}) {
    const ref = useRef<HTMLDivElement>(null);
    const [state, setState] = useState<'idle' | 'armed' | 'in'>('idle');

    useEffect(() => {
        const el = ref.current;
        if (!el) return;

        // Anything already on screen at mount is left alone — animating it
        // would mean hiding something the reader can already see.
        const rect = el.getBoundingClientRect();
        if (rect.top < window.innerHeight * 0.9) return;

        setState('armed');
        const io = new IntersectionObserver(
            (entries) => {
                if (entries.some((e) => e.isIntersecting)) {
                    setState('in');
                    io.disconnect();
                }
            },
            { rootMargin: '-60px' },
        );
        io.observe(el);
        return () => io.disconnect();
    }, []);

    const cls = ['bronze-reveal', state === 'armed' && 'is-armed', state === 'in' && 'is-in', className]
        .filter(Boolean)
        .join(' ');

    return (
        <div ref={ref} className={cls} style={style}>
            {children}
        </div>
    );
}

/** A single revealed child. Plain wrapper — the stagger lives in CSS. */
export function RevealItem({
    children,
    className,
    style,
}: {
    children: React.ReactNode;
    className?: string;
    style?: React.CSSProperties;
}) {
    return <div className={className} style={style}>{children}</div>;
}

/** Hero entrance. Already on screen, so it plays on load rather than on scroll. */
export function HeroReveal({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
    return (
        <div className="bronze-enter" style={delay ? { animationDelay: `${delay}s` } : undefined}>
            {children}
        </div>
    );
}

/** A card that lifts under the cursor. Pure CSS. */
export function LiftCard({
    children,
    className = '',
    style,
}: {
    children: React.ReactNode;
    className?: string;
    style?: React.CSSProperties;
}) {
    return <div className={`bronze-lift ${className}`} style={style}>{children}</div>;
}

/* ------------------------------------------------------------------ */

type Msg = { from: 'them' | 'us'; text: string };

const SCRIPT: Msg[] = [
    { from: 'them', text: 'hi, how much for box braids?' },
    { from: 'us', text: 'Hi! Box braids are GHS 250 and take about 3 hours. Would you like me to check what times are free?' },
    { from: 'them', text: 'yes saturday if possible' },
    { from: 'us', text: 'Saturday I have 9:00 and 1:30 open. Which suits you?' },
    { from: 'them', text: '1:30' },
    { from: 'us', text: "Lovely. There's a GHS 50 deposit to hold it — would you like to pay now, or when you arrive?" },
];

/**
 * The hero's proof: a customer being booked, playing out.
 *
 * The one place motion does real work rather than decorating — the product's
 * whole claim is what happens in a chat while the owner is busy, and a still
 * cannot show a reply arriving. The pause before each reply is the point: it
 * is what makes it read as someone answering.
 *
 * Renders the full conversation when JS has not run, so the proof is there
 * either way.
 */
export function AnimatedChat() {
    const [playing, setPlaying] = useState(false);
    const [shown, setShown] = useState(SCRIPT.length);
    const [typing, setTyping] = useState(false);

    // Only rewind to the start once we know we can actually play it.
    useEffect(() => {
        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (reduce) return;
        setPlaying(true);
        setShown(0);
    }, []);

    useEffect(() => {
        if (!playing || shown >= SCRIPT.length) return;
        const next = SCRIPT[shown];
        const wait = next.from === 'us' ? 750 : 320;

        let reveal: ReturnType<typeof setTimeout>;
        const start = setTimeout(() => {
            if (next.from === 'us') {
                setTyping(true);
                reveal = setTimeout(() => {
                    setTyping(false);
                    setShown((n) => n + 1);
                }, 550);
            } else {
                setShown((n) => n + 1);
            }
        }, wait);

        return () => {
            clearTimeout(start);
            clearTimeout(reveal);
        };
    }, [playing, shown]);

    return (
        <div
            className="rounded-2xl p-5 shadow-sm sm:p-6"
            style={{ background: 'var(--secondary)', border: '1px solid var(--border)' }}
        >
            <div className="mb-4 flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-full" style={{ background: 'var(--primary)' }}>
                    <MessageCircle className="h-4 w-4" style={{ color: 'var(--primary-foreground)' }} />
                </div>
                <div>
                    <p className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>Glow Hair Studio</p>
                    <p className="text-[11px]" style={{ color: 'var(--muted-foreground)' }}>replies instantly</p>
                </div>
            </div>

            {/* Reserved height so the hero does not jump as messages land. */}
            <div className="flex min-h-[330px] flex-col justify-end gap-2.5">
                {SCRIPT.slice(0, shown).map((m, i) => (
                    <div key={i} className={m.from === 'us' ? 'flex justify-end' : 'flex justify-start'}>
                        <p
                            className={playing ? 'bronze-bubble max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[14px] leading-snug' : 'max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[14px] leading-snug'}
                            style={
                                m.from === 'us'
                                    ? { background: 'var(--primary)', color: 'var(--primary-foreground)', borderBottomRightRadius: 6 }
                                    : { background: 'var(--background)', color: 'var(--foreground)', borderBottomLeftRadius: 6 }
                            }
                        >
                            {m.text}
                        </p>
                    </div>
                ))}

                {typing && (
                    <div className="flex justify-end" aria-hidden="true">
                        <div
                            className="flex items-center gap-1 rounded-2xl px-3.5 py-3"
                            style={{ background: 'var(--primary)', borderBottomRightRadius: 6 }}
                        >
                            {[0, 1, 2].map((i) => (
                                <span
                                    key={i}
                                    className="bronze-dot block h-1.5 w-1.5 rounded-full"
                                    style={{ background: 'var(--primary-foreground)' }}
                                />
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
