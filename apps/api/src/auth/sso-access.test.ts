import { describe, expect, it } from 'vitest';
import { appRolesClaim, namesFrom, roleFromIdp } from './sso-access.js';

describe('roleFromIdp', () => {
  it('gives the strongest of the roles the provider gave', () => {
    expect(roleFromIdp(['cashier'])).toBe('cashier');
    expect(roleFromIdp(['cashier', 'manager'])).toBe('manager');
    expect(roleFromIdp(['accountant', 'cashier', 'owner'])).toBe('owner');
  });

  it('ignores case and spaces, and roles that are not ours', () => {
    expect(roleFromIdp([' Owner '])).toBe('owner');
    expect(roleFromIdp(['wizard', 'cashier'])).toBe('cashier');
  });

  it('gives nothing when no role is one of ours, so there is no access', () => {
    expect(roleFromIdp([])).toBeUndefined();
    expect(roleFromIdp(['wizard', 'admin'])).toBeUndefined();
  });
});

describe('namesFrom', () => {
  it("uses the provider's names, trimmed", () => {
    expect(namesFrom({ roles: [], firstName: ' Abebe ', lastName: 'Kebede ' }, 'a@b.test')).toEqual(
      { firstName: 'Abebe', lastName: 'Kebede' },
    );
  });

  it('never leaves the first name empty: the address before the @ stands in, and the last name may be empty', () => {
    expect(namesFrom({ roles: [] }, 'abebe.k@shop.test')).toEqual({
      firstName: 'abebe.k',
      lastName: '',
    });
    expect(
      namesFrom({ roles: [], firstName: '  ', lastName: 'Kebede' }, 'abebe@shop.test'),
    ).toEqual({ firstName: 'abebe', lastName: 'Kebede' });
  });
});

describe('appRolesClaim', () => {
  it('is a list of text when the provider sent one, even an empty list (no access)', () => {
    expect(appRolesClaim(['owner', 'cashier'])).toEqual(['owner', 'cashier']);
    expect(appRolesClaim([])).toEqual([]);
    expect(appRolesClaim(['owner', 3, null, 'cashier'])).toEqual(['owner', 'cashier']);
  });

  it('is undefined when the claim is absent or not a list: the provider does not manage this application', () => {
    expect(appRolesClaim(undefined)).toBeUndefined();
    expect(appRolesClaim('owner')).toBeUndefined();
    expect(appRolesClaim({ 0: 'owner' })).toBeUndefined();
    expect(appRolesClaim(null)).toBeUndefined();
  });
});
