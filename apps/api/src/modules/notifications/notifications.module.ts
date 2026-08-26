import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AdvisoryLockService } from '../../common/jobs/advisory-lock.service';
import { LowStockDigestJob } from '../../jobs/low-stock-digest.job';
import { OutboxDispatchJob } from '../../jobs/outbox-dispatch.job';
import { OverdueTasksJob } from '../../jobs/overdue-tasks.job';
import { RecurringTasksJob } from '../../jobs/recurring-tasks.job';
import { TasksModule } from '../tasks/tasks.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { OutboxDispatcherService } from './outbox-dispatcher.service';
import { OutboxService } from './outbox.service';

// ScheduleModule lives here rather than in app.module.ts: the cron registry and
// the dispatcher it drives are one unit, and app.module.ts stays pure wiring.
@Module({
  // TasksModule is here for the two task jobs only. TasksService writes its own
  // outbox rows through the transaction client, so nothing points back.
  imports: [ScheduleModule.forRoot(), TasksModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    OutboxService,
    OutboxDispatcherService,
    AdvisoryLockService,
    OutboxDispatchJob,
    OverdueTasksJob,
    RecurringTasksJob,
    LowStockDigestJob,
  ],
  // Every module that writes a business row someone should hear about injects
  // OutboxService and calls emit inside its own transaction.
  exports: [OutboxService, OutboxDispatcherService, AdvisoryLockService],
})
export class NotificationsModule {}
