import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Privacy Policy | Bookly',
    description: 'How Bookly collects, uses, and protects your data.',
};

const LAST_UPDATED = 'October 6, 2026';
const CONTACT_EMAIL = 'support@bookly.ikieguy.online';

export default function PrivacyPolicyPage() {
    return (
        <main className="mx-auto max-w-3xl px-6 py-12 text-slate-800 dark:text-slate-200">
            <h1 className="text-3xl font-semibold mb-2">Privacy Policy</h1>
            <p className="text-sm text-slate-500 mb-8">Last updated: {LAST_UPDATED}</p>

            <Section title="1. Who we are">
                <p>
                    Bookly (&ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;our&rdquo;) provides a multi-tenant
                    Software-as-a-Service platform that enables small and medium businesses to manage customer
                    bookings, orders, and conversations over WhatsApp, Instagram Direct Messages, and Facebook
                    Messenger. This policy explains what personal data we collect when you use our platform, how
                    we use it, and the rights you have over it.
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
                        <strong>Account data</strong>: the business owner&apos;s name, email address, hashed
                        password, and business name when they register.
                    </li>
                    <li>
                        <strong>WhatsApp Business credentials</strong>: when a business connects their WhatsApp
                        Cloud API account via Meta&apos;s Embedded Signup flow, we receive and store
                        (encrypted at rest) their WhatsApp Business Account ID, phone number ID, display phone
                        number, and an access token. These credentials are used solely to send and receive
                        messages on the business&apos;s behalf.
                    </li>
                    <li>
                        <strong>Facebook Page and Instagram credentials</strong>: when a business connects
                        Instagram or Messenger through the Facebook Login consent screen, we receive and store
                        the ID and name of the Facebook Page they choose, the ID and username of the Instagram
                        professional account linked to that Page, and a Page access token (encrypted at rest).
                        We request only the permissions needed to receive and reply to messages:
                        pages_messaging, instagram_manage_messages, instagram_basic, pages_show_list, and
                        pages_manage_metadata. We do not read posts, comments, followers, or advertising data.
                    </li>
                    <li>
                        <strong>Customer conversations</strong>: when an end-customer messages a business
                        through our platform, we store the contents of the messages exchanged and timestamps,
                        together with the identifier the channel gives us: the phone number and WhatsApp
                        profile name on WhatsApp; on Instagram, the Instagram-scoped user ID and, where Meta
                        provides it, the @username and profile name; on Messenger, the Page-scoped user ID and
                        profile name. Instagram and Messenger do not give us the customer&apos;s phone number;
                        we only hold one if the customer types it into the conversation. This data is the
                        property of the business the customer is messaging.
                    </li>
                    <li>
                        <strong>Bookings &amp; orders</strong>: customer name, phone number, selected service
                        or product, scheduled time, and (where applicable) delivery address and payment
                        reference.
                    </li>
                    <li>
                        <strong>Payment information</strong>: payment processing is handled by Paystack
                        (https://paystack.com). We do not store card numbers, CVVs, or full bank details. We
                        store only the Paystack transaction reference and the high-level result (status,
                        amount, currency).
                    </li>
                    <li>
                        <strong>Operational metadata</strong>: IP addresses, request timestamps, and audit
                        log entries needed for security monitoring and dispute resolution.
                    </li>
                </ul>
            </Section>

            <Section title="3. How we use your data">
                <ul className="list-disc pl-6 space-y-2">
                    <li>To operate the platform: send and receive messages on WhatsApp, Instagram, and Messenger on the business&apos;s behalf, create bookings, process orders and ride or package purchases.</li>
                    <li>To let a business&apos;s automated assistant understand and answer its customers&apos; messages (where the business has turned the assistant on).</li>
                    <li>To send appointment reminders and order updates via WhatsApp, SMS, or email.</li>
                    <li>To enforce subscription quotas and billing.</li>
                    <li>To detect abuse, fraud, and security incidents.</li>
                    <li>To respond to support requests.</li>
                </ul>
                <p className="mt-3">
                    We do <strong>not</strong> sell your personal data. We do not use customer conversation
                    contents to train machine-learning models, and we do not use data received from Meta for
                    advertising, profiling, or any purpose other than answering the conversation it came from.
                </p>
            </Section>

            <Section title="4. Third parties">
                <p>We share data with the following processors strictly for the purposes listed:</p>
                <ul className="list-disc pl-6 space-y-2 mt-3">
                    <li><strong>Meta Platforms (WhatsApp Cloud API, Instagram Messaging API, Messenger Platform)</strong>: to deliver and receive messages on behalf of connected businesses.</li>
                    <li><strong>OpenAI</strong> (only for businesses that turn on the AI assistant): the text of a customer&apos;s message and the business&apos;s services and opening times are sent to OpenAI&apos;s API to compose a reply. Under OpenAI&apos;s API terms this data is not used to train their models. Businesses using a scripted assistant send nothing to OpenAI.</li>
                    <li><strong>Sentry</strong>: error monitoring; error reports exclude message contents and secrets.</li>
                    <li><strong>A business&apos;s own systems</strong> (optional, per-business): a business may connect its own application through our API or webhooks; conversation and booking data for that business is then shared with the application it chose.</li>
                    <li><strong>Paystack</strong>: to process customer payments and platform subscription billing.</li>
                    <li><strong>Supabase</strong>: hosts our PostgreSQL database; data is encrypted in transit and at rest.</li>
                    <li><strong>Google Calendar &amp; Microsoft Outlook</strong> (optional, per-business): to sync bookings into the business&apos;s own calendar when they connect those integrations.</li>
                    <li><strong>Arkesel</strong> (optional): used as an SMS fallback when WhatsApp delivery fails.</li>
                    <li><strong>Gmail SMTP</strong> (optional): used as an email fallback when WhatsApp and SMS delivery both fail.</li>
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

            <Section title="5a. Deleting data received from Facebook and Instagram" id="data-deletion">
                <p>
                    <strong>Businesses</strong>: open Bookly &rarr; Channels and choose Disconnect on Facebook &amp;
                    Instagram. We immediately stop receiving messages and delete the stored Page access token.
                    You can also remove Bookly from Facebook (Settings &amp; privacy &rarr; Settings &rarr; Business
                    integrations). To delete the stored conversations as well, email{' '}
                    <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> from the account
                    owner&apos;s address; we confirm and complete deletion within 30 days.
                </p>
                <p>
                    <strong>Customers</strong> who messaged a business on Instagram or Messenger: email{' '}
                    <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> with the name of
                    the business and your Instagram username or Facebook name, and we delete your conversations
                    and identifiers within 30 days, telling the business it has been done.
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
                    Facebook Page tokens, Paystack keys, Gmail app passwords) are encrypted at rest using AES-256-GCM. Database
                    connections require TLS. Access to production data is limited to authorized engineering
                    staff.
                </p>
            </Section>

            <Section title="8. Children">
                <p>
                    Bookly is intended for use by businesses and adult consumers. We do not knowingly
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

function Section({ title, id, children }: { title: string; id?: string; children: React.ReactNode }) {
    return (
        <section id={id} className="mb-8 scroll-mt-8">
            <h2 className="text-xl font-semibold mb-3">{title}</h2>
            <div className="space-y-3 leading-relaxed">{children}</div>
        </section>
    );
}
