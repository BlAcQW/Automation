import Link from 'next/link';
import { Mail, Phone } from 'lucide-react';
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
            <Link href="/support" className={cn('font-semibold text-primary underline underline-offset-2 hover:text-primary-hover', className)}>
                Get help
            </Link>
        );
    }

    const base = inline
        ? 'inline-flex min-h-[44px] items-center gap-1.5 font-semibold text-primary underline underline-offset-2 hover:text-primary-hover'
        : 'inline-flex min-h-[44px] items-center gap-2 rounded-control border border-border bg-surface px-4 text-[15px] font-semibold text-text shadow-soft transition-colors duration-ui hover:border-text/30 hover:bg-surface-2';

    return (
        <div className={cn(inline ? 'inline-flex flex-wrap gap-x-4 gap-y-1' : 'flex flex-wrap gap-3', className)}>
            {wa && (
                <a href={wa} target="_blank" rel="noreferrer" className={base}>
                    <Phone className="h-4 w-4" aria-hidden />
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
