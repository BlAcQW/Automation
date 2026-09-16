'use client';

import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type ReactNode } from 'react';
import Link from 'next/link';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

/**
 * The primary Bookly CTA. (The file keeps its historical name; the "glow"
 * is gone.)
 *
 * Primary is a flat emerald with dark text: emerald-500 on ink text is
 * ~9:1, white text on it would be ~2.4:1. The shadow is a short, tinted
 * elevation, not a halo. Press scales 0.98 so the button feels physical.
 */
const glowButtonStyles = cva(
    [
        'relative inline-flex items-center justify-center gap-2',
        'rounded-xl font-display font-medium tracking-tight',
        'transition-[background-color,box-shadow,transform,border-color] duration-200 ease-out',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bookly-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950',
        'disabled:pointer-events-none disabled:opacity-50',
        'active:scale-[0.98]',
    ].join(' '),
    {
        variants: {
            variant: {
                primary: [
                    'bg-bookly-emerald-500 text-on-accent',
                    'shadow-[0_6px_20px_-8px_rgba(16,185,129,0.55)]',
                    'hover:bg-bookly-emerald-400',
                ],
                ghost: [
                    'bg-transparent text-ink-50 border border-ink-700',
                    'hover:border-ink-600 hover:bg-ink-900/60',
                ],
                wa: [
                    'bg-[var(--wa-green)] text-on-accent',
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
                    <span className="inline-flex items-center gap-2">{children}</span>
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
                <span className="inline-flex items-center gap-2">{children}</span>
            </button>
        );
    },
);
