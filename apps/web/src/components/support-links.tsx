import Link from 'next/link';
import { Mail, MessageCircle } from 'lucide-react';
import { SUPPORT_EMAIL, hasSupportContact, supportMailto, supportWhatsAppUrl } from '@/lib/site';
import { cn } from '@/lib/cn';

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
            <Link href="/support" className={cn('text-bookly-emerald-400 hover:text-bookly-emerald-300 underline underline-offset-2', className)}>
                Get help
            </Link>
        );
    }

    const base = inline
        ? 'inline-flex items-center gap-1.5 text-bookly-emerald-400 hover:text-bookly-emerald-300 underline underline-offset-2'
        : 'inline-flex items-center gap-2 rounded-xl border border-ink-700 bg-ink-900 px-4 py-2.5 text-body-sm font-medium text-ink-50 hover:border-ink-600 hover:bg-ink-800 transition-colors';

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
