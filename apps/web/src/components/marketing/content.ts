import {
    BellRing, CalendarCheck, Clock3, Instagram, MessageCircle, ShieldCheck, Smartphone, Store, Users, Wallet,
    type LucideIcon,
} from 'lucide-react';
import { REGISTRATION_OPEN } from '@/lib/feature-flags';

/**
 * Marketing copy shared across pages. Only things Bookly really does today.
 * No customer counts, no testimonials, no invented prices: there is a free
 * way to start and the paid prices are "coming soon".
 */

export interface Job { icon: LucideIcon; title: string; body: string }

export const JOBS: readonly Job[] = [
    { icon: MessageCircle, title: 'Answers while you work', body: "Replies in seconds, at any hour, so the booking doesn't go to the shop down the road." },
    { icon: CalendarCheck, title: 'Only offers real free times', body: 'Checks your hours, your days off, your bookings and how many customers you take at once.' },
    { icon: Wallet, title: 'Takes the deposit up front', body: 'Mobile Money or card. The slot is held for 30 minutes and let go if nobody pays.' },
    { icon: BellRing, title: 'Reminds them before the day', body: 'A friendly reminder is the biggest reason a deposit turns into a customer at your door.' },
    { icon: Users, title: 'Keeps one diary', body: 'Replaces the notebook and the "I think I have someone at two".' },
    { icon: Instagram, title: 'Answers where you advertise', body: 'Instagram and Messenger too. One assistant and one diary behind all three.' },
    { icon: ShieldCheck, title: 'Keeps your customer list yours', body: 'Staff see only the last four digits of a number. They can work; they cannot copy your book.' },
];

export const STEPS = [
    { title: 'Connect your WhatsApp', body: 'One guided step. No code and nothing to copy and paste.' },
    { title: 'Add your services and hours', body: 'What you do, what it costs and when you are open.' },
    { title: 'Share your number', body: 'Put it in your Instagram bio and your status. Bookly takes it from there.' },
] as const;

export const LEAKS = [
    {
        icon: Clock3,
        title: "You're busy and the phone buzzes",
        body: "You're with a client and can't reply. By the time you do, they've booked somewhere else, and you never see the ones you lost.",
    },
    {
        icon: Store,
        title: 'They book, then never come',
        body: 'Three no-shows a week on a GH₵ 800 treatment is over GH₵ 10,000 a month gone, with the room sitting empty.',
    },
] as const;

/** Other tools ask you to … / With Bookly … */
export const COMPARISON = [
    ['Open a payment gateway account', 'We handle it'],
    ['Find and paste a secret API key', 'Nothing to paste'],
    ['Open an SMS gateway account', 'We handle it'],
    ['Work out message templates', 'Already set up'],
    ['Wire up a webhook', 'Nothing to wire'],
] as const;

export const NO_SETUP_POINTS = [
    'Customers pay through us, by Mobile Money or card',
    'Send your money to your own MoMo whenever you want',
    'Text reminders go out on our account, not yours',
    'Nothing to sign up for, nothing to copy and paste',
] as const;

/** Real integrations only: every one of these is wired up. */
export const WORKS_WITH = ['WhatsApp', 'Instagram', 'Messenger', 'Paystack', 'Mobile Money', 'Google Calendar', 'SMS'] as const;

export const CHANNELS = [
    { icon: MessageCircle, name: 'WhatsApp', body: 'Bookings, deposits and reminders, on the number your customers already have.' },
    { icon: Instagram, name: 'Instagram', body: 'Answers the DMs your posts already bring in.' },
    { icon: Smartphone, name: 'Messenger', body: 'Answers messages sent to your Facebook Page.' },
] as const;

/* ------------------------------------------------------------------ */
/* Questions                                                           */
/* ------------------------------------------------------------------ */

export interface QA { q: string; a: string }

export const FAQ_GROUPS: readonly { title: string; items: readonly QA[] }[] = [
    {
        title: 'Using it',
        items: [
            { q: 'Do my customers need an app?', a: 'No. They use WhatsApp or Instagram exactly as they already do. That is the whole point.' },
            { q: 'Can I still reply myself?', a: 'Any time. Open the chat and type. Bookly steps back and waits until you hand the chat back.' },
            { q: 'What kind of business is it for?', a: 'Anything booked by appointment: skin and aesthetics clinics, spas, dental clinics, tailors, private chefs, photographers, pilates studios, car detailers, salons and more.' },
        ],
    },
    {
        title: 'Money',
        items: [
            { q: 'How do I get paid?', a: 'Customers pay through Bookly and your earnings show up in your account. Send them to your Mobile Money whenever you like.' },
            { q: 'Do I need a Paystack account?', a: 'No. That is the step we removed. You only give us the Mobile Money number you want to be paid on.' },
            { q: 'What if someone cancels?', a: 'The deposit stays with you, because that is what holding the slot is worth. If they just want a different time they reschedule, and their deposit moves with them.' },
        ],
    },
    {
        title: 'Your team',
        items: [
            { q: 'Can my staff see customer numbers?', a: 'Only the last four digits. They can reply and work normally, but they cannot copy your customer list. You see everything.' },
            { q: 'Can staff withdraw money?', a: 'Never. Moving money out is for the owner only, and the app enforces it rather than just hiding a button.' },
        ],
    },
];

// While sign-up is closed (lib/feature-flags.ts) the answers point at the waitlist.
export const PRICING_FAQ: readonly QA[] = [
    {
        q: 'How much does Bookly cost?',
        a: REGISTRATION_OPEN
            ? "We're still setting the prices for Solo, Team and Enterprise. You can start free today, with no card."
            : "We're still setting the prices for Solo, Team and Enterprise. For now we're letting businesses in a few at a time from the waitlist.",
    },
    { q: 'Do I pay for WhatsApp messages?', a: "You pay Meta's own WhatsApp message rates directly. We add nothing on top. Instagram and Messenger cost nothing at all." },
    {
        q: 'Do I need a card to start?',
        a: REGISTRATION_OPEN
            ? 'No. Sign up, connect your WhatsApp and take your first booking without a card.'
            : "No. When it's your turn on the waitlist, sign up, connect your WhatsApp and take your first booking without a card.",
    },
];

/* ------------------------------------------------------------------ */
/* Business types (landing pages at /for/*)                            */
/* ------------------------------------------------------------------ */

export interface BusinessType {
    slug: 'salons' | 'boutiques' | 'food-vendors';
    path: string;
    name: string;
    short: string;
    blurb: string;
}

export const BUSINESS_TYPES: readonly BusinessType[] = [
    { slug: 'salons', path: '/for/salons', name: 'Salons and barbers', short: 'Salons', blurb: 'Braids, cuts, nails and lashes, booked into real free times with a deposit.' },
    { slug: 'boutiques', path: '/for/boutiques', name: 'Boutiques and tailors', short: 'Boutiques', blurb: 'Fittings, measurements and pick-ups, booked on WhatsApp with a deposit.' },
    { slug: 'food-vendors', path: '/for/food-vendors', name: 'Food vendors', short: 'Food vendors', blurb: 'Pre-orders and pick-up times, with the deposit paid before you cook.' },
];

/* ------------------------------------------------------------------ */
/* Industries shown with photos on the home and features pages         */
/* ------------------------------------------------------------------ */

export interface Industry {
    name: string;
    blurb: string;
    /** Base name in /public/images/marketing (…-640.webp and …-960.webp). */
    image: string;
    alt: string;
    href?: string;
}

/** Example photos are generated, not real customers. */
export const INDUSTRIES: readonly Industry[] = [
    { name: 'Skin and aesthetics clinics', blurb: 'Facials, peels and laser, with the consultation and deposit sorted before they arrive.', image: 'aesthetics', alt: 'An aesthetician giving a client a facial in a calm treatment room' },
    { name: 'Spas and wellness', blurb: 'Massages and packages booked into the therapist time you really have.', image: 'spa', alt: 'A therapist preparing a massage room with towels and oils' },
    { name: 'Private dental clinics', blurb: 'Check-ups and whitening booked and reminded, so the chair is never empty.', image: 'dental', alt: 'A dentist chatting with a smiling patient in a bright clinic' },
    { name: 'Bespoke tailoring', blurb: 'Fittings and collections booked on WhatsApp, with a deposit on every order.', image: 'tailoring', alt: 'A tailor measuring a client in a dark green suit' },
    { name: 'Private chefs and caterers', blurb: 'Dinners and events with the date held and the deposit paid before you shop.', image: 'private-chef', alt: 'A chef plating jollof rice and chicken for a private dinner' },
    { name: 'Photography studios', blurb: 'Shoots and studio time booked into your calendar, deposit first.', image: 'photography', alt: 'A photographer directing a model in a green dress in a studio' },
    { name: 'Pilates and fitness studios', blurb: 'Private sessions and classes filled without the back-and-forth.', image: 'pilates', alt: 'An instructor guiding a client on a reformer pilates machine' },
    { name: 'Car detailing', blurb: 'Details and ceramic coatings booked into the bay with a deposit.', image: 'detailing', alt: 'A detailer polishing the bonnet of a dark SUV' },
];
