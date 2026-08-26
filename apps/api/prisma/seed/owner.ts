import * as argon2 from 'argon2';
import type { PrismaClient } from '@prisma/client';

const LOCAL_DEFAULT_PASSWORD = 'ChangeMe123!';

/**
 * The bootstrap login. Runs in every environment including production, which is
 * ticket O-02. mustReset is true, so this password buys exactly one login.
 * Production must supply its own: a default owner password in a deployed
 * environment is a published credential, whatever the reset flag says.
 */
export async function seedOwner(prisma: PrismaClient): Promise<string | null> {
  const username = process.env.SEED_OWNER_USERNAME ?? 'owner';
  const supplied = process.env.SEED_OWNER_PASSWORD;

  if (!supplied && process.env.NODE_ENV === 'production') {
    throw new Error('SEED_OWNER_PASSWORD is required when NODE_ENV=production');
  }
  const password = supplied ?? LOCAL_DEFAULT_PASSWORD;

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) return null;

  await prisma.user.create({
    data: {
      username,
      passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
      roleKey: 'OWNER',
      status: 'ACTIVE',
      mustReset: true,
    },
  });
  // OWNER gets every active outlet computed at login, so no UserOutlet rows.
  return username;
}
