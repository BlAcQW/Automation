'use client';

import { useRef, useState } from 'react';
import { Send, Loader2, Paperclip, X } from 'lucide-react';

interface ChatComposerProps {
    onSend: (content: string) => Promise<void>;
    onSendMedia?: (file: File, caption: string) => Promise<void>;
    disabled?: boolean;
}

const ACTION_BTN =
    'h-11 w-11 shrink-0 flex items-center justify-center rounded-full text-slate-500 ' +
    'hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50';

/** Matches the API's accepted types (api services/media.ts). */
const ACCEPT = [
    'image/jpeg', 'image/png', 'image/webp',
    'video/mp4', 'video/3gpp',
    'audio/aac', 'audio/mpeg', 'audio/amr', 'audio/ogg',
    'application/pdf',
].join(',');

/** Rounded message input + send button for the chat thread. */
export function ChatComposer({ onSend, onSendMedia, disabled }: ChatComposerProps) {
    const [value, setValue] = useState('');
    const [sending, setSending] = useState(false);
    const [pending, setPending] = useState<File | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        const content = value.trim();
        // With a file staged, the text becomes its caption rather than a
        // separate message — the same way WhatsApp handles it.
        if (pending && onSendMedia) {
            if (sending) return;
            setSending(true);
            try {
                await onSendMedia(pending, content);
                setPending(null);
                setValue('');
            } finally {
                setSending(false);
            }
            return;
        }

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
            className="flex flex-col gap-2 p-3 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
        >
            {pending ? (
                <div className="flex items-center gap-2 rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-sm">
                    <Paperclip className="w-4 h-4 shrink-0 opacity-70" />
                    <span className="truncate flex-1">{pending.name}</span>
                    <button
                        type="button"
                        onClick={() => setPending(null)}
                        aria-label="Remove attachment"
                        className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
            ) : null}

            <div className="flex items-center gap-2">
            <input
                ref={fileRef}
                type="file"
                accept={ACCEPT}
                className="hidden"
                onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) setPending(file);
                    // Reset so picking the same file twice still fires onChange.
                    e.target.value = '';
                }}
            />
            {onSendMedia ? (
                <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    disabled={disabled || sending}
                    aria-label="Attach a file"
                    className={ACTION_BTN}
                >
                    <Paperclip className="w-5 h-5" />
                </button>
            ) : null}

            {/* Not shipped yet — see futurefeature.md items 3, 5 and 7.
                Location works in browsers via navigator.geolocation with no
                extra package; address request needs server-side work first.
            <button type="button" onClick={onSendLocation} aria-label="Share location" className={ACTION_BTN}>
                <MapPin className="w-5 h-5" />
            </button>
            <button type="button" onClick={onSendContact} aria-label="Share a contact" className={ACTION_BTN}>
                <User className="w-5 h-5" />
            </button>
            <button type="button" onClick={onRequestAddress} aria-label="Request delivery address" className={ACTION_BTN}>
                <Home className="w-5 h-5" />
            </button>
            */}
            <input
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={pending ? 'Add a caption…' : 'Type a message…'}
                disabled={disabled}
                className="flex-1 h-11 px-4 rounded-full bg-slate-100 dark:bg-slate-800 border-0 text-sm
                           text-slate-900 dark:text-white placeholder:text-slate-400
                           focus:outline-none focus:ring-2 focus:ring-emerald-500/40 disabled:opacity-50"
            />
            <button
                type="submit"
                disabled={(!value.trim() && !pending) || sending || disabled}
                aria-label="Send message"
                className="h-11 w-11 shrink-0 flex items-center justify-center rounded-full
                           bg-gradient-to-br from-emerald-500 to-teal-500 text-white shadow-md shadow-emerald-500/30
                           transition-transform hover:brightness-110 active:scale-95
                           disabled:opacity-40 disabled:pointer-events-none"
            >
                {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
            </button>
            </div>
        </form>
    );
}
