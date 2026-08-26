import { PrismaClient } from '@prisma/client';
import { seedReference } from './seed/reference';
import { seedOwner } from './seed/owner';
import { seedDemo } from './seed/demo';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const tier = process.env.SEED_TIER ?? (process.env.NODE_ENV === 'production' ? 'reference' : 'demo');

  if (tier !== 'reference' && process.env.NODE_ENV === 'production') {
    throw new Error(`Refusing to run SEED_TIER=${tier} in production`);
  }

  // Order matters. Each step only depends on the ones above it.
  await seedReference(prisma);
  const owner = await seedOwner(prisma);

  const logins = tier === 'demo' ? await seedDemo(prisma) : [];

  console.log(`seed ok (tier=${tier})`);
  if (owner) {
    // Never echo a password that came from the environment: deployment logs are
    // retained, searchable and read by more people than the person seeding.
    const hint = process.env.SEED_OWNER_PASSWORD ? '<SEED_OWNER_PASSWORD>' : 'ChangeMe123!';
    console.log(`  owner login: ${owner} / ${hint}`);
  }
  if (logins.length > 0) {
    console.log(`  demo logins (password ChangeMe123!, all mustReset): ${logins.join(', ')}`);
  }
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
