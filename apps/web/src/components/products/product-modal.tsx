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
    const currency = useTenantCurrency();
    const isEditing = !!product;

    const {
        register,
        control,
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
            notify.success(isEditing ? 'Product saved' : 'Product added');
            onClose();
        },
        onError: (error: any) => {
            notify.error(error.response?.data?.message || "Oops, that didn't work. Let's try again.");
        },
    });

    const onSubmit = (data: ProductFormData) => {
        mutation.mutate(data);
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={isEditing ? 'Edit product' : 'Add a product'}
            description={isEditing ? undefined : 'Customers will see this when they order on WhatsApp.'}
        >
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                <DashboardInput
                    label="Product name"
                    placeholder="e.g. Kente stole, 2 yards"
                    error={errors.name?.message}
                    {...register('name')}
                />

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {currency.toUpperCase() === 'GHS' ? (
                        <Controller
                            control={control}
                            name="price"
                            render={({ field }) => (
                                <MoneyInput
                                    ref={field.ref}
                                    name={field.name}
                                    onBlur={field.onBlur}
                                    label="Price"
                                    // A new product starts blank rather than "0".
                                    value={!isEditing && field.value === 0 ? '' : String(field.value ?? '')}
                                    // Commas are display-only; the schema coerces the rest.
                                    onChange={(text) => field.onChange(text.replace(/,/g, ''))}
                                    error={errors.price?.message}
                                />
                            )}
                        />
                    ) : (
                        <DashboardInput
                            label={`Price (${currency})`}
                            type="number"
                            step="0.01"
                            inputMode="decimal"
                            placeholder="0.00"
                            error={errors.price?.message}
                            {...register('price')}
                        />
                    )}
                    <DashboardInput
                        label="How many in stock"
                        type="number"
                        inputMode="numeric"
                        placeholder="0"
                        error={errors.stock?.message}
                        {...register('stock')}
                    />
                </div>

                <DashboardInput
                    label="Category"
                    placeholder="e.g. Fabrics"
                    error={errors.category?.message}
                    {...register('category')}
                />

                <Textarea
                    label="Description (optional)"
                    rows={3}
                    placeholder="A line or two about it"
                    error={errors.description?.message}
                    {...register('description')}
                />

                <DashboardInput
                    label="Picture link (optional)"
                    hint="Paste a link to a photo of the product."
                    placeholder="https://..."
                    error={errors.imageUrl?.message}
                    {...register('imageUrl')}
                />

                <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
                    <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
                        Cancel
                    </Button>
                    <Button type="submit" isLoading={isSubmitting}>
                        {isEditing ? 'Save changes' : 'Add product'}
                    </Button>
                </div>
            </form>
        </Modal>
    );
}
