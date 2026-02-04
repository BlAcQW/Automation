'use client';

import { useAuth } from '@/lib/auth';
import { Scissors, Plus, Search } from 'lucide-react';

export default function ServicesPage() {
    const { tenant } = useAuth();

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Services</h1>
                    <p className="text-slate-500 dark:text-slate-400">
                        Manage services offered by {tenant?.name}
                    </p>
                </div>
                <button className="px-4 py-2 gradient-primary text-white rounded-lg hover:opacity-90 font-medium transition-all shadow-lg flex items-center">
                    <Plus className="w-4 h-4 mr-2" />
                    Add Service
                </button>
            </div>

            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                    type="text"
                    placeholder="Search services..."
                    className="w-full pl-10 pr-4 py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all text-slate-900 dark:text-white placeholder-slate-400"
                />
            </div>

            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-12 text-center">
                <div className="w-16 h-16 bg-primary-50 dark:bg-primary-900/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <Scissors className="w-8 h-8 text-primary-600 dark:text-primary-400" />
                </div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">No services yet</h3>
                <p className="text-slate-500 dark:text-slate-400 max-w-sm mx-auto mb-6">
                    Add the services your business offers with pricing and duration.
                </p>
                <button className="px-6 py-3 gradient-primary text-white rounded-xl hover:opacity-90 font-medium transition-all shadow-lg inline-flex items-center">
                    <Plus className="w-5 h-5 mr-2" />
                    Add First Service
                </button>
            </div>
        </div>
    );
}
