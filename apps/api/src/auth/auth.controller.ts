import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import { ZodValidationPipe } from '@retail/kit';
import { CurrentUser, Public, Roles, type Principal } from '../common/auth.js';
import {
  changePasswordSchema,
  createStaffSchema,
  idParamsSchema,
  oidcExchangeSchema,
  type OidcExchange,
  listStaffQuerySchema,
  loginSchema,
  refreshSchema,
  updateStaffSchema,
  type ChangePassword,
  type CreateStaff,
  type ListStaffQuery,
  type Login,
  type RefreshRequest,
  type UpdateStaff,
} from './auth.contract.js';
import { AuthService } from './auth.service.js';
import { OidcService } from './oidc.service.js';

@Controller('api/v1')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(OidcService) private readonly oidc: OidcService,
  ) {}

  @Public()
  @Get('auth/oidc/config')
  oidcConfig() {
    return this.oidc.publicConfig();
  }

  @Public()
  @Post('auth/oidc/exchange')
  @HttpCode(200)
  oidcExchange(@Body(new ZodValidationPipe(oidcExchangeSchema)) body: OidcExchange) {
    return this.oidc.exchange(body);
  }

  @Public()
  @Post('auth/login')
  @HttpCode(200)
  login(@Body(new ZodValidationPipe(loginSchema)) body: Login) {
    return this.auth.login(body);
  }

  @Public()
  @Post('auth/refresh')
  @HttpCode(200)
  refresh(@Body(new ZodValidationPipe(refreshSchema)) body: RefreshRequest) {
    return this.auth.refresh(body.refreshToken);
  }

  @Public()
  @Post('auth/logout')
  @HttpCode(204)
  async logout(@Body(new ZodValidationPipe(refreshSchema)) body: RefreshRequest) {
    await this.auth.logout(body.refreshToken);
  }

  @Get('me')
  me(@CurrentUser() user: Principal) {
    return this.auth.me(user);
  }

  @Post('me/password')
  @HttpCode(204)
  async changePassword(
    @CurrentUser() user: Principal,
    @Body(new ZodValidationPipe(changePasswordSchema)) body: ChangePassword,
  ) {
    await this.auth.changePassword(user, body);
  }

  @Roles('owner')
  @Post('staff')
  createStaff(
    @CurrentUser() actor: Principal,
    @Body(new ZodValidationPipe(createStaffSchema)) body: CreateStaff,
  ) {
    return this.auth.createStaff(actor, body);
  }

  @Roles('owner')
  @Get('staff')
  listStaff(@Query(new ZodValidationPipe(listStaffQuerySchema)) query: ListStaffQuery) {
    return this.auth.listStaff(query);
  }

  @Roles('owner')
  @Patch('staff/:id')
  updateStaff(
    @CurrentUser() actor: Principal,
    @Param(new ZodValidationPipe(idParamsSchema)) params: { id: string },
    @Body(new ZodValidationPipe(updateStaffSchema)) body: UpdateStaff,
  ) {
    return this.auth.updateStaff(actor, params.id, body);
  }
}
