'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { Users } from 'lucide-react';
import Link from 'next/link';
import { Badge, Button, Card, EmptyState, PageHeader, SearchInput, SkeletonTableRow, StatusPill } from '@bookingflow/ui';
import { Pager, Table, THead, Td, Th, Tr } from '../_components/parts';
import { formatDate } from '../_components/format';

export default function AdminUsersPage() {
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState('');

    const { data, isLoading } = useQuery({
        queryKey: ['admin', 'users', page, search],
        queryFn: async () => {
            const params = new URLSearchParams({ page: String(page), limit: '20' });
            if (search) params.set('search', search);
            const res = await adminApi.get(`/admin/users?${params}`);
            return res.data;
        },
    });

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        setPage(1);
    };

    const getRoleBadgeVariant = (role: string) => {
        switch (role) {
            case 'ADMIN': return 'info';
            case 'TENANT_ADMIN': return 'success';
            case 'STAFF': return 'neutral';
            default: return 'neutral';
        }
    };

    return (
        <div className="space-y-6">
            <PageHeader title="Users" subtitle="Everyone who can sign in to a business on Bookly." />

            <form onSubmit={handleSearch} className="flex flex-col gap-3 sm:flex-row">
                <SearchInput
                    value={search}
                    onChange={setSearch}
                    label="Search users"
                    placeholder="Search by name or email…"
                    className="w-full sm:max-w-md sm:flex-1"
                />
                <Button type="submit">Search</Button>
            </form>

            <Card className="overflow-hidden">
                {isLoading ? (
                    <div aria-busy="true">
                        <span className="sr-only">Loading users…</span>
                        {Array.from({ length: 6 }).map((_, i) => <SkeletonTableRow key={i} columns={6} />)}
                    </div>
                ) : data?.data?.length === 0 ? (
                    <EmptyState
                        icon={<Users className="h-6 w-6" aria-hidden />}
                        title="No users found"
                        description={search ? 'Try a different name or email.' : 'People show up here once businesses invite them.'}
                    />
                ) : (
                    <>
                        <Table>
                            <THead>
                                <tr>
                                    <Th>Name</Th>
                                    <Th>Email</Th>
                                    <Th>Business</Th>
                                    <Th>Role</Th>
                                    <Th>Status</Th>
                                    <Th>Joined</Th>
                                </tr>
                            </THead>
                            <tbody>
                                {data?.data?.map((user: any) => (
                                    <Tr key={user.id}>
                                        <Td><span className="font-semibold text-text">{user.name}</span></Td>
                                        <Td label="Email" className="break-all">{user.email}</Td>
                                        <Td label="Business">
                                            <Link href={`/admin/tenants/${user.tenant.id}`} className="font-medium text-primary hover:underline">
                                                {user.tenant.name}
                                            </Link>
                                        </Td>
                                        <Td label="Role"><Badge variant={getRoleBadgeVariant(user.role)}>{user.role}</Badge></Td>
                                        <Td label="Status">
                                            <StatusPill size="sm" status={user.isActive ? 'active' : 'inactive'} tone={user.isActive ? 'success' : 'error'} />
                                        </Td>
                                        <Td label="Joined" className="whitespace-nowrap text-muted">{formatDate(user.createdAt)}</Td>
                                    </Tr>
                                ))}
                            </tbody>
                        </Table>

                        {data?.pagination && (
                            <Pager
                                page={page}
                                totalPages={data.pagination.totalPages}
                                onPage={setPage}
                                summary={`Showing ${((page - 1) * 20) + 1}–${Math.min(page * 20, data.pagination.total)} of ${data.pagination.total} users`}
                            />
                        )}
                    </>
                )}
            </Card>
        </div>
    );
}
