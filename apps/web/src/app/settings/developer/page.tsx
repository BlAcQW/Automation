'use client';

import Link from 'next/link';
import { ArrowLeft, Loader2, Lock } from 'lucide-react';
import { Card, CardContent } from '@bookingflow/ui';
import { useAuth } from '@/lib/auth';
import { ApiKeysCard } from '@/components/developer/api-keys-card';
import { ExternalAppCard } from '@/components/developer/external-app-card';

/**
 * Settings > Developer: API keys and the external app. Owner only (the API
 * enforces it too); staff get a plain explanation instead of a wall of 403s.
 */
export default function DeveloperSettingsPage() {
    const { user, isLoading } = useAuth();

    return (
        <div className="mx-auto max-w-5xl space-y-6">
            <div>
                <Link href="/settings" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white">
                    <ArrowLeft className="h-4 w-4" /> Settings
                </Link>
                <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">Developer</h1>
                <p className="mt-1 text-slate-500 dark:text-slate-400">
                    Connect your own systems to Bookly with API keys and webhooks.
                </p>
            </div>

            {isLoading || !user ? (
                <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
            ) : user.role !== 'OWNER' ? (
                <Card>
                    <CardContent className="flex items-start gap-3 py-6">
                        <Lock className="mt-0.5 h-5 w-5 flex-shrink-0 text-slate-400" aria-hidden />
                        <div>
                            <p className="font-medium text-slate-900 dark:text-white">Only the account owner can manage developer settings</p>
                            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                                An API key can read customer details and send messages as your business, so creating and rotating
                                keys is kept to the owner. Ask them if you need a key for a system.
                            </p>
                        </div>
                    </CardContent>
                </Card>
            ) : (
                <>
                    <ApiKeysCard />
                    <ExternalAppCard />
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                        Rotating a key without downtime: rotate it with a grace period, deploy the new key everywhere, then let the old
                        key expire (or stop it early). API reference: docs/API.md.
                    </p>
                </>
            )}
        </div>
    );
}
