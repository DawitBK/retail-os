import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { jwtVerify, SignJWT } from 'jose';
import type { Role } from '../db/schema.js';
import { ROLES } from '../db/schema.js';
import { forbidden, unauthorized } from './errors.js';

export interface Principal {
  userId: string;
  role: Role;
}

export const PUBLIC_KEY = 'retail:public';
export const ROLES_KEY = 'retail:roles';
export const AUTH_CONFIG = 'AUTH_CONFIG';

export interface AuthConfig {
  jwtSecret: string;
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
  /** Single sign-on through an OpenID Connect provider; absent means password sign-in only. */
  oidc?: { issuer: string; clientId: string; clientSecret: string };
}

/** Routes are denied by default; mark a handler or controller `@Public()` to open it. */
export const Public = () => SetMetadata(PUBLIC_KEY, true);
/** Restrict a handler to the listed roles (a signed-in user of any other role gets 403). */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const STAFF: Role[] = ['owner', 'manager', 'accountant', 'cashier'];

/** The authenticated principal of the request (set by the global AuthGuard). */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Principal => {
    const principal = context.switchToHttp().getRequest<{ principal?: Principal }>().principal;
    if (!principal) throw unauthorized();
    return principal;
  },
);

@Injectable()
export class TokenService {
  private readonly key: Uint8Array;

  constructor(@Inject(AUTH_CONFIG) private readonly config: AuthConfig) {
    this.key = new TextEncoder().encode(config.jwtSecret);
  }

  async signAccessToken(principal: Principal): Promise<string> {
    return new SignJWT({ role: principal.role })
      .setProtectedHeader({ alg: 'HS256', typ: 'at+jwt' })
      .setSubject(principal.userId)
      .setIssuedAt()
      .setExpirationTime(`${this.config.accessTtlSeconds}s`)
      .sign(this.key);
  }

  async verifyAccessToken(token: string): Promise<Principal> {
    try {
      const { payload } = await jwtVerify(token, this.key, { algorithms: ['HS256'] });
      const role = payload['role'];
      if (typeof payload.sub !== 'string' || !(ROLES as readonly unknown[]).includes(role)) {
        throw new Error('malformed claims');
      }
      return { userId: payload.sub, role: role as Role };
    } catch {
      throw unauthorized();
    }
  }
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(TokenService) private readonly tokens: TokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(PUBLIC_KEY, targets);
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      principal?: Principal;
    }>();
    const header = req.headers['authorization'];
    const bearer = header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;

    // A public route still reads a token when one is sent (so it can personalise), but never requires one.
    if (isPublic) {
      if (bearer)
        req.principal = await this.tokens.verifyAccessToken(bearer).catch(() => undefined);
      return true;
    }
    if (!bearer) throw unauthorized();
    req.principal = await this.tokens.verifyAccessToken(bearer);

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, targets);
    if (roles && !roles.includes(req.principal.role)) throw forbidden();
    return true;
  }
}
