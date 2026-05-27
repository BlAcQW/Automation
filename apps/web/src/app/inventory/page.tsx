'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
    Boxes, Search, AlertTriangle, Plus, Minus, PackageCheck
} from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { DashboardInput } from '@/components/ui/input';
import { StatCard } from '@/components/ui/stat-card';
import { PageHeader } from '@/components/ui/page-header';
import { BooklyDots } from '@/components/primitives/bookly-dots';
import { useProductRouteGuard } from '@/lib/use-product-route-guard';
import { toast } from 'react-hot-toast';

interface Product {
    id: string;
    name: string;
    stock: number;
    price: string | number;
    category?: string;
    imageUrl?: string;
}

export default function InventoryPage() {
    // PRODUCT mode is parked — bounce to /dashboard until the flag flips.
    const productEnabled = useProductRouteGuard();

    const [search, setSearch] = useState('');
    const queryClient = useQueryClient();

    const { data: products = [], isLoading } = useQuery({
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
            toast.success('Stock updated');
        },
        onError: () => toast.error('Failed to update stock'),
    });

    const handleStockChange = (id: string, currentStock: number, change: number) => {
        const newStock = Math.max(0, currentStock + change);
        updateStockMutation.mutate({ id, stock: newStock });
    };

    const sortedProducts = [...products].sort((a: Product, b: Product) => {
        // Sort by stock level (low to high) to prioritize attention
        return a.stock - b.stock;
    });

    const filteredProducts = sortedProducts.filter((p: Product) =>
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        (p.category && p.category.toLowerCase().includes(search.toLowerCase()))
    );

    const stats = {
        totalItems: products.reduce((acc: number, p: Product) => acc + p.stock, 0),
        totalProducts: products.length,
        lowStock: products.filter((p: Product) => p.stock > 0 && p.stock < 10).length,
        outOfStock: products.filter((p: Product) => p.stock === 0).length,
    };

    if (!productEnabled) return null;

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            <PageHeader
                title="Inventory"
                subtitle="Track stock levels and manage inventory"
            />

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <StatCard
                    name="Total Items"
                    value={stats.totalItems}
                    icon={<Boxes className="w-6 h-6 text-blue-500" />}
                    color="bg-blue-500/10"
                    index={0}
                />
                <StatCard
                    name="Products"
                    value={stats.totalProducts}
                    icon={<PackageCheck className="w-6 h-6 text-emerald-500" />}
                    color="bg-emerald-500/10"
                    index={1}
                />
                <StatCard
                    name="Low Stock"
                    value={stats.lowStock}
                    icon={<AlertTriangle className="w-6 h-6 text-yellow-500" />}
                    color="bg-yellow-500/10"
                    index={2}
                />
                <StatCard
                    name="Out of Stock"
                    value={stats.outOfStock}
                    icon={<AlertTriangle className="w-6 h-6 text-red-500" />}
                    color="bg-red-500/10"
                    index={3}
                />
            </div>

            <div className="flex flex-col sm:flex-row gap-4 items-center bg-white dark:bg-slate-800/50 p-4 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm backdrop-blur-xl">
                <div className="relative flex-1 w-full sm:max-w-md group">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-emerald-500 transition-colors" />
                    <DashboardInput
                        placeholder="Search products..."
                        className="pl-10 bg-transparent border-slate-200 dark:border-slate-700/50"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
            </div>

            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
                <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-slate-50/50 dark:bg-slate-700/20 text-slate-500 dark:text-slate-400 font-medium border-b border-slate-200 dark:border-slate-700">
                            <tr>
                                <th className="px-6 py-4">Product Name</th>
                                <th className="px-6 py-4">Category</th>
                                <th className="px-6 py-4">Current Stock</th>
                                <th className="px-6 py-4">Status</th>
                                <th className="px-6 py-4 text-right">Quick Adjust</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                            {isLoading ? (
                                <tr>
                                    <td colSpan={5} className="px-6 py-12 text-center text-slate-500">
                                        <div className="flex flex-col items-center gap-2">
                                            <BooklyDots size="sm" />
                                            <p>Loading inventory...</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : filteredProducts.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="px-6 py-12 text-center text-slate-500">
                                        <div className="flex flex-col items-center gap-2">
                                            <Boxes className="w-8 h-8 text-slate-300" />
                                            <p>No products found</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                filteredProducts.map((product: Product) => (
                                    <tr key={product.id} className="group hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                                        <td className="px-6 py-4 font-medium text-slate-900 dark:text-white">
                                            {product.name}
                                        </td>
                                        <td className="px-6 py-4 text-slate-500">
                                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-700 text-xs font-medium text-slate-600 dark:text-slate-300">
                                                {product.category || 'Uncategorized'}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className="font-mono text-slate-900 dark:text-white font-medium">{product.stock}</span>
                                        </td>
                                        <td className="px-6 py-4">
                                            {product.stock === 0 ? (
                                                <div className="flex items-center gap-2 text-red-500 text-xs font-medium bg-red-50 dark:bg-red-500/10 px-2 py-1 rounded-full w-fit">
                                                    <AlertTriangle className="w-3 h-3" /> Out of Stock
                                                </div>
                                            ) : product.stock < 10 ? (
                                                <div className="flex items-center gap-2 text-yellow-600 dark:text-yellow-400 text-xs font-medium bg-yellow-50 dark:bg-yellow-500/10 px-2 py-1 rounded-full w-fit">
                                                    <AlertTriangle className="w-3 h-3" /> Low Stock
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 text-xs font-medium bg-emerald-50 dark:bg-emerald-500/10 px-2 py-1 rounded-full w-fit">
                                                    <PackageCheck className="w-3 h-3" /> In Stock
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <div className="flex items-center justify-end gap-2">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-8 w-8 hover:bg-slate-200 dark:hover:bg-slate-600"
                                                    onClick={() => handleStockChange(product.id, product.stock, -1)}
                                                    disabled={product.stock <= 0}
                                                >
                                                    <Minus className="w-4 h-4" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-8 w-8 hover:bg-slate-200 dark:hover:bg-slate-600"
                                                    onClick={() => handleStockChange(product.id, product.stock, 1)}
                                                >
                                                    <Plus className="w-4 h-4" />
                                                </Button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Mobile: stacked inventory cards */}
                <div className="md:hidden divide-y divide-slate-200 dark:divide-slate-700">
                    {isLoading ? (
                        <div className="px-4 py-12 text-center text-slate-500">
                            <div className="flex flex-col items-center gap-2">
                                <BooklyDots size="sm" />
                                <p>Loading inventory...</p>
                            </div>
                        </div>
                    ) : filteredProducts.length === 0 ? (
                        <div className="px-4 py-12 text-center text-slate-500">
                            <div className="flex flex-col items-center gap-2">
                                <Boxes className="w-8 h-8 text-slate-300" />
                                <p>No products found</p>
                            </div>
                        </div>
                    ) : (
                        filteredProducts.map((product: Product) => (
                            <div key={product.id} className="flex items-center gap-3 p-4">
                                <div className="flex-1 min-w-0">
                                    <p className="font-medium text-slate-900 dark:text-white truncate">{product.name}</p>
                                    <div className="flex items-center gap-2 mt-1">
                                        <span className="font-mono text-sm text-slate-600 dark:text-slate-300">
                                            {product.stock} in stock
                                        </span>
                                        {product.stock === 0 ? (
                                            <span className="inline-flex items-center gap-1 text-red-500 text-[11px] font-medium bg-red-50 dark:bg-red-500/10 px-2 py-0.5 rounded-full">
                                                <AlertTriangle className="w-3 h-3" /> Out
                                            </span>
                                        ) : product.stock < 10 ? (
                                            <span className="inline-flex items-center gap-1 text-yellow-600 dark:text-yellow-400 text-[11px] font-medium bg-yellow-50 dark:bg-yellow-500/10 px-2 py-0.5 rounded-full">
                                                <AlertTriangle className="w-3 h-3" /> Low
                                            </span>
                                        ) : (
                                            <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 text-[11px] font-medium bg-emerald-50 dark:bg-emerald-500/10 px-2 py-0.5 rounded-full">
                                                <PackageCheck className="w-3 h-3" /> In stock
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-9 w-9 hover:bg-slate-200 dark:hover:bg-slate-600"
                                        onClick={() => handleStockChange(product.id, product.stock, -1)}
                                        disabled={product.stock <= 0}
                                    >
                                        <Minus className="w-4 h-4" />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-9 w-9 hover:bg-slate-200 dark:hover:bg-slate-600"
                                        onClick={() => handleStockChange(product.id, product.stock, 1)}
                                    >
                                        <Plus className="w-4 h-4" />
                                    </Button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}
