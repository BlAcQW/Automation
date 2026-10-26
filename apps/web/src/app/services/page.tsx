'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Clock, Scissors, Tag, SearchX } from 'lucide-react';
import { api } from '@/lib/api';
import {
    Button,
    Card,
    ConfirmDialog,
    EmptyState,
    ErrorState,
    PageHeader,
    SearchInput,
    SkeletonCard,
    Stagger,
    StaggerItem,
    StatusPill,
} from '@bookingflow/ui';
import { ServiceModal } from '@/components/services/service-modal';
import { notify } from '@/components/brand/toast';
import { displayMoney } from '@/components/primitives/money';
import { useTenantCurrency } from '@/lib/use-currency';

interface Service {
    id: string;
    name: string;
    description?: string;
    price: number | string;
    durationMinutes: number;
    category?: string;
    isActive: boolean;
}

function formatDuration(minutes: number): string {
    if (minutes < 60) return `${minutes} min`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m ? `${h} hr ${m} min` : `${h} hr`;
}

export default function ServicesPage() {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingService, setEditingService] = useState<Service | null>(null);
    const [deleting, setDeleting] = useState<Service | null>(null);
    const [search, setSearch] = useState('');
    const queryClient = useQueryClient();
    const currency = useTenantCurrency();

    const { data: services = [], isLoading, isError, refetch, isRefetching } = useQuery({
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
            notify.success('Service removed');
            setDeleting(null);
        },
        onError: () => notify.error("Oops, we couldn't remove that service. Let's try again."),
    });

    const handleEdit = (service: Service) => {
        setEditingService(service);
        setIsModalOpen(true);
    };

    const handleAdd = () => {
        setEditingService(null);
        setIsModalOpen(true);
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setEditingService(null);
    };

    const q = search.toLowerCase();
    const filteredServices: Service[] = services.filter((s: Service) =>
        s.name.toLowerCase().includes(q) || (s.category && s.category.toLowerCase().includes(q))
    );

    const activeCount = services.filter((s: Service) => s.isActive).length;

    return (
        <div className="space-y-6">
            <PageHeader
                title="Services"
                subtitle={
                    services.length > 0
                        ? `${services.length} ${services.length === 1 ? 'service' : 'services'} · ${activeCount} open for booking`
                        : 'What customers can book with you, with prices and how long each one takes.'
                }
                actions={
                    <Button onClick={handleAdd}>
                        <Plus className="h-5 w-5" aria-hidden />
                        Add a service
                    </Button>
                }
            />

            {services.length > 0 && (
                <SearchInput
                    value={search}
                    onChange={setSearch}
                    label="Search services"
                    placeholder="Search by name or category"
                    className="sm:max-w-md"
                />
            )}

            {isError ? (
                <Card>
                    <ErrorState
                        description="We couldn't load your services. Your services are safe. Check your connection, then try again."
                        onRetry={() => refetch()}
                        isRetrying={isRefetching}
                    />
                </Card>
            ) : isLoading ? (
                <div aria-busy="true" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    <span className="sr-only">Loading your services…</span>
                    {Array.from({ length: 6 }).map((_, i) => (
                        <SkeletonCard key={i} />
                    ))}
                </div>
            ) : services.length === 0 ? (
                <Card>
                    <EmptyState
                        icon={<Scissors />}
                        title="No services yet"
                        description="Add your first one so customers can book."
                        action={
                            <Button onClick={handleAdd}>
                                <Plus className="h-5 w-5" aria-hidden />
                                Add your first service
                            </Button>
                        }
                    />
                </Card>
            ) : filteredServices.length === 0 ? (
                <Card>
                    <EmptyState
                        icon={<SearchX />}
                        title="No services match your search"
                        description="Try another word, or clear the search to see everything."
                        action={
                            <Button variant="secondary" onClick={() => setSearch('')}>
                                Clear search
                            </Button>
                        }
                    />
                </Card>
            ) : (
                <Stagger className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {filteredServices.map((service) => (
                        <StaggerItem key={service.id}>
                            <Card hover className="flex h-full flex-col p-5">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <h2 className="text-[18px] font-bold leading-snug text-text break-words">
                                            {service.name}
                                        </h2>
                                        <p className="mt-1 inline-flex items-center gap-1.5 text-small text-muted">
                                            <Tag className="h-4 w-4 shrink-0" aria-hidden />
                                            {service.category || 'No category'}
                                        </p>
                                    </div>
                                    <StatusPill
                                        status={service.isActive ? 'active' : 'inactive'}
                                        label={service.isActive ? 'Bookable' : 'Hidden'}
                                        size="sm"
                                    />
                                </div>

                                {service.description && (
                                    <p className="mt-3 line-clamp-2 text-[15px] leading-relaxed text-muted">
                                        {service.description}
                                    </p>
                                )}

                                <div className="mt-auto flex flex-wrap items-end justify-between gap-3 pt-5">
                                    <div>
                                        <p className="text-[22px] font-bold tabular-nums leading-none text-text">
                                            {displayMoney(service.price, currency)}
                                        </p>
                                        <p className="mt-1.5 inline-flex items-center gap-1.5 text-small text-muted">
                                            <Clock className="h-4 w-4" aria-hidden />
                                            {formatDuration(service.durationMinutes)}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => handleEdit(service)}
                                            aria-label={`Edit ${service.name}`}
                                        >
                                            <Pencil className="h-5 w-5" aria-hidden />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => setDeleting(service)}
                                            aria-label={`Remove ${service.name}`}
                                            className="text-error-fg hover:bg-error-soft"
                                        >
                                            <Trash2 className="h-5 w-5" aria-hidden />
                                        </Button>
                                    </div>
                                </div>
                            </Card>
                        </StaggerItem>
                    ))}
                </Stagger>
            )}

            <ServiceModal isOpen={isModalOpen} onClose={handleCloseModal} service={editingService} />

            <ConfirmDialog
                isOpen={!!deleting}
                onClose={() => setDeleting(null)}
                onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
                title={`Remove ${deleting?.name ?? 'this service'}?`}
                description="Customers won't be able to book it any more. If it already has bookings, we'll hide it instead so your history stays safe."
                confirmLabel="Remove service"
                isLoading={deleteMutation.isPending}
            />
        </div>
    );
}
