import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { toBusinessDate } from '@bobs-momo/shared';
import { AdvisoryLockService } from '../common/jobs/advisory-lock.service';
import { jobsEnabled } from '../common/jobs/jobs-enabled';
import { PrismaService } from '../common/prisma/prisma.service';
import { OutboxService } from '../modules/notifications/outbox.service';
import { usersWithRole } from '../modules/notifications/recipients';

interface DigestLine {
  itemId: string;
  itemName: string;
  qtyOnHand: string;
  reorderLevel: string;
  unitCode: string;
}

@Injectable()
export class LowStockDigestJob {
  constructor(
    private readonly locks: AdvisoryLockService,
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  // 09:00 in Bhubaneswar, when managers are on shift and the shops are open. A
  // digest that arrives at 09:00 UTC lands at 14:30 IST, which looks plausible
  // on a log line and is useless to the person reading it.
  @Cron('0 9 * * *', { name: 'low-stock-digest', timeZone: 'Asia/Kolkata' })
  handle(): Promise<void> {
    if (!jobsEnabled()) return Promise.resolve();
    return this.locks.withLock('low-stock-digest', () => this.run());
  }

  /**
   * The real-time LOW_STOCK alert reports a change and is muted for 12 hours
   * after it fires. This reports a state: everything still below threshold this
   * morning, including items that went below days ago and have been quiet since.
   * Returns the number of outlets messaged.
   */
  async run(): Promise<number> {
    const stocks = await this.prisma.itemStock.findMany({
      where: {
        reorderLevel: { not: null },
        qtyOnHand: { lt: this.prisma.itemStock.fields.reorderLevel },
        item: { isActive: true },
      },
      select: {
        outletId: true,
        qtyOnHand: true,
        reorderLevel: true,
        item: { select: { id: true, name: true, unit: { select: { code: true } } } },
        outlet: { select: { name: true } },
      },
      orderBy: [{ outletId: 'asc' }, { item: { name: 'asc' } }],
    });

    const byOutlet = new Map<string, { outletName: string; lines: DigestLine[] }>();
    for (const s of stocks) {
      const bucket = byOutlet.get(s.outletId) ?? { outletName: s.outlet.name, lines: [] };
      bucket.lines.push({
        itemId: s.item.id,
        itemName: s.item.name,
        qtyOnHand: s.qtyOnHand.toFixed(3),
        reorderLevel: s.reorderLevel?.toFixed(3) ?? '0.000',
        unitCode: s.item.unit.code,
      });
      byOutlet.set(s.outletId, bucket);
    }

    const businessDate = toBusinessDate();
    let sent = 0;

    for (const [outletId, { outletName, lines }] of byOutlet) {
      // Outlets with nothing below threshold get no message. A daily "all
      // clear" trains people to ignore the sender.
      const userIds = [
        ...new Set([
          ...(await usersWithRole(this.prisma, 'INVENTORY_MANAGER', outletId)),
          ...(await usersWithRole(this.prisma, 'STORE_MANAGER', outletId)),
        ]),
      ];
      if (userIds.length === 0) continue;

      await this.prisma.$transaction((tx) =>
        this.outbox.emit(tx, {
          eventKey: 'OPERATIONAL_ALERT',
          aggregateType: 'Outlet',
          aggregateId: outletId,
          payload: {
            userIds,
            outletId,
            outletName,
            businessDate,
            raisedByName: 'Low stock digest',
            title: `Low stock digest: ${outletName}`,
            alertText:
              `${lines.length} ${lines.length === 1 ? 'item is' : 'items are'} below ` +
              `reorder level at ${outletName}`,
            deepLink: `/inventory/stock?outletId=${encodeURIComponent(outletId)}`,
            items: lines,
          },
        }),
      );
      sent += 1;
    }

    return sent;
  }
}
