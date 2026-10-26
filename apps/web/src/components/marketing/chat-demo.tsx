'use client';

import { useEffect, useState } from 'react';
import { BatteryFull, CheckCircle2, Facebook, Instagram, MessageCircle, Signal, Wifi } from 'lucide-react';
import { cx as cn } from './cx';
import styles from './marketing.module.css';

/**
 * The hero proof: a customer messaging an example clinic on WhatsApp,
 * Instagram and Messenger, and Bookly answering and booking them in.
 *
 * Seen from the customer's phone, in each app's own colours, so an owner
 * recognises it at a glance. The three channels play one after another;
 * tapping a channel jumps to it and stops the rotation.
 *
 * Without JS (or with reduced motion) the WhatsApp conversation renders
 * complete. Nothing here ever rests at opacity 0.
 */

type Channel = 'whatsapp' | 'instagram' | 'messenger';
type Msg = { from: 'customer' | 'bookly'; text: string };

interface ChannelSkin {
    label: string;
    icon: typeof MessageCircle;
    handle: string;
    header: string;
    headerText: string;
    screen: string;
    mine: { background: string; color: string };
    theirs: { background: string; color: string };
}

const BUSINESS = 'Maison Skin Clinic';

const SKINS: Record<Channel, ChannelSkin> = {
    whatsapp: {
        label: 'WhatsApp',
        icon: MessageCircle,
        handle: 'Business account',
        header: '#075E54',
        headerText: '#FFFFFF',
        screen: '#EFEAE2',
        mine: { background: '#D9FDD3', color: '#111B21' },
        theirs: { background: '#FFFFFF', color: '#111B21' },
    },
    instagram: {
        label: 'Instagram',
        icon: Instagram,
        handle: '@maisonskin.accra',
        header: '#FFFFFF',
        headerText: '#111111',
        screen: '#FFFFFF',
        mine: { background: 'linear-gradient(135deg, #7A2FD0, #4F46E5)', color: '#FFFFFF' },
        theirs: { background: '#EFEFEF', color: '#111111' },
    },
    messenger: {
        label: 'Messenger',
        icon: Facebook,
        handle: 'Typically replies instantly',
        header: '#FFFFFF',
        headerText: '#050505',
        screen: '#FFFFFF',
        mine: { background: '#0866FF', color: '#FFFFFF' },
        theirs: { background: '#F0F0F0', color: '#050505' },
    },
};

const SCRIPTS: Record<Channel, { messages: Msg[]; booked: string }> = {
    whatsapp: {
        messages: [
            { from: 'customer', text: 'Hi, can I get a HydraFacial this week?' },
            { from: 'bookly', text: 'Hi Efua! Yes. A HydraFacial is GH₵ 850 and takes an hour. Thursday has 11:00 am and 4:30 pm free.' },
            { from: 'customer', text: '4:30 please' },
            { from: 'bookly', text: "Lovely. A GH₵ 200 deposit holds it. I've sent the Mobile Money prompt to this number." },
            { from: 'customer', text: 'Paid ✅' },
            { from: 'bookly', text: "Thank you! You're booked for Thursday at 4:30 pm. I'll remind you the day before." },
        ],
        booked: 'Thu 4:30 pm · HydraFacial · GH₵ 200 deposit paid',
    },
    instagram: {
        messages: [
            { from: 'customer', text: 'saw your glow peel post 😍 how much?' },
            { from: 'bookly', text: 'Thank you! The glow peel is GH₵ 1,200, with a short skin check first. Shall I find you a time?' },
            { from: 'customer', text: 'saturday morning?' },
            { from: 'bookly', text: 'Saturday I have 9:30 am or 11:00 am.' },
            { from: 'customer', text: '9:30' },
            { from: 'bookly', text: "Done ✨ Saturday 9:30 am is yours once the GH₵ 300 deposit is in. Here's your payment link." },
        ],
        booked: 'Sat 9:30 am · Glow peel · GH₵ 300 deposit paid',
    },
    messenger: {
        messages: [
            { from: 'customer', text: "Hello, I'd like a consultation for laser hair removal." },
            { from: 'bookly', text: 'Hello Kofi! A consultation is GH₵ 400, taken off your first session. Monday 2:00 pm or Tuesday 10:00 am?' },
            { from: 'customer', text: 'Tuesday works' },
            { from: 'bookly', text: 'Tuesday 10:00 am it is. Pay the GH₵ 100 deposit by MoMo or card to hold it.' },
            { from: 'customer', text: 'Sent' },
            { from: 'bookly', text: 'Got it, thank you Kofi. See you Tuesday at 10.' },
        ],
        booked: 'Tue 10:00 am · Laser consultation · GH₵ 100 deposit paid',
    },
};

const ORDER: Channel[] = ['whatsapp', 'instagram', 'messenger'];
const CUSTOMER_PAUSE_MS = 900;
const BOOKLY_PAUSE_MS = 500;
const TYPING_MS = 1100;
const HOLD_AFTER_BOOKED_MS = 3200;

export function ChatDemo({ className }: { className?: string }) {
    const [channel, setChannel] = useState<Channel>('whatsapp');
    const [playing, setPlaying] = useState(false);
    const [auto, setAuto] = useState(true);
    // Everything is shown until we know we can animate (SSR / no JS / reduced motion).
    const [shown, setShown] = useState(SCRIPTS.whatsapp.messages.length + 1);
    const [typing, setTyping] = useState(false);

    useEffect(() => {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        setPlaying(true);
        setShown(0);
    }, []);

    const script = SCRIPTS[channel];
    const total = script.messages.length + 1; // + the "booked" card

    useEffect(() => {
        if (!playing) return;
        const timers: ReturnType<typeof setTimeout>[] = [];

        if (shown >= total) {
            if (auto) {
                timers.push(setTimeout(() => {
                    setChannel((c) => ORDER[(ORDER.indexOf(c) + 1) % ORDER.length]);
                    setShown(0);
                }, HOLD_AFTER_BOOKED_MS));
            }
            return () => timers.forEach(clearTimeout);
        }

        const next = script.messages[shown];
        if (next && next.from === 'bookly') {
            timers.push(setTimeout(() => setTyping(true), BOOKLY_PAUSE_MS));
            timers.push(setTimeout(() => { setTyping(false); setShown((n) => n + 1); }, BOOKLY_PAUSE_MS + TYPING_MS));
        } else {
            timers.push(setTimeout(() => setShown((n) => n + 1), CUSTOMER_PAUSE_MS));
        }
        return () => timers.forEach(clearTimeout);
    }, [playing, shown, total, auto, script]);

    function pick(next: Channel) {
        setAuto(false);
        setTyping(false);
        setChannel(next);
        setShown(playing ? 0 : SCRIPTS[next].messages.length + 1);
    }

    const skin = SKINS[channel];
    const Icon = skin.icon;
    const visible = script.messages.slice(0, shown);
    const isBooked = shown >= total;

    return (
        <figure className={cn('flex flex-col items-center gap-4', className)}>
            <div
                className="relative w-full max-w-[300px] rounded-[2.6rem] bg-[#1F2328] p-2.5 shadow-card-lg ring-1 ring-black/20"
                role="img"
                aria-label={`Example ${skin.label} chat: a customer books an appointment at ${BUSINESS} and Bookly takes the deposit.`}
            >
                <div className="absolute left-1/2 top-3 z-10 h-5 w-24 -translate-x-1/2 rounded-full bg-[#1F2328]" aria-hidden />
                <div className="overflow-hidden rounded-[2.1rem]" style={{ background: skin.screen }} aria-hidden>
                    <div className="flex items-center justify-between bg-white px-5 pb-1 pt-3 text-[10px] font-semibold text-[#1F2328]">
                        <span>9:41</span>
                        <span className="flex items-center gap-1">
                            <Signal className="h-3 w-3" />
                            <Wifi className="h-3 w-3" />
                            <BatteryFull className="h-3.5 w-3.5" />
                        </span>
                    </div>

                    <div
                        className="flex items-center gap-2.5 border-b border-black/5 px-4 py-2.5"
                        style={{ background: skin.header, color: skin.headerText }}
                    >
                        <span
                            className={cn(
                                'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold',
                                channel === 'instagram' ? 'bg-gradient-to-tr from-[#F58529] via-[#DD2A7B] to-[#8134AF] text-white' : 'bg-[#0F6B4F] text-white',
                            )}
                        >
                            MS
                        </span>
                        <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-semibold">{BUSINESS}</span>
                            <span className="block truncate text-[10px] opacity-75">{skin.handle}</span>
                        </span>
                        <Icon className="h-4 w-4 opacity-80" />
                    </div>

                    <div className="flex h-[300px] flex-col justify-end gap-1.5 overflow-hidden px-3 pb-4 pt-3 sm:h-[360px]">
                        {visible.map((m, i) => {
                            const mine = m.from === 'customer';
                            return (
                                <div key={`${channel}-${i}`} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
                                    <p
                                        className={cn('max-w-[84%] rounded-[16px] px-3 py-2 text-[12.5px] leading-snug shadow-[0_1px_0_rgba(0,0,0,0.06)]', playing && styles.bubble)}
                                        style={{
                                            ...(mine ? skin.mine : skin.theirs),
                                            ...(mine ? { borderBottomRightRadius: 5 } : { borderBottomLeftRadius: 5 }),
                                        }}
                                    >
                                        {m.text}
                                    </p>
                                </div>
                            );
                        })}

                        {typing && (
                            <div className="flex justify-start">
                                <span className="flex items-center gap-1 rounded-[16px] px-3 py-2.5" style={{ ...skin.theirs, borderBottomLeftRadius: 5 }}>
                                    {[0, 1, 2].map((d) => (
                                        <span key={d} className={cn('block h-1.5 w-1.5 rounded-full bg-current opacity-50', styles.typingDot)} style={{ animationDelay: `${d * 140}ms` }} />
                                    ))}
                                </span>
                            </div>
                        )}

                        {isBooked && (
                            <div className={cn('mt-1 flex items-start gap-2 rounded-[14px] border border-[#0F6B4F]/20 bg-[#E6F2EC] px-3 py-2 text-[#0B5540]', playing && styles.bubble)}>
                                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                                <span className="text-[11.5px] leading-snug">
                                    <span className="block font-semibold">Booked by Bookly</span>
                                    {script.booked}
                                </span>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-2 sm:w-max sm:flex-nowrap" role="tablist" aria-label="Show the example on">
                {ORDER.map((k) => {
                    const on = k === channel;
                    const ChIcon = SKINS[k].icon;
                    return (
                        <button
                            key={k}
                            type="button"
                            role="tab"
                            aria-selected={on}
                            onClick={() => pick(k)}
                            className={cn(
                                'inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-3.5 text-small font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
                                on ? 'bg-text text-bg shadow-card' : 'border border-border bg-surface text-text hover:bg-surface-2',
                            )}
                        >
                            <ChIcon className="h-4 w-4" aria-hidden />
                            {SKINS[k].label}
                        </button>
                    );
                })}
            </div>
            <figcaption className="text-center text-small text-muted">
                Example conversations. {BUSINESS} is a made-up business.
            </figcaption>
        </figure>
    );
}
