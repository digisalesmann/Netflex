import { Controller, Get, Header, Inject, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { PrismaClient } from '@netflex/database';
import { z } from 'zod';
import { Public } from '../auth/decorators.js';
import { notFound } from '../common/prisma-errors.js';
import { ZodPipe } from '../common/zod.js';
import { PRISMA } from '../infra/tokens.js';
import { publicPlanView } from './plan-mapper.js';

const Slug = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(60);

/**
 * Public plan catalog for the marketing site and captive portal. Shows only
 * published plans (latest published version each) within their availability window.
 */
@Public()
@ApiTags('catalog')
@Controller({ path: 'catalog/properties/:slug' })
export class CatalogController {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  @Get()
  @Header('Cache-Control', 'public, max-age=60')
  async property(@Param('slug', new ZodPipe(Slug)) slug: string) {
    const p = await this.prisma.property.findUnique({
      where: { slug },
      select: {
        name: true,
        slug: true,
        timeZone: true,
        currency: true,
        supportPhone: true,
        supportEmail: true,
      },
    });
    if (!p) throw notFound();
    return p;
  }

  @Get('plans')
  @Header('Cache-Control', 'public, max-age=60')
  async plans(@Param('slug', new ZodPipe(Slug)) slug: string) {
    const property = await this.prisma.property.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!property) throw notFound();
    const now = new Date();
    const plans = await this.prisma.plan.findMany({
      where: { propertyId: property.id, status: 'PUBLISHED' },
      include: {
        versions: { where: { publishedAt: { not: null } }, orderBy: { version: 'desc' }, take: 1 },
      },
      orderBy: { createdAt: 'asc' },
    });
    return plans
      .filter((p) => {
        const v = p.versions[0];
        return (
          v &&
          (!v.availableFrom || v.availableFrom <= now) &&
          (!v.availableUntil || now < v.availableUntil)
        );
      })
      .map((p) => publicPlanView(p, p.versions[0] as NonNullable<(typeof p.versions)[0]>));
  }
}
