'use client';

/**
 * The two list editors on the knowledge page: the team (name + what they do)
 * and the questions customers ask (question + answer). Rows can be added,
 * edited, moved up and down, and removed (with a check when the row has text).
 */
import { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Button, ConfirmDialog, DashboardInput, Textarea } from '@bookingflow/ui';
import { CharCount } from './knowledge-inputs';
import {
    FAQ_PLACEHOLDER, LIMITS, TEAM_PLACEHOLDER, newKey,
    type KeyedFaq, type KeyedTeamMember,
} from './knowledge-fields';

function move<T>(rows: T[], from: number, to: number): T[] {
    if (to < 0 || to >= rows.length) return rows;
    const next = rows.slice();
    const [row] = next.splice(from, 1);
    next.splice(to, 0, row);
    return next;
}

interface RowControlsProps {
    index: number;
    count: number;
    what: string;
    disabled?: boolean;
    onMove: (to: number) => void;
    onRemove: () => void;
}

function RowControls({ index, count, what, disabled, onMove, onRemove }: RowControlsProps) {
    return (
        <div className="flex items-center gap-1">
            <Button type="button" variant="ghost" size="icon" disabled={disabled || index === 0} onClick={() => onMove(index - 1)} aria-label={`Move ${what} up`}>
                <ArrowUp className="h-4 w-4" />
            </Button>
            <Button type="button" variant="ghost" size="icon" disabled={disabled || index === count - 1} onClick={() => onMove(index + 1)} aria-label={`Move ${what} down`}>
                <ArrowDown className="h-4 w-4" />
            </Button>
            <Button type="button" variant="ghost" size="icon" disabled={disabled} onClick={onRemove} aria-label={`Remove ${what}`}>
                <Trash2 className="h-4 w-4" />
            </Button>
        </div>
    );
}

/** Asks before removing a row that has text in it; empty rows go at once. */
function useRemoveCheck<T>(rows: T[], hasText: (row: T) => boolean, remove: (i: number) => void) {
    const [pending, setPending] = useState<number | null>(null);
    const request = (i: number) => (hasText(rows[i]) ? setPending(i) : remove(i));
    const confirm = () => {
        if (pending !== null) remove(pending);
        setPending(null);
    };
    return { pending, request, confirm, cancel: () => setPending(null) };
}

interface TeamEditorProps {
    rows: KeyedTeamMember[];
    onChange: (rows: KeyedTeamMember[]) => void;
    errors: Record<string, string>;
    disabled?: boolean;
}

export function TeamEditor({ rows, onChange, errors, disabled }: TeamEditorProps) {
    const update = (i: number, patch: Partial<KeyedTeamMember>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    const removal = useRemoveCheck(rows, (r) => !!(r.name.trim() || r.role.trim()), (i) => onChange(rows.filter((_, j) => j !== i)));
    const full = rows.length >= LIMITS.team;

    return (
        <div className="space-y-4">
            {rows.length > 0 && (
                <ol className="space-y-3">
                    {rows.map((row, i) => (
                        <li key={row.key} className="rounded-control border border-border bg-surface-2/50 p-3 sm:p-4">
                            <div className="mb-2 flex items-center justify-between gap-2">
                                <span className="text-[14px] font-semibold text-muted">Person {i + 1}</span>
                                <RowControls index={i} count={rows.length} what={row.name.trim() || `person ${i + 1}`} disabled={disabled}
                                    onMove={(to) => onChange(move(rows, i, to))} onRemove={() => removal.request(i)} />
                            </div>
                            <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                                <DashboardInput
                                    id={`team-${row.key}-name`}
                                    label="Name"
                                    value={row.name}
                                    maxLength={LIMITS.teamName}
                                    placeholder={TEAM_PLACEHOLDER.name}
                                    error={errors[`team.${i}.name`]}
                                    disabled={disabled}
                                    autoComplete="off"
                                    onChange={(e) => update(i, { name: e.target.value })}
                                />
                                <div className="space-y-1">
                                    <DashboardInput
                                        id={`team-${row.key}-role`}
                                        label="What they do"
                                        value={row.role}
                                        maxLength={LIMITS.teamRole}
                                        placeholder={TEAM_PLACEHOLDER.role}
                                        error={errors[`team.${i}.role`]}
                                        disabled={disabled}
                                        autoComplete="off"
                                        onChange={(e) => update(i, { role: e.target.value })}
                                    />
                                    <CharCount value={row.role} limit={LIMITS.teamRole} />
                                </div>
                            </div>
                        </li>
                    ))}
                </ol>
            )}
            {!disabled && (
                <div className="flex flex-wrap items-center gap-3">
                    <Button type="button" variant="secondary" disabled={full} onClick={() => onChange([...rows, { key: newKey(), name: '', role: '' }])}>
                        <Plus className="h-4 w-4" aria-hidden /> Add a person
                    </Button>
                    <span className="text-[14px] text-muted">
                        {full ? `That's the most (${LIMITS.team}).` : `${rows.length} of ${LIMITS.team}`}
                    </span>
                </div>
            )}
            <ConfirmDialog
                isOpen={removal.pending !== null}
                onClose={removal.cancel}
                onConfirm={removal.confirm}
                title="Remove this person?"
                description="They come off the list when you save."
                confirmLabel="Remove"
                cancelLabel="Keep"
                destructive
            />
        </div>
    );
}

interface FaqEditorProps {
    rows: KeyedFaq[];
    onChange: (rows: KeyedFaq[]) => void;
    errors: Record<string, string>;
    disabled?: boolean;
}

export function FaqEditor({ rows, onChange, errors, disabled }: FaqEditorProps) {
    const update = (i: number, patch: Partial<KeyedFaq>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    const removal = useRemoveCheck(rows, (r) => !!(r.question.trim() || r.answer.trim()), (i) => onChange(rows.filter((_, j) => j !== i)));
    const full = rows.length >= LIMITS.faqs;

    return (
        <div className="space-y-4">
            {rows.length > 0 && (
                <ol className="space-y-3">
                    {rows.map((row, i) => (
                        <li key={row.key} className="rounded-control border border-border bg-surface-2/50 p-3 sm:p-4">
                            <div className="mb-2 flex items-center justify-between gap-2">
                                <span className="text-[14px] font-semibold text-muted">Question {i + 1}</span>
                                <RowControls index={i} count={rows.length} what={`question ${i + 1}`} disabled={disabled}
                                    onMove={(to) => onChange(move(rows, i, to))} onRemove={() => removal.request(i)} />
                            </div>
                            <div className="space-y-3">
                                <div className="space-y-1">
                                    <DashboardInput
                                        id={`faq-${row.key}-q`}
                                        label="Question"
                                        value={row.question}
                                        maxLength={LIMITS.faqQuestion}
                                        placeholder={FAQ_PLACEHOLDER.question}
                                        error={errors[`faqs.${i}.question`]}
                                        disabled={disabled}
                                        autoComplete="off"
                                        onChange={(e) => update(i, { question: e.target.value })}
                                    />
                                    <CharCount value={row.question} limit={LIMITS.faqQuestion} />
                                </div>
                                <div className="space-y-1">
                                    <Textarea
                                        id={`faq-${row.key}-a`}
                                        label="Your answer"
                                        rows={3}
                                        value={row.answer}
                                        maxLength={LIMITS.faqAnswer}
                                        placeholder={FAQ_PLACEHOLDER.answer}
                                        error={errors[`faqs.${i}.answer`]}
                                        disabled={disabled}
                                        onChange={(e) => update(i, { answer: e.target.value })}
                                    />
                                    <CharCount value={row.answer} limit={LIMITS.faqAnswer} />
                                </div>
                            </div>
                        </li>
                    ))}
                </ol>
            )}
            {!disabled && (
                <div className="flex flex-wrap items-center gap-3">
                    <Button type="button" variant="secondary" disabled={full} onClick={() => onChange([...rows, { key: newKey(), question: '', answer: '' }])}>
                        <Plus className="h-4 w-4" aria-hidden /> Add a question
                    </Button>
                    <span className="text-[14px] text-muted">
                        {full ? `That's the most (${LIMITS.faqs}).` : `${rows.length} of ${LIMITS.faqs}`}
                    </span>
                </div>
            )}
            <ConfirmDialog
                isOpen={removal.pending !== null}
                onClose={removal.cancel}
                onConfirm={removal.confirm}
                title="Remove this question?"
                description="It comes off the list when you save."
                confirmLabel="Remove"
                cancelLabel="Keep"
                destructive
            />
        </div>
    );
}
