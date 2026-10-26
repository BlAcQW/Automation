'use client';

import { useEffect, useState } from 'react';
import { CalendarX2, CloudOff, SearchX } from 'lucide-react';
import { Button, Skeleton, SkeletonLine, StatusPill, TickPop, cn } from '@bookingflow/ui';
import {
    BusinessHero,
    FactList,
    PublicCard,
    PublicPage,
    formatWhen,
    publicBody,
    publicTitle,
} from '@/components/pay/public-shell';

interface BookingData {
    bookingReference: string;
    status: string;
    serviceName: string;
    businessName: string;
    startTime: string;
    endTime: string;
    cancellable: boolean;
}

type Phase = 'loading' | 'show' | 'cancelling' | 'cancelled' | 'already' | 'not_found' | 'error';

export default function CancelBookingPage({ params }: { params: { token: string } }) {
    const [data, setData] = useState<BookingData | null>(null);
    const [phase, setPhase] = useState<Phase>('loading');

    useEffect(() => {
        fetch(`/api/public/cancel/${params.token}`)
            .then(async (r) => {
                if (r.status === 404) throw new Error('not_found');
                if (!r.ok) throw new Error('error');
                return r.json();
            })
            .then((d: BookingData) => {
                setData(d);
                setPhase(d.status === 'CANCELLED' ? 'already' : 'show');
            })
            .catch((e) => setPhase(e.message === 'not_found' ? 'not_found' : 'error'));
    }, [params.token]);

    async function doCancel() {
        setPhase('cancelling');
        try {
            const r = await fetch(`/api/public/cancel/${params.token}`, { method: 'POST' });
            const body = await r.json();
            if (body.ok) setPhase('cancelled');
            else if (body.alreadyCancelled) setPhase('already');
            else setPhase('error');
        } catch {
            setPhase('error');
        }
    }

    return (
        <PublicPage>
            {phase === 'loading' ? <CancelSkeleton /> : <BusinessHero name={data?.businessName} />}

            {phase !== 'loading' && (
                <PublicCard>
                    {phase === 'not_found' && (
                        <Message
                            icon={<SearchX />}
                            title="We can't find this appointment"
                            body="This link may be broken or too old. Message the business on WhatsApp if you need to change your booking."
                        />
                    )}

                    {phase === 'error' && (
                        <Message
                            icon={<CloudOff />}
                            title="Oops, that didn't work"
                            body="We couldn't reach the booking just now. Check your internet connection, then refresh this page and try again."
                        />
                    )}

                    {phase === 'already' && data && (
                        <Message
                            icon={<CalendarX2 />}
                            pill={<StatusPill status="cancelled" />}
                            title="Already cancelled"
                            body={`Your ${data.serviceName} appointment with ${data.businessName} is already cancelled. Nothing else to do.`}
                        />
                    )}

                    {phase === 'cancelled' && data && (
                        <div className="flex flex-col items-center text-center">
                            <TickPop size={64} label="Appointment cancelled" />
                            <StatusPill status="cancelled" className="mt-5" />
                            <h1 className={cn(publicTitle, 'mt-3')}>Appointment cancelled</h1>
                            <p className={cn(publicBody, 'mt-2')}>
                                Your {data.serviceName} appointment with {data.businessName} has been cancelled.
                                Want a new time? Just message them on WhatsApp.
                            </p>
                            <FactList
                                className="mt-6 w-full text-left"
                                rows={[['Reference', <span className="font-mono text-[15px]">{data.bookingReference}</span>]]}
                            />
                        </div>
                    )}

                    {(phase === 'show' || phase === 'cancelling') && data && (
                        <>
                            <StatusPill status={data.status} />
                            <h1 className={cn(publicTitle, 'mt-3')}>Cancel this appointment?</h1>
                            <p className={cn(publicBody, 'mt-2')}>
                                Your slot will be freed up for someone else. You can always book again later.
                            </p>
                            <FactList
                                className="mt-5"
                                rows={[
                                    ['Service', data.serviceName],
                                    ['When', formatWhen(data.startTime)],
                                    ['Reference', <span className="font-mono text-[15px]">{data.bookingReference}</span>],
                                ]}
                            />
                            <Button
                                variant="destructive"
                                size="lg"
                                fullWidth
                                className="mt-6"
                                onClick={doCancel}
                                isLoading={phase === 'cancelling'}
                                loadingText="Cancelling…"
                            >
                                Yes, cancel my appointment
                            </Button>
                            <p className="mt-3 text-center text-small text-muted">
                                Changed your mind? Just close this page. Nothing happens.
                            </p>
                        </>
                    )}
                </PublicCard>
            )}
        </PublicPage>
    );
}

function Message({
    icon,
    pill,
    title,
    body,
}: {
    icon: React.ReactNode;
    pill?: React.ReactNode;
    title: string;
    body: string;
}) {
    return (
        <div className="flex flex-col items-center text-center">
            <div aria-hidden className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-2 text-muted [&_svg]:h-8 [&_svg]:w-8">
                {icon}
            </div>
            {pill && <div className="mt-5">{pill}</div>}
            <h1 className={cn(publicTitle, pill ? 'mt-3' : 'mt-5')}>{title}</h1>
            <p className={cn(publicBody, 'mt-2')}>{body}</p>
        </div>
    );
}

function CancelSkeleton() {
    return (
        <div aria-busy="true">
            <h1 className="sr-only">Loading your appointment…</h1>
            <div className="mb-5 flex items-center gap-3" aria-hidden>
                <Skeleton className="h-12 w-12 rounded-control" />
                <SkeletonLine width="w-1/2" className="h-6" />
            </div>
            <div className="rounded-card-lg border border-border bg-surface p-5 shadow-card sm:p-8" aria-hidden>
                <Skeleton className="h-6 w-24 rounded-full" />
                <SkeletonLine width="w-3/4" className="mt-4 h-7" />
                <SkeletonLine width="w-full" className="mt-3" />
                <Skeleton className="mt-5 h-36 w-full rounded-card" />
                <Skeleton className="mt-6 h-12 w-full rounded-control" />
            </div>
        </div>
    );
}
