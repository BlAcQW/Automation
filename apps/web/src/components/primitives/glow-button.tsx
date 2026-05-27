'use client';

import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type ReactNode } from 'react';
import Link from 'next/link';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

/**
 * GlowButton — ui.md §9.1. The signature Bookly CTA.
 *
 * Primary: emerald gradient with ink-1000 text (NOT white — spec is explicit
 * about contrast). On hover the shadow blooms to the emerald glow + a soft
 * inner light sweep travels across the surface. Press scales 0.98.
 */
const glowButtonStyles = cva(
    [
        'group relative inline-flex items-center justify-center gap-2 overflow-hidden',
        'rounded-xl font-display font-medium tracking-tight',
        'transition-all duration-200 ease-out',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bookly-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950',
        'disabled:pointer-events-none disabled:opacity-50',
        'active:scale-[0.98]',
    ].join(' '),
    {
        variants: {
            variant: {
                primary: [
                    'bg-gradient-to-br from-bookly-emerald-500 to-bookly-emerald-600',
                    'text-ink-1000 shadow-[0_0_30px_rgba(16,185,129,0.35)]',
                    'hover:shadow-[0_0_50px_rgba(16,185,129,0.5)] hover:brightness-105',
                ],
                ghost: [
                    'bg-transparent text-ink-50 border border-ink-700',
                    'hover:border-ink-600 hover:bg-ink-900/60',
                ],
                wa: [
                    'bg-[var(--wa-green)] text-ink-1000',
                    'hover:brightness-110',
                ],
            },
            size: {
                sm: 'h-9 px-4 text-sm',
                md: 'h-12 px-6 text-[15px]',
                lg: 'h-14 px-8 text-base',
            },
        },
        defaultVariants: { variant: 'primary', size: 'md' },
    },
);

export type GlowButtonVariants = VariantProps<typeof glowButtonStyles>;

interface BaseGlowButtonProps extends GlowButtonVariants {
    children: ReactNode;
    className?: string;
}

interface GlowButtonAsButton extends BaseGlowButtonProps,
    Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className'> {
    href?: undefined;
}

interface GlowButtonAsLink extends BaseGlowButtonProps,
    Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'children' | 'className' | 'href'> {
    href: string;
}

export type GlowButtonProps = GlowButtonAsButton | GlowButtonAsLink;

function LightSweep() {
    return (
        <span
            aria-hidden
            className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-[1200ms] ease-out group-hover:translate-x-full"
        />
    );
}

export const GlowButton = forwardRef<HTMLButtonElement | HTMLAnchorElement, GlowButtonProps>(
    function GlowButton(props, ref) {
        const styles = cn(glowButtonStyles({ variant: props.variant, size: props.size }), props.className);

        if (props.href !== undefined) {
            const { children, className: _c, variant: _v, size: _s, href, ...anchorProps } = props;
            return (
                <Link
                    href={href}
                    className={styles}
                    ref={ref as React.Ref<HTMLAnchorElement>}
                    {...anchorProps}
                >
                    <LightSweep />
                    <span className="relative inline-flex items-center gap-2">{children}</span>
                </Link>
            );
        }

        const { children, className: _c, variant: _v, size: _s, ...buttonProps } = props;
        return (
            <button
                className={styles}
                ref={ref as React.Ref<HTMLButtonElement>}
                {...buttonProps}
            >
                <LightSweep />
                <span className="relative inline-flex items-center gap-2">{children}</span>
            </button>
        );
    },
);
