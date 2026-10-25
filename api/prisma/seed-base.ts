import type { PrismaClient } from '@prisma/client';
import {
  BASE_ROLE_TEMPLATE,
  type BaseRoleKey,
  DEFAULT_PLATFORM_ROLE_PERMISSIONS,
  ORG_PERMISSIONS,
  PLATFORM_PERMISSIONS,
} from '../src/permissions/catalog';

/**
 * Datos de catálogo que toda instalación necesita (también los tests).
 * Es idempotente y no pisa lo que la plataforma ya haya editado.
 */
export async function seedBase(prisma: PrismaClient): Promise<void> {
  for (const p of ORG_PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key: p.key },
      update: { group: p.group, description: p.description },
      create: { key: p.key, scope: 'org', group: p.group, description: p.description },
    });
  }
  for (const p of PLATFORM_PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key: p.key },
      update: { group: p.group, description: p.description },
      create: { key: p.key, scope: 'platform', group: p.group, description: p.description },
    });
  }

  for (const [key, tpl] of Object.entries(BASE_ROLE_TEMPLATE) as [BaseRoleKey, (typeof BASE_ROLE_TEMPLATE)[BaseRoleKey]][]) {
    const existing = await prisma.role.findFirst({ where: { organizationId: null, key } });
    if (existing) continue;
    await prisma.role.create({
      data: {
        key,
        name: tpl.name,
        description: tpl.description,
        isSystem: true,
        permissions: { createMany: { data: tpl.permissions.map((permissionKey) => ({ permissionKey })) } },
      },
    });
  }

  for (const [role, keys] of Object.entries(DEFAULT_PLATFORM_ROLE_PERMISSIONS)) {
    const count = await prisma.platformRolePermission.count({ where: { role: role as keyof typeof DEFAULT_PLATFORM_ROLE_PERMISSIONS } });
    if (count > 0) continue;
    await prisma.platformRolePermission.createMany({
      data: keys.map((permissionKey) => ({ role: role as keyof typeof DEFAULT_PLATFORM_ROLE_PERMISSIONS, permissionKey })),
    });
  }

  // Precios de ejemplo: se editan desde la plataforma.
  const plans = [
    {
      code: 'basico', name: 'Básico', monthlyPriceCop: 49_000, maxActiveRaffles: 2, maxMembers: 1, monthlyWhatsappMessages: 300,
      featureRanking: false, featureWhatsappAuto: false, featureSellers: false, featureCustomRoles: false,
      featureCustomDomain: false, featureWhiteLabel: false, highlighted: false, sortOrder: 1,
    },
    {
      code: 'pro', name: 'Pro', monthlyPriceCop: 99_000, maxActiveRaffles: 10, maxMembers: 5, monthlyWhatsappMessages: 2_000,
      featureRanking: true, featureWhatsappAuto: true, featureSellers: true, featureCustomRoles: false,
      featureCustomDomain: false, featureWhiteLabel: false, highlighted: true, sortOrder: 2,
    },
    {
      code: 'agencia', name: 'Agencia', monthlyPriceCop: 249_000, maxActiveRaffles: null, maxMembers: 20, monthlyWhatsappMessages: 10_000,
      featureRanking: true, featureWhatsappAuto: true, featureSellers: true, featureCustomRoles: true,
      featureCustomDomain: true, featureWhiteLabel: true, highlighted: false, sortOrder: 3,
    },
  ];
  for (const plan of plans) {
    await prisma.plan.upsert({ where: { code: plan.code }, update: {}, create: plan });
  }

  const trial = await prisma.trialConfig.findUnique({ where: { id: 1 } });
  if (!trial) {
    const pro = await prisma.plan.findUniqueOrThrow({ where: { code: 'pro' } });
    const basico = await prisma.plan.findUniqueOrThrow({ where: { code: 'basico' } });
    await prisma.trialConfig.create({
      data: { id: 1, planId: pro.id, days: 14, onExpire: 'downgrade_to_plan', downgradePlanId: basico.id, pastDueGraceDays: 7 },
    });
  }
}
