'use client';

/**
 * The ten sections of "What your assistant should know", in page order. Each
 * is a settings card with its title, its one-line helper, and its fields. The
 * page owns the state; this only renders it.
 */
import type { ReactNode } from 'react';
import {
    CalendarClock, HeartHandshake, Languages, MapPin, MessageCircleQuestion,
    NotebookPen, Store, Tag, Truck, Users, Wallet,
} from 'lucide-react';
import { DashboardInput } from '@bookingflow/ui';
import { SettingsCard } from '@/app/settings/_components/settings-card';
import { KnowledgeTextField } from './knowledge-inputs';
import { FaqEditor, TeamEditor } from './list-editors';
import {
    SECTIONS, fieldLabel, fieldPlaceholder, isSectionFilled, offerExpired, sectionHelper, sectionTitle,
    type BusinessType, type KnowledgeForm as KnowledgeFormState, type SectionDef, type SectionId, type TextKey,
} from './knowledge-fields';

function sectionIcon(id: SectionId, type: BusinessType): ReactNode {
    switch (id) {
        case 'about': return <Store />;
        case 'team': return <Users />;
        case 'location': return <MapPin />;
        case 'bookingRules': return type === 'PRODUCT' ? <Truck /> : <CalendarClock />;
        case 'payments': return <Wallet />;
        case 'beforeAfter': return <HeartHandshake />;
        case 'offers': return <Tag />;
        case 'faqs': return <MessageCircleQuestion />;
        case 'tone': return <Languages />;
        case 'notes': return <NotebookPen />;
    }
}

interface KnowledgeFormProps {
    form: KnowledgeFormState;
    onChange: (next: KnowledgeFormState) => void;
    errors: Record<string, string>;
    businessType: BusinessType;
    readOnly: boolean;
}

export function KnowledgeForm({ form, onChange, errors, businessType, readOnly }: KnowledgeFormProps) {
    const set = <K extends keyof KnowledgeFormState>(key: K, value: KnowledgeFormState[K]) => onChange({ ...form, [key]: value });

    const textField = (s: SectionDef, key: TextKey) => {
        const def = s.fields.find((f) => f.key === key)!;
        return (
            <KnowledgeTextField
                key={key}
                id={`knowledge-${key}`}
                label={fieldLabel(def, businessType)}
                value={form[key]}
                onChange={(v) => set(key, v)}
                limit={def.limit}
                placeholder={fieldPlaceholder(def, businessType)}
                hint={def.hint}
                error={errors[key]}
                multiline={def.multiline}
                disabled={readOnly}
                type={key === 'mapsUrl' ? 'url' : 'text'}
            />
        );
    };

    return (
        <div className="space-y-5">
            {SECTIONS.map((s) => (
                <section key={s.id} id={`section-${s.id}`} className="scroll-mt-24" aria-label={sectionTitle(s, businessType)}>
                    <SettingsCard
                        icon={sectionIcon(s.id, businessType)}
                        title={sectionTitle(s, businessType)}
                        description={
                            <>
                                {sectionHelper(s, businessType)}
                                {isSectionFilled(s.id, form) && <span className="sr-only"> (filled)</span>}
                            </>
                        }
                    >
                        {s.id === 'team' && (
                            <TeamEditor rows={form.team} onChange={(rows) => set('team', rows)} errors={errors} disabled={readOnly} />
                        )}
                        {s.id === 'faqs' && (
                            <FaqEditor rows={form.faqs} onChange={(rows) => set('faqs', rows)} errors={errors} disabled={readOnly} />
                        )}
                        {s.fields.map((f) => textField(s, f.key))}
                        {s.id === 'offers' && (
                            <div className="max-w-xs space-y-1">
                                <DashboardInput
                                    id="knowledge-offerEndsOn"
                                    label="Ends on"
                                    type="date"
                                    value={form.offerEndsOn}
                                    onChange={(e) => set('offerEndsOn', e.target.value)}
                                    hint={offerExpired(form) ? 'This date has passed, so your assistant no longer mentions the offer.' : 'Optional. Leave empty if it has no end date.'}
                                    error={errors.offerEndsOn}
                                    disabled={readOnly}
                                />
                            </div>
                        )}
                    </SettingsCard>
                </section>
            ))}
        </div>
    );
}
