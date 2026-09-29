import { Nav, Footer, MobileCTA } from '@/components/marketing/site/chrome';
import { PageHero, Section, ClosingCTA } from '@/components/marketing/site/pieces';

export const metadata = {
    title: 'Questions — Bookly',
    description: 'Straight answers about how Bookly books customers, takes deposits and pays you.',
};

export default function FaqPage() {
    const groups = [
        {
            h: 'Using it',
            qs: [
                ['Do my customers need an app?', 'No. They use WhatsApp or Instagram exactly as they already do. That is the whole point.'],
                ['Can I still reply myself?', 'Any time. Open the chat and type — the assistant steps back and waits until you hand it back.'],
                ['Is it only for salons?', 'No. Anything booked by appointment works — clinics, tutors, mechanics, photographers.'],
            ],
        },
        {
            h: 'Money',
            qs: [
                ['How do I get paid?', 'Customers pay through Bookly and your earnings show up in your account. Send them to your Mobile Money whenever you like.'],
                ['Do I need a Paystack account?', 'No. That is the step we removed. You only give us the Mobile Money number you want to be paid on.'],
                ['What if someone cancels?', 'The deposit stays with you — that is what holding the slot is worth. If they just want a different time they reschedule, and their deposit moves with them.'],
            ],
        },
        {
            h: 'Your team',
            qs: [
                ['Can my staff see customer numbers?', 'Only the last four digits. They can reply and work normally, but they cannot copy your customer list. You see everything.'],
                ['Can staff withdraw money?', 'Never. Moving money out is the owner only, and the app enforces it rather than just hiding a button.'],
            ],
        },
    ];

    return (
        <main id="main" className="theme-site min-h-screen">
            <Nav />
            <PageHero
                eyebrow="Questions"
                title="Straight answers."
                sub="The things people actually ask before they start."
            />

            {groups.map((g, i) => (
                <Section key={g.h} tint={i % 2 === 1}>
                    <h2 className="font-display text-2xl" style={{ color: 'var(--primary)' }}>{g.h}</h2>
                    <div className="mt-4 divide-y" style={{ borderColor: 'var(--border)' }}>
                        {g.qs.map(([q, a]) => (
                            <details key={q} className="group py-5">
                                <summary
                                    className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-6 text-[16px] font-medium"
                                    style={{ color: 'var(--foreground)' }}
                                >
                                    {q}
                                    <span
                                        className="shrink-0 text-xl transition-transform group-open:rotate-45"
                                        style={{ color: 'var(--primary)' }}
                                        aria-hidden="true"
                                    >
                                        +
                                    </span>
                                </summary>
                                <p className="mt-3 max-w-2xl text-[15px] leading-relaxed" style={{ color: 'var(--muted-foreground)' }}>{a}</p>
                            </details>
                        ))}
                    </div>
                </Section>
            ))}

            <ClosingCTA title="Still wondering? Just try it." sub="Free to start, and you can be taking bookings this afternoon." />
            <Footer />
            <MobileCTA />
        </main>
    );
}
