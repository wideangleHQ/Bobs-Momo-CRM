import { Module } from '@nestjs/common';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { ChecklistTemplatesController, TaskRecurrencesController } from './templates.controller';
import { TemplatesService } from './templates.service';

// One task engine, four kinds of task. Splitting checklists, audits, SOPs and
// one-offs into separate modules would buy five overdue sweeps and five places
// to fix the same bug.
@Module({
  controllers: [TasksController, ChecklistTemplatesController, TaskRecurrencesController],
  providers: [TasksService, TemplatesService],
  // The overdue sweep and the recurrence generator live in apps/api/src/jobs
  // and call sweepOverdue and generateRecurringInstances on this service.
  exports: [TasksService],
})
export class TasksModule {}
