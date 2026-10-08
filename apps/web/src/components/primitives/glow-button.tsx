'use client';

import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type ReactNode } from 'react';
import Link from 'next/link';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@bookingflow/ui';

/**
 * The primary Bookly CTA. (The file keeps its historical name; the "glow"
 * is gone.)
 *
 * Forest ledger: primary is the flat forest brand (#2F5640) with cream
 * text and a 1px top highlight, 3px corners. The shadow is a short dropped
 * elevation, never a halo. Press nudges 1px down so it feels physical.
 */
const glowButtonStyles = cva(
    [
        'relative inline-flex items-center justify-center gap-2',
        'rounded font-display font-medium tracking-[-0.01em] whitespace-nowrap',
        'transition-[background-color,box-shadow,transform,color] duration-200 ease-[cubic-bezier(.2,.8,.2,1)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950',
        'disabled:pointer-events-none disabled:opacity-50',
        'active:translate-y-px',
    ].join(' '),
    {
        variants: {
            variant: {
                primary: [
                    'bg-forest-brand text-on-accent',
                    'shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_1px_2px_rgba(0,0,0,0.18)]',
                    'hover:bg-bookly-emerald-700 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_8px_22px_-8px_rgba(47,86,64,0.7)]',
                    'dark:bg-bookly-emerald-500 dark:hover:bg-bookly-emerald-600',
                ],
                ghost: [
                    'bg-transparent text-ink-50 shadow-[inset_0_0_0_1px_rgb(var(--ink-50-rgb)/0.25)]',
                    'hover:shadow-[inset_0_0_0_1px_rgb(var(--ink-50-rgb)/0.6)]',
                ],
                wa: [
                    'bg-[var(--wa-green)] text-[#0B130E]',
                    'shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_1px_2px_rgba(0,0,0,0.18)]',
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
