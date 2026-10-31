import type { IconName } from '@/components/icons';
import type { Role } from './types';

/** Mirrors the API's role sets; the API remains the authority, this only hides what would be refused. */
export const MANAGERS: Role[] = ['owner', 'manager'];
export const WATCHERS: Role[] = ['owner', 'manager', 'accountant'];
export const FLOOR: Role[] = ['owner', 'manager', 'cashier'];

export function can(role: Role, allowed: Role[]): boolean {
  return allowed.includes(role);
}

export interface NavItem {
  href: string;
  label: string;
  roles: Role[];
  icon: IconName;
  group: 'Sell' | 'Stock' | 'Buy' | 'Books' | 'Admin';
}

export const NAV: NavItem[] = [
  { href: '/', icon: 'dashboard', label: 'Dashboard', roles: WATCHERS, group: 'Sell' },
  { href: '/till', icon: 'till', label: 'Till', roles: FLOOR, group: 'Sell' },
  {
    href: '/sales',
    icon: 'sales',
    label: 'Sales',
    roles: ['owner', 'manager', 'accountant', 'cashier'],
    group: 'Sell',
  },
  { href: '/returns', icon: 'returns', label: 'Returns', roles: WATCHERS, group: 'Sell' },
  {
    href: '/customers',
    icon: 'customers',
    label: 'Customers',
    roles: ['owner', 'manager', 'accountant', 'cashier'],
    group: 'Sell',
  },
  {
    href: '/products',
    icon: 'products',
    label: 'Products',
    roles: ['owner', 'manager', 'accountant', 'cashier'],
    group: 'Stock',
  },
  { href: '/inventory', icon: 'inventory', label: 'Inventory', roles: WATCHERS, group: 'Stock' },
  { href: '/alerts', icon: 'alerts', label: 'Alerts', roles: WATCHERS, group: 'Stock' },
  { href: '/damage', icon: 'damage', label: 'Damage', roles: FLOOR, group: 'Stock' },
  { href: '/stock-audits', icon: 'counts', label: 'Stock counts', roles: FLOOR, group: 'Stock' },
  { href: '/purchases', icon: 'purchases', label: 'Purchases', roles: WATCHERS, group: 'Buy' },
  {
    href: '/forecasting',
    icon: 'forecasting',
    label: 'Forecasting',
    roles: MANAGERS,
    group: 'Buy',
  },
  { href: '/suppliers', icon: 'suppliers', label: 'Suppliers', roles: WATCHERS, group: 'Buy' },
  { href: '/accounting', icon: 'statements', label: 'Statements', roles: WATCHERS, group: 'Books' },
  { href: '/analytics', icon: 'analytics', label: 'Analytics', roles: WATCHERS, group: 'Books' },
  {
    href: '/accounting/journal',
    icon: 'journal',
    label: 'Journal',
    roles: WATCHERS,
    group: 'Books',
  },
  {
    href: '/accounting/expenses',
    icon: 'expenses',
    label: 'Expenses',
    roles: WATCHERS,
    group: 'Books',
  },
  { href: '/staff', icon: 'staff', label: 'Staff', roles: ['owner'], group: 'Admin' },
  { href: '/import', icon: 'import', label: 'Import', roles: ['owner'], group: 'Admin' },
];

/** Where a role lands after signing in. */
export function homeFor(role: Role): string {
  return can(role, WATCHERS) ? '/' : '/till';
}
