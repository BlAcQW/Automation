'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence, useInView } from 'framer-motion';
import { Check, CheckCheck, Bot } from 'lucide-react';
import { cn } from '@/lib/cn';

interface ChatMessage {
    id: number;
    direction: 'in' | 'out';
    text: string;
    isBot?: boolean;
    delay: number;
    typing?: number;
}

const conversationScript: ChatMessage[] = [
    {
        id: 1,
        direction: 'in',
        text: "Hi! I'd like to book a haircut please",
        delay: 600,
        typing: 0,
    },
    {
        id: 2,
        direction: 'out',
        text: "Hello! Welcome to Style Studio! I'd be happy to help you book an appointment.",
        isBot: true,
        delay: 2200,
        typing: 1200,
    },
    {
        id: 3,
        direction: 'out',
        text: 'We have these services available:\n\n1. Haircut \u2014 30 min \u2014 $25\n2. Haircut & Beard \u2014 45 min \u2014 $35\n3. Full Styling \u2014 60 min \u2014 $50\n\nWhich would you like?',
        isBot: true,
        delay: 4000,
        typing: 800,
    },
    {
        id: 4,
        direction: 'in',
        text: "I'll take the Haircut & Beard please!",
        delay: 6500,
        typing: 0,
    },
    {
        id: 5,
        direction: 'out',
        text: 'Great choice! Here are available slots for tomorrow:\n\n9:00 AM\n10:30 AM\n2:00 PM\n4:30 PM\n\nWhich time works best?',
        isBot: true,
        delay: 8000,
        typing: 1000,
    },
    {
        id: 6,
        direction: 'in',
        text: '10:30 AM works great!',
        delay: 10500,
        typing: 0,
    },
    {
        id: 7,
        direction: 'out',
        text: "You're all set!\n\nBooking Confirmed:\nHaircut & Beard\nTomorrow at 10:30 AM\n45 minutes\n$35\n\nWe'll send you a reminder before your appointment. See you soon!",
        isBot: true,
        delay: 12000,
        typing: 1200,
    },
];

const steps = [
    { number: '01', title: 'Customer Messages', desc: 'Your customer sends a WhatsApp message to your business number' },
    { number: '02', title: 'Bot Responds', desc: 'Our AI bot shows available services and time slots instantly' },
    { number: '03', title: 'Booking Confirmed', desc: 'Customer picks a time, and the booking is auto-confirmed with reminders' },
];

function TypingIndicator() {
    return (
        <div className="flex items-center gap-1 px-4 py-3">
            {[0, 1, 2].map((i) => (
                <motion.div
                    key={i}
                    className="w-2 h-2 rounded-full bg-slate-400"
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
                />
            ))}
        </div>
    );
}

export function WhatsAppDemo() {
    const [visibleMessages, setVisibleMessages] = useState<number[]>([]);
    const [typing, setTyping] = useState(false);
    const [activeStep, setActiveStep] = useState(0);
    const [hasStarted, setHasStarted] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const chatEndRef = useRef<HTMLDivElement>(null);
    const isInView = useInView(containerRef, { once: true, margin: '-100px' });

    useEffect(() => {
        if (isInView && !hasStarted) {
            setHasStarted(true);
            runAnimation();
        }
    }, [isInView, hasStarted]);

    const runAnimation = () => {
        conversationScript.forEach((msg) => {
            if (msg.isBot && msg.typing) {
                setTimeout(() => {
                    setTyping(true);
                }, msg.delay - msg.typing);
            }

            setTimeout(() => {
                setTyping(false);
                setVisibleMessages((prev) => [...prev, msg.id]);

                if (msg.id <= 1) setActiveStep(0);
                else if (msg.id <= 5) setActiveStep(1);
                else setActiveStep(2);
            }, msg.delay);
        });
    };

    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, [visibleMessages, typing]);

    const replay = () => {
        setVisibleMessages([]);
        setActiveStep(0);
        setTyping(false);
        setHasStarted(false);
        setTimeout(() => {
            setHasStarted(true);
            runAnimation();
        }, 300);
    };

    return (
        <section ref={containerRef} className="py-24 px-4 relative">
            <div className="max-w-7xl mx-auto">
                {/* Section Header */}
                <motion.div
                    initial={{ opacity: 0, y: 30 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    className="text-center mb-16"
                >
                    <h2 className="text-3xl md:text-5xl font-bold text-white mb-4 tracking-tight">
                        See It In Action
                    </h2>
                    <p className="text-slate-400 text-lg max-w-2xl mx-auto">
                        Watch how a customer books an appointment in seconds through WhatsApp
                    </p>
                </motion.div>

                <div className="flex flex-col lg:flex-row items-center gap-12 lg:gap-16">
                    {/* Phone Mockup */}
                    <motion.div
                        initial={{ opacity: 0, x: -30 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.6 }}
                        className="flex-shrink-0"
                    >
                        <div className="relative">
                            {/* Phone frame */}
                            <div className="w-[320px] sm:w-[360px] bg-[#111827] rounded-[3rem] p-3 shadow-2xl shadow-emerald-500/10 border border-white/10">
                                {/* Notch */}
                                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-36 h-7 bg-[#111827] rounded-b-2xl z-10" />

                                {/* Screen */}
                                <div className="bg-[#0b141a] rounded-[2.25rem] overflow-hidden">
                                    {/* WhatsApp Header */}
                                    <div className="bg-[#1f2c34] px-4 pt-10 pb-3 flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center">
                                            <span className="text-white font-bold text-sm">SS</span>
                                        </div>
                                        <div className="flex-1">
                                            <p className="text-white font-medium text-sm">Style Studio</p>
                                            <p className="text-emerald-400 text-xs flex items-center gap-1">
                                                <Bot className="w-3 h-3" /> Online
                                            </p>
                                        </div>
                                    </div>

                                    {/* Chat area */}
                                    <div className="h-[420px] sm:h-[460px] overflow-y-auto p-3 space-y-2 scrollbar-hide bg-[#0b141a]">
                                        {/* Date chip */}
                                        <div className="flex justify-center mb-2">
                                            <span className="bg-[#182229] text-slate-400 text-[10px] px-3 py-1 rounded-lg">TODAY</span>
                                        </div>

                                        <AnimatePresence>
                                            {conversationScript
                                                .filter((msg) => visibleMessages.includes(msg.id))
                                                .map((msg) => (
                                                    <motion.div
                                                        key={msg.id}
                                                        initial={{ opacity: 0, y: 15, scale: 0.95 }}
                                                        animate={{ opacity: 1, y: 0, scale: 1 }}
                                                        transition={{ duration: 0.3, ease: 'easeOut' }}
                                                        className={cn('flex', msg.direction === 'in' ? 'justify-start' : 'justify-end')}
                                                    >
                                                        <div
                                                            className={cn(
                                                                'max-w-[80%] rounded-xl px-3 py-2 text-[13px] leading-[1.35] relative',
                                                                msg.direction === 'in'
                                                                    ? 'bg-[#1f2c34] text-slate-200 rounded-tl-sm'
                                                                    : 'bg-[#005c4b] text-white rounded-tr-sm'
                                                            )}
                                                        >
                                                            <div className="whitespace-pre-line">{msg.text}</div>
                                                            <div className={cn(
                                                                'flex items-center justify-end gap-1 mt-1',
                                                                msg.direction === 'in' ? 'text-slate-500' : 'text-emerald-200/60'
                                                            )}>
                                                                <span className="text-[10px]">
                                                                    {new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                                                                </span>
                                                                {msg.direction === 'out' && (
                                                                    <CheckCheck className="w-3.5 h-3.5 text-blue-400" />
                                                                )}
                                                            </div>
                                                        </div>
                                                    </motion.div>
                                                ))}
                                        </AnimatePresence>

                                        {/* Typing indicator */}
                                        <AnimatePresence>
                                            {typing && (
                                                <motion.div
                                                    initial={{ opacity: 0, y: 10 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                    exit={{ opacity: 0, y: -5 }}
                                                    className="flex justify-end"
                                                >
                                                    <div className="bg-[#005c4b] rounded-xl rounded-tr-sm">
                                                        <TypingIndicator />
                                                    </div>
                                                </motion.div>
                                            )}
                                        </AnimatePresence>

                                        <div ref={chatEndRef} />
                                    </div>

                                    {/* Message input bar */}
                                    <div className="bg-[#1f2c34] px-3 py-2 flex items-center gap-2">
                                        <div className="flex-1 bg-[#2a3942] rounded-full px-4 py-2">
                                            <span className="text-slate-500 text-sm">Type a message</span>
                                        </div>
                                        <div className="w-10 h-10 bg-emerald-500 rounded-full flex items-center justify-center">
                                            <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
                                                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                                            </svg>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Glow effect behind phone */}
                            <div className="absolute inset-0 -z-10 bg-emerald-500/20 blur-[80px] rounded-full" />
                        </div>
                    </motion.div>

                    {/* Steps on the right */}
                    <motion.div
                        initial={{ opacity: 0, x: 30 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.6, delay: 0.2 }}
                        className="flex-1 space-y-6"
                    >
                        <h3 className="text-2xl font-bold text-white mb-8">How It Works</h3>
                        {steps.map((step, idx) => (
                            <motion.div
                                key={step.number}
                                initial={{ opacity: 0.4, x: 20 }}
                                animate={{
                                    opacity: activeStep >= idx ? 1 : 0.4,
                                    x: 0,
                                    scale: activeStep === idx ? 1.02 : 1,
                                }}
                                transition={{ duration: 0.4 }}
                                className={cn(
                                    'flex items-start gap-5 p-5 rounded-2xl transition-all duration-300 border',
                                    activeStep === idx
                                        ? 'glass-card border-emerald-500/30 shadow-glow-sm'
                                        : activeStep > idx
                                            ? 'border-white/5 bg-white/[0.02]'
                                            : 'border-transparent'
                                )}
                            >
                                <div className={cn(
                                    'w-12 h-12 rounded-xl flex items-center justify-center font-bold text-sm flex-shrink-0 transition-all duration-300',
                                    activeStep >= idx
                                        ? 'bg-gradient-to-br from-emerald-400 to-teal-500 text-white shadow-glow-sm'
                                        : 'bg-white/5 text-slate-500'
                                )}>
                                    {activeStep > idx ? <Check className="w-5 h-5" /> : step.number}
                                </div>
                                <div>
                                    <h4 className={cn(
                                        'font-semibold text-lg mb-1 transition-colors',
                                        activeStep >= idx ? 'text-white' : 'text-slate-500'
                                    )}>
                                        {step.title}
                                    </h4>
                                    <p className={cn(
                                        'text-sm leading-relaxed transition-colors',
                                        activeStep >= idx ? 'text-slate-400' : 'text-slate-600'
                                    )}>
                                        {step.desc}
                                    </p>
                                </div>
                            </motion.div>
                        ))}

                        {/* Replay button */}
                        <AnimatePresence>
                            {visibleMessages.length === conversationScript.length && (
                                <motion.button
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: 0.5 }}
                                    onClick={replay}
                                    className="text-emerald-400 hover:text-emerald-300 text-sm font-medium flex items-center gap-2 transition-colors ml-5"
                                >
                                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M1 4v6h6M23 20v-6h-6" />
                                        <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" />
                                    </svg>
                                    Replay Animation
                                </motion.button>
                            )}
                        </AnimatePresence>
                    </motion.div>
                </div>
            </div>
        </section>
    );
}
