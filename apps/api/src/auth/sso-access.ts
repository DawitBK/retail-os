import type { Role } from '../db/schema.js';

/**
 * What the identity provider says about this person for THIS application: the roles it gave them here (its `app_roles` claim) and who they are.
 * The claim is present only when the provider manages this application's access from its console; an empty list then means "no access".
 */
export interface SsoAccess {
  roles: string[];
  firstName?: string;
  lastName?: string;
}

/** Most to least privileged: someone holding several roles is given the strongest one. */
const PRIORITY: readonly Role[] = ['owner', 'manager', 'accountant', 'cashier'];

/** The role this application should give a person who holds these provider roles, or undefined when none of them is one of ours. */
export function roleFromIdp(roles: readonly string[]): Role | undefined {
  const held = new Set(roles.map((r) => r.trim().toLowerCase()));
  return PRIORITY.find((r) => held.has(r));
}

/** A first and last name for a new account from what the provider sent. The first name is never empty. */
export function namesFrom(access: SsoAccess, email: string): { firstName: string; lastName: string } {
  const first = access.firstName?.trim() ?? '';
  const last = access.lastName?.trim() ?? '';
  return { firstName: first || email.split('@')[0] || email, lastName: last };
}

/** Read the `app_roles` claim: a list of text, or undefined when the claim is absent or not a list (the provider does not manage this application). */
export function appRolesClaim(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : undefined;
}
