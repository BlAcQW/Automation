import Link from 'next/link';
import {
    MessageSquare,
    Calendar,
    Clock,
    Users,
    Shield,
    Zap,
    ArrowRight,
    Check
} from 'lucide-react';

export default function HomePage() {
    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
            {/* Navigation */}
            <nav className="fixed top-0 left-0 right-0 z-50 glass">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex justify-between items-center h-16">
                        <div className="flex items-center space-x-2">
                            <div className="w-8 h-8 gradient-primary rounded-lg flex items-center justify-center">
                                <MessageSquare className="w-5 h-5 text-white" />
                            </div>
                            <span className="text-xl font-bold text-white">BookingFlow</span>
                        </div>
                        <div className="flex items-center space-x-4">
                            <Link
                                href="/login"
                                className="text-gray-300 hover:text-white transition-colors px-4 py-2"
                            >
                                Login
                            </Link>
                            <Link
                                href="/register"
                                className="gradient-primary text-white px-6 py-2 rounded-lg font-medium hover:shadow-glow transition-all"
                            >
                                Get Started
                            </Link>
                        </div>
                    </div>
                </div>
            </nav>

            {/* Hero Section */}
            <section className="pt-32 pb-20 px-4">
                <div className="max-w-7xl mx-auto text-center">
                    <div className="inline-flex items-center space-x-2 bg-primary-500/10 border border-primary-500/20 rounded-full px-4 py-1.5 mb-8">
                        <Zap className="w-4 h-4 text-primary-400" />
                        <span className="text-sm text-primary-400 font-medium">Automate Your Bookings</span>
                    </div>

                    <h1 className="text-5xl md:text-7xl font-bold text-white mb-6 leading-tight">
                        WhatsApp Booking
                        <br />
                        <span className="text-gradient">Made Simple</span>
                    </h1>

                    <p className="text-xl text-gray-400 max-w-2xl mx-auto mb-10">
                        Let your customers book appointments through WhatsApp.
                        Automated scheduling, reminders, and management — all in one platform.
                    </p>

                    <div className="flex flex-col sm:flex-row justify-center gap-4">
                        <Link
                            href="/register"
                            className="gradient-primary text-white px-8 py-4 rounded-xl font-semibold text-lg hover:shadow-glow-lg transition-all flex items-center justify-center space-x-2"
                        >
                            <span>Start Free Trial</span>
                            <ArrowRight className="w-5 h-5" />
                        </Link>
                        <Link
                            href="#features"
                            className="bg-white/5 border border-white/10 text-white px-8 py-4 rounded-xl font-semibold text-lg hover:bg-white/10 transition-all"
                        >
                            Learn More
                        </Link>
                    </div>
                </div>
            </section>

            {/* Features Section */}
            <section id="features" className="py-20 px-4">
                <div className="max-w-7xl mx-auto">
                    <div className="text-center mb-16">
                        <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
                            Everything You Need
                        </h2>
                        <p className="text-gray-400 text-lg max-w-2xl mx-auto">
                            Powerful features to automate your appointment booking workflow
                        </p>
                    </div>

                    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
                        {features.map((feature, index) => (
                            <div
                                key={index}
                                className="glass rounded-2xl p-8 hover:border-primary-500/30 transition-all group"
                            >
                                <div className="w-12 h-12 gradient-primary rounded-xl flex items-center justify-center mb-6 group-hover:shadow-glow transition-all">
                                    <feature.icon className="w-6 h-6 text-white" />
                                </div>
                                <h3 className="text-xl font-semibold text-white mb-3">{feature.title}</h3>
                                <p className="text-gray-400">{feature.description}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* Pricing Section */}
            <section className="py-20 px-4">
                <div className="max-w-4xl mx-auto">
                    <div className="text-center mb-16">
                        <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
                            Simple Pricing
                        </h2>
                        <p className="text-gray-400 text-lg">
                            Start free, scale as you grow
                        </p>
                    </div>

                    <div className="glass rounded-2xl p-8 md:p-12">
                        <div className="flex flex-col md:flex-row justify-between items-center mb-8">
                            <div>
                                <h3 className="text-2xl font-bold text-white mb-2">Pro Plan</h3>
                                <p className="text-gray-400">Everything you need to automate bookings</p>
                            </div>
                            <div className="mt-4 md:mt-0">
                                <span className="text-5xl font-bold text-white">$29</span>
                                <span className="text-gray-400">/month</span>
                            </div>
                        </div>

                        <div className="grid md:grid-cols-2 gap-4 mb-8">
                            {pricingFeatures.map((feature, index) => (
                                <div key={index} className="flex items-center space-x-3">
                                    <div className="w-5 h-5 rounded-full bg-primary-500/20 flex items-center justify-center">
                                        <Check className="w-3 h-3 text-primary-400" />
                                    </div>
                                    <span className="text-gray-300">{feature}</span>
                                </div>
                            ))}
                        </div>

                        <Link
                            href="/register"
                            className="block w-full gradient-primary text-white py-4 rounded-xl font-semibold text-lg text-center hover:shadow-glow-lg transition-all"
                        >
                            Start 14-Day Free Trial
                        </Link>
                        <p className="text-center text-gray-500 text-sm mt-4">
                            No credit card required. WhatsApp fees paid separately to Meta.
                        </p>
                    </div>
                </div>
            </section>

            {/* Footer */}
            <footer className="py-12 px-4 border-t border-white/10">
                <div className="max-w-7xl mx-auto">
                    <div className="flex flex-col md:flex-row justify-between items-center">
                        <div className="flex items-center space-x-2 mb-4 md:mb-0">
                            <div className="w-8 h-8 gradient-primary rounded-lg flex items-center justify-center">
                                <MessageSquare className="w-5 h-5 text-white" />
                            </div>
                            <span className="text-lg font-bold text-white">BookingFlow</span>
                        </div>
                        <p className="text-gray-500 text-sm">
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
