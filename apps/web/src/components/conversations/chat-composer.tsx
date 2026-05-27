'use client';

import { useState } from 'react';
import { Send, Loader2 } from 'lucide-react';

interface ChatComposerProps {
    onSend: (content: string) => Promise<void>;
    disabled?: boolean;
}

/** Rounded message input + send button for the chat thread. */
export function ChatComposer({ onSend, disabled }: ChatComposerProps) {
    const [value, setValue] = useState('');
    const [sending, setSending] = useState(false);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        const content = value.trim();
        if (!content || sending) return;
        setSending(true);
        try {
            await onSend(content);
            setValue('');
        } finally {
            setSending(false);
        }
    };

    return (
        <form
            onSubmit={submit}
            className="flex items-center gap-2 p-3 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
        >
            <input
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="Type a message…"
                disabled={disabled}
                className="flex-1 h-11 px-4 rounded-full bg-slate-100 dark:bg-slate-800 border-0 text-sm
                           text-slate-900 dark:text-white placeholder:text-slate-400
                           focus:outline-none focus:ring-2 focus:ring-emerald-500/40 disabled:opacity-50"
            />
            <button
                type="submit"
                disabled={!value.trim() || sending || disabled}
                aria-label="Send message"
                className="h-11 w-11 shrink-0 flex items-center justify-center rounded-full
                           bg-gradient-to-br from-emerald-500 to-teal-500 text-white shadow-md shadow-emerald-500/30
                           transition-transform hover:brightness-110 active:scale-95
                           disabled:opacity-40 disabled:pointer-events-none"
            >
                {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
            </button>
        </form>
    );
}
