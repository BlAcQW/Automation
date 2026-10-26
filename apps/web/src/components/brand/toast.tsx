'use client';

import toast, { Toaster, type ToastOptions } from 'react-hot-toast';

/**
 * Bookly toasts — react-hot-toast styled to the brand. Mount <BrandToaster/>
 * once (components/providers.tsx). In pages, call the helpers below or the
 * plain `toast.success / toast.error` (both are styled by the Toaster).
 *
 * Copy voice: short, friendly, past tense for success ("Booking saved"),
 * plain next step for errors ("Oops, that didn't work. Let's try again.").
 */

const base: ToastOptions = {
    duration: 3500,
};

export function BrandToaster() {
    return (
        <Toaster
            position="top-center"
            gutter={10}
            containerStyle={{ top: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}
            toastOptions={{
                ...base,
                className: 'brand-toast',
                style: {
                    background: 'rgb(var(--c-surface-rgb))',
                    color: 'rgb(var(--c-text-rgb))',
                    border: '1px solid rgb(var(--c-border-rgb))',
                    borderRadius: '14px',
                    padding: '12px 14px',
                    fontFamily: 'var(--font-sans)',
                    fontSize: '15px',
                    fontWeight: 500,
                    boxShadow: '0 12px 32px -12px rgb(var(--c-shadow-rgb) / 0.28)',
                    maxWidth: 'min(420px, calc(100vw - 32px))',
                },
                success: {
                    iconTheme: { primary: '#0F6B4F', secondary: '#FFFFFF' },
                },
                error: {
                    duration: 5000,
                    iconTheme: { primary: '#C0392B', secondary: '#FFFFFF' },
                },
                loading: {
                    iconTheme: { primary: '#E8A317', secondary: 'rgb(var(--c-surface-2-rgb))' },
                },
            }}
        />
    );
}

export const notify = {
    success: (message: string, options?: ToastOptions) => toast.success(message, options),
    /** Defaults to the friendly brand line when no message is given. */
    error: (message = "Oops, that didn't work. Let's try again.", options?: ToastOptions) => toast.error(message, options),
    info: (message: string, options?: ToastOptions) => toast(message, options),
    /** Loading → success/error around a promise. */
    promise: <T,>(promise: Promise<T>, messages: { loading: string; success: string; error?: string }) =>
        toast.promise(promise, {
            loading: messages.loading,
            success: messages.success,
            error: messages.error ?? "Oops, that didn't work. Let's try again.",
        }),
};

export { toast };
