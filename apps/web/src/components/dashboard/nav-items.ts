import {
    Home,
    Calendar,
    Scissors,
    Clock,
    MessageCircle,
    Settings,
    Package,
    ShoppingBag,
    Users,
    Boxes,
    FileText,
    Share2,
    Wallet,
    type LucideIcon,
} from 'lucide-react';

export interface NavItem {
    name: string;
    href: string;
    icon: LucideIcon;
}

// Labels in Bookly voice: short, plain, no jargon. Routes are unchanged.
export const serviceNavigation: NavItem[] = [
    { name: 'Home', href: '/dashboard', icon: Home },
    { name: 'Bookings', href: '/bookings', icon: Calendar },
    { name: 'Services', href: '/services', icon: Scissors },
    { name: 'Opening hours', href: '/availability', icon: Clock },
    { name: 'Inbox', href: '/conversations', icon: MessageCircle },
    { name: 'Channels', href: '/channels', icon: Share2 },
    { name: 'Money', href: '/money', icon: Wallet },
    { name: 'Message templates', href: '/templates', icon: FileText },
    { name: 'Settings', href: '/settings', icon: Settings },
];

export const productNavigation: NavItem[] = [
    { name: 'Home', href: '/dashboard', icon: Home },
    { name: 'Products', href: '/products', icon: Package },
    { name: 'Orders', href: '/orders', icon: ShoppingBag },
    { name: 'Stock', href: '/inventory', icon: Boxes },
    { name: 'Customers', href: '/customers', icon: Users },
    { name: 'Inbox', href: '/conversations', icon: MessageCircle },
    { name: 'Channels', href: '/channels', icon: Share2 },
    { name: 'Money', href: '/money', icon: Wallet },
    { name: 'Message templates', href: '/templates', icon: FileText },
    { name: 'Settings', href: '/settings', icon: Settings },
];

// Mobile bottom bar: the five most-used sections.
export const serviceTabs: NavItem[] = [
    { name: 'Home', href: '/dashboard', icon: Home },
    { name: 'Bookings', href: '/bookings', icon: Calendar },
    { name: 'Services', href: '/services', icon: Scissors },
    { name: 'Inbox', href: '/conversations', icon: MessageCircle },
    { name: 'Settings', href: '/settings', icon: Settings },
];

export const productTabs: NavItem[] = [
    { name: 'Home', href: '/dashboard', icon: Home },
    { name: 'Products', href: '/products', icon: Package },
    { name: 'Orders', href: '/orders', icon: ShoppingBag },
    { name: 'Inbox', href: '/conversations', icon: MessageCircle },
    { name: 'Settings', href: '/settings', icon: Settings },
];

export function isActivePath(pathname: string, href: string): boolean {
    return pathname === href || (href !== '/dashboard' && pathname.startsWith(href));
}
