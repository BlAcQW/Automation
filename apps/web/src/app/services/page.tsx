'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
    Search, Plus, Edit, Trash2, Clock, CheckCircle, XCircle,
    Calendar, Briefcase
} from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { DashboardInput } from '@/components/ui/input';
import { StatCard } from '@/components/ui/stat-card';
import { ServiceModal } from '@/components/services/service-modal';
import { toast } from 'react-hot-toast';

interface Service {
    id: string;
    name: string;
    description?: string;
    price: number | string;
    durationMinutes: number;
    category?: string;
    isActive: boolean;
}

export default function ServicesPage() {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingService, setEditingService] = useState<Service | null>(null);
    const [search, setSearch] = useState('');
    const queryClient = useQueryClient();

    const { data: services = [], isLoading } = useQuery({
        queryKey: ['services'],
        queryFn: async () => {
            const res = await api.get('/services');
            return res.data.data;
        },
    });

    const deleteMutation = useMutation({
        mutationFn: async (id: string) => {
            await api.delete(`/services/${id}`);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['services'] });
            toast.success('Service deleted');
        },
        onError: () => toast.error('Failed to delete service'),
    });

    const handleEdit = (service: Service) => {
        setEditingService(service);
        setIsModalOpen(true);
    };

    const handleDelete = (id: string) => {
        if (confirm('Are you sure? This will deactivate the service if it has bookings.')) {
            deleteMutation.mutate(id);
        }
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setEditingService(null);
    };

    const filteredServices = services.filter((s: Service) =>
        s.name.toLowerCase().includes(search.toLowerCase()) ||
        (s.category && s.category.toLowerCase().includes(search.toLowerCase()))
    );

    const stats = {
        total: services.length,
        active: services.filter((s: Service) => s.isActive).length,
        categories: new Set(services.map((s: Service) => s.category).filter(Boolean)).size,
    };

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
                <div>
                    <h1 className="text-3xl font-bold bg-gradient-to-r from-slate-900 to-slate-700 dark:from-white dark:to-slate-300 bg-clip-text text-transparent">
                        Services
                    </h1>
                    <p className="text-slate-500 dark:text-slate-400 mt-1">
                        Manage your service offerings and pricing
                    </p>
                </div>
                <Button onClick={() => setIsModalOpen(true)} className="shadow-lg shadow-emerald-500/20">
                    <Plus className="w-4 h-4 mr-2" />
                    Add Service
                </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <StatCard
                    name="Total Services"
                    value={stats.total}
                    icon={<Briefcase className="w-6 h-6 text-blue-500" />}
                    color="bg-blue-500/10"
                    index={0}
                />
                <StatCard
                    name="Active Services"
                    value={stats.active}
                    icon={<CheckCircle className="w-6 h-6 text-emerald-500" />}
                    color="bg-emerald-500/10"
                    index={1}
                />
                <StatCard
                    name="Categories"
                    value={stats.categories}
                    icon={<Calendar className="w-6 h-6 text-purple-500" />}
                    color="bg-purple-500/10"
                    index={2}
                />
            </div>

            <div className="flex flex-col sm:flex-row gap-4 items-center bg-white dark:bg-slate-800/50 p-4 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm backdrop-blur-xl">
                <div className="relative flex-1 w-full sm:max-w-md group">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-emerald-500 transition-colors" />
                    <DashboardInput
                        placeholder="Search services..."
                        className="pl-10 bg-transparent border-slate-200 dark:border-slate-700/50"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
            </div>

            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-slate-50/50 dark:bg-slate-700/20 text-slate-500 dark:text-slate-400 font-medium border-b border-slate-200 dark:border-slate-700">
                            <tr>
                                <th className="px-6 py-4">Service Name</th>
                                <th className="px-6 py-4">Category</th>
                                <th className="px-6 py-4">Price</th>
                                <th className="px-6 py-4">Duration</th>
                                <th className="px-6 py-4">Status</th>
                                <th className="px-6 py-4 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                            {isLoading ? (
                                <tr>
                                    <td colSpan={6} className="px-6 py-12 text-center text-slate-500">
                                        <div className="flex flex-col items-center gap-2">
                                            <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                                            <p>Loading services...</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : filteredServices.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="px-6 py-12 text-center text-slate-500">
                                        <div className="flex flex-col items-center gap-2">
                                            <Briefcase className="w-8 h-8 text-slate-300" />
                                            <p>No services found</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                filteredServices.map((service: Service) => (
                                    <tr key={service.id} className="group hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                                        <td className="px-6 py-4 font-medium text-slate-900 dark:text-white">
                                            {service.name}
                                        </td>
                                        <td className="px-6 py-4 text-slate-500">
                                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-700 text-xs font-medium text-slate-600 dark:text-slate-300">
                                                {service.category || 'Uncategorized'}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 font-mono text-slate-600 dark:text-slate-300">
                                            ${Number(service.price).toFixed(2)}
                                        </td>
                                        <td className="px-6 py-4 text-slate-500">
                                            <div className="flex items-center gap-1.5">
                                                <Clock className="w-3.5 h-3.5" />
                                                {service.durationMinutes} min
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className={`flex items-center gap-2 text-xs font-medium ${service.isActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}`}>
                                                {service.isActive ? (
                                                    <CheckCircle className="w-3.5 h-3.5" />
                                                ) : (
                                                    <XCircle className="w-3.5 h-3.5" />
                                                )}
                                                {service.isActive ? 'Active' : 'Inactive'}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEdit(service)}>
                                                    <Edit className="w-4 h-4 text-slate-500 hover:text-emerald-500" />
                                                </Button>
                                                <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-red-50 dark:hover:bg-red-900/10" onClick={() => handleDelete(service.id)}>
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
            </div>

            <ServiceModal
                isOpen={isModalOpen}
                onClose={handleCloseModal}
                service={editingService}
            />
        </div>
    );
}
