// @bookingflow/ui — the Bookly design system. Guide: apps/web/DESIGN-SYSTEM.md.
export { cn } from './cn';
export { ease, durations, revealVariants, staggerVariants, pressScale, STAGGER_SECONDS } from './motion';
export {
    formatCedi,
    parseCedi,
    normalizeGhanaPhone,
    isValidGhanaPhone,
    formatGhanaPhone,
    formatGhanaPhoneInput,
    CEDI_SYMBOL,
    GHANA_DIAL_CODE,
    type FormatCediOptions,
} from './format';

// Actions & surfaces
export { Button, buttonVariants, type ButtonProps } from './components/button';
export { Card, CardHeader, CardTitle, CardContent } from './components/card';
export { Badge, badgeVariants } from './components/badge';
export { StatusPill, type StatusTone } from './components/status-pill';
export { Avatar } from './components/avatar';
export { Switch } from './components/switch';
export { StatCard } from './components/stat-card';
export { NumberTicker } from './components/number-ticker';

// Forms
export { Input, DashboardInput } from './components/input';
export { Field, Select, Textarea, controlClasses } from './components/field';
export { PhoneInput } from './components/phone-input';
export { MoneyInput } from './components/money-input';
export { SearchInput, FilterChips, type FilterChip } from './components/search-filter';

// Overlays
export { Modal } from './components/modal';
export { Drawer } from './components/drawer';
export { ConfirmDialog } from './components/confirm-dialog';

// Layout & navigation
export { PageHeader, SectionHeading } from './components/page-header';
export { Tabs, type TabItem } from './components/tabs';
export { ResponsiveTable, type Column } from './components/responsive-table';

// Feedback states
export { Skeleton, SkeletonLine, SkeletonCard, SkeletonTableRow, SkeletonList } from './components/skeleton';
export { EmptyState, ErrorState } from './components/states';

// Brand & motion
export { BrandLogo } from './components/brand-logo';
export { LogoReveal } from './components/logo-reveal';
export { AwningDivider } from './components/awning-divider';
export { TickPop } from './components/tick-pop';
export { PageTransition, Stagger, StaggerItem, useReducedMotion } from './components/motion-helpers';
