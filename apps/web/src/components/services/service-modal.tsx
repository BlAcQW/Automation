'use client';

import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Modal, Button, DashboardInput, MoneyInput, Textarea } from '@bookingflow/ui';
import { useTenantCurrency } from '@/lib/use-currency';
import { notify } from '@/components/brand/toast';

const serviceSchema = z.object({
    name: z.string().min(2, 'Name must be at least 2 characters'),
    description: z.string().optional(),
    price: z.coerce.number().min(0, 'Price must be positive'),
    durationMinutes: z.coerce.number().int().min(5, 'Duration must be at least 5 minutes'),
    category: z.string().optional(),
    // Kept as a string so the empty input doesn't fail z.number() validation.
    // Normalised to number | null in the submit handler.
    depositAmount: z.string().optional(),
    isActive: z.boolean().optional(),
});

type ServiceFormData = z.infer<typeof serviceSchema>;

interface Service {
    id: string;
    name: string;
    description?: string;
    price: number | string;
    durationMinutes: number;
    category?: string;
    depositAmount?: number | string | null;
    isActive: boolean;
}

interface ServiceModalProps {
    isOpen: boolean;
    onClose: () => void;
    service?: Service | null;
}

/** MoneyInput accepts "1,250.50"; the schema and API want plain "1250.50". */
const stripCommas = (text: string) => text.replace(/,/g, '');

export function ServiceModal({ isOpen, onClose, service }: ServiceModalProps) {
    const queryClient = useQueryClient();
    const currency = useTenantCurrency();
    const isEditing = !!service;
    const isCedi = currency.toUpperCase() === 'GHS';

    const {
        register,
        control,
        handleSubmit,
        reset,
        formState: { errors, isSubmitting },
    } = useForm<ServiceFormData>({
        resolver: zodResolver(serviceSchema),
        defaultValues: {
            name: '',
            description: '',
            price: 0,
            durationMinutes: 60,
            category: '',
            isActive: true,
        },
    });

    useEffect(() => {
        if (isOpen) {
            reset({
                name: service?.name || '',
                description: service?.description || '',
                price: service?.price ? Number(service.price) : 0,
                durationMinutes: service?.durationMinutes || 60,
                category: service?.category || '',
                depositAmount:
                    service?.depositAmount != null && service.depositAmount !== ''
                        ? String(service.depositAmount)
                        : '',
                isActive: service?.isActive ?? true,
            });
        }
    }, [isOpen, service, reset]);

    const mutation = useMutation({
        mutationFn: async (data: ServiceFormData) => {
            // Convert the deposit form-string to a number | null for the API.
            const trimmed = (data.depositAmount ?? '').toString().trim();
            const depositAmount = trimmed === '' ? null : Number(trimmed);
            const payload = {
                ...data,
                depositAmount: Number.isFinite(depositAmount as number) ? depositAmount : null,
            };
            if (isEditing) {
                const res = await api.patch(`/services/${service.id}`, payload);
                return res.data;
            } else {
                const res = await api.post('/services', payload);
                return res.data;
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['services'] });
            notify.success(isEditing ? 'Service saved' : 'Service added. Customers can book it now');
            onClose();
        },
        onError: (error: any) => {
            notify.error(error.response?.data?.message || "Oops, that didn't save. Let's try again.");
        },
    });

    const onSubmit = (data: ServiceFormData) => {
        mutation.mutate(data);
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={isEditing ? 'Edit service' : 'Add a service'}
            description={isEditing ? undefined : 'Customers see this when they book on WhatsApp.'}
            maxWidth="max-w-lg"
        >
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                <DashboardInput
                    label="Service name"
                    placeholder="e.g. Braids, haircut, consultation"
                    error={errors.name?.message}
                    {...register('name')}
                />

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Controller
                        control={control}
                        name="price"
                        render={({ field }) => (
                            <MoneyInput
                                label={isCedi ? 'Price' : `Price (${currency})`}
                                name={field.name}
                                ref={field.ref}
                                onBlur={field.onBlur}
                                value={field.value === undefined || field.value === null ? '' : String(field.value)}
                                onChange={(text) => field.onChange(stripCommas(text))}
                                error={errors.price?.message}
                            />
                        )}
                    />
                    <DashboardInput
                        label="How long it takes (minutes)"
                        type="number"
                        inputMode="numeric"
                        placeholder="60"
                        error={errors.durationMinutes?.message}
                        {...register('durationMinutes')}
                    />
                </div>

                <DashboardInput
                    label="Category (optional)"
                    placeholder="e.g. Hair, nails, massage"
                    error={errors.category?.message}
                    {...register('category')}
                />

                <Textarea
                    label="Description (optional)"
                    placeholder="A short line about what's included"
                    rows={3}
                    error={errors.description?.message}
                    {...register('description')}
                />

                <Controller
                    control={control}
                    name="depositAmount"
                    render={({ field }) => (
                        <MoneyInput
                            label={isCedi ? 'Deposit (optional)' : `Deposit in ${currency} (optional)`}
                            placeholder="Leave blank for no deposit"
                            name={field.name}
                            ref={field.ref}
                            onBlur={field.onBlur}
                            value={field.value ?? ''}
                            onChange={(text) => field.onChange(stripCommas(text))}
                            error={errors.depositAmount?.message as string | undefined}
                            hint="We'll send the customer a payment link on WhatsApp and hold the slot until they pay."
                        />
                    )}
                />

                <div className="flex flex-col-reverse gap-2 pt-4 sm:flex-row sm:justify-end">
                    <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>
                        Cancel
                    </Button>
                    <Button type="submit" isLoading={isSubmitting || mutation.isPending} loadingText="Saving…">
                        {isEditing ? 'Save changes' : 'Add service'}
                    </Button>
                </div>
            </form>
        </Modal>
    );
}
