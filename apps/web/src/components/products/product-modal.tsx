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

// Schema matches API validation
const productSchema = z.object({
    name: z.string().min(2, 'Name must be at least 2 characters'),
    description: z.string().optional(),
    price: z.coerce.number().positive('Price must be positive'),
    stock: z.coerce.number().int().min(0, 'Stock cannot be negative'),
    category: z.string().optional(),
    imageUrl: z.string().url('Invalid URL').optional().or(z.literal('')),
});

type ProductFormData = z.infer<typeof productSchema>;

interface Product {
    id: string;
    name: string;
    description?: string;
    price: number | string;
    stock: number;
    category?: string;
    imageUrl?: string;
    isActive: boolean;
}

interface ProductModalProps {
    isOpen: boolean;
    onClose: () => void;
    product?: Product | null; // If provided, we are editing
}

export function ProductModal({ isOpen, onClose, product }: ProductModalProps) {
    const queryClient = useQueryClient();
    const isEditing = !!product;

    const {
        register,
        handleSubmit,
        reset,
        formState: { errors, isSubmitting },
    } = useForm<ProductFormData>({
        resolver: zodResolver(productSchema),
        defaultValues: {
            name: '',
            description: '',
            price: 0,
            stock: 0,
            category: '',
            imageUrl: '',
        },
    });

    // Reset form when modal opens/closes or product changes
    useEffect(() => {
        if (isOpen) {
            reset({
                name: product?.name || '',
                description: product?.description || '',
                price: product?.price ? Number(product.price) : 0,
                stock: product?.stock || 0,
                category: product?.category || '',
                imageUrl: product?.imageUrl || '',
            });
        }
    }, [isOpen, product, reset]);

    const mutation = useMutation({
        mutationFn: async (data: ProductFormData) => {
            if (isEditing) {
                const res = await api.patch(`/products/${product.id}`, data);
                return res.data;
            } else {
                const res = await api.post('/products', data);
                return res.data;
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['products'] });
            queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] }); // Update stats if any
            toast.success(isEditing ? 'Product updated' : 'Product created');
            onClose();
        },
        onError: (error: any) => {
            toast.error(error.response?.data?.message || 'Something went wrong');
        },
    });

    const onSubmit = (data: ProductFormData) => {
        mutation.mutate(data);
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={isEditing ? 'Edit Product' : 'Add New Product'}
        >
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                <DashboardInput
                    label="Product Name"
                    placeholder="e.g. Premium Service"
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
                        label="Stock"
                        type="number"
                        placeholder="0"
                        error={errors.stock?.message}
                        {...register('stock')}
                    />
                </div>

                <DashboardInput
                    label="Category"
                    placeholder="e.g. Consultations"
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
                    label="Image URL (Optional)"
                    placeholder="https://..."
                    error={errors.imageUrl?.message}
                    {...register('imageUrl')}
                />

                <div className="flex justify-end gap-3 pt-4">
                    <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>
                        Cancel
                    </Button>
                    <Button type="submit" isLoading={isSubmitting}>
                        {isEditing ? 'Save Changes' : 'Create Product'}
                    </Button>
                </div>
            </form>
        </Modal>
    );
}
