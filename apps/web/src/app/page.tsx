import Link from 'next/link';
import {
    MessageSquare,
    Calendar,
    Clock,
    Users,
    Shield,
    Zap,
    ArrowRight,
    Check,
    Sparkles,
} from 'lucide-react';
// import { Button, buttonVariants } from '@/components/ui/button';
import { WhatsAppDemo } from '@/components/landing/whatsapp-demo';



export default function HomePage() {
    return (
        <div className="min-h-screen bg-[#060b18] bg-grid relative overflow-hidden">
            {/* ... (keep background) */}

            <nav className="fixed top-0 left-0 right-0 z-50 bg-[#060b18]/70 backdrop-blur-xl border-b border-white/5">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex justify-between items-center h-16">
                        {/* ... (keep logo) */}
                        <div className="flex items-center space-x-2.5">
                            <div className="w-9 h-9 bg-gradient-to-br from-emerald-400 to-teal-500 rounded-xl flex items-center justify-center shadow-glow-sm">
                                <MessageSquare className="w-5 h-5 text-white" />
                            </div>
                            <span className="text-xl font-bold text-white tracking-tight">BookingFlow</span>
                        </div>
                        <div className="hidden sm:flex items-center space-x-3">
                            <Link
                                href="/login"
                                className="text-slate-400 hover:text-white transition-colors px-4 py-2 text-sm font-medium"
                            >
                                Login
                            </Link>
                            <Link href="/register" className="bg-gradient-to-r from-emerald-500 to-teal-500 text-white h-11 px-5 text-sm rounded-xl inline-flex items-center justify-center font-semibold">
                                Get Started <ArrowRight className="w-4 h-4 ml-2" />
                            </Link>
                        </div>
                        <div className="flex sm:hidden items-center space-x-2">
                            <Link href="/login" className="text-slate-400 hover:text-white px-3 py-2 text-sm">
                                Login
                            </Link>
                            <Link href="/register" className="bg-gradient-to-r from-emerald-500 to-teal-500 text-white h-9 px-3 text-sm rounded-lg inline-flex items-center justify-center font-semibold">
                                Start
                            </Link>
                        </div>
                    </div>
                </div>
            </nav>

            <section className="pt-36 pb-24 px-4 relative">
                <div className="max-w-7xl mx-auto text-center">
                    {/* ... (keep hero content) */}
                    <div>
                        <div className="inline-flex items-center space-x-2 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-4 py-1.5 mb-8 backdrop-blur-sm">
                            <Sparkles className="w-4 h-4 text-emerald-400" />
                            <span className="text-sm text-emerald-400 font-medium">Automate Your Bookings</span>
                        </div>
                    </div>

                    <h1 className="text-5xl md:text-7xl font-extrabold text-white mb-6 leading-[1.1] tracking-tight">
                        WhatsApp Booking
                        <br />
                        <span className="text-gradient">Made Simple</span>
                    </h1>

                    <p className="text-lg md:text-xl text-slate-400 max-w-2xl mx-auto mb-12 leading-relaxed">
                        Let your customers book appointments through WhatsApp.
                        Automated scheduling, reminders, and management — all in one platform.
                    </p>

                    <div className="flex flex-col sm:flex-row justify-center gap-4">
                        <Link href="/register" className="bg-emerald-500 text-white px-8 py-4 rounded-xl">
                            Start Free Trial <ArrowRight className="w-5 h-5 inline" />
                        </Link>
                        <Link href="#features" className="bg-white/10 text-white px-8 py-4 rounded-xl border border-white/10 backdrop-blur-sm">
                            Learn More
                        </Link>
                    </div>
                </div>
            </section>

            {/* Features Section */}
            <section id="features" className="py-24 px-4 relative">
                <div className="max-w-7xl mx-auto">
                    <div className="text-center mb-16">
                        <h2 className="text-3xl md:text-5xl font-bold text-white mb-4 tracking-tight">
                            Everything You Need
                        </h2>
                        <p className="text-slate-400 text-lg max-w-2xl mx-auto">
                            Powerful features to automate your appointment booking workflow
                        </p>
                    </div>

                    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {features.map((feature, index) => (
                            <div
                                key={index}
                                className="glass-card glass-card-hover rounded-2xl p-8 group cursor-default"
                            >
                                <div className="w-12 h-12 bg-gradient-to-br from-emerald-400 to-teal-500 rounded-xl flex items-center justify-center mb-6 shadow-glow-sm group-hover:shadow-glow transition-all duration-300">
                                    <feature.icon className="w-6 h-6 text-white" />
                                </div>
                                <h3 className="text-xl font-semibold text-white mb-3">{feature.title}</h3>
                                <p className="text-slate-400 leading-relaxed">{feature.description}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* How It Works — Animated WhatsApp Demo */}
            <WhatsAppDemo />

            {/* Pricing Section */}
            <section className="py-24 px-4 relative">
                <div className="max-w-4xl mx-auto">
                    <div className="text-center mb-16">
                        <h2 className="text-3xl md:text-5xl font-bold text-white mb-4 tracking-tight">
                            Simple Pricing
                        </h2>
                        <p className="text-slate-400 text-lg">
                            Start free, scale as you grow
                        </p>
                    </div>

                    <div className="glass-card shimmer-border rounded-2xl p-8 md:p-12">
                        <div className="flex flex-col md:flex-row justify-between items-center mb-10">
                            <div>
                                <h3 className="text-2xl font-bold text-white mb-2">Pro Plan</h3>
                                <p className="text-slate-400">Everything you need to automate bookings</p>
                            </div>
                            <div className="mt-4 md:mt-0">
                                <span className="text-5xl font-extrabold text-white">$29</span>
                                <span className="text-slate-400 ml-1">/month</span>
                            </div>
                        </div>

                        <div className="grid md:grid-cols-2 gap-4 mb-10">
                            {pricingFeatures.map((feature, index) => (
                                <div key={index} className="flex items-center space-x-3">
                                    <div className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
                                        <Check className="w-3 h-3 text-emerald-400" />
                                    </div>
                                    <span className="text-slate-300">{feature}</span>
                                </div>
                            ))}
                        </div>

                        <Link href="/register" className="w-full bg-gradient-to-r from-emerald-500 to-teal-500 text-white h-12 px-8 text-lg rounded-xl inline-flex items-center justify-center font-semibold shadow-[0_0_30px_rgba(16,185,129,0.4)]">
                            Start 14-Day Free Trial
                        </Link>
                        <p className="text-center text-slate-500 text-sm mt-4">
                            No credit card required. WhatsApp fees paid separately to Meta.
                        </p>
                    </div>
                </div>
            </section>

            {/* Footer */}
            <footer className="py-12 px-4 border-t border-white/5">
                <div className="max-w-7xl mx-auto">
                    <div className="flex flex-col md:flex-row justify-between items-center">
                        <div className="flex items-center space-x-2.5 mb-4 md:mb-0">
                            <div className="w-8 h-8 bg-gradient-to-br from-emerald-400 to-teal-500 rounded-lg flex items-center justify-center">
                                <MessageSquare className="w-4 h-4 text-white" />
                            </div>
                            <span className="text-lg font-bold text-white">BookingFlow</span>
                        </div>
                        <p className="text-slate-500 text-sm">
                            © {new Date().getFullYear()} BookingFlow. All rights reserved.
                        </p>
                    </div>
                </div>
            </footer>
        </div>
    );
}

const features = [
    {
        icon: MessageSquare,
        title: 'WhatsApp Integration',
        description: 'Customers book directly through WhatsApp. No app downloads required.',
    },
    {
        icon: Calendar,
        title: 'Smart Scheduling',
        description: 'Automatic availability calculation based on your working hours and existing bookings.',
    },
    {
        icon: Clock,
        title: 'Automated Reminders',
        description: 'Send booking confirmations and reminders automatically via WhatsApp.',
    },
    {
        icon: Users,
        title: 'Human Takeover',
        description: 'Seamlessly switch between bot and human support when needed.',
    },
    {
        icon: Shield,
        title: 'Calendar Sync',
        description: 'Sync with Google and Outlook calendars to prevent double bookings.',
    },
    {
        icon: Zap,
        title: 'Multi-Tenant',
        description: 'Built for businesses of all sizes with secure data isolation.',
    },
];

const pricingFeatures = [
    'Unlimited bookings',
    'WhatsApp bot automation',
    'Google & Outlook sync',
    'Automated reminders',
    'Human takeover mode',
    'Dashboard analytics',
    'Multiple staff accounts',
    'Priority support',
];
