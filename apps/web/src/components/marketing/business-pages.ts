import type { BusinessType, QA } from './content';
import { REGISTRATION_OPEN } from '@/lib/feature-flags';

/**
 * Copy for the /for/* landing pages. Honest about what works today:
 * Bookly books anything that happens at a time (appointments, fittings,
 * pick-ups). The full product catalogue with delivery orders is parked, so
 * boutiques and food vendors are pitched on what they can book now.
 */
export interface BusinessPage {
    slug: BusinessType['slug'];
    crumb: string;
    seoTitle: string;
    seoDescription: string;
    eyebrow: string;
    title: string;
    sub: string;
    examplesTitle: string;
    examples: readonly string[];
    painsTitle: string;
    pains: readonly { title: string; body: string }[];
    note?: string;
    faq: readonly QA[];
    closing: { title: string; sub: string };
}

export const BUSINESS_PAGES: Record<BusinessType['slug'], BusinessPage> = {
    salons: {
        slug: 'salons',
        crumb: 'Salons and barbers',
        seoTitle: 'Salon booking app for Ghana on WhatsApp | Bookly',
        seoDescription:
            `Braids, cuts, nails and lashes booked on WhatsApp into your real free times, with a Mobile Money deposit and a reminder. ${REGISTRATION_OPEN ? 'Start free.' : 'Join the waitlist.'}`,
        eyebrow: 'For salons, barbers, nail and lash techs',
        title: 'Keep the chair full, even when your hands are busy.',
        sub: "You can't put down the comb to answer WhatsApp. Bookly answers for you, books the slot and takes the deposit, so the booking doesn't go to the salon down the road.",
        examplesTitle: 'What your customers can book',
        examples: [
            'Box braids, cornrows and wig installs, with the right time blocked for each',
            'Haircuts and shaves, with no deposit needed if you prefer',
            'Nails and lashes, with a deposit for long appointments',
            'Bridal and event bookings, paid up front',
        ],
        painsTitle: 'Where salons lose money',
        pains: [
            { title: 'Messages while you work', body: 'Mid-braid, the phone buzzes. By the time you reply, she has booked elsewhere.' },
            { title: 'No-shows', body: 'A four-hour braid slot left empty is a day of income gone. A deposit and a reminder fix most of it.' },
            { title: 'Double bookings', body: 'The notebook says two o\'clock is free, but your stylist already promised it. One shared diary that knows how many chairs you have ends that.' },
        ],
        faq: [
            { q: 'Can my staff use it too?', a: 'Yes. Give each stylist a login so they can reply and see the diary. Staff see only the last four digits of a customer number, and only you can move money out.' },
            { q: 'Can I charge a deposit only for long styles?', a: 'Yes. Set a deposit per service, so a quick trim needs none and a braid install does.' },
            { q: 'What if a customer is late or cancels?', a: 'The deposit stays with you. If they just need a different time, they reschedule and the deposit moves with them.' },
        ],
        closing: { title: 'Fill your Saturday from your WhatsApp.', sub: 'Free to start. Add your services this afternoon.' },
    },
    boutiques: {
        slug: 'boutiques',
        crumb: 'Boutiques and tailors',
        seoTitle: 'WhatsApp bookings for boutiques and tailors | Bookly',
        seoDescription:
            'Fittings, measurements and pick-ups booked on WhatsApp, with a Mobile Money deposit before you cut the cloth. Made for boutiques in Ghana.',
        eyebrow: 'For boutiques, tailors and fashion designers',
        title: 'Every fitting booked, every deposit paid.',
        sub: 'Your customers find you on Instagram and message you on WhatsApp. Bookly answers them, books fittings and pick-ups into your real free times and takes the deposit before you start sewing.',
        examplesTitle: 'What your customers can book',
        examples: [
            'Measurement and fitting appointments',
            'Custom orders, with a deposit before you buy fabric',
            'Pick-up times for finished pieces',
            'Styling sessions and private viewings',
        ],
        painsTitle: 'Where boutiques lose money',
        pains: [
            { title: 'DMs you answer at midnight', body: 'The questions come after work. Bookly answers them while you sleep and books the fitting.' },
            { title: 'Orders that vanish', body: 'Someone orders a kaba for a wedding, then goes quiet. A deposit up front means you only sew for people who pay.' },
            { title: 'Pick-ups that never happen', body: 'A clear pick-up time and a reminder means finished pieces leave the rail.' },
        ],
        note: 'A full product catalogue with delivery orders is on the way. Today, Bookly works best for anything your customers book for a time: fittings, custom orders and pick-ups.',
        faq: [
            { q: 'Does it work with Instagram?', a: 'Yes. Bookly answers Instagram DMs and Messenger too, with one diary behind all three.' },
            { q: 'Can I take a deposit for custom orders?', a: 'Yes. Set a deposit on the service, and the customer pays it by Mobile Money or card before the booking is confirmed.' },
            { q: 'Can I sell my whole catalogue with delivery?', a: 'Not yet. A product catalogue with delivery orders is on the way. Today Bookly is built for things booked for a time.' },
        ],
        closing: { title: 'Book your next fitting on WhatsApp.', sub: 'Free to start. Nothing to set up first.' },
    },
    'food-vendors': {
        slug: 'food-vendors',
        crumb: 'Food vendors',
        seoTitle: 'WhatsApp pre-orders for food vendors in Ghana | Bookly',
        seoDescription:
            'Take pre-orders and pick-up times on WhatsApp, with the deposit paid by Mobile Money before you cook. Made for food vendors in Accra and beyond.',
        eyebrow: 'For food vendors, caterers and home cooks',
        title: 'Cook for paid pre-orders, not maybes.',
        sub: "When the orders come in on WhatsApp, you're busy at the pot. Bookly answers, books each pre-order into a pick-up time you can handle and takes the deposit first.",
        examplesTitle: 'What your customers can book',
        examples: [
            'Pre-orders for a pick-up time, like jollof trays for Saturday at 2 pm',
            'Catering for parties and office events, with a deposit',
            'Weekly meal-prep pick-ups',
            'A limit on how many orders you take at the same time, so you never take more than you can cook',
        ],
        painsTitle: 'Where food vendors lose money',
        pains: [
            { title: 'Cooking for people who never come', body: 'Food that is not collected is money in the bin. A deposit first means you cook for real orders.' },
            { title: 'Too many orders at once', body: 'Set how many customers you take at once. Bookly stops offering a time when it is full.' },
            { title: 'Answering while you cook', body: 'Bookly replies in seconds, so your hands stay on the food.' },
        ],
        note: 'A full menu with delivery orders is on the way. Today, Bookly works best for pre-orders and catering booked for a pick-up time.',
        faq: [
            { q: 'Can I limit how many orders I take?', a: 'Yes. Set how many customers you take at once, and Bookly stops offering a time when it is full.' },
            { q: 'How do customers pay?', a: 'By Mobile Money or card, through a link in the chat. You send the money to your own MoMo whenever you like.' },
            { q: 'Can customers order for delivery?', a: 'Not yet. Delivery orders are on the way. Today Bookly is built for pre-orders with a pick-up time.' },
        ],
        closing: { title: 'Take your next pre-order on WhatsApp.', sub: 'Free to start. Set your pick-up times this afternoon.' },
    },
};
