'use client';

import { useAuth } from '@/lib/auth';
import { Clock, Save } from 'lucide-react';

const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function AvailabilityPage() {
    const { tenant } = useAuth();

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Availability</h1>
                    <p className="text-slate-500 dark:text-slate-400">
                        Set working hours for {tenant?.name}
                    </p>
                </div>
                <button className="px-4 py-2 gradient-primary text-white rounded-lg hover:opacity-90 font-medium transition-all shadow-lg flex items-center">
                    <Save className="w-4 h-4 mr-2" />
                    Save Changes
                </button>
            </div>

            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700">
                    <h3 className="font-semibold text-slate-900 dark:text-white flex items-center">
                        <Clock className="w-5 h-5 mr-2 text-primary-600" />
                        Working Hours
                    </h3>
                </div>
                <div className="divide-y divide-slate-200 dark:divide-slate-700">
                    {days.map((day, idx) => (
                        <div key={day} className="px-6 py-4 flex items-center justify-between">
                            <div className="flex items-center space-x-4">
                                <input
                                    type="checkbox"
                                    defaultChecked={idx >= 1 && idx <= 5}
                                    className="w-4 h-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                                />
                                <span className="font-medium text-slate-900 dark:text-white w-28">{day}</span>
                            </div>
                            <div className="flex items-center space-x-2">
                                <input
                                    type="time"
                                    defaultValue="09:00"
                                    className="px-3 py-2 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white"
                                />
                                <span className="text-slate-400">to</span>
                                <input
                                    type="time"
                                    defaultValue="17:00"
                                    className="px-3 py-2 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white"
                                />
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
