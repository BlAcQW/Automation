'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { DashboardInput } from '@/components/ui/input';
import { toast } from 'react-hot-toast';

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

export function ServiceModal({ isOpen, onClose, service }: ServiceModalProps) {
    const queryClient = useQueryClient();
    const isEditing = !!service;

    const {
        register,
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
            toast.success(isEditing ? 'Service updated' : 'Service created');
            onClose();
        },
        onError: (error: any) => {
            toast.error(error.response?.data?.message || 'Something went wrong');
        },
    });

    const onSubmit = (data: ServiceFormData) => {
        mutation.mutate(data);
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={isEditing ? 'Edit Service' : 'Add New Service'}
        >
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                <DashboardInput
                    label="Service Name"
                    placeholder="e.g. Standard Consultation"
                    error={errors.name?.message}
                    {...register('name')}
                />

                <div className="grid grid-cols-2 gap-4">
                    <DashboardInput
                        label="Price ($)"
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        error={errors.price?.message}
                        {...register('price')}
                    />
                    <DashboardInput
                        label="Duration (Minutes)"
                        type="number"
                        placeholder="60"
                        error={errors.durationMinutes?.message}
                        {...register('durationMinutes')}
                    />
                </div>

                <DashboardInput
                    label="Category"
                    placeholder="e.g. Consulting"
                    error={errors.category?.message}
                    {...register('category')}
                />

                <DashboardInput
                    label="Description (Optional)"
                    placeholder="Brief description..."
                    error={errors.description?.message}
                    {...register('description')}
                />

                <DashboardInput
                    label="Deposit (Optional)"
                    type="number"
                    step="0.01"
                    placeholder="Leave blank for no deposit"
                    error={errors.depositAmount?.message as string | undefined}
                    {...register('depositAmount')}
                />
                <p className="text-xs text-slate-500 dark:text-slate-400 -mt-2">
                    If set, customers booking this service via WhatsApp will be sent a Paystack payment link.
                    The slot is held until paid.
                </p>

                <div className="flex justify-end gap-3 pt-4">
                    <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>
                        Cancel
                    </Button>
                    <Button type="submit" isLoading={isSubmitting}>
                        {isEditing ? 'Save Changes' : 'Create Service'}
                    </Button>
                </div>
            </form>
        </Modal>
    );
}
