import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { EventKey } from '@bobs-momo/shared';

export interface OutboxEmit {
  eventKey: EventKey;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
}

@Injectable()
export class OutboxService {
  /**
   * Takes the transaction client rather than the root Prisma client so the
   * intent to notify cannot commit unless the business write commits with it.
   * Call it inside the same `$transaction` block as the write, never after.
   */
  emit(tx: Prisma.TransactionClient, event: OutboxEmit) {
    return tx.outboxEvent.create({
      data: {
        eventKey: event.eventKey,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        payload: event.payload as Prisma.InputJsonValue,
      },
    });
  }
}
