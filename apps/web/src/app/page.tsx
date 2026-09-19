import { MarketingNav } from '@/components/marketing/marketing-nav';
import { Hero } from '@/components/marketing/hero';
import { FeatureBento } from '@/components/marketing/feature-bento';
import { HowItWorks } from '@/components/marketing/how-it-works';
import { WhoItsFor } from '@/components/marketing/social-proof';
import { PricingSection } from '@/components/marketing/pricing-section';
import { FinalCTA } from '@/components/marketing/final-cta';
import { CinematicFooter } from '@/components/marketing/cinematic-footer';

/**
 * Landing page. Hero with the assistant conversation, what it does, how
 * setup goes, who it is for, pricing, one closing call to action.
 */
export default function LandingPage() {
    return (
        <main id="main" className="relative bg-ink-950 text-ink-50 min-h-screen">
            <MarketingNav />
            <Hero />
            <FeatureBento />
            <HowItWorks />
            <WhoItsFor />
            <PricingSection />
            <FinalCTA />
            <CinematicFooter />
        </main>
    );
}
