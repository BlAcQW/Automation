import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Terms of Service — Bookly',
    description: 'Terms that govern your use of the Bookly platform.',
};

const LAST_UPDATED = 'May 14, 2026';
const CONTACT_EMAIL = 'support@bookly.ikieguy.online';

export default function TermsPage() {
    return (
        <main className="mx-auto max-w-3xl px-6 py-12 text-slate-800 dark:text-slate-200">
            <h1 className="text-3xl font-semibold mb-2">Terms of Service</h1>
            <p className="text-sm text-slate-500 mb-8">Last updated: {LAST_UPDATED}</p>

            <Section title="1. Acceptance">
                <p>
                    By creating an account or using Bookly (the &ldquo;Service&rdquo;), you agree to be
                    bound by these Terms of Service. If you do not agree, do not use the Service.
                </p>
            </Section>

            <Section title="2. Description of service">
                <p>
                    Bookly is a Software-as-a-Service platform that lets businesses receive customer
                    bookings, orders, and conversations through WhatsApp Cloud API, with optional
                    integrations for payments (Paystack), calendars (Google, Outlook), SMS (Arkesel), and
                    email (Gmail SMTP).
                </p>
            </Section>

            <Section title="3. Accounts">
                <p>
                    You must provide accurate registration information and keep it current. You are
                    responsible for all activity that occurs under your account. Notify us immediately of any
                    unauthorized use.
                </p>
            </Section>

            <Section title="4. Acceptable use">
                <p>You agree not to use the Service to:</p>
                <ul className="list-disc pl-6 space-y-2 mt-3">
                    <li>Send unsolicited bulk messages (spam), in violation of WhatsApp&apos;s Business Messaging Policy.</li>
                    <li>Send messages that violate Meta&apos;s Commerce or Community Standards.</li>
                    <li>Impersonate any person or entity.</li>
                    <li>Attempt to gain unauthorized access to other accounts or systems.</li>
                    <li>Use the Service for any illegal activity.</li>
                </ul>
                <p className="mt-3">
                    Accounts found in violation may be suspended or terminated without notice. We may also
                    cooperate with law enforcement when required.
                </p>
            </Section>

            <Section title="5. WhatsApp Business Policy">
                <p>
                    Your use of the WhatsApp integration is also subject to{' '}
                    <a className="underline" href="https://business.whatsapp.com/policy" target="_blank" rel="noreferrer">
                        WhatsApp&apos;s Business Messaging Policy
                    </a>{' '}
                    and{' '}
                    <a className="underline" href="https://www.whatsapp.com/legal/business-terms" target="_blank" rel="noreferrer">
                        WhatsApp Business Terms of Service
                    </a>. You are responsible for ensuring that messages sent through the Service comply with
                    those policies, including obtaining customer opt-in where required.
                </p>
            </Section>

            <Section title="6. Subscription and payment">
                <p>
                    The Service is offered on Free, Starter, and Pro plans with the limits described on our
                    pricing page. Paid plans are billed monthly via Paystack. You may cancel at any time;
                    cancellation takes effect at the end of the current billing period.
                </p>
                <p className="mt-3">
                    Per-customer payment processing (when your customers pay you via Paystack for bookings or
                    orders) is governed by Paystack&apos;s own terms. We do not handle card data.
                </p>
            </Section>

            <Section title="7. Data ownership">
                <p>
                    You retain all rights to your business data and your customer conversation data. We act
                    as a processor on your behalf. See our{' '}
                    <a className="underline" href="/privacy">Privacy Policy</a> for full details.
                </p>
            </Section>

            <Section title="8. Service availability">
                <p>
                    We aim for high availability but do not guarantee uninterrupted service. We may perform
                    maintenance, deploy updates, or experience downstream outages (Meta, Supabase, Paystack)
                    that affect the Service.
                </p>
            </Section>

            <Section title="9. Disclaimer of warranties">
                <p>
                    The Service is provided &ldquo;as is&rdquo; without warranties of any kind, express or
                    implied, including merchantability, fitness for a particular purpose, and
                    non-infringement.
                </p>
            </Section>

            <Section title="10. Limitation of liability">
                <p>
                    To the maximum extent permitted by law, Bookly&apos;s aggregate liability for any
                    claim arising out of these Terms or your use of the Service is limited to the total fees
                    you paid us in the 12 months preceding the claim.
                </p>
            </Section>

            <Section title="11. Termination">
                <p>
                    You may close your account at any time from the Settings page. We may terminate or
                    suspend your account immediately for breach of these Terms. Upon termination, your data
                    is retained as described in the Privacy Policy.
                </p>
            </Section>

            <Section title="12. Changes to terms">
                <p>
                    We may revise these Terms from time to time. Material changes will be announced by email.
                    Continued use after the effective date constitutes acceptance.
                </p>
            </Section>

            <Section title="13. Contact">
                <p>
                    Questions about these Terms can be sent to{' '}
                    <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
                </p>
            </Section>
        </main>
    );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section className="mb-8">
            <h2 className="text-xl font-semibold mb-3">{title}</h2>
            <div className="space-y-3 leading-relaxed">{children}</div>
        </section>
    );
}
