'use client';

import { useAuth } from '@/lib/auth';
import { Boxes, Search, AlertTriangle } from 'lucide-react';

export default function InventoryPage() {
    const { tenant } = useAuth();

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Inventory</h1>
                    <p className="text-slate-500 dark:text-slate-400">
                        Track stock levels for {tenant?.name}
                    </p>
                </div>
            </div>

            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                    type="text"
                    placeholder="Search products..."
                    className="w-full pl-10 pr-4 py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all text-slate-900 dark:text-white placeholder-slate-400"
                />
            </div>

            {/* Stock Overview */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
                    <p className="text-sm text-slate-500 dark:text-slate-400">Total Products</p>
                    <p className="text-2xl font-bold text-slate-900 dark:text-white">0</p>
                </div>
                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
                    <p className="text-sm text-slate-500 dark:text-slate-400">Low Stock</p>
                    <p className="text-2xl font-bold text-yellow-600">0</p>
                </div>
                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
                    <p className="text-sm text-slate-500 dark:text-slate-400">Out of Stock</p>
                    <p className="text-2xl font-bold text-red-600">0</p>
                </div>
            </div>

            {/* Empty State */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-12 text-center">
                <div className="w-16 h-16 bg-primary-50 dark:bg-primary-900/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <Boxes className="w-8 h-8 text-primary-600 dark:text-primary-400" />
                </div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">No inventory to track</h3>
                <p className="text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
                    Add products first to start tracking inventory levels.
                </p>
            </div>
        </div>
    );
}
