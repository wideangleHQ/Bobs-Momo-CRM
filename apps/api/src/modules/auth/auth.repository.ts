import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

type Tx = Prisma.TransactionClient;

// Queries only. Every decision about what a null row means belongs in the service.
@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  findUserByIdentifier(identifier: string) {
    const where = identifier.includes('@')
      ? { email: identifier.toLowerCase() }
      : { username: identifier.toLowerCase() };
    return this.prisma.user.findUnique({
      where,
      include: { employee: { select: { id: true, fullName: true } }, outlets: true },
    });
  }

  findUserById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      include: { employee: { select: { id: true, fullName: true } }, outlets: true },
    });
  }

  findRefreshToken(tokenHash: string) {
    return this.prisma.refreshToken.findUnique({ where: { tokenHash } });
  }

  revokeToken(tx: Tx, id: string) {
    return tx.refreshToken.update({ where: { id }, data: { revokedAt: new Date() } });
  }

  revokeFamily(familyId: string) {
    return this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  revokeAllForUser(tx: Tx, userId: string) {
    return tx.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  createRefreshToken(tx: Tx, data: Prisma.RefreshTokenUncheckedCreateInput) {
    return tx.refreshToken.create({ data });
  }

  recordFailedLogin(id: string, failedLogins: number, lockedUntil: Date | null) {
    return this.prisma.user.update({ where: { id }, data: { failedLogins, lockedUntil } });
  }

  recordSuccessfulLogin(tx: Tx, id: string) {
    return tx.user.update({
      where: { id },
      data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
  }

  setPassword(tx: Tx, id: string, passwordHash: string, mustReset: boolean) {
    return tx.user.update({
      where: { id },
      data: { passwordHash, mustReset, failedLogins: 0, lockedUntil: null },
    });
  }

  writeAudit(tx: Tx, data: Prisma.AuditLogUncheckedCreateInput) {
    return tx.auditLog.create({ data });
  }
}
