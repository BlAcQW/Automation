'use client';

import { useRef, useState } from 'react';
import { Send, Loader2, Paperclip, X } from 'lucide-react';

interface ChatComposerProps {
    onSend: (content: string) => Promise<void>;
    onSendMedia?: (file: File, caption: string) => Promise<void>;
    disabled?: boolean;
    /** Lets the thread's "Take over" button put the cursor in the message box. */
    inputRef?: React.Ref<HTMLInputElement>;
}

const ACTION_BTN =
    'h-11 w-11 shrink-0 flex items-center justify-center rounded-full text-muted transition-colors duration-ui ' +
    'hover:bg-surface-2 hover:text-text disabled:opacity-50';

/** Matches the API's accepted types (api services/media.ts). */
const ACCEPT = [
    'image/jpeg', 'image/png', 'image/webp',
    'video/mp4', 'video/3gpp',
    'audio/aac', 'audio/mpeg', 'audio/amr', 'audio/ogg',
    'application/pdf',
].join(',');

/** Rounded message input + send button for the chat thread. */
export function ChatComposer({ onSend, onSendMedia, disabled, inputRef }: ChatComposerProps) {
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
            className="flex flex-col gap-2 border-t border-border bg-surface p-2 sm:p-3"
        >
            {pending ? (
                <div className="flex items-center gap-2 rounded-control bg-surface-2 py-1 pl-3 pr-1 text-[15px] text-text">
                    <Paperclip className="h-4 w-4 shrink-0 text-muted" aria-hidden />
                    <span className="flex-1 truncate">{pending.name}</span>
                    <button
                        type="button"
                        onClick={() => setPending(null)}
                        aria-label="Remove attachment"
                        className="flex h-11 w-11 items-center justify-center rounded-control text-muted hover:bg-border/60 hover:text-text"
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
            <label htmlFor="chat-composer-input" className="sr-only">
                {pending ? 'Caption' : 'Message'}
            </label>
            <input
                id="chat-composer-input"
                ref={inputRef}
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={pending ? 'Add a caption…' : 'Type a message…'}
                disabled={disabled}
                className="h-12 min-w-0 flex-1 rounded-full border border-border bg-bg px-4 text-base text-text placeholder:text-muted/80
                           transition-[border-color,box-shadow] duration-ui focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15 disabled:opacity-50"
            />
            <button
                type="submit"
                disabled={(!value.trim() && !pending) || sending || disabled}
                aria-label="Send message"
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary text-primary-fg shadow-soft
                           transition-[transform,background-color] duration-ui hover:bg-primary-hover active:scale-[0.97]
                           disabled:pointer-events-none disabled:opacity-40"
            >
                {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
            </button>
            </div>
        </form>
    );
}
