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
                isActive: service?.isActive ?? true,
            });
        }
    }, [isOpen, service, reset]);

    const mutation = useMutation({
        mutationFn: async (data: ServiceFormData) => {
            if (isEditing) {
                const res = await api.patch(`/services/${service.id}`, data);
                return res.data;
            } else {
                const res = await api.post('/services', data);
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
