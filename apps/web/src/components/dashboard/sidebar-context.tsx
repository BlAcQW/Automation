'use client';

import { useState, useEffect, useCallback, createContext, useContext, ReactNode } from 'react';

interface SidebarContextType {
    isOpen: boolean;
    toggle: () => void;
    close: () => void;
    /** Desktop sidebar collapsed to an icon rail (remembered per browser). */
    collapsed: boolean;
    toggleCollapsed: () => void;
}

const SidebarContext = createContext<SidebarContextType | undefined>(undefined);
const STORAGE_KEY = 'bookly.sidebar.collapsed';

export function SidebarProvider({ children }: { children: ReactNode }) {
    const [isOpen, setIsOpen] = useState(false);
    const [collapsed, setCollapsed] = useState(false);

    useEffect(() => {
        try {
            setCollapsed(window.localStorage.getItem(STORAGE_KEY) === '1');
        } catch {
            // Storage blocked (private mode): stay expanded.
        }
    }, []);

    const toggleCollapsed = useCallback(() => {
        setCollapsed((prev) => {
            const next = !prev;
            try {
                window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
            } catch {
                // Not persisted; the toggle still works for this visit.
            }
            return next;
        });
    }, []);

    return (
        <SidebarContext.Provider value={{
            isOpen,
            toggle: () => setIsOpen(!isOpen),
            close: () => setIsOpen(false),
            collapsed,
            toggleCollapsed,
        }}>
            {children}
        </SidebarContext.Provider>
    );
}

export function useSidebar() {
    const context = useContext(SidebarContext);
    if (!context) {
        throw new Error('useSidebar must be used within SidebarProvider');
    }
    return context;
}
