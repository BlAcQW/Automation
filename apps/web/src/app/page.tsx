import { Nav, Hero, Pricing, Footer } from '@/components/marketing/sage/shell';
import {
    TheProblem,
    WhatItDoes,
    NoSetup,
    Channels,
    HowItWorks,
    WhoItsFor,
    FAQ,
    FinalCTA,
} from '@/components/marketing/sage/sections';

/**
 * Landing page, built from the positioning brief
 * (docs/strategy/what-bookly-sells.pdf) on the Sage Cream theme.
 *
 * Section order follows the brief's argument rather than a template: name the
 * money the owner is losing, show the assistant doing the job, then give the
 * two things no competitor does — payments and texts with nothing to set up —
 * a section of their own instead of a line in a feature grid.
 *
 * `theme-sage` scopes the palette here. The dashboard keeps its emerald
 * tokens, so this cannot change what a logged-in owner sees.
 */
export default function LandingPage() {
    return (
        <main id="main" className="theme-sage min-h-screen">
            <Nav />
            <Hero />
            <TheProblem />
            <WhatItDoes />
            <NoSetup />
            <Channels />
            <HowItWorks />
            <WhoItsFor />
            <Pricing />
            <FAQ />
            <FinalCTA />
            <Footer />
        </main>
    );
}
