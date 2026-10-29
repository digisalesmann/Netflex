import { activation, duration, scopeLabel, speed } from '@/lib/format';
import type { PublicPlan } from '@/lib/types';

/** Everything a customer must see before paying (spec §10), in one consistent block. */
export function PlanTerms({ plan }: { plan: PublicPlan }) {
  return (
    <dl className="facts">
      <dt>Price</dt>
      <dd>{plan.price.display}</dd>
      <dt>Lasts</dt>
      <dd>{duration(plan.duration)}</dd>
      <dt>Starts</dt>
      <dd>{activation(plan)}</dd>
      <dt>For</dt>
      <dd>
        {scopeLabel[plan.scope]}
        {plan.maxGroupMembers ? ` (up to ${plan.maxGroupMembers} people)` : ''}
      </dd>
      <dt>Devices</dt>
      <dd>
        Up to {plan.maxDevices} device{plan.maxDevices === 1 ? '' : 's'},{' '}
        {plan.maxConcurrentSessions} online at once
      </dd>
      <dt>Speed</dt>
      <dd>{speed(plan.speed)}</dd>
      {plan.fairUseText ? (
        <>
          <dt>Fair use</dt>
          <dd>{plan.fairUseText}</dd>
        </>
      ) : null}
      <dt>Refunds</dt>
      <dd>{plan.refundPolicyText}</dd>
    </dl>
  );
}
