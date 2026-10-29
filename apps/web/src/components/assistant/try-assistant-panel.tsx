'use client';

/**
 * "Try your assistant": ask a question the way a customer would and see the
 * reply. Uses POST /assistant/preview, which runs the real assistant but never
 * books, orders, saves or sends anything. With unsaved edits, the preview uses
 * them, so owners can check an answer before saving it.
 */
import { useState, type FormEvent } from 'react';
import { Bot, Send, ShieldCheck, UserRound } from 'lucide-react';
import { Badge, Button, Card, Skeleton, cn } from '@bookingflow/ui';
import { api } from '@/lib/api';
import type { BusinessType, Knowledge } from './knowledge-fields';

const QUESTION_MAX = 500;
const KEEP_TURNS = 6;

const SUGGESTIONS: Record<BusinessType, string[]> = {
    SERVICE: ['Where are you?', 'How can I pay?', 'What should I bring?', 'Can I cancel?', 'Any offers on now?'],
    PRODUCT: ['Where are you?', 'How can I pay?', 'Do you deliver to Tema?', 'Can I return it?', 'Any offers on now?'],
};

interface Turn {
    id: number;
    question: string;
    reply: string;
    handedToTeam: boolean;
}

interface TryAssistantPanelProps {
    businessType: BusinessType;
    /** The form's current (maybe unsaved) knowledge, or null to use what is saved. */
    unsavedKnowledge: Knowledge | null;
}

function errorMessage(err: any): string {
    const status = err?.response?.status;
    if (status === 429) return "That's a lot of questions. Wait a few minutes, then try again.";
    if (status === 400) return 'Something in the form needs fixing before your assistant can use it. Check the fields marked in red.';
    if (status === 503 || status === 502) return err?.response?.data?.message ?? "Your assistant couldn't answer just now. Try again in a moment.";
    return "Couldn't get an answer. Check your connection and try again.";
}

export function TryAssistantPanel({ businessType, unsavedKnowledge }: TryAssistantPanelProps) {
    const [question, setQuestion] = useState('');
    const [turns, setTurns] = useState<Turn[]>([]);
    const [asking, setAsking] = useState<string | null>(null);
    const [error, setError] = useState('');

    const ask = async (text: string) => {
        const q = text.trim();
        if (!q || asking) return;
        setError('');
        setAsking(q);
        try {
            const res = await api.post('/assistant/preview', {
                question: q,
                ...(unsavedKnowledge ? { knowledge: unsavedKnowledge } : {}),
            });
            const turn: Turn = { id: Date.now(), question: q, reply: res.data.reply ?? '', handedToTeam: !!res.data.handedToTeam };
            setTurns((prev) => [...prev, turn].slice(-KEEP_TURNS));
            setQuestion('');
        } catch (err) {
            setError(errorMessage(err));
        } finally {
            setAsking(null);
        }
    };

    const onSubmit = (e: FormEvent) => {
        e.preventDefault();
        void ask(question);
    };

    return (
        <Card className="overflow-hidden" aria-labelledby="try-assistant-title">
            <div className="border-b border-border px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 id="try-assistant-title" className="text-[18px] font-bold text-text">Try your assistant</h2>
                    {unsavedKnowledge && <Badge variant="warning">Using unsaved changes</Badge>}
                </div>
                <p className="mt-1 flex items-start gap-2 text-[14px] leading-snug text-muted">
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                    Practice only. Nothing is sent to customers and nothing is booked or charged.
                </p>
            </div>

            <div className="max-h-[28rem] min-h-[10rem] space-y-3 overflow-y-auto bg-bg p-4" aria-live="polite" aria-busy={!!asking || undefined}>
                {turns.length === 0 && !asking && (
                    <p className="text-[15px] leading-relaxed text-muted">
                        Ask the way a customer would, for example &ldquo;{SUGGESTIONS[businessType][0]}&rdquo;, and see how your assistant answers.
                    </p>
                )}
                {turns.map((t) => (
                    <div key={t.id} className="space-y-2">
                        <Bubble side="customer">{t.question}</Bubble>
                        {t.reply && <Bubble side="assistant">{t.reply}</Bubble>}
                        {t.handedToTeam && (
                            <p className="flex items-start gap-2 rounded-control bg-warning-soft px-3 py-2 text-[14px] text-warning-fg">
                                <UserRound className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                                In a real chat, your assistant would pass this to your team here. Add the answer above so it can reply itself.
                            </p>
                        )}
                    </div>
                ))}
                {asking && (
                    <div className="space-y-2">
                        <Bubble side="customer">{asking}</Bubble>
                        <div className="flex justify-start">
                            <Skeleton className="h-12 w-3/5 rounded-card" />
                            <span className="sr-only">Your assistant is typing…</span>
                        </div>
                    </div>
                )}
            </div>

            <div className="space-y-3 border-t border-border p-4">
                <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
                    {SUGGESTIONS[businessType].map((s) => (
                        <button
                            key={s}
                            type="button"
                            disabled={!!asking}
                            onClick={() => void ask(s)}
                            className="min-h-[44px] shrink-0 rounded-full border border-border bg-surface px-3 text-[14px] font-medium text-text transition-colors duration-ui hover:bg-surface-2 disabled:opacity-60"
                        >
                            {s}
                        </button>
                    ))}
                </div>
                <form onSubmit={onSubmit} className="flex items-end gap-2">
                    <label htmlFor="try-question" className="sr-only">Your question</label>
                    <input
                        id="try-question"
                        value={question}
                        onChange={(e) => setQuestion(e.target.value)}
                        maxLength={QUESTION_MAX}
                        placeholder="Type a customer's question…"
                        autoComplete="off"
                        className="min-h-[48px] w-full min-w-0 flex-1 rounded-control border border-border bg-surface px-4 text-base text-text placeholder:text-muted/80 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
                    />
                    <Button type="submit" isLoading={!!asking} disabled={!question.trim()} aria-label="Ask your assistant">
                        <Send className="h-4 w-4" aria-hidden />
                        <span className="hidden sm:inline">Ask</span>
                    </Button>
                </form>
                {error && <p role="alert" className="text-[14px] font-medium text-error-fg">{error}</p>}
            </div>
        </Card>
    );
}

function Bubble({ side, children }: { side: 'customer' | 'assistant'; children: string }) {
    const mine = side === 'customer';
    return (
        <div className={cn('flex items-end gap-2', mine ? 'justify-end' : 'justify-start')}>
            {!mine && (
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary" aria-hidden>
                    <Bot className="h-4 w-4" />
                </span>
            )}
            <p
                className={cn(
                    'max-w-[85%] whitespace-pre-wrap break-words rounded-card px-3.5 py-2.5 text-[15px] leading-relaxed shadow-soft',
                    mine ? 'rounded-br-md bg-primary text-primary-fg' : 'rounded-bl-md bg-surface text-text',
                )}
            >
                <span className="sr-only">{mine ? 'Customer: ' : 'Your assistant: '}</span>
                {children}
            </p>
        </div>
    );
}
