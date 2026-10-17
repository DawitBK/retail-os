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
  group: 'Sell' | 'Stock' | 'Buy' | 'Books' | 'Admin';
}

export const NAV: NavItem[] = [
  { href: '/', label: 'Dashboard', roles: WATCHERS, group: 'Sell' },
  { href: '/till', label: 'Till', roles: FLOOR, group: 'Sell' },
  {
    href: '/sales',
    label: 'Sales',
    roles: ['owner', 'manager', 'accountant', 'cashier'],
    group: 'Sell',
  },
  {
    href: '/customers',
    label: 'Customers',
    roles: ['owner', 'manager', 'accountant', 'cashier'],
    group: 'Sell',
  },
  {
    href: '/products',
    label: 'Products',
    roles: ['owner', 'manager', 'accountant', 'cashier'],
    group: 'Stock',
  },
  { href: '/alerts', label: 'Alerts', roles: WATCHERS, group: 'Stock' },
  { href: '/damage', label: 'Damage', roles: FLOOR, group: 'Stock' },
  { href: '/stock-audits', label: 'Stock counts', roles: FLOOR, group: 'Stock' },
  { href: '/purchases', label: 'Purchases', roles: WATCHERS, group: 'Buy' },
  { href: '/suppliers', label: 'Suppliers', roles: WATCHERS, group: 'Buy' },
  { href: '/accounting', label: 'Statements', roles: WATCHERS, group: 'Books' },
  { href: '/accounting/journal', label: 'Journal', roles: WATCHERS, group: 'Books' },
  { href: '/accounting/expenses', label: 'Expenses', roles: WATCHERS, group: 'Books' },
  { href: '/staff', label: 'Staff', roles: ['owner'], group: 'Admin' },
];

/** Where a role lands after signing in. */
export function homeFor(role: Role): string {
  return can(role, WATCHERS) ? '/' : '/till';
}
