'use client';

import { useEffect, useState } from 'react';

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
        <main className="min-h-screen bg-slate-50 flex items-start justify-center px-4 py-10">
            <div className="w-full max-w-md">
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                    {phase === 'loading' && (
                        <p className="text-center text-slate-500 py-12">Loading…</p>
                    )}

                    {phase === 'not_found' && (
                        <>
                            <h1 className="text-lg font-semibold text-slate-900">Appointment not found</h1>
                            <p className="text-sm text-slate-500 mt-2">
                                This link is invalid or has expired.
                            </p>
                        </>
                    )}

                    {phase === 'error' && (
                        <>
                            <h1 className="text-lg font-semibold text-slate-900">Something went wrong</h1>
                            <p className="text-sm text-slate-500 mt-2">Please try again in a moment.</p>
                        </>
                    )}

                    {phase === 'already' && data && (
                        <>
                            <h1 className="text-lg font-semibold text-slate-900">Already cancelled</h1>
                            <p className="text-sm text-slate-500 mt-2">
                                Your {data.serviceName} appointment with {data.businessName} is already cancelled.
                            </p>
                        </>
                    )}

                    {phase === 'cancelled' && data && (
                        <>
                            <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center mx-auto">
                                <span className="text-emerald-600 text-xl">✓</span>
                            </div>
                            <h1 className="text-lg font-semibold text-slate-900 text-center mt-3">
                                Appointment cancelled
                            </h1>
                            <p className="text-sm text-slate-500 mt-2 text-center">
                                Your {data.serviceName} appointment with {data.businessName} has been cancelled.
                                Reference {data.bookingReference}.
                            </p>
                        </>
                    )}

                    {(phase === 'show' || phase === 'cancelling') && data && (
                        <>
                            <p className="text-xs uppercase tracking-wide text-slate-400">{data.businessName}</p>
                            <h1 className="text-xl font-semibold text-slate-900 mt-1">
                                Cancel this appointment?
                            </h1>
                            <div className="mt-4 rounded-lg bg-slate-50 border border-slate-200 px-4 py-3 text-sm">
                                <p className="text-slate-900 font-medium">{data.serviceName}</p>
                                <p className="text-slate-500 mt-1">
                                    {new Date(data.startTime).toLocaleString([], {
                                        weekday: 'short', month: 'short', day: 'numeric',
                                        hour: '2-digit', minute: '2-digit',
                                    })}
                                </p>
                                <p className="text-slate-400 text-xs mt-1">Ref: {data.bookingReference}</p>
                            </div>
                            <button
                                onClick={doCancel}
                                disabled={phase === 'cancelling'}
                                className="mt-5 w-full rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-medium py-3 transition-colors"
                            >
                                {phase === 'cancelling' ? 'Cancelling…' : 'Cancel Appointment'}
                            </button>
                            <p className="text-xs text-slate-400 mt-3 text-center">
                                Changed your mind? Just close this page — nothing happens.
                            </p>
                        </>
                    )}
                </div>
            </div>
        </main>
    );
}
