'use client';

import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import {
    PaperCard,
    PublicPage,
    SummaryCard,
    publicBody,
    publicDangerBtn,
    publicEyebrow,
    publicFine,
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
            <PaperCard>
                {phase === 'loading' && (
                    <p className={`text-center py-12 ${publicBody}`}>Loading…</p>
                )}

                {phase === 'not_found' && (
                    <>
                        <h1 className={publicTitle}>Appointment not found</h1>
                        <p className={`mt-3 ${publicBody}`}>
                            This link is invalid or has expired.
                        </p>
                    </>
                )}

                {phase === 'error' && (
                    <>
                        <h1 className={publicTitle}>Something went wrong</h1>
                        <p className={`mt-3 ${publicBody}`}>Please try again in a moment.</p>
                    </>
                )}

                {phase === 'already' && data && (
                    <>
                        <h1 className={publicTitle}>Already cancelled</h1>
                        <p className={`mt-3 ${publicBody}`}>
                            Your {data.serviceName} appointment with {data.businessName} is already cancelled.
                        </p>
                    </>
                )}

                {phase === 'cancelled' && data && (
                    <>
                        <div className="w-11 h-11 rounded-[5px] bg-forest-night text-forest-glow flex items-center justify-center mx-auto">
                            <Check className="w-5 h-5" strokeWidth={2.4} aria-hidden />
                        </div>
                        <h1 className={`${publicTitle} text-center mt-4`}>
                            Appointment cancelled
                        </h1>
                        <p className={`mt-3 text-center ${publicBody}`}>
                            Your {data.serviceName} appointment with {data.businessName} has been cancelled.
                            Reference {data.bookingReference}.
                        </p>
                    </>
                )}

                {(phase === 'show' || phase === 'cancelling') && data && (
                    <>
                        <p className={publicEyebrow}>{data.businessName}</p>
                        <h1 className={`${publicTitle} mt-2`}>
                            Cancel this appointment?
                        </h1>
                        <SummaryCard className="mt-5">
                            <p className="text-[15px] font-medium tracking-[-0.02em]">{data.serviceName}</p>
                            <p className="mt-1 text-[14px] text-forest-cream/75 tabular-nums">
                                {new Date(data.startTime).toLocaleString([], {
                                    weekday: 'short', month: 'short', day: 'numeric',
                                    hour: '2-digit', minute: '2-digit',
                                })}
                            </p>
                            <p className="mt-3 pt-3 border-t border-forest-cream/10 font-mono text-[11px] text-forest-cream/55">Ref: {data.bookingReference}</p>
                        </SummaryCard>
                        <button
                            onClick={doCancel}
                            disabled={phase === 'cancelling'}
                            className={`mt-5 ${publicDangerBtn}`}
                        >
                            {phase === 'cancelling' ? 'Cancelling…' : 'Cancel Appointment'}
                        </button>
                        <p className={`mt-3 text-center ${publicFine}`}>
                            Changed your mind? Just close this page. Nothing happens.
                        </p>
                    </>
                )}
            </PaperCard>
        </PublicPage>
    );
}
