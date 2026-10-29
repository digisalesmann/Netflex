import {
  PERMISSIONS,
  ROLE_NAMES,
  ROLE_PERMISSIONS,
  type Permission,
  type RoleKey,
} from '@netflex/domain';
import type { PrismaClient } from '@prisma/client';

/**
 * Mirror the code-defined roles and permissions (packages/domain/src/permissions.ts)
 * into the roles/permissions tables. Idempotent; removes stale role→permission links.
 */
export async function syncRbac(
  prisma: PrismaClient,
): Promise<{ roles: number; permissions: number }> {
  return prisma.$transaction(async (tx) => {
    const permIds = new Map<Permission, string>();
    for (const [key, description] of Object.entries(PERMISSIONS) as [Permission, string][]) {
      const p = await tx.permission.upsert({
        where: { key },
        create: { key, description },
        update: { description },
      });
      permIds.set(key, p.id);
    }
    for (const [key, name] of Object.entries(ROLE_NAMES) as [RoleKey, string][]) {
      const role = await tx.role.upsert({
        where: { key },
        create: { key, name },
        update: { name },
      });
      const wanted = ROLE_PERMISSIONS[key].map((p) => permIds.get(p) as string);
      await tx.rolePermission.deleteMany({
        where: { roleId: role.id, permissionId: { notIn: wanted } },
      });
      await tx.rolePermission.createMany({
        data: wanted.map((permissionId) => ({ roleId: role.id, permissionId })),
        skipDuplicates: true,
      });
    }
    return { roles: Object.keys(ROLE_NAMES).length, permissions: permIds.size };
  });
}
