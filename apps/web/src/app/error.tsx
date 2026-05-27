'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        // Surface in the browser console for the developer; production logs
        // would flow to Sentry via @sentry/nextjs once a DSN is configured.
        // eslint-disable-next-line no-console
        console.error(error);
    }, [error]);

    const message =
        process.env.NODE_ENV === 'production'
            ? 'Something went wrong on our end.'
            : error.message;

    return (
        <div className="min-h-screen flex items-center justify-center bg-slate-900 p-6">
            <Card className="glass-card border-white/5 max-w-md w-full p-8 text-center">
                <div className="w-14 h-14 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-4">
                    <AlertTriangle className="w-7 h-7 text-red-400" />
                </div>
                <h1 className="text-2xl font-bold text-white">Something broke</h1>
                <p className="text-slate-400 mt-2 break-words">{message}</p>
                {error.digest && (
                    <p className="text-xs text-slate-600 mt-3 font-mono">ref: {error.digest}</p>
                )}

                <div className="mt-6 flex flex-col sm:flex-row gap-2 justify-center">
                    <Button onClick={() => reset()}>
                        <RotateCw className="w-4 h-4 mr-2" />
                        Try again
                    </Button>
                    <Link href="/dashboard">
                        <Button variant="outline">Back to dashboard</Button>
                    </Link>
                </div>
            </Card>
        </div>
    );
}
