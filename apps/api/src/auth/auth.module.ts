import { Global, Module, type DynamicModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AUTH_CONFIG, AuthGuard, TokenService, type AuthConfig } from '../common/auth.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { OidcService } from './oidc.service.js';

@Global()
@Module({})
export class AuthModule {
  static forRoot(config: AuthConfig): DynamicModule {
    return {
      module: AuthModule,
      controllers: [AuthController],
      providers: [
        { provide: AUTH_CONFIG, useValue: config },
        TokenService,
        AuthService,
        OidcService,
        // Every route requires a valid token unless it is marked @Public().
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
      exports: [TokenService, AuthService],
    };
  }
}
