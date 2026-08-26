import * as argon2 from 'argon2';
import type { PrismaClient } from '@prisma/client';

// The bootstrap login. Runs in every environment including production, which
// is ticket O-02. mustReset is true, so this password buys exactly one login.
export async function seedOwner(prisma: PrismaClient): Promise<string | null> {
  const username = process.env.SEED_OWNER_USERNAME ?? 'owner';
  const password = process.env.SEED_OWNER_PASSWORD ?? 'ChangeMe123!';

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
