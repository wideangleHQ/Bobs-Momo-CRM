import { Controller, Get } from '@nestjs/common';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthedUser } from '../../common/types/request';

/**
 * The outlet switcher in the app shell needs names for the outlets the caller
 * can reach. Admin owns outlet management behind admin.outlet.manage, which is
 * OWNER only, so a store manager could not label their own switcher from it.
 * This is the read every signed-in user needs and nothing more: id, code, name,
 * narrowed to their scope.
 */
@Controller('outlets')
export class OutletsController {
  constructor(private readonly prisma: PrismaService) {}

  // Reads the caller's own outlet list rather than @Scope(). The only key every
  // role holds is auth.session.create, which is granted at ALL_OUTLETS, so
  // OutletGuard would widen the scope here to every outlet and hand a
  // single-outlet cook the other shop's id.
  @Get()
  @Permissions('auth.session.create')
  async list(@CurrentUser() user: AuthedUser) {
    const outlets = await this.prisma.outlet.findMany({
      where: { id: { in: user.outletIds }, isActive: true },
      select: { id: true, code: true, name: true, timezone: true },
      orderBy: { code: 'asc' },
    });
    return { data: outlets };
  }
}
