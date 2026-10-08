import type { Metadata } from 'next';
import { Nav, Footer } from '@/components/marketing/site/chrome';
import { PageHero, Section } from '@/components/marketing/site/pieces';

export const metadata: Metadata = {
    title: 'Terms of Service | Bookly',
    description: 'Terms that govern your use of the Bookly platform.',
};

const LAST_UPDATED = 'May 14, 2026';
const CONTACT_EMAIL = 'support@bookly.ikieguy.online';

export default function TermsPage() {
    return (
        <main id="main" className="theme-site">
            <Nav />
            <PageHero eyebrow="Terms" title="Terms of Service" sub="Terms that govern your use of the Bookly platform." />

            <Section tint>
                <article className="mx-auto max-w-[68ch]">
                    <p className="fs-key">Last updated: {LAST_UPDATED}</p>

                    <Clause title="1. Acceptance">
                        <p>
                            By creating an account or using Bookly (the &ldquo;Service&rdquo;), you agree to be
                            bound by these Terms of Service. If you do not agree, do not use the Service.
                        </p>
                    </Clause>

                    <Clause title="2. Description of service">
                        <p>
                            Bookly is a Software-as-a-Service platform that lets businesses receive customer
                            bookings, orders, and conversations through WhatsApp Cloud API, with optional
                            integrations for payments (Paystack), calendars (Google, Outlook), SMS (Arkesel), and
                            email (Gmail SMTP).
                        </p>
                    </Clause>

                    <Clause title="3. Accounts">
                        <p>
                            You must provide accurate registration information and keep it current. You are
                            responsible for all activity that occurs under your account. Notify us immediately of any
                            unauthorized use.
                        </p>
                    </Clause>

                    <Clause title="4. Acceptable use">
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
                    </Clause>

                    <Clause title="5. WhatsApp Business Policy">
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
                    </Clause>

                    <Clause title="6. Subscription and payment">
                        <p>
                            The Service is offered on Free, Starter, and Pro plans with the limits described on our
                            pricing page. Paid plans are billed monthly via Paystack. You may cancel at any time;
                            cancellation takes effect at the end of the current billing period.
                        </p>
                        <p className="mt-3">
                            Per-customer payment processing (when your customers pay you via Paystack for bookings or
                            orders) is governed by Paystack&apos;s own terms. We do not handle card data.
                        </p>
                    </Clause>

                    <Clause title="7. Data ownership">
                        <p>
                            You retain all rights to your business data and your customer conversation data. We act
                            as a processor on your behalf. See our{' '}
                            <a className="underline" href="/privacy">Privacy Policy</a> for full details.
                        </p>
                    </Clause>

                    <Clause title="8. Service availability">
                        <p>
                            We aim for high availability but do not guarantee uninterrupted service. We may perform
                            maintenance, deploy updates, or experience downstream outages (Meta, Supabase, Paystack)
                            that affect the Service.
                        </p>
                    </Clause>

                    <Clause title="9. Disclaimer of warranties">
                        <p>
                            The Service is provided &ldquo;as is&rdquo; without warranties of any kind, express or
                            implied, including merchantability, fitness for a particular purpose, and
                            non-infringement.
                        </p>
                    </Clause>

                    <Clause title="10. Limitation of liability">
                        <p>
                            To the maximum extent permitted by law, Bookly&apos;s aggregate liability for any
                            claim arising out of these Terms or your use of the Service is limited to the total fees
                            you paid us in the 12 months preceding the claim.
                        </p>
                    </Clause>

                    <Clause title="11. Termination">
                        <p>
                            You may close your account at any time from the Settings page. We may terminate or
                            suspend your account immediately for breach of these Terms. Upon termination, your data
                            is retained as described in the Privacy Policy.
                        </p>
                    </Clause>

                    <Clause title="12. Changes to terms">
                        <p>
                            We may revise these Terms from time to time. Material changes will be announced by email.
                            Continued use after the effective date constitutes acceptance.
                        </p>
                    </Clause>

                    <Clause title="13. Contact">
                        <p>
                            Questions about these Terms can be sent to{' '}
                            <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
                        </p>
                    </Clause>
                </article>
            </Section>

            <Footer />
        </main>
    );
}

/** One numbered clause, set for long reading on the paper inset. */
function Clause({ title, id, children }: { title: string; id?: string; children: React.ReactNode }) {
    return (
        <section id={id} className="mt-10 scroll-mt-24 border-t pt-8" style={{ borderColor: 'var(--border)' }}>
            <h2 className="mb-4 text-[22px] font-normal leading-tight tracking-[-0.03em] sm:text-[26px]" style={{ color: 'var(--foreground)' }}>
                {title}
            </h2>
            <div
                className="space-y-3 text-[15px] leading-[1.7] [&_a]:underline [&_a]:underline-offset-2 [&_strong]:font-medium"
                style={{ color: 'color-mix(in srgb, var(--foreground) 86%, transparent)' }}
            >
                {children}
            </div>
        </section>
    );
}
