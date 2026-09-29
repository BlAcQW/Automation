'use client';

import { useEffect, useState } from 'react';
import { MessageCircle, Instagram, Facebook, Signal, Wifi, BatteryFull } from 'lucide-react';

/**
 * The hero proof: the assistant answering, inside a phone.
 *
 * Two things this has to do.
 *
 * It has to feel like home. The owner's customers message on WhatsApp,
 * Instagram and Messenger, so the mockup uses each app's own colour and its
 * own chat conventions rather than a generic bubble list. Tapping a channel
 * replays the conversation in that app's skin, which also demonstrates the
 * multi-channel claim far better than three logos in a row would.
 *
 * And it has to survive a bad connection. Messages render complete when JS
 * has not run; the play-through only starts once we know we can animate. The
 * previous version parked the whole thing at opacity 0 until hydration, which
 * on a cheap phone meant an empty hero.
 */

type Channel = 'whatsapp' | 'instagram' | 'messenger';

const CHANNELS: Record<Channel, { label: string; brand: string; icon: typeof MessageCircle; handle: string }> = {
    whatsapp: { label: 'WhatsApp', brand: '#25D366', icon: MessageCircle, handle: '+233 24 ••• 4567' },
    instagram: { label: 'Instagram', brand: '#E1306C', icon: Instagram, handle: '@glowhairstudio' },
    messenger: { label: 'Messenger', brand: '#0084FF', icon: Facebook, handle: 'Glow Hair Studio' },
};

type Msg = { from: 'them' | 'us'; text: string };

const SCRIPT: Msg[] = [
    { from: 'them', text: 'hi, how much for box braids?' },
    { from: 'us', text: 'Hi! Box braids are GHS 250 and take about 3 hours. Shall I check what times are free?' },
    { from: 'them', text: 'yes saturday if possible' },
    { from: 'us', text: 'Saturday I have 9:00 and 1:30 open. Which suits you?' },
    { from: 'them', text: '1:30' },
    { from: 'us', text: "Lovely. There's a GHS 50 deposit to hold it — pay now, or when you arrive?" },
];

export function PhoneChat() {
    const [channel, setChannel] = useState<Channel>('whatsapp');
    const [playing, setPlaying] = useState(false);
    const [shown, setShown] = useState(SCRIPT.length);
    const [typing, setTyping] = useState(false);

    useEffect(() => {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        setPlaying(true);
        setShown(0);
    }, []);

    // Replay from the top whenever the channel changes.
    useEffect(() => {
        if (!playing) return;
        setShown(0);
        setTyping(false);
    }, [channel, playing]);

    useEffect(() => {
        if (!playing || shown >= SCRIPT.length) return;
        const next = SCRIPT[shown];
        const wait = next.from === 'us' ? 720 : 320;

        let reveal: ReturnType<typeof setTimeout>;
        const start = setTimeout(() => {
            if (next.from === 'us') {
                setTyping(true);
                reveal = setTimeout(() => { setTyping(false); setShown((n) => n + 1); }, 540);
            } else {
                setShown((n) => n + 1);
            }
        }, wait);

        return () => { clearTimeout(start); clearTimeout(reveal); };
    }, [playing, shown]);

    const c = CHANNELS[channel];
    const Icon = c.icon;

    return (
        <div className="flex flex-col items-center gap-5">
            {/* The phone. Bezel and screen are plain CSS — no image to load. */}
            <div
                className="relative w-full max-w-[310px] rounded-[2.6rem] p-2.5 shadow-2xl"
                style={{ background: '#1c1917', border: '1px solid #44403c' }}
            >
                {/* Notch */}
                <div
                    className="absolute left-1/2 top-3 z-10 h-5 w-24 -translate-x-1/2 rounded-full"
                    style={{ background: '#1c1917' }}
                    aria-hidden="true"
                />

                <div className="overflow-hidden rounded-[2.1rem]" style={{ background: '#0b0b0c' }}>
                    {/* Status bar */}
                    <div
                        className="flex items-center justify-between px-5 pb-1.5 pt-3 text-[10px] font-medium"
                        style={{ color: '#e7e5e4' }}
                        aria-hidden="true"
                    >
                        <span>9:41</span>
                        <div className="flex items-center gap-1">
                            <Signal className="h-3 w-3" />
                            <Wifi className="h-3 w-3" />
                            <BatteryFull className="h-3.5 w-3.5" />
                        </div>
                    </div>

                    {/* Chat header, in the channel's own colour */}
                    <div
                        className="flex items-center gap-2.5 px-4 py-2.5"
                        style={{ background: c.brand }}
                    >
                        <div
                            className="flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-bold"
                            style={{ background: 'rgba(255,255,255,0.22)', color: '#fff' }}
                        >
                            GH
                        </div>
                        <div className="min-w-0 flex-1">
                            <p className="truncate text-[13px] font-semibold text-white">Glow Hair Studio</p>
                            <p className="truncate text-[10px] text-white/80">{c.handle}</p>
                        </div>
                        <Icon className="h-4 w-4 text-white/90" />
                    </div>

                    {/* Conversation */}
                    <div className="flex min-h-[312px] flex-col justify-end gap-1.5 px-3 pb-4 pt-3">
                        {SCRIPT.slice(0, shown).map((m, i) => (
                            <div key={`${channel}-${i}`} className={m.from === 'us' ? 'flex justify-end' : 'flex justify-start'}>
                                <p
                                    className={`${playing ? 'bronze-bubble ' : ''}max-w-[82%] rounded-2xl px-3 py-2 text-[12.5px] leading-snug`}
                                    style={
                                        m.from === 'us'
                                            ? { background: c.brand, color: '#fff', borderBottomRightRadius: 5 }
                                            : { background: '#26262a', color: '#f5f5f4', borderBottomLeftRadius: 5 }
                                    }
                                >
                                    {m.text}
                                </p>
                            </div>
                        ))}

                        {typing && (
                            <div className="flex justify-end" aria-hidden="true">
                                <div
                                    className="flex items-center gap-1 rounded-2xl px-3 py-2.5"
                                    style={{ background: c.brand, borderBottomRightRadius: 5 }}
                                >
                                    {[0, 1, 2].map((i) => (
                                        <span key={i} className="bronze-dot block h-1.5 w-1.5 rounded-full bg-white" />
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Channel switcher. Also the multi-channel claim, made tappable. */}
            <div className="flex items-center gap-2" role="tablist" aria-label="Preview channel">
                {(Object.keys(CHANNELS) as Channel[]).map((k) => {
                    const on = k === channel;
                    const ch = CHANNELS[k];
                    const ChIcon = ch.icon;
                    return (
                        <button
                            key={k}
                            type="button"
                            role="tab"
                            aria-selected={on}
                            onClick={() => setChannel(k)}
                            className="inline-flex min-h-[44px] items-center gap-2 rounded-full px-3.5 text-xs font-medium transition-colors"
                            style={{
                                background: on ? ch.brand : 'transparent',
                                color: on ? '#fff' : 'var(--muted-foreground)',
                                border: `1px solid ${on ? ch.brand : 'var(--border)'}`,
                            }}
                        >
                            <ChIcon className="h-3.5 w-3.5" />
                            {ch.label}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
