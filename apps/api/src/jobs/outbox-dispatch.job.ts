import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AdvisoryLockService } from '../common/jobs/advisory-lock.service';
import { jobsEnabled } from '../common/jobs/jobs-enabled';
import { OutboxDispatcherService } from '../modules/notifications/outbox-dispatcher.service';

@Injectable()
export class OutboxDispatchJob {
  constructor(
    private readonly locks: AdvisoryLockService,
    private readonly dispatcher: OutboxDispatcherService,
  ) {}

  // Six fields: the first is seconds. `*/30 * * * *` would be every 30 minutes.
  // No timeZone, because "every 30 seconds" means the same thing everywhere.
  @Cron('*/30 * * * * *', { name: 'outbox-dispatch' })
  handle(): Promise<void> {
    if (!jobsEnabled()) return Promise.resolve();
    return this.locks.withLock('outbox-dispatch', () => this.dispatcher.dispatch());
  }
}
