import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Privacy Policy — BookingFlow',
    description: 'How BookingFlow collects, uses, and protects your data.',
};

const LAST_UPDATED = 'May 14, 2026';
const CONTACT_EMAIL = 'support@bookly.ikieguy.online';

export default function PrivacyPolicyPage() {
    return (
        <main className="mx-auto max-w-3xl px-6 py-12 text-slate-800 dark:text-slate-200">
            <h1 className="text-3xl font-semibold mb-2">Privacy Policy</h1>
            <p className="text-sm text-slate-500 mb-8">Last updated: {LAST_UPDATED}</p>

            <Section title="1. Who we are">
                <p>
                    BookingFlow (&ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;our&rdquo;) provides a multi-tenant
                    Software-as-a-Service platform that enables small and medium businesses to manage customer
                    bookings, orders, and conversations over WhatsApp. This policy explains what personal data we
                    collect when you use our platform, how we use it, and the rights you have over it.
                </p>
                <p>
                    For any privacy-related question, contact us at{' '}
                    <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
                </p>
            </Section>

            <Section title="2. Data we collect">
                <p>We collect only the data needed to operate the service. Specifically:</p>
                <ul className="list-disc pl-6 space-y-2 mt-3">
                    <li>
                        <strong>Account data</strong> — the business owner&apos;s name, email address, hashed
                        password, and business name when they register.
                    </li>
                    <li>
                        <strong>WhatsApp Business credentials</strong> — when a business connects their WhatsApp
                        Cloud API account via Meta&apos;s Embedded Signup flow, we receive and store
                        (encrypted at rest) their WhatsApp Business Account ID, phone number ID, display phone
                        number, and an access token. These credentials are used solely to send and receive
                        messages on the business&apos;s behalf.
                    </li>
                    <li>
                        <strong>Customer conversations</strong> — when an end-customer messages a business
                        through our platform, we store the customer&apos;s phone number, the contents of the
                        messages exchanged, and timestamps. This data is the property of the business that
                        owns the WhatsApp number.
                    </li>
                    <li>
                        <strong>Bookings &amp; orders</strong> — customer name, phone number, selected service
                        or product, scheduled time, and (where applicable) delivery address and payment
                        reference.
                    </li>
                    <li>
                        <strong>Payment information</strong> — payment processing is handled by Paystack
                        (https://paystack.com). We do not store card numbers, CVVs, or full bank details. We
                        store only the Paystack transaction reference and the high-level result (status,
                        amount, currency).
                    </li>
                    <li>
                        <strong>Operational metadata</strong> — IP addresses, request timestamps, and audit
                        log entries needed for security monitoring and dispute resolution.
                    </li>
                </ul>
            </Section>

            <Section title="3. How we use your data">
                <ul className="list-disc pl-6 space-y-2">
                    <li>To operate the platform: send and receive WhatsApp messages, create bookings, process orders.</li>
                    <li>To send appointment reminders and order updates via WhatsApp, SMS, or email.</li>
                    <li>To enforce subscription quotas and billing.</li>
                    <li>To detect abuse, fraud, and security incidents.</li>
                    <li>To respond to support requests.</li>
                </ul>
                <p className="mt-3">
                    We do <strong>not</strong> sell your personal data. We do not use customer conversation
                    contents to train machine-learning models.
                </p>
            </Section>

            <Section title="4. Third parties">
                <p>We share data with the following processors strictly for the purposes listed:</p>
                <ul className="list-disc pl-6 space-y-2 mt-3">
                    <li><strong>Meta Platforms (WhatsApp Cloud API)</strong> — to deliver and receive WhatsApp messages on behalf of connected businesses.</li>
                    <li><strong>Paystack</strong> — to process customer payments and platform subscription billing.</li>
                    <li><strong>Supabase</strong> — hosts our PostgreSQL database; data is encrypted in transit and at rest.</li>
                    <li><strong>Google Calendar &amp; Microsoft Outlook</strong> (optional, per-business) — to sync bookings into the business&apos;s own calendar when they connect those integrations.</li>
                    <li><strong>Arkesel</strong> (optional) — used as an SMS fallback when WhatsApp delivery fails.</li>
                    <li><strong>Gmail SMTP</strong> (optional) — used as an email fallback when WhatsApp and SMS delivery both fail.</li>
                </ul>
            </Section>

            <Section title="5. Data retention">
                <p>
                    Account, conversation, booking, and order data are retained while the business&apos;s
                    account is active and for up to 12 months after account closure, after which they are
                    permanently deleted. Audit log entries are retained for 24 months for security and
                    compliance purposes.
                </p>
                <p className="mt-3">
                    A business may request deletion of all their data at any time by emailing{' '}
                    <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. Deletion is
                    completed within 30 days.
                </p>
            </Section>

            <Section title="6. Your rights">
                <p>You have the right to:</p>
                <ul className="list-disc pl-6 space-y-2 mt-3">
                    <li>Access the personal data we hold about you.</li>
                    <li>Request correction of inaccurate data.</li>
                    <li>Request deletion of your data (subject to legal retention obligations).</li>
                    <li>Object to or restrict certain processing.</li>
                    <li>Withdraw consent for optional integrations (calendar, SMS fallback) at any time.</li>
                </ul>
                <p className="mt-3">
                    Exercise any of these rights by emailing{' '}
                    <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
                </p>
            </Section>

            <Section title="7. Security">
                <p>
                    All data is transmitted over HTTPS. Stored secrets (WhatsApp access tokens, OAuth tokens,
                    Paystack keys, Gmail app passwords) are encrypted at rest using AES-256-GCM. Database
                    connections require TLS. Access to production data is limited to authorized engineering
                    staff.
                </p>
            </Section>

            <Section title="8. Children">
                <p>
                    BookingFlow is intended for use by businesses and adult consumers. We do not knowingly
                    collect data from anyone under 13 years of age. If you believe we have inadvertently
                    collected such data, contact us and we will delete it.
                </p>
            </Section>

            <Section title="9. Changes to this policy">
                <p>
                    We may update this policy from time to time. Material changes will be announced via email
                    to registered business owners. The &ldquo;Last updated&rdquo; date at the top of this page
                    always reflects the current version.
                </p>
            </Section>

            <Section title="10. Contact">
                <p>
                    For any privacy concern, complaint, or data-subject request, email{' '}
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
