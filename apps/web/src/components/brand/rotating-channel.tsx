'use client';

import { useEffect, useState } from 'react';

const CHANNELS = ['WhatsApp', 'Instagram', 'Messenger'] as const;
const INTERVAL_MS = 2200;

/**
 * "WhatsApp" that turns into "Instagram", then "Messenger", then back.
 *
 * Renders "WhatsApp" on the server and when motion is reduced, so the line
 * always reads. Screen readers get all three once, not a word that keeps
 * changing under them.
 */
export function RotatingChannel({ className }: { className?: string }) {
    const [index, setIndex] = useState(0);

    useEffect(() => {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        const id = setInterval(() => setIndex((i) => (i + 1) % CHANNELS.length), INTERVAL_MS);
        return () => clearInterval(id);
    }, []);

    return (
        <span className={className}>
            <span aria-hidden key={index} className="rotating-word inline-block">
                {CHANNELS[index]}
            </span>
            <span className="sr-only">WhatsApp, Instagram and Messenger</span>
        </span>
    );
}
