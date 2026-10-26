'use client';

import Link from 'next/link';
import { ArrowLeft, Lock } from 'lucide-react';
import { Card, CardContent, PageHeader, SkeletonCard } from '@bookingflow/ui';
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
            <PageHeader
                eyebrow={
                    <Link href="/settings" className="inline-flex min-h-[44px] items-center gap-1.5 rounded-control text-muted hover:text-text">
                        <ArrowLeft className="h-4 w-4" aria-hidden /> Settings
                    </Link>
                }
                title="Developer tools"
                subtitle="Connect your own systems to Bookly with API keys and webhooks."
            />

            {isLoading || !user ? (
                <div aria-busy="true" className="space-y-4">
                    <span className="sr-only">Loading…</span>
                    <SkeletonCard />
                    <SkeletonCard />
                </div>
            ) : user.role !== 'OWNER' ? (
                <Card>
                    <CardContent className="flex items-start gap-3">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-surface-2 text-muted" aria-hidden>
                            <Lock className="h-5 w-5" />
                        </span>
                        <div>
                            <p className="text-base font-semibold text-text">Only the account owner can manage developer tools</p>
                            <p className="mt-1 text-[15px] leading-relaxed text-muted">
                                An API key can read customer details and send messages as your business, so creating and changing
                                keys is kept to the owner. Ask them if you need a key for a system.
                            </p>
                        </div>
                    </CardContent>
                </Card>
            ) : (
                <>
                    <ApiKeysCard />
                    <ExternalAppCard />
                    <p className="text-[15px] leading-relaxed text-muted">
                        Changing a key without downtime: rotate it with a grace period, put the new key everywhere, then let the
                        old key expire (or stop it early). API reference: docs/API.md.
                    </p>
                </>
            )}
        </div>
    );
}
