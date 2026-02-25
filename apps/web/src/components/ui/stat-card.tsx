'use client';

import { type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/cn';

interface StatCardProps {
    name: string;
    value: string | number;
    icon: ReactNode;
    color: string; // bg color class like 'bg-blue-500'
    className?: string;
    index?: number;
}

export function StatCard({ name, value, icon, color, className, index = 0 }: StatCardProps) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: index * 0.1 }}
            className={cn(
                'relative overflow-hidden bg-white dark:bg-slate-800/80 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 p-6 group hover:shadow-lg transition-all duration-300',
                className
            )}
        >
            {/* Subtle gradient background effect */}
            <div className={cn('absolute top-0 right-0 w-32 h-32 rounded-full blur-3xl opacity-10 -translate-y-8 translate-x-8 group-hover:opacity-20 transition-opacity', color)} />

            <div className="relative flex items-center justify-between">
                <div>
                    <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{name}</p>
                    <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
                        {value}
                    </p>
                </div>
                <div className={cn('w-12 h-12 rounded-xl flex items-center justify-center shadow-lg', color)}>
                    {icon}
                </div>
            </div>
        </motion.div>
    );
}
