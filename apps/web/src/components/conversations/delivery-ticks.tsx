'use client';

import { AlertCircle, Check, CheckCheck, Clock } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { MessageStatus } from './types';

/**
 * WhatsApp's delivery marks, driven by Meta's status webhook.
 *
 *   clock    queued — sent, but Meta hasn't reported on it yet
 *   ✓        sent to WhatsApp
 *   ✓✓       delivered to the handset
 *   ✓✓ blue  read
 *   (!)      failed
 *
 * A message with no status yet shows a clock, never a tick — each state means
 * something different to the operator, so none of them is guessed.
 */
export function DeliveryTicks({ status }: { status?: MessageStatus | null }) {
    if (status === 'FAILED') {
        return <AlertCircle className="w-3.5 h-3.5 text-red-500" aria-label="Failed to send" />;
    }
    if (!status) {
        return <Clock className="w-3 h-3 opacity-50" aria-label="Sending" />;
    }
    if (status === 'SENT') {
        return <Check className="w-3.5 h-3.5 opacity-70" aria-label="Sent" />;
    }
    const read = status === 'READ';
    return (
        <CheckCheck
            className={cn('w-3.5 h-3.5', read ? 'text-sky-400' : 'opacity-70')}
            aria-label={read ? 'Read' : 'Delivered'}
        />
    );
}
