import type { PublicPlan } from './types';

export type PlanVersion = PublicPlan & {
  version: number;
  publishedAt: string | null;
  locked: boolean;
};
export interface PlanDetail {
  id: string;
  slug: string;
  status: 'DRAFT' | 'PUBLISHED' | 'PAUSED' | 'ARCHIVED';
  versions: PlanVersion[];
}

export const PLAN_STATUS: Record<PlanDetail['status'], { label: string; tone: string }> = {
  PUBLISHED: { label: 'On sale', tone: 'ok' },
  PAUSED: { label: 'Paused', tone: 'warn' },
  DRAFT: { label: 'Not on sale yet', tone: 'info' },
  ARCHIVED: { label: 'Archived', tone: 'muted' },
};

export const SCOPE_LABEL = {
  INDIVIDUAL: 'One person',
  ROOM: 'Whole room',
  FLOOR: 'Whole floor',
} as const;

/** The version buyers get now (newest on sale), and a newer saved one if any. */
export function versionsOf(p: PlanDetail) {
  const live = p.versions.find((v) => v.publishedAt) ?? null;
  const draft =
    p.versions.find((v) => !v.publishedAt && (!live || v.version > live.version)) ?? null;
  return { live, draft, shown: live ?? draft ?? p.versions[0] ?? null };
}
