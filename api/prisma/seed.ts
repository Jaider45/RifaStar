import { PrismaClient } from '@prisma/client';
import { seedBase } from './seed-base';

/** Seed de desarrollo. Los datos de ejemplo completos (§9) se agregan en el cierre. */
async function main() {
  const prisma = new PrismaClient({ datasourceUrl: process.env.SYSTEM_DATABASE_URL ?? process.env.DATABASE_URL });
  await seedBase(prisma);
  await prisma.$disconnect();
  console.log('Seed base aplicado.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
