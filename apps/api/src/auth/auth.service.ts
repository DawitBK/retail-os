import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  conflict,
  FailureLimiter,
  LockedOutError,
  notFound,
  ProblemException,
  tooManyRequests,
  toPage,
} from '@retail/kit';
import argon2 from 'argon2';
import { and, asc, count, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';
import { recordAudit } from '../common/audit.js';
import { AUTH_CONFIG, type AuthConfig, type Principal, TokenService } from '../common/auth.js';
import { escapeLike, forbidden, pgCode, unauthorized, versionConflict } from '../common/errors.js';
import { DB, type Database, type Tx } from '../db/db.module.js';
import { refreshTokens, users, type UserRow } from '../db/schema.js';
import { namesFrom, roleFromIdp, type SsoAccess } from './sso-access.js';
import type {
  ChangePassword,
  CreateStaff,
  ListStaffQuery,
  Login,
  TokenPair,
  UpdateStaff,
  UserDto,
} from './auth.contract.js';
import { now } from '../common/time.js';

export const toUserDto = (row: UserRow): UserDto => ({
  id: row.id,
  email: row.email,
  firstName: row.firstName,
  lastName: row.lastName,
  role: row.role,
  active: row.active,
  version: row.version,
  createdAt: row.createdAt.toISOString(),
});

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const newRefreshToken = () => randomBytes(32).toString('base64url');

// argon2id with the OWASP-recommended minimum cost (19 MiB, 2 passes, 1 lane).
const ARGON2 = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
// A hash of a throwaway value: verified when the email is unknown so both failures cost the same.
const DUMMY_HASH = await argon2.hash(randomUUID(), ARGON2);

/**
 * Five failed sign-ins for one email in fifteen minutes lock that email for fifteen minutes, even
 * against the right password, so a guess spread over many addresses is still slow. Unknown emails
 * are counted the same way, so the lock does not reveal which accounts exist. The cost: someone
 * can lock a known email out for a while, which is the standard trade for slowing guessing.
 */
const loginFailures = new FailureLimiter({
  maxFailures: 5,
  windowMs: 15 * 60_000,
  lockMs: 15 * 60_000,
});

function assertNotLocked(email: string): void {
  try {
    loginFailures.assertAllowed(email);
  } catch (e) {
    if (e instanceof LockedOutError) {
      throw tooManyRequests(
        e.retryAfterSeconds,
        'Too many failed sign-ins for this account. Try again later.',
      );
    }
    throw e;
  }
}

export const hashPassword = (password: string) => argon2.hash(password, ARGON2);

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(TokenService) private readonly tokens: TokenService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  async login(input: Login): Promise<TokenPair> {
    assertNotLocked(input.email);
    const [user] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.email, input.email), isNull(users.deletedAt)));
    // The same answer for an unknown email, a wrong password and a disabled account, at the same cost.
    const ok = await argon2
      .verify(user?.passwordHash ?? DUMMY_HASH, input.password)
      .catch(() => false);
    if (!user || !ok || !user.active) {
      loginFailures.recordFailure(input.email);
      throw unauthorized('Email or password is incorrect');
    }
    loginFailures.reset(input.email);
    return this.issue(user, randomUUID());
  }

  /**
   * Sign in someone the identity provider vouches for (single sign-on). The provider's id for the person is bound to the account at the first
   * sign-in; after that the SAME email with a DIFFERENT id is refused (an address given to someone else later must not inherit the account).
   *
   * Without `access` (the provider does not manage this application's access) the person must already have an active account here.
   * With it, the provider decides: no recognised role means no access (403); otherwise the account is created at the first sign-in when it is
   * missing, and its role is set to the provider's at EVERY sign-in, so a change made in the provider's console is in force at the next one.
   * A person switched off here is still refused: the provider does not override that.
   */
  async loginWithVerifiedEmail(
    email: string,
    subject: string,
    access?: SsoAccess,
  ): Promise<TokenPair> {
    const role = access ? roleFromIdp(access.roles) : undefined;
    if (access && !role) {
      throw forbidden(
        'You have not been given access to Retail OS. Ask an administrator to give you a role in the identity provider.',
      );
    }
    const find = () =>
      this.db
        .select()
        .from(users)
        .where(and(eq(users.email, email), isNull(users.deletedAt)));
    let [user] = await find();
    if (!user && role && access) {
      try {
        user = await this.db.transaction(async (tx) => {
          const [row] = await tx
            .insert(users)
            .values({
              email,
              // Nobody knows this password: the account is for single sign-on until an administrator sets one.
              passwordHash: await hashPassword(randomBytes(32).toString('base64url')),
              ...namesFrom(access, email),
              role,
            })
            .returning();
          await recordAudit(tx, {
            actor: 'identity-provider',
            action: 'staff.created-by-sso',
            entityType: 'user',
            entityId: row!.id,
            after: toUserDto(row!),
          });
          return row!;
        });
      } catch (e) {
        // Two first sign-ins at once: the other one created it.
        if (pgCode(e) !== '23505') throw e;
        [user] = await find();
      }
    }
    if (!user || !user.active) throw unauthorized('There is no active account for this identity');
    if (user.ssoSubject && user.ssoSubject !== subject) {
      throw unauthorized(
        'This sign-in belongs to a different person than the account with that email',
      );
    }
    if (!user.ssoSubject) {
      try {
        await this.db.update(users).set({ ssoSubject: subject }).where(eq(users.id, user.id));
      } catch (e) {
        if (pgCode(e) === '23505')
          throw unauthorized('This sign-in is already bound to another account');
        throw e;
      }
    }
    if (role && user.role !== role) {
      const before = toUserDto(user);
      const current = user;
      user = await this.db.transaction(async (tx) => {
        const [row] = await tx
          .update(users)
          .set({ role, version: sql`${users.version} + 1`, updatedAt: now() })
          .where(eq(users.id, current.id))
          .returning();
        await recordAudit(tx, {
          actor: 'identity-provider',
          action: 'staff.role-set-by-sso',
          entityType: 'user',
          entityId: row!.id,
          before,
          after: toUserDto(row!),
        });
        return row!;
      });
    }
    return this.issue(user, randomUUID());
  }

  /**
   * The identity provider says this person signed out or was disabled there: end every session of the account (all refresh tokens; an access token
   * lives at most its short lifetime). Answers the same for an id this app has never seen, so the call reveals nothing.
   */
  async revokeSessionsBySsoSubject(subject: string): Promise<number> {
    const revoked = await this.db
      .update(refreshTokens)
      .set({ revokedAt: now() })
      .where(
        and(
          isNull(refreshTokens.revokedAt),
          sql`${refreshTokens.userId} in (select id from users where sso_subject = ${subject})`,
        ),
      )
      .returning({ id: refreshTokens.id });
    return revoked.length;
  }

  async refresh(presented: string): Promise<TokenPair> {
    const hash = sha256(presented);
    const outcome = await this.db.transaction(async (tx): Promise<TokenPair | 'reuse'> => {
      const [token] = await tx
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.tokenHash, hash))
        .for('update');
      if (!token) throw unauthorized('Refresh token is not valid');
      if (token.revokedAt) {
        // A spent token came back: someone holds a copy. Revoke the whole family. The
        // revocation has to commit, so the 401 is raised after the transaction ends.
        await tx
          .update(refreshTokens)
          .set({ revokedAt: now() })
          .where(and(eq(refreshTokens.familyId, token.familyId), isNull(refreshTokens.revokedAt)));
        return 'reuse';
      }
      if (token.expiresAt.getTime() <= Date.now()) throw unauthorized('Refresh token has expired');
      const [user] = await tx
        .select()
        .from(users)
        .where(and(eq(users.id, token.userId), isNull(users.deletedAt)));
      if (!user || !user.active) throw unauthorized('Refresh token is not valid');
      await tx
        .update(refreshTokens)
        .set({ revokedAt: now() })
        .where(eq(refreshTokens.id, token.id));
      return this.issue(user, token.familyId, tx);
    });
    if (outcome === 'reuse') throw unauthorized('Refresh token was already used; sign in again');
    return outcome;
  }

  async logout(presented: string): Promise<void> {
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: now() })
      .where(
        and(
          isNull(refreshTokens.revokedAt),
          sql`${refreshTokens.familyId} = (select family_id from refresh_tokens where token_hash = ${sha256(presented)})`,
        ),
      );
  }

  async me(principal: Principal): Promise<UserDto> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.id, principal.userId), isNull(users.deletedAt)));
    if (!row || !row.active) throw unauthorized('The account no longer exists');
    return toUserDto(row);
  }

  /** Change your own password; every session (refresh token) is revoked so a stolen one dies. */
  async changePassword(principal: Principal, input: ChangePassword): Promise<void> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.id, principal.userId), isNull(users.deletedAt)));
    const ok = row
      ? await argon2.verify(row.passwordHash, input.currentPassword).catch(() => false)
      : false;
    if (!row || !ok) throw unauthorized('Current password is incorrect');
    const passwordHash = await hashPassword(input.newPassword);
    await this.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ passwordHash, version: sql`${users.version} + 1`, updatedAt: now() })
        .where(eq(users.id, row.id));
      await this.revokeAll(tx, row.id);
      await recordAudit(tx, {
        actor: principal.userId,
        action: 'staff.password-changed',
        entityType: 'user',
        entityId: row.id,
      });
    });
  }

  async createStaff(actor: Principal, input: CreateStaff): Promise<UserDto> {
    const passwordHash = await hashPassword(input.password);
    try {
      return await this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(users)
          .values({
            email: input.email,
            passwordHash,
            firstName: input.firstName,
            lastName: input.lastName,
            role: input.role,
          })
          .returning();
        const dto = toUserDto(row!);
        await recordAudit(tx, {
          actor: actor.userId,
          action: 'staff.created',
          entityType: 'user',
          entityId: dto.id,
          after: dto,
        });
        return dto;
      });
    } catch (e) {
      if (pgCode(e) === '23505') throw conflict('email-taken', 'Email already in use');
      throw e;
    }
  }

  async listStaff(viewer: Principal, query: ListStaffQuery) {
    // The platform administrator is in nobody else's list; only their own row shows to themselves.
    const where: SQL[] = [
      isNull(users.deletedAt),
      or(eq(users.platformAdmin, false), eq(users.id, viewer.userId)) as SQL,
    ];
    if (query.role) where.push(eq(users.role, query.role));
    if (query.q) {
      const like = `%${escapeLike(query.q)}%`;
      where.push(
        or(
          ilike(users.email, like),
          ilike(users.firstName, like),
          ilike(users.lastName, like),
        ) as SQL,
      );
    }
    const [rows, totals] = await Promise.all([
      this.db
        .select()
        .from(users)
        .where(and(...where))
        .orderBy(asc(users.createdAt), asc(users.id))
        .limit(query.limit)
        .offset(query.offset),
      this.db
        .select({ total: count() })
        .from(users)
        .where(and(...where)),
    ]);
    return toPage(rows.map(toUserDto), totals[0]?.total ?? 0, query);
  }

  async updateStaff(actor: Principal, id: string, input: UpdateStaff): Promise<UserDto> {
    if (actor.userId === id && (input.role !== undefined || input.active === false)) {
      throw new ProblemException(
        422,
        'self-lockout',
        'Cannot demote or disable yourself',
        'Ask another owner, so the last owner can never be removed',
      );
    }
    const passwordHash = input.password ? await hashPassword(input.password) : undefined;
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(users)
        .where(and(eq(users.id, id), isNull(users.deletedAt)))
        .for('update');
      // The platform administrator answers like an id that was never there to everyone but themselves.
      if (!current || (current.platformAdmin && current.id !== actor.userId))
        throw notFound(`Staff member ${id} does not exist`);
      if (current.version !== input.version) {
        throw versionConflict('staff member', current.version, input.version);
      }
      const [row] = await tx
        .update(users)
        .set({
          ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
          ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
          ...(input.role !== undefined ? { role: input.role } : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
          ...(passwordHash ? { passwordHash } : {}),
          version: sql`${users.version} + 1`,
          updatedAt: now(),
        })
        .where(eq(users.id, id))
        .returning();
      // A disabled account or a reset password ends every session immediately.
      if (input.active === false || passwordHash) await this.revokeAll(tx, id);
      const after = toUserDto(row!);
      await recordAudit(tx, {
        actor: actor.userId,
        action: 'staff.updated',
        entityType: 'user',
        entityId: id,
        before: toUserDto(current),
        after,
      });
      return after;
    });
  }

  private async revokeAll(tx: Tx, userId: string): Promise<void> {
    await tx
      .update(refreshTokens)
      .set({ revokedAt: now() })
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
  }

  private async issue(
    user: UserRow,
    familyId: string,
    executor: Pick<Database, 'insert'> = this.db,
  ): Promise<TokenPair> {
    const refreshToken = newRefreshToken();
    await executor.insert(refreshTokens).values({
      userId: user.id,
      familyId,
      tokenHash: sha256(refreshToken),
      expiresAt: new Date(Date.now() + this.config.refreshTtlSeconds * 1000),
    });
    const accessToken = await this.tokens.signAccessToken({ userId: user.id, role: user.role });
    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: this.config.accessTtlSeconds,
      user: toUserDto(user),
    };
  }
}
