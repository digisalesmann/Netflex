import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AuthContext } from '../auth/auth.types.js';
import {
  CurrentAuth,
  RequestMeta,
  RequirePermission,
  type RequestMetaValue,
  RequireKind,
} from '../auth/decorators.js';
import { ZodPipe, pagination, phoneE164, reason, uuid } from '../common/zod.js';
import { TenancyService } from './tenancy.service.js';

const isoDate = z.coerce.date();
const ListQuery = pagination.extend({ search: z.string().trim().min(1).max(60).optional() });
const Onboard = z.strictObject({
  phone: phoneE164,
  displayName: z.string().trim().min(1).max(120),
  roomId: uuid,
  startsAt: isoDate,
  reason: reason.optional(),
});
const Move = z.strictObject({ userId: uuid, roomId: uuid, startsAt: isoDate, reason });
const End = z.strictObject({ endsAt: isoDate, reason });
const Grant = z.strictObject({
  userId: uuid,
  scope: z.enum(['ROOM', 'FLOOR']),
  targetId: uuid,
  reason,
});
const Revoke = z.strictObject({ reason });

@RequireKind('STAFF')
@ApiTags('admin: tenancy')
@Controller({ path: 'admin/properties/:propertyId' })
export class TenancyController {
  constructor(@Inject(TenancyService) private readonly svc: TenancyService) {}

  @RequirePermission('tenant.read')
  @Get('tenants')
  list(
    @Param('propertyId', new ParseUUIDPipe()) propertyId: string,
    @Query(new ZodPipe(ListQuery)) q: z.infer<typeof ListQuery>,
  ) {
    return this.svc.listTenants(propertyId, q);
  }

  @RequirePermission('tenant.read')
  @Get('tenants/:userId')
  get(
    @Param('propertyId', new ParseUUIDPipe()) propertyId: string,
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ) {
    return this.svc.getTenant(propertyId, userId);
  }

  @RequirePermission('tenant.manage')
  @Post('tenants')
  onboard(
    @CurrentAuth() auth: AuthContext,
    @RequestMeta() meta: RequestMetaValue,
    @Param('propertyId', new ParseUUIDPipe()) propertyId: string,
    @Body(new ZodPipe(Onboard)) body: z.infer<typeof Onboard>,
  ) {
    return this.svc.onboard({ auth, meta, propertyId }, body);
  }

  @RequirePermission('tenant.manage')
  @Post('assignments')
  move(
    @CurrentAuth() auth: AuthContext,
    @RequestMeta() meta: RequestMetaValue,
    @Param('propertyId', new ParseUUIDPipe()) propertyId: string,
    @Body(new ZodPipe(Move)) body: z.infer<typeof Move>,
  ) {
    return this.svc.move({ auth, meta, propertyId }, body);
  }

  @RequirePermission('tenant.manage')
  @Post('assignments/:assignmentId/end')
  @HttpCode(200)
  end(
    @CurrentAuth() auth: AuthContext,
    @RequestMeta() meta: RequestMetaValue,
    @Param('propertyId', new ParseUUIDPipe()) propertyId: string,
    @Param('assignmentId', new ParseUUIDPipe()) assignmentId: string,
    @Body(new ZodPipe(End)) body: z.infer<typeof End>,
  ) {
    return this.svc.endAssignment({ auth, meta, propertyId }, assignmentId, body);
  }

  @RequirePermission('group.manage')
  @Post('group-authorities')
  grant(
    @CurrentAuth() auth: AuthContext,
    @RequestMeta() meta: RequestMetaValue,
    @Param('propertyId', new ParseUUIDPipe()) propertyId: string,
    @Body(new ZodPipe(Grant)) body: z.infer<typeof Grant>,
  ) {
    return this.svc.grantAuthority({ auth, meta, propertyId }, body);
  }

  @RequirePermission('group.manage')
  @Post('group-authorities/:authorityId/revoke')
  @HttpCode(200)
  revoke(
    @CurrentAuth() auth: AuthContext,
    @RequestMeta() meta: RequestMetaValue,
    @Param('propertyId', new ParseUUIDPipe()) propertyId: string,
    @Param('authorityId', new ParseUUIDPipe()) authorityId: string,
    @Body(new ZodPipe(Revoke)) body: z.infer<typeof Revoke>,
  ) {
    return this.svc.revokeAuthority({ auth, meta, propertyId }, authorityId, body.reason);
  }
}
