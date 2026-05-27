'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
    Plus, Search, Filter, MoreVertical, Edit, Trash2,
    Box, CheckCircle, AlertCircle, Tag, Package
} from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { DashboardInput } from '@/components/ui/input';
import { StatCard } from '@/components/ui/stat-card';
import { ProductModal } from '@/components/products/product-modal';
import { PageHeader } from '@/components/ui/page-header';
import { BooklyDots } from '@/components/primitives/bookly-dots';
import { useProductRouteGuard } from '@/lib/use-product-route-guard';
import { toast } from 'react-hot-toast';

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
    const [search, setSearch] = useState('');
    const queryClient = useQueryClient();

    const { data: products = [], isLoading } = useQuery({
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
            toast.success('Product deleted');
        },
        onError: () => toast.error('Failed to delete product'),
    });

    const handleEdit = (product: Product) => {
        setEditingProduct(product);
        setIsModalOpen(true);
    };

    const handleDelete = (id: string) => {
        if (confirm('Are you sure you want to delete this product?')) {
            deleteMutation.mutate(id);
        }
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

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            <PageHeader
                title="Products"
                subtitle="Manage your product catalog and inventory"
                actions={
                    <Button onClick={() => setIsModalOpen(true)} className="shadow-lg shadow-emerald-500/20">
                        <Plus className="w-4 h-4 mr-2" />
                        Add Product
                    </Button>
                }
            />

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <StatCard
                    name="Total Products"
                    value={stats.total}
                    icon={<Box className="w-6 h-6 text-blue-500" />}
                    color="bg-blue-500/10"
                    index={0}
                />
                <StatCard
                    name="Active"
                    value={stats.active}
                    icon={<CheckCircle className="w-6 h-6 text-emerald-500" />}
                    color="bg-emerald-500/10"
                    index={1}
                />
                <StatCard
                    name="Out of Stock"
                    value={stats.outOfStock}
                    icon={<AlertCircle className="w-6 h-6 text-red-500" />}
                    color="bg-red-500/10"
                    index={2}
                />
                <StatCard
                    name="Categories"
                    value={stats.categories}
                    icon={<Tag className="w-6 h-6 text-purple-500" />}
                    color="bg-purple-500/10"
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
                                <th className="px-6 py-4">Price</th>
                                <th className="px-6 py-4">Stock</th>
                                <th className="px-6 py-4">Status</th>
                                <th className="px-6 py-4 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                            {isLoading ? (
                                <tr>
                                    <td colSpan={6} className="px-6 py-12 text-center text-slate-500">
                                        <div className="flex flex-col items-center gap-2">
                                            <BooklyDots size="sm" />
                                            <p>Loading products...</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : filteredProducts.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="px-6 py-12 text-center text-slate-500">
                                        <div className="flex flex-col items-center gap-2">
                                            <Package className="w-8 h-8 text-slate-300" />
                                            <p>No products found</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                filteredProducts.map((product: Product) => (
                                    <tr key={product.id} className="group hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                                        <td className="px-6 py-4 font-medium text-slate-900 dark:text-white">
                                            <div className="flex items-center gap-3">
                                                {product.imageUrl ? (
                                                    // eslint-disable-next-line @next/next/no-img-element
                                                    <img
                                                        src={product.imageUrl}
                                                        alt={product.name}
                                                        className="w-10 h-10 rounded-lg object-cover border border-slate-200 dark:border-slate-700 shrink-0"
                                                    />
                                                ) : (
                                                    <div className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center shrink-0">
                                                        <Package className="w-5 h-5 text-slate-300" />
                                                    </div>
                                                )}
                                                <span>{product.name}</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-slate-500">
                                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-700 text-xs font-medium text-slate-600 dark:text-slate-300">
                                                {product.category || 'Uncategorized'}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 font-mono text-slate-600 dark:text-slate-300">
                                            ${Number(product.price).toFixed(2)}
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${product.stock > 0
                                                    ? 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-500/10 dark:border-emerald-500/20 dark:text-emerald-400'
                                                    : 'bg-red-50 border-red-200 text-red-700 dark:bg-red-500/10 dark:border-red-500/20 dark:text-red-400'
                                                }`}>
                                                {product.stock} in stock
                                            </span>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className={`flex items-center gap-2 text-xs font-medium ${product.isActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}`}>
                                                <div className={`w-1.5 h-1.5 rounded-full ${product.isActive ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                                                {product.isActive ? 'Active' : 'Inactive'}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEdit(product)}>
                                                    <Edit className="w-4 h-4 text-slate-500 hover:text-emerald-500" />
                                                </Button>
                                                <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-red-50 dark:hover:bg-red-900/10" onClick={() => handleDelete(product.id)}>
                                                    <Trash2 className="w-4 h-4 text-slate-500 hover:text-red-500" />
                                                </Button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Mobile: stacked cards instead of a side-scrolling table */}
                <div className="md:hidden divide-y divide-slate-200 dark:divide-slate-700">
                    {isLoading ? (
                        <div className="px-4 py-12 text-center text-slate-500">
                            <div className="flex flex-col items-center gap-2">
                                <BooklyDots size="sm" />
                                <p>Loading products...</p>
                            </div>
                        </div>
                    ) : filteredProducts.length === 0 ? (
                        <div className="px-4 py-12 text-center text-slate-500">
                            <div className="flex flex-col items-center gap-2">
                                <Package className="w-8 h-8 text-slate-300" />
                                <p>No products found</p>
                            </div>
                        </div>
                    ) : (
                        filteredProducts.map((product: Product) => (
                            <div key={product.id} className="flex items-center gap-3 p-4">
                                {product.imageUrl ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                        src={product.imageUrl}
                                        alt={product.name}
                                        className="w-12 h-12 rounded-lg object-cover border border-slate-200 dark:border-slate-700 shrink-0"
                                    />
                                ) : (
                                    <div className="w-12 h-12 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center shrink-0">
                                        <Package className="w-6 h-6 text-slate-300" />
                                    </div>
                                )}
                                <div className="flex-1 min-w-0">
                                    <p className="font-medium text-slate-900 dark:text-white truncate">{product.name}</p>
                                    <div className="flex items-center gap-2 mt-1">
                                        <span className="font-mono text-sm text-slate-600 dark:text-slate-300">
                                            ${Number(product.price).toFixed(2)}
                                        </span>
                                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${product.stock > 0
                                            ? 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-500/10 dark:border-emerald-500/20 dark:text-emerald-400'
                                            : 'bg-red-50 border-red-200 text-red-700 dark:bg-red-500/10 dark:border-red-500/20 dark:text-red-400'
                                            }`}>
                                            {product.stock} in stock
                                        </span>
                                        {!product.isActive && (
                                            <span className="text-[11px] font-medium text-slate-400">Inactive</span>
                                        )}
                                    </div>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                    <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => handleEdit(product)}>
                                        <Edit className="w-4 h-4 text-slate-500" />
                                    </Button>
                                    <Button variant="ghost" size="icon" className="h-9 w-9 hover:bg-red-50 dark:hover:bg-red-900/10" onClick={() => handleDelete(product.id)}>
                                        <Trash2 className="w-4 h-4 text-slate-500" />
                                    </Button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>

            <ProductModal
                isOpen={isModalOpen}
                onClose={handleCloseModal}
                product={editingProduct}
            />
        </div>
    );
}
