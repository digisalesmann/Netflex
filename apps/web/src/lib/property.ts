import { serverApi } from './server-api';
import { site } from './site';
import type { PublicPlan, PublicProperty } from './types';

export async function getProperty(): Promise<PublicProperty | null> {
  return (await serverApi<PublicProperty>(`/catalog/properties/${site.propertySlug}`)).data;
}

export async function getPlans(): Promise<PublicPlan[] | null> {
  return (await serverApi<PublicPlan[]>(`/catalog/properties/${site.propertySlug}/plans`)).data;
}
