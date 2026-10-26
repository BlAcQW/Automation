'use client';

import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type ReactNode } from 'react';
import Link from 'next/link';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@bookingflow/ui';

/**
 * The primary Bookly CTA. (The file keeps its historical name; the "glow"
 * is gone.) Same look as `<Button>` from @bookingflow/ui: green, 12px
 * corners, warm shadow, scale 0.97 on press. Prefer `Button` in new code.
 */
const glowButtonStyles = cva(
    [
        'relative inline-flex items-center justify-center gap-2',
        'rounded-control font-sans font-semibold whitespace-nowrap',
        'transition-[background-color,box-shadow,transform,color] duration-ui ease-brand-out',
        'disabled:pointer-events-none disabled:opacity-50',
        'active:scale-[0.97] motion-reduce:active:scale-100',
    ].join(' '),
    {
        variants: {
            variant: {
                primary: 'bg-primary text-primary-fg shadow-soft hover:bg-primary-hover hover:shadow-card',
                ghost: 'border border-border bg-transparent text-text hover:border-text/30 hover:bg-surface-2',
                wa: 'bg-wa-green text-charcoal shadow-soft hover:brightness-105',
            },
            size: {
                sm: 'min-h-[44px] px-4 text-[15px]',
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
