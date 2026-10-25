import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { zEmail, zHexColor, zName, zTimezone, zUuid } from '../common/zod';
import { ORG_PERMISSION_KEYS, type OrgPermission } from '../permissions/catalog';

export class UpdateOrganizationDto extends createZodDto(
  z
    .object({
      name: zName,
      supportWhatsapp: z.string().trim().min(7).max(20).nullable(),
      defaultAccentColor: zHexColor,
      timezone: zTimezone,
    })
    .partial(),
) {}

const zSellerCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{2,20}$/, 'El código de vendedor usa solo letras y números (2 a 20).');

export class InviteMemberDto extends createZodDto(
  z.object({ email: zEmail, name: zName, roleId: zUuid, sellerCode: zSellerCode.optional() }),
) {}

export class UpdateMemberDto extends createZodDto(
  z.object({ roleId: zUuid.optional(), sellerCode: zSellerCode.nullable().optional() }),
) {}

const zPermissionKeys = z
  .array(z.enum(ORG_PERMISSION_KEYS as [OrgPermission, ...OrgPermission[]]))
  .min(1, 'Elige al menos un permiso.');

export class CreateRoleDto extends createZodDto(
  z.object({ name: zName, description: z.string().trim().max(200).optional(), permissions: zPermissionKeys }),
) {}

export class UpdateRoleDto extends createZodDto(
  z.object({
    name: zName.optional(),
    description: z.string().trim().max(200).nullable().optional(),
    permissions: zPermissionKeys.optional(),
  }),
) {}
