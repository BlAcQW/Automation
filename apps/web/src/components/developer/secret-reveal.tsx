'use client';

import { useState } from 'react';
import { AlertTriangle, Check, Copy } from 'lucide-react';
import toast from 'react-hot-toast';
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
            toast.success(`${label} copied`);
        } catch {
            toast.error('Could not copy. Select the text and copy it by hand.');
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
                <p>
                    <strong className="font-semibold">Copy it now. You won&apos;t see this {label.toLowerCase()} again.</strong>{' '}
                    Bookly stores only a fingerprint of it. If you lose it, rotate to get a new one.
                </p>
            </div>

            <div className="space-y-1.5">
                <label htmlFor="revealed-secret" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                    Your new {label.toLowerCase()}
                </label>
                <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                        id="revealed-secret"
                        readOnly
                        value={secret}
                        onFocus={(e) => e.currentTarget.select()}
                        spellCheck={false}
                        className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 font-mono text-xs text-slate-900 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    />
                    <Button type="button" variant="outline" onClick={copy} className="flex-shrink-0">
                        {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                        {copied ? 'Copied' : 'Copy'}
                    </Button>
                </div>
            </div>

            {note && <div className="text-sm text-slate-500 dark:text-slate-400">{note}</div>}

            <div className="flex justify-end">
                <Button type="button" onClick={onDone}>
                    {copied ? 'Done' : "I've saved it"}
                </Button>
            </div>
        </div>
    );
}
