'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Box, CheckCircle, AlertCircle, Tag, Package } from 'lucide-react';
import { api } from '@/lib/api';
import {
    Button,
    StatCard,
    PageHeader,
    SearchInput,
    StatusPill,
    EmptyState,
    ErrorState,
    SkeletonCard,
    ConfirmDialog,
    Stagger,
    StaggerItem,
} from '@bookingflow/ui';
import { ProductModal } from '@/components/products/product-modal';
import { useProductRouteGuard } from '@/lib/use-product-route-guard';
import { notify } from '@/components/brand/toast';
import { displayMoney } from '@/components/primitives/money';

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

export default function ProductsPage() {
    // PRODUCT mode is parked — bounce to /dashboard until the flag flips.
    const productEnabled = useProductRouteGuard();

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingProduct, setEditingProduct] = useState<Product | null>(null);
    const [deleting, setDeleting] = useState<Product | null>(null);
    const [search, setSearch] = useState('');
    const queryClient = useQueryClient();

    const { data: products = [], isLoading, isError, refetch, isRefetching } = useQuery({
        queryKey: ['products'],
        queryFn: async () => {
            const res = await api.get('/products');
            return res.data.data;
        },
    });

    const deleteMutation = useMutation({
        mutationFn: async (id: string) => {
            await api.delete(`/products/${id}`);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['products'] });
            notify.success('Product deleted');
            setDeleting(null);
        },
        onError: () => notify.error("Oops, we couldn't delete that product. Let's try again."),
    });

    const handleEdit = (product: Product) => {
        setEditingProduct(product);
        setIsModalOpen(true);
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setEditingProduct(null);
    };

    const filteredProducts = products.filter((p: Product) =>
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        (p.category && p.category.toLowerCase().includes(search.toLowerCase()))
    );

    // Guard renders below — all hooks above run unconditionally first.
    if (!productEnabled) return null;

    const stats = {
        total: products.length,
        active: products.filter((p: Product) => p.isActive).length,
        outOfStock: products.filter((p: Product) => p.stock === 0).length,
        categories: new Set(products.map((p: Product) => p.category).filter(Boolean)).size,
    };

    const addButton = (
        <Button onClick={() => setIsModalOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            Add a product
        </Button>
    );

    return (
        <div className="space-y-6 lg:space-y-8">
            <PageHeader
                title="Products"
                subtitle="Everything customers can order from you on WhatsApp."
                actions={addButton}
            />

            <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
                <StatCard name="All" value={stats.total} icon={<Box />} index={0} />
                <StatCard name="On sale" value={stats.active} icon={<CheckCircle />} index={1} />
                <StatCard name="Sold out" value={stats.outOfStock} icon={<AlertCircle />} index={2} />
                <StatCard name="Categories" value={stats.categories} icon={<Tag />} index={3} />
            </div>

            <SearchInput
                value={search}
                onChange={setSearch}
                label="Search products"
                placeholder="Search by name or category…"
                className="w-full sm:max-w-md"
            />

            {/* A failed request must never render as an empty list — the business
                would read it as data loss. */}
            {isError ? (
                <div className="rounded-card border border-border bg-surface shadow-card">
                    <ErrorState onRetry={() => refetch()} isRetrying={isRefetching} />
                </div>
            ) : isLoading ? (
                <div aria-busy="true" className="grid gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3">
                    <span className="sr-only">Loading…</span>
                    {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
                </div>
            ) : products.length === 0 ? (
                <div className="rounded-card border border-border bg-surface shadow-card">
                    <EmptyState
                        icon={<Package />}
                        title="No products yet"
                        description="Add your first one so customers can order."
                        action={addButton}
                    />
                </div>
            ) : filteredProducts.length === 0 ? (
                <div className="rounded-card border border-border bg-surface shadow-card">
                    <EmptyState
                        icon={<Package />}
                        title="Nothing matches that search"
                        description="Try a different name or category."
                        action={<Button variant="secondary" onClick={() => setSearch('')}>Clear search</Button>}
                    />
                </div>
            ) : (
                <Stagger className="grid gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3">
                    {filteredProducts.map((product: Product) => (
                        <StaggerItem key={product.id}>
                            <ProductCard
                                product={product}
                                onEdit={() => handleEdit(product)}
                                onDelete={() => setDeleting(product)}
                            />
                        </StaggerItem>
                    ))}
                </Stagger>
            )}

            <ProductModal
                isOpen={isModalOpen}
                onClose={handleCloseModal}
                product={editingProduct}
            />

            <ConfirmDialog
                isOpen={!!deleting}
                onClose={() => setDeleting(null)}
                onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
                title={`Delete ${deleting?.name ?? 'this product'}?`}
                description="Customers won't be able to order it any more. This can't be undone."
                confirmLabel="Delete product"
                isLoading={deleteMutation.isPending}
            />
        </div>
    );
}

interface ProductCardProps {
    product: Product;
    onEdit: () => void;
    onDelete: () => void;
}

function ProductCard({ product, onEdit, onDelete }: ProductCardProps) {
    return (
        <article className="flex h-full flex-col rounded-card border border-border bg-surface p-4 shadow-card transition-shadow duration-ui hover:shadow-card-hover">
            <div className="flex items-start gap-3">
                {product.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        src={product.imageUrl}
                        alt={product.name}
                        loading="lazy"
                        className="h-16 w-16 shrink-0 rounded-control border border-border object-cover"
                    />
                ) : (
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-control bg-primary-soft text-primary" aria-hidden>
                        <Package className="h-7 w-7" />
                    </div>
                )}
                <div className="min-w-0 flex-1">
                    <h2 className="truncate text-[17px] font-bold text-text">{product.name}</h2>
                    <p className="mt-0.5 truncate text-[14px] text-muted">{product.category || 'No category'}</p>
                    <p className="mt-1.5 text-[17px] font-bold tabular-nums text-text">{displayMoney(product.price)}</p>
                </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
                {product.stock > 0 ? (
                    <StatusPill status="in_stock" tone="success" label={`${product.stock} in stock`} size="sm" />
                ) : (
                    <StatusPill status="sold_out" tone="error" label="Sold out" size="sm" />
                )}
                {!product.isActive && <StatusPill status="inactive" label="Hidden" size="sm" />}
            </div>

            <div className="mt-auto flex items-center justify-end gap-1 pt-3">
                <Button variant="ghost" size="sm" onClick={onEdit} aria-label={`Edit ${product.name}`}>
                    <Pencil className="h-4 w-4" aria-hidden />
                    Edit
                </Button>
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={onDelete}
                    aria-label={`Delete ${product.name}`}
                    className="text-muted hover:text-error-fg"
                >
                    <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
            </div>
        </article>
    );
}
