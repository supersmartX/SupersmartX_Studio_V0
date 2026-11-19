import { getPrisma } from '@/lib/db/prisma';
import { isPlanActive, isCreatorPlan } from '@/lib/entitlements';

export interface BillingAccountBootstrap {
  userId: string;
  plan: string;
  status: 'free' | 'active' | 'expired' | 'unknown';
  paidThroughAt: Date | null;
}

export function classifyBillingAccount(input: {
  plan?: string | null;
  planExpiresAt?: string | null;
  now?: Date;
}): BillingAccountBootstrap {
  const now = input.now ?? new Date();
  const plan = input.plan || 'free';
  const paidThroughAt = input.planExpiresAt ? new Date(input.planExpiresAt) : null;

  if (plan === 'free') {
    return { userId: '', plan: 'free', status: paidThroughAt ? 'expired' : 'free', paidThroughAt };
  }
  if (!isCreatorPlan(plan) && !['unknown'].includes(plan)) {
    return { userId: '', plan: 'free', status: 'unknown', paidThroughAt };
  }
  if (!paidThroughAt || paidThroughAt.getTime() <= now.getTime()) {
    return { userId: '', plan: 'free', status: 'expired', paidThroughAt };
  }
  if (!isPlanActive(paidThroughAt.toISOString(), plan as never)) {
    return { userId: '', plan: 'free', status: 'expired', paidThroughAt };
  }
  return { userId: '', plan, status: 'active', paidThroughAt };
}

export async function bootstrapBillingAccount(
  userId: string,
  input: { plan?: string | null; planExpiresAt?: string | null; now?: Date },
): Promise<void> {
  const base = classifyBillingAccount(input);
  const prisma = getPrisma();
  await prisma.billingAccount.upsert({
    where: { userId },
    create: {
      userId,
      plan: base.plan,
      status: base.status,
      legacyPlan: input.plan || 'free',
      legacyPaidThroughAt: base.paidThroughAt,
      paidThroughAt: base.paidThroughAt,
    },
    update: {},
  });
}

export async function unlinkBillingAccount(userId: string): Promise<void> {
  const prisma = getPrisma();
  await prisma.billingAccount.update({
    where: { userId },
    data: {
      providerCustomerId: null,
      providerSubscriptionId: null,
      cancelAtPeriodEnd: false,
      lastEventId: null,
    },
  });
}
