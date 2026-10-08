import Link from 'next/link';
import { Mail, MessageCircle } from 'lucide-react';
import { SUPPORT_EMAIL, hasSupportContact, supportMailto, supportWhatsAppUrl } from '@/lib/site';
import { cn } from '@bookingflow/ui';

interface Props {
    /** Prefilled subject / opening line. */
    topic?: string;
    className?: string;
    /** Compact inline links instead of buttons. */
    inline?: boolean;
}

/**
 * The one way to reach a person, rendered the same everywhere: footer, 404,
 * error page, Settings, Templates. Reads the contact from env; if neither a
 * WhatsApp number nor an email is configured it links to /support, which
 * explains that too, so the button is never a dead end.
 */
export function SupportLinks({ topic, className, inline }: Props) {
    const wa = supportWhatsAppUrl(topic ? `Hi Bookly, ${topic}` : undefined);
    const mail = supportMailto(topic);

    if (!hasSupportContact) {
        return (
            <Link href="/support" className={cn('text-forest-brand hover:text-bookly-emerald-800 dark:text-bookly-emerald-300 dark:hover:text-bookly-emerald-200 underline underline-offset-2', className)}>
                Get help
            </Link>
        );
    }

    const base = inline
        ? 'inline-flex items-center gap-1.5 text-forest-brand hover:text-bookly-emerald-800 dark:text-bookly-emerald-300 dark:hover:text-bookly-emerald-200 underline underline-offset-2'
        : 'inline-flex min-h-[44px] items-center gap-2 rounded bg-white dark:bg-ink-800 px-4 text-sm font-medium tracking-[-0.01em] text-ink-50 shadow-[0_0_0_1px_rgb(var(--ink-50-rgb)/0.1),0_1px_2px_rgba(0,0,0,0.06)] hover:shadow-[0_0_0_1px_rgb(var(--ink-50-rgb)/0.18),0_8px_22px_-12px_rgba(0,0,0,0.35)] dark:hover:bg-ink-700 transition-[box-shadow,background-color]';

    return (
        <div className={cn(inline ? 'inline-flex flex-wrap gap-x-4 gap-y-1' : 'flex flex-wrap gap-3', className)}>
            {wa && (
                <a href={wa} target="_blank" rel="noreferrer" className={base}>
                    <MessageCircle className="h-4 w-4" aria-hidden />
                    Message us on WhatsApp
                </a>
            )}
            {mail && (
                <a href={mail} className={base}>
                    <Mail className="h-4 w-4" aria-hidden />
                    {inline ? 'Email support' : SUPPORT_EMAIL}
                </a>
            )}
        </div>
    );
}
