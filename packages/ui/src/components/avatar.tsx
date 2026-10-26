'use client';

import { useState } from 'react';
import { cn } from '../cn';

interface AvatarProps {
    name?: string | null;
    /** Optional image URL; falls back to brand initials if absent or it fails to load. */
    src?: string | null;
    size?: 'sm' | 'md' | 'lg' | 'xl';
    className?: string;
    status?: 'online' | 'offline' | 'busy';
}

const sizeClasses = {
    sm: 'w-8 h-8 text-xs',
    md: 'w-10 h-10 text-sm',
    lg: 'w-12 h-12 text-base',
    xl: 'w-14 h-14 text-lg',
};

const statusClasses = {
    online: 'bg-success',
    offline: 'bg-muted',
    busy: 'bg-warning',
};

const statusSizeClasses = {
    sm: 'w-2.5 h-2.5 border-[1.5px]',
    md: 'w-3 h-3 border-2',
    lg: 'w-3.5 h-3.5 border-2',
    xl: 'w-4 h-4 border-2',
};

export function Avatar({ name, src, size = 'md', className, status }: AvatarProps) {
    const [imgFailed, setImgFailed] = useState(false);
    const initials = name
        ? name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
        : '?';
    const showImage = src && !imgFailed;

    return (
        <div className={cn('relative inline-flex shrink-0', className)}>
            {showImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                    src={src}
                    alt={name ?? 'Avatar'}
                    onError={() => setImgFailed(true)}
                    className={cn('rounded-full object-cover ring-1 ring-border', sizeClasses[size])}
                />
            ) : (
                <div
                    className={cn(
                        'bg-primary rounded-full flex items-center justify-center font-semibold text-primary-fg',
                        sizeClasses[size],
                    )}
                >
                    {initials}
                </div>
            )}
            {status && (
                <span
                    className={cn(
                        'absolute -bottom-0.5 -right-0.5 rounded-full border-surface',
                        statusClasses[status],
                        statusSizeClasses[size],
                    )}
                />
            )}
        </div>
    );
}
