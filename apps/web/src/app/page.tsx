import { MarketingNav } from '@/components/marketing/marketing-nav';
import { Hero } from '@/components/marketing/hero';
import { FeatureBento } from '@/components/marketing/feature-bento';
import { HowItWorks } from '@/components/marketing/how-it-works';
import { SocialProof } from '@/components/marketing/social-proof';
import { PricingSection } from '@/components/marketing/pricing-section';
import { FinalCTA } from '@/components/marketing/final-cta';
import { CinematicFooter } from '@/components/marketing/cinematic-footer';

/**
 * Bookly landing — ui.md §7. Cinematic dark hero (no 3D scene yet —
 * deferred to a future polish pass), bento grid of features, scroll-
 * driven 3-step explainer, social proof, FULL pricing table embedded
 * (owner override of §7.7 teaser), and an oversized cinematic footer.
 */
export default function LandingPage() {
    return (
        <main className="relative bg-ink-950 text-ink-50 min-h-screen">
            <MarketingNav />
            <Hero />
            <FeatureBento />
            <HowItWorks />
            <SocialProof />
            <PricingSection />
            <FinalCTA />
            <CinematicFooter />
        </main>
    );
}
