import Link from 'next/link';
import { ArrowRight, CalendarCheck, Check, TrendingUp, Wallet } from 'lucide-react';
import { PhoneChat } from './phone';

/**
 * Home hero, on the reference's structure (21st.dev maroon-fintech-landing):
 * a paper panel with a centred headline, the product as the "device" on a
 * stage with floating callouts, and a foot row pairing a /why/ note with
 * two dark stat cards. The cards are an illustration of the dashboard for
 * the demo salon in the phone, not claims about Bookly's own numbers.
 */
export function HomeHero() {
    return (
        <header className="fs-hero fs-paper">
            <div className="fs-hero-grid" aria-hidden />

            <div className="fs-hero-head">
                <p className="fs-backer fs-in">
                    <span className="fs-backer-mark" aria-hidden><Check className="h-2.5 w-2.5" strokeWidth={3} /></span>
                    Official <b>WhatsApp Business Platform</b>
                </p>
                <h1 className="fs-h1 fs-in">
                    Never lose a booking <span className="fs-mute">because you were busy.</span>
                </h1>
                <p className="fs-sub fs-in">
                    Bookly answers your customers while you work, books them into times
                    you&apos;re really free, and takes a deposit so they show up.
                </p>
                <div className="fs-actions fs-in">
                    <Link href="/register" className="fs-btn fs-btn--lg fs-btn--brand">
                        Get started free <ArrowRight className="h-4 w-4" />
                    </Link>
                    <Link href="/features" className="fs-btn fs-btn--lg fs-btn--white">
                        See what it does
                    </Link>
                </div>
            </div>

            <div className="fs-stage">
                <div className="fs-device">
                    <span className="fs-callout fs-callout--l"><i />Replied in 4 seconds</span>
                    <span className="fs-callout fs-callout--r"><Wallet className="h-3.5 w-3.5" />GHS 50 deposit paid</span>
                    <PhoneChat />
                    <div className="fs-device-shadow" aria-hidden />
                </div>
            </div>

            <div className="fs-hero-foot">
                <div className="fs-info">
                    <p className="fs-key">/why/</p>
                    <p className="fs-info-t">
                        No payment gateway to set up and no card to start.{' '}
                        <span className="fs-mute">Customers pay through us; you send the money to your own MoMo whenever you like.</span>
                    </p>
                </div>

                <div className="fs-cards" aria-label="Example dashboard for Glow Hair Studio">
                    <StatCard
                        icon={<CalendarCheck className="h-3 w-3" />}
                        title="Bookings"
                        range="Glow Hair Studio · this week"
                        amount="38"
                        change="+9"
                        changeLabel="vs last week"
                        bars={[40, 55, 35, 70, 62, 100, 48]}
                    />
                    <StatCard
                        icon={<TrendingUp className="h-3 w-3" />}
                        title="Deposits held"
                        range="Glow Hair Studio · this week"
                        amount="GHS 1,900"
                        change="+GHS 350"
                        changeLabel="vs last week"
                        bars={[30, 45, 60, 52, 80, 100, 74]}
                    />
                </div>
            </div>
        </header>
    );
}

function StatCard({
    icon, title, range, amount, change, changeLabel, bars,
}: {
    icon: React.ReactNode;
    title: string;
    range: string;
    amount: string;
    change: string;
    changeLabel: string;
    bars: number[];
}) {
    const peak = Math.max(...bars);
    return (
        <article className="fs-stat">
            <div className="fs-stat-top">
                <div>
                    <p className="fs-stat-t">{title}</p>
                    <p className="fs-stat-d">{range}</p>
                </div>
                <span className="fs-ico" aria-hidden>{icon}</span>
            </div>
            <p className="fs-stat-amt">{amount}</p>
            <p className="fs-stat-chg">
                <span className="fs-chg">{change}</span>
                {changeLabel}
            </p>
            <div className="fs-bars" aria-hidden>
                {bars.map((h, i) => (
                    <i
                        key={i}
                        className={h === peak ? 'is-hi' : undefined}
                        style={{ height: `${h}%`, animationDelay: `${400 + i * 60}ms` }}
                    />
                ))}
            </div>
        </article>
    );
}
