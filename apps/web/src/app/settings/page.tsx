'use client';

import { useAuth } from '@/lib/auth';
import { Settings, User, Bell, Smartphone, Save } from 'lucide-react';

export default function SettingsPage() {
    const { user, tenant } = useAuth();

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Settings</h1>
                <p className="text-slate-500 dark:text-slate-400">
                    Manage your account and business settings
                </p>
            </div>

            <div className="grid gap-6">
                {/* Business Info */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                    <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700">
                        <h3 className="font-semibold text-slate-900 dark:text-white flex items-center">
                            <Settings className="w-5 h-5 mr-2 text-primary-600" />
                            Business Information
                        </h3>
                    </div>
                    <div className="p-6 space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                Business Name
                            </label>
                            <input
                                type="text"
                                defaultValue={tenant?.name}
                                className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                Timezone
                            </label>
                            <select className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white">
                                <option>UTC</option>
                                <option>America/New_York</option>
                                <option>Europe/London</option>
                            </select>
                        </div>
                    </div>
                </div>

                {/* Profile */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                    <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700">
                        <h3 className="font-semibold text-slate-900 dark:text-white flex items-center">
                            <User className="w-5 h-5 mr-2 text-primary-600" />
                            Your Profile
                        </h3>
                    </div>
                    <div className="p-6 space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                Name
                            </label>
                            <input
                                type="text"
                                defaultValue={user?.name}
                                className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                Email
                            </label>
                            <input
                                type="email"
                                defaultValue={user?.email}
                                disabled
                                className="w-full px-4 py-2 bg-slate-100 dark:bg-slate-600 border border-slate-200 dark:border-slate-600 rounded-lg text-slate-500 dark:text-slate-400"
                            />
                        </div>
                    </div>
                </div>

                {/* WhatsApp */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                    <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700">
                        <h3 className="font-semibold text-slate-900 dark:text-white flex items-center">
                            <Smartphone className="w-5 h-5 mr-2 text-green-600" />
                            WhatsApp Integration
                        </h3>
                    </div>
                    <div className="p-6">
                        <p className="text-slate-500 dark:text-slate-400 mb-4">
                            Connect your WhatsApp Business account to receive bookings.
                        </p>
                        <button className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium transition-all">
                            Connect WhatsApp
                        </button>
                    </div>
                </div>
            </div>

            <div className="flex justify-end">
                <button className="px-6 py-3 gradient-primary text-white rounded-xl hover:opacity-90 font-medium transition-all shadow-lg flex items-center">
                    <Save className="w-5 h-5 mr-2" />
                    Save All Changes
                </button>
            </div>
        </div>
    );
}
