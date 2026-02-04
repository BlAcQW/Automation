'use client';

import { useAuth } from '@/lib/auth';
import { Calendar, Search, Filter, Plus } from 'lucide-react';

export default function BookingsPage() {
    const { tenant } = useAuth();

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Bookings</h1>
                    <p className="text-slate-500 dark:text-slate-400">
                        Manage appointments for {tenant?.name}
                    </p>
                </div>
                <div className="flex items-center space-x-3">
                    <button className="px-4 py-2 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 font-medium transition-all flex items-center">
                        <Filter className="w-4 h-4 mr-2" />
                        Filter
                    </button>
                    <button className="px-4 py-2 gradient-primary text-white rounded-lg hover:opacity-90 font-medium transition-all shadow-lg flex items-center">
                        <Plus className="w-4 h-4 mr-2" />
                        New Booking
                    </button>
                </div>
            </div>

            {/* Search */}
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                    type="text"
                    placeholder="Search by name, phone or reference..."
                    className="w-full pl-10 pr-4 py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all text-slate-900 dark:text-white placeholder-slate-400"
                />
            </div>

            {/* Empty State */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-12 text-center">
                <div className="w-16 h-16 bg-primary-50 dark:bg-primary-900/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <Calendar className="w-8 h-8 text-primary-600 dark:text-primary-400" />
                </div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">No bookings yet</h3>
                <p className="text-slate-500 dark:text-slate-400 max-w-sm mx-auto mb-6">
                    Create a booking manually or wait for customers to book via WhatsApp.
                </p>
                <button className="px-6 py-3 gradient-primary text-white rounded-xl hover:opacity-90 font-medium transition-all shadow-lg inline-flex items-center">
                    <Plus className="w-5 h-5 mr-2" />
                    Create First Booking
                </button>
            </div>
        </div>
    );
}
