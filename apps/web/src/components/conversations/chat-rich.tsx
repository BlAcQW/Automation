'use client';

import { MapPin, Phone, User } from 'lucide-react';
import type { Message } from './types';

/** Shared card shape for location and contact messages. */
function Card({
    icon,
    title,
    subtitle,
    href,
}: {
    icon: React.ReactNode;
    title: string;
    subtitle?: string;
    href?: string;
}) {
    const inner = (
        <div className="flex items-center gap-3 py-1 min-w-[190px]">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black/10 dark:bg-white/10">
                {icon}
            </div>
            <div className="min-w-0">
                <div className="truncate text-sm font-medium">{title}</div>
                {subtitle ? <div className="truncate text-xs opacity-70">{subtitle}</div> : null}
            </div>
        </div>
    );

    return href ? (
        <a href={href} target="_blank" rel="noreferrer" className="block hover:opacity-80">
            {inner}
        </a>
    ) : (
        inner
    );
}

export function ChatLocation({ message }: { message: Message }) {
    const { latitude, longitude, name, address } = message.metadata ?? {};
    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
        return <span className="text-sm opacity-70">Location</span>;
    }

    return (
        <Card
            icon={<MapPin className="w-4 h-4" />}
            title={name || 'Shared location'}
            subtitle={address || `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`}
            // Deep link rather than an embedded map — no API key, no tracking.
            href={`https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`}
        />
    );
}

export function ChatContact({ message }: { message: Message }) {
    const meta = message.metadata ?? {};
    const first = meta.contacts?.[0];
    const name = first?.name?.formatted_name ?? meta.name ?? message.content;
    const phone = first?.phones?.[0]?.phone ?? meta.phone;

    return (
        <Card
            icon={phone ? <Phone className="w-4 h-4" /> : <User className="w-4 h-4" />}
            title={name || 'Contact'}
            subtitle={phone}
            href={phone ? `tel:${phone}` : undefined}
        />
    );
}
