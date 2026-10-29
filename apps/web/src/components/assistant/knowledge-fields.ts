/**
 * Settings > Your assistant: every section and field the owner fills in, with
 * its label, limit, helper text and example. This file is what owners see and
 * what the printed owner guide is written from, so keep labels stable.
 *
 * Limits mirror the API (apps/api/src/services/business-knowledge.ts), which is
 * the authority: it refuses anything longer.
 */

export const LIMITS = {
    short: 500,
    long: 1000,
    notes: 2000,
    faqQuestion: 300,
    faqAnswer: 1000,
    faqs: 30,
    teamName: 80,
    teamRole: 200,
    team: 15,
    total: 15_000,
} as const;

export type BusinessType = 'SERVICE' | 'PRODUCT';

export interface TeamMember { name: string; role: string }
export interface Faq { question: string; answer: string }

/** The API's shape (GET/PUT /assistant/knowledge). */
export interface Knowledge {
    about: string;
    specialties: string;
    audience: string;
    team: TeamMember[];
    address: string;
    directions: string;
    mapsUrl: string;
    parking: string;
    minimumNotice: string;
    advanceBooking: string;
    walkIns: string;
    groupBookings: string;
    lateArrival: string;
    homeService: string;
    paymentMethods: string;
    cancellationPolicy: string;
    preparation: string;
    aftercare: string;
    offer: string;
    offerEndsOn: string | null;
    faqs: Faq[];
    tone: string;
    languages: string;
    notes: string;
}

export type TextKey = Exclude<keyof Knowledge, 'team' | 'faqs' | 'offerEndsOn'>;

export interface TextFieldDef {
    key: TextKey;
    label: string;
    /** Shops (PRODUCT) see this label instead, where the words differ. */
    shopLabel?: string;
    limit: number;
    placeholder: string;
    shopPlaceholder?: string;
    /** One line under the field, when the label alone is not enough. */
    hint?: string;
    /** Multi-line box rather than a single line. */
    multiline?: boolean;
}

export type SectionId =
    | 'about' | 'team' | 'location' | 'bookingRules' | 'payments'
    | 'beforeAfter' | 'offers' | 'faqs' | 'tone' | 'notes';

export interface SectionDef {
    id: SectionId;
    title: string;
    shopTitle?: string;
    /** The one-line helper under the section title. */
    helper: string;
    shopHelper?: string;
    /** Plain text fields; team, FAQs and the offer date have their own editors. */
    fields: TextFieldDef[];
}

/** In page order. */
export const SECTIONS: SectionDef[] = [
    {
        id: 'about',
        title: 'About the business',
        helper: 'What you do and who for, in your own words. Your assistant uses this to describe you.',
        fields: [
            { key: 'about', label: 'What you do', limit: LIMITS.short, multiline: true, placeholder: 'A skin clinic in East Legon for facials, chemical peels and acne care, run by a certified aesthetician.', shopPlaceholder: 'Handmade leather bags and sandals, made to order in our Osu workshop.' },
            { key: 'specialties', label: "What you're known for", limit: LIMITS.short, multiline: true, placeholder: 'Our signature HydraGlow facial, and gentle treatments for sensitive and darker skin.', shopPlaceholder: 'Our tote bags in full-grain leather, finished by hand.' },
            { key: 'audience', label: 'Who you serve', limit: LIMITS.short, multiline: true, placeholder: 'Women and men 16 and over. Children welcome with a parent. Corporate packages for teams.' },
        ],
    },
    {
        id: 'team',
        title: 'Team',
        helper: 'Who does what. Your assistant can say who does each service, but only offers times your calendar shows.',
        shopHelper: 'Who does what, so your assistant can tell customers who will help them.',
        fields: [],
    },
    {
        id: 'location',
        title: 'Location',
        helper: 'Help customers find you without having to call.',
        fields: [
            { key: 'address', label: 'Address', limit: LIMITS.short, placeholder: '14 Jungle Avenue, East Legon, Accra (GA-416-2245)' },
            { key: 'directions', label: 'Directions and landmarks', limit: LIMITS.short, multiline: true, placeholder: "Opposite the A&C Mall car park. Cream building with a green gate. We're on the first floor." },
            { key: 'mapsUrl', label: 'Google Maps link', limit: LIMITS.short, placeholder: 'https://maps.app.goo.gl/…', hint: 'In Google Maps, open your business, tap Share and paste the link. It starts with https://' },
            { key: 'parking', label: 'Parking', limit: LIMITS.short, multiline: true, placeholder: 'Free parking in front. Ask the security man to open the gate.' },
        ],
    },
    {
        id: 'bookingRules',
        title: 'Booking rules',
        shopTitle: 'Ordering and delivery',
        helper: 'The rules your assistant explains before someone books.',
        shopHelper: 'The rules your assistant explains before someone orders.',
        fields: [
            { key: 'minimumNotice', label: 'Minimum notice', limit: LIMITS.short, multiline: true, placeholder: 'Book at least 3 hours ahead. Same-day bookings depend on space.', shopPlaceholder: 'Made-to-order pieces need 5 working days.' },
            { key: 'advanceBooking', label: 'How far ahead people can book', shopLabel: 'How far ahead people can order', limit: LIMITS.short, multiline: true, placeholder: 'Up to 2 months ahead. Bridal bookings up to 6 months.', shopPlaceholder: 'Pre-orders open 4 weeks before each new collection.' },
            { key: 'walkIns', label: 'Walk-ins', shopLabel: 'Walk-in customers', limit: LIMITS.short, multiline: true, placeholder: 'Walk-ins welcome on weekdays if a room is free. Weekends are by booking only.', shopPlaceholder: 'Visit the showroom Monday to Saturday, 9am to 6pm.' },
            { key: 'groupBookings', label: 'Group bookings', shopLabel: 'Large or group orders', limit: LIMITS.short, multiline: true, placeholder: 'Bridal parties and groups of 4 or more: message us 2 weeks ahead for a group quote.', shopPlaceholder: 'Orders of 20 or more: 2 weeks’ notice and half paid upfront.' },
            { key: 'lateArrival', label: 'Late arrival', shopLabel: 'Late collection', limit: LIMITS.short, multiline: true, placeholder: 'We wait 15 minutes. After that we may shorten the treatment or move you to another day.', shopPlaceholder: 'We hold paid orders for collection for 7 days.' },
            { key: 'homeService', label: 'Home service', shopLabel: 'Delivery areas and fees', limit: LIMITS.short, multiline: true, placeholder: 'Our chef cooks at your home anywhere in Accra. Transport GH₵ 150, Tema GH₵ 250.', shopPlaceholder: 'Accra GH₵ 40, same day if you order by 12pm. Kumasi GH₵ 80, next day.' },
        ],
    },
    {
        id: 'payments',
        title: 'Payments and policies',
        helper: 'How people can pay, and what happens if plans change.',
        fields: [
            { key: 'paymentMethods', label: 'Payment methods you accept', limit: LIMITS.short, multiline: true, placeholder: 'MTN MoMo, Telecel Cash, Visa and Mastercard. Cash at the clinic.' },
            { key: 'cancellationPolicy', label: 'Cancellation and rescheduling policy', shopLabel: 'Cancellations and returns', limit: LIMITS.long, multiline: true, placeholder: 'Move or cancel free up to 24 hours before. Later than that, the deposit is kept. One free reschedule per booking.', shopPlaceholder: 'Exchanges within 7 days with the receipt. Custom pieces cannot be returned.' },
        ],
    },
    {
        id: 'beforeAfter',
        title: 'Before and after',
        helper: 'What customers should do before they come, and how to look after themselves afterwards.',
        fields: [
            { key: 'preparation', label: 'How to prepare / what to bring', limit: LIMITS.long, multiline: true, placeholder: "Come with a clean face and no makeup. For a fitting, bring the shoes you'll wear on the day.", shopPlaceholder: 'For a custom size, send your measurements or visit for a quick fitting.' },
            { key: 'aftercare', label: 'Aftercare', limit: LIMITS.long, multiline: true, placeholder: 'No makeup or sun for 24 hours after a peel. Use the SPF we give you every morning for a week.', shopPlaceholder: 'Wipe leather with a dry cloth. Keep it out of the rain and away from direct sun.' },
        ],
    },
    {
        id: 'offers',
        title: 'Current offers',
        helper: 'A promotion your assistant can mention. It stops mentioning it after the end date.',
        fields: [
            { key: 'offer', label: 'Offer', limit: LIMITS.long, multiline: true, placeholder: '20% off all facials booked for a weekday in November.', shopPlaceholder: 'Free delivery in Accra on orders over GH₵ 500 this month.' },
        ],
    },
    {
        id: 'faqs',
        title: 'Questions customers ask',
        helper: 'The questions you answer most often, with the answer in your own words.',
        fields: [],
    },
    {
        id: 'tone',
        title: 'Language and tone',
        helper: "How your assistant should sound. It always replies in the customer's language and always follows Bookly's booking and payment rules.",
        shopHelper: "How your assistant should sound. It always replies in the customer's language and always follows Bookly's order and payment rules.",
        fields: [
            { key: 'tone', label: 'How your assistant should sound', limit: LIMITS.short, multiline: true, placeholder: 'Warm and premium. Short replies. Call customers by their first name.' },
            { key: 'languages', label: 'Languages', limit: LIMITS.short, placeholder: 'English. Twi greetings are welcome.' },
        ],
    },
    {
        id: 'notes',
        title: 'Anything else',
        helper: 'Anything a new member of your team would need to know to answer customers.',
        fields: [
            { key: 'notes', label: 'Anything else', limit: LIMITS.notes, multiline: true, placeholder: "We're closed on public holidays. Ladies-only hours are Wednesdays, 10am to 2pm." },
        ],
    },
];

export const TEAM_PLACEHOLDER = { name: 'Ama', role: 'Senior aesthetician: facials and peels' };
export const FAQ_PLACEHOLDER = {
    question: 'Can I bring my own fabric?',
    answer: "Yes. Bring 3 yards for a kaba and slit, and we'll check it at your first fitting.",
};

export function sectionTitle(s: SectionDef, type: BusinessType): string {
    return type === 'PRODUCT' && s.shopTitle ? s.shopTitle : s.title;
}
export function sectionHelper(s: SectionDef, type: BusinessType): string {
    return type === 'PRODUCT' && s.shopHelper ? s.shopHelper : s.helper;
}
export function fieldLabel(f: TextFieldDef, type: BusinessType): string {
    return type === 'PRODUCT' && f.shopLabel ? f.shopLabel : f.label;
}
export function fieldPlaceholder(f: TextFieldDef, type: BusinessType): string {
    return type === 'PRODUCT' && f.shopPlaceholder ? f.shopPlaceholder : f.placeholder;
}

// ---------------------------------------------------------------------------
// Form state
// ---------------------------------------------------------------------------

/** List rows carry a client-only key so React can reorder them. */
export interface KeyedTeamMember extends TeamMember { key: string }
export interface KeyedFaq extends Faq { key: string }

export type KnowledgeForm = Omit<Knowledge, 'team' | 'faqs' | 'offerEndsOn'> & {
    team: KeyedTeamMember[];
    faqs: KeyedFaq[];
    /** '' = no end date. */
    offerEndsOn: string;
};

let keySeq = 0;
export const newKey = () => `row-${Date.now().toString(36)}-${(keySeq += 1)}`;

export const EMPTY_KNOWLEDGE: Knowledge = {
    about: '', specialties: '', audience: '', team: [],
    address: '', directions: '', mapsUrl: '', parking: '',
    minimumNotice: '', advanceBooking: '', walkIns: '', groupBookings: '', lateArrival: '', homeService: '',
    paymentMethods: '', cancellationPolicy: '', preparation: '', aftercare: '',
    offer: '', offerEndsOn: null, faqs: [], tone: '', languages: '', notes: '',
};

export function toForm(k: Knowledge): KnowledgeForm {
    return {
        ...k,
        team: k.team.map((t) => ({ ...t, key: newKey() })),
        faqs: k.faqs.map((q) => ({ ...q, key: newKey() })),
        offerEndsOn: k.offerEndsOn ?? '',
    };
}

/** What PUT /assistant/knowledge (and the preview) is sent. */
export function toPayload(f: KnowledgeForm): Knowledge {
    return {
        ...f,
        team: f.team.map(({ name, role }) => ({ name, role })),
        faqs: f.faqs.map(({ question, answer }) => ({ question, answer })),
        offerEndsOn: f.offerEndsOn || null,
    };
}

/** Comparable snapshot for the unsaved-changes check (row keys ignored, whitespace trimmed). */
export function snapshot(f: KnowledgeForm): string {
    const p = toPayload(f);
    return JSON.stringify(p, (_k, v) => (typeof v === 'string' ? v.trim() : v));
}

// ---------------------------------------------------------------------------
// Completeness
// ---------------------------------------------------------------------------

const filled = (v: string) => v.trim() !== '';

/** YYYY-MM-DD in the viewer's own zone; good enough for an "is it over?" hint. */
export function todayIso(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function offerExpired(f: Pick<KnowledgeForm, 'offerEndsOn'>, today = todayIso()): boolean {
    return !!f.offerEndsOn && f.offerEndsOn < today;
}

export function isSectionFilled(id: SectionId, f: KnowledgeForm): boolean {
    if (id === 'team') return f.team.some((t) => filled(t.name));
    if (id === 'faqs') return f.faqs.some((q) => filled(q.question) && filled(q.answer));
    if (id === 'offers') return filled(f.offer) && !offerExpired(f);
    const section = SECTIONS.find((s) => s.id === id)!;
    return section.fields.some((field) => filled(f[field.key]));
}

export function completeness(f: KnowledgeForm): { filled: SectionId[]; missing: SectionId[]; total: number } {
    const done = SECTIONS.filter((s) => isSectionFilled(s.id, f)).map((s) => s.id);
    return { filled: done, missing: SECTIONS.map((s) => s.id).filter((id) => !done.includes(id)), total: SECTIONS.length };
}

/** Total characters, the same count the API caps. */
export function totalLength(f: KnowledgeForm): number {
    let n = 0;
    for (const s of SECTIONS) for (const field of s.fields) n += f[field.key].trim().length;
    for (const t of f.team) n += t.name.trim().length + t.role.trim().length;
    for (const q of f.faqs) n += q.question.trim().length + q.answer.trim().length;
    return n;
}

// ---------------------------------------------------------------------------
// Client checks (the API repeats all of them)
// ---------------------------------------------------------------------------

export function isHttpsUrl(value: string): boolean {
    try {
        const u = new URL(value.trim());
        return u.protocol === 'https:' && !!u.hostname && !u.username && !u.password;
    } catch {
        return false;
    }
}

/** Field errors keyed like the API's `fields[].field` ("mapsUrl", "faqs.2.answer"). */
export function validate(f: KnowledgeForm): Record<string, string> {
    const errors: Record<string, string> = {};
    if (f.mapsUrl.trim() && !isHttpsUrl(f.mapsUrl)) errors.mapsUrl = 'Paste the full link, starting with https://';
    f.team.forEach((t, i) => {
        if (!filled(t.name) && filled(t.role)) errors[`team.${i}.name`] = 'Add a name, or remove this person.';
    });
    f.faqs.forEach((q, i) => {
        if (filled(q.question) && !filled(q.answer)) errors[`faqs.${i}.answer`] = 'Add an answer, or remove this question.';
        if (!filled(q.question) && filled(q.answer)) errors[`faqs.${i}.question`] = 'Add the question, or remove this pair.';
    });
    const total = totalLength(f);
    if (total > LIMITS.total) {
        errors._total = `That's ${total.toLocaleString('en-GB')} characters in total. Keep it under ${LIMITS.total.toLocaleString('en-GB')}.`;
    }
    return errors;
}

/** Rows left completely empty are dropped on save rather than refused. */
export function withoutBlankRows(f: KnowledgeForm): KnowledgeForm {
    return {
        ...f,
        team: f.team.filter((t) => filled(t.name) || filled(t.role)),
        faqs: f.faqs.filter((q) => filled(q.question) || filled(q.answer)),
    };
}
