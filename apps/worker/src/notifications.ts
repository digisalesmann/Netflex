import type { NetflexConfig } from '@netflex/config';
import type { PrismaClient } from '@netflex/database';
import {
  FakeMailer,
  ResendMailer,
  UnconfiguredMailer,
  opsAlertEmail,
  planEndingEmail,
  receiptEmail,
  type Brand,
  type Mailer,
  type RenderedEmail,
} from '@netflex/email';
import type { Logger } from '@netflex/observability';

const DAY = 86_400_000;
const LAGOS = 'Africa/Lagos';

export function mailerFrom(config: NetflexConfig): Mailer {
  if (config.EMAIL_PROVIDER === 'fake') return new FakeMailer(config.NETFLEX_ENV);
  if (config.EMAIL_PROVIDER === 'resend')
    return new ResendMailer({
      apiKey: config.RESEND_API_KEY as string,
      from: config.EMAIL_FROM as string,
      replyTo: config.EMAIL_REPLY_TO,
    });
  return new UnconfiguredMailer();
}

type Prefs = { email?: { receipts?: boolean; expiryReminders?: boolean } };
/** Email is on unless the resident turned it off (matches the account defaults). */
const wants = (prefs: unknown, k: 'receipts' | 'expiryReminders') =>
  (prefs as Prefs | null)?.email?.[k] !== false;

const money = (minor: bigint, currency: string) => {
  const major = Number(minor) / 100;
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency,
    maximumFractionDigits: Number.isInteger(major) ? 0 : 2,
  }).format(major);
};
const when = (d: Date) =>
  new Intl.DateTimeFormat('en-NG', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: LAGOS,
  }).format(d);
const UNITS: Record<string, [string, string]> = {
  MINUTE: ['minute', 'minutes'],
  HOUR: ['hour', 'hours'],
  DAY: ['day', 'days'],
  WEEK: ['week', 'weeks'],
  CALENDAR_MONTH: ['month', 'months'],
};
const lasts = (d: { value: number; unit: string }) => {
  const u = UNITS[d.unit] ?? [d.unit.toLowerCase(), d.unit.toLowerCase()];
  return `${d.value} ${d.value === 1 ? u[0] : u[1]}`;
};

/**
 * Account emails sent by the worker. Every send is recorded in `notifications`
 * (no secrets, no codes) and checked first, so retries never email twice.
 */
export class Notifier {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly mailer: Mailer,
    private readonly webUrl: string,
    private readonly log: Logger,
  ) {}

  private async brand(propertyId: string): Promise<Brand> {
    const p = await this.prisma.property.findUnique({
      where: { id: propertyId },
      select: { name: true, supportEmail: true, supportPhone: true },
    });
    return {
      lodgeName: p?.name ?? 'Netflex',
      webUrl: this.webUrl,
      supportEmail: p?.supportEmail,
      supportPhone: p?.supportPhone,
    };
  }

  private async deliver(
    to: string,
    userId: string | null,
    template: string,
    params: Record<string, string>,
    email: RenderedEmail,
  ): Promise<'SENT' | 'FAILED' | 'SKIPPED'> {
    if (!this.mailer.configured) {
      await this.prisma.notification.create({
        data: {
          userId,
          recipient: to,
          channel: 'EMAIL',
          template,
          params,
          status: 'SKIPPED',
          error: 'email not set up',
        },
      });
      return 'SKIPPED';
    }
    try {
      await this.mailer.send(to, email);
      await this.prisma.notification.create({
        data: {
          userId,
          recipient: to,
          channel: 'EMAIL',
          template,
          params,
          status: 'SENT',
          sentAt: new Date(),
        },
      });
      return 'SENT';
    } catch (e) {
      await this.prisma.notification.create({
        data: {
          userId,
          recipient: to,
          channel: 'EMAIL',
          template,
          params,
          status: 'FAILED',
          error: (e instanceof Error ? e.message : 'send failed').slice(0, 200),
        },
      });
      this.log.warn({ template }, 'email failed');
      // Throw so the job retries; the recorded FAILED row doesn't block a later SENT.
      throw e;
    }
  }

  /** Receipt for a paid order bought from an account (guests get Paystack's own receipt). */
  async receipt(orderId: string): Promise<string> {
    if (await this.sentBefore('receipt', 'orderId', orderId)) return 'already sent';
    const o = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        customer: { select: { id: true, email: true, displayName: true, notificationPrefs: true } },
        planVersion: {
          select: { name: true, durationValue: true, durationUnit: true, activationPolicy: true },
        },
        payments: { where: { status: { in: ['SUCCEEDED', 'PARTIALLY_REFUNDED'] } }, take: 1 },
      },
    });
    if (!o || o.status !== 'PAID') return 'not paid';
    // A backlog (e.g. after an outage) shouldn't email people about old purchases.
    if (o.paidAt && Date.now() - o.paidAt.getTime() > 2 * DAY) return 'too old';
    const c = o.customer;
    if (!c?.email) return 'guest (Paystack sends the receipt)';
    if (!wants(c.notificationPrefs, 'receipts')) return 'turned off';
    const pay = o.payments[0];
    const v = o.planVersion;
    const r = await this.deliver(
      c.email,
      c.id,
      'receipt',
      { orderId: o.id },
      receiptEmail({
        brand: await this.brand(o.propertyId),
        to: c.email,
        name: c.displayName === 'Guest' ? '' : (c.displayName.split(/\s+/)[0] ?? ''),
        plan: v.name,
        amount: money(pay?.amountMinor ?? o.amountMinor, o.currency),
        reference: o.reference,
        paidAt: when(o.paidAt ?? new Date()),
        lasts: lasts({ value: v.durationValue, unit: v.durationUnit }),
        starts:
          v.activationPolicy === 'ON_PURCHASE' ? 'Straight away' : 'When you first enter your code',
      }),
    );
    return r;
  }

  /** "Ends tomorrow" emails for plans ending in the next 24 hours, once per plan. */
  async planEndingReminders(now = new Date()): Promise<{ sent: number; skipped: number }> {
    const soon = await this.prisma.entitlement.findMany({
      where: {
        status: 'ACTIVE',
        expiresAt: {
          gt: new Date(now.getTime() + 60 * 60_000),
          lte: new Date(now.getTime() + DAY),
        },
      },
      take: 200,
      select: {
        id: true,
        propertyId: true,
        expiresAt: true,
        subscription: {
          select: {
            planVersion: { select: { name: true } },
            owner: {
              select: {
                id: true,
                email: true,
                displayName: true,
                notificationPrefs: true,
                status: true,
              },
            },
          },
        },
      },
    });
    let sent = 0;
    let skipped = 0;
    for (const e of soon) {
      const u = e.subscription.owner;
      if (
        !u?.email ||
        u.status !== 'ACTIVE' ||
        !wants(u.notificationPrefs, 'expiryReminders') ||
        !e.expiresAt
      ) {
        skipped++;
        continue;
      }
      if (await this.sentBefore('plan_ending', 'entitlementId', e.id)) continue;
      const hours = Math.round((e.expiresAt.getTime() - now.getTime()) / 3_600_000);
      const r = await this.deliver(
        u.email,
        u.id,
        'plan_ending',
        { entitlementId: e.id },
        planEndingEmail({
          brand: await this.brand(e.propertyId),
          to: u.email,
          name: u.displayName,
          plan: e.subscription.planVersion.name,
          endsAt: when(e.expiresAt),
          left: hours <= 20 ? `in about ${hours} hours` : 'tomorrow',
        }),
      ).catch(() => 'FAILED' as const);
      if (r === 'SENT') sent++;
      else skipped++;
    }
    return { sent, skipped };
  }

  /** Daily-deduplicated alerts to platform owners about things that need a person. */
  async opsAlerts(now = new Date()): Promise<number> {
    const owners = await this.prisma.user.findMany({
      where: {
        kind: 'STAFF',
        status: 'ACTIVE',
        email: { not: null },
        roles: { some: { revokedAt: null, propertyId: null, role: { key: 'OWNER' } } },
      },
      select: { id: true, email: true },
    });
    if (!owners.length) return 0;
    const props = await this.prisma.property.findMany({ select: { id: true } });
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: LAGOS }).format(now);
    const hourAgo = new Date(now.getTime() - 60 * 60_000);
    let sent = 0;
    for (const p of props) {
      const [failedJobs, down, mismatches, refundsFailed] = await Promise.all([
        this.prisma.networkOperation.count({
          where: { propertyId: p.id, status: 'FAILED', updatedAt: { gte: hourAgo } },
        }),
        this.prisma.gateway.count({
          where: { propertyId: p.id, status: { in: ['DEGRADED', 'UNREACHABLE'] } },
        }),
        this.prisma.reconciliationDiscrepancy.count({
          where: { propertyId: p.id, resolvedAt: null },
        }),
        this.prisma.refund.count({
          where: {
            status: 'FAILED',
            payment: { order: { propertyId: p.id } },
            updatedAt: { gte: new Date(now.getTime() - DAY) },
          },
        }),
      ]);
      const alerts: { key: string; title: string; lines: string[]; label: string; path: string }[] =
        [];
      if (down)
        alerts.push({
          key: 'gateway_down',
          title: 'Wi-Fi equipment isn’t answering',
          lines: [
            `${down} piece${down === 1 ? '' : 's'} of Wi-Fi equipment stopped answering the system.`,
            'New buyers may not get online until it’s back.',
          ],
          label: 'Open Network',
          path: '/admin/network',
        });
      if (failedJobs)
        alerts.push({
          key: 'network_jobs_failed',
          title: 'Some plans couldn’t be switched on or off',
          lines: [
            `${failedJobs} instruction${failedJobs === 1 ? '' : 's'} to the Wi-Fi equipment failed in the last hour.`,
          ],
          label: 'Open Network',
          path: '/admin/network',
        });
      if (mismatches)
        alerts.push({
          key: 'payment_mismatch',
          title: 'Payments need checking',
          lines: [
            `${mismatches} payment mismatch${mismatches === 1 ? '' : 'es'} found by the nightly check.`,
          ],
          label: 'Open Mismatches',
          path: '/admin/payments/mismatches',
        });
      if (refundsFailed)
        alerts.push({
          key: 'refund_failed',
          title: 'A refund didn’t go through',
          lines: ['Paystack rejected a refund. The buyer hasn’t been paid back yet.'],
          label: 'Open Refunds',
          path: '/admin/payments/refunds',
        });
      for (const a of alerts) {
        const dedupe = `${p.id}:${a.key}:${today}`;
        if (await this.sentBefore('ops_alert', 'dedupe', dedupe)) continue;
        const email = opsAlertEmail({
          brand: await this.brand(p.id),
          title: a.title,
          lines: a.lines,
          actionLabel: a.label,
          actionPath: a.path,
        });
        for (const o of owners)
          await this.deliver(o.email as string, o.id, 'ops_alert', { dedupe }, email).catch(
            () => null,
          );
        sent++;
      }
    }
    return sent;
  }

  /** True if this email already went out (a FAILED attempt doesn't count). */
  private async sentBefore(template: string, key: string, value: string): Promise<boolean> {
    const n = await this.prisma.notification.findFirst({
      where: {
        template,
        status: { in: ['SENT', 'SKIPPED'] },
        params: { path: [key], equals: value },
      },
      select: { id: true },
    });
    return n !== null;
  }
}
