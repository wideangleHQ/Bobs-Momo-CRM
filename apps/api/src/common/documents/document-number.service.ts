import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

interface CounterRow {
  lastValue: number;
}

/**
 * Allocates PO-2026-0117 and PR-2026-0042 inside the caller's transaction.
 *
 * The UPDATE takes a row lock, so two purchases recorded in the same second
 * serialise behind it and cannot take the same number. A rolled back purchase
 * burns a number: a gap in the sequence is harmless, a duplicate is not.
 */
@Injectable()
export class DocumentNumberService {
  async next(tx: Prisma.TransactionClient, kind: string, year: number): Promise<number> {
    const rows = await tx.$queryRaw<CounterRow[]>`
      INSERT INTO "DocumentCounter" ("kind", "year", "lastValue", "updatedAt")
      VALUES (${kind}, ${year}, 1, (now() AT TIME ZONE 'UTC'))
      ON CONFLICT ("kind", "year")
      DO UPDATE SET "lastValue" = "DocumentCounter"."lastValue" + 1, "updatedAt" = (now() AT TIME ZONE 'UTC')
      RETURNING "lastValue"`;

    const row = rows[0];
    if (!row) throw new Error(`DocumentCounter returned nothing for ${kind}/${year}`);
    return row.lastValue;
  }

  async format(
    tx: Prisma.TransactionClient,
    prefix: string,
    year: number,
  ): Promise<string> {
    const value = await this.next(tx, prefix, year);
    return `${prefix}-${year}-${String(value).padStart(4, '0')}`;
  }
}
