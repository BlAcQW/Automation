'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, FileText, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import type { MediaKind, Message } from './types';

/**
 * Attachments on a message.
 *
 * Stored media is behind an authenticated, tenant-scoped route, so a plain
 * <img src> can't fetch it — the browser wouldn't send the Authorization
 * header. The bytes are fetched with the API client and turned into an object
 * URL, revoked on unmount so blobs don't accumulate. The same URL feeds the
 * <video> and <audio> elements, so nothing else needs a player library.
 */
export function ChatMedia({ message, conversationId }: { message: Message; conversationId: string }) {
    const [url, setUrl] = useState<string | null>(null);
    const [failed, setFailed] = useState(false);

    const kind: MediaKind =
        message.metadata?.kind ?? (message.messageType?.toLowerCase() as MediaKind) ?? 'document';
    const pending = message.metadata?.inboundPending;

    useEffect(() => {
        if (pending) return;
        let active = true;
        let objectUrl: string | null = null;

        api.get(`/conversations/${conversationId}/media/${message.id}`, { responseType: 'blob' })
            .then((res) => {
                if (!active) return;
                objectUrl = URL.createObjectURL(res.data as Blob);
                setUrl(objectUrl);
            })
            .catch(() => active && setFailed(true));

        return () => {
            active = false;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [conversationId, message.id, pending]);

    // Inbound media is stored as a Meta id only — the bytes were never
    // downloaded, so there is nothing to render. Say so plainly.
    if (pending) {
        return (
            <div className="flex items-center gap-2 py-1 text-xs opacity-70">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {kind} from customer — not downloaded
            </div>
        );
    }

    if (failed) {
        return (
            <div className="flex items-center gap-2 py-1 text-xs opacity-70">
                <AlertCircle className="w-4 h-4 shrink-0" />
                Attachment unavailable
            </div>
        );
    }

    if (kind === 'document') {
        return (
            <a
                href={url ?? undefined}
                download={message.metadata?.filename ?? 'document.pdf'}
                className="flex items-center gap-2 py-1 text-sm underline-offset-2 hover:underline"
            >
                <FileText className="w-4 h-4 shrink-0" />
                <span className="truncate">{message.metadata?.filename ?? 'Document'}</span>
            </a>
        );
    }

    if (!url) {
        return (
            <div className="flex h-32 w-48 items-center justify-center rounded-lg bg-black/10">
                <Loader2 className="w-5 h-5 animate-spin opacity-60" />
            </div>
        );
    }

    if (kind === 'video') {
        return <video src={url} controls className="max-h-72 w-auto max-w-full rounded-lg" />;
    }

    if (kind === 'audio') {
        return (
            <div className="flex flex-col gap-1 py-1">
                <audio src={url} controls className="max-w-full" />
                {message.metadata?.voice ? <span className="text-[11px] opacity-60">Voice note</span> : null}
            </div>
        );
    }

    // Stickers are transparent — no rounding, no background, smaller.
    const sticker = kind === 'sticker';
    return (
        // eslint-disable-next-line @next/next/no-img-element -- blob URL, not an optimizable remote asset
        <img
            src={url}
            alt={message.metadata?.caption || (sticker ? 'Sticker' : 'Photo')}
            className={sticker ? 'max-h-32 w-auto' : 'max-h-72 w-auto max-w-full rounded-lg object-cover'}
        />
    );
}
