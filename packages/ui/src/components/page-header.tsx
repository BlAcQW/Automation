import { type ReactNode } from 'react';
import { cn } from '../cn';

interface PageHeaderProps {
    title: string;
    subtitle?: string;
    /** Right-aligned slot for primary actions (buttons, etc.). */
    actions?: ReactNode;
    className?: string;
    /** Small line above the title (breadcrumb / back link). */
    eyebrow?: ReactNode;
}

/**
 * The one page title per screen: Clash Display, 28 → 40px. Actions sit
 * right on desktop and wrap below on phones.
 */
export function PageHeader({ title, subtitle, actions, className, eyebrow }: PageHeaderProps) {
    return (
        <div className={cn('flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between', className)}>
            <div className="min-w-0">
                {eyebrow && <div className="mb-2 text-[14px] font-medium text-muted">{eyebrow}</div>}
                <h1 className="font-display text-page-title text-text">{title}</h1>
                {subtitle && <p className="mt-1.5 max-w-2xl text-base leading-relaxed text-muted">{subtitle}</p>}
            </div>
            {actions && <div className="flex flex-wrap items-center gap-2 sm:shrink-0">{actions}</div>}
        </div>
    );
}

interface SectionHeadingProps {
    title: string;
    description?: ReactNode;
    actions?: ReactNode;
    /** Heading level; defaults to h2. */
    as?: 'h2' | 'h3';
    className?: string;
}

/** Section heading inside a page: Bricolage 700, 20 → 24px. */
export function SectionHeading({ title, description, actions, as: Tag = 'h2', className }: SectionHeadingProps) {
    return (
        <div className={cn('flex flex-wrap items-end justify-between gap-3', className)}>
            <div className="min-w-0">
                <Tag className="text-section-heading text-text">{title}</Tag>
                {description && <p className="mt-1 text-[15px] text-muted">{description}</p>}
            </div>
            {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
    );
}
