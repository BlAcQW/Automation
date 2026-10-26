'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Boxes, AlertTriangle, Plus, Minus, PackageCheck, PackageX } from 'lucide-react';
import { api } from '@/lib/api';
import {
    Button,
    StatCard,
    PageHeader,
    SearchInput,
    FilterChips,
    StatusPill,
    EmptyState,
    ErrorState,
    ResponsiveTable,
    SkeletonList,
    type Column,
} from '@bookingflow/ui';
import { useProductRouteGuard } from '@/lib/use-product-route-guard';
import { notify } from '@/components/brand/toast';

interface Product {
    id: string;
    name: string;
    stock: number;
    price: string | number;
    category?: string;
    imageUrl?: string;
}

/** Below this many items a product counts as running low. */
const LOW_STOCK = 10;

type StockFilter = 'ALL' | 'LOW' | 'OUT';

function stockLevel(stock: number): 'out' | 'low' | 'ok' {
    if (stock === 0) return 'out';
    if (stock < LOW_STOCK) return 'low';
    return 'ok';
}

function StockPill({ stock }: { stock: number }) {
    const level = stockLevel(stock);
    if (level === 'out') return <StatusPill status="out_of_stock" tone="error" label="Sold out" />;
    if (level === 'low') return <StatusPill status="warning" label="Running low" />;
    return <StatusPill status="in_stock" tone="success" label="In stock" />;
}

export default function InventoryPage() {
    // PRODUCT mode is parked — bounce to /dashboard until the flag flips.
    const productEnabled = useProductRouteGuard();

    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState<StockFilter>('ALL');
    const queryClient = useQueryClient();

    const { data: products = [], isLoading, isError, refetch, isRefetching } = useQuery({
        queryKey: ['products'],
        queryFn: async () => {
            const res = await api.get('/products');
            return res.data.data;
        },
    });

    const updateStockMutation = useMutation({
        mutationFn: async ({ id, stock }: { id: string; stock: number }) => {
            await api.patch(`/products/${id}`, { stock });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['products'] });
            notify.success('Stock updated');
        },
        onError: () => notify.error("Oops, we couldn't update the stock. Let's try again."),
    });

    const handleStockChange = (id: string, currentStock: number, change: number) => {
        const newStock = Math.max(0, currentStock + change);
        updateStockMutation.mutate({ id, stock: newStock });
    };

    const sortedProducts = [...products].sort((a: Product, b: Product) => {
        // Sort by stock level (low to high) to prioritize attention
        return a.stock - b.stock;
    });

    const filteredProducts = sortedProducts.filter((p: Product) => {
        const level = stockLevel(p.stock);
        if (filter === 'LOW' && level !== 'low') return false;
        if (filter === 'OUT' && level !== 'out') return false;
        return (
            p.name.toLowerCase().includes(search.toLowerCase()) ||
            (p.category && p.category.toLowerCase().includes(search.toLowerCase()))
        );
    });

    const stats = {
        totalItems: products.reduce((acc: number, p: Product) => acc + p.stock, 0),
        totalProducts: products.length,
        lowStock: products.filter((p: Product) => p.stock > 0 && p.stock < LOW_STOCK).length,
        outOfStock: products.filter((p: Product) => p.stock === 0).length,
    };

    if (!productEnabled) return null;

    const columns: Column<Product>[] = [
        {
            key: 'name',
            header: 'Product',
            render: (p) => <span className="font-semibold text-text">{p.name}</span>,
        },
        {
            key: 'category',
            header: 'Category',
            hideOnMobile: true,
            render: (p) => <span className="text-muted">{p.category || 'No category'}</span>,
        },
        {
            key: 'stock',
            header: 'In stock',
            align: 'right',
            render: (p) => <span className="font-semibold tabular-nums">{p.stock}</span>,
        },
        {
            key: 'status',
            header: 'Status',
            render: (p) => <StockPill stock={p.stock} />,
        },
        {
            key: 'adjust',
            header: 'Adjust',
            align: 'right',
            render: (p) => (
                <div className="inline-flex items-center gap-1">
                    <Button
                        variant="secondary"
                        size="icon"
                        onClick={() => handleStockChange(p.id, p.stock, -1)}
                        disabled={p.stock <= 0}
                        aria-label={`Remove one ${p.name}`}
                    >
                        <Minus className="h-4 w-4" aria-hidden />
                    </Button>
                    <Button
                        variant="secondary"
                        size="icon"
                        onClick={() => handleStockChange(p.id, p.stock, 1)}
                        aria-label={`Add one ${p.name}`}
                    >
                        <Plus className="h-4 w-4" aria-hidden />
                    </Button>
                </div>
            ),
        },
    ];

    return (
        <div className="space-y-6 lg:space-y-8">
            <PageHeader title="Stock" subtitle="See what's running low and top it up in a tap." />

            <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
                <StatCard name="In stock" value={stats.totalItems} icon={<Boxes />} index={0} />
                <StatCard name="Products" value={stats.totalProducts} icon={<PackageCheck />} index={1} />
                <StatCard name="Running low" value={stats.lowStock} icon={<AlertTriangle />} index={2} />
                <StatCard name="Sold out" value={stats.outOfStock} icon={<PackageX />} index={3} />
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <SearchInput
                    value={search}
                    onChange={setSearch}
                    label="Search stock"
                    placeholder="Search by name or category…"
                    className="w-full sm:max-w-md"
                />
                <FilterChips
                    label="Filter by stock level"
                    chips={[
                        { value: 'ALL', label: 'All' },
                        { value: 'LOW', label: 'Running low', count: stats.lowStock },
                        { value: 'OUT', label: 'Sold out', count: stats.outOfStock },
                    ]}
                    selected={[filter]}
                    onToggle={(v) => setFilter(v as StockFilter)}
                />
            </div>

            {/* A failed request must never render as an empty list — the business
                would read it as data loss. */}
            {isError ? (
                <div className="rounded-card border border-border bg-surface shadow-card">
                    <ErrorState onRetry={() => refetch()} isRetrying={isRefetching} />
                </div>
            ) : isLoading ? (
                <div aria-busy="true" className="rounded-card border border-border bg-surface px-4 shadow-card">
                    <span className="sr-only">Loading…</span>
                    <SkeletonList rows={6} />
                </div>
            ) : products.length === 0 ? (
                <div className="rounded-card border border-border bg-surface shadow-card">
                    <EmptyState
                        icon={<Boxes />}
                        title="No products yet"
                        description="Add your first product, then track its stock here."
                        action={
                            <Link
                                href="/products"
                                className="inline-flex min-h-[44px] items-center gap-2 rounded-control bg-primary px-5 text-[15px] font-semibold text-primary-fg shadow-soft transition-colors duration-ui hover:bg-primary-hover"
                            >
                                <Plus className="h-4 w-4" aria-hidden />
                                Add a product
                            </Link>
                        }
                    />
                </div>
            ) : filteredProducts.length === 0 ? (
                <div className="rounded-card border border-border bg-surface shadow-card">
                    <EmptyState
                        icon={<PackageCheck />}
                        title="Nothing to show here"
                        description={filter !== 'ALL' ? 'Good news: nothing matches this stock level.' : 'Try a different name or category.'}
                        action={
                            <Button variant="secondary" onClick={() => { setSearch(''); setFilter('ALL'); }}>
                                Show everything
                            </Button>
                        }
                    />
                </div>
            ) : (
                <ResponsiveTable
                    caption="Stock levels"
                    columns={columns}
                    rows={filteredProducts}
                    rowKey={(p) => p.id}
                />
            )}
        </div>
    );
}
