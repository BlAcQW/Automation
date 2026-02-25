'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { motion } from 'framer-motion';
import {
    Building, User as UserIcon, Lock, Calendar, Save, Loader2, CheckCircle, ExternalLink
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DashboardInput } from '@/components/ui/input';

export default function SettingsPage() {
    const { tenant, user } = useAuth();
    const [saving, setSaving] = useState(false);
    const [success, setSuccess] = useState('');

    // Business settings
    const [businessName, setBusinessName] = useState('');
    const [timezone, setTimezone] = useState('UTC');

    // Profile settings
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');

    // Password
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');

    // Calendar
    const [calendarStatus, setCalendarStatus] = useState<{ connected: boolean; provider: string | null } | null>(null);
    const [connecting, setConnecting] = useState(false);

    const timezones = [
        'UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
        'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Asia/Tokyo', 'Asia/Singapore',
        'Australia/Sydney', 'Pacific/Auckland'
    ];

    useEffect(() => {
        if (tenant) {
            setBusinessName(tenant.name);
            setTimezone(tenant.timezone || 'UTC');
        }
        if (user) {
            setName(user.name);
            setEmail(user.email);
        }
        fetchCalendarStatus();
    }, [tenant, user]);

    const fetchCalendarStatus = async () => {
        try {
            const response = await api.get('/calendar/status');
            setCalendarStatus(response.data.data);
        } catch (err) {
            console.error('Failed to fetch calendar status:', err);
        }
    };

    const saveBusiness = async () => {
        setSaving(true);
        setSuccess('');
        try {
            await api.put('/tenant', { name: businessName, timezone });
            setSuccess('Business settings saved');
            setTimeout(() => setSuccess(''), 3000);
        } catch (err) {
            console.error('Failed to save business settings:', err);
        } finally {
            setSaving(false);
        }
    };

    const saveProfile = async () => {
        setSaving(true);
        setSuccess('');
        try {
            await api.put('/users/me', { name, email });
            setSuccess('Profile saved');
            setTimeout(() => setSuccess(''), 3000);
        } catch (err) {
            console.error('Failed to save profile:', err);
        } finally {
            setSaving(false);
        }
    };

    const changePassword = async () => {
        if (newPassword !== confirmPassword) {
            alert('Passwords do not match');
            return;
        }
        setSaving(true);
        try {
            await api.put('/users/me/password', { currentPassword, newPassword });
            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');
            setSuccess('Password changed');
            setTimeout(() => setSuccess(''), 3000);
        } catch (err) {
            console.error('Failed to change password:', err);
        } finally {
            setSaving(false);
        }
    };

    const connectCalendar = async () => {
        setConnecting(true);
        try {
            const response = await api.get('/calendar/auth-url');
            window.location.href = response.data.data.url;
        } catch (err) {
            console.error('Failed to connect calendar:', err);
            setConnecting(false);
        }
    };

    const disconnectCalendar = async () => {
        try {
            await api.delete('/calendar/disconnect');
            fetchCalendarStatus();
        } catch (err) {
            console.error('Failed to disconnect calendar:', err);
        }
    };

    return (
        <div className="space-y-6 max-w-3xl">
            {/* Page Header */}
            <div>
                <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Settings</h1>
                <p className="text-slate-500 dark:text-slate-400 mt-1">
                    Manage your business and account preferences
                </p>
            </div>

            {/* Success Banner */}
            {success && (
                <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700/50 text-emerald-700 dark:text-emerald-300 px-4 py-3 rounded-xl flex items-center gap-2 text-sm"
                >
                    <CheckCircle className="w-4 h-4" /> {success}
                </motion.div>
            )}

            {/* Business Settings */}
            <Card>
                <CardHeader>
                    <CardTitle>
                        <Building className="w-5 h-5 text-emerald-500" />
                        Business Information
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <DashboardInput
                        label="Business Name"
                        value={businessName}
                        onChange={(e) => setBusinessName(e.target.value)}
                    />
                    <div className="space-y-1.5">
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Timezone</label>
                        <select
                            value={timezone}
                            onChange={(e) => setTimezone(e.target.value)}
                            className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500/50 transition-all"
                        >
                            {timezones.map(tz => <option key={tz} value={tz}>{tz}</option>)}
                        </select>
                    </div>
                    <div className="pt-2">
                        <Button onClick={saveBusiness} isLoading={saving}>
                            <Save className="w-4 h-4" /> Save Changes
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {/* Profile Settings */}
            <Card>
                <CardHeader>
                    <CardTitle>
                        <UserIcon className="w-5 h-5 text-blue-500" />
                        Profile
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <DashboardInput
                        label="Name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                    />
                    <DashboardInput
                        label="Email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                    />
                    <div className="pt-2">
                        <Button onClick={saveProfile} isLoading={saving}>
                            <Save className="w-4 h-4" /> Save Profile
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {/* Password */}
            <Card>
                <CardHeader>
                    <CardTitle>
                        <Lock className="w-5 h-5 text-amber-500" />
                        Change Password
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <DashboardInput
                        label="Current Password"
                        type="password"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                    />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <DashboardInput
                            label="New Password"
                            type="password"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                        />
                        <DashboardInput
                            label="Confirm Password"
                            type="password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                        />
                    </div>
                    <div className="pt-2">
                        <Button onClick={changePassword} isLoading={saving} disabled={!currentPassword || !newPassword}>
                            Update Password
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {/* Calendar Integration */}
            <Card>
                <CardHeader>
                    <CardTitle>
                        <Calendar className="w-5 h-5 text-purple-500" />
                        Calendar Integration
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {calendarStatus?.connected ? (
                        <div className="flex items-center justify-between p-4 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl border border-emerald-200 dark:border-emerald-700/50">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                                    <CheckCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                                </div>
                                <div>
                                    <p className="font-medium text-emerald-900 dark:text-emerald-200 text-sm">Google Calendar Connected</p>
                                    <p className="text-emerald-700 dark:text-emerald-300 text-xs">Bookings will sync automatically</p>
                                </div>
                            </div>
                            <Button variant="destructive" size="sm" onClick={disconnectCalendar}>
                                Disconnect
                            </Button>
                        </div>
                    ) : (
                        <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-700/30 rounded-xl border border-slate-200 dark:border-slate-600">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
                                    <Calendar className="w-5 h-5 text-slate-500" />
                                </div>
                                <div>
                                    <p className="font-medium text-slate-900 dark:text-slate-200 text-sm">Google Calendar</p>
                                    <p className="text-slate-500 dark:text-slate-400 text-xs">Sync bookings with your calendar</p>
                                </div>
                            </div>
                            <Button size="sm" onClick={connectCalendar} isLoading={connecting}>
                                <ExternalLink className="w-4 h-4" /> Connect
                            </Button>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
