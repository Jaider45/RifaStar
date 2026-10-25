import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Member, Organization, User } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent';
import { createApp } from '../src/app.factory';
import { FakeMailProvider, MailProvider } from '../src/auth/mail/mail.provider';
import { PasswordService } from '../src/auth/password.service';
import { TokensService } from '../src/auth/tokens.service';
import { DatabaseService } from '../src/database/database.service';
import { RedisService } from '../src/redis/redis.service';
import { ProvisioningService } from '../src/tenancy/provisioning.service';

export interface TestContext {
  app: NestExpressApplication;
  http: TestAgent;
  db: DatabaseService;
  mail: FakeMailProvider;
  tokens: TokensService;
}

export async function createTestApp(): Promise<TestContext> {
  const app = await createApp();
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as { port: number };
  return {
    app,
    http: request(`http://127.0.0.1:${port}`),
    db: app.get(DatabaseService),
    mail: app.get(MailProvider) as FakeMailProvider,
    tokens: app.get(TokensService),
  };
}

export async function closeTestApp(ctx: TestContext): Promise<void> {
  await ctx.app.get(RedisService).client.flushdb();
  await ctx.app.close();
}

export const uid = () => randomBytes(4).toString('hex');
export const TEST_PASSWORD = 'clave-segura-123';

export async function createUser(ctx: TestContext, name = 'Persona Prueba'): Promise<User> {
  const passwordHash = await ctx.app.get(PasswordService).hash(TEST_PASSWORD);
  return ctx.db.system.user.create({ data: { email: `u-${uid()}@prueba.co`, name, passwordHash } });
}

export interface TestOrg {
  org: Organization;
  owner: User;
  ownerToken: string;
}

export async function createOrg(ctx: TestContext, opts: { planCode?: string; slug?: string } = {}): Promise<TestOrg> {
  const owner = await createUser(ctx, 'Dueña Prueba');
  const org = await ctx.app.get(ProvisioningService).createOrganization({
    name: `Org ${uid()}`,
    slug: opts.slug ?? `org-${uid()}`,
    ownerUserId: owner.id,
    planCode: opts.planCode ?? 'agencia',
  });
  return { org, owner, ownerToken: tokenFor(ctx, owner.id) };
}

export function tokenFor(ctx: TestContext, userId: string): string {
  return ctx.tokens.signAccess({ typ: 'user', sub: userId });
}

/** Agrega un miembro activo con un rol base o personalizado. */
export async function addMember(
  ctx: TestContext,
  orgId: string,
  roleKey: string,
  extra: Partial<Pick<Member, 'sellerCode'>> = {},
): Promise<{ user: User; member: Member; token: string }> {
  const user = await createUser(ctx);
  const role = await ctx.db.system.role.findFirstOrThrow({
    where: { key: roleKey, OR: [{ organizationId: null }, { organizationId: orgId }] },
  });
  const member = await ctx.db.system.member.create({
    data: { organizationId: orgId, userId: user.id, roleId: role.id, status: 'active', joinedAt: new Date(), ...extra },
  });
  return { user, member, token: tokenFor(ctx, user.id) };
}

/** Cabeceras de una request del panel. */
export const as = (token: string, orgId: string) => ({ Authorization: `Bearer ${token}`, 'X-Organization-Id': orgId });

/** Extrae el valor de una cookie Set-Cookie. */
export function cookieValue(res: { headers: Record<string, unknown> }, name: string): string | undefined {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
  for (const c of list as string[]) {
    const [pair] = c.split(';');
    const [k, v] = pair.split('=');
    if (k === name && v) return v;
  }
  return undefined;
}
