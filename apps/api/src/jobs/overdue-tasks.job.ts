import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AdvisoryLockService } from '../common/jobs/advisory-lock.service';
import { jobsEnabled } from '../common/jobs/jobs-enabled';
import { TasksService } from '../modules/tasks/tasks.service';

@Injectable()
export class OverdueTasksJob {
  constructor(
    private readonly locks: AdvisoryLockService,
    private readonly tasks: TasksService,
  ) {}

  // Five fields, so second zero of every tenth minute. Nothing here is
  // timezone sensitive: "every ten minutes" reads the same on any clock.
  @Cron('*/10 * * * *', { name: 'overdue-tasks' })
  handle(): Promise<void> {
    if (!jobsEnabled()) return Promise.resolve();
    return this.locks.withLock('overdue-tasks', () => this.run());
  }

  // Plain method, no timers. This is what a test calls.
  async run(now: Date = new Date()): Promise<number> {
    const summary = await this.tasks.sweepOverdue(now);
    return summary.flagged;
  }
}
