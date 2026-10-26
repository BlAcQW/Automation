'use client';

import { useState } from 'react';
import { Plus, Mail, Trash2 } from 'lucide-react';
import {
    Button,
    FilterChips,
    Input,
    MoneyInput,
    PhoneInput,
    SearchInput,
    Select,
    Switch,
    Textarea,
    formatCedi,
} from '@bookingflow/ui';
import { Row, Section } from './section';

export function ActionsSection() {
    const [on, setOn] = useState(true);
    return (
        <Section title="Buttons" description="Min 44px, 12px corners, press scale 0.97. Gold accent once per screen.">
            <Row label="Variants">
                <Button>Save changes</Button>
                <Button variant="accent">Share your link</Button>
                <Button variant="secondary">Preview</Button>
                <Button variant="ghost">Skip for now</Button>
                <Button variant="destructive"><Trash2 className="h-4 w-4" aria-hidden /> Delete</Button>
            </Row>
            <Row label="Sizes · icon · loading · disabled">
                <Button size="sm"><Plus className="h-4 w-4" aria-hidden /> Add</Button>
                <Button size="md">Medium</Button>
                <Button size="lg">Large</Button>
                <Button size="icon" variant="secondary" aria-label="Email"><Mail className="h-5 w-5" /></Button>
                <Button isLoading loadingText="Saving…">Save</Button>
                <Button disabled>Disabled</Button>
            </Row>
            <Row label="Switch">
                <Switch checked={on} onChange={setOn} label="Take bookings on WhatsApp" />
                <span className="text-[15px] text-text">Take bookings on WhatsApp</span>
            </Row>
        </Section>
    );
}

export function FormsSection() {
    const [phone, setPhone] = useState('0244123456');
    const [e164, setE164] = useState<string | null>('+233244123456');
    const [money, setMoney] = useState('150');
    const [amount, setAmount] = useState<number | null>(150);
    const [q, setQ] = useState('Ama');
    const [chips, setChips] = useState<string[]>(['today']);

    return (
        <Section title="Forms" description="Large inputs, label above, hint below, inline error with icon.">
            <div className="grid gap-5 rounded-card border border-border bg-surface p-5 shadow-card sm:grid-cols-2 sm:p-6">
                <Input label="Business name" placeholder="Ama's Salon" hint="This is what customers see on WhatsApp." />
                <Input label="Email" type="email" defaultValue="ama@" error="That email doesn't look right. Check for typos." />
                <Input label="Password" type="password" defaultValue="secret123" />
                <Select label="Business type" defaultValue="salon" hint="You can change this later.">
                    <option value="salon">Salon / barber</option>
                    <option value="boutique">Boutique</option>
                    <option value="food">Food vendor</option>
                </Select>
                <PhoneInput
                    value={phone}
                    onChange={(display, full) => { setPhone(display); setE164(full); }}
                    hint={e164 ? `Saved as ${e164}` : 'Enter 9 digits after +233'}
                    required
                />
                <MoneyInput
                    label="Price"
                    value={money}
                    onChange={(text, n) => { setMoney(text); setAmount(n); }}
                    hint={amount === null ? 'Enter an amount' : `Shows as ${formatCedi(amount)}`}
                />
                <div className="sm:col-span-2">
                    <Textarea label="Welcome message" defaultValue="Hi! Thanks for messaging Ama's Salon. Reply 1 to book." hint="Sent when someone messages you for the first time." />
                </div>
            </div>
            <div className="space-y-3">
                <SearchInput value={q} onChange={setQ} placeholder="Search bookings" label="Search bookings" />
                <FilterChips
                    label="Filter bookings"
                    chips={[
                        { value: 'today', label: 'Today', count: 6 },
                        { value: 'week', label: 'This week', count: 21 },
                        { value: 'pending', label: 'Pending', count: 3 },
                        { value: 'paid', label: 'Paid' },
                        { value: 'cancelled', label: 'Cancelled' },
                    ]}
                    selected={chips}
                    onToggle={(v) => setChips((cur) => (cur.includes(v) ? cur.filter((c) => c !== v) : [...cur, v]))}
                />
            </div>
        </Section>
    );
}
