import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AdvisoryLockService } from '../common/jobs/advisory-lock.service';
import { jobsEnabled } from '../common/jobs/jobs-enabled';
import { TasksService } from '../modules/tasks/tasks.service';

@Injectable()
export class RecurringTasksJob {
  constructor(
    private readonly locks: AdvisoryLockService,
    private readonly tasks: TasksService,
  ) {}

  // TaskRecurrence.cronExpr is written by a manager thinking in local time, so
  // the job that evaluates those expressions runs on the same clock.
  @Cron('*/15 * * * *', { name: 'recurring-tasks', timeZone: 'Asia/Kolkata' })
  handle(): Promise<void> {
    if (!jobsEnabled()) return Promise.resolve();
    return this.locks.withLock('recurring-tasks', () => this.run());
  }

  // Plain method, no timers. This is what a test calls.
  async run(now: Date = new Date()): Promise<number> {
    const summary = await this.tasks.generateRecurringInstances(now);
    return summary.created;
  }
}
