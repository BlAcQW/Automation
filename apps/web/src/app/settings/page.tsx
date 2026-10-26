'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
    Store, User as UserIcon, Lock, Calendar, ExternalLink, Banknote, BellRing, ShieldCheck,
    Boxes, Users, Smartphone, FileText, Clock, ChevronRight, Trash2, Code2,
} from 'lucide-react';
import {
    Button, DashboardInput, Switch, Select, MoneyInput, PageHeader, SectionHeading, ConfirmDialog, Card,
} from '@bookingflow/ui';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { notify } from '@/components/brand/toast';
import { PayazaCard } from '@/components/payments/payaza-card';
import { ConnectionRow } from '@/components/payments/connection-parts';
import { SettingsCard, ToggleRow, SaveRow, useSavedFlash } from './_components/settings-card';
import { PlanAndUsageCard } from './_components/plan-card';
import { SmsFallbackCard, EmailFallbackCard } from './_components/fallback-cards';
import { PaystackCard, type PaymentsStatus, type SupportedCurrency } from './_components/paystack-card';

// Where our customers are, first. The rest of the world after.
const TIMEZONES = [
    'Africa/Accra', 'Africa/Lagos', 'Africa/Abidjan', 'Africa/Dakar', 'Africa/Nairobi',
    'Africa/Johannesburg', 'Africa/Cairo', 'Africa/Casablanca', 'Africa/Kinshasa',
    'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'America/New_York', 'America/Chicago',
    'America/Los_Angeles', 'Asia/Dubai', 'Asia/Singapore', 'Australia/Sydney', 'UTC',
];

const SAVE_ERROR = "Couldn't save. Check your connection and try again.";

export default function SettingsPage() {
    const { tenant, user, refreshUser } = useAuth();
    const [saving, setSaving] = useState(false);
    const [businessSaved, flashBusiness] = useSavedFlash();
    const [profileSaved, flashProfile] = useSavedFlash();
    const [passwordSaved, flashPassword] = useSavedFlash();
    const [depositSaved, flashDeposit] = useSavedFlash();

    // Out-of-window messages master toggle
    const [outOfWindowEnabled, setOutOfWindowEnabled] = useState(true);
    const [togglingMessages, setTogglingMessages] = useState(false);

    // Deposits: a booking is only confirmed once the deposit is paid.
    const [depositRequired, setDepositRequired] = useState(true);
    const [maskContacts, setMaskContacts] = useState(true);
    const [togglingMask, setTogglingMask] = useState(false);
    const [depositAmount, setDepositAmount] = useState('50');
    const [depositError, setDepositError] = useState('');
    const [savingDeposit, setSavingDeposit] = useState(false);

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
    const [passwordError, setPasswordError] = useState('');

    // Calendar
    const [calendarStatus, setCalendarStatus] = useState<{ connected: boolean; provider: string | null } | null>(null);
    const [connecting, setConnecting] = useState(false);
    const [confirmCalendar, setConfirmCalendar] = useState(false);
    const [disconnectingCalendar, setDisconnectingCalendar] = useState(false);

    // Payments (Paystack + Payaza)
    const [paymentsStatus, setPaymentsStatus] = useState<PaymentsStatus | null>(null);
    const [paymentsCurrency, setPaymentsCurrency] = useState<SupportedCurrency>('NGN');

    // Delete account
    const [deleting, setDeleting] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);

    const currency = tenant?.currency ?? 'GHS';
    const isOwner = user?.role === 'OWNER';

    useEffect(() => {
        if (tenant) {
            setBusinessName(tenant.name);
            setTimezone(tenant.timezone || 'UTC');
            setOutOfWindowEnabled(tenant.outOfWindowMessagesEnabled ?? true);
            setDepositRequired(tenant.depositRequired ?? true);
            setMaskContacts(tenant.maskCustomerContact ?? true);
            setDepositAmount(String(tenant.defaultDepositAmount ?? 50));
        }
        if (user) {
            setName(user.name);
            setEmail(user.email);
        }
        fetchCalendarStatus();
    }, [tenant, user]);

    useEffect(() => {
        fetchPaymentsStatus();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const fetchPaymentsStatus = async () => {
        try {
            const res = await api.get('/payments/status');
            setPaymentsStatus(res.data);
            if (res.data?.currency) {
                setPaymentsCurrency(res.data.currency as SupportedCurrency);
            }
        } catch {
            // Silent: payments status endpoint may not be ready
        }
    };

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
        try {
            await api.patch('/auth/profile', { businessName, timezone });
            await refreshUser();
            notify.success('Business details saved');
            flashBusiness();
        } catch (err) {
            console.error('Failed to save business settings:', err);
            notify.error(SAVE_ERROR);
        } finally {
            setSaving(false);
        }
    };

    const requestDeletion = async () => {
        setDeleting(true);
        try {
            await api.post('/auth/delete-request', {});
            await refreshUser();
            setConfirmDelete(false);
            notify.success("Request received. We'll email you to confirm.");
        } catch (err: any) {
            notify.error(err?.response?.data?.message ?? "Couldn't send the request. Let's try again.");
        } finally {
            setDeleting(false);
        }
    };

    const saveDeposit = async () => {
        const amount = Number(depositAmount.replace(/[^0-9.]/g, ''));
        if (depositRequired && (!Number.isFinite(amount) || amount <= 0)) {
            const msg = 'Enter a deposit above 0, or switch deposits off.';
            setDepositError(msg);
            notify.error(msg);
            return;
        }
        setDepositError('');
        setSavingDeposit(true);
        try {
            await api.patch('/auth/profile', {
                depositRequired,
                ...(Number.isFinite(amount) && amount > 0 ? { defaultDepositAmount: amount } : {}),
            });
            await refreshUser();
            notify.success(depositRequired ? `Deposits on: ${currency} ${amount.toFixed(2)}` : 'Deposits off');
            flashDeposit();
        } catch (err) {
            console.error('Failed to save deposit settings:', err);
            notify.error(SAVE_ERROR);
        } finally {
            setSavingDeposit(false);
        }
    };

    const toggleMaskContacts = async (next: boolean) => {
        setTogglingMask(true);
        setMaskContacts(next);
        try {
            await api.patch('/auth/profile', { maskCustomerContact: next });
            await refreshUser();
            notify.success(next ? 'Customer numbers are now hidden from staff' : 'Staff can now see full customer numbers');
        } catch (err) {
            setMaskContacts(!next);
            notify.error("Couldn't change that setting. Let's try again.");
            console.error('Failed to toggle contact masking:', err);
        } finally {
            setTogglingMask(false);
        }
    };

    const toggleOutOfWindow = async (next: boolean) => {
        setTogglingMessages(true);
        // Optimistic flip — revert on failure.
        setOutOfWindowEnabled(next);
        try {
            await api.patch('/auth/profile', { outOfWindowMessagesEnabled: next });
            await refreshUser();
            notify.success(next ? 'Reminders and updates are on' : 'Reminders and updates are off');
        } catch (err) {
            setOutOfWindowEnabled(!next);
            notify.error("Couldn't change that setting. Let's try again.");
            console.error('Failed to toggle out-of-window messages:', err);
        } finally {
            setTogglingMessages(false);
        }
    };

    const saveProfile = async () => {
        setSaving(true);
        try {
            await api.put('/users/me', { name, email });
            notify.success('Profile saved');
            flashProfile();
        } catch (err) {
            console.error('Failed to save profile:', err);
            notify.error(SAVE_ERROR);
        } finally {
            setSaving(false);
        }
    };

    const changePassword = async () => {
        if (newPassword !== confirmPassword) {
            setPasswordError("These passwords don't match. Type the new one again.");
            return;
        }
        setPasswordError('');
        setSaving(true);
        try {
            await api.put('/users/me/password', { currentPassword, newPassword });
            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');
            notify.success('Password changed');
            flashPassword();
        } catch (err) {
            console.error('Failed to change password:', err);
            notify.error("Couldn't change your password. Check your current password and try again.");
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
            notify.error("Couldn't open Google. Let's try again.");
            setConnecting(false);
        }
    };

    const disconnectCalendar = async () => {
        setDisconnectingCalendar(true);
        try {
            await api.delete('/calendar/disconnect');
            setConfirmCalendar(false);
            notify.success('Google Calendar disconnected');
            fetchCalendarStatus();
        } catch (err) {
            console.error('Failed to disconnect calendar:', err);
            notify.error("Couldn't disconnect. Let's try again.");
        } finally {
            setDisconnectingCalendar(false);
        }
    };

    const moreLinks = [
        ...(tenant?.businessType === 'PRODUCT'
            ? [
                  { name: 'Stock', href: '/inventory', icon: Boxes },
                  { name: 'Customers', href: '/customers', icon: Users },
                  { name: 'WhatsApp', href: '/whatsapp', icon: Smartphone },
                  { name: 'Message templates', href: '/templates', icon: FileText },
              ]
            : [
                  { name: 'Opening hours', href: '/availability', icon: Clock },
                  { name: 'WhatsApp', href: '/whatsapp', icon: Smartphone },
                  { name: 'Message templates', href: '/templates', icon: FileText },
              ]),
        // API keys and webhooks: owner only (the page explains this to staff).
        ...(isOwner ? [{ name: 'Developer tools (API keys, webhooks)', href: '/settings/developer', icon: Code2 }] : []),
    ];

    return (
        <div className="max-w-3xl space-y-8">
            <PageHeader title="Settings" subtitle="Your business, your account, and how you get paid." />

            {/* More: hub links to secondary pages not in the bottom tab bar */}
            <section aria-labelledby="settings-more" className="space-y-3">
                <h2 id="settings-more" className="text-small font-semibold uppercase tracking-wide text-muted">More pages</h2>
                <Card className="overflow-hidden">
                    <ul className="divide-y divide-border">
                        {moreLinks.map((link) => (
                            <li key={link.href}>
                                <Link
                                    href={link.href}
                                    className="flex min-h-[56px] items-center gap-3 px-5 py-3 transition-colors duration-ui hover:bg-surface-2"
                                >
                                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-primary-soft text-primary">
                                        <link.icon className="h-[18px] w-[18px]" aria-hidden />
                                    </span>
                                    <span className="flex-1 text-base font-medium text-text">{link.name}</span>
                                    <ChevronRight className="h-5 w-5 text-muted" aria-hidden />
                                </Link>
                            </li>
                        ))}
                    </ul>
                </Card>
            </section>

            {/* ---------------------------------------------------------- Your business */}
            <section className="space-y-4">
                <SectionHeading title="Your business" />

                <SettingsCard icon={<Store />} title="Business details" description="How your business shows to customers.">
                    <DashboardInput
                        label="Business name"
                        value={businessName}
                        onChange={(e) => setBusinessName(e.target.value)}
                    />
                    <Select
                        label="Time zone"
                        hint="Bookings and reminders use this time."
                        value={timezone}
                        onChange={(e) => setTimezone(e.target.value)}
                    >
                        {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz.replace(/_/g, ' ')}</option>)}
                    </Select>
                    <p className="text-[15px] text-muted">
                        Prices and deposits are in <span className="font-semibold text-text">{currency === 'GHS' ? 'Ghana cedis (GH₵)' : currency}</span>.
                        You can change the currency under Paystack below.
                    </p>
                    <SaveRow saved={businessSaved}>
                        <Button onClick={saveBusiness} isLoading={saving}>Save changes</Button>
                    </SaveRow>
                </SettingsCard>

                <SettingsCard
                    icon={<Banknote />}
                    title="Deposits"
                    description="Hold the slot until the customer pays, so no-shows don't cost you."
                >
                    <ToggleRow
                        title="Ask for a deposit before a booking is confirmed"
                        description="Bookly holds the time and sends a payment link. The booking is confirmed once the deposit is paid. If it isn't paid within 30 minutes, the slot opens up again."
                        control={
                            <Switch
                                checked={depositRequired}
                                onChange={setDepositRequired}
                                disabled={savingDeposit}
                                label="Require a deposit"
                            />
                        }
                    />
                    {depositRequired && (
                        <div className="max-w-xs">
                            {currency === 'GHS' ? (
                                <MoneyInput
                                    label="Deposit amount"
                                    value={depositAmount}
                                    onChange={(text) => { setDepositAmount(text); setDepositError(''); }}
                                    placeholder="50"
                                    error={depositError || undefined}
                                    hint="Used for every service, unless you set a different deposit on the service itself."
                                />
                            ) : (
                                <DashboardInput
                                    label={`Deposit amount (${currency})`}
                                    type="number"
                                    min={1}
                                    step="1"
                                    inputMode="decimal"
                                    value={depositAmount}
                                    onChange={(e) => { setDepositAmount(e.target.value); setDepositError(''); }}
                                    placeholder="50"
                                    error={depositError || undefined}
                                    hint="Used for every service, unless you set a different deposit on the service itself."
                                />
                            )}
                        </div>
                    )}
                    <SaveRow saved={depositSaved}>
                        <Button onClick={saveDeposit} isLoading={savingDeposit}>Save deposit settings</Button>
                    </SaveRow>
                </SettingsCard>

                <SettingsCard icon={<ShieldCheck />} title="Customer privacy">
                    <ToggleRow
                        title="Hide customer numbers from staff"
                        description="Your team only sees the last four digits, so your customer list can't be copied out. They can still reply in the chat, and can show one number when they need it (we keep a record). You always see full numbers."
                        control={
                            <Switch
                                checked={maskContacts}
                                onChange={toggleMaskContacts}
                                disabled={togglingMask}
                                label="Hide customer numbers from staff"
                            />
                        }
                    />
                </SettingsCard>

                <SettingsCard icon={<BellRing />} title="Reminders & updates">
                    <ToggleRow
                        title="Send reminders and order updates"
                        description="When this is off, Bookly won't send appointment reminders or delivery updates. You'll spend fewer messages, but customers won't be reminded."
                        control={
                            <Switch
                                checked={outOfWindowEnabled}
                                onChange={toggleOutOfWindow}
                                disabled={togglingMessages}
                                label="Automated reminders and updates"
                            />
                        }
                    />
                </SettingsCard>
            </section>

            {/* ---------------------------------------------------------- Plan & billing */}
            <section className="space-y-4">
                <SectionHeading title="Plan & billing" />
                <PlanAndUsageCard />
            </section>

            {/* ---------------------------------------------------------- Getting paid */}
            <section className="space-y-4">
                <SectionHeading title="Getting paid" description="Connect a payment provider so customers can pay you by mobile money or card." />
                <PaystackCard
                    status={paymentsStatus}
                    canEdit={isOwner}
                    initialCurrency={paymentsCurrency}
                    onChanged={fetchPaymentsStatus}
                />
                {/* Payaza: second payment provider (ride and flow payment links) */}
                {paymentsStatus?.payaza && (
                    <PayazaCard
                        status={paymentsStatus.payaza}
                        selected={paymentsStatus.provider === 'PAYAZA'}
                        canEdit={isOwner}
                        onChanged={fetchPaymentsStatus}
                    />
                )}
            </section>

            {/* ---------------------------------------------------------- Connections */}
            <section className="space-y-4">
                <SectionHeading title="Connected apps" />
                <SettingsCard icon={<Calendar />} title="Google Calendar" description="See every booking in your own calendar.">
                    {calendarStatus?.connected ? (
                        <ConnectionRow
                            connected
                            name="Google Calendar"
                            icon={<Calendar />}
                            detail="New bookings appear in your calendar automatically."
                            action={
                                <Button variant="secondary" size="sm" onClick={() => setConfirmCalendar(true)}>
                                    Disconnect
                                </Button>
                            }
                        />
                    ) : (
                        <ConnectionRow
                            connected={false}
                            name="Google Calendar"
                            icon={<Calendar />}
                            detail="Connect it to see your bookings next to everything else."
                            action={
                                <Button size="sm" onClick={connectCalendar} isLoading={connecting}>
                                    <ExternalLink className="h-4 w-4" aria-hidden /> Connect
                                </Button>
                            }
                        />
                    )}
                </SettingsCard>
                <SmsFallbackCard />
                <EmailFallbackCard />
            </section>

            {/* ---------------------------------------------------------- Your account */}
            <section className="space-y-4">
                <SectionHeading title="Your account" />
                <SettingsCard icon={<UserIcon />} title="Profile">
                    <DashboardInput label="Your name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
                    <DashboardInput label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
                    <SaveRow saved={profileSaved}>
                        <Button onClick={saveProfile} isLoading={saving}>Save profile</Button>
                    </SaveRow>
                </SettingsCard>

                <SettingsCard icon={<Lock />} title="Password">
                    <DashboardInput
                        label="Current password"
                        type="password"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        autoComplete="current-password"
                    />
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <DashboardInput
                            label="New password"
                            type="password"
                            value={newPassword}
                            onChange={(e) => { setNewPassword(e.target.value); setPasswordError(''); }}
                            autoComplete="new-password"
                        />
                        <DashboardInput
                            label="Type it again"
                            type="password"
                            value={confirmPassword}
                            onChange={(e) => { setConfirmPassword(e.target.value); setPasswordError(''); }}
                            error={passwordError || undefined}
                            autoComplete="new-password"
                        />
                    </div>
                    <SaveRow saved={passwordSaved} label="Password changed">
                        <Button onClick={changePassword} isLoading={saving} disabled={!currentPassword || !newPassword}>
                            Change password
                        </Button>
                    </SaveRow>
                </SettingsCard>

                {/* Delete account: a request a person confirms, never a one-click wipe. */}
                {isOwner && (
                    <SettingsCard icon={<Trash2 />} title="Delete account" tone="danger">
                        {tenant?.deletionRequestedAt ? (
                            <p className="max-w-[60ch] text-[15px] leading-relaxed text-text">
                                We got your request on{' '}
                                {new Date(tenant.deletionRequestedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.
                                Someone from our team will confirm it with you within 7 days, then remove your business,
                                chats and bookings. Changed your mind? Just reply to that email.
                            </p>
                        ) : (
                            <>
                                <p className="max-w-[60ch] text-[15px] leading-relaxed text-muted">
                                    This removes your business, every chat and every booking, and disconnects your WhatsApp
                                    number from Bookly. We check with you first: nothing is deleted the moment you tap.
                                </p>
                                <Button variant="destructive" onClick={() => setConfirmDelete(true)} isLoading={deleting}>
                                    Ask to delete my account
                                </Button>
                            </>
                        )}
                    </SettingsCard>
                )}
            </section>

            <ConfirmDialog
                isOpen={confirmCalendar}
                onClose={() => setConfirmCalendar(false)}
                onConfirm={disconnectCalendar}
                isLoading={disconnectingCalendar}
                title="Disconnect Google Calendar?"
                description="New bookings will stop appearing in your calendar. Bookings already there stay."
                confirmLabel="Disconnect"
                cancelLabel="Keep connected"
            />
            <ConfirmDialog
                isOpen={confirmDelete}
                onClose={() => setConfirmDelete(false)}
                onConfirm={requestDeletion}
                isLoading={deleting}
                title="Ask us to delete your account?"
                description="We'll email you to confirm before anything is removed."
                confirmLabel="Send request"
                cancelLabel="Keep my account"
            />
        </div>
    );
}
