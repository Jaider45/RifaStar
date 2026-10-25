import { OrgStatus, PlatformRole, TrialExpiryAction } from '@prisma/client';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { zEmail, zName, zOrgSlug, zPassword, zTimezone, zUuid } from '../common/zod';
import { ORG_PERMISSION_KEYS, type OrgPermission, PLATFORM_PERMISSION_KEYS, type PlatformPermission } from '../permissions/catalog';

export class ListOrgsQuery extends createZodDto(
  z.object({
    status: z.nativeEnum(OrgStatus).optional(),
    q: z.string().trim().max(80).optional(),
    cursor: zUuid.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  }),
) {}

export class CreateOrgDto extends createZodDto(
  z.object({ name: zName, slug: zOrgSlug, ownerEmail: zEmail, ownerName: zName, planCode: z.string().trim().max(40).optional(), timezone: zTimezone.optional() }),
) {}

export class UpdateOrgDto extends createZodDto(
  z.object({ name: zName.optional(), slug: zOrgSlug.optional(), timezone: zTimezone.optional(), customDomainVerified: z.boolean().optional() }),
) {}

export class ReasonDto extends createZodDto(z.object({ reason: z.string().trim().min(3).max(300) })) {}

export class SupportSessionDto extends createZodDto(
  z.object({ reason: z.string().trim().min(3, 'Indica para qué entras como soporte.').max(300), minutes: z.number().int().min(5).max(60).default(30) }),
) {}

const PlanFields = z.object({
  code: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,40}$/),
  name: zName,
  monthlyPriceCop: z.number().int().min(0).max(100_000_000),
  maxActiveRaffles: z.number().int().min(0).max(10_000).nullable(),
  maxMembers: z.number().int().min(1).max(10_000),
  monthlyWhatsappMessages: z.number().int().min(0).max(10_000_000),
  featureRanking: z.boolean(),
  featureWhatsappAuto: z.boolean(),
  featureSellers: z.boolean(),
  featureCustomRoles: z.boolean(),
  featureCustomDomain: z.boolean(),
  featureWhiteLabel: z.boolean(),
  externalPriceIds: z.record(z.string().max(120)).default({}),
  highlighted: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(100).default(0),
});
export class CreatePlanDto extends createZodDto(PlanFields) {}
export class UpdatePlanDto extends createZodDto(PlanFields.omit({ code: true }).partial()) {}

export class TrialConfigDto extends createZodDto(
  z.object({
    planCode: z.string().trim(),
    days: z.number().int().min(1).max(90),
    onExpire: z.nativeEnum(TrialExpiryAction),
    downgradePlanCode: z.string().trim().nullable().optional(),
    pastDueGraceDays: z.number().int().min(0).max(60),
  }),
) {}

export class TemplatePermissionsDto extends createZodDto(
  z.object({ permissions: z.array(z.enum(ORG_PERMISSION_KEYS as [OrgPermission, ...OrgPermission[]])) }),
) {}

export class PlatformPermissionsDto extends createZodDto(
  z.object({ permissions: z.array(z.enum(PLATFORM_PERMISSION_KEYS as [PlatformPermission, ...PlatformPermission[]])) }),
) {}

export class CreatePlatformUserDto extends createZodDto(z.object({ email: zEmail, name: zName, role: z.nativeEnum(PlatformRole) })) {}
export class UpdatePlatformUserDto extends createZodDto(
  z.object({ role: z.nativeEnum(PlatformRole).optional(), disabled: z.boolean().optional() }),
) {}
export class ChangePasswordDto extends createZodDto(z.object({ currentPassword: z.string().min(1).max(200), newPassword: zPassword })) {}

export class ManualSubscriptionDto extends createZodDto(
  z.object({ planCode: z.string().trim(), periodEnd: z.coerce.date().optional() }),
) {}

export class AuditQuery extends createZodDto(
  z.object({
    organizationId: zUuid.optional(),
    actorType: z.enum(['platform_user', 'user', 'participant', 'system']).optional(),
    actorId: zUuid.optional(),
    action: z.string().trim().max(80).optional(),
    entityType: z.string().trim().max(60).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    cursor: z.string().regex(/^\d+$/).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  }),
) {}

export class SubscriptionsQuery extends createZodDto(
  z.object({ status: z.enum(['trialing', 'active', 'past_due', 'canceled', 'incomplete']).optional() }),
) {}
