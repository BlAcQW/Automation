'use client';

import { useState } from 'react';
import { AlertTriangle, Check, Copy } from 'lucide-react';
import { notify } from '@/components/brand/toast';
import { Button } from '@bookingflow/ui';

interface SecretRevealProps {
    /** What is being shown, e.g. "API key" or "signing secret". */
    label: string;
    secret: string;
    /** Extra guidance under the warning (where to put it, what happens next). */
    note?: React.ReactNode;
    onDone: () => void;
}

/**
 * Shows a credential exactly once. The value lives only in the parent's state
 * and is gone when the dialog closes; the API cannot return it again.
 */
export function SecretReveal({ label, secret, note, onDone }: SecretRevealProps) {
    const [copied, setCopied] = useState(false);

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(secret);
            setCopied(true);
            notify.success(`${label} copied`);
        } catch {
            notify.error('Could not copy. Select the text and copy it by hand.');
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex gap-3 rounded-control bg-warning-soft px-4 py-3 text-[15px] leading-relaxed text-warning-fg">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
                <p>
                    <strong className="font-semibold">Copy it now. You won&apos;t see this {label.toLowerCase()} again.</strong>{' '}
                    Bookly stores only a fingerprint of it. If you lose it, rotate to get a new one.
                </p>
            </div>

            <div className="space-y-1.5">
                <label htmlFor="revealed-secret" className="block text-small font-medium text-text">
                    Your new {label.toLowerCase()}
                </label>
                <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                        id="revealed-secret"
                        readOnly
                        value={secret}
                        onFocus={(e) => e.currentTarget.select()}
                        spellCheck={false}
                        className="min-h-[44px] min-w-0 flex-1 rounded-control border border-border bg-surface-2 px-3 py-2.5 font-mono text-[13px] text-text focus:border-primary focus:outline-none"
                    />
                    <Button type="button" variant="secondary" onClick={copy} className="flex-shrink-0">
                        {copied ? <Check className="h-4 w-4 text-success-fg" aria-hidden /> : <Copy className="h-4 w-4" />}
                        {copied ? 'Copied' : 'Copy'}
                    </Button>
                </div>
            </div>

            {note && <div className="text-[15px] leading-relaxed text-muted">{note}</div>}

            <div className="flex justify-end">
                <Button type="button" onClick={onDone}>
                    {copied ? 'Done' : "I've saved it"}
                </Button>
            </div>
        </div>
    );
}
