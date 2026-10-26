import { AwningDivider } from '@bookingflow/ui';
import { SiteLogo } from './site-logo';

/**
 * Frame for the 404 and 500 pages: a calm cream page with one card under
 * the awning. Works for visitors and signed-in owners alike, so it carries
 * the logo only, not the marketing nav.
 */
export function StatusPage({ children }: { children: React.ReactNode }) {
    return (
        <main id="main" className="flex min-h-screen flex-col bg-bg px-4 py-6 text-text sm:px-8">
            <div className="mx-auto w-full max-w-xl">
                <SiteLogo size="md" />
            </div>
            <div className="mx-auto flex w-full max-w-xl flex-1 items-center py-10">
                <div className="w-full overflow-hidden rounded-card-lg border border-border bg-surface shadow-card-lg">
                    <AwningDivider tone="gold-green" size="lg" />
                    <div className="p-6 sm:p-10">{children}</div>
                </div>
            </div>
        </main>
    );
}
